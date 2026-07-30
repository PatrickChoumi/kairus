import { after, before, beforeEach, test } from 'node:test'
import assert from 'node:assert/strict'
import { call, db, raw, register, start, stop, wipe, type Account } from './harness.js'
import {
  isAudible,
  isDisplayable,
  servingHeaders,
  sweepOrphans,
  tameName,
  tamePeaks,
} from '../src/files.js'

before(start)
after(stop)
beforeEach(() => {
  wipe()
  db.exec('DELETE FROM attachments')
})

type Uploaded = { attachment: { id: string; name: string; mime: string; size: number } }

const send = async (
  account: Account,
  body: Buffer | string,
  headers: Record<string, string> = {},
) => {
  const response = await raw('POST', '/api/files', {
    token: account.token,
    headers: { 'content-type': 'image/png', 'x-file-name': 'photo.png', ...headers },
    body,
  })
  return { status: response.status, body: (await response.json().catch(() => ({}))) as Uploaded }
}

const fetchFile = (id: string, token?: string) =>
  raw('GET', `/api/files/${id}`, token ? { token } : {})

const converse = async () => {
  const ada = await register('ada')
  const alan = await register('alan')
  const opened = await call<{ conversation: { id: string } }>('POST', '/api/conversations', {
    token: ada.token,
    body: { handle: 'alan' },
  })
  return { ada, alan, conversation: opened.body.conversation.id }
}

/* ------------------------------------------------------------------- names */

test('a filename cannot become a path, or hide what it is', () => {
  assert.equal(tameName('../../etc/passwd'), 'passwd')
  assert.equal(tameName('..\\..\\windows\\win.ini'), 'win.ini')
  assert.equal(tameName('photo.png'), 'photo.png')
  assert.equal(tameName(''), 'fichier')
  assert.equal(tameName('...'), 'fichier')
  assert.ok(tameName('x'.repeat(400)).length <= 120)
})

/* ----------------------------------------------------------------- serving */

test('only a short list of images is ever shown in place', () => {
  for (const mime of ['image/png', 'image/jpeg', 'image/gif', 'image/webp']) {
    assert.equal(isDisplayable(mime), true, `${mime} should render`)
  }
  // SVG carries scripts, and HTML plainly does: neither is ever inline.
  for (const mime of ['image/svg+xml', 'text/html', 'application/pdf', 'text/plain']) {
    assert.equal(isDisplayable(mime), false, `${mime} must not render in place`)
  }
})

test('anything not displayable is handed over as an opaque download', () => {
  const headers = servingHeaders({
    id: 'a',
    name: 'piège.svg',
    mime: 'image/svg+xml',
    size: 10,
    width: null,
    height: null,
  })
  assert.equal(headers['content-type'], 'application/octet-stream')
  assert.match(headers['content-disposition'] ?? '', /^attachment/)
  assert.equal(headers['x-content-type-options'], 'nosniff')
})

test('a displayable image keeps its type and is shown in place', () => {
  const headers = servingHeaders({
    id: 'a',
    name: 'photo.png',
    mime: 'image/png',
    size: 10,
    width: 4,
    height: 3,
  })
  assert.equal(headers['content-type'], 'image/png')
  assert.match(headers['content-disposition'] ?? '', /^inline/)
})

/* --------------------------------------------------------------- uploading */

test('a file goes up and comes back down', async () => {
  const { ada, conversation } = await converse()
  const bytes = Buffer.from('pretend this is a png')

  const up = await send(ada, bytes, { 'x-file-width': '640', 'x-file-height': '480' })
  assert.equal(up.status, 200)
  assert.equal(up.body.attachment.name, 'photo.png')
  assert.equal(up.body.attachment.size, bytes.length)

  const sent = await call<{ message: { attachment: { id: string } | null } }>(
    'POST',
    '/api/messages',
    {
      token: ada.token,
      body: { conversation, body: 'regarde', attachment: up.body.attachment.id },
    },
  )
  assert.equal(sent.status, 200)
  assert.equal(sent.body.message.attachment?.id, up.body.attachment.id)

  const down = await fetchFile(up.body.attachment.id, ada.token)
  assert.equal(down.status, 200)
  assert.equal(Buffer.from(await down.arrayBuffer()).toString(), bytes.toString())
})

test('a message may carry a file and no words at all', async () => {
  const { ada, conversation } = await converse()
  const up = await send(ada, Buffer.from('bytes'))
  const sent = await call('POST', '/api/messages', {
    token: ada.token,
    body: { conversation, body: '', attachment: up.body.attachment.id },
  })
  assert.equal(sent.status, 200)
})

test('a message with neither words nor file is still refused', async () => {
  const { ada, conversation } = await converse()
  const sent = await call('POST', '/api/messages', {
    token: ada.token,
    body: { conversation, body: '   ' },
  })
  assert.equal(sent.status, 400)
})

test('an upload is refused past the size limit', async () => {
  const ada = await register('ada')
  const tooMuch = Buffer.alloc(9 * 1024 * 1024, 1)
  const up = await send(ada, tooMuch)
  assert.equal(up.status, 413)
})

test('uploading needs a session', async () => {
  const response = await raw('POST', '/api/files', {
    headers: { 'content-type': 'image/png' },
    body: 'x',
  })
  assert.equal(response.status, 401)
})

/* ------------------------------------------------------------------ access */

test('a stranger cannot fetch a file from a conversation they are not in', async () => {
  const { ada, conversation } = await converse()
  const grace = await register('grace')
  const up = await send(ada, Buffer.from('private'))
  await call('POST', '/api/messages', {
    token: ada.token,
    body: { conversation, body: '', attachment: up.body.attachment.id },
  })

  const peek = await fetchFile(up.body.attachment.id, grace.token)
  assert.equal(peek.status, 404, 'and it must not confirm the file exists either')
})

test('the other side of the conversation can fetch it', async () => {
  const { ada, alan, conversation } = await converse()
  const up = await send(ada, Buffer.from('shared'))
  await call('POST', '/api/messages', {
    token: ada.token,
    body: { conversation, body: '', attachment: up.body.attachment.id },
  })

  const theirs = await fetchFile(up.body.attachment.id, alan.token)
  assert.equal(theirs.status, 200)
})

test('an unattached upload belongs to its uploader alone', async () => {
  const ada = await register('ada')
  const alan = await register('alan')
  const up = await send(ada, Buffer.from('not sent yet'))

  const mine = await fetchFile(up.body.attachment.id, ada.token)
  assert.equal(mine.status, 200)

  const theirs = await fetchFile(up.body.attachment.id, alan.token)
  assert.equal(theirs.status, 404)
})

test('someone else cannot claim your upload as their own message', async () => {
  const { ada, alan, conversation } = await converse()
  const up = await send(ada, Buffer.from('mine'))

  const stolen = await call('POST', '/api/messages', {
    token: alan.token,
    body: { conversation, body: 'à moi', attachment: up.body.attachment.id },
  })
  assert.equal(stolen.status, 404)
})

test('the same upload cannot be attached twice', async () => {
  const { ada, conversation } = await converse()
  const up = await send(ada, Buffer.from('once'))

  const first = await call('POST', '/api/messages', {
    token: ada.token,
    body: { conversation, body: '', attachment: up.body.attachment.id },
  })
  assert.equal(first.status, 200)

  const again = await call('POST', '/api/messages', {
    token: ada.token,
    body: { conversation, body: '', attachment: up.body.attachment.id },
  })
  assert.equal(again.status, 404)
})

/* ----------------------------------------------------------------- cleanup */

test('retracting a message takes its file off the disk', async () => {
  const { ada, conversation } = await converse()
  const up = await send(ada, Buffer.from('to be undone'))
  const sent = await call<{ message: { id: string } }>('POST', '/api/messages', {
    token: ada.token,
    body: { conversation, body: '', attachment: up.body.attachment.id },
  })

  await call('POST', '/api/messages/retract', {
    token: ada.token,
    body: { message: sent.body.message.id },
  })

  const gone = await fetchFile(up.body.attachment.id, ada.token)
  assert.equal(gone.status, 404)
})

test('an upload whose message was never sent is swept away', async () => {
  const ada = await register('ada')
  const up = await send(ada, Buffer.from('abandoned'))

  assert.equal(sweepOrphans(Date.now()), 0, 'a fresh upload is still expected')
  // An hour later, nobody is going to send it.
  assert.equal(sweepOrphans(Date.now() + 2 * 3600_000), 1)

  const gone = await fetchFile(up.body.attachment.id, ada.token)
  assert.equal(gone.status, 404)
})

test('a sent file is never swept', async () => {
  const { ada, conversation } = await converse()
  const up = await send(ada, Buffer.from('kept'))
  await call('POST', '/api/messages', {
    token: ada.token,
    body: { conversation, body: '', attachment: up.body.attachment.id },
  })

  assert.equal(sweepOrphans(Date.now() + 30 * 24 * 3600_000), 0)
  const still = await fetchFile(up.body.attachment.id, ada.token)
  assert.equal(still.status, 200)
})

/* ------------------------------------------------------------------- voice */

test('a voice message keeps how long it runs and the shape to draw', async () => {
  const ada = await register('ada')
  const up = await raw('POST', '/api/files', {
    token: ada.token,
    headers: {
      'content-type': 'audio/webm',
      'x-file-name': 'voix.webm',
      'x-file-duration': '7.42',
      'x-file-peaks': '12,90,44,8',
    },
    body: Buffer.from('opus-ish bytes'),
  })
  const { attachment } = (await up.json()) as {
    attachment: { duration: number; peaks: string; mime: string }
  }

  assert.equal(attachment.mime, 'audio/webm')
  assert.ok(Math.abs(attachment.duration - 7.42) < 0.001)
  assert.equal(attachment.peaks, '12,90,44,8')
})

test('a waveform that is not one is refused rather than stored', () => {
  assert.equal(tamePeaks('<script>alert(1)</script>'), null)
  assert.equal(tamePeaks(undefined), null)
  assert.equal(tamePeaks(''), null)
  // Out of range values are pulled back into it, not thrown away.
  assert.equal(tamePeaks('-40,0,50,900'), '0,0,50,100')
  // And it can never grow without bound.
  assert.equal(tamePeaks(Array(400).fill('50').join(',')).split(',').length, 64)
})

test('sound is served in place, so it can be played rather than downloaded', () => {
  const headers = servingHeaders({
    id: 'a',
    name: 'voix.webm',
    mime: 'audio/webm',
    size: 10,
  })
  assert.equal(headers['content-type'], 'audio/webm')
  assert.match(String(headers['content-disposition']), /^inline/)
  assert.equal(headers['x-content-type-options'], 'nosniff')
})

test('an audio type nobody listed is still handed over opaquely', () => {
  assert.equal(isAudible('audio/webm'), true)
  assert.equal(isAudible('audio/flac'), false)
  const headers = servingHeaders({
    id: 'a',
    name: 'piège.flac',
    mime: 'audio/flac',
    size: 10,
  })
  assert.equal(headers['content-type'], 'application/octet-stream')
})
