import { createHash } from 'node:crypto'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { env } from './env.js'

/**
 * Security headers.
 *
 * The one that matters here is the Content-Security-Policy. The session token
 * lives in localStorage, so a script injection would be enough to steal it;
 * a policy that refuses to run any script the page did not ship is the real
 * mitigation, not a hope that no injection ever lands.
 */

/**
 * `index.html` carries one inline script — the pre-paint theme switch, which
 * cannot be moved to a file without a flash of the wrong colours. Rather than
 * open the policy with 'unsafe-inline', its exact bytes are hashed and only
 * that script is allowed.
 */
export function inlineScriptHashes(html: string): string[] {
  const hashes: string[] = []
  const script = /<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi
  for (const match of html.matchAll(script)) {
    const body = match[1]
    if (body === undefined) continue
    hashes.push(`'sha256-${createHash('sha256').update(body, 'utf8').digest('base64')}'`)
  }
  return hashes
}

const isSecure = (req: IncomingMessage): boolean => {
  if (env.trustProxy > 0) {
    const forwarded = String(req.headers['x-forwarded-proto'] ?? '')
      .split(',')
      .map((p) => p.trim())
      .filter(Boolean)
    if (forwarded[forwarded.length - 1] === 'https') return true
  }
  return 'encrypted' in req.socket
}

export function buildPolicy(scriptHashes: string[]): string {
  // A separately hosted client talks to us cross-origin; it must be allowed to.
  const connect = ["'self'", ...env.origins].join(' ')
  return [
    `default-src 'self'`,
    `base-uri 'self'`,
    `object-src 'none'`,
    `frame-ancestors 'none'`,
    `form-action 'self'`,
    // Attachments are fetched with the session and shown as object URLs.
    `img-src 'self' data: blob:`,
    `font-src 'self'`,
    `style-src 'self'`,
    `script-src 'self' ${scriptHashes.join(' ')}`.trim(),
    `connect-src ${connect}`,
    `manifest-src 'self'`,
    `worker-src 'self'`,
  ].join('; ')
}

/**
 * The policy in force. It starts at the strictest thing that can be stated
 * without having read the shell, and is narrowed to the real one as soon as
 * the client bundle is located — a server that never finds a bundle still
 * sends a policy rather than none.
 */
let policy = buildPolicy([])

export const usePolicy = (next: string): void => {
  policy = next
}

export const currentPolicy = (): string => policy

/**
 * Applied to every response, API and client alike: an injection does not care
 * which handler produced the page it landed in. This lives with the handlers
 * rather than with the server wiring, so no entry point can forget it.
 */
export function applySecurityHeaders(req: IncomingMessage, res: ServerResponse): void {
  res.setHeader('content-security-policy', policy)
  res.setHeader('x-content-type-options', 'nosniff')
  res.setHeader('x-frame-options', 'DENY')
  res.setHeader('referrer-policy', 'no-referrer')
  res.setHeader('permissions-policy', 'camera=(), microphone=(), geolocation=(), payment=()')
  res.setHeader('cross-origin-opener-policy', 'same-origin')
  res.setHeader('cross-origin-resource-policy', 'same-origin')
  // Promising HTTPS over a plain connection would lock out a local dev server.
  if (isSecure(req)) {
    res.setHeader('strict-transport-security', 'max-age=31536000; includeSubDomains')
  }
}
