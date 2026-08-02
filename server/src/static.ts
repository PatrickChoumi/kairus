import { createReadStream, existsSync, readFileSync, statSync } from 'node:fs'
import { extname, join, normalize, resolve } from 'node:path'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { buildPolicy, inlineScriptHashes, usePolicy } from './headers.js'

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
}

/**
 * Which client this process is serving.
 *
 * Written by the client build, read once here, and reported by /api/health.
 * Without it, "am I looking at the version I just deployed?" can only be
 * answered by squinting at the interface — and that question comes up on
 * every deployment.
 */
let build = 'inconnu'
export const builtVersion = (): string => build

/**
 * Serves the built client when it exists. In development Vite owns this, so a
 * missing bundle is not an error — the handler simply declines.
 */
export function serveClient(root: string) {
  const base = resolve(root)
  const shell = join(base, 'index.html')
  const available = existsSync(shell)

  // Hashed once at boot: the shell does not change while the process runs.
  if (available) usePolicy(buildPolicy(inlineScriptHashes(readFileSync(shell, 'utf8'))))

  const stamp = join(base, 'build.txt')
  build = existsSync(stamp)
    ? readFileSync(stamp, 'utf8').trim().slice(0, 40) || 'inconnu'
    : 'inconnu'

  const handle = (req: IncomingMessage, res: ServerResponse): boolean => {
    if (!available) return false
    if (req.method !== 'GET' && req.method !== 'HEAD') return false

    const requested = new URL(req.url ?? '/', 'http://localhost').pathname
    const candidate = resolve(base, '.' + normalize(requested))
    const isInside = candidate === base || candidate.startsWith(base + '/')

    let file = isInside && existsSync(candidate) && statSync(candidate).isFile() ? candidate : null
    // Single-page app: unknown paths fall back to the shell.
    if (!file) file = shell

    const type = TYPES[extname(file)] ?? 'application/octet-stream'
    const immutable = /\/assets\//.test(file)
    res.writeHead(200, {
      'content-type': type,
      'cache-control': immutable ? 'public, max-age=31536000, immutable' : 'no-cache',
    })
    if (req.method === 'HEAD') {
      res.end()
      return true
    }
    createReadStream(file).pipe(res)
    return true
  }

  return handle
}
