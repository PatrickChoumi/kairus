import { after, before, beforeEach, test } from 'node:test'
import assert from 'node:assert/strict'
import { call, register, resetLimits, start, stop, wipe } from './harness.js'
import {
  codeFor,
  fromBase32,
  mintSecret,
  otpauthUri,
  readableSecret,
  toBase32,
  verifyCode,
} from '../src/totp.js'
import { timesBreached } from '../src/breached.js'

before(start)
after(stop)
beforeEach(wipe)

/* ------------------------------------------------------------------ codes */

test('base32 survives a round trip, including the awkward lengths', () => {
  for (const bytes of [1, 2, 3, 4, 5, 10, 20]) {
    const source = Buffer.from(Array.from({ length: bytes }, (_, i) => (i * 37 + 11) % 256))
    assert.deepEqual(fromBase32(toBase32(source)), source, `${bytes} octets`)
  }
})

test('a code is six digits, and changes every thirty seconds', () => {
  const secret = mintSecret()
  const now = 1_800_000_000_000
  assert.match(codeFor(secret, now), /^\d{6}$/)
  assert.equal(codeFor(secret, now), codeFor(secret, now + 29_000))
  assert.notEqual(codeFor(secret, now), codeFor(secret, now + 31_000))
})

test('a matching authenticator is accepted', () => {
  const secret = mintSecret()
  const now = 1_800_000_000_000
  assert.equal(verifyCode(secret, codeFor(secret, now), now), true)
})

test('a clock half a minute out still works, a minute out does not', () => {
  const secret = mintSecret()
  const now = 1_800_000_000_000
  assert.equal(verifyCode(secret, codeFor(secret, now - 30_000), now), true, 'un pas en arrière')
  assert.equal(verifyCode(secret, codeFor(secret, now + 30_000), now), true, 'un pas en avant')
  assert.equal(verifyCode(secret, codeFor(secret, now - 120_000), now), false)
})

test('a code from another secret is refused', () => {
  const now = 1_800_000_000_000
  assert.equal(verifyCode(mintSecret(), codeFor(mintSecret(), now), now), false)
})

test('anything that is not six digits is refused outright', () => {
  const secret = mintSecret()
  for (const bad of ['', '12345', '1234567', 'abcdef', '  ']) {
    assert.equal(verifyCode(secret, bad), false, JSON.stringify(bad))
  }
})

test('the secret is offered in a shape a human can type', () => {
  const secret = mintSecret()
  assert.equal(readableSecret(secret).replace(/ /g, ''), secret)
  assert.match(otpauthUri('ada', secret), /^otpauth:\/\/totp\/Kairus%3Aada\?/)
  assert.match(otpauthUri('ada', secret), /digits=6/)
})

/* ---------------------------------------------------------- turning it on */

type Begun = { secret: string; readable: string; uri: string }

const arm = async (token: string, password = 'a-long-enough-phrase') => {
  const begun = await call<Begun>('POST', '/api/account/totp/begin', {
    token,
    body: { password },
  })
  assert.equal(begun.status, 200, JSON.stringify(begun.body))
  const confirmed = await call('POST', '/api/account/totp/confirm', {
    token,
    body: { code: codeFor(begun.body.secret) },
  })
  assert.equal(confirmed.status, 200, JSON.stringify(confirmed.body))
  return begun.body.secret
}

test('a second factor is not in force until a code proves it arrived', async () => {
  const ada = await register('ada')

  const begun = await call<Begun>('POST', '/api/account/totp/begin', {
    token: ada.token,
    body: { password: 'a-long-enough-phrase' },
  })
  assert.equal(begun.status, 200)

  // Started, but not on: a mistyped setup must not lock anyone out.
  const midway = await call<{ on: boolean; started: boolean }>('GET', '/api/account/totp', {
    token: ada.token,
  })
  assert.equal(midway.body.on, false)
  assert.equal(midway.body.started, true)

  const signedIn = await call('POST', '/api/auth/login', {
    body: { handle: 'ada', password: 'a-long-enough-phrase' },
  })
  assert.equal(signedIn.status, 200, 'an unconfirmed setup must not block the door')

  const confirmed = await call('POST', '/api/account/totp/confirm', {
    token: ada.token,
    body: { code: codeFor(begun.body.secret) },
  })
  assert.equal(confirmed.status, 200)

  const on = await call<{ on: boolean }>('GET', '/api/account/totp', { token: ada.token })
  assert.equal(on.body.on, true)
})

test('a wrong code never turns it on', async () => {
  const ada = await register('ada')
  await call('POST', '/api/account/totp/begin', {
    token: ada.token,
    body: { password: 'a-long-enough-phrase' },
  })
  const refused = await call('POST', '/api/account/totp/confirm', {
    token: ada.token,
    body: { code: '000000' },
  })
  assert.equal(refused.status, 400)

  const state = await call<{ on: boolean }>('GET', '/api/account/totp', { token: ada.token })
  assert.equal(state.body.on, false)
})

test('arming it asks for the passphrase first', async () => {
  const ada = await register('ada')
  const refused = await call('POST', '/api/account/totp/begin', {
    token: ada.token,
    body: { password: 'pas la bonne' },
  })
  assert.equal(refused.status, 401)
})

/* -------------------------------------------------------------- signing in */

test('the passphrase alone stops being enough', async () => {
  const ada = await register('ada')
  const secret = await arm(ada.token)
  resetLimits()

  const half = await call<{ kind?: string }>('POST', '/api/auth/login', {
    body: { handle: 'ada', password: 'a-long-enough-phrase' },
  })
  assert.equal(half.status, 401)
  assert.equal(half.body.kind, 'code', 'the client has to know a code is what is missing')

  const wrong = await call('POST', '/api/auth/login', {
    body: { handle: 'ada', password: 'a-long-enough-phrase', code: '000000' },
  })
  assert.equal(wrong.status, 401)

  const whole = await call<{ token: string }>('POST', '/api/auth/login', {
    body: { handle: 'ada', password: 'a-long-enough-phrase', code: codeFor(secret) },
  })
  assert.equal(whole.status, 200)
  assert.ok(whole.body.token)
})

test('a right code with a wrong passphrase opens nothing', async () => {
  const ada = await register('ada')
  const secret = await arm(ada.token)
  resetLimits()

  const refused = await call('POST', '/api/auth/login', {
    body: { handle: 'ada', password: 'pas la bonne', code: codeFor(secret) },
  })
  assert.equal(refused.status, 401)
})

test('guessing codes is slowed down, which is the whole point', async () => {
  const ada = await register('ada')
  await arm(ada.token)
  resetLimits()

  let refusedForRate = false
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const tried = await call<{ retryAfter?: number }>('POST', '/api/auth/login', {
      body: { handle: 'ada', password: 'a-long-enough-phrase', code: '000000' },
    })
    if (tried.status === 429) {
      assert.ok(Number(tried.body.retryAfter) > 0, 'a refusal always says how long to wait')
      refusedForRate = true
      break
    }
  }
  assert.equal(refusedForRate, true, 'a million codes must not be six digits away')
})

/* ------------------------------------------------------------ turning it off */

test('turning it off asks for both halves', async () => {
  const ada = await register('ada')
  const secret = await arm(ada.token)
  resetLimits()

  const noCode = await call('POST', '/api/account/totp/off', {
    token: ada.token,
    body: { password: 'a-long-enough-phrase' },
  })
  assert.equal(noCode.status, 400)

  const noPassphrase = await call('POST', '/api/account/totp/off', {
    token: ada.token,
    body: { password: 'pas la bonne', code: codeFor(secret) },
  })
  assert.equal(noPassphrase.status, 401)

  const off = await call('POST', '/api/account/totp/off', {
    token: ada.token,
    body: { password: 'a-long-enough-phrase', code: codeFor(secret) },
  })
  assert.equal(off.status, 200)

  const plain = await call('POST', '/api/auth/login', {
    body: { handle: 'ada', password: 'a-long-enough-phrase' },
  })
  assert.equal(plain.status, 200)
})

test('taking the account back lifts the second factor with it', async () => {
  const registered = await call<{ token: string; recoveryPhrase: string }>(
    'POST',
    '/api/auth/register',
    { body: { handle: 'ada', name: 'ada', password: 'a-long-enough-phrase' } },
  )
  await arm(registered.body.token)
  resetLimits()

  // Someone who lost their authenticator has the phrase and nothing else.
  const back = await call('POST', '/api/auth/recover', {
    body: {
      handle: 'ada',
      phrase: registered.body.recoveryPhrase,
      password: 'une-toute-autre-phrase',
    },
  })
  assert.equal(back.status, 200)

  const plain = await call('POST', '/api/auth/login', {
    body: { handle: 'ada', password: 'une-toute-autre-phrase' },
  })
  assert.equal(plain.status, 200, 'recovery must not be a door onto a wall')
})

/* ------------------------------------------------- passphrases already public */

test('a passphrase that is too short is refused before anything else', async () => {
  const short = await call<{ error: string }>('POST', '/api/auth/register', {
    body: { handle: 'bob', name: 'bob', password: 'court' },
  })
  assert.equal(short.status, 400)
  assert.match(short.body.error, /10 caractères/)
})

test('a passphrase in the public dumps is refused, and says how often', async () => {
  const original = globalThis.fetch
  process.env.BREACH_CHECK = 'on'
  // The real service answers with suffixes and counts; only the first five hex
  // characters of the hash ever leave, which is what this stub stands in for.
  const { createHash } = await import('node:crypto')
  const hash = createHash('sha1').update('correct horse battery', 'utf8').digest('hex').toUpperCase()

  // Only the breach lookup is stubbed: the harness talks to the real server
  // over the same global fetch, and intercepting that would test nothing.
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input)
    if (!url.includes('pwnedpasswords')) return original(input as RequestInfo, init)
    assert.ok(url.endsWith(hash.slice(0, 5)), 'only the prefix may be sent')
    assert.equal(url.includes(hash.slice(5)), false, 'the rest of the hash must never leave')
    return new Response(`${hash.slice(5)}:4823\nFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF:1\n`, {
      status: 200,
    })
  }) as typeof fetch

  try {
    const verdict = await timesBreached('correct horse battery')
    assert.deepEqual(verdict, { breached: true, times: 4823, checked: true })

    const refused = await call<{ error: string }>('POST', '/api/auth/register', {
      body: { handle: 'bob', name: 'bob', password: 'correct horse battery' },
    })
    assert.equal(refused.status, 400)
    assert.match(refused.body.error, /fuites connues/)
  } finally {
    globalThis.fetch = original
    process.env.BREACH_CHECK = 'off'
  }
})

test('an unknown passphrase passes', async () => {
  const original = globalThis.fetch
  process.env.BREACH_CHECK = 'on'
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    if (!String(input).includes('pwnedpasswords')) return original(input as RequestInfo, init)
    return new Response('AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA:9\n', { status: 200 })
  }) as typeof fetch

  try {
    const verdict = await timesBreached('une phrase que personne n’a jamais écrite')
    assert.deepEqual(verdict, { breached: false, times: 0, checked: true })
  } finally {
    globalThis.fetch = original
    process.env.BREACH_CHECK = 'off'
  }
})

test('an outage lets people in rather than shutting the door', async () => {
  const original = globalThis.fetch
  process.env.BREACH_CHECK = 'on'
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    if (!String(input).includes('pwnedpasswords')) return original(input as RequestInfo, init)
    throw new Error('injoignable')
  }) as typeof fetch

  try {
    const verdict = await timesBreached('peu importe')
    assert.equal(verdict.breached, false)
    assert.equal(verdict.checked, false, 'and it says the gap is there')

    const created = await call('POST', '/api/auth/register', {
      body: { handle: 'bob', name: 'bob', password: 'une-phrase-assez-longue' },
    })
    assert.equal(created.status, 200, 'a third party being down must not stop sign-ups')
  } finally {
    globalThis.fetch = original
    process.env.BREACH_CHECK = 'off'
  }
})

test('the check can be turned off entirely for a server with no network', async () => {
  process.env.BREACH_CHECK = 'off'
  const verdict = await timesBreached('password')
  assert.deepEqual(verdict, { breached: false, times: 0, checked: false })
})
