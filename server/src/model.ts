import { randomUUID } from 'node:crypto'
import bcrypt from 'bcryptjs'
import { db } from './db.js'

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
}

export type Conversation = {
  id: string
  peer: User
  lastMessage: Message | null
  unread: number
  peerReadAt: number
}

type UserRow = User & { password_hash: string; created_at: number }
type MessageRow = {
  id: string
  conversation_id: string
  sender_id: string
  body: string
  reply_to: string | null
  created_at: number
}

const toMessage = (r: MessageRow): Message => ({
  id: r.id,
  conversationId: r.conversation_id,
  senderId: r.sender_id,
  body: r.body,
  replyTo: r.reply_to,
  createdAt: r.created_at,
})

/* ------------------------------------------------------------------ users */

const HANDLE_RE = /^[a-z0-9_]{3,20}$/

export const isHandle = (v: unknown): v is string =>
  typeof v === 'string' && HANDLE_RE.test(v)

/** Deterministic hue so an identity always wears the same colour. */
function hueFor(handle: string): number {
  let h = 0
  for (const ch of handle) h = (h * 31 + ch.charCodeAt(0)) % 360
  return h
}

export function createUser(handle: string, name: string, password: string): User {
  const user: UserRow = {
    id: randomUUID(),
    handle,
    name: name.trim() || handle,
    password_hash: bcrypt.hashSync(password, 10),
    hue: hueFor(handle),
    created_at: Date.now(),
  }
  db.prepare(
    `INSERT INTO users (id, handle, name, password_hash, hue, created_at)
     VALUES (@id, @handle, @name, @password_hash, @hue, @created_at)`,
  ).run(user)
  return { id: user.id, handle: user.handle, name: user.name, hue: user.hue }
}

export function findUserByHandle(handle: string): UserRow | undefined {
  return db.prepare(`SELECT * FROM users WHERE handle = ?`).get(handle) as UserRow | undefined
}

export function findUser(id: string): User | undefined {
  return db.prepare(`SELECT id, handle, name, hue FROM users WHERE id = ?`).get(id) as
    | User
    | undefined
}

export function verifyPassword(row: UserRow, password: string): boolean {
  return bcrypt.compareSync(password, row.password_hash)
}

export function searchUsers(query: string, exclude: string, limit = 8): User[] {
  return db
    .prepare(
      `SELECT id, handle, name, hue FROM users
       WHERE id != ? AND (handle LIKE ? OR name LIKE ?)
       ORDER BY length(handle) ASC LIMIT ?`,
    )
    .all(exclude, `%${query}%`, `%${query}%`, limit) as User[]
}

/* ---------------------------------------------------------- conversations */

/**
 * Returns the existing conversation between two people, or creates it.
 * `a === b` addresses the private one-participant conversation you keep with
 * yourself, so it is matched on participant count rather than on a self-join.
 */
export function openConversation(a: string, b: string): string {
  const existing = (
    a === b
      ? db
          .prepare(
            `SELECT p.conversation_id AS id FROM participants p
             WHERE p.user_id = ?
               AND (SELECT count(*) FROM participants q
                    WHERE q.conversation_id = p.conversation_id) = 1`,
          )
          .get(a)
      : db
          .prepare(
            `SELECT p.conversation_id AS id FROM participants p
             JOIN participants q ON q.conversation_id = p.conversation_id
             WHERE p.user_id = ? AND q.user_id = ?
               AND (SELECT count(*) FROM participants r
                    WHERE r.conversation_id = p.conversation_id) = 2`,
          )
          .get(a, b)
  ) as { id: string } | undefined
  if (existing) return existing.id

  const id = randomUUID()
  db.transaction(() => {
    db.prepare(`INSERT INTO conversations (id, created_at) VALUES (?, ?)`).run(id, Date.now())
    const add = db.prepare(
      `INSERT INTO participants (conversation_id, user_id) VALUES (?, ?)`,
    )
    add.run(id, a)
    if (a !== b) add.run(id, b)
  })()
  return id
}

export function participantIds(conversationId: string): string[] {
  return (
    db
      .prepare(`SELECT user_id FROM participants WHERE conversation_id = ?`)
      .all(conversationId) as { user_id: string }[]
  ).map((r) => r.user_id)
}

export function isParticipant(conversationId: string, userId: string): boolean {
  return !!db
    .prepare(`SELECT 1 FROM participants WHERE conversation_id = ? AND user_id = ?`)
    .get(conversationId, userId)
}

/** One conversation, shaped from the point of view of `viewerId`. */
export function describeConversation(id: string, viewerId: string): Conversation | null {
  const peer = db
    .prepare(
      `SELECT u.id, u.handle, u.name, u.hue
       FROM participants p JOIN users u ON u.id = p.user_id
       WHERE p.conversation_id = ? AND p.user_id != ?`,
    )
    .get(id, viewerId) as User | undefined

  // A conversation with yourself is legitimate — it is your own notepad.
  const self = findUser(viewerId)
  const other = peer ?? self
  if (!other) return null

  const last = db
    .prepare(
      `SELECT * FROM messages WHERE conversation_id = ? ORDER BY created_at DESC LIMIT 1`,
    )
    .get(id) as MessageRow | undefined

  const mine = db
    .prepare(`SELECT last_read_at FROM participants WHERE conversation_id = ? AND user_id = ?`)
    .get(id, viewerId) as { last_read_at: number } | undefined

  const theirs = peer
    ? (db
        .prepare(
          `SELECT last_read_at FROM participants WHERE conversation_id = ? AND user_id = ?`,
        )
        .get(id, peer.id) as { last_read_at: number } | undefined)
    : mine

  const unread = db
    .prepare(
      `SELECT count(*) AS n FROM messages
       WHERE conversation_id = ? AND sender_id != ? AND created_at > ?`,
    )
    .get(id, viewerId, mine?.last_read_at ?? 0) as { n: number }

  return {
    id,
    peer: other,
    lastMessage: last ? toMessage(last) : null,
    unread: unread.n,
    peerReadAt: theirs?.last_read_at ?? 0,
  }
}

export function listConversations(viewerId: string): Conversation[] {
  const ids = (
    db
      .prepare(
        `SELECT p.conversation_id AS id,
                coalesce((SELECT max(created_at) FROM messages m
                          WHERE m.conversation_id = p.conversation_id), c.created_at) AS ts
         FROM participants p
         JOIN conversations c ON c.id = p.conversation_id
         WHERE p.user_id = ?
         ORDER BY ts DESC`,
      )
      .all(viewerId) as { id: string }[]
  ).map((r) => r.id)

  return ids
    .map((id) => describeConversation(id, viewerId))
    .filter((c): c is Conversation => c !== null)
}

/* -------------------------------------------------------------- messages */

export function addMessage(
  conversationId: string,
  senderId: string,
  body: string,
  replyTo: string | null,
): Message {
  const message: Message = {
    id: randomUUID(),
    conversationId,
    senderId,
    body,
    replyTo,
    createdAt: Date.now(),
  }
  db.prepare(
    `INSERT INTO messages (id, conversation_id, sender_id, body, reply_to, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(
    message.id,
    message.conversationId,
    message.senderId,
    message.body,
    message.replyTo,
    message.createdAt,
  )
  return message
}

export function listMessages(conversationId: string, before?: number, limit = 60): Message[] {
  const rows = db
    .prepare(
      `SELECT * FROM messages
       WHERE conversation_id = ? AND created_at < ?
       ORDER BY created_at DESC LIMIT ?`,
    )
    .all(conversationId, before ?? Number.MAX_SAFE_INTEGER, limit) as MessageRow[]
  return rows.reverse().map(toMessage)
}

export function markRead(conversationId: string, userId: string, at: number): number {
  const stamp = Math.min(at, Date.now())
  db.prepare(
    `UPDATE participants SET last_read_at = max(last_read_at, ?)
     WHERE conversation_id = ? AND user_id = ?`,
  ).run(stamp, conversationId, userId)
  return stamp
}

export type SearchHit = { message: Message; conversationId: string; peer: User }

export function searchMessages(viewerId: string, query: string, limit = 12): SearchHit[] {
  const rows = db
    .prepare(
      `SELECT m.* FROM messages m
       JOIN participants p ON p.conversation_id = m.conversation_id AND p.user_id = ?
       WHERE m.body LIKE ?
       ORDER BY m.created_at DESC LIMIT ?`,
    )
    .all(viewerId, `%${query}%`, limit) as MessageRow[]

  return rows.flatMap((row) => {
    const conversation = describeConversation(row.conversation_id, viewerId)
    if (!conversation) return []
    return [{ message: toMessage(row), conversationId: row.conversation_id, peer: conversation.peer }]
  })
}
