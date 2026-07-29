import { after, before, beforeEach, test } from 'node:test'
import assert from 'node:assert/strict'
import WebSocket from 'ws'
import { call, register, socketOrigin, start, stop, wipe } from './harness.js'

before(start)
after(stop)
beforeEach(wipe)

type Frame = Record<string, unknown> & { t: string }

/** A socket that remembers what it was told, so tests can wait for a frame. */
class Client {
  private socket: WebSocket
  private seen: Frame[] = []
  private waiters: { match: (f: Frame) => boolean; settle: (f: Frame) => void }[] = []

  constructor() {
    this.socket = new WebSocket(`${socketOrigin()}/socket`)
    this.socket.on('message', (data) => {
      const frame = JSON.parse(String(data)) as Frame
      this.seen.push(frame)
      for (const waiter of [...this.waiters]) {
        if (waiter.match(frame)) {
          this.waiters.splice(this.waiters.indexOf(waiter), 1)
          waiter.settle(frame)
        }
      }
    })
  }

  async open(): Promise<this> {
    if (this.socket.readyState !== WebSocket.OPEN) {
      await new Promise((resolve, reject) => {
        this.socket.once('open', resolve)
        this.socket.once('error', reject)
      })
    }
    return this
  }

  send(frame: Record<string, unknown>): void {
    this.socket.send(JSON.stringify(frame))
  }

  /** Resolves on the first matching frame, past or future. */
  expect(type: string, timeout = 2000): Promise<Frame> {
    const match = (f: Frame) => f.t === type
    const already = this.seen.find(match)
    if (already) return Promise.resolve(already)
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`no ${type} frame within ${timeout}ms`)), timeout)
      this.waiters.push({
        match,
        settle: (f) => {
          clearTimeout(timer)
          resolve(f)
        },
      })
    })
  }

  closed(): Promise<number> {
    if (this.socket.readyState === WebSocket.CLOSED) return Promise.resolve(0)
    return new Promise((resolve) => this.socket.once('close', (code) => resolve(code)))
  }

  close(): void {
    this.socket.close()
  }
}

const connect = async (token: string) => {
  const client = await new Client().open()
  client.send({ t: 'hello', token })
  await client.expect('ready')
  return client
}

test('a socket that never says hello is dropped, and a bad token is refused', async () => {
  const silent = await new Client().open()
  silent.send({ t: 'hello', token: 'not-a-real-token' })
  const problem = await silent.expect('error')
  assert.equal(problem.message, 'session expirée')
  assert.ok(await silent.closed())
})

test('a message sent on the socket reaches the other side', async () => {
  const ada = await register('ada')
  const alan = await register('alan')
  const opened = await call<{ conversation: { id: string } }>('POST', '/api/conversations', {
    token: ada.token,
    body: { handle: 'alan' },
  })
  const conversation = opened.body.conversation.id

  const adaSocket = await connect(ada.token)
  const alanSocket = await connect(alan.token)

  adaSocket.send({
    t: 'send',
    conversation,
    body: 'les nombres de Bernoulli',
    replyTo: null,
    nonce: 'pending:1',
  })

  const echo = await adaSocket.expect('message')
  assert.equal(echo.nonce, 'pending:1', 'the sender needs the nonce to reconcile')

  const delivered = await alanSocket.expect('message')
  assert.equal((delivered.message as { body: string }).body, 'les nombres de Bernoulli')

  adaSocket.close()
  alanSocket.close()
})

test('an edit travels as a revision, not as a new message', async () => {
  const ada = await register('ada')
  const alan = await register('alan')
  const opened = await call<{ conversation: { id: string } }>('POST', '/api/conversations', {
    token: ada.token,
    body: { handle: 'alan' },
  })
  const conversation = opened.body.conversation.id

  const adaSocket = await connect(ada.token)
  const alanSocket = await connect(alan.token)

  const sent = await call<{ message: { id: string } }>('POST', '/api/messages', {
    token: ada.token,
    body: { conversation, body: 'le compilateur ne tourne pas' },
  })
  await alanSocket.expect('message')

  adaSocket.send({ t: 'revise', message: sent.body.message.id, body: 'le compilateur tourne' })
  const revised = await alanSocket.expect('revised')
  assert.equal((revised.message as { body: string }).body, 'le compilateur tourne')

  adaSocket.close()
  alanSocket.close()
})

test('changing the passphrase closes the sockets the old token was holding', async () => {
  const ada = await register('ada', 'analytical-engine')
  const socket = await connect(ada.token)

  await call('POST', '/api/account/passphrase', {
    token: ada.token,
    body: { current: 'analytical-engine', next: 'a-brand-new-phrase' },
  })

  const code = await socket.closed()
  assert.equal(code, 4003, 'a revoked session must not keep receiving messages')
})

test('a socket cannot post into a conversation it is not part of', async () => {
  const ada = await register('ada')
  const alan = await register('alan')
  const grace = await register('grace')
  const opened = await call<{ conversation: { id: string } }>('POST', '/api/conversations', {
    token: ada.token,
    body: { handle: 'alan' },
  })
  const conversation = opened.body.conversation.id

  const intruder = await connect(grace.token)
  intruder.send({ t: 'send', conversation, body: 'je passais par là', replyTo: null, nonce: 'x' })

  await new Promise((resolve) => setTimeout(resolve, 250))
  const read = await call<{ messages: unknown[] }>(
    'GET',
    `/api/messages?conversation=${conversation}`,
    { token: ada.token },
  )
  assert.equal(read.body.messages.length, 0)
  intruder.close()
})

test('a socket that floods is told to slow down rather than served', async () => {
  const ada = await register('ada')
  const opened = await call<{ conversation: { id: string } }>('POST', '/api/conversations', {
    token: ada.token,
    body: { handle: 'ada' },
  })
  const conversation = opened.body.conversation.id
  const socket = await connect(ada.token)

  for (let i = 0; i < 40; i += 1) {
    socket.send({ t: 'send', conversation, body: `flood ${i}`, replyTo: null, nonce: `n${i}` })
  }

  const problem = await socket.expect('error')
  assert.ok(problem.retryAfter, 'the client should be told how long to wait')
  socket.close()
})
