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

export const env = {
  isProd,
  port: Number(process.env.PORT ?? 4000),
  host: process.env.HOST ?? '0.0.0.0',
  jwtSecret: requiredSecret(),
  dataDir: process.env.DATA_DIR ?? 'data',
  /** Comma-separated list. Empty means "same origin only". */
  origins: (process.env.CORS_ORIGIN ?? '')
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean),
}
