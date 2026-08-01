import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto'

/*
 * Second factor.
 *
 * TOTP as everyone implements it — RFC 6238 over RFC 4226 — written here
 * rather than pulled in: it is sixty lines of HMAC and base32, and a
 * dependency that touches authentication is a dependency you have to trust
 * forever.
 *
 * Two decisions worth stating. The window is one step either side, which
 * forgives a clock that is half a minute out without turning a code into a
 * password. And a used code is not remembered — replaying one inside its own
 * thirty seconds works. Closing that needs per-account state on every attempt;
 * the rate limiter already caps an attacker to a handful of tries, and a
 * replay requires having seen the code in the first place.
 */

const DIGITS = 6
const STEP_SECONDS = 30
/** One step either side: a clock half a minute out still works. */
const DRIFT = 1

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'

export function toBase32(bytes: Buffer): string {
  let bits = 0
  let value = 0
  let out = ''
  for (const byte of bytes) {
    value = (value << 8) | byte
    bits += 8
    while (bits >= 5) {
      out += ALPHABET[(value >>> (bits - 5)) & 31]
      bits -= 5
    }
  }
  if (bits > 0) out += ALPHABET[(value << (5 - bits)) & 31]
  return out
}

export function fromBase32(secret: string): Buffer {
  const clean = secret.toUpperCase().replace(/[^A-Z2-7]/g, '')
  let bits = 0
  let value = 0
  const out: number[] = []
  for (const character of clean) {
    const index = ALPHABET.indexOf(character)
    if (index < 0) continue
    value = (value << 5) | index
    bits += 5
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255)
      bits -= 8
    }
  }
  return Buffer.from(out)
}

/** 160 bits, which is what every authenticator expects. */
export const mintSecret = (): string => toBase32(randomBytes(20))

function codeAt(secret: string, counter: number): string {
  const key = fromBase32(secret)
  const message = Buffer.alloc(8)
  message.writeUInt32BE(Math.floor(counter / 2 ** 32), 0)
  message.writeUInt32BE(counter >>> 0, 4)

  const digest = createHmac('sha1', key).update(message).digest()
  const offset = digest[digest.length - 1]! & 0x0f
  const binary =
    ((digest[offset]! & 0x7f) << 24) |
    ((digest[offset + 1]! & 0xff) << 16) |
    ((digest[offset + 2]! & 0xff) << 8) |
    (digest[offset + 3]! & 0xff)

  return String(binary % 10 ** DIGITS).padStart(DIGITS, '0')
}

/** The code an authenticator is showing right now. Exported for the tests. */
export const codeFor = (secret: string, at = Date.now()): string =>
  codeAt(secret, Math.floor(at / 1000 / STEP_SECONDS))

/** Constant time, so a wrong code never says *how* wrong it was. */
function same(a: string, b: string): boolean {
  const left = Buffer.from(a)
  const right = Buffer.from(b)
  if (left.length !== right.length) return false
  return timingSafeEqual(left, right)
}

export function verifyCode(secret: string, given: string, at = Date.now()): boolean {
  const cleaned = given.replace(/\D/g, '')
  if (cleaned.length !== DIGITS || !secret) return false
  const counter = Math.floor(at / 1000 / STEP_SECONDS)
  for (let drift = -DRIFT; drift <= DRIFT; drift += 1) {
    if (same(codeAt(secret, counter + drift), cleaned)) return true
  }
  return false
}

/**
 * What an authenticator scans or is told. The label is what the person will
 * see in their app, so it names the account, not the server.
 */
export function otpauthUri(handle: string, secret: string, issuer = 'Kairus'): string {
  const label = encodeURIComponent(`${issuer}:${handle}`)
  const params = new URLSearchParams({
    secret,
    issuer,
    algorithm: 'SHA1',
    digits: String(DIGITS),
    period: String(STEP_SECONDS),
  })
  return `otpauth://totp/${label}?${params.toString()}`
}

/** Groups of four, because people type this by hand. */
export const readableSecret = (secret: string): string =>
  secret.replace(/(.{4})/g, '$1 ').trim()
