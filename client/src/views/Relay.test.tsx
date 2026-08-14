import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { Conversation, Inbound, Message } from '../net/types'

/*
 * Forwarding is the one action in the application that puts someone's words
 * somewhere they were never said. The screen that does it has one job beyond
 * picking a destination: showing what is about to travel, so nobody sends the
 * wrong thing to the wrong room.
 */

const sent: Record<string, unknown>[] = []

vi.mock('../net/socket', () => ({
  connection: {
    link: 'live' as const,
    open: vi.fn(),
    close: vi.fn(),
    send: (frame: Record<string, unknown>) => sent.push(frame),
    on: (_l: (event: Inbound) => void) => () => undefined,
    onLink: (listener: (link: 'live') => void) => {
      listener('live')
      return () => undefined
    },
    nudge: vi.fn(),
  },
}))

const { useStore } = await import('../state/store')
const { Relay } = await import('./Relay')

const ME = { id: 'me', handle: 'ada', name: 'Ada', hue: 10 }
const PEER = { id: 'peer', handle: 'alan', name: 'Alan Turing', hue: 200 }

const message = (over: Partial<Message> = {}): Message => ({
  id: 'm1',
  conversationId: 'c1',
  senderId: PEER.id,
  body: 'le compilateur tourne',
  replyTo: null,
  createdAt: 1000,
  editedAt: null,
  deletedAt: null,
  attachment: null,
  forwarded: null,
  ...over,
})

const conversation = (id: string, name: string, over: Partial<Conversation> = {}): Conversation => ({
  id,
  kind: 'direct',
  face: { id: `f-${id}`, name, hue: 200 },
  members: [PEER],
  lastMessage: null,
  unread: 0,
  readAt: 0,
  pins: [],
  draft: '',
  mutedUntil: 0,
  ...over,
})

beforeEach(() => {
  sent.length = 0
  useStore.setState({
    status: 'in',
    me: ME,
    conversations: [
      conversation('c1', 'Alan Turing'),
      conversation('c2', 'Hut 8', { kind: 'group', members: [PEER, ME] }),
      conversation('c3', 'Grace Hopper'),
    ],
    relaying: null,
    notice: null,
  })
})

describe('picking a destination', () => {
  it('shows nothing at all until a message is picked up', () => {
    const { container } = render(<Relay />)
    expect(container).toBeEmptyDOMElement()
  })

  it('says what is about to be sent', async () => {
    render(<Relay />)
    useStore.getState().relay(message())
    await waitFor(() => expect(screen.getByText('le compilateur tourne')).toBeInTheDocument())
  })

  it('names a message that has no words by what it is', async () => {
    render(<Relay />)
    useStore.getState().relay(
      message({
        body: '',
        attachment: {
          id: 'a1',
          name: 'voix.webm',
          mime: 'audio/webm',
          size: 100,
          width: null,
          height: null,
          duration: 4,
          peaks: '10,80',
        },
      }),
    )
    await waitFor(() => expect(screen.getByText('un message vocal')).toBeInTheDocument())
  })

  it('offers every conversation, and narrows as you type', async () => {
    const user = userEvent.setup()
    render(<Relay />)
    useStore.getState().relay(message())
    await waitFor(() => expect(screen.getAllByRole('button')).not.toHaveLength(0))

    expect(screen.getByText('Hut 8')).toBeInTheDocument()
    expect(screen.getByText('Grace Hopper')).toBeInTheDocument()

    await user.type(screen.getByPlaceholderText('une conversation'), 'hut')
    await waitFor(() => expect(screen.queryByText('Grace Hopper')).not.toBeInTheDocument())
    expect(screen.getByText('Hut 8')).toBeInTheDocument()
  })

  it('says so rather than showing an empty list', async () => {
    const user = userEvent.setup()
    render(<Relay />)
    useStore.getState().relay(message())
    await waitFor(() => expect(screen.getByPlaceholderText('une conversation')).toBeInTheDocument())

    await user.type(screen.getByPlaceholderText('une conversation'), 'zzz')
    await waitFor(() =>
      expect(screen.getByText('Aucune conversation de ce nom.')).toBeInTheDocument(),
    )
  })
})

describe('sending it on', () => {
  it('sends to what was clicked, and closes', async () => {
    const user = userEvent.setup()
    render(<Relay />)
    useStore.getState().relay(message())
    await waitFor(() => expect(screen.getByText('Hut 8')).toBeInTheDocument())

    await user.click(screen.getByText('Hut 8'))
    expect(sent.at(-1)).toMatchObject({ t: 'forward', conversation: 'c2', message: 'm1' })
    await waitFor(() => expect(useStore.getState().relaying).toBeNull())
  })

  it('sends to what the keyboard is aimed at', async () => {
    const user = userEvent.setup()
    render(<Relay />)
    useStore.getState().relay(message())
    await waitFor(() => expect(screen.getByPlaceholderText('une conversation')).toBeInTheDocument())

    // First is aimed by default; one step down lands on the group.
    await user.click(screen.getByPlaceholderText('une conversation'))
    await user.keyboard('{ArrowDown}{Enter}')
    expect(sent.at(-1)).toMatchObject({ t: 'forward', conversation: 'c2' })
  })

  it('gives up on Escape, without sending anything', async () => {
    const user = userEvent.setup()
    render(<Relay />)
    useStore.getState().relay(message())
    await waitFor(() => expect(screen.getByPlaceholderText('une conversation')).toBeInTheDocument())

    await user.keyboard('{Escape}')
    await waitFor(() => expect(useStore.getState().relaying).toBeNull())
    expect(sent.filter((f) => f.t === 'forward')).toHaveLength(0)
  })

  it('says where it went', async () => {
    const user = userEvent.setup()
    render(<Relay />)
    useStore.getState().relay(message())
    await waitFor(() => expect(screen.getByText('Hut 8')).toBeInTheDocument())

    await user.click(screen.getByText('Hut 8'))
    expect(useStore.getState().notice).toBe('transféré à Hut 8')
  })
})
