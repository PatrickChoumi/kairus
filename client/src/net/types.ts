export type User = {
  id: string
  handle: string
  name: string
  hue: number
}

export type Message = {
  id: string
  conversationId: string
  senderId: string
  body: string
  replyTo: string | null
  createdAt: number
  /** Set while a message is still in flight, cleared when the server confirms. */
  pending?: boolean
  failed?: boolean
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
  | { t: 'ready'; user: User; conversations: Conversation[] }
  | { t: 'message'; message: Message; nonce?: string }
  | { t: 'typing'; conversation: string; userId: string }
  | { t: 'read'; conversation: string; userId: string; at: number }
  | { t: 'presence'; userId: string; online: boolean }
  | { t: 'conversation'; conversation: Conversation }
  | { t: 'error'; message: string }
