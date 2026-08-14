import { after, before, beforeEach, test } from 'node:test'
import assert from 'node:assert/strict'
import { call, db, register, start, stop, wipe, type Account } from './harness.js'
import { isMuted, setMuted } from '../src/model.js'

before(start)
after(stop)
beforeEach(wipe)

/*
 * Silencing a conversation.
 *
 * The thing to get right is what muting does *not* do. It is not a soft way
 * of leaving, not a block, and not visible to anyone else. The messages keep
 * arriving, the unread count keeps counting, and the only thing that stops is
 * the phone ringing in someone's pocket.
 */

type Conv = { id: string; mutedUntil: number; unread: number }

const direct = async (a: Account, handle: string) => {
  const opened = await call<{ conversation: Conv }>('POST', '/api/conversations', {
    token: a.token,
    body: { handle },
  })
  return opened.body.conversation.id
}

const mine = async (account: Account, id: string): Promise<Conv> => {
  const listed = await call<{ conversations: Conv[] }>('GET', '/api/conversations', {
    token: account.token,
  })
  const found = listed.body.conversations.find((c) => c.id === id)
  assert.ok(found, 'the conversation must still be listed')
  return found
}

test('silencing is remembered, and lifting it is one call away', async () => {
  const ada = await register('ada')
  await register('alan')
  const between = await direct(ada, 'alan')

  assert.equal((await mine(ada, between)).mutedUntil, 0)

  const off = await call<{ mutedUntil: number }>('POST', '/api/mute', {
    token: ada.token,
    body: { conversation: between },
  })
  assert.equal(off.status, 200)
  assert.equal(off.body.mutedUntil, -1, 'no duration means until said otherwise')
  assert.equal((await mine(ada, between)).mutedUntil, -1)

  const on = await call<{ mutedUntil: number }>('POST', '/api/mute', {
    token: ada.token,
    body: { conversation: between, minutes: 0 },
  })
  assert.equal(on.body.mutedUntil, 0)
  assert.equal((await mine(ada, between)).mutedUntil, 0)
})

test('a silence with an end lapses on its own', async () => {
  const ada = await register('ada')
  await register('alan')
  const between = await direct(ada, 'alan')

  const until = await call<{ mutedUntil: number }>('POST', '/api/mute', {
    token: ada.token,
    body: { conversation: between, minutes: 60 },
  })
  const at = until.body.mutedUntil
  assert.ok(at > Date.now(), 'an hour from now is in the future')

  assert.equal(isMuted(between, ada.user.id), true)
  // Nobody has to remember to undo it — which is the point of choosing an
  // hour rather than forever.
  assert.equal(isMuted(between, ada.user.id, at + 1), false)
})

test('silence is one person’s, and the other side is never told', async () => {
  const ada = await register('ada')
  const alan = await register('alan')
  const between = await direct(ada, 'alan')

  await call('POST', '/api/mute', { token: ada.token, body: { conversation: between } })

  // Alan's own view of the same conversation is untouched, and carries no
  // trace of Ada's decision.
  const his = await mine(alan, between)
  assert.equal(his.mutedUntil, 0)
  assert.equal(isMuted(between, alan.user.id), false)
  assert.equal(JSON.stringify(his).includes('muted') && his.mutedUntil !== 0, false)
})

test('a silenced conversation still counts what arrives', async () => {
  const ada = await register('ada')
  const alan = await register('alan')
  const between = await direct(ada, 'alan')
  await call('POST', '/api/mute', { token: ada.token, body: { conversation: between } })

  await call('POST', '/api/messages', {
    token: alan.token,
    body: { conversation: between, body: 'toujours là' },
  })

  const hers = await mine(ada, between)
  assert.equal(hers.unread, 1, 'muting is not a way of not receiving')
  assert.equal(hers.mutedUntil, -1)

  const seen = await call<{ messages: unknown[] }>(
    'GET',
    `/api/messages?conversation=${between}`,
    { token: ada.token },
  )
  assert.equal(seen.body.messages.length, 1)
})

test('a conversation you are not in cannot be silenced', async () => {
  const ada = await register('ada')
  const alan = await register('alan')
  const mallory = await register('mallory')
  const theirs = await direct(alan, 'mallory')

  const refused = await call('POST', '/api/mute', {
    token: ada.token,
    body: { conversation: theirs },
  })
  assert.equal(refused.status, 404)
})

test('a silence cannot be set absurdly far ahead', async () => {
  const ada = await register('ada')
  await register('alan')
  const between = await direct(ada, 'alan')

  const capped = setMuted(between, ada.user.id, Date.now() + 1e15)
  assert.ok(capped < Date.now() + 400 * 24 * 3_600_000, 'a year is already generous')

  // The route caps it too, whatever arrives in the body.
  const asked = await call<{ mutedUntil: number }>('POST', '/api/mute', {
    token: ada.token,
    body: { conversation: between, minutes: 1e12 },
  })
  assert.ok(asked.body.mutedUntil < Date.now() + 400 * 24 * 3_600_000)
})
