import { after, before, test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { once } from 'node:events'
import { call, start, stop } from './harness.js'
import { builtVersion, serveClient } from '../src/static.js'

before(start)
after(stop)

/*
 * Which version is actually running.
 *
 * This exists because of a real afternoon spent redeploying and squinting at
 * the interface for a difference. "Old version showing" has two causes — the
 * host never took the new code, or the browser is holding the old one — and
 * they have opposite remedies. Guessing between them is expensive; asking is
 * one request.
 */

/** A directory shaped like a client build, without running one. */
function fakeBuild(id: string | null): string {
  const dir = mkdtempSync(join(tmpdir(), 'kairus-dist-'))
  writeFileSync(join(dir, 'index.html'), '<!doctype html><title>k</title>')
  mkdirSync(join(dir, 'assets'))
  writeFileSync(join(dir, 'assets', 'index-abc123.js'), 'console.log(1)')
  writeFileSync(join(dir, 'mark.svg'), '<svg />')
  if (id !== null) writeFileSync(join(dir, 'build.txt'), `${id}\n`)
  return dir
}

test('the health check names the build it is serving', async () => {
  const dist = fakeBuild('deadbeef1234')
  try {
    serveClient(dist)
    assert.equal(builtVersion(), 'deadbeef1234')

    const reply = await call<{ ok: boolean; build: string; startedAt: number }>(
      'GET',
      '/api/health',
    )
    assert.equal(reply.status, 200)
    assert.equal(reply.body.ok, true)
    assert.equal(reply.body.build, 'deadbeef1234', 'without this, a deployment cannot be checked')
    assert.ok(reply.body.startedAt <= Date.now(), 'a restart must be visible from outside')
  } finally {
    rmSync(dist, { recursive: true, force: true })
  }
})

test('a client built without a stamp admits it rather than inventing one', () => {
  const dist = fakeBuild(null)
  try {
    serveClient(dist)
    assert.equal(builtVersion(), 'inconnu', 'an answered version must describe what is served')
  } finally {
    rmSync(dist, { recursive: true, force: true })
  }
})

/* ------------------------------------------------------------------ caching */

async function fetchFrom(dist: string, path: string) {
  const handle = serveClient(dist)
  const server = createServer((req, res) => {
    if (!handle(req, res)) res.writeHead(404).end()
  })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const { port } = server.address() as AddressInfo
  try {
    return await fetch(`http://127.0.0.1:${port}${path}`)
  } finally {
    server.closeAllConnections?.()
    server.close()
  }
}

test('hashed assets are cached forever and everything else never is', async () => {
  const dist = fakeBuild('cafebabe5678')
  try {
    const asset = await fetchFrom(dist, '/assets/index-abc123.js')
    assert.equal(
      asset.headers.get('cache-control'),
      'public, max-age=31536000, immutable',
      'the file name is a content hash: a cache hit can never be wrong',
    )

    // The shell, the icons, the manifest: same name from one build to the
    // next, so a long cache on any of them is a permanent freeze.
    for (const path of ['/', '/mark.svg']) {
      const stable = await fetchFrom(dist, path)
      assert.equal(stable.headers.get('cache-control'), 'no-cache', `${path} must be revalidated`)
    }
  } finally {
    rmSync(dist, { recursive: true, force: true })
  }
})
