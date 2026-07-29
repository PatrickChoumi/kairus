import { createServer } from 'node:http'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { env } from './env.js'
import { route } from './router.js'
import { attachRealtime } from './realtime.js'
import { serveClient } from './static.js'

const here = dirname(fileURLToPath(import.meta.url))
const clientRoot = process.env.CLIENT_DIST ?? resolve(here, '../../client/dist')
const static_ = serveClient(clientRoot)

const server = createServer((req, res) => {
  void route(req, res).then((handled) => {
    if (handled) return
    if (static_(req, res)) return
    res.writeHead(404, { 'content-type': 'text/plain' }).end('not found')
  })
})

const closeRealtime = attachRealtime(server, env.trustProxy)

server.listen(env.port, env.host, () => {
  console.log(`[kairus] listening on http://${env.host}:${env.port}`)
})

const shutdown = () => {
  closeRealtime()
  server.close(() => process.exit(0))
  setTimeout(() => process.exit(0), 5_000).unref()
}
process.on('SIGTERM', shutdown)
process.on('SIGINT', shutdown)
