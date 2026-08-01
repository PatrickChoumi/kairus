import { createHash } from 'node:crypto'
import { log } from './log.js'

/*
 * Passphrases that are already public.
 *
 * A minimum length stops nothing: "password" is eight characters. What
 * actually helps is refusing the handful of strings that appear in every
 * credential dump, and for that somebody has to know the dumps.
 *
 * Have I Been Pwned answers that without being told the passphrase. We hash
 * it, send the **first five hex characters** of the hash, and get back every
 * suffix sharing that prefix — a few hundred lines. The match happens here.
 * The passphrase, and even its full hash, never leave this process.
 *
 * It fails open on purpose. An outage at a third party must not be able to
 * stop people creating accounts; a passphrase that slips through is a smaller
 * harm than an application that cannot be signed up for.
 */

const ENDPOINT = 'https://api.pwnedpasswords.com/range/'
const TIMEOUT_MS = 2500

/** Set `BREACH_CHECK=off` for a deployment with no outbound network. */
const enabled = (): boolean => process.env.BREACH_CHECK?.trim().toLowerCase() !== 'off'

export type Verdict = { breached: boolean; times: number; checked: boolean }

export async function timesBreached(passphrase: string): Promise<Verdict> {
  if (!enabled()) return { breached: false, times: 0, checked: false }

  const hash = createHash('sha1').update(passphrase, 'utf8').digest('hex').toUpperCase()
  const prefix = hash.slice(0, 5)
  const suffix = hash.slice(5)

  try {
    const cancel = AbortSignal.timeout(TIMEOUT_MS)
    const response = await fetch(ENDPOINT + prefix, {
      signal: cancel,
      headers: { 'add-padding': 'true', 'user-agent': 'kairus' },
    })
    if (!response.ok) throw new Error(`status ${response.status}`)

    for (const line of (await response.text()).split('\n')) {
      const [tail, count] = line.trim().split(':')
      if (tail === suffix) {
        return { breached: true, times: Number(count) || 1, checked: true }
      }
    }
    return { breached: false, times: 0, checked: true }
  } catch (error) {
    // Fails open, and says so, so the gap is visible in the logs.
    log.warn('breach.check.unavailable', { error: String(error) })
    return { breached: false, times: 0, checked: false }
  }
}
