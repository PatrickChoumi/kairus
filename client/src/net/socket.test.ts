import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { connection } from './socket'

/**
 * The live link is the most timing-sensitive code in the client: it reconnects
 * on its own, and it holds what you said while it was away. A fake socket lets
 * those paths be driven deterministically instead of hoped about.
 */
class FakeSocket {
  static instances: FakeSocket[] = []
  static readonly OPEN = 1
  static readonly CLOSED = 3

  readyState = 0
  sent: string[] = []
  onopen: (() => void) | null = null
  onmessage: ((event: { data: string }) => void) | null = null
  onclose: (() => void) | null = null
  onerror: (() => void) | null = null

  constructor(readonly url: string) {
    FakeSocket.instances.push(this)
  }

  send(data: string) {
    this.sent.push(data)
  }

  close() {
    this.readyState = FakeSocket.CLOSED
    this.onclose?.()
  }

  /** Completes the handshake the way the real server would. */
  accept() {
    this.readyState = FakeSocket.OPEN
    this.onopen?.()
    this.onmessage?.({
      data: JSON.stringify({ t: 'ready', user: { id: 'u1' }, conversations: [] }),
    })
  }

  deliver(frame: unknown) {
    this.onmessage?.({ data: JSON.stringify(frame) })
  }

  get frames(): { t: string; [key: string]: unknown }[] {
    return this.sent.map((raw) => JSON.parse(raw))
  }

  static latest(): FakeSocket {
    const last = FakeSocket.instances[FakeSocket.instances.length - 1]
    if (!last) throw new Error('no socket was opened')
    return last
  }
}

beforeEach(() => {
  FakeSocket.instances = []
  vi.stubGlobal('WebSocket', FakeSocket)
  vi.useFakeTimers()
})

afterEach(() => {
  connection.close()
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('the live link', () => {
  it('identifies itself as soon as the socket opens', () => {
    connection.open('a-token')
    FakeSocket.latest().accept()
    expect(FakeSocket.latest().frames[0]).toEqual({ t: 'hello', token: 'a-token' })
  })

  it('reports itself live only once the server answers', () => {
    const seen: string[] = []
    connection.onLink((link) => seen.push(link))
    connection.open('a-token')
    expect(connection.link).not.toBe('live')

    FakeSocket.latest().accept()
    expect(connection.link).toBe('live')
    expect(seen).toContain('live')
  })

  it('holds what you said while it is away, and says it on reconnection', () => {
    connection.open('a-token')
    // Nothing is open yet — this must not be lost.
    connection.send({
      t: 'send',
      conversation: 'c1',
      body: 'écrit hors ligne',
      replyTo: null,
      nonce: 'n1',
    })

    FakeSocket.latest().accept()
    const bodies = FakeSocket.latest()
      .frames.filter((f) => f.t === 'send')
      .map((f) => f.body)
    expect(bodies).toEqual(['écrit hors ligne'])
  })

  it('drops signals that are worthless once late', () => {
    connection.open('a-token')
    connection.send({ t: 'typing', conversation: 'c1' })
    FakeSocket.latest().accept()
    expect(FakeSocket.latest().frames.some((f) => f.t === 'typing')).toBe(false)
  })

  it('reconnects on its own after the socket drops', () => {
    connection.open('a-token')
    FakeSocket.latest().accept()
    expect(FakeSocket.instances).toHaveLength(1)

    FakeSocket.latest().close()
    expect(connection.link).toBe('offline')

    // The first retry is a fraction of a second, jittered.
    vi.advanceTimersByTime(1000)
    expect(FakeSocket.instances.length).toBeGreaterThan(1)
  })

  it('backs off further on each failure instead of hammering', () => {
    connection.open('a-token')
    FakeSocket.latest().accept()

    for (let attempt = 0; attempt < 4; attempt += 1) {
      FakeSocket.latest().close()
      vi.advanceTimersByTime(20_000)
    }
    const opened = FakeSocket.instances.length

    FakeSocket.latest().close()
    // A short wait is no longer enough to trigger the next attempt.
    vi.advanceTimersByTime(200)
    expect(FakeSocket.instances.length).toBe(opened)
  })

  it('does not wait out the backoff when the tab comes back', () => {
    connection.open('a-token')
    FakeSocket.latest().accept()
    FakeSocket.latest().close()
    const before = FakeSocket.instances.length

    connection.nudge()
    expect(FakeSocket.instances.length).toBe(before + 1)
  })

  it('stays closed once closed on purpose', () => {
    connection.open('a-token')
    FakeSocket.latest().accept()
    connection.close()
    const after = FakeSocket.instances.length

    vi.advanceTimersByTime(60_000)
    expect(FakeSocket.instances.length).toBe(after)
    expect(connection.link).toBe('offline')
  })

  it('hands every frame to its listeners', () => {
    const seen: unknown[] = []
    const stop = connection.on((message) => seen.push(message))
    connection.open('a-token')
    FakeSocket.latest().accept()
    FakeSocket.latest().deliver({ t: 'typing', conversation: 'c1', userId: 'u2' })

    expect(seen).toHaveLength(2) // ready, then typing
    stop()
  })

  it('ignores a frame that is not valid JSON rather than falling over', () => {
    connection.open('a-token')
    FakeSocket.latest().accept()
    expect(() => FakeSocket.latest().onmessage?.({ data: 'not json' })).not.toThrow()
  })
})
