import { after, before, beforeEach, test } from 'node:test'
import assert from 'node:assert/strict'
import { call, db, register, start, stop, wipe } from './harness.js'
import {
  composeNotification,
  forgetSubscription,
  pushEnabled,
  saveSubscription,
  subscriptionCount,
  subscriptionsFor,
} from '../src/push.js'
import { asPrometheus, count, resetCounters, snapshot } from '../src/log.js'

before(start)
after(stop)
beforeEach(() => {
  wipe()
  db.exec('DELETE FROM push_subscriptions')
  resetCounters()
})

const subscription = (endpoint: string) => ({
  endpoint,
  keys: { p256dh: 'a-public-key', auth: 'an-auth-secret' },
})

/* ------------------------------------------------------------ subscriptions */

test('a device is remembered, and the same one twice is still one device', async () => {
  const ada = await register('ada')
  saveSubscription(ada.user.id, subscription('https://push.example/1'))
  saveSubscription(ada.user.id, subscription('https://push.example/1'))
  assert.equal(subscriptionCount(ada.user.id), 1)

  saveSubscription(ada.user.id, subscription('https://push.example/2'))
  assert.equal(subscriptionCount(ada.user.id), 2, 'a second device is a second device')
})

test('an incomplete subscription is refused rather than stored broken', async () => {
  const ada = await register('ada')
  assert.throws(() =>
    saveSubscription(ada.user.id, { endpoint: 'https://push.example/3' } as never),
  )
  assert.equal(subscriptionCount(ada.user.id), 0)
})

test('a device can be forgotten, and only by its owner', async () => {
  const ada = await register('ada')
  const alan = await register('alan')
  saveSubscription(ada.user.id, subscription('https://push.example/1'))

  forgetSubscription(alan.user.id, 'https://push.example/1')
  assert.equal(subscriptionCount(ada.user.id), 1, 'someone else cannot unsubscribe your device')

  forgetSubscription(ada.user.id, 'https://push.example/1')
  assert.equal(subscriptionCount(ada.user.id), 0)
})

test('subscriptions do not leak between people', async () => {
  const ada = await register('ada')
  const alan = await register('alan')
  saveSubscription(ada.user.id, subscription('https://push.example/1'))
  saveSubscription(alan.user.id, subscription('https://push.example/2'))

  assert.deepEqual(
    subscriptionsFor(ada.user.id).map((s) => s.endpoint),
    ['https://push.example/1'],
  )
})

/* ---------------------------------------------------------------- payload */

test('the notification carries who wrote and what, and stays short', () => {
  const notice = JSON.parse(
    composeNotification({
      conversationId: 'c1',
      from: 'Ada Lovelace',
      body: 'x'.repeat(500),
    }),
  ) as { title: string; body: string; conversation: string }

  assert.equal(notice.title, 'Ada Lovelace')
  assert.equal(notice.conversation, 'c1')
  assert.ok(notice.body.length <= 180, 'a lock screen is not a document viewer')
})

/* ------------------------------------------------------------------ routes */

test('the endpoint says whether push is configured at all', async () => {
  const ada = await register('ada')
  const reply = await call<{ enabled: boolean; devices: number }>('GET', '/api/push', {
    token: ada.token,
  })
  assert.equal(reply.status, 200)
  assert.equal(reply.body.enabled, pushEnabled)
  assert.equal(reply.body.devices, 0)
})

test('subscribing without keys configured is refused honestly', async () => {
  const ada = await register('ada')
  const reply = await call('POST', '/api/push/subscribe', {
    token: ada.token,
    body: { subscription: subscription('https://push.example/1') },
  })
  // The test process has no VAPID keys, so the server must say so rather than
  // pretend it will deliver anything.
  assert.equal(reply.status, pushEnabled ? 200 : 503)
})

test('push endpoints need a session', async () => {
  const reply = await call('GET', '/api/push')
  assert.equal(reply.status, 401)
})

/* -------------------------------------------------------------- telemetry */

test('counters add up and read out in both shapes', () => {
  count('http.requests')
  count('http.requests', 4)
  count('push.subscribed')

  const values = snapshot()
  assert.equal(values['http.requests'], 5)
  assert.equal(values['push.subscribed'], 1)

  const text = asPrometheus()
  assert.match(text, /kairus_http_requests 5/)
  assert.match(text, /kairus_push_subscribed 1/)
})

test('metrics stay behind a token, and are invisible without one', async () => {
  const before = process.env.METRICS_TOKEN
  delete process.env.METRICS_TOKEN
  const hidden = await call('GET', '/api/metrics')
  assert.equal(hidden.status, 404, 'an unconfigured metrics route must not announce itself')

  process.env.METRICS_TOKEN = 'a-scrape-token'
  try {
    const refused = await call('GET', '/api/metrics?token=wrong')
    assert.equal(refused.status, 401)

    const allowed = await call<Record<string, number>>('GET', '/api/metrics?token=a-scrape-token')
    assert.equal(allowed.status, 200)
    assert.ok(typeof allowed.body['http.requests'] === 'number')
  } finally {
    if (before === undefined) delete process.env.METRICS_TOKEN
    else process.env.METRICS_TOKEN = before
  }
})

test('the request counter follows actual traffic', async () => {
  resetCounters()
  await call('GET', '/api/health')
  await call('GET', '/api/health')
  assert.equal(snapshot()['http.requests'], 2)
})

test('a refusal is counted as one', async () => {
  await register('ada')
  resetCounters()
  for (let i = 0; i < 12; i += 1) {
    await call('POST', '/api/auth/login', { body: { handle: 'ada', password: 'wrong' } })
  }
  const values = snapshot()
  assert.ok((values['http.throttled'] ?? 0) > 0, 'throttling must be visible in the numbers')
  assert.ok((values['http.status.401'] ?? 0) > 0)
})
