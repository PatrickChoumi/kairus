import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Bubble } from './Bubble'
import type { Message } from '../net/types'

/*
 * The bubble decides what may be done to a message, and says where its words
 * came from. Both are easy to get subtly wrong — an edit button on someone
 * else's message, a credit on your own forward — and neither is caught by a
 * store test, because neither lives in the store.
 */

const ME = 'me'
const OTHER = 'alan'

const message = (over: Partial<Message> = {}): Message => ({
  id: 'm1',
  conversationId: 'c1',
  senderId: ME,
  body: 'bonjour',
  replyTo: null,
  createdAt: Date.UTC(2026, 0, 1, 12, 0),
  editedAt: null,
  deletedAt: null,
  attachment: null,
  forwarded: null,
  ...over,
})

const show = (over: Partial<Message> = {}, props: Partial<Parameters<typeof Bubble>[0]> = {}) => {
  const handlers = {
    onReply: vi.fn(),
    onEdit: vi.fn(),
    onRetract: vi.fn(),
    onRelay: vi.fn(),
    onPin: vi.fn(),
    onFlag: vi.fn(),
    onOpenImage: vi.fn(),
  }
  const msg = message(over)
  const view = render(
    <Bubble
      message={msg}
      mine={msg.senderId === ME}
      opens
      closes
      author={null}
      authorHue={null}
      quoted={null}
      quotedAuthor={null}
      read={false}
      pinned={false}
      {...handlers}
      {...props}
    />,
  )
  return { message: msg, ...handlers, unmount: view.unmount }
}

const actions = () =>
  screen.getAllByRole('button').map((b) => b.getAttribute('aria-label'))

describe('what can be done to a message', () => {
  it('offers reply, forward and pin on anyone’s message', () => {
    show({ senderId: OTHER })
    expect(actions()).toEqual(expect.arrayContaining(['répondre', 'transférer', 'épingler']))
  })

  it('offers to report someone else’s message, and never your own', () => {
    const theirs = show({ senderId: OTHER })
    expect(actions()).toContain('signaler')
    theirs.unmount()

    // `onFlag` is null on your own words: there is nobody to report but you.
    show({ senderId: ME }, { onFlag: null })
    expect(actions()).not.toContain('signaler')
  })

  it('never offers to edit or retract someone else’s', () => {
    show({ senderId: OTHER })
    expect(actions()).not.toContain('modifier')
    expect(actions()).not.toContain('retirer')
  })

  it('offers both on your own', () => {
    show()
    expect(actions()).toEqual(expect.arrayContaining(['modifier', 'retirer']))
  })

  it('does not offer to rewrite a message that has no words', () => {
    show({
      body: '',
      attachment: {
        id: 'a1',
        name: 'voix.webm',
        mime: 'audio/webm',
        size: 1000,
        width: null,
        height: null,
        duration: 3,
        peaks: '10,50,90',
      },
    })
    expect(actions()).not.toContain('modifier')
    expect(actions()).toContain('retirer')
  })

  it('offers nothing at all on a message that was taken back', () => {
    show({ deletedAt: Date.now(), body: '' })
    expect(screen.queryAllByRole('button')).toHaveLength(0)
    expect(screen.getByText('message retiré')).toBeInTheDocument()
  })

  it('offers nothing while a message is still in flight', () => {
    show({ pending: true })
    expect(actions()).toEqual(['répondre'])
  })

  it('hands the message back when an action is chosen', async () => {
    const user = userEvent.setup()
    const { onRelay, onPin, message: msg } = show()

    await user.click(screen.getByLabelText('transférer'))
    expect(onRelay).toHaveBeenCalledWith(msg)

    await user.click(screen.getByLabelText('épingler'))
    expect(onPin).toHaveBeenCalledWith(msg, true)
  })

  it('says «détacher» once it is pinned, and asks for the opposite', async () => {
    const user = userEvent.setup()
    const { onPin, message: msg } = show({}, { pinned: true })

    const button = screen.getByLabelText('détacher')
    expect(button).toHaveAttribute('aria-pressed', 'true')
    await user.click(button)
    expect(onPin).toHaveBeenCalledWith(msg, false)
  })
})

describe('where the words came from', () => {
  it('credits the original author of a forward', () => {
    show({
      senderId: ME,
      forwarded: { from: { id: OTHER, name: 'Alan Turing', hue: 200 }, at: 1000 },
    })
    expect(screen.getByText(/transféré de Alan Turing/)).toBeInTheDocument()
  })

  it('says nothing when you forward your own words', () => {
    show({
      senderId: ME,
      forwarded: { from: { id: ME, name: 'Ada', hue: 10 }, at: 1000 },
    })
    expect(screen.queryByText(/transféré de/)).not.toBeInTheDocument()
  })

  it('says nothing on a forward that was taken back', () => {
    show({
      deletedAt: Date.now(),
      body: '',
      forwarded: { from: { id: OTHER, name: 'Alan Turing', hue: 200 }, at: 1000 },
    })
    expect(screen.queryByText(/transféré de/)).not.toBeInTheDocument()
  })
})

describe('the state a bubble shows', () => {
  it('marks a message as read only once it has been', () => {
    const { container } = render(
      <Bubble
        message={message()}
        mine
        opens
        closes
        author={null}
        authorHue={null}
        quoted={null}
        quotedAuthor={null}
        read
        pinned={false}
        onReply={vi.fn()}
        onEdit={vi.fn()}
        onRetract={vi.fn()}
        onRelay={vi.fn()}
        onPin={vi.fn()}
        onFlag={vi.fn()}
        onOpenImage={vi.fn()}
      />,
    )
    expect(container.querySelector('.bubble__seen[data-read]')).toBeTruthy()
  })

  it('names who spoke, but only where it was asked to', () => {
    render(
      <Bubble
        message={message({ senderId: OTHER })}
        mine={false}
        opens
        closes
        author="Alan Turing"
        authorHue={200}
        quoted={null}
        quotedAuthor={null}
        read={false}
        pinned={false}
        onReply={vi.fn()}
        onEdit={vi.fn()}
        onRetract={vi.fn()}
        onRelay={vi.fn()}
        onPin={vi.fn()}
        onFlag={vi.fn()}
        onOpenImage={vi.fn()}
      />,
    )
    expect(screen.getByText('Alan Turing')).toBeInTheDocument()
  })

  it('shows a quote, and says so when the quoted message is gone', () => {
    render(
      <Bubble
        message={message({ replyTo: 'm0' })}
        mine
        opens
        closes
        author={null}
        authorHue={null}
        quoted={message({ id: 'm0', body: '', deletedAt: 1 })}
        quotedAuthor="Alan Turing"
        read={false}
        pinned={false}
        onReply={vi.fn()}
        onEdit={vi.fn()}
        onRetract={vi.fn()}
        onRelay={vi.fn()}
        onPin={vi.fn()}
        onFlag={vi.fn()}
        onOpenImage={vi.fn()}
      />,
    )
    expect(screen.getByText('message retiré')).toBeInTheDocument()
  })
})
