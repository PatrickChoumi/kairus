import { after, before, beforeEach, test } from 'node:test'
import assert from 'node:assert/strict'
import { call, register, start, stop, wipe } from './harness.js'

before(start)
after(stop)
beforeEach(wipe)

test('registering hands back a token and a recovery phrase, shown once', async () => {
  const reply = await call<{ token: string; recoveryPhrase: string }>(
    'POST',
    '/api/auth/register',
    { body: { handle: 'ada', name: 'Ada', password: 'analytical-engine' } },
  )
  assert.equal(reply.status, 200)
  assert.ok(reply.body.token)
  assert.match(reply.body.recoveryPhrase, /^[a-z2-9]{5}(-[a-z2-9]{5}){3}$/)

  // It is never handed out again by any read path.
  const me = await call<{ user: Record<string, unknown> }>('GET', '/api/me', {
    token: reply.body.token,
  })
  assert.equal(me.status, 200)
  assert.deepEqual(Object.keys(me.body.user).sort(), ['handle', 'hue', 'id', 'name'])
})

test('a short passphrase is refused', async () => {
  const reply = await call('POST', '/api/auth/register', {
    body: { handle: 'alan', name: 'Alan', password: 'short' },
  })
  assert.equal(reply.status, 400)
})

test('a wrong passphrase does not sign you in', async () => {
  await register('ada')
  const reply = await call('POST', '/api/auth/login', {
    body: { handle: 'ada', password: 'not-the-passphrase' },
  })
  assert.equal(reply.status, 401)
})

test('guessing one account is throttled, whatever the endpoint is told', async () => {
  await register('ada')

  let refusedAt = -1
  for (let attempt = 0; attempt < 12; attempt += 1) {
    const reply = await call<{ retryAfter?: number }>('POST', '/api/auth/login', {
      body: { handle: 'ada', password: `guess-number-${attempt}` },
    })
    if (reply.status === 429) {
      refusedAt = attempt
      assert.ok(reply.body.retryAfter && reply.body.retryAfter > 0)
      assert.ok(reply.headers['retry-after'], 'a 429 must say when to come back')
      break
    }
    assert.equal(reply.status, 401)
  }

  assert.notEqual(refusedAt, -1, 'brute force must be stopped')
  assert.ok(refusedAt <= 10, `stopped after ${refusedAt} attempts, which is too many`)
})

test('a genuine sign-in clears the suspicion it had accumulated', async () => {
  await register('ada', 'analytical-engine')
  for (let i = 0; i < 3; i += 1) {
    await call('POST', '/api/auth/login', { body: { handle: 'ada', password: 'wrong' } })
  }
  const good = await call('POST', '/api/auth/login', {
    body: { handle: 'ada', password: 'analytical-engine' },
  })
  assert.equal(good.status, 200)

  // Having signed in, the budget is whole again rather than nearly spent.
  for (let i = 0; i < 4; i += 1) {
    const reply = await call('POST', '/api/auth/login', {
      body: { handle: 'ada', password: 'wrong' },
    })
    assert.equal(reply.status, 401, 'a legitimate user should not be locked out')
  }
})

test('changing the passphrase ends every session that was open', async () => {
  const ada = await register('ada', 'analytical-engine')

  const before = await call('GET', '/api/me', { token: ada.token })
  assert.equal(before.status, 200)

  const changed = await call<{ token: string }>('POST', '/api/account/passphrase', {
    token: ada.token,
    body: { current: 'analytical-engine', next: 'a-brand-new-phrase' },
  })
  assert.equal(changed.status, 200)

  const after = await call('GET', '/api/me', { token: ada.token })
  assert.equal(after.status, 401, 'the old token must stop working')

  const fresh = await call('GET', '/api/me', { token: changed.body.token })
  assert.equal(fresh.status, 200, 'the token handed back must work')
})

test('changing the passphrase needs the current one', async () => {
  const ada = await register('ada', 'analytical-engine')
  const reply = await call('POST', '/api/account/passphrase', {
    token: ada.token,
    body: { current: 'not-it', next: 'a-brand-new-phrase' },
  })
  assert.equal(reply.status, 401)
})

test('signing out everywhere invalidates the tokens already issued', async () => {
  const ada = await register('ada')
  const revoked = await call<{ token: string }>('POST', '/api/account/revoke', {
    token: ada.token,
  })
  assert.equal(revoked.status, 200)
  assert.equal((await call('GET', '/api/me', { token: ada.token })).status, 401)
  assert.equal((await call('GET', '/api/me', { token: revoked.body.token })).status, 200)
})

test('the recovery phrase takes an account back, and is spent by doing so', async () => {
  const registered = await call<{ recoveryPhrase: string }>('POST', '/api/auth/register', {
    body: { handle: 'ada', name: 'Ada', password: 'analytical-engine' },
  })
  const phrase = registered.body.recoveryPhrase

  const recovered = await call<{ token: string; recoveryPhrase: string }>(
    'POST',
    '/api/auth/recover',
    { body: { handle: 'ada', phrase, password: 'a-second-passphrase' } },
  )
  assert.equal(recovered.status, 200)
  assert.notEqual(recovered.body.recoveryPhrase, phrase, 'a used phrase must be replaced')

  const signedIn = await call('POST', '/api/auth/login', {
    body: { handle: 'ada', password: 'a-second-passphrase' },
  })
  assert.equal(signedIn.status, 200)

  const reused = await call('POST', '/api/auth/recover', {
    body: { handle: 'ada', phrase, password: 'a-third-passphrase' },
  })
  assert.equal(reused.status, 401, 'the old phrase must not work twice')
})

test('the recovery phrase is read loosely, but not guessed', async () => {
  const registered = await call<{ recoveryPhrase: string }>('POST', '/api/auth/register', {
    body: { handle: 'ada', name: 'Ada', password: 'analytical-engine' },
  })
  const shouted = registered.body.recoveryPhrase.toUpperCase().replace(/-/g, ' ')
  const reply = await call('POST', '/api/auth/recover', {
    body: { handle: 'ada', phrase: shouted, password: 'a-second-passphrase' },
  })
  assert.equal(reply.status, 200, 'case and separators should not matter')

  const wrong = await call('POST', '/api/auth/recover', {
    body: { handle: 'ada', phrase: 'aaaaa-bbbbb-ccccc-ddddd', password: 'nope-nope-nope' },
  })
  assert.equal(wrong.status, 401)
})

test('a cross-origin caller is not welcomed by default', async () => {
  const reply = await call('GET', '/api/health', {
    headers: { origin: 'https://somewhere.example' },
  })
  assert.equal(reply.headers['access-control-allow-origin'], undefined)
})
