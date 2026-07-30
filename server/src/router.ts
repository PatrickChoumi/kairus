import type { IncomingMessage, ServerResponse } from 'node:http'
import { env } from './env.js'
import { applySecurityHeaders } from './headers.js'
import { limits } from './limiter.js'
import {
  addMember,
  addMessage,
  blockedInConversation,
  blockUser,
  conversationKind,
  createGroup,
  createUser,
  describeConversation,
  findLiveIdentity,
  findUserByHandle,
  findMessageConversation,
  findUserRow,
  isBlocked,
  isHandle,
  isParticipant,
  listBlocked,
  participantIds,
  listConversations,
  listMessages,
  markRead,
  openConversation,
  publicUser,
  removeMember,
  renameConversation,
  replacePassword,
  replaceRecoveryPhrase,
  retractMessage,
  reviseMessage,
  revokeSessions,
  searchMessages,
  searchUsers,
  tokenVersionOf,
  unblockUser,
  verifyPassword,
  verifyRecoveryPhrase,
  type Revision,
} from './model.js'
import { shouldRenew, sign, verify } from './token.js'
import { hub } from './realtime.js'
import {
  forgetSubscription,
  pushEnabled,
  pushPublicKey,
  saveSubscription,
  subscriptionCount,
} from './push.js'
import { asPrometheus, count, log, snapshot } from './log.js'
import {
  attachmentOf,
  claim,
  findAttachment,
  isDisplayable,
  MAX_BYTES,
  openAttachment,
  receive,
  servingHeaders,
  tamePeaks,
  TooLarge,
} from './files.js'

export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
    /** Seconds to wait, for the 429 case. */
    readonly retryAfter?: number,
  ) {
    super(message)
  }
}

type Ctx = {
  url: URL
  body: unknown
  userId: string
  /** Set when this request's token is old enough to be swapped out. */
  renewedToken?: string
  /** Who is calling, for the limits that key on the caller rather than the account. */
  address: string
}

const json = (res: ServerResponse, status: number, payload: unknown) => {
  const data = JSON.stringify(payload)
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(data),
  })
  res.end(data)
}

/* -------------------------------------------------------------------- cors */

const sameOrigin = (req: IncomingMessage, origin: string): boolean => {
  try {
    return new URL(origin).host === req.headers.host
  } catch {
    return false
  }
}

/**
 * With no allow-list configured, only the origin serving the app is accepted.
 * Reflecting whatever arrives would be a quietly permissive default, and the
 * single-container deployment never needs it.
 */
function applyCors(req: IncomingMessage, res: ServerResponse): void {
  const origin = req.headers.origin
  if (!origin) return
  const allowed = env.origins.length > 0 ? env.origins.includes(origin) : sameOrigin(req, origin)
  if (!allowed) return
  res.setHeader('access-control-allow-origin', origin)
  res.setHeader('vary', 'origin')
  res.setHeader('access-control-allow-headers', 'content-type, authorization')
  res.setHeader('access-control-allow-methods', 'GET, POST, OPTIONS')
  res.setHeader('access-control-max-age', '86400')
}

/* ---------------------------------------------------------------- callers */

/**
 * The caller's address. `X-Forwarded-For` is only consulted when TRUST_PROXY
 * says how many proxies are in front of us — otherwise anyone could forge a
 * header and get a fresh rate-limit budget on every request.
 */
export function addressOf(req: IncomingMessage): string {
  if (env.trustProxy > 0) {
    const chain = String(req.headers['x-forwarded-for'] ?? '')
      .split(',')
      .map((part) => part.trim())
      .filter(Boolean)
    // Our proxy appended the last entry, the one before it appended the previous.
    const hop = chain[chain.length - env.trustProxy]
    if (hop) return hop
  }
  return req.socket.remoteAddress ?? 'unknown'
}

const spend = (limiter: { take(key: string, cost?: number): number }, key: string, message: string) => {
  const wait = limiter.take(key)
  if (wait > 0) throw new HttpError(429, message, wait)
}

/* ----------------------------------------------------------------- bodies */

async function readBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of req) {
    size += chunk.length
    if (size > 64 * 1024) throw new HttpError(413, 'requête trop volumineuse')
    chunks.push(chunk as Buffer)
  }
  if (chunks.length === 0) return {}
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'))
  } catch {
    throw new HttpError(400, 'requête illisible')
  }
}

const field = (body: unknown, key: string): string => {
  const value = (body as Record<string, unknown> | null)?.[key]
  return typeof value === 'string' ? value.trim() : ''
}

const PASSPHRASE_MIN = 8
const requirePassphrase = (value: string): string => {
  if (value.length < PASSPHRASE_MIN) {
    throw new HttpError(400, 'une phrase secrète fait au moins 8 caractères')
  }
  return value
}

const refusals: Record<string, [number, string]> = {
  missing: [404, 'ce message n’existe plus'],
  'not-yours': [403, 'ce message n’est pas le vôtre'],
  retracted: [409, 'ce message a été retiré'],
  empty: [400, 'un message ne peut pas être vide'],
}

const unwrap = (revision: Revision) => {
  if (revision.ok) return revision.message
  const [status, message] = refusals[revision.reason] ?? [400, 'impossible']
  throw new HttpError(status, message)
}

/* ------------------------------------------------------------------ routes */

type Handler = (ctx: Ctx) => unknown | Promise<unknown>

const authed: Record<string, Handler> = {
  'GET /api/me': ({ userId, renewedToken }) => ({
    user: findLiveIdentity(userId, tokenVersionOf(userId)),
    // Present only when the token was getting old. The client swaps it in.
    ...(renewedToken ? { token: renewedToken } : {}),
  }),

  'GET /api/conversations': ({ userId }) => ({ conversations: listConversations(userId) }),

  'POST /api/conversations': ({ userId, body }) => {
    spend(limits.open, userId, 'trop de conversations ouvertes d’un coup')
    const handle = field(body, 'handle').toLowerCase()
    if (!isHandle(handle)) throw new HttpError(400, 'ce nom d’usage n’est pas valide')
    const peer = findUserByHandle(handle)
    // A blocked person is told the same thing as a non-existent one: revealing
    // the difference would tell a harasser that their target is still there.
    if (!peer || isBlocked(userId, peer.id)) {
      throw new HttpError(404, 'personne ne porte ce nom')
    }
    const id = openConversation(userId, peer.id)
    const conversation = describeConversation(id, userId)
    if (!conversation) throw new HttpError(500, 'impossible d’ouvrir la conversation')
    if (peer.id !== userId) {
      // The other side learns about the new thread immediately.
      const forPeer = describeConversation(id, peer.id)
      if (forPeer) hub.toUser(peer.id, { t: 'conversation', conversation: forPeer })
      // Neither side was watching the other before this moment, so presence
      // has to be exchanged now rather than waiting for the next connection.
      hub.toUser(userId, { t: 'presence', userId: peer.id, online: hub.isOnline(peer.id) })
      hub.toUser(peer.id, { t: 'presence', userId, online: hub.isOnline(userId) })
    }
    return { conversation }
  },

  'GET /api/messages': ({ userId, url }) => {
    const id = url.searchParams.get('conversation') ?? ''
    if (!isParticipant(id, userId)) throw new HttpError(404, 'cette conversation n’existe pas')
    const beforeRaw = Number(url.searchParams.get('before'))
    const before = Number.isFinite(beforeRaw) && beforeRaw > 0 ? beforeRaw : undefined
    return { messages: listMessages(id, userId, before) }
  },

  'POST /api/messages': ({ userId, body }) => {
    spend(limits.write, userId, 'vous écrivez plus vite que nous ne pouvons suivre')
    const conversationId = field(body, 'conversation')
    const text = field(body, 'body')
    if (!isParticipant(conversationId, userId)) {
      throw new HttpError(404, 'cette conversation n’existe pas')
    }
    const attachmentId = field(body, 'attachment')
    if (!text && !attachmentId) throw new HttpError(400, 'message vide')
    if (blockedInConversation(conversationId, userId)) {
      throw new HttpError(403, 'cette conversation est fermée')
    }
    const replyTo = field(body, 'replyTo') || null
    const message = addMessage(conversationId, userId, text.slice(0, 4000), replyTo)
    if (attachmentId && !claim(attachmentId, userId, message.id)) {
      throw new HttpError(404, 'ce fichier n’est plus disponible')
    }
    const carried = attachmentId ? { ...message, attachment: attachmentOf(message.id) } : message
    hub.broadcastMessage(carried)
    return { message: carried }
  },

  'POST /api/messages/revise': ({ userId, body }) => {
    spend(limits.write, userId, 'trop de corrections d’un coup')
    const message = unwrap(
      reviseMessage(field(body, 'message'), userId, field(body, 'body').slice(0, 4000)),
    )
    hub.broadcastRevision(message)
    return { message }
  },

  'POST /api/messages/retract': ({ userId, body }) => {
    spend(limits.write, userId, 'trop de retraits d’un coup')
    const message = unwrap(retractMessage(field(body, 'message'), userId))
    hub.broadcastRevision(message)
    return { message }
  },

  'POST /api/read': ({ userId, body }) => {
    const conversationId = field(body, 'conversation')
    if (!isParticipant(conversationId, userId)) {
      throw new HttpError(404, 'cette conversation n’existe pas')
    }
    const at = markRead(conversationId, userId, Date.now())
    hub.broadcastRead(conversationId, userId, at)
    return { at }
  },

  'GET /api/people': ({ userId, url }) => {
    spend(limits.look, userId, 'trop de recherches d’un coup')
    const q = (url.searchParams.get('q') ?? '').trim()
    return { people: q ? searchUsers(q, userId) : [] }
  },

  'GET /api/search': ({ userId, url }) => {
    spend(limits.look, userId, 'trop de recherches d’un coup')
    const q = (url.searchParams.get('q') ?? '').trim()
    return { hits: q.length >= 2 ? searchMessages(userId, q) : [] }
  },

  /* -- groups ------------------------------------------------------------- */

  'POST /api/groups': ({ userId, body }) => {
    spend(limits.open, userId, 'trop de conversations ouvertes d’un coup')
    const title = field(body, 'title')
    const handles = Array.isArray((body as { handles?: unknown }).handles)
      ? ((body as { handles: unknown[] }).handles.filter((h) => typeof h === 'string') as string[])
      : []

    const members: string[] = []
    for (const handle of handles.slice(0, 50)) {
      const person = findUserByHandle(handle.toLowerCase().trim())
      if (!person) throw new HttpError(404, `personne ne porte le nom @${handle}`)
      members.push(person.id)
    }

    const made = createGroup(userId, title, members)
    if (!made.ok) {
      const said: Record<string, [number, string]> = {
        'no-title': [400, 'un groupe a besoin d’un nom'],
        nobody: [400, 'un groupe a besoin de quelqu’un d’autre'],
        blocked: [403, 'vous avez bloqué l’une de ces personnes'],
      }
      const [status, message] = said[made.reason] ?? [400, 'impossible']
      throw new HttpError(status, message)
    }

    announceConversation(made.id, userId)
    const conversation = describeConversation(made.id, userId)
    if (!conversation) throw new HttpError(500, 'impossible de créer le groupe')
    return { conversation }
  },

  'POST /api/groups/members': ({ userId, body }) => {
    const conversationId = field(body, 'conversation')
    const handle = field(body, 'handle').toLowerCase()
    const person = isHandle(handle) ? findUserByHandle(handle) : undefined
    if (!person) throw new HttpError(404, 'personne ne porte ce nom')

    const added = addMember(conversationId, userId, person.id)
    if (!added.ok) {
      const said: Record<string, [number, string]> = {
        'not-a-group': [400, 'ce n’est pas un groupe'],
        'not-yours': [404, 'cette conversation n’existe pas'],
        already: [409, 'cette personne est déjà là'],
        unknown: [404, 'personne ne porte ce nom'],
        blocked: [403, 'vous avez bloqué cette personne'],
      }
      const [status, message] = said[added.reason] ?? [400, 'impossible']
      throw new HttpError(status, message)
    }
    announceConversation(conversationId, null)
    return { member: publicUser(person) }
  },

  'POST /api/groups/leave': ({ userId, body }) => {
    const conversationId = field(body, 'conversation')
    if (!isParticipant(conversationId, userId)) {
      throw new HttpError(404, 'cette conversation n’existe pas')
    }
    if (conversationKind(conversationId) !== 'group') {
      throw new HttpError(400, 'on ne quitte pas une conversation à deux — on la bloque')
    }
    const remaining = participantIds(conversationId).filter((id) => id !== userId)
    removeMember(conversationId, userId)
    hub.toUser(userId, { t: 'gone', conversation: conversationId })
    for (const id of remaining) {
      const theirs = describeConversation(conversationId, id)
      if (theirs) hub.toUser(id, { t: 'conversation', conversation: theirs })
    }
    return { left: true }
  },

  'POST /api/groups/rename': ({ userId, body }) => {
    const conversationId = field(body, 'conversation')
    if (!isParticipant(conversationId, userId)) {
      throw new HttpError(404, 'cette conversation n’existe pas')
    }
    const title = renameConversation(conversationId, field(body, 'title'))
    if (!title) throw new HttpError(400, 'un groupe a besoin d’un nom')
    announceConversation(conversationId, null)
    return { title }
  },

  /* -- reaching you when the tab is closed -------------------------------- */

  'GET /api/push': ({ userId }) => ({
    enabled: pushEnabled,
    key: pushPublicKey(),
    devices: subscriptionCount(userId),
  }),

  'POST /api/push/subscribe': ({ userId, body }) => {
    if (!pushEnabled) throw new HttpError(503, 'les notifications ne sont pas configurées')
    const subscription = (body as { subscription?: unknown })?.subscription
    try {
      saveSubscription(userId, subscription as Parameters<typeof saveSubscription>[1])
    } catch {
      throw new HttpError(400, 'abonnement incomplet')
    }
    count('push.subscribed')
    return { devices: subscriptionCount(userId) }
  },

  'POST /api/push/unsubscribe': ({ userId, body }) => {
    const endpoint = field(body, 'endpoint')
    if (endpoint) forgetSubscription(userId, endpoint)
    return { devices: subscriptionCount(userId) }
  },

  /* -- blocking ---------------------------------------------------------- */

  'GET /api/blocks': ({ userId }) => ({ people: listBlocked(userId) }),

  'POST /api/blocks': ({ userId, body }) => {
    const handle = field(body, 'handle').toLowerCase()
    const peer = isHandle(handle) ? findUserByHandle(handle) : undefined
    if (!peer) throw new HttpError(404, 'personne ne porte ce nom')
    if (peer.id === userId) throw new HttpError(400, 'on ne se bloque pas soi-même')
    blockUser(userId, peer.id)
    // Both sides stop seeing each other's presence from this moment.
    hub.toUser(userId, { t: 'presence', userId: peer.id, online: false })
    hub.toUser(peer.id, { t: 'presence', userId, online: false })
    return { blocked: publicUser(peer) }
  },

  'POST /api/blocks/remove': ({ userId, body }) => {
    const handle = field(body, 'handle').toLowerCase()
    const peer = isHandle(handle) ? findUserByHandle(handle) : undefined
    if (!peer) throw new HttpError(404, 'personne ne porte ce nom')
    unblockUser(userId, peer.id)
    if (!isBlocked(userId, peer.id)) {
      hub.toUser(userId, { t: 'presence', userId: peer.id, online: hub.isOnline(peer.id) })
      hub.toUser(peer.id, { t: 'presence', userId, online: hub.isOnline(userId) })
    }
    return { unblocked: publicUser(peer) }
  },

  /* -- the account itself ------------------------------------------------ */

  'POST /api/account/passphrase': async ({ userId, body }) => {
    const row = findUserRow(userId)
    if (!row || !(await verifyPassword(row, field(body, 'current')))) {
      throw new HttpError(401, 'phrase secrète actuelle incorrecte')
    }
    const version = await replacePassword(userId, requirePassphrase(field(body, 'next')))
    // Every other session is now invalid, including this user's other devices.
    hub.evict(userId, version)
    return { token: sign(userId, version) }
  },

  'POST /api/account/recovery': async ({ userId }) => ({
    recoveryPhrase: await replaceRecoveryPhrase(userId),
  }),

  'POST /api/account/revoke': ({ userId }) => {
    const version = revokeSessions(userId)
    hub.evict(userId, version)
    return { token: sign(userId, version) }
  },
}

const anonymous: Record<string, Handler> = {
  'POST /api/auth/register': async ({ body, address }) => {
    spend(limits.signUp, address, 'trop de comptes créés depuis cet endroit')
    const handle = field(body, 'handle').toLowerCase()
    const name = field(body, 'name')
    if (!isHandle(handle)) {
      throw new HttpError(400, 'un nom d’usage fait 3 à 20 caractères : a–z, 0–9, _')
    }
    requirePassphrase(field(body, 'password'))
    if (findUserByHandle(handle)) throw new HttpError(409, 'ce nom est déjà pris')
    const { user, recoveryPhrase } = await createUser(handle, name, field(body, 'password'))
    return { token: sign(user.id, 0), user, recoveryPhrase }
  },

  'POST /api/auth/login': async ({ body, address }) => {
    const handle = field(body, 'handle').toLowerCase()
    // Two limits: one on the machine trying, one on the account being tried.
    // The second is what a rotating pool of addresses cannot walk around.
    spend(limits.signInFromAddress, address, 'trop de tentatives depuis cet endroit')
    if (handle) spend(limits.signInToHandle, handle, 'trop de tentatives sur ce nom')

    const row = findUserByHandle(handle)
    if (!row || !(await verifyPassword(row, field(body, 'password')))) {
      throw new HttpError(401, 'nom ou phrase secrète incorrecte')
    }
    // A genuine sign-in clears the suspicion it was accumulating.
    limits.signInFromAddress.clear(address)
    limits.signInToHandle.clear(handle)

    return { token: sign(row.id, row.token_version), user: publicUser(row) }
  },

  'POST /api/auth/recover': async ({ body, address }) => {
    const handle = field(body, 'handle').toLowerCase()
    spend(limits.recover, address, 'trop de tentatives de récupération')
    if (handle) spend(limits.recover, handle, 'trop de tentatives sur ce nom')

    const row = findUserByHandle(handle)
    if (!row || !(await verifyRecoveryPhrase(row, field(body, 'phrase')))) {
      throw new HttpError(401, 'nom ou phrase de secours incorrecte')
    }
    const version = await replacePassword(row.id, requirePassphrase(field(body, 'password')))
    // The phrase that was just used is spent; a new one takes its place.
    const recoveryPhrase = await replaceRecoveryPhrase(row.id)
    hub.evict(row.id, version)
    limits.recover.clear(address)
    limits.recover.clear(handle)

    return { token: sign(row.id, version), user: publicUser(row), recoveryPhrase }
  },

  'GET /api/health': () => ({ ok: true }),

  /**
   * Counters, for whoever is watching. Guarded by METRICS_TOKEN: connection
   * counts and refusal rates are not something to publish.
   */
  'GET /api/metrics': ({ url }) => {
    const secret = process.env.METRICS_TOKEN?.trim()
    if (!secret) throw new HttpError(404, 'route inconnue')
    if (url.searchParams.get('token') !== secret) throw new HttpError(401, 'jeton invalide')
    return snapshot()
  },
}

/** Handles an /api request. Returns false when the path is not ours. */
export async function route(req: IncomingMessage, res: ServerResponse): Promise<boolean> {
  const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`)
  if (!url.pathname.startsWith('/api/')) return false

  applySecurityHeaders(req, res)
  applyCors(req, res)
  if (req.method === 'OPTIONS') {
    res.writeHead(204).end()
    return true
  }

  const address = addressOf(req)
  const key = `${req.method} ${url.pathname}`
  const startedAt = performance.now()
  count('http.requests')

  // Uploads and downloads carry bytes, not JSON, so they never reach the
  // handler table — its body reader would refuse them at 64 KB.
  if (key === 'POST /api/files' || url.pathname.startsWith('/api/files/')) {
    try {
      await carryFile(req, res, url, address)
    } catch (error) {
      if (error instanceof HttpError) {
        if (error.retryAfter) res.setHeader('retry-after', String(error.retryAfter))
        json(res, error.status, { error: error.message, retryAfter: error.retryAfter })
      } else {
        count('http.status.500')
        log.error('files.failed', { error: String(error) })
        json(res, 500, { error: 'quelque chose a cédé de notre côté' })
      }
    }
    return true
  }

  try {
    spend(limits.anything, address, 'trop de requêtes')

    const open = anonymous[key]
    if (open) {
      json(res, 200, await open({ url, body: await readBody(req), userId: '', address }))
      return true
    }

    const guarded = authed[key]
    if (!guarded) throw new HttpError(404, 'route inconnue')

    const claims = verify(req.headers.authorization?.replace(/^Bearer /i, ''))
    const user = claims ? findLiveIdentity(claims.userId, claims.version) : undefined
    if (!claims || !user) throw new HttpError(401, 'session expirée')

    const renewedToken = shouldRenew(claims) ? sign(user.id, claims.version) : undefined
    json(
      res,
      200,
      await guarded({ url, body: await readBody(req), userId: user.id, address, renewedToken }),
    )
  } catch (error) {
    if (error instanceof HttpError) {
      if (error.retryAfter) {
        res.setHeader('retry-after', String(error.retryAfter))
        count('http.throttled')
        log.warn('http.throttled', { route: key, address, retryAfter: error.retryAfter })
      }
      count(`http.status.${error.status}`)
      json(res, error.status, { error: error.message, retryAfter: error.retryAfter })
    } else {
      count('http.status.500')
      log.error('http.failed', {
        route: key,
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
      })
      json(res, 500, { error: 'quelque chose a cédé de notre côté' })
    }
  }

  log.debug('http', {
    route: key,
    status: res.statusCode,
    ms: Math.round(performance.now() - startedAt),
  })
  return true
}

/** Tells everyone in a conversation what it looks like from where they stand. */
function announceConversation(conversationId: string, except: string | null): void {
  for (const id of participantIds(conversationId)) {
    if (id === except) continue
    const theirs = describeConversation(conversationId, id)
    if (theirs) hub.toUser(id, { t: 'conversation', conversation: theirs })
  }
}

/* ------------------------------------------------------------------- files */

const whoIsAsking = (req: IncomingMessage) => {
  const claims = verify(req.headers.authorization?.replace(/^Bearer /i, ''))
  const user = claims ? findLiveIdentity(claims.userId, claims.version) : undefined
  if (!user) throw new HttpError(401, 'session expirée')
  return user
}

const numeric = (value: string | undefined): number | null => {
  const n = Number(value)
  return Number.isFinite(n) && n > 0 && n < 100_000 ? Math.round(n) : null
}

async function carryFile(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  address: string,
): Promise<void> {
  /* -- receiving ---------------------------------------------------------- */
  if (req.method === 'POST') {
    const user = whoIsAsking(req)
    spend(limits.upload, user.id, 'trop de fichiers d’un coup')
    void address

    const declared = Number(req.headers['content-length'] ?? 0)
    if (declared > MAX_BYTES) {
      throw new HttpError(413, `un fichier fait au plus ${Math.floor(MAX_BYTES / 1048576)} Mo`)
    }
    try {
      const seconds = Number(req.headers['x-file-duration'] ?? '')
      const attachment = await receive(req, user.id, {
        name: decodeURIComponent(String(req.headers['x-file-name'] ?? 'fichier')),
        mime: String(req.headers['content-type'] ?? 'application/octet-stream').split(';')[0] ?? '',
        width: numeric(req.headers['x-file-width'] as string | undefined),
        height: numeric(req.headers['x-file-height'] as string | undefined),
        duration: Number.isFinite(seconds) && seconds > 0 ? Math.min(seconds, 3600) : null,
        peaks: tamePeaks(req.headers['x-file-peaks'] as string | undefined),
      })
      count('files.received')
      json(res, 200, { attachment })
    } catch (error) {
      if (error instanceof TooLarge) {
        throw new HttpError(413, `un fichier fait au plus ${Math.floor(MAX_BYTES / 1048576)} Mo`)
      }
      throw error
    }
    return
  }

  /* -- serving ------------------------------------------------------------ */
  if (req.method !== 'GET' && req.method !== 'HEAD') throw new HttpError(405, 'méthode refusée')

  const user = whoIsAsking(req)
  const id = url.pathname.slice('/api/files/'.length)
  const row = findAttachment(id)
  if (!row) throw new HttpError(404, 'ce fichier n’existe plus')

  // Before it is attached only its uploader may see it; afterwards, whoever
  // can read the conversation it belongs to.
  const allowed = row.message_id
    ? isParticipant(findMessageConversation(row.message_id) ?? '', user.id)
    : row.uploader_id === user.id
  if (!allowed) throw new HttpError(404, 'ce fichier n’existe plus')

  const stream = openAttachment(id)
  if (!stream) throw new HttpError(404, 'ce fichier n’existe plus')

  res.writeHead(200, servingHeaders(row))
  if (req.method === 'HEAD') {
    res.end()
    return
  }
  stream.pipe(res)
}

/** Prometheus scrape, same guard as the JSON snapshot. */
export function metricsText(token: string | null): string | null {
  const secret = process.env.METRICS_TOKEN?.trim()
  if (!secret || token !== secret) return null
  return asPrometheus()
}
