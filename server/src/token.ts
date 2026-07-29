import jwt from 'jsonwebtoken'
import { env } from './env.js'

const TTL = '30d'

export function sign(userId: string): string {
  return jwt.sign({ sub: userId }, env.jwtSecret, { expiresIn: TTL })
}

export function verify(token: string | undefined | null): string | null {
  if (!token) return null
  try {
    const payload = jwt.verify(token, env.jwtSecret)
    if (typeof payload === 'object' && typeof payload.sub === 'string') return payload.sub
    return null
  } catch {
    return null
  }
}
