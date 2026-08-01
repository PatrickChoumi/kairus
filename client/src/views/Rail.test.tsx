import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import type { Conversation, Inbound, Message } from '../net/types'

/*
 * One line per conversation has to say four things at once: who, when, what
 * was last said, and how much of it you have not read. The order of
 * precedence between them is a product decision, not an implementation
 * detail — a half-written sentence outranks what was said, because it is the
 * thing you have to come back and finish.
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

const { useStore } = await import('../state/store')
const { Rail } = await import('./Rail')

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
  useStore.setState({
    status: 'in',
    me: ME,
    conversations: [conversation(over)],
    open: null,
    typing: {},
    online: {},
    ...state,
  })
  return render(<Rail onOpen={vi.fn()} dimmed={false} />)
}

beforeEach(() => {
  useStore.setState({ conversations: [], open: null, typing: {}, online: {} })
})

describe('what a line says', () => {
  it('shows the name and the last thing said', () => {
    show()
    expect(screen.getByText('Alan Turing')).toBeInTheDocument()
    expect(screen.getByText(/le compilateur tourne/)).toBeInTheDocument()
  })

  it('marks your own words as yours', () => {
    show({ lastMessage: message({ senderId: ME.id }) })
    expect(screen.getByText('vous :')).toBeInTheDocument()
  })

  it('names a message with no words by what it is', () => {
    const carried = (mime: string) =>
      message({
        body: '',
        attachment: {
          id: 'a1',
          name: 'x',
          mime,
          size: 1,
          width: null,
          height: null,
          duration: null,
          peaks: null,
        },
      })

    const sound = show({ lastMessage: carried('audio/webm') })
    expect(screen.getByText(/message vocal/)).toBeInTheDocument()
    sound.unmount()

    show({ lastMessage: carried('image/png') })
    expect(screen.getByText(/photo/)).toBeInTheDocument()
  })

  it('counts what has not been read', () => {
    show({ unread: 3 })
    expect(screen.getByText('3')).toBeInTheDocument()
  })

  it('says nothing has been said yet rather than showing a blank', () => {
    show({ lastMessage: null })
    expect(screen.getByText('rien encore')).toBeInTheDocument()
  })
})

describe('what outranks what', () => {
  it('shows a half-written sentence instead of the last message', () => {
    show({ draft: 'je repasse dessus demain' })
    expect(screen.getByText('Brouillon :')).toBeInTheDocument()
    expect(screen.getByText(/je repasse dessus demain/)).toBeInTheDocument()
    expect(screen.queryByText(/le compilateur tourne/)).not.toBeInTheDocument()
  })

  it('stops showing the draft once you are in that conversation', () => {
    show({ draft: 'je repasse dessus demain' }, { open: 'c1' })
    expect(screen.queryByText('Brouillon :')).not.toBeInTheDocument()
    expect(screen.getByText(/le compilateur tourne/)).toBeInTheDocument()
  })

  it('lets someone writing right now outrank even the draft', () => {
    show({ draft: 'je repasse dessus demain' }, { typing: { c1: Date.now() } })
    expect(screen.getByText('écrit…')).toBeInTheDocument()
    expect(screen.queryByText('Brouillon :')).not.toBeInTheDocument()
  })
})

describe('an empty list', () => {
  it('explains what to do rather than showing nothing', () => {
    useStore.setState({ status: 'in', me: ME, conversations: [] })
    render(<Rail onOpen={vi.fn()} dimmed={false} />)
    expect(screen.getByText('Aucune conversation.')).toBeInTheDocument()

    // The same words label the header icon; only the empty state spells them out.
    const spelled = document.querySelector('.rail__void-acts')
    expect(spelled?.textContent).toContain('écrire à quelqu’un')
    expect(spelled?.textContent).toContain('réunir un groupe')
  })
})
