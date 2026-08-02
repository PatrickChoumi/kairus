import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/*
 * The service worker, read as text.
 *
 * It cannot be imported — it runs in a worker global that jsdom does not
 * have — but the two mistakes it made were both visible in the source, and
 * both cost a deployment that appeared to change nothing:
 *
 *   1. Fixed cache names. The purge in `activate` removes every cache whose
 *      name is not the current one; with a constant name there was never
 *      anything to remove, so each deployment inherited its predecessor's.
 *   2. Cache-first on files whose names do not change between builds. The
 *      icons and the manifest were frozen for anyone who had visited once.
 *
 * A regression on either is silent — the application keeps working, it just
 * shows the wrong version — so it is worth pinning here.
 */

const source = readFileSync(join(process.cwd(), 'public', 'sw.js'), 'utf8')

describe('the service worker', () => {
  it('names its caches after the build', () => {
    expect(source).toContain("const BUILD = '__BUILD__'")
    expect(source).toMatch(/const SHELL = `kairus-shell-\$\{BUILD\}`/)
    expect(source).toMatch(/const RUNTIME = `kairus-runtime-\$\{BUILD\}`/)

    // And no cache is ever opened under a name that skips the build.
    const opened = [...source.matchAll(/caches\.open\(([^)]*)\)/g)].map((m) => m[1]?.trim())
    expect(opened.length).toBeGreaterThan(0)
    expect(new Set(opened)).toEqual(new Set(['SHELL', 'RUNTIME']))
  })

  it('purges every cache that is not one of the current build', () => {
    expect(source).toMatch(/keys\.filter\(\(key\) => key !== SHELL && key !== RUNTIME\)/)
    expect(source).toContain('caches.delete(key)')
  })

  it('serves hashed assets from the cache and everything else from the network', () => {
    const fetchHandler = source.slice(source.indexOf("addEventListener('fetch'"))

    // Cache-first is allowed under /assets/, where the name is a content hash.
    const hashed = fetchHandler.indexOf("url.pathname.startsWith('/assets/')")
    expect(hashed).toBeGreaterThan(-1)
    expect(fetchHandler.slice(hashed, hashed + 400)).toMatch(/caches\.match\(request\)/)

    // After that branch returns, nothing may reach for the cache before the
    // network — that is what froze the icons and the manifest.
    const rest = fetchHandler.slice(fetchHandler.indexOf('return', hashed))
    const network = rest.indexOf('fetch(request)')
    const cache = rest.indexOf('caches.match(request)')
    expect(network).toBeGreaterThan(-1)
    expect(cache).toBeGreaterThan(network)
    expect(rest.slice(network, cache)).toContain('.catch(')
  })

  it('never touches the API or the socket', () => {
    expect(source).toContain("url.pathname.startsWith('/api/')")
    expect(source).toContain("url.pathname.startsWith('/socket')")
  })
})
