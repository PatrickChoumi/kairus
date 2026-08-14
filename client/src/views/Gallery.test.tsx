import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { Attachment, Conversation, Inbound, Message, Shared } from '../net/types'

/*
 * The gallery, and the silence.
 *
 * Two things worth pinning down. The gallery must fetch what it is asked for
 * and not something it fetched a moment ago — a stale grid here means opening
 * a picture that belongs to another conversation. And silencing must stop the
 * notification while leaving everything else exactly where it was: the
 * unread count above all, because a mute that also hides the count is not a
 * mute, it is a quiet way of losing messages.
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

// The bytes never arrive in jsdom; the tiles must still be there and countable.
vi.mock('../net/blobs', () => ({
  useAttachment: (id: string | null) => ({ url: id ? `blob:${id}` : null, failed: false }),
  forgetAttachment: vi.fn(),
  forgetAttachments: vi.fn(),
}))

const asked: string[] = []
let answer: Shared[] = []
let refuse = false

vi.mock('../net/api', async () => {
  const actual = await vi.importActual<typeof import('../net/api')>('../net/api')
  return {
    ...actual,
    api: {
      ...actual.api,
      shared: (conversation: string, kind: string) => {
        asked.push(`${conversation}:${kind}`)
        return refuse
          ? Promise.reject(new Error('nope'))
          : Promise.resolve({ shared: answer })
      },
      mute: (_c: string, minutes?: number) =>
        Promise.resolve({
          mutedUntil: minutes === undefined ? -1 : minutes <= 0 ? 0 : 1_000_000,
        }),
    },
  }
})

const { useStore } = await import('../state/store')
const { Gallery } = await import('./Gallery')

const PEER = { id: 'peer', handle: 'alan', name: 'Alan Turing', hue: 200 }

const attachment = (over: Partial<Attachment> = {}): Attachment => ({
  id: 'a1',
  name: 'photo.png',
  mime: 'image/png',
  size: 1024,
  width: 800,
  height: 600,
  duration: null,
  peaks: null,
  ...over,
})

const message = (over: Partial<Message> = {}): Message => ({
  id: 'm1',
  conversationId: 'c1',
  senderId: PEER.id,
  body: '',
  replyTo: null,
  createdAt: 1000,
  editedAt: null,
  deletedAt: null,
  attachment: attachment(),
  forwarded: null,
  ...over,
})

const conversation = (over: Partial<Conversation> = {}): Conversation => ({
  id: 'c1',
  kind: 'direct',
  face: { id: 'f1', name: 'Alan Turing', hue: 200 },
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
  asked.length = 0
  answer = []
  refuse = false
  useStore.setState({
    status: 'in',
    me: { id: 'me', handle: 'ada', name: 'Ada', hue: 10 },
    conversations: [conversation()],
    gallery: null,
    shared: [],
    browsing: false,
    notice: null,
  })
})

describe('the gallery', () => {
  it('shows nothing until it is opened', () => {
    const { container } = render(<Gallery />)
    expect(container).toBeEmptyDOMElement()
  })

  it('asks for the images of the conversation it was opened on', async () => {
    answer = [{ message: message(), attachment: attachment() }]
    render(<Gallery />)
    useStore.getState().browse('c1')

    await waitFor(() => expect(screen.getByLabelText('photo.png')).toBeInTheDocument())
    expect(asked).toEqual(['c1:image'])
  })

  it('says so plainly when there is nothing rather than showing an empty grid', async () => {
    render(<Gallery />)
    useStore.getState().browse('c1')
    await waitFor(() =>
      expect(screen.getByText('aucune image ici pour l’instant')).toBeInTheDocument(),
    )
  })

  it('switches to another kind, and asks again', async () => {
    answer = [{ message: message(), attachment: attachment() }]
    render(<Gallery />)
    useStore.getState().browse('c1')
    await waitFor(() => expect(screen.getByLabelText('photo.png')).toBeInTheDocument())

    answer = [
      {
        message: message({ id: 'm2' }),
        attachment: attachment({ id: 'a2', name: 'note.pdf', mime: 'application/pdf' }),
      },
    ]
    await userEvent.click(screen.getByRole('tab', { name: 'fichiers' }))

    await waitFor(() => expect(screen.getByText('note.pdf')).toBeInTheDocument())
    expect(asked).toEqual(['c1:image', 'c1:file'])
    // The images are gone: a grid mixing the two would be a lie about both.
    expect(screen.queryByLabelText('photo.png')).not.toBeInTheDocument()
  })

  it('drops an answer that arrives after it stopped being wanted', async () => {
    answer = [{ message: message(), attachment: attachment() }]
    render(<Gallery />)

    const store = useStore.getState()
    store.browse('c1')
    // Closed before the fetch settles: what comes back belongs to nothing.
    store.browse(null)

    await waitFor(() => expect(useStore.getState().gallery).toBeNull())
    expect(useStore.getState().shared).toEqual([])
  })

  it('closes on Escape', async () => {
    render(<Gallery />)
    useStore.getState().browse('c1')
    await waitFor(() => expect(screen.getByRole('dialog')).toBeInTheDocument())

    await userEvent.keyboard('{Escape}')
    await waitFor(() => expect(useStore.getState().gallery).toBeNull())
  })

  it('says something went wrong rather than looking empty', async () => {
    refuse = true
    render(<Gallery />)
    useStore.getState().browse('c1')
    await waitFor(() =>
      expect(useStore.getState().notice).toBe('impossible de charger les fichiers'),
    )
  })
})

describe('silencing a conversation', () => {
  it('takes effect before the server answers, and settles on what it says', async () => {
    useStore.getState().hush('c1', 120)
    // Optimistic: the menu must not sit there doing nothing for a round trip.
    expect(useStore.getState().conversations[0]?.mutedUntil).toBeGreaterThan(Date.now())

    await waitFor(() => expect(useStore.getState().conversations[0]?.mutedUntil).toBe(1_000_000))
  })

  it('with no duration, is until said otherwise', async () => {
    await useStore.getState().hush('c1')
    expect(useStore.getState().conversations[0]?.mutedUntil).toBe(-1)
  })

  it('lifts', async () => {
    useStore.setState({ conversations: [conversation({ mutedUntil: -1 })] })
    await useStore.getState().hush('c1', 0)
    expect(useStore.getState().conversations[0]?.mutedUntil).toBe(0)
  })

  it('never touches what has arrived', async () => {
    useStore.setState({ conversations: [conversation({ unread: 4 })] })
    await useStore.getState().hush('c1')

    // The whole point: quiet, not blind.
    expect(useStore.getState().conversations[0]?.unread).toBe(4)
    expect(useStore.getState().conversations[0]?.mutedUntil).toBe(-1)
  })
})
