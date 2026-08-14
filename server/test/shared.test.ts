import { after, before, beforeEach, test } from 'node:test'
import assert from 'node:assert/strict'
import { call, db, raw, register, start, stop, wipe, type Account } from './harness.js'

before(start)
after(stop)
beforeEach(() => {
  wipe()
  db.exec('DELETE FROM attachments')
})

/*
 * Everything ever attached in a conversation, in one place.
 *
 * Scrolling a year of conversation to find one photograph is the sort of small
 * misery that makes people give up on an application. This is a second way of
 * looking at the same conversation — so it must obey exactly the same rules,
 * `joined_at` first among them, or it becomes a way around them.
 */

type Conv = { id: string }
type Shared = { message: { id: string; body: string }; attachment: { id: string; mime: string } }

const upload = async (account: Account, mime: string, name: string, bytes = 'des octets') => {
  const up = await raw('POST', '/api/files', {
    token: account.token,
    headers: { 'content-type': mime, 'x-file-name': name },
    body: Buffer.from(bytes),
  })
  if (up.status !== 200) assert.fail(`upload refused: ${up.status} ${await up.text()}`)
  const { attachment } = (await up.json()) as { attachment: { id: string } }
  return attachment.id
}

const send = async (account: Account, conversation: string, attachment: string, body = '') => {
  const sent = await call<{ message: { id: string } }>('POST', '/api/messages', {
    token: account.token,
    body: { conversation, body, attachment },
  })
  assert.equal(sent.status, 200, JSON.stringify(sent.body))
  return sent.body.message.id
}

const shared = async (account: Account, conversation: string, kind = 'image') => {
  const seen = await call<{ shared: Shared[] }>(
    'GET',
    `/api/shared?conversation=${conversation}&kind=${kind}`,
    { token: account.token },
  )
  assert.equal(seen.status, 200, JSON.stringify(seen.body))
  return seen.body.shared
}

const group = async (founder: Account, handles: string[]) => {
  const made = await call<{ conversation: Conv }>('POST', '/api/groups', {
    token: founder.token,
    body: { title: 'Hut 8', handles },
  })
  return made.body.conversation.id
}

test('the images of a conversation come back newest first, and nothing else does', async () => {
  const ada = await register('ada')
  await register('alan')
  const room = await group(ada, ['alan'])

  const first = await send(ada, room, await upload(ada, 'image/png', 'un.png'), 'la première')
  await send(ada, room, await upload(ada, 'application/pdf', 'note.pdf'))
  const second = await send(ada, room, await upload(ada, 'image/jpeg', 'deux.jpg'))

  const images = await shared(ada, room)
  assert.equal(images.length, 2, 'a document is not a photograph')
  assert.equal(images[0]?.message.id, second, 'newest first — that is how one looks for a picture')
  assert.equal(images[1]?.message.id, first)
  assert.equal(images[1]?.message.body, 'la première', 'the caption comes with it')

  const documents = await shared(ada, room, 'file')
  assert.equal(documents.length, 1)
  assert.equal(documents[0]?.attachment.mime, 'application/pdf')
})

test('a newcomer sees the images of the conversation they joined, not the ones before', async () => {
  const ada = await register('ada')
  await register('alan')
  const room = await group(ada, ['alan'])
  await send(ada, room, await upload(ada, 'image/png', 'avant.png'))

  const carol = await register('carol')
  await call('POST', '/api/groups/members', {
    token: ada.token,
    body: { conversation: room, handle: 'carol' },
  })
  const after = await send(ada, room, await upload(ada, 'image/png', 'après.png'))

  const hers = await shared(carol, room)
  assert.equal(hers.length, 1, 'the gallery must not be a way around joined_at')
  assert.equal(hers[0]?.message.id, after)

  // And it is still whole for whoever was there.
  assert.equal((await shared(ada, room)).length, 2)
})

test('a retracted image leaves the gallery', async () => {
  const ada = await register('ada')
  await register('alan')
  const room = await group(ada, ['alan'])
  const message = await send(ada, room, await upload(ada, 'image/png', 'regret.png'))

  assert.equal((await shared(ada, room)).length, 1)
  await call('POST', '/api/messages/retract', { token: ada.token, body: { message } })
  assert.equal((await shared(ada, room)).length, 0, 'taking a message back takes its file back')
})

test('a stranger gets nothing, and is told the conversation does not exist', async () => {
  const ada = await register('ada')
  await register('alan')
  const mallory = await register('mallory')
  const room = await group(ada, ['alan'])
  await send(ada, room, await upload(ada, 'image/png', 'privé.png'))

  const refused = await call('GET', `/api/shared?conversation=${room}`, { token: mallory.token })
  assert.equal(refused.status, 404)
})

test('voice messages are audio, and audio is asked for separately', async () => {
  const ada = await register('ada')
  await register('alan')
  const room = await group(ada, ['alan'])
  await send(ada, room, await upload(ada, 'audio/webm', 'vocal.webm'))
  await send(ada, room, await upload(ada, 'image/png', 'photo.png'))

  assert.equal((await shared(ada, room, 'image')).length, 1)
  assert.equal((await shared(ada, room, 'audio')).length, 1)
  assert.equal((await shared(ada, room, 'file')).length, 0, 'audio is not a document')
})
