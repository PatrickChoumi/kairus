import { after, before, beforeEach, test } from 'node:test'
import assert from 'node:assert/strict'
import WebSocket from 'ws'
import { call, db, raw, register, socketOrigin, start, stop, wipe, type Account } from './harness.js'

before(start)
after(stop)
beforeEach(() => {
  wipe()
  db.exec('DELETE FROM attachments')
})

type Frame = Record<string, unknown> & { t: string }
type Msg = {
  id: string
  body: string
  senderId: string
  conversationId: string
  createdAt: number
  attachment: { id: string; name: string } | null
  forwarded: { from: { id: string; name: string }; at: number } | null
}
type Conv = { id: string; pins: Msg[]; draft: string }

/** A socket that can wait on a predicate, not only on a frame type. */
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

  on(type: string, timeout = 2000): Promise<Frame> {
    return this.await((f) => f.t === type, timeout)
  }

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
  await client.on('ready')
  return client
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 120))

const conversationBetween = async (a: Account, handle: string) => {
  const opened = await call<{ conversation: Conv }>('POST', '/api/conversations', {
    token: a.token,
    body: { handle },
  })
  return opened.body.conversation.id
}

const say = async (account: Account, conversation: string, body: string) => {
  const sent = await call<{ message: Msg }>('POST', '/api/messages', {
    token: account.token,
    body: { conversation, body },
  })
  assert.equal(sent.status, 200, JSON.stringify(sent.body))
  return sent.body.message
}

/** Ada and Alan talk; Ada also has a group with Bea. */
const cast = async () => {
  const ada = await register('ada')
  const alan = await register('alan')
  const bea = await register('bea')
  const direct = await conversationBetween(ada, 'alan')
  const group = await call<{ conversation: Conv }>('POST', '/api/groups', {
    token: ada.token,
    body: { title: 'Hut 8', handles: ['bea'] },
  })
  return { ada, alan, bea, direct, group: group.body.conversation.id }
}

/* -------------------------------------------------------------- forwarding */

test('a forwarded message credits whoever said it first', async () => {
  const { ada, alan, direct, group } = await cast()
  const original = await say(alan, direct, 'le compilateur tourne')

  const sent = await call<{ message: Msg }>('POST', '/api/messages/forward', {
    token: ada.token,
    body: { message: original.id, conversation: group },
  })

  assert.equal(sent.status, 200)
  assert.equal(sent.body.message.body, 'le compilateur tourne')
  assert.equal(sent.body.message.conversationId, group)
  // Sent by Ada, but the words are Alan's and the interface must say so.
  assert.equal(sent.body.message.senderId, ada.user.id)
  assert.equal(sent.body.message.forwarded?.from.id, alan.user.id)
  // The credit carries the moment it was first said, not the moment it moved.
  assert.equal(sent.body.message.forwarded?.at, original.createdAt)
  assert.ok(sent.body.message.createdAt > original.createdAt - 1)
})

test('forwarding a forward still credits the original author', async () => {
  const { ada, alan, direct, group } = await cast()
  const original = await say(alan, direct, 'deux fois relayé')

  const once = await call<{ message: Msg }>('POST', '/api/messages/forward', {
    token: ada.token,
    body: { message: original.id, conversation: group },
  })
  const twice = await call<{ message: Msg }>('POST', '/api/messages/forward', {
    token: ada.token,
    body: { message: once.body.message.id, conversation: direct },
  })

  assert.equal(twice.status, 200)
  assert.equal(
    twice.body.message.forwarded?.from.id,
    alan.user.id,
    'a chain of forwards must not credit the last relay',
  )
})

test('a forwarded file is a copy, so retracting one leaves the other alone', async () => {
  const { ada, alan, direct, group } = await cast()

  const up = await raw('POST', '/api/files', {
    token: alan.token,
    headers: { 'content-type': 'image/png', 'x-file-name': 'photo.png' },
    body: Buffer.from('some pixels'),
  })
  const { attachment } = (await up.json()) as { attachment: { id: string } }
  const carrier = await call<{ message: Msg }>('POST', '/api/messages', {
    token: alan.token,
    body: { conversation: direct, body: '', attachment: attachment.id },
  })

  const relayed = await call<{ message: Msg }>('POST', '/api/messages/forward', {
    token: ada.token,
    body: { message: carrier.body.message.id, conversation: group },
  })
  assert.equal(relayed.status, 200)
  const copy = relayed.body.message.attachment
  assert.ok(copy, 'the file travels with the forward')
  assert.notEqual(copy.id, attachment.id, 'as a copy, not as a second reference')

  // Alan takes his own back; the copy in the group must survive.
  await call('POST', '/api/messages/retract', {
    token: alan.token,
    body: { message: carrier.body.message.id },
  })
  const original = await raw('GET', `/api/files/${attachment.id}`, { token: alan.token })
  assert.equal(original.status, 404)
  const still = await raw('GET', `/api/files/${copy.id}`, { token: ada.token })
  assert.equal(still.status, 200)
})

test('you cannot forward out of a conversation you are not in', async () => {
  const { alan, bea, direct } = await cast()
  const secret = await say(alan, direct, 'entre nous')
  const elsewhere = await conversationBetween(bea, 'alan')

  const stolen = await call('POST', '/api/messages/forward', {
    token: bea.token,
    body: { message: secret.id, conversation: elsewhere },
  })
  assert.equal(stolen.status, 404)
})

test('you cannot forward into a conversation you are not in', async () => {
  const { ada, alan, bea, direct, group } = await cast()
  const said = await say(alan, direct, 'coucou')
  void ada

  const intruded = await call('POST', '/api/messages/forward', {
    token: alan.token,
    body: { message: said.id, conversation: group },
  })
  assert.equal(intruded.status, 404, 'Alan is not in Hut 8')
  void bea
})

test('a group does not let a newcomer forward what came before them', async () => {
  const { ada, bea, group } = await cast()
  const early = await say(ada, group, 'dit avant son arrivée')
  const carol = await register('carol')
  await call('POST', '/api/groups/members', {
    token: ada.token,
    body: { conversation: group, handle: 'carol' },
  })
  const somewhere = await conversationBetween(carol, 'bea')

  const leaked = await call('POST', '/api/messages/forward', {
    token: carol.token,
    body: { message: early.id, conversation: somewhere },
  })
  assert.equal(leaked.status, 404, 'a forward must not be a way around joined_at')
})

test('a block closes the conversation a forward was aimed at', async () => {
  const { ada, alan, direct, group } = await cast()
  const said = await say(ada, group, 'à relayer')
  await call('POST', '/api/blocks', { token: alan.token, body: { handle: 'ada' } })

  const refused = await call('POST', '/api/messages/forward', {
    token: ada.token,
    body: { message: said.id, conversation: direct },
  })
  assert.equal(refused.status, 403)
})

test('a retracted message is not forwardable', async () => {
  const { ada, direct, group } = await cast()
  const said = await say(ada, group, 'regretté')
  await call('POST', '/api/messages/retract', { token: ada.token, body: { message: said.id } })

  const refused = await call('POST', '/api/messages/forward', {
    token: ada.token,
    body: { message: said.id, conversation: direct },
  })
  assert.equal(refused.status, 409)
})

test('a forward reaches the other side over the socket', async () => {
  const { ada, alan, bea, direct, group } = await cast()
  const said = await say(alan, direct, 'à faire suivre')

  const watcher = await connect(bea.token)
  const forwarder = await connect(ada.token)
  forwarder.send({ t: 'forward', conversation: group, message: said.id, nonce: 'n1' })

  const echoed = await forwarder.on('message')
  assert.equal((echoed as { nonce?: string }).nonce, 'n1')

  const arrived = await watcher.on('message')
  const message = arrived.message as Msg
  assert.equal(message.body, 'à faire suivre')
  assert.equal(message.forwarded?.from.id, alan.user.id)

  watcher.close()
  forwarder.close()
})

/* -------------------------------------------------------------------- pins */

test('a pinned message is kept at the top for everyone in the conversation', async () => {
  const { ada, alan, direct } = await cast()
  const said = await say(alan, direct, 'à retenir')

  const pinned = await call<{ pins: Msg[] }>('POST', '/api/pins', {
    token: ada.token,
    body: { conversation: direct, message: said.id },
  })
  assert.equal(pinned.status, 200)
  assert.equal(pinned.body.pins.length, 1)
  assert.equal(pinned.body.pins[0]?.body, 'à retenir')

  // And the other side sees it in its own view of the conversation.
  const theirs = await call<{ conversations: Conv[] }>('GET', '/api/conversations', {
    token: alan.token,
  })
  const mirror = theirs.body.conversations.find((c) => c.id === direct)
  assert.equal(mirror?.pins.length, 1)
})

test('unpinning takes it back down', async () => {
  const { ada, direct } = await cast()
  const said = await say(ada, direct, 'passager')
  await call('POST', '/api/pins', {
    token: ada.token,
    body: { conversation: direct, message: said.id },
  })

  const down = await call<{ pins: Msg[] }>('POST', '/api/pins', {
    token: ada.token,
    body: { conversation: direct, message: said.id, pinned: false },
  })
  assert.equal(down.body.pins.length, 0)
})

test('retracting a pinned message takes the pin with it', async () => {
  const { ada, direct } = await cast()
  const said = await say(ada, direct, 'épinglé puis retiré')
  await call('POST', '/api/pins', {
    token: ada.token,
    body: { conversation: direct, message: said.id },
  })

  await call('POST', '/api/messages/retract', { token: ada.token, body: { message: said.id } })

  const after = await call<{ conversations: Conv[] }>('GET', '/api/conversations', {
    token: ada.token,
  })
  const conversation = after.body.conversations.find((c) => c.id === direct)
  assert.deepEqual(conversation?.pins, [], 'a pin must never point at a hole')
})

test('a stranger cannot pin in someone else’s conversation', async () => {
  const { ada, bea, direct } = await cast()
  const said = await say(ada, direct, 'privé')

  const refused = await call('POST', '/api/pins', {
    token: bea.token,
    body: { conversation: direct, message: said.id },
  })
  assert.equal(refused.status, 404)
})

test('a message cannot be pinned into a conversation it does not belong to', async () => {
  const { ada, direct, group } = await cast()
  const said = await say(ada, direct, 'ailleurs')

  const refused = await call('POST', '/api/pins', {
    token: ada.token,
    body: { conversation: group, message: said.id },
  })
  assert.equal(refused.status, 404)
})

test('a newcomer does not inherit the pins of what was said before them', async () => {
  const { ada, group } = await cast()
  const early = await say(ada, group, 'avant son arrivée')
  await call('POST', '/api/pins', {
    token: ada.token,
    body: { conversation: group, message: early.id },
  })

  const carol = await register('carol')
  await call('POST', '/api/groups/members', {
    token: ada.token,
    body: { conversation: group, handle: 'carol' },
  })

  const theirs = await call<{ conversations: Conv[] }>('GET', '/api/conversations', {
    token: carol.token,
  })
  const seen = theirs.body.conversations.find((c) => c.id === group)
  assert.deepEqual(seen?.pins, [], 'a pin must not be a way around joined_at either')
})

test('pinning over the socket tells everyone in the conversation', async () => {
  const { ada, alan, direct } = await cast()
  const said = await say(ada, direct, 'à épingler')

  const watcher = await connect(alan.token)
  const pinner = await connect(ada.token)
  pinner.send({ t: 'pin', conversation: direct, message: said.id })

  const told = await watcher.on('pinned')
  assert.equal(told.conversation, direct)
  assert.equal((told.pins as Msg[]).length, 1)

  pinner.send({ t: 'unpin', conversation: direct, message: said.id })
  const cleared = await watcher.await(
    (f) => f.t === 'pinned' && (f.pins as Msg[]).length === 0,
  )
  assert.deepEqual(cleared.pins, [])

  watcher.close()
  pinner.close()
})

/* ------------------------------------------------------------------ drafts */

test('a draft is kept, and comes back with the conversation', async () => {
  const { ada, direct } = await cast()

  const saved = await call<{ at: number }>('POST', '/api/drafts', {
    token: ada.token,
    body: { conversation: direct, body: 'je disais donc' },
  })
  assert.equal(saved.status, 200)
  assert.ok(saved.body.at > 0)

  const mine = await call<{ conversations: Conv[] }>('GET', '/api/conversations', {
    token: ada.token,
  })
  assert.equal(mine.body.conversations.find((c) => c.id === direct)?.draft, 'je disais donc')
})

test('a draft belongs to one person and is never shown to the other', async () => {
  const { ada, alan, direct } = await cast()
  await call('POST', '/api/drafts', {
    token: ada.token,
    body: { conversation: direct, body: 'à moitié écrit' },
  })

  const theirs = await call<{ conversations: Conv[] }>('GET', '/api/conversations', {
    token: alan.token,
  })
  assert.equal(theirs.body.conversations.find((c) => c.id === direct)?.draft, '')
})

test('a draft reaches your other devices, and nobody else’s', async () => {
  const { ada, alan, direct } = await cast()

  const phone = await connect(ada.token)
  const laptop = await connect(ada.token)
  const peer = await connect(alan.token)

  laptop.send({ t: 'draft', conversation: direct, body: 'commencé sur le portable' })

  const synced = await phone.on('draft')
  assert.equal(synced.conversation, direct)
  assert.equal(synced.body, 'commencé sur le portable')

  await settle()
  assert.equal(
    peer.frames.some((f) => f.t === 'draft'),
    false,
    'half a sentence is not for the person you are writing to',
  )
  assert.equal(
    laptop.frames.some((f) => f.t === 'draft'),
    false,
    'and the device that typed it does not need to be told',
  )

  phone.close()
  laptop.close()
  peer.close()
})

test('clearing a draft is just an empty one', async () => {
  const { ada, direct } = await cast()
  await call('POST', '/api/drafts', {
    token: ada.token,
    body: { conversation: direct, body: 'à effacer' },
  })
  await call('POST', '/api/drafts', { token: ada.token, body: { conversation: direct, body: '' } })

  const mine = await call<{ conversations: Conv[] }>('GET', '/api/conversations', {
    token: ada.token,
  })
  assert.equal(mine.body.conversations.find((c) => c.id === direct)?.draft, '')
})

test('a draft cannot be left in a conversation that is not yours', async () => {
  const { bea, direct } = await cast()
  const refused = await call('POST', '/api/drafts', {
    token: bea.token,
    body: { conversation: direct, body: 'intrus' },
  })
  assert.equal(refused.status, 404)
})
