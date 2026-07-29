import { createServer } from 'node:http'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { env } from './env.js'
import { route } from './router.js'
import { attachRealtime } from './realtime.js'
import { serveClient } from './static.js'
import { applySecurityHeaders } from './headers.js'
import { startBackups } from './backup.js'
import { startFileSweeper } from './files.js'
import { log } from './log.js'
import { pushEnabled } from './push.js'

const here = dirname(fileURLToPath(import.meta.url))
const clientRoot = process.env.CLIENT_DIST ?? resolve(here, '../../client/dist')
const static_ = serveClient(clientRoot)

const server = createServer((req, res) => {
  void route(req, res).then((handled) => {
    if (handled) return
    // route() applies them itself; the client and the 404 need them too.
    applySecurityHeaders(req, res)
    if (static_(req, res)) return
    res.writeHead(404, { 'content-type': 'text/plain' }).end('not found')
  })
})

const closeRealtime = attachRealtime(server, env.trustProxy)
const stopBackups = startBackups()
const stopSweeper = startFileSweeper()

server.listen(env.port, env.host, () => {
  log.info('listening', { host: env.host, port: env.port, push: pushEnabled })
})

const shutdown = () => {
  log.info('shutting down')
  stopBackups()
  stopSweeper()
  closeRealtime()
  server.close(() => process.exit(0))
  setTimeout(() => process.exit(0), 5_000).unref()
}
process.on('SIGTERM', shutdown)
process.on('SIGINT', shutdown)
