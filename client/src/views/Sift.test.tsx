import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { Inbound, Message, SearchHit } from '../net/types'

/*
 * Searching inside a conversation.
 *
 * The feature is not the list — it is landing on the message. A result one
 * cannot reach is a taunt, and the message is very often not loaded: the
 * thread holds the last page and the answer is from March. So what is pinned
 * here is the walk back through the history, and what happens when it does
 * not get there.
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

const asked: { q: string; conversation?: string }[] = []
let answer: SearchHit[] = []
/** Pages the history hands back, oldest request first. */
let pages: Message[][] = []

vi.mock('../net/api', async () => {
  const actual = await vi.importActual<typeof import('../net/api')>('../net/api')
  return {
    ...actual,
    api: {
      ...actual.api,
      search: (q: string, conversation?: string) => {
        asked.push({ q, conversation })
        return Promise.resolve({ hits: answer })
      },
      messages: () => Promise.resolve({ messages: pages.shift() ?? [] }),
    },
  }
})

const { useStore } = await import('../state/store')
const { Sift } = await import('./Sift')

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

const hit = (over: Partial<Message> = {}): SearchHit => ({
  message: message(over),
  conversationId: 'c1',
  face: { id: 'f1', name: 'Alan Turing', hue: 200 },
})

beforeEach(() => {
  asked.length = 0
  answer = []
  pages = []
  useStore.setState({
    status: 'in',
    me: { id: 'me', handle: 'ada', name: 'Ada', hue: 10 },
    open: 'c1',
    messages: { c1: [message({ id: 'recent', createdAt: 9000 })] },
    exhausted: {},
    notice: null,
  })
})

const close = vi.fn()

describe('the search strip', () => {
  it('does not query on a single letter', async () => {
    render(<Sift conversationId="c1" onClose={close} />)
    await userEvent.type(screen.getByRole('textbox'), 'a')
    await new Promise((resolve) => setTimeout(resolve, 350))
    expect(asked).toEqual([])
  })

  it('asks only for this conversation', async () => {
    answer = [hit()]
    render(<Sift conversationId="c1" onClose={close} />)
    await userEvent.type(screen.getByRole('textbox'), 'compilateur')

    await waitFor(() => expect(screen.getByText('le compilateur tourne')).toBeInTheDocument())
    expect(asked.at(-1)).toEqual({ q: 'compilateur', conversation: 'c1' })
  })

  it('waits instead of querying once per keystroke', async () => {
    answer = [hit()]
    render(<Sift conversationId="c1" onClose={close} />)
    await userEvent.type(screen.getByRole('textbox'), 'compilateur')
    await waitFor(() => expect(asked.length).toBeGreaterThan(0))
    // Eleven keystrokes, nothing like eleven searches.
    expect(asked.length).toBeLessThan(4)
  })

  it('says plainly when there is nothing', async () => {
    answer = []
    render(<Sift conversationId="c1" onClose={close} />)
    await userEvent.type(screen.getByRole('textbox'), 'introuvable')
    await waitFor(() => expect(screen.getByText('rien trouvé')).toBeInTheDocument())
  })
})

describe('landing on the message', () => {
  it('closes at once when it is already loaded', async () => {
    answer = [hit({ id: 'recent', createdAt: 9000 })]
    const onClose = vi.fn()
    render(<Sift conversationId="c1" onClose={onClose} />)
    await userEvent.type(screen.getByRole('textbox'), 'compilateur')
    await waitFor(() => expect(screen.getByText('le compilateur tourne')).toBeInTheDocument())

    await userEvent.click(screen.getByText('le compilateur tourne'))
    await waitFor(() => expect(onClose).toHaveBeenCalled())
  })

  it('walks the history back until it has it', async () => {
    answer = [hit({ id: 'ancien', createdAt: 10 })]
    // Two pages of nothing, then the one that holds it.
    pages = [
      [message({ id: 'p1', createdAt: 800 })],
      [message({ id: 'p2', createdAt: 400 })],
      [message({ id: 'ancien', createdAt: 10 })],
    ]
    const onClose = vi.fn()
    render(<Sift conversationId="c1" onClose={onClose} />)
    await userEvent.type(screen.getByRole('textbox'), 'compilateur')
    await waitFor(() => expect(screen.getByText('le compilateur tourne')).toBeInTheDocument())

    await userEvent.click(screen.getByText('le compilateur tourne'))
    await waitFor(() => expect(onClose).toHaveBeenCalled())
    expect(useStore.getState().messages.c1?.some((m) => m.id === 'ancien')).toBe(true)
  })

  it('says so rather than closing on nothing when it cannot get there', async () => {
    answer = [hit({ id: 'introuvable', createdAt: 5 })]
    // The history runs out before the message turns up.
    pages = [[]]
    const onClose = vi.fn()
    render(<Sift conversationId="c1" onClose={onClose} />)
    await userEvent.type(screen.getByRole('textbox'), 'compilateur')
    await waitFor(() => expect(screen.getByText('le compilateur tourne')).toBeInTheDocument())

    await userEvent.click(screen.getByText('le compilateur tourne'))
    await waitFor(() =>
      expect(useStore.getState().notice).toBe('ce message est trop loin pour être rejoint'),
    )
    expect(onClose).not.toHaveBeenCalled()
  })

  it('gives up rather than paging for ever', async () => {
    answer = [hit({ id: 'jamais', createdAt: 1 })]
    // An endless history that never contains it.
    let n = 0
    pages = Array.from({ length: 40 }, () => [message({ id: `p${n++}`, createdAt: 900 - n })])
    render(<Sift conversationId="c1" onClose={close} />)
    await userEvent.type(screen.getByRole('textbox'), 'compilateur')
    await waitFor(() => expect(screen.getByText('le compilateur tourne')).toBeInTheDocument())

    await userEvent.click(screen.getByText('le compilateur tourne'))
    await waitFor(() =>
      expect(useStore.getState().notice).toBe('ce message est trop loin pour être rejoint'),
    )
    // Twelve pages, not forty: a year of conversation must not become a
    // silent minute of round trips.
    expect(pages.length).toBe(28)
  })
})

describe('closing', () => {
  it('closes on Escape', async () => {
    const onClose = vi.fn()
    render(<Sift conversationId="c1" onClose={onClose} />)
    await userEvent.keyboard('{Escape}')
    expect(onClose).toHaveBeenCalled()
  })
})
