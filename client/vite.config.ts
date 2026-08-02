import { createHash } from 'node:crypto'
import { readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'

const target = process.env.VITE_DEV_SERVER ?? 'http://localhost:4000'

/**
 * Stamps the build.
 *
 * Two problems this solves, both of the "why am I looking at an old version"
 * family. The service worker's cache names were fixed strings, so the purge in
 * its `activate` handler had nothing to purge and every deployment inherited
 * the previous one's caches. And there was no way, from outside, to tell which
 * build a server was actually serving — which turns a deployment question into
 * guesswork.
 *
 * The identifier is derived from the emitted file names, which are content
 * hashes: it changes when, and only when, the application changed. A commit
 * SHA is preferred when the host provides one, because it is the thing a human
 * can compare against `git log`.
 */
function stamp(): Plugin {
  return {
    name: 'kairus-build-stamp',
    apply: 'build',
    closeBundle() {
      const dist = join(process.cwd(), 'dist')
      const assets = readdirSync(join(dist, 'assets')).sort().join('|')
      const fromHost =
        process.env.RAILWAY_GIT_COMMIT_SHA ??
        process.env.SOURCE_COMMIT ??
        process.env.GITHUB_SHA ??
        ''
      const id = (fromHost || createHash('sha256').update(assets).digest('hex')).slice(0, 12)

      // What the server reports, so a deployment can be checked with curl.
      writeFileSync(join(dist, 'build.txt'), id, 'utf8')

      // What the service worker names its caches, so a new build starts clean.
      const worker = join(dist, 'sw.js')
      writeFileSync(worker, readFileSync(worker, 'utf8').replaceAll('__BUILD__', id), 'utf8')

      // And what the page itself says, for anyone reading the source.
      const shell = join(dist, 'index.html')
      writeFileSync(
        shell,
        readFileSync(shell, 'utf8').replace(
          '</head>',
          `  <meta name="kairus-build" content="${id}" />\n  </head>`,
        ),
        'utf8',
      )

      console.log(`build ${id}`)
    },
  }
}

export default defineConfig({
  plugins: [react(), stamp()],
  server: {
    port: 5173,
    proxy: {
      '/api': { target, changeOrigin: true },
      '/socket': { target, ws: true, changeOrigin: true },
    },
  },
  build: {
    target: 'es2022',
    sourcemap: true,
  },
})
