import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Inbound } from '../net/types'

/**
 * The store's job is to make an unreliable stream look like a settled one.
 * These cases pin the parts that go wrong quietly: an optimistic message that
 * is never reconciled, a duplicate that shows twice, a correction that
 * reshuffles the list or marks something unread.
 */

const sent: unknown[] = []
let deliver: (event: Inbound) => void = () => undefined

vi.mock('../net/socket', () => ({
  connection: {
    link: 'live' as const,
    open: vi.fn(),
    close: vi.fn(),
    send: (frame: unknown) => sent.push(frame),
    on: (listener: (event: Inbound) => void) => {
      deliver = listener
      return () => undefined
    },
    onLink: (listener: (link: 'live') => void) => {
      listener('live')
      return () => undefined
    },
    nudge: vi.fn(),
  },
}))

const { useStore } = await import('./store')

const ME = { id: 'me', handle: 'ada', name: 'Ada', hue: 10 }
const PEER = { id: 'peer', handle: 'alan', name: 'Alan', hue: 200 }

const message = (over: Partial<Record<string, unknown>> = {}) => ({
  id: 'm1',
  conversationId: 'c1',
  senderId: PEER.id,
  body: 'bonjour',
  replyTo: null,
  createdAt: 1000,
  editedAt: null,
  deletedAt: null,
  attachment: null,
  ...over,
})

const conversation = (over = {}) => ({
  id: 'c1',
  peer: PEER,
  lastMessage: null,
  unread: 0,
  peerReadAt: 0,
  ...over,
})

beforeEach(() => {
  sent.length = 0
  useStore.setState({
    status: 'in',
    me: ME,
    conversations: [conversation()],
    messages: {},
    hydrated: { c1: true },
    exhausted: {},
    open: null,
    replyTo: null,
    editing: null,
    typing: {},
    online: {},
    notice: null,
    keepsake: null,
    blocked: [],
  })
})

const thread = () => useStore.getState().messages.c1 ?? []
const rail = () => useStore.getState().conversations

describe('optimistic sending', () => {
  it('shows the message immediately, marked as still in flight', () => {
    useStore.setState({ open: 'c1' })
    useStore.getState().say('les nombres de Bernoulli')

    expect(thread()).toHaveLength(1)
    expect(thread()[0]?.body).toBe('les nombres de Bernoulli')
    expect(thread()[0]?.pending).toBe(true)
    // The wire carries it once, with a nonce the echo can be matched against.
    expect(sent).toEqual([
      expect.objectContaining({
        t: 'send',
        conversation: 'c1',
        body: 'les nombres de Bernoulli',
      }),
    ])
  })

  it('replaces the optimistic copy when the server echoes it back', () => {
    useStore.setState({ open: 'c1' })
    useStore.getState().say('bonjour')
    const nonce = thread()[0]?.id
    expect(nonce).toMatch(/^pending:/)

    deliver({
      t: 'message',
      message: message({ id: 'real-1', senderId: ME.id, body: 'bonjour', createdAt: 2000 }),
      nonce,
    })

    expect(thread()).toHaveLength(1)
    expect(thread()[0]?.id).toBe('real-1')
    expect(thread()[0]?.pending).toBeUndefined()
  })

  it('does not show a message twice when it arrives again', () => {
    deliver({ t: 'message', message: message({ id: 'm1' }) })
    deliver({ t: 'message', message: message({ id: 'm1', body: 'bonjour' }) })
    expect(thread()).toHaveLength(1)
  })

  it('keeps the thread in the order things were said', () => {
    deliver({ t: 'message', message: message({ id: 'later', createdAt: 3000 }) })
    deliver({ t: 'message', message: message({ id: 'earlier', createdAt: 1000 }) })
    expect(thread().map((m) => m.id)).toEqual(['earlier', 'later'])
  })

  it('refuses to send an empty message, or one with no thread open', () => {
    useStore.setState({ open: 'c1' })
    useStore.getState().say('   ')
    expect(thread()).toHaveLength(0)

    useStore.setState({ open: null })
    useStore.getState().say('dans le vide')
    expect(thread()).toHaveLength(0)
  })
})

describe('unread counts', () => {
  it('counts a message that arrives while you are elsewhere', () => {
    deliver({ t: 'message', message: message({ id: 'm1' }) })
    expect(rail()[0]?.unread).toBe(1)
  })

  it('counts nothing while you are looking at the thread', () => {
    useStore.setState({ open: 'c1' })
    deliver({ t: 'message', message: message({ id: 'm1' }) })
    expect(rail()[0]?.unread).toBe(0)
  })

  it('never counts your own words as unread', () => {
    deliver({ t: 'message', message: message({ id: 'm1', senderId: ME.id }) })
    expect(rail()[0]?.unread).toBe(0)
  })
})

describe('corrections', () => {
  it('replaces a message where it stands', () => {
    deliver({ t: 'message', message: message({ id: 'm1', body: 'faute' }) })
    deliver({
      t: 'revised',
      message: message({ id: 'm1', body: 'corrigé', editedAt: 5000 }),
    })

    expect(thread()).toHaveLength(1)
    expect(thread()[0]?.body).toBe('corrigé')
    expect(thread()[0]?.editedAt).toBe(5000)
  })

  it('does not mark anything unread — nothing new was said', () => {
    deliver({ t: 'message', message: message({ id: 'm1' }) })
    const before = rail()[0]?.unread
    deliver({ t: 'revised', message: message({ id: 'm1', body: 'corrigé', editedAt: 5000 }) })
    expect(rail()[0]?.unread).toBe(before)
  })

  it('does not reorder the rail', () => {
    useStore.setState({
      conversations: [
        conversation({ id: 'c1', lastMessage: message({ id: 'm1', createdAt: 1000 }) }),
        conversation({ id: 'c2', lastMessage: message({ id: 'm2', createdAt: 9000 }) }),
      ],
      messages: { c1: [message({ id: 'm1', createdAt: 1000 })] },
    })

    deliver({
      t: 'revised',
      message: message({ id: 'm1', createdAt: 1000, body: 'corrigé', editedAt: 99_000 }),
    })
    expect(rail().map((c) => c.id)).toEqual(['c1', 'c2'])
  })

  it('retracting empties the message but keeps its place', () => {
    deliver({ t: 'message', message: message({ id: 'm1', body: 'oups' }) })
    deliver({ t: 'revised', message: message({ id: 'm1', body: '', deletedAt: 6000 }) })

    expect(thread()).toHaveLength(1)
    expect(thread()[0]?.body).toBe('')
    expect(thread()[0]?.deletedAt).toBe(6000)
  })

  it('drops an edit you were composing if that message is retracted underneath you', () => {
    const target = message({ id: 'm1', senderId: ME.id })
    deliver({ t: 'message', message: target })
    useStore.getState().edit(target)
    expect(useStore.getState().editing?.id).toBe('m1')

    deliver({ t: 'revised', message: message({ id: 'm1', senderId: ME.id, body: '', deletedAt: 7000 }) })
    expect(useStore.getState().editing).toBeNull()
  })

  it('follows the message you were answering when it is rewritten', () => {
    const target = message({ id: 'm1', body: 'avant' })
    deliver({ t: 'message', message: target })
    useStore.getState().reply(target)

    deliver({ t: 'revised', message: message({ id: 'm1', body: 'après', editedAt: 8000 }) })
    expect(useStore.getState().replyTo?.body).toBe('après')
  })

  it('refuses to rewrite words that are not yours', () => {
    const theirs = message({ id: 'm1', senderId: PEER.id })
    useStore.getState().edit(theirs)
    expect(useStore.getState().editing).toBeNull()

    useStore.getState().retract(theirs)
    expect(sent.some((f) => (f as { t: string }).t === 'retract')).toBe(false)
  })
})

describe('the session', () => {
  it('signs out when the server says the token is finished', () => {
    deliver({ t: 'error', message: 'session expirée', code: 'expired' })
    expect(useStore.getState().status).toBe('out')
    expect(useStore.getState().me).toBeNull()
  })

  it('leaves the session alone for an ordinary complaint', () => {
    deliver({ t: 'error', message: 'vous écrivez trop vite', retryAfter: 3 })
    expect(useStore.getState().status).toBe('in')
    expect(useStore.getState().notice).toBe('vous écrivez trop vite')
  })
})

describe('presence and typing', () => {
  it('remembers who is here', () => {
    deliver({ t: 'presence', userId: PEER.id, online: true })
    expect(useStore.getState().online[PEER.id]).toBe(true)

    deliver({ t: 'presence', userId: PEER.id, online: false })
    expect(useStore.getState().online[PEER.id]).toBe(false)
  })

  it('forgets that someone was writing once they stop', () => {
    vi.useFakeTimers()
    deliver({ t: 'typing', conversation: 'c1', userId: PEER.id })
    expect(useStore.getState().typing.c1).toBeTruthy()

    vi.advanceTimersByTime(5000)
    expect(useStore.getState().typing.c1).toBeUndefined()
    vi.useRealTimers()
  })
})
