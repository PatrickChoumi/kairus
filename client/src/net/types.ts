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
  /** Seconds — set only on a voice message. */
  duration: number | null
  /** 0…100 loudness samples, comma-separated: the shape of the waveform. */
  peaks: string | null
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
  /** Who said it first, when this message is a forward of someone else's. */
  forwarded: { from: Face; at: number } | null
  /** Set while a message is still in flight, cleared when the server confirms. */
  pending?: boolean
  /** 0…1 while the file is on its way up. Local only. */
  progress?: number
  /** A local object URL, so an outgoing image shows before it has uploaded. */
  preview?: string
}

/** What a conversation shows as: a person for a direct one, a name for a group. */
export type Face = { id: string; name: string; hue: number }

export type Conversation = {
  id: string
  kind: 'direct' | 'group'
  face: Face
  /** Everyone in it but you. */
  members: User[]
  lastMessage: Message | null
  unread: number
  /** When the last of the others had read up to. */
  readAt: number
  /** What this conversation keeps at the top, most recently pinned first. */
  pins: Message[]
  /** What you had started writing here, from whichever device you left it on. */
  draft: string
}

export type SearchHit = {
  message: Message
  conversationId: string
  face: Face
}

/** What one end of a call says to the other; the server only carries it. */
export type CallAct =
  | 'ring'
  | 'accept'
  | 'decline'
  | 'busy'
  | 'end'
  | 'offer'
  | 'answer'
  | 'ice'

export type Inbound =
  | {
      t: 'ready'
      user: User
      conversations: Conversation[]
      token?: string
      ice?: RTCIceServer[]
    }
  | {
      t: 'call'
      act: CallAct
      conversation: string
      call: string
      from: string
      payload?: unknown
    }
  | { t: 'message'; message: Message; nonce?: string }
  /** The same message in a new state: rewritten, or taken back. */
  | { t: 'revised'; message: Message }
  | { t: 'typing'; conversation: string; userId: string }
  | { t: 'read'; conversation: string; userId: string; at: number }
  | { t: 'presence'; userId: string; online: boolean }
  | { t: 'conversation'; conversation: Conversation }
  /** A conversation that is no longer yours: you left it, or it dissolved. */
  | { t: 'gone'; conversation: string }
  | { t: 'error'; message: string; retryAfter?: number; code?: 'expired' }
