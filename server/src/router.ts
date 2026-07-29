import type { IncomingMessage, ServerResponse } from 'node:http'
import { env } from './env.js'
import {
  addMessage,
  createUser,
  describeConversation,
  findUser,
  findUserByHandle,
  isHandle,
  isParticipant,
  listConversations,
  listMessages,
  markRead,
  openConversation,
  searchMessages,
  searchUsers,
  verifyPassword,
} from './model.js'
import { sign, verify } from './token.js'
import { hub } from './realtime.js'

export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message)
  }
}

type Ctx = {
  url: URL
  body: unknown
  userId: string
}

const json = (res: ServerResponse, status: number, payload: unknown) => {
  const data = JSON.stringify(payload)
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(data),
  })
  res.end(data)
}

export function applyCors(req: IncomingMessage, res: ServerResponse): void {
  const origin = req.headers.origin
  if (!origin) return
  if (env.origins.length === 0 || env.origins.includes(origin)) {
    res.setHeader('access-control-allow-origin', origin)
    res.setHeader('vary', 'origin')
    res.setHeader('access-control-allow-headers', 'content-type, authorization')
    res.setHeader('access-control-allow-methods', 'GET, POST, OPTIONS')
    res.setHeader('access-control-max-age', '86400')
  }
}

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

/* ------------------------------------------------------------------ routes */

type Handler = (ctx: Ctx) => unknown | Promise<unknown>

const authed: Record<string, Handler> = {
  'GET /api/me': ({ userId }) => ({ user: findUser(userId) }),

  'GET /api/conversations': ({ userId }) => ({ conversations: listConversations(userId) }),

  'POST /api/conversations': ({ userId, body }) => {
    const handle = field(body, 'handle').toLowerCase()
    if (!isHandle(handle)) throw new HttpError(400, 'ce nom d’usage n’est pas valide')
    const peer = findUserByHandle(handle)
    if (!peer) throw new HttpError(404, 'personne ne porte ce nom')
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
    return { messages: listMessages(id, before) }
  },

  'POST /api/messages': ({ userId, body }) => {
    const conversationId = field(body, 'conversation')
    const text = field(body, 'body')
    if (!isParticipant(conversationId, userId)) throw new HttpError(404, 'cette conversation n’existe pas')
    if (!text) throw new HttpError(400, 'message vide')
    const replyTo = field(body, 'replyTo') || null
    const message = addMessage(conversationId, userId, text.slice(0, 4000), replyTo)
    hub.broadcastMessage(message)
    return { message }
  },

  'POST /api/read': ({ userId, body }) => {
    const conversationId = field(body, 'conversation')
    if (!isParticipant(conversationId, userId)) throw new HttpError(404, 'cette conversation n’existe pas')
    const at = markRead(conversationId, userId, Date.now())
    hub.broadcastRead(conversationId, userId, at)
    return { at }
  },

  'GET /api/people': ({ userId, url }) => {
    const q = (url.searchParams.get('q') ?? '').trim()
    return { people: q ? searchUsers(q, userId) : [] }
  },

  'GET /api/search': ({ userId, url }) => {
    const q = (url.searchParams.get('q') ?? '').trim()
    return { hits: q.length >= 2 ? searchMessages(userId, q) : [] }
  },
}

const anonymous: Record<string, Handler> = {
  'POST /api/auth/register': ({ body }) => {
    const handle = field(body, 'handle').toLowerCase()
    const password = field(body, 'password')
    const name = field(body, 'name')
    if (!isHandle(handle)) {
      throw new HttpError(400, 'un nom d’usage fait 3 à 20 caractères : a–z, 0–9, _')
    }
    if (password.length < 8) throw new HttpError(400, 'une phrase secrète fait au moins 8 caractères')
    if (findUserByHandle(handle)) throw new HttpError(409, 'ce nom est déjà pris')
    const user = createUser(handle, name, password)
    return { token: sign(user.id), user }
  },

  'POST /api/auth/login': ({ body }) => {
    const handle = field(body, 'handle').toLowerCase()
    const password = field(body, 'password')
    const row = findUserByHandle(handle)
    if (!row || !verifyPassword(row, password)) {
      throw new HttpError(401, 'nom ou phrase secrète incorrecte')
    }
    return {
      token: sign(row.id),
      user: { id: row.id, handle: row.handle, name: row.name, hue: row.hue },
    }
  },

  'GET /api/health': () => ({ ok: true }),
}

/** Handles an /api request. Returns false when the path is not ours. */
export async function route(req: IncomingMessage, res: ServerResponse): Promise<boolean> {
  const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`)
  if (!url.pathname.startsWith('/api/')) return false

  applyCors(req, res)
  if (req.method === 'OPTIONS') {
    res.writeHead(204).end()
    return true
  }

  const key = `${req.method} ${url.pathname}`
  try {
    const open = anonymous[key]
    if (open) {
      json(res, 200, await open({ url, body: await readBody(req), userId: '' }))
      return true
    }

    const guarded = authed[key]
    if (!guarded) throw new HttpError(404, 'route inconnue')

    const userId = verify(req.headers.authorization?.replace(/^Bearer /i, ''))
    if (!userId || !findUser(userId)) throw new HttpError(401, 'session expirée')

    json(res, 200, await guarded({ url, body: await readBody(req), userId }))
  } catch (error) {
    if (error instanceof HttpError) {
      json(res, error.status, { error: error.message })
    } else {
      console.error('[kairus]', error)
      json(res, 500, { error: 'quelque chose a cédé de notre côté' })
    }
  }
  return true
}
