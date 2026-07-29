import type { IncomingMessage, Server } from 'node:http'
import { WebSocketServer, type WebSocket } from 'ws'
import { limits } from './limiter.js'
import {
  addMessage,
  blockedInConversation,
  conversationKind,
  describeConversation,
  findLiveIdentity,
  findUser,
  isBlocked,
  isParticipant,
  listConversations,
  markRead,
  participantIds,
  retractMessage,
  reviseMessage,
  type Message,
  type User,
} from './model.js'
import { shouldRenew, sign, verify } from './token.js'
import { knock } from './push.js'
import { attachmentOf, claim } from './files.js'
import { count, gauge, log } from './log.js'

type Outbound =
  | { t: 'ready'; user: User; conversations: ReturnType<typeof listConversations>; token?: string }
  | { t: 'message'; message: Message; nonce?: string }
  | { t: 'revised'; message: Message }
  | { t: 'typing'; conversation: string; userId: string }
  | { t: 'read'; conversation: string; userId: string; at: number }
  | { t: 'presence'; userId: string; online: boolean }
  | { t: 'conversation'; conversation: NonNullable<ReturnType<typeof describeConversation>> }
  /** A conversation that is no longer yours: you left it, or it dissolved. */
  | { t: 'gone'; conversation: string }
  | { t: 'error'; message: string; retryAfter?: number; code?: 'expired' }

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
      const said = message.body || (message.attachment ? 'a envoyé un fichier' : '')
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
    case 'ping':
      break
  }
}
