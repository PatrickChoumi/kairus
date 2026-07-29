import jwt from 'jsonwebtoken'
import { env } from './env.js'

const TTL = '30d'

export type Claims = { userId: string; version: number }

/**
 * The version is what makes revocation possible: it is compared against the
 * user's current `token_version`, so changing a passphrase — or signing out
 * everywhere — invalidates tokens that were already issued, without keeping a
 * server-side session table.
 */
export function sign(userId: string, version: number): string {
  return jwt.sign({ sub: userId, v: version }, env.jwtSecret, { expiresIn: TTL })
}

export function verify(token: string | undefined | null): Claims | null {
  if (!token) return null
  try {
    const payload = jwt.verify(token, env.jwtSecret)
    if (typeof payload !== 'object' || typeof payload.sub !== 'string') return null
    const version = (payload as { v?: unknown }).v
    return { userId: payload.sub, version: typeof version === 'number' ? version : 0 }
  } catch {
    return null
  }
}
