import { after, before, beforeEach, test } from 'node:test'
import assert from 'node:assert/strict'
import { call, register, start, stop, wipe } from './harness.js'

before(start)
after(stop)
beforeEach(wipe)

type Msg = {
  id: string
  body: string
  senderId: string
  editedAt: number | null
  deletedAt: number | null
}

const converse = async () => {
  const ada = await register('ada')
  const alan = await register('alan')
  const opened = await call<{ conversation: { id: string } }>('POST', '/api/conversations', {
    token: ada.token,
    body: { handle: 'alan' },
  })
  assert.equal(opened.status, 200)
  return { ada, alan, conversation: opened.body.conversation.id }
}

const say = (token: string, conversation: string, body: string) =>
  call<{ message: Msg }>('POST', '/api/messages', { token, body: { conversation, body } })

test('a message reaches the thread', async () => {
  const { ada, conversation } = await converse()
  const sent = await say(ada.token, conversation, 'les nombres de Bernoulli')
  assert.equal(sent.status, 200)

  const read = await call<{ messages: Msg[] }>(
    'GET',
    `/api/messages?conversation=${conversation}`,
    { token: ada.token },
  )
  assert.equal(read.body.messages.length, 1)
  assert.equal(read.body.messages[0]?.body, 'les nombres de Bernoulli')
})

test('an outsider cannot read a conversation', async () => {
  const { conversation } = await converse()
  const grace = await register('grace')
  const reply = await call('GET', `/api/messages?conversation=${conversation}`, {
    token: grace.token,
  })
  assert.equal(reply.status, 404)
})

test('an outsider cannot post into a conversation', async () => {
  const { conversation } = await converse()
  const grace = await register('grace')
  const reply = await say(grace.token, conversation, 'bonjour')
  assert.equal(reply.status, 404)
})

test('you can rewrite what you said, and it is marked as rewritten', async () => {
  const { ada, conversation } = await converse()
  const sent = await say(ada.token, conversation, 'les nombre de Bernouli')

  const revised = await call<{ message: Msg }>('POST', '/api/messages/revise', {
    token: ada.token,
    body: { message: sent.body.message.id, body: 'les nombres de Bernoulli' },
  })
  assert.equal(revised.status, 200)
  assert.equal(revised.body.message.body, 'les nombres de Bernoulli')
  assert.ok(revised.body.message.editedAt, 'an edit must be visible as an edit')
})

test('you cannot rewrite someone else’s words', async () => {
  const { ada, alan, conversation } = await converse()
  const sent = await say(ada.token, conversation, 'le compilateur tourne')

  const reply = await call('POST', '/api/messages/revise', {
    token: alan.token,
    body: { message: sent.body.message.id, body: 'le compilateur ne tourne pas' },
  })
  assert.equal(reply.status, 403)
})

test('retracting empties a message but keeps the hole', async () => {
  const { ada, conversation } = await converse()
  const sent = await say(ada.token, conversation, 'à supprimer')

  const retracted = await call<{ message: Msg }>('POST', '/api/messages/retract', {
    token: ada.token,
    body: { message: sent.body.message.id },
  })
  assert.equal(retracted.status, 200)
  assert.equal(retracted.body.message.body, '')
  assert.ok(retracted.body.message.deletedAt)

  const read = await call<{ messages: Msg[] }>(
    'GET',
    `/api/messages?conversation=${conversation}`,
    { token: ada.token },
  )
  assert.equal(read.body.messages.length, 1, 'the row survives so replies still resolve')
  assert.equal(read.body.messages[0]?.body, '')
})

test('a retracted message cannot be rewritten back into existence', async () => {
  const { ada, conversation } = await converse()
  const sent = await say(ada.token, conversation, 'à supprimer')
  await call('POST', '/api/messages/retract', {
    token: ada.token,
    body: { message: sent.body.message.id },
  })
  const reply = await call('POST', '/api/messages/revise', {
    token: ada.token,
    body: { message: sent.body.message.id, body: 'ressuscité' },
  })
  assert.equal(reply.status, 409)
})

test('search finds a message, and only in your own conversations', async () => {
  const { ada, conversation } = await converse()
  await say(ada.token, conversation, 'le compilateur tourne enfin')

  const mine = await call<{ hits: { message: Msg }[] }>('GET', '/api/search?q=compilateur', {
    token: ada.token,
  })
  assert.equal(mine.status, 200)
  assert.equal(mine.body.hits.length, 1)

  const grace = await register('grace')
  const theirs = await call<{ hits: unknown[] }>('GET', '/api/search?q=compilateur', {
    token: grace.token,
  })
  assert.equal(theirs.body.hits.length, 0, 'search must not leak other people’s threads')
})

test('search matches a prefix, so it works while you type', async () => {
  const { ada, conversation } = await converse()
  await say(ada.token, conversation, 'le compilateur tourne enfin')
  const reply = await call<{ hits: unknown[] }>('GET', '/api/search?q=compil', {
    token: ada.token,
  })
  assert.equal(reply.body.hits.length, 1)
})

test('search survives what people actually type', async () => {
  const { ada, conversation } = await converse()
  await say(ada.token, conversation, 'rendez-vous à 14h ?')
  for (const q of ['"', 'OR AND', 'rendez-vous', '((', '*', 'à 14h']) {
    const reply = await call('GET', `/api/search?q=${encodeURIComponent(q)}`, {
      token: ada.token,
    })
    assert.equal(reply.status, 200, `query ${q} should not break the endpoint`)
  }
})

test('a retracted message drops out of the index', async () => {
  const { ada, conversation } = await converse()
  const sent = await say(ada.token, conversation, 'un secret indexable')
  await call('POST', '/api/messages/retract', {
    token: ada.token,
    body: { message: sent.body.message.id },
  })
  const reply = await call<{ hits: unknown[] }>('GET', '/api/search?q=indexable', {
    token: ada.token,
  })
  assert.equal(reply.body.hits.length, 0)
})

test('flooding a conversation is throttled', async () => {
  const { ada, conversation } = await converse()
  let refusedAt = -1
  for (let i = 0; i < 60; i += 1) {
    const reply = await say(ada.token, conversation, `message ${i}`)
    if (reply.status === 429) {
      refusedAt = i
      break
    }
    assert.equal(reply.status, 200)
  }
  assert.notEqual(refusedAt, -1, 'a flood must eventually be refused')
  assert.ok(refusedAt >= 20, 'a normal burst must still get through')
})

test('opening a conversation with yourself is allowed and stays one thread', async () => {
  const ada = await register('ada')
  const first = await call<{ conversation: { id: string } }>('POST', '/api/conversations', {
    token: ada.token,
    body: { handle: 'ada' },
  })
  const second = await call<{ conversation: { id: string } }>('POST', '/api/conversations', {
    token: ada.token,
    body: { handle: 'ada' },
  })
  assert.equal(first.status, 200)
  assert.equal(first.body.conversation.id, second.body.conversation.id)
})
