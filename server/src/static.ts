import { createReadStream, existsSync, statSync } from 'node:fs'
import { extname, join, normalize, resolve } from 'node:path'
import type { IncomingMessage, ServerResponse } from 'node:http'

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
 * Serves the built client when it exists. In development Vite owns this, so a
 * missing bundle is not an error — the handler simply declines.
 */
export function serveClient(root: string) {
  const base = resolve(root)
  const available = existsSync(join(base, 'index.html'))

  return (req: IncomingMessage, res: ServerResponse): boolean => {
    if (!available) return false
    if (req.method !== 'GET' && req.method !== 'HEAD') return false

    const requested = new URL(req.url ?? '/', 'http://localhost').pathname
    const candidate = resolve(base, '.' + normalize(requested))
    const isInside = candidate === base || candidate.startsWith(base + '/')

    let file = isInside && existsSync(candidate) && statSync(candidate).isFile() ? candidate : null
    // Single-page app: unknown paths fall back to the shell.
    if (!file) file = join(base, 'index.html')

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
}
