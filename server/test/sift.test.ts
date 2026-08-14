import { after, before, beforeEach, test } from 'node:test'
import assert from 'node:assert/strict'
import { call, register, start, stop, wipe, type Account } from './harness.js'

before(start)
after(stop)
beforeEach(wipe)

/*
 * Searching inside one conversation.
 *
 * Narrowing the search is a different act from searching everywhere: one
 * already knows where it was said and is asking when. The dangerous part is
 * that `conversation` is a parameter the caller chooses — so it must narrow
 * what someone can already see, never widen it.
 */

type Conv = { id: string }
type Hit = { message: { id: string; body: string }; conversationId: string }

const direct = async (a: Account, handle: string) => {
  const opened = await call<{ conversation: Conv }>('POST', '/api/conversations', {
    token: a.token,
    body: { handle },
  })
  return opened.body.conversation.id
}

const say = async (account: Account, conversation: string, body: string) => {
  const sent = await call<{ message: { id: string } }>('POST', '/api/messages', {
    token: account.token,
    body: { conversation, body },
  })
  assert.equal(sent.status, 200, JSON.stringify(sent.body))
  return sent.body.message.id
}

const find = async (account: Account, q: string, conversation?: string) => {
  const url = `/api/search?q=${encodeURIComponent(q)}${
    conversation ? `&conversation=${conversation}` : ''
  }`
  const seen = await call<{ hits: Hit[] }>('GET', url, { token: account.token })
  assert.equal(seen.status, 200, JSON.stringify(seen.body))
  return seen.body.hits
}

test('narrowing to a conversation leaves the others out', async () => {
  const ada = await register('ada')
  await register('alan')
  await register('bea')
  const withAlan = await direct(ada, 'alan')
  const withBea = await direct(ada, 'bea')

  await say(ada, withAlan, 'le compilateur tourne enfin')
  await say(ada, withBea, 'le compilateur est en panne')

  const everywhere = await find(ada, 'compilateur')
  assert.equal(everywhere.length, 2)

  const here = await find(ada, 'compilateur', withAlan)
  assert.equal(here.length, 1)
  assert.equal(here[0]?.conversationId, withAlan)
  assert.match(here[0]?.message.body ?? '', /tourne enfin/)
})

test('naming a conversation you are not in finds nothing', async () => {
  const ada = await register('ada')
  const alan = await register('alan')
  await register('bea')
  const theirs = await direct(alan, 'bea')
  await say(alan, theirs, 'un secret entre eux')

  // The identifier is a parameter the caller chooses: it must narrow what one
  // can already see, never open a door.
  assert.deepEqual(await find(ada, 'secret', theirs), [])
})

test('a newcomer does not find what was said before they arrived', async () => {
  const ada = await register('ada')
  await register('alan')
  const made = await call<{ conversation: Conv }>('POST', '/api/groups', {
    token: ada.token,
    body: { title: 'Hut 8', handles: ['alan'] },
  })
  const room = made.body.conversation.id
  await say(ada, room, 'la bombe est prête')

  const carol = await register('carol')
  await call('POST', '/api/groups/members', {
    token: ada.token,
    body: { conversation: room, handle: 'carol' },
  })
  await say(ada, room, 'la bombe tourne bien')

  const hers = await find(carol, 'bombe', room)
  assert.equal(hers.length, 1, 'narrowing must not be a way around joined_at')
  assert.match(hers[0]?.message.body ?? '', /tourne bien/)

  assert.equal((await find(ada, 'bombe', room)).length, 2)
})

test('a narrowed search reaches further back than a global one', async () => {
  const ada = await register('ada')
  await register('alan')
  const between = await direct(ada, 'alan')
  for (let i = 0; i < 20; i += 1) await say(ada, between, `note numéro ${i} sur le sujet`)

  // Twelve is enough when the question is "where"; it is not enough when the
  // question is "when, among two years of this".
  assert.equal((await find(ada, 'sujet')).length, 12)
  assert.equal((await find(ada, 'sujet', between)).length, 20)
})

test('a retracted message is not findable, narrowed or not', async () => {
  const ada = await register('ada')
  await register('alan')
  const between = await direct(ada, 'alan')
  const said = await say(ada, between, 'quelque chose de regrettable')

  assert.equal((await find(ada, 'regrettable', between)).length, 1)
  await call('POST', '/api/messages/retract', { token: ada.token, body: { message: said } })
  assert.equal((await find(ada, 'regrettable', between)).length, 0)
})
