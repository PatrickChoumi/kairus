import { randomInt, randomUUID } from 'node:crypto'
import bcrypt from 'bcryptjs'
import { db, hasFullTextSearch } from './db.js'

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
  editedAt: number | null
  deletedAt: number | null
}

export type Conversation = {
  id: string
  peer: User
  lastMessage: Message | null
  unread: number
  peerReadAt: number
}

type UserRow = User & {
  password_hash: string
  recovery_hash: string
  token_version: number
  created_at: number
}

type MessageRow = {
  id: string
  conversation_id: string
  sender_id: string
  body: string
  reply_to: string | null
  created_at: number
  edited_at: number | null
  deleted_at: number | null
}

const toMessage = (r: MessageRow): Message => ({
  id: r.id,
  conversationId: r.conversation_id,
  senderId: r.sender_id,
  body: r.body,
  replyTo: r.reply_to,
  createdAt: r.created_at,
  editedAt: r.edited_at,
  deletedAt: r.deleted_at,
})

/** The shape of a user that is safe to hand to anyone. */
export const publicUser = (r: UserRow): User => ({
  id: r.id,
  handle: r.handle,
  name: r.name,
  hue: r.hue,
})

const BCRYPT_COST = 10

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

/**
 * The phrase that can take an account back. Kairus has no email and no phone,
 * so this is the only way in after a forgotten passphrase — it is shown once,
 * at the moment it is created, and never again.
 */
const ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789' // no look-alike characters
export function mintRecoveryPhrase(): string {
  const groups: string[] = []
  for (let g = 0; g < 4; g += 1) {
    let group = ''
    for (let i = 0; i < 5; i += 1) group += ALPHABET[randomInt(ALPHABET.length)]
    groups.push(group)
  }
  return groups.join('-')
}

/** Recovery phrases are compared case- and separator-insensitively. */
const normalisePhrase = (phrase: string) => phrase.toLowerCase().replace(/[^a-z0-9]/g, '')

export async function createUser(
  handle: string,
  name: string,
  password: string,
): Promise<{ user: User; recoveryPhrase: string }> {
  const recoveryPhrase = mintRecoveryPhrase()
  const row = {
    id: randomUUID(),
    handle,
    name: name.trim() || handle,
    password_hash: await bcrypt.hash(password, BCRYPT_COST),
    recovery_hash: await bcrypt.hash(normalisePhrase(recoveryPhrase), BCRYPT_COST),
    hue: hueFor(handle),
    created_at: Date.now(),
  }
  db.prepare(
    `INSERT INTO users (id, handle, name, password_hash, recovery_hash, hue, created_at)
     VALUES (@id, @handle, @name, @password_hash, @recovery_hash, @hue, @created_at)`,
  ).run(row)
  return {
    user: { id: row.id, handle: row.handle, name: row.name, hue: row.hue },
    recoveryPhrase,
  }
}

export function findUserByHandle(handle: string): UserRow | undefined {
  return db.prepare(`SELECT * FROM users WHERE handle = ?`).get(handle) as UserRow | undefined
}

/** The full row, hashes included — for the handful of places that need them. */
export function findUserRow(id: string): UserRow | undefined {
  return db.prepare(`SELECT * FROM users WHERE id = ?`).get(id) as UserRow | undefined
}

export function findUser(id: string): User | undefined {
  return db.prepare(`SELECT id, handle, name, hue FROM users WHERE id = ?`).get(id) as
    | User
    | undefined
}

/**
 * The identity behind a token, but only while the token is still current.
 * A passphrase change bumps `token_version`, which is what makes every session
 * issued before it stop working.
 */
export function findLiveIdentity(id: string, tokenVersion: number): User | undefined {
  const row = db
    .prepare(`SELECT id, handle, name, hue, token_version FROM users WHERE id = ?`)
    .get(id) as (User & { token_version: number }) | undefined
  if (!row || row.token_version !== tokenVersion) return undefined
  return { id: row.id, handle: row.handle, name: row.name, hue: row.hue }
}

export const tokenVersionOf = (id: string): number =>
  (db.prepare(`SELECT token_version AS v FROM users WHERE id = ?`).get(id) as
    | { v: number }
    | undefined)?.v ?? 0

export const verifyPassword = (row: UserRow, password: string): Promise<boolean> =>
  bcrypt.compare(password, row.password_hash)

export const verifyRecoveryPhrase = (row: UserRow, phrase: string): Promise<boolean> =>
  row.recovery_hash ? bcrypt.compare(normalisePhrase(phrase), row.recovery_hash) : Promise.resolve(false)

/** Sets a new passphrase and ends every session that was open. */
export async function replacePassword(id: string, password: string): Promise<number> {
  const hash = await bcrypt.hash(password, BCRYPT_COST)
  db.prepare(
    `UPDATE users SET password_hash = ?, token_version = token_version + 1 WHERE id = ?`,
  ).run(hash, id)
  return tokenVersionOf(id)
}

/** Issues a fresh recovery phrase, retiring the previous one. */
export async function replaceRecoveryPhrase(id: string): Promise<string> {
  const phrase = mintRecoveryPhrase()
  const hash = await bcrypt.hash(normalisePhrase(phrase), BCRYPT_COST)
  db.prepare(`UPDATE users SET recovery_hash = ? WHERE id = ?`).run(hash, id)
  return phrase
}

/** Ends every session without touching the passphrase. */
export function revokeSessions(id: string): number {
  db.prepare(`UPDATE users SET token_version = token_version + 1 WHERE id = ?`).run(id)
  return tokenVersionOf(id)
}

/**
 * Finding people.
 *
 * There is deliberately no browsable directory. Among people you already have
 * a conversation with, search is loose — you are looking for someone you know.
 * Beyond that circle, only an **exact** handle resolves: someone has to have
 * given it to you. Typing three letters must not enumerate strangers, because
 * an enumerable directory plus an open inbox is a harassment tool.
 *
 * Anyone on either side of a block is invisible in both directions.
 */
export function searchUsers(query: string, viewerId: string, limit = 8): User[] {
  const term = query.trim()
  if (!term) return []

  const known = db
    .prepare(
      `SELECT DISTINCT u.id, u.handle, u.name, u.hue
       FROM participants mine
       JOIN participants theirs ON theirs.conversation_id = mine.conversation_id
       JOIN users u ON u.id = theirs.user_id
       WHERE mine.user_id = ?
         AND u.id != ?
         AND (u.handle LIKE ? || '%' OR u.name LIKE '%' || ? || '%')
         AND NOT EXISTS (SELECT 1 FROM blocks b
                         WHERE (b.blocker_id = ? AND b.blocked_id = u.id)
                            OR (b.blocker_id = u.id AND b.blocked_id = ?))
       ORDER BY length(u.handle) ASC LIMIT ?`,
    )
    .all(viewerId, viewerId, term, term, viewerId, viewerId, limit) as User[]

  if (known.length >= limit || !isHandle(term.toLowerCase())) return known

  const stranger = db
    .prepare(
      `SELECT id, handle, name, hue FROM users u
       WHERE u.handle = ? AND u.id != ?
         AND NOT EXISTS (SELECT 1 FROM blocks b
                         WHERE (b.blocker_id = ? AND b.blocked_id = u.id)
                            OR (b.blocker_id = u.id AND b.blocked_id = ?))`,
    )
    .get(term.toLowerCase(), viewerId, viewerId, viewerId) as User | undefined

  if (!stranger || known.some((u) => u.id === stranger.id)) return known
  return [...known, stranger]
}

/* ----------------------------------------------------------------- blocks */

/** True when either person has blocked the other. */
export function isBlocked(a: string, b: string): boolean {
  return !!db
    .prepare(
      `SELECT 1 FROM blocks
       WHERE (blocker_id = ? AND blocked_id = ?) OR (blocker_id = ? AND blocked_id = ?)`,
    )
    .get(a, b, b, a)
}

export function blockUser(blockerId: string, blockedId: string): void {
  if (blockerId === blockedId) return
  db.prepare(
    `INSERT OR IGNORE INTO blocks (blocker_id, blocked_id, created_at) VALUES (?, ?, ?)`,
  ).run(blockerId, blockedId, Date.now())
}

export function unblockUser(blockerId: string, blockedId: string): void {
  db.prepare(`DELETE FROM blocks WHERE blocker_id = ? AND blocked_id = ?`).run(
    blockerId,
    blockedId,
  )
}

export function listBlocked(blockerId: string): User[] {
  return db
    .prepare(
      `SELECT u.id, u.handle, u.name, u.hue FROM blocks b
       JOIN users u ON u.id = b.blocked_id
       WHERE b.blocker_id = ? ORDER BY b.created_at DESC`,
    )
    .all(blockerId) as User[]
}

/**
 * True when a block stands between any two participants of a conversation.
 * Checked on every send: blocking has to close an existing thread, not merely
 * prevent a new one from being opened.
 */
export function blockedInConversation(conversationId: string, userId: string): boolean {
  return !!db
    .prepare(
      `SELECT 1 FROM participants p
       JOIN blocks b ON (b.blocker_id = ? AND b.blocked_id = p.user_id)
                     OR (b.blocked_id = ? AND b.blocker_id = p.user_id)
       WHERE p.conversation_id = ? AND p.user_id != ?`,
    )
    .get(userId, userId, conversationId, userId)
}

/** The people on the other side of this viewer's conversations that are blocked. */
export function blockedPeerIds(viewerId: string): string[] {
  return (
    db
      .prepare(
        `SELECT blocked_id AS id FROM blocks WHERE blocker_id = ?
         UNION SELECT blocker_id AS id FROM blocks WHERE blocked_id = ?`,
      )
      .all(viewerId, viewerId) as { id: string }[]
  ).map((r) => r.id)
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
       WHERE conversation_id = ? AND sender_id != ? AND created_at > ? AND deleted_at IS NULL`,
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
    editedAt: null,
    deletedAt: null,
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

export function findMessage(id: string): Message | undefined {
  const row = db.prepare(`SELECT * FROM messages WHERE id = ?`).get(id) as MessageRow | undefined
  return row ? toMessage(row) : undefined
}

export type Revision = { ok: true; message: Message } | { ok: false; reason: RevisionRefusal }
export type RevisionRefusal = 'missing' | 'not-yours' | 'retracted' | 'empty'

/** Rewrites your own message. Someone else's is never yours to rewrite. */
export function reviseMessage(id: string, userId: string, body: string): Revision {
  const existing = findMessage(id)
  if (!existing) return { ok: false, reason: 'missing' }
  if (existing.senderId !== userId) return { ok: false, reason: 'not-yours' }
  if (existing.deletedAt) return { ok: false, reason: 'retracted' }
  const text = body.trim()
  if (!text) return { ok: false, reason: 'empty' }
  if (text === existing.body) return { ok: true, message: existing }

  const editedAt = Date.now()
  db.prepare(`UPDATE messages SET body = ?, edited_at = ? WHERE id = ?`).run(text, editedAt, id)
  return { ok: true, message: { ...existing, body: text, editedAt } }
}

/**
 * Takes a message back. The row survives with an empty body so that anything
 * quoting it still resolves, and so both sides see the same hole.
 */
export function retractMessage(id: string, userId: string): Revision {
  const existing = findMessage(id)
  if (!existing) return { ok: false, reason: 'missing' }
  if (existing.senderId !== userId) return { ok: false, reason: 'not-yours' }
  if (existing.deletedAt) return { ok: true, message: existing }

  const deletedAt = Date.now()
  db.prepare(`UPDATE messages SET body = '', deleted_at = ? WHERE id = ?`).run(deletedAt, id)
  return { ok: true, message: { ...existing, body: '', deletedAt } }
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

/**
 * Turns what someone typed into an FTS5 query. Every term is quoted, so
 * operators and punctuation the user typed are treated as text rather than as
 * syntax; the last term gets a prefix star, because people search as they type.
 */
function toMatchQuery(query: string): string | null {
  const terms = query
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean)
    .slice(0, 8)
  if (terms.length === 0) return null
  return terms
    .map((term, index) => {
      const quoted = `"${term.replace(/"/g, '""')}"`
      return index === terms.length - 1 ? `${quoted}*` : quoted
    })
    .join(' AND ')
}

export function searchMessages(viewerId: string, query: string, limit = 12): SearchHit[] {
  const rows = hasFullTextSearch
    ? searchIndexed(viewerId, query, limit)
    : searchByScan(viewerId, query, limit)

  return rows.flatMap((row) => {
    const conversation = describeConversation(row.conversation_id, viewerId)
    if (!conversation) return []
    return [
      { message: toMessage(row), conversationId: row.conversation_id, peer: conversation.peer },
    ]
  })
}

function searchIndexed(viewerId: string, query: string, limit: number): MessageRow[] {
  const match = toMatchQuery(query)
  if (!match) return []
  try {
    return db
      .prepare(
        `SELECT m.* FROM messages_fts f
         JOIN messages m ON m.rowid = f.rowid
         JOIN participants p ON p.conversation_id = m.conversation_id AND p.user_id = ?
         WHERE messages_fts MATCH ? AND m.deleted_at IS NULL
         ORDER BY m.created_at DESC LIMIT ?`,
      )
      .all(viewerId, match, limit) as MessageRow[]
  } catch {
    // A malformed match expression must not take the endpoint down with it.
    return []
  }
}

function searchByScan(viewerId: string, query: string, limit: number): MessageRow[] {
  return db
    .prepare(
      `SELECT m.* FROM messages m
       JOIN participants p ON p.conversation_id = m.conversation_id AND p.user_id = ?
       WHERE m.body LIKE '%' || ? || '%' AND m.deleted_at IS NULL
       ORDER BY m.created_at DESC LIMIT ?`,
    )
    .all(viewerId, query, limit) as MessageRow[]
}
