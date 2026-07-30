import { useRef, useState, type CSSProperties } from 'react'
import { SPRING } from '../motion/spring'
import { useSpringHandle } from '../motion/hooks'
import { rubberBand, useDrag } from '../motion/gesture'
import { clock, exact } from '../lib/time'
import { Carried } from './Carried'
import { Icon } from '../ui/Icon'
import type { Attachment, Message } from '../net/types'

type Props = {
  message: Message
  mine: boolean
  /** First of a run from the same person — the one that carries the name. */
  opens: boolean
  /** Last of that run — the one that carries the time and the state. */
  closes: boolean
  /** Said only where it is needed: in a group, above someone else's run. */
  author: string | null
  authorHue: number | null
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
 * One message, in the shape everybody already knows: a bubble, yours on the
 * right and theirs on the left. What you can do to it is a small row of words
 * that surfaces on approach — visible, rather than a gesture you must be told
 * about.
 */
export function Bubble({
  message,
  mine,
  opens,
  closes,
  author,
  authorHue,
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
      // Pulling towards the middle of the screen is the answering direction.
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

  const style = authorHue === null ? undefined : ({ '--hue': authorHue } as CSSProperties)

  return (
    <div
      className="line"
      data-mine={mine || undefined}
      data-opens={opens || undefined}
      data-closes={closes || undefined}
      data-pending={message.pending || undefined}
      data-gone={gone || undefined}
      data-wordless={message.attachment && !message.body && !gone ? true : undefined}
      data-held={held || undefined}
      style={style}
      ref={row}
      {...drag}
      onDoubleClick={() => !gone && onReply(message)}
      onContextMenu={(event) => {
        event.preventDefault()
        if (!gone) setHeld((h) => !h)
      }}
    >
      <span className="line__cue" aria-hidden="true">
        <Icon name="reply" size={16} />
      </span>

      <div className="bubble">
        {author && <span className="bubble__author">{author}</span>}

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

        {(closes || message.editedAt) && !gone && (
          <span className="bubble__meta">
            {message.editedAt && <span>modifié</span>}
            <time
              dateTime={new Date(message.createdAt).toISOString()}
              title={exact(message.createdAt)}
            >
              {clock(message.createdAt)}
            </time>
            {mine && !message.pending && (
              <span className="bubble__seen" data-read={read || undefined}>
                <Icon name={read ? 'checks' : 'check'} size={14} />
              </span>
            )}
          </span>
        )}
      </div>

      {!gone && (
        <div className="line__acts" data-open={held || undefined}>
          <button onClick={() => onReply(message)} aria-label="répondre" title="répondre">
            <Icon name="reply" size={17} />
          </button>
          {mine && !message.pending && (
            <>
              {message.body && (
                <button onClick={() => onEdit(message)} aria-label="modifier" title="modifier">
                  <Icon name="edit" size={17} />
                </button>
              )}
              <button
                className="line__undo"
                onClick={() => onRetract(message)}
                aria-label="retirer"
                title="retirer"
              >
                <Icon name="trash" size={17} />
              </button>
            </>
          )}
        </div>
      )}
    </div>
  )
}
