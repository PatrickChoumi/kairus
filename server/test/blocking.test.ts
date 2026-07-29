import { after, before, beforeEach, test } from 'node:test'
import assert from 'node:assert/strict'
import { call, register, start, stop, wipe } from './harness.js'

before(start)
after(stop)
beforeEach(wipe)

type Person = { id: string; handle: string; name: string }

const open = (token: string, handle: string) =>
  call<{ conversation: { id: string } }>('POST', '/api/conversations', {
    token,
    body: { handle },
  })

test('a stranger is only found by their exact handle, never by a fragment', async () => {
  const ada = await register('ada')
  await register('alanturing')

  const fragment = await call<{ people: Person[] }>('GET', '/api/people?q=alan', {
    token: ada.token,
  })
  assert.equal(fragment.body.people.length, 0, 'the directory must not be enumerable')

  const exact = await call<{ people: Person[] }>('GET', '/api/people?q=alanturing', {
    token: ada.token,
  })
  assert.equal(exact.body.people.length, 1, 'a handle you were given still resolves')
})

test('once you share a conversation, loose search comes back', async () => {
  const ada = await register('ada')
  await register('alanturing')
  await open(ada.token, 'alanturing')

  const fragment = await call<{ people: Person[] }>('GET', '/api/people?q=alan', {
    token: ada.token,
  })
  assert.equal(fragment.body.people.length, 1, 'people you know stay easy to find')
})

test('blocking hides someone from search, in both directions', async () => {
  const ada = await register('ada')
  const alan = await register('alan')
  await open(ada.token, 'alan')

  await call('POST', '/api/blocks', { token: ada.token, body: { handle: 'alan' } })

  const mine = await call<{ people: Person[] }>('GET', '/api/people?q=alan', {
    token: ada.token,
  })
  assert.equal(mine.body.people.length, 0)

  const theirs = await call<{ people: Person[] }>('GET', '/api/people?q=ada', {
    token: alan.token,
  })
  assert.equal(theirs.body.people.length, 0, 'the blocked party loses sight too')
})

test('a blocked person cannot open a conversation, and cannot tell why', async () => {
  const ada = await register('ada')
  const alan = await register('alan')
  await call('POST', '/api/blocks', { token: ada.token, body: { handle: 'alan' } })

  const attempt = await open(alan.token, 'ada')
  assert.equal(attempt.status, 404)
  assert.equal(
    (attempt.body as { error: string }).error,
    'personne ne porte ce nom',
    'the refusal must not confirm the account exists',
  )
})

test('blocking closes a conversation that already existed', async () => {
  const ada = await register('ada')
  const alan = await register('alan')
  const opened = await open(ada.token, 'alan')
  const conversation = opened.body.conversation.id

  const before = await call('POST', '/api/messages', {
    token: alan.token,
    body: { conversation, body: 'bonjour' },
  })
  assert.equal(before.status, 200)

  await call('POST', '/api/blocks', { token: ada.token, body: { handle: 'alan' } })

  const after = await call('POST', '/api/messages', {
    token: alan.token,
    body: { conversation, body: 'et maintenant ?' },
  })
  assert.equal(after.status, 403, 'blocking must silence an open thread, not only a new one')

  const mine = await call('POST', '/api/messages', {
    token: ada.token,
    body: { conversation, body: 'moi non plus' },
  })
  assert.equal(mine.status, 403, 'the block cuts both ways')
})

test('unblocking restores the conversation', async () => {
  const ada = await register('ada')
  const alan = await register('alan')
  const opened = await open(ada.token, 'alan')
  const conversation = opened.body.conversation.id

  await call('POST', '/api/blocks', { token: ada.token, body: { handle: 'alan' } })
  await call('POST', '/api/blocks/remove', { token: ada.token, body: { handle: 'alan' } })

  const reply = await call('POST', '/api/messages', {
    token: alan.token,
    body: { conversation, body: 'de nouveau là' },
  })
  assert.equal(reply.status, 200)
})

test('the block list is readable, and you cannot block yourself', async () => {
  const ada = await register('ada')
  await register('alan')
  await call('POST', '/api/blocks', { token: ada.token, body: { handle: 'alan' } })

  const list = await call<{ people: Person[] }>('GET', '/api/blocks', { token: ada.token })
  assert.equal(list.body.people.length, 1)
  assert.equal(list.body.people[0]?.handle, 'alan')

  const self = await call('POST', '/api/blocks', { token: ada.token, body: { handle: 'ada' } })
  assert.equal(self.status, 400)
})

test('searching your own history is unaffected by any of this', async () => {
  const ada = await register('ada')
  await register('alan')
  const opened = await open(ada.token, 'alan')
  await call('POST', '/api/messages', {
    token: ada.token,
    body: { conversation: opened.body.conversation.id, body: 'le compilateur tourne' },
  })
  await call('POST', '/api/blocks', { token: ada.token, body: { handle: 'alan' } })

  const hits = await call<{ hits: unknown[] }>('GET', '/api/search?q=compilateur', {
    token: ada.token,
  })
  assert.equal(hits.body.hits.length, 1, 'blocking someone does not erase what was said')
})
