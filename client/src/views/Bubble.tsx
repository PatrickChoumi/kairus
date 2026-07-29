import { useRef, useState } from 'react'
import { SPRING } from '../motion/spring'
import { useSpringHandle } from '../motion/hooks'
import { rubberBand, useDrag } from '../motion/gesture'
import { clock, exact } from '../lib/time'
import type { Message } from '../net/types'

type Props = {
  message: Message
  mine: boolean
  /** First of a run from the same person. */
  opens: boolean
  /** Last of that run — the one that carries the timestamp. */
  closes: boolean
  quoted: Message | null
  quotedAuthor: string | null
  read: boolean
  onReply: (message: Message) => void
}

const REPLY_AT = 56

/**
 * One utterance. Pulling it sideways answers it; there is no button for that,
 * and none is needed once you have done it once.
 */
export function Bubble({
  message,
  mine,
  opens,
  closes,
  quoted,
  quotedAuthor,
  read,
  onReply,
}: Props) {
  const row = useRef<HTMLDivElement>(null)
  const [held, setHeld] = useState(false)
  const armed = useRef(false)

  const offset = useSpringHandle(0, SPRING.snap, (value) => {
    const el = row.current
    if (!el) return
    el.style.transform = `translate3d(${value}px, 0, 0)`
    el.style.setProperty('--pull', String(Math.min(Math.abs(value) / REPLY_AT, 1)))
  })

  const drag = useDrag({
    axis: 'x',
    onMove(delta) {
      // Pulling towards the centre of the screen is the answering direction.
      const along = mine ? Math.min(delta, 0) : Math.max(delta, 0)
      const magnitude = rubberBand(Math.abs(along), REPLY_AT)
      const next = mine ? -magnitude : magnitude
      offset.set(next)
      if (!armed.current && Math.abs(along) >= REPLY_AT) {
        armed.current = true
        navigator.vibrate?.(8)
      } else if (armed.current && Math.abs(along) < REPLY_AT) {
        armed.current = false
      }
    },
    onEnd() {
      if (armed.current) onReply(message)
      armed.current = false
      offset.to(0)
    },
  })

  return (
    <div
      className="bubble-row"
      data-mine={mine || undefined}
      data-opens={opens || undefined}
      data-closes={closes || undefined}
      data-pending={message.pending || undefined}
      ref={row}
      {...drag}
      onDoubleClick={() => onReply(message)}
      onContextMenu={(e) => {
        e.preventDefault()
        setHeld((h) => !h)
      }}
    >
      <span className="bubble-row__cue" aria-hidden="true">
        ↩
      </span>

      <div className="bubble">
        {quoted && (
          <button
            className="bubble__quote"
            type="button"
            onClick={() => {
              document
                .getElementById(`m-${quoted.id}`)
                ?.scrollIntoView({ block: 'center', behavior: 'smooth' })
            }}
          >
            <span className="bubble__quote-who">{quotedAuthor}</span>
            <span className="bubble__quote-body">{quoted.body}</span>
          </button>
        )}

        <p className="bubble__body" id={`m-${message.id}`}>
          {message.body}
        </p>

        <span className="bubble__meta">
          <time dateTime={new Date(message.createdAt).toISOString()} title={exact(message.createdAt)}>
            {clock(message.createdAt)}
          </time>
          {mine && <span className="bubble__seen" data-read={read || undefined} aria-label={read ? 'lu' : 'envoyé'} />}
        </span>
      </div>

      {held && <span className="bubble-row__exact">{exact(message.createdAt)}</span>}
    </div>
  )
}
