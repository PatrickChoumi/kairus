import { randomBytes } from 'node:crypto'

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
  console.warn('[kairus] JWT_SECRET unset — using an ephemeral development secret')
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

export const env = {
  isProd,
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
