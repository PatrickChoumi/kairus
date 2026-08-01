import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { Conversation, Inbound, Message } from '../net/types'

/*
 * The composer is where most of the keyboard lives, and where the draft is
 * decided. These cases pin the rules that are invisible from the outside: a
 * newline is not a send, Escape means "never mind", a draft travels on a
 * pause rather than a keystroke, and a draft arriving from another device
 * never takes the place of a sentence being typed here.
 */

const sent: Record<string, unknown>[] = []
let deliver: (event: Inbound) => void = () => undefined

vi.mock('../net/socket', () => ({
  connection: {
    link: 'live' as const,
    open: vi.fn(),
    close: vi.fn(),
    send: (frame: Record<string, unknown>) => sent.push(frame),
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

// A recorder needs hardware jsdom does not have; the mic button is covered by
// the browser run, not here.
vi.mock('../net/voice', async () => {
  const actual = await vi.importActual<typeof import('../net/voice')>('../net/voice')
  return { ...actual, canRecord: () => false }
})

const { useStore } = await import('../state/store')
const { Composer } = await import('./Composer')

const ME = { id: 'me', handle: 'ada', name: 'Ada', hue: 10 }
const PEER = { id: 'peer', handle: 'alan', name: 'Alan', hue: 200 }

const message = (over: Partial<Message> = {}): Message => ({
  id: 'm1',
  conversationId: 'c1',
  senderId: PEER.id,
  body: 'bonjour',
  replyTo: null,
  createdAt: 1000,
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
  lastMessage: null,
  unread: 0,
  readAt: 0,
  pins: [],
  draft: '',
  ...over,
})

const settle = (over: Partial<Conversation> = {}) => {
  useStore.setState({
    status: 'in',
    me: ME,
    conversations: [conversation(over)],
    messages: { c1: [message()] },
    open: 'c1',
    replyTo: null,
    editing: null,
    relaying: null,
    notice: null,
  })
}

const field = () => screen.getByRole('textbox')
const framesOfType = (t: string) => sent.filter((f) => f.t === t)

beforeEach(() => {
  sent.length = 0
  settle()
})

// A case that leaves fake timers behind makes every later case time out.
afterEach(() => vi.useRealTimers())

describe('sending', () => {
  it('sends on Enter, and puts a newline in on Shift+Enter', async () => {
    const user = userEvent.setup()
    render(<Composer peerName="Alan" />)

    await user.click(field())
    await user.keyboard('première ligne{Shift>}{Enter}{/Shift}seconde ligne')
    expect(framesOfType('send')).toHaveLength(0)
    expect(field()).toHaveValue('première ligne\nseconde ligne')

    await user.keyboard('{Enter}')
    expect(framesOfType('send')).toHaveLength(1)
    expect(framesOfType('send')[0]).toMatchObject({
      conversation: 'c1',
      body: 'première ligne\nseconde ligne',
    })
    expect(field()).toHaveValue('')
  })

  it('refuses to send nothing at all', async () => {
    const user = userEvent.setup()
    render(<Composer peerName="Alan" />)
    await user.click(field())
    await user.keyboard('   {Enter}')
    expect(framesOfType('send')).toHaveLength(0)
  })
})

describe('answering and correcting', () => {
  it('reopens your last message on ArrowUp in an empty field', async () => {
    const user = userEvent.setup()
    useStore.setState({ messages: { c1: [message({ id: 'mine', senderId: ME.id, body: 'à revoir' })] } })
    render(<Composer peerName="Alan" />)

    await user.click(field())
    await user.keyboard('{ArrowUp}')
    await waitFor(() => expect(field()).toHaveValue('à revoir'))
    expect(useStore.getState().editing?.id).toBe('mine')
  })

  it('leaves someone else’s last message alone', async () => {
    const user = userEvent.setup()
    render(<Composer peerName="Alan" />)
    await user.click(field())
    await user.keyboard('{ArrowUp}')
    expect(useStore.getState().editing).toBeNull()
  })

  it('abandons a correction on Escape, without sending it', async () => {
    const user = userEvent.setup()
    useStore.setState({
      messages: { c1: [message({ id: 'mine', senderId: ME.id, body: 'à revoir' })] },
    })
    render(<Composer peerName="Alan" />)

    await user.click(field())
    await user.keyboard('{ArrowUp}')
    await waitFor(() => expect(useStore.getState().editing).not.toBeNull())

    await user.keyboard('{Escape}')
    expect(useStore.getState().editing).toBeNull()
    expect(framesOfType('revise')).toHaveLength(0)
  })

  it('drops a quote on Escape', async () => {
    const user = userEvent.setup()
    render(<Composer peerName="Alan" />)
    useStore.getState().reply(message())
    await waitFor(() => expect(useStore.getState().replyTo).not.toBeNull())

    await user.click(field())
    await user.keyboard('{Escape}')
    expect(useStore.getState().replyTo).toBeNull()
  })
})

describe('the draft', () => {
  it('travels on a pause, not on a keystroke', async () => {
    vi.useFakeTimers()
    render(<Composer peerName="Alan" />)

    fireEvent.change(field(), { target: { value: 'à moiti' } })
    fireEvent.change(field(), { target: { value: 'à moitié' } })
    expect(framesOfType('draft')).toHaveLength(0)

    await vi.advanceTimersByTimeAsync(800)
    // One frame for the pause, not one per character.
    expect(framesOfType('draft')).toHaveLength(1)
    expect(framesOfType('draft')[0]).toMatchObject({ conversation: 'c1', body: 'à moitié' })
  })

  it('picks up what was left in this conversation', async () => {
    settle({ draft: 'commencé ailleurs' })
    render(<Composer peerName="Alan" />)
    await waitFor(() => expect(field()).toHaveValue('commencé ailleurs'))
  })

  it('takes one that arrives while the field is empty', async () => {
    render(<Composer peerName="Alan" />)
    deliver({ t: 'draft', conversation: 'c1', body: 'depuis le téléphone', at: 2 })
    await waitFor(() => expect(field()).toHaveValue('depuis le téléphone'))
  })

  it('never overwrites a sentence being typed here', async () => {
    const user = userEvent.setup()
    render(<Composer peerName="Alan" />)

    await user.click(field())
    await user.keyboard('ce que j’écris maintenant')
    deliver({ t: 'draft', conversation: 'c1', body: 'écrit ailleurs, plus tôt', at: 2 })

    await new Promise((r) => setTimeout(r, 50))
    expect(field()).toHaveValue('ce que j’écris maintenant')
  })
})

describe('what the composer offers', () => {
  it('shows the attach and send buttons, as icons with names', () => {
    render(<Composer peerName="Alan" />)
    expect(screen.getByLabelText('joindre un fichier')).toBeInTheDocument()
    expect(screen.getByLabelText('envoyer')).toBeInTheDocument()
  })

  it('cannot send while there is nothing to send', () => {
    render(<Composer peerName="Alan" />)
    expect(screen.getByLabelText('envoyer')).toBeDisabled()
  })

  it('says what it is doing while a message is being rewritten', async () => {
    const user = userEvent.setup()
    useStore.setState({
      messages: { c1: [message({ id: 'mine', senderId: ME.id, body: 'à revoir' })] },
    })
    render(<Composer peerName="Alan" />)

    await user.click(field())
    await user.keyboard('{ArrowUp}')
    await waitFor(() => expect(screen.getByText('vous modifiez ce message')).toBeInTheDocument())
    expect(screen.getByLabelText('enregistrer')).toBeInTheDocument()
    // Nothing may be attached to a correction.
    expect(screen.getByLabelText('joindre un fichier')).toBeDisabled()
  })
})
