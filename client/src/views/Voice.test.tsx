import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { Message } from '../net/types'

/*
 * The point of shipping a waveform with the attachment is that a voice message
 * has its final shape before any audio is fetched, and one you never play
 * costs nothing at all. Both halves of that claim are easy to break by
 * accident — a stray `useAttachment` call would fetch it eagerly — so both
 * are pinned here.
 */

const fetched: string[] = []

vi.mock('../net/blobs', () => ({
  useAttachment: (id: string | null) => {
    if (id) fetched.push(id)
    return { url: id ? `blob:${id}` : null, failed: false }
  },
  forgetAttachment: vi.fn(),
  forgetAttachments: vi.fn(),
}))

const { Voice } = await import('./Voice')

const voice = (over: Partial<Message> = {}): Message => ({
  id: 'm1',
  conversationId: 'c1',
  senderId: 'peer',
  body: '',
  replyTo: null,
  createdAt: 1000,
  editedAt: null,
  deletedAt: null,
  forwarded: null,
  attachment: {
    id: 'a1',
    name: 'voix.webm',
    mime: 'audio/webm',
    size: 4096,
    width: null,
    height: null,
    duration: 7,
    peaks: '10,40,90,60,20,80',
  },
  ...over,
})

beforeEach(() => {
  fetched.length = 0
  // jsdom has no audio pipeline; the player only needs the calls not to throw.
  vi.spyOn(window.HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined)
  vi.spyOn(window.HTMLMediaElement.prototype, 'pause').mockImplementation(() => undefined)
})

describe('before anyone presses play', () => {
  it('draws the shape that travelled with the message', () => {
    const { container } = render(<Voice message={voice()} />)
    expect(container.querySelectorAll('.voice__wave span')).toHaveLength(6)
  })

  it('shows how long it runs', () => {
    render(<Voice message={voice()} />)
    expect(screen.getByText('0:07')).toBeInTheDocument()
  })

  it('has not fetched a single byte of audio', () => {
    render(<Voice message={voice()} />)
    expect(fetched).toEqual([])
  })

  it('draws something rather than nothing when the shape is missing', () => {
    const { container } = render(
      <Voice message={voice({ attachment: { ...voice().attachment!, peaks: null } })} />,
    )
    expect(container.querySelectorAll('.voice__wave span').length).toBeGreaterThan(0)
  })
})

describe('once someone presses play', () => {
  it('fetches the audio, and only then', async () => {
    const user = userEvent.setup()
    render(<Voice message={voice()} />)
    expect(fetched).toEqual([])

    await user.click(screen.getByLabelText('écouter'))
    expect(fetched).toContain('a1')
  })

  it('offers to pause what it is playing', async () => {
    const user = userEvent.setup()
    render(<Voice message={voice()} />)
    await user.click(screen.getByLabelText('écouter'))
    expect(screen.getByLabelText('mettre en pause')).toBeInTheDocument()
  })
})

describe('while it is still going up', () => {
  it('shows how far, and cannot be played yet', () => {
    render(<Voice message={voice({ pending: true, progress: 0.42 })} />)
    expect(screen.getByText('42 %')).toBeInTheDocument()
    expect(screen.getByLabelText('écouter')).toBeDisabled()
  })
})
