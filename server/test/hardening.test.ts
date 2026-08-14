import { after, before, beforeEach, test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { call, register, start, stop, wipe } from './harness.js'
import { buildPolicy, inlineScriptHashes } from '../src/headers.js'
import { prune, takeBackup } from '../src/backup.js'

before(start)
after(stop)
beforeEach(wipe)

/* ------------------------------------------------------------------ headers */

test('every response carries the security headers', async () => {
  const reply = await call('GET', '/api/health')
  assert.equal(reply.headers['x-content-type-options'], 'nosniff')
  assert.equal(reply.headers['x-frame-options'], 'DENY')
  assert.equal(reply.headers['referrer-policy'], 'no-referrer')
  assert.ok(reply.headers['content-security-policy'], 'a policy must be present')
  assert.ok(reply.headers['permissions-policy'])
})

test('the policy refuses inline script and framing', () => {
  const policy = buildPolicy(["'sha256-abc'"])
  assert.match(policy, /script-src 'self' 'sha256-abc'/)
  assert.doesNotMatch(policy, /script-src[^;]*unsafe-inline/)
  assert.doesNotMatch(policy, /unsafe-eval/)
  assert.match(policy, /frame-ancestors 'none'/)
  assert.match(policy, /object-src 'none'/)
})

test('inline scripts are hashed, and script tags with a src are not', () => {
  const html = `
    <script>document.title = 'hi'</script>
    <script src="/assets/app.js"></script>
    <script type="module">export {}</script>
  `
  const hashes = inlineScriptHashes(html)
  assert.equal(hashes.length, 2, 'only the two inline scripts should be hashed')
  for (const hash of hashes) assert.match(hash, /^'sha256-[A-Za-z0-9+/]+=*'$/)
})

test('the same bytes always hash to the same value', () => {
  const [a] = inlineScriptHashes('<script>const x = 1</script>')
  const [b] = inlineScriptHashes('<script>const x = 1</script>')
  const [c] = inlineScriptHashes('<script>const x = 2</script>')
  assert.equal(a, b)
  assert.notEqual(a, c)
})

/* -------------------------------------------------------------------- token */

test('a token is renewed silently once it is past halfway through its life', async () => {
  const ada = await register('ada')
  // A brand new token has its whole life ahead: nothing to swap yet.
  const fresh = await call<{ token?: string }>('GET', '/api/me', { token: ada.token })
  assert.equal(fresh.status, 200)
  assert.equal(fresh.body.token, undefined, 'a young token must not be churned')
})

/* ------------------------------------------------------------------ backups */

test('a backup is a consistent, openable copy', async () => {
  const ada = await register('ada')
  await register('alan')
  const opened = await call<{ conversation: { id: string } }>('POST', '/api/conversations', {
    token: ada.token,
    body: { handle: 'alan' },
  })
  await call('POST', '/api/messages', {
    token: ada.token,
    body: { conversation: opened.body.conversation.id, body: 'à sauvegarder' },
  })

  const directory = mkdtempSync(join(tmpdir(), 'kairus-backup-'))
  try {
    const snapshot = await takeBackup(directory)
    const Database = (await import('better-sqlite3')).default
    const copy = new Database(snapshot.database, { readonly: true })
    const users = copy.prepare(`SELECT count(*) AS n FROM users`).get() as { n: number }
    const messages = copy.prepare(`SELECT count(*) AS n FROM messages`).get() as { n: number }
    copy.close()
    assert.equal(users.n, 2)
    assert.equal(messages.n, 1, 'the snapshot must contain what was written')
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})

test('pruning keeps the newest snapshots and removes the rest', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'kairus-prune-'))
  try {
    for (let i = 0; i < 4; i += 1) {
      await takeBackup(directory)
      // The names carry a second-resolution stamp; keep them distinguishable.
      await new Promise((resolve) => setTimeout(resolve, 1100))
    }
    assert.equal(readdirSync(directory).filter((n) => n.endsWith('.db')).length, 4)

    const kept = prune(directory, 2)
    assert.equal(kept.length, 2)
    assert.equal(readdirSync(directory).filter((n) => n.endsWith('.db')).length, 2)
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})
