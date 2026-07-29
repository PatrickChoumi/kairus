export type User = {
  id: string
  handle: string
  name: string
  hue: number
}

export type Attachment = {
  id: string
  name: string
  mime: string
  size: number
  width: number | null
  height: number | null
}

export type Message = {
  id: string
  conversationId: string
  senderId: string
  body: string
  replyTo: string | null
  createdAt: number
  /** When the sender rewrote it. */
  editedAt: number | null
  /** When the sender took it back — the body is empty from then on. */
  deletedAt: number | null
  /** A file travelling with the message, if any. */
  attachment: Attachment | null
  /** Set while a message is still in flight, cleared when the server confirms. */
  pending?: boolean
  /** 0…1 while the file is on its way up. Local only. */
  progress?: number
  /** A local object URL, so an outgoing image shows before it has uploaded. */
  preview?: string
}

export type Conversation = {
  id: string
  peer: User
  lastMessage: Message | null
  unread: number
  peerReadAt: number
}

export type SearchHit = {
  message: Message
  conversationId: string
  peer: User
}

export type Inbound =
  | { t: 'ready'; user: User; conversations: Conversation[]; token?: string }
  | { t: 'message'; message: Message; nonce?: string }
  /** The same message in a new state: rewritten, or taken back. */
  | { t: 'revised'; message: Message }
  | { t: 'typing'; conversation: string; userId: string }
  | { t: 'read'; conversation: string; userId: string; at: number }
  | { t: 'presence'; userId: string; online: boolean }
  | { t: 'conversation'; conversation: Conversation }
  | { t: 'error'; message: string; retryAfter?: number; code?: 'expired' }
