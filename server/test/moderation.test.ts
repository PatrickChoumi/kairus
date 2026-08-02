import { after, before, beforeEach, test } from 'node:test'
import assert from 'node:assert/strict'
import { call, db, raw, register, start, stop, wipe, type Account } from './harness.js'

before(start)
after(stop)
beforeEach(() => {
  wipe()
  db.exec('DELETE FROM reports; DELETE FROM attachments')
  process.env.MODERATION_TOKEN = 'un-secret-de-test'
})

type Conv = { id: string }
type Msg = { id: string }
type Report = {
  id: string
  reporter: { name: string } | null
  about: { id: string; name: string } | null
  messageId: string | null
  said: string
  reason: string
  timesReported: number
}

const direct = async (a: Account, handle: string) => {
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

const reports = async () => {
  const seen = await call<{ reports: Report[] }>(
    'GET',
    '/api/reports?token=un-secret-de-test',
  )
  assert.equal(seen.status, 200, JSON.stringify(seen.body))
  return seen.body.reports
}

/* ------------------------------------------------------------- reporting */

test('a reported message keeps its words even if the author takes them back', async () => {
  const ada = await register('ada')
  const alan = await register('alan')
  const between = await direct(ada, 'alan')
  const said = await say(alan, between, 'quelque chose d’inacceptable')

  const filed = await call('POST', '/api/reports', {
    token: ada.token,
    body: { message: said.id, reason: 'harcèlement' },
  })
  assert.equal(filed.status, 200)

  // The author takes it back; the evidence must not go with it.
  await call('POST', '/api/messages/retract', { token: alan.token, body: { message: said.id } })

  const [report] = await reports()
  assert.equal(report?.said, 'quelque chose d’inacceptable')
  assert.equal(report?.about?.id, alan.user.id)
  assert.equal(report?.reason, 'harcèlement')
  assert.equal(report?.messageId, said.id)
})

test('reporting a person requires sharing a conversation with them', async () => {
  const ada = await register('ada')
  await register('alan')

  // No conversation yet: a report must not become a way to probe for accounts.
  const blind = await call('POST', '/api/reports', {
    token: ada.token,
    body: { handle: 'alan', reason: 'au hasard' },
  })
  assert.equal(blind.status, 404)

  await direct(ada, 'alan')
  const known = await call('POST', '/api/reports', {
    token: ada.token,
    body: { handle: 'alan', reason: 'insistance' },
  })
  assert.equal(known.status, 200)
})

test('a message you were never allowed to read cannot be reported', async () => {
  const ada = await register('ada')
  const alan = await register('alan')
  const bea = await register('bea')
  const theirs = await direct(alan, 'bea')
  const said = await say(alan, theirs, 'entre eux')

  const nosy = await call('POST', '/api/reports', {
    token: ada.token,
    body: { message: said.id, reason: 'curiosité' },
  })
  assert.equal(nosy.status, 404)
})

test('a newcomer cannot report what was said before they arrived', async () => {
  const ada = await register('ada')
  await register('alan')
  const made = await call<{ conversation: Conv }>('POST', '/api/groups', {
    token: ada.token,
    body: { title: 'Hut 8', handles: ['alan'] },
  })
  const early = await say(ada, made.body.conversation.id, 'dit avant son arrivée')

  const carol = await register('carol')
  await call('POST', '/api/groups/members', {
    token: ada.token,
    body: { conversation: made.body.conversation.id, handle: 'carol' },
  })

  const refused = await call('POST', '/api/reports', {
    token: carol.token,
    body: { message: early.id, reason: 'prétexte' },
  })
  assert.equal(refused.status, 404, 'a report must not be a way around joined_at')
})

test('nobody reports themselves', async () => {
  const ada = await register('ada')
  await register('alan')
  const between = await direct(ada, 'alan')
  const mine = await say(ada, between, 'mes propres mots')

  const refused = await call('POST', '/api/reports', {
    token: ada.token,
    body: { message: mine.id, reason: 'pour voir' },
  })
  assert.equal(refused.status, 400)
})

test('a report is recorded and nothing more happens', async () => {
  const ada = await register('ada')
  const alan = await register('alan')
  const between = await direct(ada, 'alan')
  const said = await say(alan, between, 'à signaler')

  for (let i = 0; i < 5; i += 1) {
    await call('POST', '/api/reports', {
      token: ada.token,
      body: { message: said.id, reason: `fois ${i}` },
    })
  }

  // Five reports, and the account is exactly as it was: no threshold at which
  // someone disappears, because that would be a weapon.
  const stillIn = await call('POST', '/api/auth/login', {
    body: { handle: 'alan', password: 'a-long-enough-phrase' },
  })
  assert.equal(stillIn.status, 200)
  const stillWrites = await say(alan, between, 'et il écrit encore')
  assert.ok(stillWrites.id)

  const filed = await reports()
  assert.equal(filed.length, 5)
  assert.equal(filed[0]?.timesReported, 5, 'a pattern must be visible without counting by hand')
})

test('the report list is not readable without the token', async () => {
  const ada = await register('ada')
  await register('alan')
  await direct(ada, 'alan')
  await call('POST', '/api/reports', {
    token: ada.token,
    body: { handle: 'alan', reason: 'quelque chose' },
  })

  const bare = await raw('GET', '/api/reports')
  assert.equal(bare.status, 404, 'an unguarded list of reports would be a leak')

  const wrong = await raw('GET', '/api/reports?token=pas-le-bon')
  assert.equal(wrong.status, 404)

  // Unset, the route does not exist at all rather than answering emptily.
  const secret = process.env.MODERATION_TOKEN
  delete process.env.MODERATION_TOKEN
  const off = await raw('GET', '/api/reports?token=un-secret-de-test')
  assert.equal(off.status, 404)
  process.env.MODERATION_TOKEN = secret
})

/* ------------------------------------------------------ taking someone out */

test('whoever gathered the group can take someone out of it', async () => {
  const ada = await register('ada')
  const alan = await register('alan')
  await register('bea')
  const made = await call<{ conversation: Conv }>('POST', '/api/groups', {
    token: ada.token,
    body: { title: 'Hut 8', handles: ['alan', 'bea'] },
  })
  const group = made.body.conversation.id

  const removed = await call('POST', '/api/groups/remove', {
    token: ada.token,
    body: { conversation: group, handle: 'alan' },
  })
  assert.equal(removed.status, 200)

  // Gone from their list, and no longer able to write there.
  const theirs = await call<{ conversations: Conv[] }>('GET', '/api/conversations', {
    token: alan.token,
  })
  assert.equal(
    theirs.body.conversations.some((c) => c.id === group),
    false,
  )
  const refused = await call('POST', '/api/messages', {
    token: alan.token,
    body: { conversation: group, body: 'encore là ?' },
  })
  assert.equal(refused.status, 404)
})

test('a member cannot take another member out', async () => {
  const ada = await register('ada')
  const alan = await register('alan')
  await register('bea')
  const made = await call<{ conversation: Conv }>('POST', '/api/groups', {
    token: ada.token,
    body: { title: 'Hut 8', handles: ['alan', 'bea'] },
  })

  const refused = await call('POST', '/api/groups/remove', {
    token: alan.token,
    body: { conversation: made.body.conversation.id, handle: 'bea' },
  })
  assert.equal(refused.status, 403)
})

test('a stranger cannot take anyone out of a group they cannot see', async () => {
  const ada = await register('ada')
  await register('alan')
  const mallory = await register('mallory')
  const made = await call<{ conversation: Conv }>('POST', '/api/groups', {
    token: ada.token,
    body: { title: 'Hut 8', handles: ['alan'] },
  })

  const refused = await call('POST', '/api/groups/remove', {
    token: mallory.token,
    body: { conversation: made.body.conversation.id, handle: 'alan' },
  })
  assert.equal(refused.status, 404)
})

test('to leave yourself, you leave — you do not remove yourself', async () => {
  const ada = await register('ada')
  await register('alan')
  const made = await call<{ conversation: Conv }>('POST', '/api/groups', {
    token: ada.token,
    body: { title: 'Hut 8', handles: ['alan'] },
  })

  const refused = await call('POST', '/api/groups/remove', {
    token: ada.token,
    body: { conversation: made.body.conversation.id, handle: 'ada' },
  })
  assert.equal(refused.status, 400)
})

/* ------------------------------------------------------------------ files */

test('a file follows the same rule as the message that carries it', async () => {
  const ada = await register('ada')
  await register('alan')
  const made = await call<{ conversation: Conv }>('POST', '/api/groups', {
    token: ada.token,
    body: { title: 'Hut 8', handles: ['alan'] },
  })
  const group = made.body.conversation.id

  const up = await raw('POST', '/api/files', {
    token: ada.token,
    headers: { 'content-type': 'image/png', 'x-file-name': 'photo.png' },
    body: Buffer.from('des pixels d’avant'),
  })
  const { attachment } = (await up.json()) as { attachment: { id: string } }
  await call('POST', '/api/messages', {
    token: ada.token,
    body: { conversation: group, body: '', attachment: attachment.id },
  })

  // Carol arrives afterwards: the message is invisible to her, and so must be
  // the file, even with the identifier in hand.
  const carol = await register('carol')
  await call('POST', '/api/groups/members', {
    token: ada.token,
    body: { conversation: group, handle: 'carol' },
  })

  const seen = await call<{ messages: unknown[] }>(
    'GET',
    `/api/messages?conversation=${group}`,
    { token: carol.token },
  )
  assert.equal(seen.body.messages.length, 0, 'the message itself is already withheld')

  const grabbed = await raw('GET', `/api/files/${attachment.id}`, { token: carol.token })
  assert.equal(grabbed.status, 404, 'a direct link must not be the way around joined_at')

  // And it stays readable for whoever was there.
  const allowed = await raw('GET', `/api/files/${attachment.id}`, { token: ada.token })
  assert.equal(allowed.status, 200)
})
