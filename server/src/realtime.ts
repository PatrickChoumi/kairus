import type { IncomingMessage, Server } from 'node:http'
import { WebSocketServer, type WebSocket } from 'ws'
import { env } from './env.js'
import { limits } from './limiter.js'
import {
  addMessage,
  blockedInConversation,
  conversationKind,
  describeConversation,
  findLiveIdentity,
  findUser,
  forwardMessage,
  isBlocked,
  isMuted,
  isParticipant,
  listConversations,
  listPins,
  markRead,
  MAX_PINS,
  participantIds,
  pinMessage,
  retractMessage,
  reviseMessage,
  saveDraft,
  unpinMessage,
  type ForwardRefusal,
  type Message,
  type PinRefusal,
  type User,
} from './model.js'
import { shouldRenew, sign, verify } from './token.js'
import { knock } from './push.js'
import { attachmentOf, claim, duplicate } from './files.js'
import { count, gauge, log } from './log.js'

type Outbound =
  | {
      t: 'ready'
      user: User
      conversations: ReturnType<typeof listConversations>
      token?: string
      /** What a call should use to find a path between two browsers. */
      ice: unknown[]
    }
  | { t: 'message'; message: Message; nonce?: string }
  | { t: 'revised'; message: Message }
  | { t: 'typing'; conversation: string; userId: string }
  | { t: 'read'; conversation: string; userId: string; at: number }
  | { t: 'presence'; userId: string; online: boolean }
  | { t: 'conversation'; conversation: NonNullable<ReturnType<typeof describeConversation>> }
  /** A conversation that is no longer yours: you left it, or it dissolved. */
  | { t: 'gone'; conversation: string }
  /** What this conversation now keeps at the top. */
  | { t: 'pinned'; conversation: string; pins: Message[] }
  /**
   * A draft you left on another device. It never travels to anyone else —
   * half a sentence is not something to show the person you are writing to.
   */
  | { t: 'draft'; conversation: string; body: string; at: number }
  /** One end of a call talking to the other. The server only carries it. */
  | {
      t: 'call'
      act: CallAct
      conversation: string
      call: string
      from: string
      payload?: unknown
    }
  | { t: 'error'; message: string; retryAfter?: number; code?: 'expired' }

/**
 * What one end of a call can say to the other.
 *
 * `ring` opens it, `accept` and `decline` answer it, `end` closes it from
 * either side, and `busy` is the answer when the callee is already on a call.
 * `offer`, `answer` and `ice` carry the WebRTC negotiation itself, which the
 * server never reads — it only knows who may hear it.
 */
const CALL_ACTS = ['ring', 'accept', 'decline', 'busy', 'end', 'offer', 'answer', 'ice'] as const
type CallAct = (typeof CALL_ACTS)[number]

const isCallAct = (value: unknown): value is CallAct =>
  typeof value === 'string' && (CALL_ACTS as readonly string[]).includes(value)

/** Why a forward or a pin was refused, said in one line to the socket. */
const forwardExcuses: Record<ForwardRefusal, string> = {
  missing: 'ce message n’existe plus',
  'not-yours': 'ce message n’existe plus',
  retracted: 'ce message a été retiré',
  nowhere: 'cette conversation n’existe pas',
  closed: 'cette conversation est fermée',
  empty: 'il n’y a rien à transférer',
}

const pinExcuses: Record<PinRefusal, string> = {
  missing: 'ce message n’existe plus',
  'not-yours': 'cette conversation n’existe pas',
  retracted: 'ce message a été retiré',
  'too-many': `on ne peut pas épingler plus de ${MAX_PINS} messages`,
}

/** What a message with no words is, in the one line a notification has. */
function wordless(mime: string | undefined): string {
  if (!mime) return ''
  if (mime.startsWith('audio/')) return 'message vocal'
  if (mime.startsWith('image/')) return 'photo'
  return 'fichier'
}

type Socket = WebSocket & {
  userId?: string
  /** The token version this socket authenticated with. */
  version?: number
  alive?: boolean
  address?: string
}

const HEARTBEAT_MS = 30_000
const HANDSHAKE_MS = 10_000
/** Frames a socket may send before it is simply not listened to any more. */
const FRAMES_PER_MINUTE = 600

class Hub {
  private sockets = new Map<string, Set<Socket>>()

  attach(socket: Socket, userId: string): void {
    const first = !this.sockets.has(userId)
    const set = this.sockets.get(userId) ?? new Set<Socket>()
    set.add(socket)
    this.sockets.set(userId, set)
    if (first) this.announcePresence(userId, true)
  }

  detach(socket: Socket): void {
    const userId = socket.userId
    if (!userId) return
    const set = this.sockets.get(userId)
    if (!set) return
    set.delete(socket)
    if (set.size === 0) {
      this.sockets.delete(userId)
      this.announcePresence(userId, false)
    }
  }

  isOnline(userId: string): boolean {
    return this.sockets.has(userId)
  }

  userCount(): number {
    return this.sockets.size
  }

  socketCount(): number {
    let total = 0
    for (const set of this.sockets.values()) total += set.size
    return total
  }

  toUser(userId: string, payload: Outbound, skip?: Socket): void {
    const frame = JSON.stringify(payload)
    for (const socket of this.sockets.get(userId) ?? []) {
      if (socket !== skip && socket.readyState === socket.OPEN) socket.send(frame)
    }
  }

  toConversation(conversationId: string, payload: Outbound, skip?: Socket): void {
    for (const userId of participantIds(conversationId)) this.toUser(userId, payload, skip)
  }

  /**
   * Whether anyone else in the conversation could pick up. Ringing a browser
   * that is not there would leave the caller listening to nothing until they
   * gave up; telling them straight away is kinder and cheaper.
   */
  hasPeerOnline(conversationId: string, exceptUserId: string): boolean {
    for (const userId of participantIds(conversationId)) {
      if (userId === exceptUserId || isBlocked(exceptUserId, userId)) continue
      if (this.isOnline(userId)) return true
    }
    return false
  }

  /** Everyone in the conversation except one person — used for typing. */
  toPeers(conversationId: string, exceptUserId: string, payload: Outbound): void {
    for (const userId of participantIds(conversationId)) {
      if (userId === exceptUserId || isBlocked(exceptUserId, userId)) continue
      this.toUser(userId, payload)
    }
  }

  broadcastMessage(message: Message, skip?: Socket): void {
    this.toConversation(message.conversationId, { t: 'message', message }, skip)
    void this.reachTheAbsent(message)
  }

  /**
   * Anyone in the conversation with no live socket is not going to see this
   * until they come back — unless we reach them where they are. Someone with a
   * socket open needs nothing: the message is already on their screen, and the
   * client raises its own notification when the tab is merely hidden.
   */
  private async reachTheAbsent(message: Message): Promise<void> {
    const sender = findUser(message.senderId)
    if (!sender) return
    const room = conversationKind(message.conversationId) === 'group'
    for (const userId of participantIds(message.conversationId)) {
      if (userId === message.senderId || this.isOnline(userId)) continue
      if (isBlocked(userId, message.senderId)) continue
      // Silenced: the message still arrives and still counts as unread. What
      // it does not do is ring in someone's pocket, which is the only thing
      // they asked to stop.
      if (isMuted(message.conversationId, userId)) continue
      const said = message.body || wordless(message.attachment?.mime)
      try {
        // In a group the title is the notification; who spoke goes in the body.
        const conversation = room ? describeConversation(message.conversationId, userId) : null
        await knock(userId, {
          conversationId: message.conversationId,
          from: conversation?.face.name ?? sender.name,
          body: room ? `${sender.name} : ${said}` : said,
        })
      } catch (error) {
        log.warn('push.knock.failed', { userId, error: String(error) })
      }
    }
  }

  /** An edit or a retraction: the same message, in its new state. */
  broadcastRevision(message: Message, skip?: Socket): void {
    this.toConversation(message.conversationId, { t: 'revised', message }, skip)
  }

  /**
   * Pins are shaped per reader, not once for everyone: someone who joined a
   * group yesterday must not receive, through a pin, what was said before.
   */
  broadcastPins(conversationId: string): void {
    for (const userId of participantIds(conversationId)) {
      this.toUser(userId, {
        t: 'pinned',
        conversation: conversationId,
        pins: listPins(conversationId, userId),
      })
    }
  }

  /** A draft goes to your own other devices, and nowhere else. */
  broadcastDraft(
    userId: string,
    conversationId: string,
    body: string,
    at: number,
    skip?: Socket,
  ): void {
    this.toUser(userId, { t: 'draft', conversation: conversationId, body, at }, skip)
  }

  broadcastRead(conversationId: string, userId: string, at: number): void {
    this.toConversation(conversationId, { t: 'read', conversation: conversationId, userId, at })
  }

  /**
   * Closes the live sockets a revoked token was still holding open. Without
   * this, changing a passphrase would end HTTP access while leaving an already
   * connected socket happily receiving messages.
   */
  evict(userId: string, keepVersion: number): void {
    for (const socket of [...(this.sockets.get(userId) ?? [])]) {
      if (socket.version === keepVersion) continue
      send(socket, { t: 'error', message: 'session expirée', code: 'expired' })
      socket.close(4003, 'revoked')
    }
  }

  /**
   * Everyone sharing a conversation with this person sees them arrive or leave
   * — except across a block, where presence would be a way of keeping tabs on
   * someone who asked not to be contacted.
   */
  private announcePresence(userId: string, online: boolean): void {
    const told = new Set<string>()
    for (const conversation of listConversations(userId)) {
      for (const member of conversation.members) {
        if (member.id === userId || told.has(member.id)) continue
        if (isBlocked(userId, member.id)) continue
        told.add(member.id)
        this.toUser(member.id, { t: 'presence', userId, online })
      }
    }
  }

  /** Presence snapshot for everyone a viewer shares a conversation with. */
  onlinePeers(viewerId: string): string[] {
    const seen = new Set<string>()
    for (const conversation of listConversations(viewerId)) {
      for (const member of conversation.members) {
        if (member.id === viewerId || !this.isOnline(member.id)) continue
        if (isBlocked(viewerId, member.id)) continue
        seen.add(member.id)
      }
    }
    return [...seen]
  }
}

export const hub = new Hub()

gauge('sockets_connected', () => hub.socketCount())
gauge('users_online', () => hub.userCount())

/** Mirrors the HTTP rule: forged forwarding headers must not buy a new budget. */
function addressOfUpgrade(req: IncomingMessage, trustProxy: number): string {
  if (trustProxy > 0) {
    const chain = String(req.headers['x-forwarded-for'] ?? '')
      .split(',')
      .map((part) => part.trim())
      .filter(Boolean)
    const hop = chain[chain.length - trustProxy]
    if (hop) return hop
  }
  return req.socket.remoteAddress ?? 'unknown'
}

/** Returns a disposer: closing the HTTP server does not close the socket server. */
export function attachRealtime(server: Server, trustProxy = 0): () => void {
  const wss = new WebSocketServer({ server, path: '/socket', maxPayload: 64 * 1024 })
  const frames = new Map<Socket, { count: number; since: number }>()

  wss.on('connection', (raw, req) => {
    const socket = raw as Socket
    socket.alive = true
    socket.address = addressOfUpgrade(req, trustProxy)
    socket.on('pong', () => {
      socket.alive = true
    })

    // A socket that never identifies itself is dropped.
    const handshake = setTimeout(() => {
      if (!socket.userId) socket.close(4001, 'no handshake')
    }, HANDSHAKE_MS)

    socket.on('message', (data) => {
      // Cheapest possible guard, before parsing anything.
      const now = Date.now()
      const seen = frames.get(socket) ?? { count: 0, since: now }
      if (now - seen.since > 60_000) {
        seen.count = 0
        seen.since = now
      }
      seen.count += 1
      frames.set(socket, seen)
      if (seen.count > FRAMES_PER_MINUTE) {
        count('socket.flooded')
        log.warn('socket.flooded', { address: socket.address })
        socket.close(4008, 'too many frames')
        return
      }

      let frame: Record<string, unknown>
      try {
        frame = JSON.parse(String(data))
      } catch {
        return
      }
      handleFrame(socket, frame)
      if (socket.userId) clearTimeout(handshake)
    })

    socket.on('close', () => {
      clearTimeout(handshake)
      frames.delete(socket)
      hub.detach(socket)
    })
    socket.on('error', () => socket.close())
  })

  const heartbeat = setInterval(() => {
    for (const raw of wss.clients) {
      const socket = raw as Socket
      if (socket.alive === false) {
        socket.terminate()
        continue
      }
      socket.alive = false
      socket.ping()
    }
  }, HEARTBEAT_MS)
  // Waiting to ping is never a reason to keep the process alive.
  heartbeat.unref?.()

  wss.on('close', () => clearInterval(heartbeat))

  return () => {
    clearInterval(heartbeat)
    for (const client of wss.clients) client.terminate()
    wss.close()
  }
}

const send = (socket: Socket, payload: Outbound) => {
  if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(payload))
}

const str = (frame: Record<string, unknown>, key: string): string => {
  const value = frame[key]
  return typeof value === 'string' ? value.trim() : ''
}

/** Returns false — and tells the client why — when a limit is reached. */
function afford(socket: Socket, limiter: (typeof limits)['write'], key: string, message: string): boolean {
  const wait = limiter.take(key)
  if (wait === 0) return true
  send(socket, { t: 'error', message, retryAfter: wait })
  return false
}

function handleFrame(socket: Socket, frame: Record<string, unknown>): void {
  const type = frame.t

  if (type === 'hello') {
    const claims = verify(str(frame, 'token'))
    const user = claims ? findLiveIdentity(claims.userId, claims.version) : undefined
    if (!claims || !user) {
      send(socket, { t: 'error', message: 'session expirée', code: 'expired' })
      socket.close(4003, 'unauthorised')
      return
    }
    socket.userId = user.id
    socket.version = claims.version
    hub.attach(socket, user.id)
    send(socket, {
      t: 'ready',
      user,
      conversations: listConversations(user.id),
      ice: env.iceServers,
      // An old-but-valid token is swapped here too, not only over HTTP.
      ...(shouldRenew(claims) ? { token: sign(user.id, claims.version) } : {}),
    })
    for (const peerId of hub.onlinePeers(user.id)) {
      send(socket, { t: 'presence', userId: peerId, online: true })
    }
    return
  }

  const userId = socket.userId
  if (!userId) return

  const conversation = str(frame, 'conversation')
  if (conversation && !isParticipant(conversation, userId)) return

  switch (type) {
    case 'send': {
      const body = str(frame, 'body').slice(0, 4000)
      const attachmentId = str(frame, 'attachment')
      if (!conversation || (!body && !attachmentId)) return
      if (!afford(socket, limits.write, userId, 'vous écrivez plus vite que nous ne pouvons suivre')) {
        return
      }
      if (blockedInConversation(conversation, userId)) {
        send(socket, { t: 'error', message: 'cette conversation est fermée' })
        return
      }
      const replyTo = str(frame, 'replyTo') || null
      const stored = addMessage(conversation, userId, body, replyTo)
      // An upload only becomes part of the conversation once it is claimed by
      // the message that carries it, and only by whoever uploaded it.
      const message =
        attachmentId && claim(attachmentId, userId, stored.id)
          ? { ...stored, attachment: attachmentOf(stored.id) }
          : stored
      count('messages_sent')
      const nonce = str(frame, 'nonce')
      send(socket, { t: 'message', message, ...(nonce ? { nonce } : {}) })
      hub.broadcastMessage(message, socket)
      break
    }
    case 'revise': {
      const id = str(frame, 'message')
      const body = str(frame, 'body').slice(0, 4000)
      if (!id || !body) return
      if (!afford(socket, limits.write, userId, 'trop de corrections d’un coup')) return
      const revision = reviseMessage(id, userId, body)
      if (!revision.ok) return
      send(socket, { t: 'revised', message: revision.message })
      hub.broadcastRevision(revision.message, socket)
      break
    }
    case 'retract': {
      const id = str(frame, 'message')
      if (!id) return
      if (!afford(socket, limits.write, userId, 'trop de retraits d’un coup')) return
      const revision = retractMessage(id, userId)
      if (!revision.ok) return
      send(socket, { t: 'revised', message: revision.message })
      hub.broadcastRevision(revision.message, socket)
      break
    }
    case 'typing': {
      if (!conversation) return
      hub.toPeers(conversation, userId, { t: 'typing', conversation, userId })
      break
    }
    case 'read': {
      if (!conversation) return
      const at = markRead(conversation, userId, Date.now())
      hub.broadcastRead(conversation, userId, at)
      break
    }
    case 'forward': {
      const id = str(frame, 'message')
      if (!conversation || !id) return
      if (!afford(socket, limits.write, userId, 'trop de transferts d’un coup')) return
      const result = forwardMessage(id, conversation, userId, duplicate)
      if (!result.ok) {
        send(socket, { t: 'error', message: forwardExcuses[result.reason] })
        return
      }
      count('messages_forwarded')
      const nonce = str(frame, 'nonce')
      send(socket, { t: 'message', message: result.message, ...(nonce ? { nonce } : {}) })
      hub.broadcastMessage(result.message, socket)
      break
    }
    case 'pin':
    case 'unpin': {
      const id = str(frame, 'message')
      if (!conversation || !id) return
      if (!afford(socket, limits.write, userId, 'trop d’épinglages d’un coup')) return
      const result =
        type === 'pin'
          ? pinMessage(conversation, id, userId)
          : unpinMessage(conversation, id, userId)
      if (!result.ok) {
        send(socket, { t: 'error', message: pinExcuses[result.reason] })
        return
      }
      hub.broadcastPins(conversation)
      break
    }
    case 'draft': {
      if (!conversation) return
      // Generous on purpose: a draft travels on a pause in typing, not on send.
      if (!afford(socket, limits.sketch, userId, 'trop de brouillons d’un coup')) return
      const body = String(frame.body ?? '').slice(0, 4000)
      const at = saveDraft(conversation, userId, body)
      // Back to your own other devices only — never to the person you write to.
      hub.broadcastDraft(userId, conversation, body, at, socket)
      break
    }
    /*
     * Calls.
     *
     * The audio never comes through here: two browsers negotiate a direct
     * path and the server only carries the notes they pass each other. It
     * still decides who may hear them — a call is a conversation like any
     * other, so the same participation and blocking rules apply.
     */
    case 'call': {
      const act = frame.act
      const call = str(frame, 'call')
      if (!conversation || !call || !isCallAct(act)) return
      if (conversationKind(conversation) !== 'direct') {
        send(socket, { t: 'error', message: 'les appels de groupe ne sont pas encore là' })
        return
      }
      if (blockedInConversation(conversation, userId)) {
        send(socket, { t: 'error', message: 'cette conversation est fermée' })
        return
      }
      // Only the ring is rationed; what follows belongs to a call already rung.
      if (act === 'ring' && !afford(socket, limits.ring, userId, 'trop d’appels d’affilée')) return
      if (act === 'ring') {
        count('calls_placed')
        if (!hub.hasPeerOnline(conversation, userId)) {
          send(socket, { t: 'call', act: 'end', conversation, call, from: userId })
          return
        }
      }
      hub.toPeers(conversation, userId, {
        t: 'call',
        act,
        conversation,
        call,
        from: userId,
        payload: frame.payload,
      })
      break
    }
    case 'ping':
      break
  }
}
