import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createRef } from 'react'
import type { Conversation, Inbound, Message } from '../net/types'

/*
 * The thread decides two things worth pinning down: what the pinned bar shows
 * when there is more than one pin — it counts rather than growing — and what
 * the header says about who is at the other end.
 */

vi.mock('../net/socket', () => ({
  connection: {
    link: 'live' as const,
    open: vi.fn(),
    close: vi.fn(),
    send: vi.fn(),
    on: (_l: (event: Inbound) => void) => () => undefined,
    onLink: (listener: (link: 'live') => void) => {
      listener('live')
      return () => undefined
    },
    nudge: vi.fn(),
  },
}))

vi.mock('../net/voice', async () => {
  const actual = await vi.importActual<typeof import('../net/voice')>('../net/voice')
  return { ...actual, canRecord: () => false }
})

const { useStore } = await import('../state/store')
const { Thread } = await import('./Thread')

const ME = { id: 'me', handle: 'ada', name: 'Ada', hue: 10 }
const PEER = { id: 'peer', handle: 'alan', name: 'Alan Turing', hue: 200 }

const message = (over: Partial<Message> = {}): Message => ({
  id: 'm1',
  conversationId: 'c1',
  senderId: PEER.id,
  body: 'le compilateur tourne',
  replyTo: null,
  createdAt: Date.now(),
  editedAt: null,
  deletedAt: null,
  attachment: null,
  forwarded: null,
  ...over,
})

const conversation = (over: Partial<Conversation> = {}): Conversation => ({
  id: 'c1',
  kind: 'direct',
  face: { id: PEER.id, name: PEER.name, hue: PEER.hue },
  members: [PEER],
  lastMessage: message(),
  unread: 0,
  readAt: 0,
  pins: [],
  draft: '',
  ...over,
})

const show = (over: Partial<Conversation> = {}, state: Record<string, unknown> = {}) => {
  const it = conversation(over)
  useStore.setState({
    status: 'in',
    me: ME,
    conversations: [it],
    messages: { c1: [message()] },
    open: 'c1',
    typing: {},
    online: {},
    replyTo: null,
    editing: null,
    relaying: null,
    ...state,
  })
  return render(
    <Thread conversation={it} onLeave={vi.fn()} headSigil={createRef()} sigilHidden={false} />,
  )
}

beforeEach(() => {
  useStore.setState({ typing: {}, online: {}, relaying: null })
})

describe('the header', () => {
  it('says who this is when they are away', () => {
    show()
    expect(screen.getByText('Alan Turing')).toBeInTheDocument()
    expect(screen.getByText('@alan')).toBeInTheDocument()
  })

  it('says they are here when they are', () => {
    show({}, { online: { [PEER.id]: true } })
    expect(screen.getByText('en ligne')).toBeInTheDocument()
  })

  it('counts a room rather than naming it', () => {
    show({ kind: 'group', face: { id: 'c1', name: 'Hut 8', hue: 90 }, members: [PEER, ME] })
    expect(screen.getByText('3 membres')).toBeInTheDocument()
  })

  it('offers a call to one person, and not to a room', () => {
    const one = show()
    expect(screen.getByLabelText(/appeler Alan Turing/)).toBeInTheDocument()
    one.unmount()

    show({ kind: 'group', face: { id: 'c1', name: 'Hut 8', hue: 90 }, members: [PEER, ME] })
    expect(screen.queryByLabelText(/appeler/)).not.toBeInTheDocument()
  })
})

describe('the pinned bar', () => {
  it('is absent when nothing is pinned', () => {
    const { container } = show()
    expect(container.querySelector('.pinbar')).toBeNull()
  })

  it('shows what was pinned', () => {
    show({ pins: [message({ id: 'p1', body: 'la démo est vendredi' })] })
    expect(screen.getByText('la démo est vendredi')).toBeInTheDocument()
    expect(screen.getByText('épinglé')).toBeInTheDocument()
  })

  it('counts instead of growing when there are several', async () => {
    const user = userEvent.setup()
    const { container } = show({
      pins: [
        message({ id: 'p1', body: 'la démo est vendredi' }),
        message({ id: 'p2', body: 'la salle est réservée' }),
      ],
    })

    expect(container.querySelectorAll('.pinbar')).toHaveLength(1)
    expect(screen.getByText('épinglé · 1/2')).toBeInTheDocument()

    // Each visit moves to the next, rather than showing both at once.
    await user.click(screen.getByTitle('aller au message épinglé'))
    expect(screen.getByText('épinglé · 2/2')).toBeInTheDocument()
    expect(screen.getByText('la salle est réservée')).toBeInTheDocument()
  })

  it('names a pinned message with no words by what it is', () => {
    show({
      pins: [
        message({
          id: 'p1',
          body: '',
          attachment: {
            id: 'a1',
            name: 'voix.webm',
            mime: 'audio/webm',
            size: 1,
            width: null,
            height: null,
            duration: 3,
            peaks: '10,50',
          },
        }),
      ],
    })
    expect(screen.getByText('message vocal')).toBeInTheDocument()
  })

  it('lets the pin be taken down from the bar itself', async () => {
    const user = userEvent.setup()
    const pin = vi.fn()
    useStore.setState({ pin })
    show({ pins: [message({ id: 'p1', body: 'la démo est vendredi' })] })

    await user.click(screen.getByLabelText('détacher ce message'))
    expect(pin).toHaveBeenCalledWith(expect.objectContaining({ id: 'p1' }), false)
  })
})

describe('an empty thread', () => {
  it('invites the first word rather than showing a blank', () => {
    show({}, { messages: { c1: [] } })
    expect(screen.getByText(/Rien n’a encore été dit/)).toBeInTheDocument()
  })
})
