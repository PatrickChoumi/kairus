import { randomBytes } from 'node:crypto'
import { log } from './log.js'

const isProd = process.env.NODE_ENV === 'production'

function requiredSecret(): string {
  const fromEnv = process.env.JWT_SECRET?.trim()
  if (fromEnv) return fromEnv
  if (isProd) {
    throw new Error('JWT_SECRET must be set in production')
  }
  // Dev only: an ephemeral secret. Restarting the server invalidates sessions,
  // which is the correct behaviour for a throwaway key.
  const generated = randomBytes(32).toString('hex')
  log.warn('jwt.secret.ephemeral', { note: 'development only — sessions die on restart' })
  return generated
}

/**
 * How many reverse proxies sit in front of us. Rate limiting keys on the
 * caller's address, so this must be opt-in: trusting X-Forwarded-For when
 * nothing strips it lets anyone forge an address and walk around every limit.
 */
function trustedHops(): number {
  const raw = Number(process.env.TRUST_PROXY ?? 0)
  return Number.isInteger(raw) && raw >= 0 ? raw : 0
}

/**
 * What a call uses to find a path between two browsers.
 *
 * A STUN server is enough when at least one side is not behind a symmetric
 * NAT; the rest need a relay (TURN), which we do not run and cannot fake.
 * `ICE_SERVERS` takes a JSON array — exactly the shape `RTCPeerConnection`
 * expects — so adding a TURN credential is a configuration change, not a
 * deployment.
 */
function iceServers(): unknown[] {
  const raw = process.env.ICE_SERVERS?.trim()
  if (!raw) return [{ urls: 'stun:stun.l.google.com:19302' }]
  try {
    const parsed: unknown = JSON.parse(raw)
    if (Array.isArray(parsed)) return parsed
    log.warn('ice.servers.ignored', { reason: 'not a JSON array' })
  } catch (error) {
    log.warn('ice.servers.ignored', { error: String(error) })
  }
  return [{ urls: 'stun:stun.l.google.com:19302' }]
}

export const env = {
  isProd,
  iceServers: iceServers(),
  port: Number(process.env.PORT ?? 4000),
  host: process.env.HOST ?? '0.0.0.0',
  jwtSecret: requiredSecret(),
  dataDir: process.env.DATA_DIR ?? 'data',
  trustProxy: trustedHops(),
  /**
   * Comma-separated allow-list. Empty means same-origin only, which is what a
   * single-container deployment wants — not "any origin".
   */
  origins: (process.env.CORS_ORIGIN ?? '')
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean),
}
