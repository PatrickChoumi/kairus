/*
 * Test harness: a real server on a real port, talking to an in-memory database.
 *
 * The modules under test read their configuration at import time, so the
 * environment is set before anything is imported — hence the dynamic imports.
 */

process.env.NODE_ENV = 'test'
process.env.JWT_SECRET ??= 'a-secret-that-only-the-tests-use'
process.env.DATA_DIR = ':memory:'
// The breach check reaches a third party; the tests must not depend on it
// being up, and `breached.test.ts` exercises it directly with a stubbed fetch.
process.env.BREACH_CHECK = 'off'
// Attachments are real bytes on a real disk even when the database is not.
process.env.MAX_UPLOAD_BYTES ??= String(8 * 1024 * 1024)

import { createServer, type Server } from 'node:http'
import { AddressInfo } from 'node:net'
import { once } from 'node:events'

const { route } = await import('../src/router.js')
const { attachRealtime } = await import('../src/realtime.js')
const { resetLimits } = await import('../src/limiter.js')
const { db } = await import('../src/db.js')

export { resetLimits, db }

export type Reply<T = Record<string, unknown>> = {
  status: number
  headers: Record<string, string | string[] | undefined>
  body: T
}

let server: Server | null = null
let closeRealtime: (() => void) | null = null
let origin = ''

export async function start(): Promise<string> {
  if (server) return origin
  server = createServer((req, res) => {
    void route(req, res).then((handled) => {
      if (!handled) res.writeHead(404).end()
    })
  })
  closeRealtime = attachRealtime(server)
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const { port } = server.address() as AddressInfo
  origin = `http://127.0.0.1:${port}`
  return origin
}

export async function stop(): Promise<void> {
  if (!server) return
  const closing = server
  server = null
  closeRealtime?.()
  closeRealtime = null
  closing.closeAllConnections?.()
  closing.close()
  await once(closing, 'close').catch(() => undefined)
}

export async function call<T = Record<string, unknown>>(
  method: string,
  path: string,
  options: { token?: string; body?: unknown; headers?: Record<string, string> } = {},
): Promise<Reply<T>> {
  const headers: Record<string, string> = { ...options.headers }
  if (options.body !== undefined) headers['content-type'] = 'application/json'
  if (options.token) headers.authorization = `Bearer ${options.token}`

  const response = await fetch(`${origin}${path}`, {
    method,
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  })
  const body = (await response.json().catch(() => ({}))) as T
  return {
    status: response.status,
    headers: Object.fromEntries(response.headers.entries()),
    body,
  }
}

export const socketOrigin = () => origin.replace('http://', 'ws://')

/**
 * A request carrying bytes rather than JSON — uploads and downloads. Kept here
 * so no test has to know how the harness names its own origin.
 */
export function raw(
  method: string,
  path: string,
  options: { token?: string; body?: BodyInit; headers?: Record<string, string> } = {},
): Promise<Response> {
  const headers: Record<string, string> = { ...options.headers }
  if (options.token) headers.authorization = `Bearer ${options.token}`
  return fetch(`${origin}${path}`, { method, headers, body: options.body })
}

/** Every table emptied, so one case cannot see another's leftovers. */
export function wipe(): void {
  db.exec(`
    DELETE FROM push_subscriptions;
    DELETE FROM blocks;
    DELETE FROM pins;
    DELETE FROM messages;
    DELETE FROM participants;
    DELETE FROM conversations;
    DELETE FROM users;
  `)
  resetLimits()
}

export type Account = { token: string; user: { id: string; handle: string; name: string } }

export async function register(handle: string, password = 'a-long-enough-phrase'): Promise<Account> {
  const reply = await call<Account>('POST', '/api/auth/register', {
    body: { handle, name: handle, password },
  })
  if (reply.status !== 200) throw new Error(`register ${handle} failed: ${JSON.stringify(reply.body)}`)
  return reply.body
}
