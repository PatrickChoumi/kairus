import { api } from './api'

/*
 * Asking to be reachable when the application is closed.
 *
 * Permission is never requested on load — a prompt nobody asked for gets
 * dismissed once and then blocks the feature for good. It is asked for only
 * when someone chooses it from the Cursor.
 */

export type PushState =
  | 'unsupported'
  | 'unconfigured'
  | 'off'
  | 'on'
  | 'refused'
  /** The browser would not mint a subscription — private browsing, usually. */
  | 'failed'

/**
 * Checks that the pieces are usable, not merely named. A property that exists
 * and holds `undefined` would pass an `in` test and then throw on first use.
 */
const supported = (): boolean =>
  typeof window !== 'undefined' &&
  typeof navigator.serviceWorker === 'object' &&
  navigator.serviceWorker !== null &&
  typeof window.PushManager === 'function' &&
  typeof window.Notification === 'function'

/** base64url as the server hands it out, to the bytes PushManager wants. */
export function decodeKey(base64: string): Uint8Array<ArrayBuffer> {
  const padded = base64.padEnd(base64.length + ((4 - (base64.length % 4)) % 4), '=')
  const binary = atob(padded.replace(/-/g, '+').replace(/_/g, '/'))
  const bytes = new Uint8Array(new ArrayBuffer(binary.length))
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i)
  return bytes
}

const registration = async (): Promise<ServiceWorkerRegistration | null> => {
  if (!supported()) return null
  try {
    return await navigator.serviceWorker.ready
  } catch {
    return null
  }
}

export async function pushState(): Promise<PushState> {
  if (!supported()) return 'unsupported'
  if (Notification.permission === 'denied') return 'refused'
  try {
    const { enabled } = await api.push()
    if (!enabled) return 'unconfigured'
  } catch {
    return 'unconfigured'
  }
  const reg = await registration()
  const existing = await reg?.pushManager.getSubscription()
  return existing ? 'on' : 'off'
}

/** Returns the state it ended in, so the caller can say what happened. */
export async function enablePush(): Promise<PushState> {
  if (!supported()) return 'unsupported'

  const { enabled, key } = await api.push()
  if (!enabled || !key) return 'unconfigured'

  const permission = await Notification.requestPermission()
  if (permission !== 'granted') return 'refused'

  const reg = await registration()
  if (!reg) return 'unsupported'

  let subscription: PushSubscription | null = null
  try {
    subscription =
      (await reg.pushManager.getSubscription()) ??
      (await reg.pushManager.subscribe({
        // Web Push requires this: a payload must always be shown to the user.
        userVisibleOnly: true,
        applicationServerKey: decodeKey(key),
      }))
  } catch {
    // Chrome disables the Push API in private browsing, and says nothing that
    // can be feature-detected. Reaching the push service can also simply fail.
    return 'failed'
  }

  await api.pushSubscribe(subscription.toJSON())
  return 'on'
}

export async function disablePush(): Promise<PushState> {
  const reg = await registration()
  const subscription = await reg?.pushManager.getSubscription()
  if (subscription) {
    await api.pushUnsubscribe(subscription.endpoint).catch(() => undefined)
    await subscription.unsubscribe().catch(() => undefined)
  }
  return 'off'
}
