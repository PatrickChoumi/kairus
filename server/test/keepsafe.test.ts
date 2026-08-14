import { after, before, beforeEach, test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { call, raw, register, start, stop, wipe } from './harness.js'
import { prune, takeBackup } from '../src/backup.js'

before(start)
after(stop)
beforeEach(wipe)

/*
 * A backup that restores into broken images is not a backup.
 *
 * The database only points at the photographs and the voice messages; the
 * bytes are files on disk. Snapshotting the database alone produces something
 * that looks restored and is not — every attachment a grey rectangle — which
 * is worse than an honest total loss, because nobody notices in time.
 */

test('a snapshot carries the files the database points at', async () => {
  const ada = await register('ada')
  await register('alan')
  const opened = await call<{ conversation: { id: string } }>('POST', '/api/conversations', {
    token: ada.token,
    body: { handle: 'alan' },
  })

  const bytes = Buffer.from('les pixels qu’il ne faut pas perdre')
  const up = await raw('POST', '/api/files', {
    token: ada.token,
    headers: { 'content-type': 'image/png', 'x-file-name': 'photo.png' },
    body: bytes,
  })
  const { attachment } = (await up.json()) as { attachment: { id: string } }
  await call('POST', '/api/messages', {
    token: ada.token,
    body: { conversation: opened.body.conversation.id, body: '', attachment: attachment.id },
  })

  const directory = mkdtempSync(join(tmpdir(), 'kairus-keep-'))
  try {
    const snapshot = await takeBackup(directory)

    assert.ok(existsSync(snapshot.database), 'the database is there')
    assert.equal(snapshot.blobs, 1, 'and so is the file it points at')

    const kept = join(snapshot.files, attachment.id)
    assert.ok(existsSync(kept), 'the attachment must be inside the snapshot')
    assert.deepEqual(readFileSync(kept), bytes, 'byte for byte')

    // The database in the snapshot still names it, so the two halves agree.
    const Database = (await import('better-sqlite3')).default
    const copy = new Database(snapshot.database, { readonly: true })
    const row = copy.prepare(`SELECT id FROM attachments WHERE id = ?`).get(attachment.id)
    copy.close()
    assert.ok(row, 'a row without its bytes would be the whole problem')
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})

test('a second snapshot of the same files costs almost nothing', async () => {
  const ada = await register('ada')
  await raw('POST', '/api/files', {
    token: ada.token,
    headers: { 'content-type': 'image/png', 'x-file-name': 'lourd.png' },
    body: Buffer.alloc(64 * 1024, 7),
  })

  const directory = mkdtempSync(join(tmpdir(), 'kairus-links-'))
  try {
    const first = await takeBackup(directory)
    await new Promise((resolve) => setTimeout(resolve, 1100))
    const second = await takeBackup(directory)

    const one = statSync(join(first.files, readdirSync(first.files)[0] as string))
    const two = statSync(join(second.files, readdirSync(second.files)[0] as string))

    // Same inode: the bytes exist once, however many snapshots hold them.
    assert.equal(one.ino, two.ino, 'snapshots must share the blobs, not copy them')
    assert.ok(one.nlink >= 3, 'the live file and both snapshots')
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})

test('pruning takes each snapshot’s files with it, and leaves no orphans', async () => {
  const ada = await register('ada')
  await raw('POST', '/api/files', {
    token: ada.token,
    headers: { 'content-type': 'image/png', 'x-file-name': 'photo.png' },
    body: Buffer.from('quelques octets'),
  })

  const directory = mkdtempSync(join(tmpdir(), 'kairus-prune-files-'))
  try {
    for (let i = 0; i < 3; i += 1) {
      await takeBackup(directory)
      // The names carry a second-resolution stamp; keep them distinguishable.
      if (i < 2) await new Promise((resolve) => setTimeout(resolve, 1100))
    }
    assert.equal(readdirSync(directory).length, 6, 'three databases and three directories')

    const kept = prune(directory, 1)
    assert.equal(kept.length, 1)

    const left = readdirSync(directory).sort()
    assert.equal(left.length, 2, 'one database, one directory of files')
    const [database, files] = left
    assert.ok(database?.endsWith('.db'))
    assert.equal(files, `${database.slice(0, -3)}.files`, 'the pair must stay a pair')
    assert.ok(
      readdirSync(join(directory, files as string)).length > 0,
      'the surviving snapshot keeps its files — pruning must not gut what it keeps',
    )
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})
