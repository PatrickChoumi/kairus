import { after, before, beforeEach, test } from 'node:test'
import assert from 'node:assert/strict'
import { call, register, start, stop, wipe } from './harness.js'

before(start)
after(stop)
beforeEach(wipe)

type Face = { id: string; name: string; hue: number }
type Conversation = {
  id: string
  kind: 'direct' | 'group'
  face: Face
  members: { id: string; handle: string; name: string }[]
  unread: number
  readAt: number
  lastMessage: { id: string; body: string } | null
}

const makeGroup = (token: string, title: string, handles: string[]) =>
  call<{ conversation: Conversation }>('POST', '/api/groups', {
    token,
    body: { title, handles },
  })

const say = (token: string, conversation: string, body: string) =>
  call<{ message: { id: string } }>('POST', '/api/messages', {
    token,
    body: { conversation, body },
  })

const read = (token: string, conversation: string) =>
  call<{ messages: { id: string; body: string }[] }>(
    'GET',
    `/api/messages?conversation=${conversation}`,
    { token },
  )

const mine = (token: string) =>
  call<{ conversations: Conversation[] }>('GET', '/api/conversations', { token })

/* ------------------------------------------------------------------ making */

test('a group takes a name and the people in it', async () => {
  const ada = await register('ada')
  await register('alan')
  await register('grace')

  const made = await makeGroup(ada.token, 'Bletchley', ['alan', 'grace'])
  assert.equal(made.status, 200)
  assert.equal(made.body.conversation.kind, 'group')
  assert.equal(made.body.conversation.face.name, 'Bletchley')
  assert.equal(made.body.conversation.members.length, 2, 'members are everyone but you')
})

test('a group needs a name and somebody else', async () => {
  const ada = await register('ada')
  await register('alan')

  assert.equal((await makeGroup(ada.token, '   ', ['alan'])).status, 400)
  assert.equal((await makeGroup(ada.token, 'Seul', [])).status, 400)
})

test('everyone invited sees it appear, without asking', async () => {
  const ada = await register('ada')
  const alan = await register('alan')
  await makeGroup(ada.token, 'Bletchley', ['alan'])

  const theirs = await mine(alan.token)
  assert.equal(theirs.body.conversations.length, 1)
  assert.equal(theirs.body.conversations[0]?.face.name, 'Bletchley')
})

test('a group wears the same colour for everyone in it', async () => {
  const ada = await register('ada')
  const alan = await register('alan')
  const made = await makeGroup(ada.token, 'Bletchley', ['alan'])

  const theirs = await mine(alan.token)
  assert.equal(theirs.body.conversations[0]?.face.hue, made.body.conversation.face.hue)
})

test('a direct conversation still shows the other person', async () => {
  const ada = await register('ada')
  await register('alan')
  const opened = await call<{ conversation: Conversation }>('POST', '/api/conversations', {
    token: ada.token,
    body: { handle: 'alan' },
  })
  assert.equal(opened.body.conversation.kind, 'direct')
  assert.equal(opened.body.conversation.face.name, 'alan')
  assert.equal(opened.body.conversation.members.length, 1)
})

test('you cannot gather someone you have blocked', async () => {
  const ada = await register('ada')
  await register('alan')
  await call('POST', '/api/blocks', { token: ada.token, body: { handle: 'alan' } })

  const made = await makeGroup(ada.token, 'Bletchley', ['alan'])
  assert.equal(made.status, 403)
})

/* ----------------------------------------------------------------- talking */

test('everyone in the group receives what is said in it', async () => {
  const ada = await register('ada')
  const alan = await register('alan')
  const grace = await register('grace')
  const made = await makeGroup(ada.token, 'Bletchley', ['alan', 'grace'])
  const id = made.body.conversation.id

  await say(ada.token, id, 'la machine tourne')
  for (const token of [alan.token, grace.token]) {
    const seen = await read(token, id)
    assert.equal(seen.body.messages.length, 1)
    assert.equal(seen.body.messages[0]?.body, 'la machine tourne')
  }
})

test('an outsider can neither read the group nor post into it', async () => {
  const ada = await register('ada')
  await register('alan')
  const outsider = await register('grace')
  const made = await makeGroup(ada.token, 'Bletchley', ['alan'])
  const id = made.body.conversation.id

  assert.equal((await read(outsider.token, id)).status, 404)
  assert.equal((await say(outsider.token, id, 'bonjour')).status, 404)
})

test('the read mark waits for the last of them', async () => {
  const ada = await register('ada')
  const alan = await register('alan')
  const grace = await register('grace')
  const made = await makeGroup(ada.token, 'Bletchley', ['alan', 'grace'])
  const id = made.body.conversation.id
  await say(ada.token, id, 'lisez ceci')

  await call('POST', '/api/read', { token: alan.token, body: { conversation: id } })
  const halfway = await mine(ada.token)
  assert.equal(
    halfway.body.conversations[0]?.readAt,
    0,
    'one reader out of two is not the room having read',
  )

  await call('POST', '/api/read', { token: grace.token, body: { conversation: id } })
  const done = await mine(ada.token)
  assert.ok((done.body.conversations[0]?.readAt ?? 0) > 0)
})

/* -------------------------------------------------------------- membership */

test('someone added today does not get to read last month', async () => {
  const ada = await register('ada')
  const alan = await register('alan')
  const grace = await register('grace')
  const made = await makeGroup(ada.token, 'Bletchley', ['alan'])
  const id = made.body.conversation.id

  await say(ada.token, id, 'avant son arrivée')
  const joined = await call('POST', '/api/groups/members', {
    token: ada.token,
    body: { conversation: id, handle: 'grace' },
  })
  assert.equal(joined.status, 200)
  await say(ada.token, id, 'après son arrivée')

  const late = await read(grace.token, id)
  assert.deepEqual(
    late.body.messages.map((m) => m.body),
    ['après son arrivée'],
    'history is not inherited by joining',
  )

  const early = await read(alan.token, id)
  assert.equal(early.body.messages.length, 2, 'the people who were there keep everything')
})

test('what predates your arrival is not searchable either', async () => {
  const ada = await register('ada')
  await register('alan')
  const grace = await register('grace')
  const made = await makeGroup(ada.token, 'Bletchley', ['alan'])
  const id = made.body.conversation.id
  await say(ada.token, id, 'un secret antérieur')

  await call('POST', '/api/groups/members', {
    token: ada.token,
    body: { conversation: id, handle: 'grace' },
  })
  const hunt = await call<{ hits: unknown[] }>('GET', '/api/search?q=antérieur', {
    token: grace.token,
  })
  assert.equal(hunt.body.hits.length, 0)
})

test('only someone already in the group can add to it', async () => {
  const ada = await register('ada')
  await register('alan')
  const outsider = await register('grace')
  const made = await makeGroup(ada.token, 'Bletchley', ['alan'])

  const sneaked = await call('POST', '/api/groups/members', {
    token: outsider.token,
    body: { conversation: made.body.conversation.id, handle: 'grace' },
  })
  assert.equal(sneaked.status, 404)
})

test('adding the same person twice is refused, not duplicated', async () => {
  const ada = await register('ada')
  await register('alan')
  const made = await makeGroup(ada.token, 'Bletchley', ['alan'])
  const again = await call('POST', '/api/groups/members', {
    token: ada.token,
    body: { conversation: made.body.conversation.id, handle: 'alan' },
  })
  assert.equal(again.status, 409)
})

test('leaving takes the group off your list and out of your reach', async () => {
  const ada = await register('ada')
  const alan = await register('alan')
  const made = await makeGroup(ada.token, 'Bletchley', ['alan'])
  const id = made.body.conversation.id

  const left = await call('POST', '/api/groups/leave', {
    token: alan.token,
    body: { conversation: id },
  })
  assert.equal(left.status, 200)
  assert.equal((await mine(alan.token)).body.conversations.length, 0)
  assert.equal((await read(alan.token, id)).status, 404)
  assert.equal((await mine(ada.token)).body.conversations.length, 1, 'the others keep it')
})

test('a direct conversation is not something you leave', async () => {
  const ada = await register('ada')
  await register('alan')
  const opened = await call<{ conversation: Conversation }>('POST', '/api/conversations', {
    token: ada.token,
    body: { handle: 'alan' },
  })
  const refused = await call('POST', '/api/groups/leave', {
    token: ada.token,
    body: { conversation: opened.body.conversation.id },
  })
  assert.equal(refused.status, 400)
})

test('the last one out takes the group with them', async () => {
  const ada = await register('ada')
  const alan = await register('alan')
  const made = await makeGroup(ada.token, 'Bletchley', ['alan'])
  const id = made.body.conversation.id

  await call('POST', '/api/groups/leave', { token: alan.token, body: { conversation: id } })
  await call('POST', '/api/groups/leave', { token: ada.token, body: { conversation: id } })
  assert.equal((await read(ada.token, id)).status, 404)
})

test('a group can be renamed by anyone in it, and by nobody else', async () => {
  const ada = await register('ada')
  const alan = await register('alan')
  const outsider = await register('grace')
  const made = await makeGroup(ada.token, 'Bletchley', ['alan'])
  const id = made.body.conversation.id

  const renamed = await call<{ title: string }>('POST', '/api/groups/rename', {
    token: alan.token,
    body: { conversation: id, title: 'Hut 8' },
  })
  assert.equal(renamed.status, 200)
  assert.equal((await mine(ada.token)).body.conversations[0]?.face.name, 'Hut 8')

  const refused = await call('POST', '/api/groups/rename', {
    token: outsider.token,
    body: { conversation: id, title: 'à moi' },
  })
  assert.equal(refused.status, 404)
})

test('a blocked member does not silence a whole room', async () => {
  const ada = await register('ada')
  const alan = await register('alan')
  const grace = await register('grace')
  const made = await makeGroup(ada.token, 'Bletchley', ['alan', 'grace'])
  const id = made.body.conversation.id

  await call('POST', '/api/blocks', { token: ada.token, body: { handle: 'alan' } })
  // Blocking is for direct conversations; a group is left, not muted.
  assert.equal((await say(grace.token, id, 'la vie continue')).status, 200)
  assert.equal((await say(ada.token, id, 'en effet')).status, 200)
})
