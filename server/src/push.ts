import webpush, { type PushSubscription, WebPushError } from 'web-push'
import { db } from './db.js'
import { log } from './log.js'

/*
 * Web Push.
 *
 * A messenger you only receive on while the tab is open is a messenger you
 * check, not one you use. This is the piece that lets a message arrive when
 * the application is closed.
 *
 * The payload is encrypted end-to-end between this server and the browser —
 * the push service in the middle relays bytes it cannot read. Even so, the
 * preview can be turned off for people who would rather a lock screen say
 * nothing about who wrote what.
 */

export type Delivery = { sent: number; dropped: number }

type SubscriptionRow = {
  endpoint: string
  p256dh: string
  auth: string
  failures: number
}

/** How many consecutive failures a subscription survives before being dropped. */
const PATIENCE = 3

const publicKey = process.env.VAPID_PUBLIC_KEY?.trim() ?? ''
const privateKey = process.env.VAPID_PRIVATE_KEY?.trim() ?? ''
const subject = process.env.VAPID_SUBJECT?.trim() || 'mailto:postmaster@localhost'
/** `PUSH_PREVIEW=0` sends a notification with no sender and no words. */
const showPreview = (process.env.PUSH_PREVIEW ?? '1') !== '0'

export const pushEnabled = Boolean(publicKey && privateKey)

if (pushEnabled) {
  webpush.setVapidDetails(subject, publicKey, privateKey)
} else {
  log.info('push.disabled', { reason: 'VAPID keys not set' })
}

export const pushPublicKey = (): string => publicKey

/* ---------------------------------------------------------- subscriptions */

export function saveSubscription(userId: string, subscription: PushSubscription): void {
  const keys = subscription.keys as { p256dh?: string; auth?: string } | undefined
  if (!subscription.endpoint || !keys?.p256dh || !keys.auth) {
    throw new Error('incomplete subscription')
  }
  db.prepare(
    `INSERT INTO push_subscriptions (endpoint, user_id, p256dh, auth, created_at, failures)
     VALUES (?, ?, ?, ?, ?, 0)
     ON CONFLICT(endpoint) DO UPDATE SET
       user_id = excluded.user_id,
       p256dh  = excluded.p256dh,
       auth    = excluded.auth,
       failures = 0`,
  ).run(subscription.endpoint, userId, keys.p256dh, keys.auth, Date.now())
}

export function forgetSubscription(userId: string, endpoint: string): void {
  db.prepare(`DELETE FROM push_subscriptions WHERE endpoint = ? AND user_id = ?`).run(
    endpoint,
    userId,
  )
}

/** Every device a person has asked to be reached on. */
export function subscriptionsFor(userId: string): SubscriptionRow[] {
  return db
    .prepare(
      `SELECT endpoint, p256dh, auth, failures FROM push_subscriptions WHERE user_id = ?`,
    )
    .all(userId) as SubscriptionRow[]
}

export const subscriptionCount = (userId: string): number =>
  (db
    .prepare(`SELECT count(*) AS n FROM push_subscriptions WHERE user_id = ?`)
    .get(userId) as { n: number }).n

const drop = (endpoint: string) =>
  db.prepare(`DELETE FROM push_subscriptions WHERE endpoint = ?`).run(endpoint)

const noteFailure = (endpoint: string, failures: number) => {
  if (failures + 1 >= PATIENCE) {
    drop(endpoint)
    return true
  }
  db.prepare(`UPDATE push_subscriptions SET failures = failures + 1 WHERE endpoint = ?`).run(
    endpoint,
  )
  return false
}

const noteSuccess = (endpoint: string) =>
  db.prepare(`UPDATE push_subscriptions SET failures = 0 WHERE endpoint = ?`).run(endpoint)

/* ------------------------------------------------------------- delivering */

export type Knock = {
  conversationId: string
  from: string
  body: string
}

/** What actually reaches the lock screen. */
export function composeNotification(knock: Knock): string {
  return JSON.stringify(
    showPreview
      ? { title: knock.from, body: knock.body.slice(0, 180), conversation: knock.conversationId }
      : { title: 'Kairus', body: 'nouveau message', conversation: knock.conversationId },
  )
}

/**
 * Sends to every device registered for this person. A subscription the push
 * service has retired (404/410) is removed at once; one that merely failed is
 * given a few chances before being let go.
 */
export async function knock(userId: string, message: Knock): Promise<Delivery> {
  if (!pushEnabled) return { sent: 0, dropped: 0 }

  const payload = composeNotification(message)
  const subscriptions = subscriptionsFor(userId)
  let sent = 0
  let dropped = 0

  await Promise.all(
    subscriptions.map(async (row) => {
      const subscription: PushSubscription = {
        endpoint: row.endpoint,
        keys: { p256dh: row.p256dh, auth: row.auth },
      }
      try {
        await webpush.sendNotification(subscription, payload, { TTL: 12 * 3600 })
        noteSuccess(row.endpoint)
        sent += 1
      } catch (error) {
        const gone =
          error instanceof WebPushError && (error.statusCode === 404 || error.statusCode === 410)
        if (gone) {
          drop(row.endpoint)
          dropped += 1
          return
        }
        if (noteFailure(row.endpoint, row.failures)) dropped += 1
        log.warn('push.failed', {
          endpoint: row.endpoint.slice(0, 40),
          status: error instanceof WebPushError ? error.statusCode : undefined,
        })
      }
    }),
  )

  if (sent || dropped) log.info('push.delivered', { userId, sent, dropped })
  return { sent, dropped }
}
