import type { Server } from 'node:http'
import { WebSocketServer, type WebSocket } from 'ws'
import {
  addMessage,
  describeConversation,
  findUser,
  isParticipant,
  listConversations,
  markRead,
  participantIds,
  type Message,
  type User,
} from './model.js'
import { verify } from './token.js'

type Outbound =
  | { t: 'ready'; user: User; conversations: ReturnType<typeof listConversations> }
  | { t: 'message'; message: Message; nonce?: string }
  | { t: 'typing'; conversation: string; userId: string }
  | { t: 'read'; conversation: string; userId: string; at: number }
  | { t: 'presence'; userId: string; online: boolean }
  | { t: 'conversation'; conversation: NonNullable<ReturnType<typeof describeConversation>> }
  | { t: 'error'; message: string }

type Socket = WebSocket & { userId?: string; alive?: boolean }

const HEARTBEAT_MS = 30_000

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
      if (userId !== exceptUserId) this.toUser(userId, payload)
    }
  }

  broadcastMessage(message: Message, skip?: Socket): void {
    this.toConversation(message.conversationId, { t: 'message', message }, skip)
  }

  broadcastRead(conversationId: string, userId: string, at: number): void {
    this.toConversation(conversationId, { t: 'read', conversation: conversationId, userId, at })
  }

  /** Everyone sharing a conversation with this person sees them arrive or leave. */
  private announcePresence(userId: string, online: boolean): void {
    for (const conversation of listConversations(userId)) {
      if (conversation.peer.id === userId) continue
      this.toUser(conversation.peer.id, { t: 'presence', userId, online })
    }
  }

  /** Presence snapshot for the peers a viewer can see. */
  onlinePeers(viewerId: string): string[] {
    return listConversations(viewerId)
      .map((c) => c.peer.id)
      .filter((id) => id !== viewerId && this.isOnline(id))
  }
}

export const hub = new Hub()

export function attachRealtime(server: Server): void {
  const wss = new WebSocketServer({ server, path: '/socket' })

  wss.on('connection', (raw) => {
    const socket = raw as Socket
    socket.alive = true
    socket.on('pong', () => {
      socket.alive = true
    })

    // A socket that never identifies itself is dropped.
    const handshake = setTimeout(() => {
      if (!socket.userId) socket.close(4001, 'no handshake')
    }, 10_000)

    socket.on('message', (data) => {
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

  wss.on('close', () => clearInterval(heartbeat))
}

const send = (socket: Socket, payload: Outbound) => {
  if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(payload))
}

const str = (frame: Record<string, unknown>, key: string): string => {
  const value = frame[key]
  return typeof value === 'string' ? value.trim() : ''
}

function handleFrame(socket: Socket, frame: Record<string, unknown>): void {
  const type = frame.t

  if (type === 'hello') {
    const userId = verify(str(frame, 'token'))
    const user = userId ? findUser(userId) : undefined
    if (!user) {
      send(socket, { t: 'error', message: 'session expirée' })
      socket.close(4003, 'unauthorised')
      return
    }
    socket.userId = user.id
    hub.attach(socket, user.id)
    send(socket, { t: 'ready', user, conversations: listConversations(user.id) })
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
      if (!conversation || !body) return
      const replyTo = str(frame, 'replyTo') || null
      const message = addMessage(conversation, userId, body, replyTo)
      const nonce = str(frame, 'nonce')
      send(socket, { t: 'message', message, ...(nonce ? { nonce } : {}) })
      hub.broadcastMessage(message, socket)
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
