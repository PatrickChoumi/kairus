import { after, before, beforeEach, test } from 'node:test'
import assert from 'node:assert/strict'
import WebSocket from 'ws'
import { call, register, socketOrigin, start, stop, wipe } from './harness.js'

before(start)
after(stop)
beforeEach(wipe)

type Frame = Record<string, unknown> & { t: string }

/**
 * Like the client in the realtime tests, but able to wait on a *predicate*:
 * every frame of a call has the same type and differs only by its act.
 */
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

  await(match: (f: Frame) => boolean, timeout = 2000): Promise<Frame> {
    const already = this.seen.find(match)
    if (already) return Promise.resolve(already)
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`no matching frame in ${timeout}ms`)), timeout)
      this.waiters.push({
        match,
        settle: (f) => {
          clearTimeout(timer)
          resolve(f)
        },
      })
    })
  }

  onCall(act: string, timeout = 2000): Promise<Frame> {
    return this.await((f) => f.t === 'call' && f.act === act, timeout)
  }

  /** Everything received so far — for asserting that nothing arrived. */
  get frames(): Frame[] {
    return this.seen
  }

  close(): void {
    this.socket.close()
  }
}

const connect = async (token: string) => {
  const client = await new Client().open()
  client.send({ t: 'hello', token })
  await client.await((f) => f.t === 'ready')
  return client
}

const pairUp = async () => {
  const ada = await register('ada')
  const alan = await register('alan')
  const opened = await call<{ conversation: { id: string } }>('POST', '/api/conversations', {
    token: ada.token,
    body: { handle: 'alan' },
  })
  return { ada, alan, conversation: opened.body.conversation.id }
}

/** Long enough for a frame that should never come to have failed to come. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 120))

const OFFER = { type: 'offer', sdp: 'v=0\r\no=- 1 1 IN IP4 127.0.0.1\r\n' }

/* ---------------------------------------------------------------- ringing */

test('a ring reaches the other side with the offer untouched', async () => {
  const { ada, alan, conversation } = await pairUp()
  const caller = await connect(ada.token)
  const callee = await connect(alan.token)

  caller.send({ t: 'call', act: 'ring', conversation, call: 'c1', payload: OFFER })

  const rung = await callee.onCall('ring')
  assert.equal(rung.call, 'c1')
  assert.equal(rung.from, ada.user.id)
  assert.deepEqual(rung.payload, OFFER)

  caller.close()
  callee.close()
})

test('the negotiation is carried both ways without being read', async () => {
  const { ada, alan, conversation } = await pairUp()
  const caller = await connect(ada.token)
  const callee = await connect(alan.token)

  caller.send({ t: 'call', act: 'ring', conversation, call: 'c1', payload: OFFER })
  await callee.onCall('ring')

  const answer = { type: 'answer', sdp: 'v=0\r\nanswer\r\n' }
  callee.send({ t: 'call', act: 'accept', conversation, call: 'c1', payload: answer })
  const accepted = await caller.onCall('accept')
  assert.deepEqual(accepted.payload, answer)

  const candidate = { candidate: 'candidate:1 1 udp 2 10.0.0.1 5000 typ host', sdpMLineIndex: 0 }
  caller.send({ t: 'call', act: 'ice', conversation, call: 'c1', payload: candidate })
  const iced = await callee.onCall('ice')
  assert.deepEqual(iced.payload, candidate)

  caller.close()
  callee.close()
})

test('hanging up reaches the other end', async () => {
  const { ada, alan, conversation } = await pairUp()
  const caller = await connect(ada.token)
  const callee = await connect(alan.token)

  caller.send({ t: 'call', act: 'ring', conversation, call: 'c1', payload: OFFER })
  await callee.onCall('ring')
  callee.send({ t: 'call', act: 'decline', conversation, call: 'c1' })

  const declined = await caller.onCall('decline')
  assert.equal(declined.from, alan.user.id)

  caller.close()
  callee.close()
})

/* ------------------------------------------------------------- who may not */

test('ringing someone who is not connected ends it straight away', async () => {
  const { ada, conversation } = await pairUp()
  const caller = await connect(ada.token)

  caller.send({ t: 'call', act: 'ring', conversation, call: 'c1', payload: OFFER })

  // The caller hears back immediately rather than listening to nothing.
  const ended = await caller.onCall('end')
  assert.equal(ended.call, 'c1')

  caller.close()
})

test('a call cannot be signalled into a conversation you are not in', async () => {
  const { ada, alan, conversation } = await pairUp()
  const mallory = await register('mallory')

  const listener = await connect(alan.token)
  const stranger = await connect(mallory.token)
  stranger.send({ t: 'call', act: 'ring', conversation, call: 'c1', payload: OFFER })

  await settle()
  assert.equal(
    listener.frames.some((f) => f.t === 'call'),
    false,
    'a stranger must not be able to make someone else’s phone ring',
  )
  void ada

  listener.close()
  stranger.close()
})

test('a block stops calls in both directions', async () => {
  const { ada, alan, conversation } = await pairUp()
  await call('POST', '/api/blocks', { token: alan.token, body: { handle: 'ada' } })

  const caller = await connect(ada.token)
  const blocker = await connect(alan.token)

  caller.send({ t: 'call', act: 'ring', conversation, call: 'c1', payload: OFFER })
  await settle()
  assert.equal(
    blocker.frames.some((f) => f.t === 'call'),
    false,
    'someone who blocked you cannot be rung',
  )

  blocker.send({ t: 'call', act: 'ring', conversation, call: 'c2', payload: OFFER })
  await settle()
  assert.equal(
    caller.frames.some((f) => f.t === 'call' && f.act === 'ring'),
    false,
    'and the block holds the other way too',
  )

  caller.close()
  blocker.close()
})

test('a group refuses calls rather than ringing everyone', async () => {
  const ada = await register('ada')
  await register('alan')
  const made = await call<{ conversation: { id: string } }>('POST', '/api/groups', {
    token: ada.token,
    body: { title: 'Hut 8', handles: ['alan'] },
  })

  const caller = await connect(ada.token)
  caller.send({
    t: 'call',
    act: 'ring',
    conversation: made.body.conversation.id,
    call: 'c1',
    payload: OFFER,
  })

  const refused = await caller.await((f) => f.t === 'error')
  assert.match(String(refused.message), /groupe/i)

  caller.close()
})

test('an act nobody defined is dropped rather than relayed', async () => {
  const { ada, alan, conversation } = await pairUp()
  const caller = await connect(ada.token)
  const callee = await connect(alan.token)

  caller.send({ t: 'call', act: 'wiretap', conversation, call: 'c1', payload: OFFER })
  await settle()
  assert.equal(
    callee.frames.some((f) => f.t === 'call'),
    false,
  )

  caller.close()
  callee.close()
})

/* -------------------------------------------------------------- ringing off */

test('ringing over and over is slowed down', async () => {
  const { ada, alan, conversation } = await pairUp()
  const caller = await connect(ada.token)
  const callee = await connect(alan.token)

  for (let i = 0; i < 8; i += 1) {
    caller.send({ t: 'call', act: 'ring', conversation, call: `c${i}`, payload: OFFER })
  }

  const refused = await caller.await((f) => f.t === 'error' && typeof f.retryAfter === 'number')
  assert.ok(Number(refused.retryAfter) > 0, 'a refusal always says how long to wait')
  void callee

  caller.close()
  callee.close()
})

/* -------------------------------------------------------------------- ice */

test('the server tells a fresh socket how to find a path', async () => {
  const ada = await register('ada')
  const client = await new Client().open()
  client.send({ t: 'hello', token: ada.token })

  const ready = await client.await((f) => f.t === 'ready')
  assert.ok(Array.isArray(ready.ice), 'a client with no ICE servers cannot call at all')
  assert.ok((ready.ice as unknown[]).length > 0)

  client.close()
})
