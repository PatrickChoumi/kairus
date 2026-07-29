import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * The subscription dance is easy to get subtly wrong — a key decoded the wrong
 * way, a permission asked for on load, a subscription created but never sent
 * to the server. None of that fails loudly, so it is pinned here.
 */

const calls: { path: string; payload?: unknown }[] = []
let pushConfig = { enabled: true, key: 'BHpoc5houn0CAs6iERyKJ5xyZ0gGqirwCEMsNtWwoK1PON6NxbFYqoVArlxYCwpyumuXgrEV36-q_lu0Q3gXJPU', devices: 0 }

vi.mock('./api', () => ({
  api: {
    push: async () => {
      calls.push({ path: 'push' })
      return pushConfig
    },
    pushSubscribe: async (subscription: unknown) => {
      calls.push({ path: 'subscribe', payload: subscription })
      return { devices: 1 }
    },
    pushUnsubscribe: async (endpoint: string) => {
      calls.push({ path: 'unsubscribe', payload: endpoint })
      return { devices: 0 }
    },
  },
}))

const { decodeKey, disablePush, enablePush, pushState } = await import('./push')

class FakeSubscription {
  constructor(readonly endpoint = 'https://push.example/abc') {}
  toJSON() {
    return { endpoint: this.endpoint, keys: { p256dh: 'p', auth: 'a' } }
  }
  unsubscribe = vi.fn(async () => true)
}

let existing: FakeSubscription | null = null
const subscribe = vi.fn(async (_options?: PushSubscriptionOptionsInit) => new FakeSubscription())

const install = (permission: NotificationPermission) => {
  // The real Notification is a constructor carrying static members; a plain
  // object would not behave like it where the code checks for one.
  const FakeNotification = function FakeNotification() {} as unknown as {
    permission: NotificationPermission
    requestPermission: ReturnType<typeof vi.fn>
  }
  FakeNotification.permission = permission
  FakeNotification.requestPermission = vi.fn(async () => permission)
  vi.stubGlobal('Notification', FakeNotification)
  vi.stubGlobal('PushManager', class {})
  Object.defineProperty(navigator, 'serviceWorker', {
    configurable: true,
    value: {
      ready: Promise.resolve({
        pushManager: {
          getSubscription: async () => existing,
          subscribe,
        },
      }),
    },
  })
}

beforeEach(() => {
  calls.length = 0
  existing = null
  subscribe.mockClear()
  pushConfig = { enabled: true, key: 'BHpoc5houn0CAs6iERyKJ5xyZ0gGqirwCEMsNtWwoK1PON6NxbFYqoVArlxYCwpyumuXgrEV36-q_lu0Q3gXJPU', devices: 0 }
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('the server key', () => {
  it('decodes base64url, padding included', () => {
    // "hello" in base64url, unpadded, as the server hands it out.
    const bytes = decodeKey('aGVsbG8')
    expect(Array.from(bytes)).toEqual([104, 101, 108, 108, 111])
  })

  it('accepts the url-safe alphabet a real key uses', () => {
    const key = 'BHpoc5houn0CAs6iERyKJ5xyZ0gGqirwCEMsNtWwoK1PON6NxbFYqoVArlxYCwpyumuXgrEV36-q_lu0Q3gXJPU'
    expect(decodeKey(key)).toHaveLength(65)
  })
})

describe('turning notifications on', () => {
  it('asks for permission, subscribes, and tells the server', async () => {
    install('granted')
    const state = await enablePush()

    expect(state).toBe('on')
    expect(subscribe).toHaveBeenCalledOnce()
    expect(subscribe.mock.calls[0]?.[0]).toMatchObject({ userVisibleOnly: true })
    expect(calls.map((c) => c.path)).toEqual(['push', 'subscribe'])
    expect(calls[1]?.payload).toMatchObject({ endpoint: 'https://push.example/abc' })
  })

  it('reuses a subscription this browser already has', async () => {
    install('granted')
    existing = new FakeSubscription('https://push.example/already')
    const state = await enablePush()

    expect(state).toBe('on')
    expect(subscribe).not.toHaveBeenCalled()
    expect(calls[1]?.payload).toMatchObject({ endpoint: 'https://push.example/already' })
  })

  it('stops at a refusal instead of subscribing anyway', async () => {
    install('denied')
    const state = await enablePush()

    expect(state).toBe('refused')
    expect(subscribe).not.toHaveBeenCalled()
    expect(calls.some((c) => c.path === 'subscribe')).toBe(false)
  })

  it('says so when the server has no keys, without asking the user anything', async () => {
    install('granted')
    pushConfig = { enabled: false, key: '', devices: 0 }
    const state = await enablePush()

    expect(state).toBe('unconfigured')
    expect(Notification.requestPermission).not.toHaveBeenCalled()
  })

  it('reports a browser that cannot do this at all', async () => {
    install('granted')
    // Present but unusable is the case an `in` check would wave through.
    vi.stubGlobal('PushManager', undefined)
    expect(await enablePush()).toBe('unsupported')
    expect(await pushState()).toBe('unsupported')
  })
})

describe('turning them off', () => {
  it('unsubscribes here and there', async () => {
    install('granted')
    const subscription = new FakeSubscription()
    existing = subscription

    expect(await disablePush()).toBe('off')
    expect(calls.some((c) => c.path === 'unsubscribe')).toBe(true)
    expect(subscription.unsubscribe).toHaveBeenCalledOnce()
  })

  it('is harmless when there was nothing to undo', async () => {
    install('granted')
    expect(await disablePush()).toBe('off')
  })
})

describe('reading the current state', () => {
  it('is on when this browser holds a subscription', async () => {
    install('granted')
    existing = new FakeSubscription()
    expect(await pushState()).toBe('on')
  })

  it('is off when it does not', async () => {
    install('granted')
    expect(await pushState()).toBe('off')
  })

  it('reports a refusal ahead of anything else', async () => {
    install('denied')
    expect(await pushState()).toBe('refused')
  })
})

describe('when the browser will not mint a subscription', () => {
  it('says why instead of failing shapelessly', async () => {
    install('granted')
    subscribe.mockRejectedValueOnce(
      new Error('Chrome does not support the Push API in incognito mode'),
    )
    // This is exactly what private browsing does, and it is undetectable
    // ahead of time — so the only honest place to notice is here.
    expect(await enablePush()).toBe('failed')
    expect(calls.some((c) => c.path === 'subscribe')).toBe(false)
  })
})
