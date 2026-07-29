import jwt from 'jsonwebtoken'
import { env } from './env.js'

/**
 * Seven days, not thirty. A stolen token is valid until it expires, and the
 * only thing that shortens that window before anyone notices is the window
 * itself. Active sessions are renewed silently, so this costs nobody a sign-in.
 */
const TTL_SECONDS = 7 * 24 * 60 * 60
/** Past halfway through its life, a token is swapped for a fresh one. */
const RENEW_AFTER = TTL_SECONDS / 2

export type Claims = { userId: string; version: number; expiresAt: number }

/**
 * The version is what makes revocation possible: it is compared against the
 * user's current `token_version`, so changing a passphrase — or signing out
 * everywhere — invalidates tokens that were already issued, without keeping a
 * server-side session table.
 */
export function sign(userId: string, version: number): string {
  return jwt.sign({ sub: userId, v: version }, env.jwtSecret, { expiresIn: TTL_SECONDS })
}

/** True when a token is old enough that the holder should be handed a new one. */
export function shouldRenew(claims: Claims): boolean {
  return claims.expiresAt - Date.now() / 1000 < RENEW_AFTER
}

export function verify(token: string | undefined | null): Claims | null {
  if (!token) return null
  try {
    const payload = jwt.verify(token, env.jwtSecret)
    if (typeof payload !== 'object' || typeof payload.sub !== 'string') return null
    const version = (payload as { v?: unknown }).v
    const exp = (payload as { exp?: unknown }).exp
    return {
      userId: payload.sub,
      version: typeof version === 'number' ? version : 0,
      expiresAt: typeof exp === 'number' ? exp : 0,
    }
  } catch {
    return null
  }
}
