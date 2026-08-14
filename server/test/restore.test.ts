import { after, before, beforeEach, test } from 'node:test'
import assert from 'node:assert/strict'
import { spawn, type ChildProcess } from 'node:child_process'
import { copyFileSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { call, register, start, stop, wipe } from './harness.js'
import { takeBackup } from '../src/backup.js'

/*
 * Restoring a backup.
 *
 * A snapshot that has never been restored is not a backup, it is a hope. The
 * existing case proves the file *contains* the rows; this one proves the
 * documented procedure produces a server people can actually use — a real
 * process, booted against the restored file, answering with the sessions that
 * existed before the disaster.
 */

before(start)
after(stop)
beforeEach(wipe)

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')

/** Boots a real server against a data directory, and waits for it to answer. */
async function boot(dataDir: string, port: number): Promise<ChildProcess> {
  const child = spawn(
    process.execPath,
    ['--import', 'tsx', join(root, 'src', 'index.ts')],
    {
      cwd: root,
      env: {
        ...process.env,
        NODE_ENV: 'test',
        DATA_DIR: dataDir,
        PORT: String(port),
        HOST: '127.0.0.1',
        // The same secret, or every session from before the restore would die
        // — which is exactly the failure a restore is meant to avoid.
        JWT_SECRET: process.env.JWT_SECRET,
        BACKUP_DIR: '',
        LOG_LEVEL: 'error',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  )

  const deadline = Date.now() + 30_000
  for (;;) {
    if (child.exitCode !== null) throw new Error(`the restored server exited: ${child.exitCode}`)
    try {
      const response = await fetch(`http://127.0.0.1:${port}/api/health`)
      if (response.ok) return child
    } catch {
      // Not listening yet.
    }
    if (Date.now() > deadline) {
      child.kill('SIGKILL')
      throw new Error('the restored server never started')
    }
    await new Promise((resolve) => setTimeout(resolve, 150))
  }
}

const hush = (child: ChildProcess) =>
  new Promise<void>((resolve) => {
    if (child.exitCode !== null) return resolve()
    child.once('exit', () => resolve())
    child.kill('SIGTERM')
    setTimeout(() => child.kill('SIGKILL'), 4000).unref?.()
  })

test('a snapshot restores into a server that still knows everyone', async () => {
  /* -- before the disaster ------------------------------------------------ */
  const ada = await register('ada')
  await register('alan')
  const opened = await call<{ conversation: { id: string } }>('POST', '/api/conversations', {
    token: ada.token,
    body: { handle: 'alan' },
  })
  const conversationId = opened.body.conversation.id
  await call('POST', '/api/messages', {
    token: ada.token,
    body: { conversation: conversationId, body: 'ce qu’il ne faut pas perdre' },
  })

  const snapshots = mkdtempSync(join(tmpdir(), 'kairus-snap-'))
  const restored = mkdtempSync(join(tmpdir(), 'kairus-restored-'))
  let child: ChildProcess | null = null

  try {
    const snapshot = await takeBackup(snapshots)

    // This is the whole documented procedure: put the snapshot where the
    // database lives, under the name the server expects, and start it.
    copyFileSync(snapshot.database, join(restored, 'kairus.db'))

    const port = 4700 + Math.floor(Math.random() * 200)
    child = await boot(restored, port)
    const at = (path: string) =>
      fetch(`http://127.0.0.1:${port}${path}`, {
        headers: { authorization: `Bearer ${ada.token}` },
      })

    // The session minted before the backup still opens the door.
    const me = await at('/api/me')
    assert.equal(me.status, 200, 'a token from before the restore must still work')
    const identity = (await me.json()) as { user: { handle: string } }
    assert.equal(identity.user.handle, 'ada')

    const conversations = await at('/api/conversations')
    assert.equal(conversations.status, 200)
    const listed = (await conversations.json()) as {
      conversations: { id: string; face: { name: string } }[]
    }
    assert.equal(listed.conversations.length, 1)
    assert.equal(listed.conversations[0]?.id, conversationId)

    const messages = await at(`/api/messages?conversation=${conversationId}`)
    const said = (await messages.json()) as { messages: { body: string }[] }
    assert.equal(said.messages.length, 1)
    assert.equal(said.messages[0]?.body, 'ce qu’il ne faut pas perdre')

    // And it is a live database, not a museum piece: it still takes writes.
    const written = await fetch(`http://127.0.0.1:${port}/api/messages`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${ada.token}`,
      },
      body: JSON.stringify({ conversation: conversationId, body: 'et la suite' }),
    })
    assert.equal(written.status, 200, 'a restored database must still accept writes')
  } finally {
    if (child) await hush(child)
    rmSync(snapshots, { recursive: true, force: true })
    rmSync(restored, { recursive: true, force: true })
  }
})
