import { randomInt, randomUUID } from 'node:crypto'
import bcrypt from 'bcryptjs'
import { db, hasFullTextSearch } from './db.js'
import { attachmentOf, attachmentsOf, eraseFor, type Attachment } from './files.js'

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
  /** A file travelling with the message, if any. */
  attachment: Attachment | null
  /**
   * Where these words came from, when they are not this sender's own. It
   * credits the *first* author, not the person you got it from: forwarding a
   * forward carries the origin along rather than stacking attributions.
   */
  forwarded: { from: Face; at: number } | null
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
  /**
   * When everyone else had read up to. In a group that is the least-read of
   * them, so a single mark means "all of them", never "one of them".
   */
  readAt: number
  /** What this conversation keeps at the top, most recently pinned first. */
  pins: Message[]
  /** What you had started writing here, from whichever device you left it on. */
  draft: string
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
  forwarded_from: string | null
  forwarded_at: number | null
}

const toMessage = (
  r: MessageRow,
  attachment: Attachment | null = null,
  origin: Face | null = null,
): Message => ({
  id: r.id,
  conversationId: r.conversation_id,
  senderId: r.sender_id,
  body: r.body,
  replyTo: r.reply_to,
  createdAt: r.created_at,
  editedAt: r.edited_at,
  deletedAt: r.deleted_at,
  attachment,
  forwarded:
    origin && r.forwarded_at !== null ? { from: origin, at: r.forwarded_at } : null,
})

/** Who a forwarded message credits — nothing at all for a message of one's own. */
function originOf(row: MessageRow): Face | null {
  if (!row.forwarded_from) return null
  const from = findUser(row.forwarded_from)
  return from ? { id: from.id, name: from.name, hue: from.hue } : null
}

/**
 * Fills in the files and the forward origins for a batch, in a query each
 * rather than a query per message.
 */
const withAttachments = (rows: MessageRow[]): Message[] => {
  const files = attachmentsOf(rows.map((r) => r.id))
  const authors = new Map<string, Face>()
  for (const id of new Set(rows.map((r) => r.forwarded_from).filter(Boolean) as string[])) {
    const user = findUser(id)
    if (user) authors.set(id, { id: user.id, name: user.name, hue: user.hue })
  }
  return rows.map((row) =>
    toMessage(
      row,
      files.get(row.id) ?? null,
      row.forwarded_from ? (authors.get(row.forwarded_from) ?? null) : null,
    ),
  )
}

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

/** Deterministic hue so an identity — or a group — always wears the same colour. */
function hueFor(seed: string): number {
  let h = 0
  for (const ch of seed) h = (h * 31 + ch.charCodeAt(0)) % 360
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
  // In a group, a block between two members cannot silence the room; the way
  // out of a group is to leave it.
  if (conversationKind(conversationId) !== 'direct') return false
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
  const now = Date.now()
  db.transaction(() => {
    db.prepare(
      `INSERT INTO conversations (id, created_at, kind, created_by) VALUES (?, ?, 'direct', ?)`,
    ).run(id, now, a)
    const add = db.prepare(
      `INSERT INTO participants (conversation_id, user_id, joined_at) VALUES (?, ?, ?)`,
    )
    // Direct conversations have no history to withhold: joined_at stays 0.
    add.run(id, a, 0)
    if (a !== b) add.run(id, b, 0)
  })()
  return id
}

export type GroupRefusal = 'no-title' | 'nobody' | 'blocked'

/** Starts a group. The people you cannot write to are not people you can gather. */
export function createGroup(
  creatorId: string,
  title: string,
  memberIds: string[],
): { ok: true; id: string } | { ok: false; reason: GroupRefusal } {
  const name = title.trim().slice(0, 60)
  if (!name) return { ok: false, reason: 'no-title' }

  const others = [...new Set(memberIds)].filter((id) => id !== creatorId)
  if (others.length === 0) return { ok: false, reason: 'nobody' }
  if (others.some((id) => isBlocked(creatorId, id))) return { ok: false, reason: 'blocked' }

  const id = randomUUID()
  const now = Date.now()
  db.transaction(() => {
    db.prepare(
      `INSERT INTO conversations (id, created_at, kind, title, created_by)
       VALUES (?, ?, 'group', ?, ?)`,
    ).run(id, now, name, creatorId)
    const add = db.prepare(
      `INSERT INTO participants (conversation_id, user_id, joined_at) VALUES (?, ?, ?)`,
    )
    // Founders see the group from its beginning, which is now anyway.
    for (const member of [creatorId, ...others]) add.run(id, member, 0)
  })()
  return { ok: true, id }
}

export const conversationKind = (id: string): 'direct' | 'group' | null =>
  (db.prepare(`SELECT kind FROM conversations WHERE id = ?`).get(id) as
    | { kind: 'direct' | 'group' }
    | undefined)?.kind ?? null

export type MemberRefusal = 'not-a-group' | 'unknown' | 'already' | 'blocked' | 'not-yours'

/** Adds someone, from now on: they do not inherit what was said before. */
export function addMember(
  conversationId: string,
  actorId: string,
  memberId: string,
): { ok: true } | { ok: false; reason: MemberRefusal } {
  if (conversationKind(conversationId) !== 'group') return { ok: false, reason: 'not-a-group' }
  if (!isParticipant(conversationId, actorId)) return { ok: false, reason: 'not-yours' }
  if (isParticipant(conversationId, memberId)) return { ok: false, reason: 'already' }
  if (!findUser(memberId)) return { ok: false, reason: 'unknown' }
  if (isBlocked(actorId, memberId)) return { ok: false, reason: 'blocked' }

  db.prepare(
    `INSERT INTO participants (conversation_id, user_id, joined_at) VALUES (?, ?, ?)`,
  ).run(conversationId, memberId, Date.now())
  return { ok: true }
}

/** Leaving, or being removed. The last one out takes the conversation with them. */
export function removeMember(conversationId: string, memberId: string): boolean {
  if (conversationKind(conversationId) !== 'group') return false
  const result = db
    .prepare(`DELETE FROM participants WHERE conversation_id = ? AND user_id = ?`)
    .run(conversationId, memberId)
  if (result.changes === 0) return false

  const left = db
    .prepare(`SELECT count(*) AS n FROM participants WHERE conversation_id = ?`)
    .get(conversationId) as { n: number }
  if (left.n === 0) db.prepare(`DELETE FROM conversations WHERE id = ?`).run(conversationId)
  return true
}

export function renameConversation(conversationId: string, title: string): string | null {
  if (conversationKind(conversationId) !== 'group') return null
  const name = title.trim().slice(0, 60)
  if (!name) return null
  db.prepare(`UPDATE conversations SET title = ? WHERE id = ?`).run(name, conversationId)
  return name
}

/** When this person started being able to read the conversation. */
export const joinedAt = (conversationId: string, userId: string): number =>
  (db
    .prepare(`SELECT joined_at AS j FROM participants WHERE conversation_id = ? AND user_id = ?`)
    .get(conversationId, userId) as { j: number } | undefined)?.j ?? 0

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
  const row = db.prepare(`SELECT kind, title FROM conversations WHERE id = ?`).get(id) as
    | { kind: 'direct' | 'group'; title: string | null }
    | undefined
  if (!row) return null

  const members = db
    .prepare(
      `SELECT u.id, u.handle, u.name, u.hue
       FROM participants p JOIN users u ON u.id = p.user_id
       WHERE p.conversation_id = ? AND p.user_id != ?
       ORDER BY u.name COLLATE NOCASE`,
    )
    .all(id, viewerId) as User[]

  const self = findUser(viewerId)
  if (!self) return null

  // A conversation with only you in it is legitimate — it is your own notepad.
  const face: Face =
    row.kind === 'group'
      ? { id, name: row.title ?? 'groupe', hue: hueFor(id) }
      : (members[0] ?? self)

  const mine = db
    .prepare(
      `SELECT last_read_at, joined_at, draft FROM participants
       WHERE conversation_id = ? AND user_id = ?`,
    )
    .get(id, viewerId) as
    | { last_read_at: number; joined_at: number; draft: string }
    | undefined
  const since = mine?.joined_at ?? 0

  const last = db
    .prepare(
      `SELECT * FROM messages WHERE conversation_id = ? AND created_at >= ?
       ORDER BY created_at DESC LIMIT 1`,
    )
    .get(id, since) as MessageRow | undefined

  // One mark for the whole room: the least-read of them, so it never says
  // "read" while somebody has not.
  const others = db
    .prepare(
      `SELECT min(last_read_at) AS at FROM participants
       WHERE conversation_id = ? AND user_id != ?`,
    )
    .get(id, viewerId) as { at: number | null }

  const unread = db
    .prepare(
      `SELECT count(*) AS n FROM messages
       WHERE conversation_id = ? AND sender_id != ? AND created_at > ?
         AND created_at >= ? AND deleted_at IS NULL`,
    )
    .get(id, viewerId, mine?.last_read_at ?? 0, since) as { n: number }

  return {
    id,
    kind: row.kind,
    face: { id: face.id, name: face.name, hue: face.hue },
    members,
    lastMessage: last ? toMessage(last, attachmentOf(last.id), originOf(last)) : null,
    unread: unread.n,
    readAt: others.at ?? mine?.last_read_at ?? 0,
    pins: listPins(id, viewerId),
    draft: mine?.draft ?? '',
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
  attachment: Attachment | null = null,
  forwarded: { from: Face; at: number } | null = null,
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
    attachment,
    forwarded,
  }
  db.prepare(
    `INSERT INTO messages
       (id, conversation_id, sender_id, body, reply_to, created_at, forwarded_from, forwarded_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    message.id,
    message.conversationId,
    message.senderId,
    message.body,
    message.replyTo,
    message.createdAt,
    forwarded?.from.id ?? null,
    forwarded?.at ?? null,
  )
  return message
}

/** Just the conversation a message belongs to — used to guard its file. */
export function findMessageConversation(id: string): string | null {
  const row = db.prepare(`SELECT conversation_id AS c FROM messages WHERE id = ?`).get(id) as
    | { c: string }
    | undefined
  return row?.c ?? null
}

export function findMessage(id: string): Message | undefined {
  const row = db.prepare(`SELECT * FROM messages WHERE id = ?`).get(id) as MessageRow | undefined
  return row ? toMessage(row, attachmentOf(id), originOf(row)) : undefined
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
  // A message carrying a file may legitimately have nothing written on it.
  if (!text && !existing.attachment) return { ok: false, reason: 'empty' }
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
  // Taking a message back has to take its file with it, off the disk — and
  // leave nothing pinned at the top of the conversation pointing at a hole.
  db.prepare(`DELETE FROM pins WHERE message_id = ?`).run(id)
  eraseFor(id)
  return { ok: true, message: { ...existing, body: '', deletedAt, attachment: null } }
}

export function listMessages(
  conversationId: string,
  viewerId: string,
  before?: number,
  limit = 60,
): Message[] {
  const rows = db
    .prepare(
      `SELECT * FROM messages
       WHERE conversation_id = ? AND created_at < ? AND created_at >= ?
       ORDER BY created_at DESC LIMIT ?`,
    )
    .all(
      conversationId,
      before ?? Number.MAX_SAFE_INTEGER,
      joinedAt(conversationId, viewerId),
      limit,
    ) as MessageRow[]
  return withAttachments(rows.reverse())
}

/* ------------------------------------------------------------ forwarding */

export type ForwardRefusal =
  | 'missing'
  | 'not-yours'
  | 'retracted'
  | 'nowhere'
  | 'closed'
  | 'empty'

/**
 * Sends someone else's words on to another conversation.
 *
 * Two rules make this safe. You must be able to *read* the source — being a
 * participant is not enough, since a group withholds what was said before you
 * joined — and you must be able to *write* to the target, which is where
 * blocking is enforced. A file travels as a copy of its bytes rather than as a
 * second reference: two messages that share one file would take each other
 * down when either is retracted.
 */
export function forwardMessage(
  messageId: string,
  targetConversationId: string,
  userId: string,
  copyFile: (attachmentId: string, uploaderId: string) => Attachment | null,
): { ok: true; message: Message } | { ok: false; reason: ForwardRefusal } {
  const row = db.prepare(`SELECT * FROM messages WHERE id = ?`).get(messageId) as
    | MessageRow
    | undefined
  if (!row) return { ok: false, reason: 'missing' }
  if (row.deleted_at) return { ok: false, reason: 'retracted' }

  if (!isParticipant(row.conversation_id, userId)) return { ok: false, reason: 'not-yours' }
  if (row.created_at < joinedAt(row.conversation_id, userId)) {
    return { ok: false, reason: 'not-yours' }
  }
  if (!isParticipant(targetConversationId, userId)) return { ok: false, reason: 'nowhere' }
  if (blockedInConversation(targetConversationId, userId)) return { ok: false, reason: 'closed' }

  const source = attachmentOf(messageId)
  if (!row.body && !source) return { ok: false, reason: 'empty' }

  // A chain of forwards credits whoever said it first, not the last relay.
  const originId = row.forwarded_from ?? row.sender_id
  const origin = findUser(originId)
  const forwarded = origin
    ? { from: { id: origin.id, name: origin.name, hue: origin.hue }, at: row.forwarded_at ?? row.created_at }
    : null

  const message = addMessage(targetConversationId, userId, row.body, null, null, forwarded)
  const carried = source ? copyFile(source.id, userId) : null
  return { ok: true, message: { ...message, attachment: carried } }
}

/* ------------------------------------------------------------------ pins */

/** More than this at the top of a conversation is a list, not a pin. */
export const MAX_PINS = 20

export type PinRefusal = 'missing' | 'not-yours' | 'retracted' | 'too-many'

export function pinMessage(
  conversationId: string,
  messageId: string,
  userId: string,
): { ok: true } | { ok: false; reason: PinRefusal } {
  if (!isParticipant(conversationId, userId)) return { ok: false, reason: 'not-yours' }

  const row = db
    .prepare(`SELECT * FROM messages WHERE id = ? AND conversation_id = ?`)
    .get(messageId, conversationId) as MessageRow | undefined
  if (!row) return { ok: false, reason: 'missing' }
  if (row.deleted_at) return { ok: false, reason: 'retracted' }
  // You cannot pin what you are not allowed to have read.
  if (row.created_at < joinedAt(conversationId, userId)) return { ok: false, reason: 'missing' }

  const already = db
    .prepare(`SELECT count(*) AS n FROM pins WHERE conversation_id = ?`)
    .get(conversationId) as { n: number }
  const pinned = db
    .prepare(`SELECT 1 FROM pins WHERE conversation_id = ? AND message_id = ?`)
    .get(conversationId, messageId)
  if (!pinned && already.n >= MAX_PINS) return { ok: false, reason: 'too-many' }

  db.prepare(
    `INSERT OR IGNORE INTO pins (conversation_id, message_id, pinned_by, pinned_at)
     VALUES (?, ?, ?, ?)`,
  ).run(conversationId, messageId, userId, Date.now())
  return { ok: true }
}

/** Anyone in the conversation can take a pin down — there are no roles here. */
export function unpinMessage(
  conversationId: string,
  messageId: string,
  userId: string,
): { ok: true } | { ok: false; reason: PinRefusal } {
  if (!isParticipant(conversationId, userId)) return { ok: false, reason: 'not-yours' }
  db.prepare(`DELETE FROM pins WHERE conversation_id = ? AND message_id = ?`).run(
    conversationId,
    messageId,
  )
  return { ok: true }
}

/**
 * The pins, most recent first, and only the ones the viewer could have read.
 * Someone added to a group yesterday does not inherit its history — pins
 * included, or a pin would be a way around that rule.
 */
export function listPins(conversationId: string, viewerId: string): Message[] {
  const rows = db
    .prepare(
      `SELECT m.* FROM pins p
       JOIN messages m ON m.id = p.message_id
       WHERE p.conversation_id = ? AND m.deleted_at IS NULL AND m.created_at >= ?
       ORDER BY p.pinned_at DESC`,
    )
    .all(conversationId, joinedAt(conversationId, viewerId)) as MessageRow[]
  return withAttachments(rows)
}

/* ---------------------------------------------------------------- drafts */

/**
 * What someone had started writing, kept so the other device finds it. It is
 * per person and per conversation, which is exactly what a participant row is
 * — no second table, and it disappears with the conversation.
 */
export function saveDraft(conversationId: string, userId: string, body: string): number {
  const text = body.slice(0, 4000)
  const at = Date.now()
  db.prepare(
    `UPDATE participants SET draft = ?, draft_at = ?
     WHERE conversation_id = ? AND user_id = ?`,
  ).run(text, at, conversationId, userId)
  return at
}

export const draftOf = (conversationId: string, userId: string): string =>
  (db
    .prepare(`SELECT draft FROM participants WHERE conversation_id = ? AND user_id = ?`)
    .get(conversationId, userId) as { draft: string } | undefined)?.draft ?? ''

export function markRead(conversationId: string, userId: string, at: number): number {
  const stamp = Math.min(at, Date.now())
  db.prepare(
    `UPDATE participants SET last_read_at = max(last_read_at, ?)
     WHERE conversation_id = ? AND user_id = ?`,
  ).run(stamp, conversationId, userId)
  return stamp
}

export type SearchHit = { message: Message; conversationId: string; face: Face }

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
      {
        message: toMessage(row, attachmentOf(row.id), originOf(row)),
        conversationId: row.conversation_id,
        face: conversation.face,
      },
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
         WHERE messages_fts MATCH ? AND m.deleted_at IS NULL AND m.created_at >= p.joined_at
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
       WHERE m.body LIKE '%' || ? || '%' AND m.deleted_at IS NULL AND m.created_at >= p.joined_at
       ORDER BY m.created_at DESC LIMIT ?`,
    )
    .all(viewerId, query, limit) as MessageRow[]
}
