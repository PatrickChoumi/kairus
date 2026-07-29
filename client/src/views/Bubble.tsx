import { useRef, useState } from 'react'
import { SPRING } from '../motion/spring'
import { useSpringHandle } from '../motion/hooks'
import { rubberBand, useDrag } from '../motion/gesture'
import { clock, exact } from '../lib/time'
import { Carried } from './Carried'
import type { Attachment, Message } from '../net/types'

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
  onEdit: (message: Message) => void
  onRetract: (message: Message) => void
  onOpenImage: (attachment: Attachment, url: string) => void
}

const REPLY_AT = 56

/**
 * One utterance. Pulling it sideways answers it; holding it opens the few
 * things you can do to it. There are no buttons at rest, and none are needed
 * once you have done either once.
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
  onEdit,
  onRetract,
  onOpenImage,
}: Props) {
  const row = useRef<HTMLDivElement>(null)
  const [held, setHeld] = useState(false)
  const armed = useRef(false)
  const gone = Boolean(message.deletedAt)

  const offset = useSpringHandle(0, SPRING.snap, (value) => {
    const el = row.current
    if (!el) return
    el.style.transform = `translate3d(${value}px, 0, 0)`
    el.style.setProperty('--pull', String(Math.min(Math.abs(value) / REPLY_AT, 1)))
  })

  const drag = useDrag({
    axis: 'x',
    onMove(delta) {
      if (gone) return
      // Pulling towards the centre of the screen is the answering direction.
      const along = mine ? Math.min(delta, 0) : Math.max(delta, 0)
      const magnitude = rubberBand(Math.abs(along), REPLY_AT)
      offset.set(mine ? -magnitude : magnitude)
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

  const hold = (event: { preventDefault: () => void }) => {
    event.preventDefault()
    if (!gone) setHeld((h) => !h)
  }

  return (
    <div
      className="bubble-row"
      data-mine={mine || undefined}
      data-opens={opens || undefined}
      data-closes={closes || undefined}
      data-pending={message.pending || undefined}
      data-gone={gone || undefined}
      data-carrying={message.attachment && !gone ? true : undefined}
      data-wordless={message.attachment && !message.body && !gone ? true : undefined}
      data-held={held || undefined}
      ref={row}
      {...drag}
      onDoubleClick={() => !gone && onReply(message)}
      onContextMenu={hold}
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
            <span className="bubble__quote-body">
              {quoted.deletedAt ? 'message retiré' : quoted.body}
            </span>
          </button>
        )}

        {gone ? (
          <p className="bubble__gone" id={`m-${message.id}`}>
            message retiré
          </p>
        ) : (
          <>
            {message.attachment && <Carried message={message} onOpen={onOpenImage} />}
            {message.body && (
              <p className="bubble__body" id={`m-${message.id}`}>
                {message.body}
              </p>
            )}
          </>
        )}

        <span className="bubble__meta">
          {message.editedAt && <span className="bubble__edited">modifié</span>}
          <time
            dateTime={new Date(message.createdAt).toISOString()}
            title={exact(message.createdAt)}
          >
            {clock(message.createdAt)}
          </time>
          {mine && !gone && (
            <span
              className="bubble__seen"
              data-read={read || undefined}
              aria-label={read ? 'lu' : 'envoyé'}
            />
          )}
        </span>
      </div>

      {held && (
        <div className="bubble-row__held">
          <span className="bubble-row__exact">{exact(message.createdAt)}</span>
          <button
            onClick={() => {
              setHeld(false)
              onReply(message)
            }}
          >
            répondre
          </button>
          {mine && !message.pending && (
            <>
              <button
                onClick={() => {
                  setHeld(false)
                  onEdit(message)
                }}
              >
                modifier
              </button>
              <button
                className="bubble-row__undo"
                onClick={() => {
                  setHeld(false)
                  onRetract(message)
                }}
              >
                retirer
              </button>
            </>
          )}
        </div>
      )}
    </div>
  )
}
