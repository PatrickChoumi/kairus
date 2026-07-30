import { useRef, useState, type CSSProperties } from 'react'
import { SPRING } from '../motion/spring'
import { useSpringHandle } from '../motion/hooks'
import { rubberBand, useDrag } from '../motion/gesture'
import { clock, exact } from '../lib/time'
import { Carried } from './Carried'
import type { Attachment, Message } from '../net/types'

type Props = {
  message: Message
  mine: boolean
  /** First of a run from the same person — the one that carries the name. */
  opens: boolean
  /** Last of that run — the one that carries the state. */
  closes: boolean
  author: string
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
 * One utterance, placed on the time axis.
 *
 * There is no bubble and no left/right split: the hour sits in its own column,
 * a tick marks the moment on the spine, and what was said is simply text. What
 * you can do to it lives in the right margin — present, but at a whisper until
 * the pointer arrives.
 */
export function Turn({
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
      const along = Math.max(delta, 0)
      offset.set(rubberBand(along, REPLY_AT))
      if (!armed.current && along >= REPLY_AT) {
        armed.current = true
        navigator.vibrate?.(8)
      } else if (armed.current && along < REPLY_AT) {
        armed.current = false
      }
    },
    onEnd() {
      if (armed.current) onReply(message)
      armed.current = false
      offset.to(0)
    },
  })

  const style =
    authorHue === null ? undefined : ({ '--hue': authorHue } as CSSProperties)

  return (
    <div
      className="turn"
      data-mine={mine || undefined}
      data-opens={opens || undefined}
      data-closes={closes || undefined}
      data-pending={message.pending || undefined}
      data-gone={gone || undefined}
      data-held={held || undefined}
      style={style}
      ref={row}
      {...drag}
      onContextMenu={(event) => {
        event.preventDefault()
        if (!gone) setHeld((h) => !h)
      }}
    >
      <time
        className="turn__when"
        dateTime={new Date(message.createdAt).toISOString()}
        title={exact(message.createdAt)}
      >
        {opens ? clock(message.createdAt) : ''}
      </time>

      <span className="turn__tick" aria-hidden="true" />

      <div className="turn__said">
        {opens && <span className="turn__who">{author}</span>}

        {quoted && (
          <button
            className="turn__quote"
            type="button"
            onClick={() => {
              document
                .getElementById(`m-${quoted.id}`)
                ?.scrollIntoView({ block: 'center', behavior: 'smooth' })
            }}
          >
            <span className="turn__quote-who">{quotedAuthor}</span>
            <span className="turn__quote-body">
              {quoted.deletedAt ? 'message retiré' : quoted.body}
            </span>
          </button>
        )}

        {gone ? (
          <p className="turn__gone" id={`m-${message.id}`}>
            message retiré
          </p>
        ) : (
          <>
            {message.attachment && <Carried message={message} onOpen={onOpenImage} />}
            {message.body && (
              <p className="turn__text" id={`m-${message.id}`}>
                {message.body}
              </p>
            )}
          </>
        )}

        {(message.editedAt || (mine && closes && !gone)) && (
          <span className="turn__state">
            {message.editedAt && <span>modifié</span>}
            {mine && closes && !gone && <span>{read ? 'lu' : 'envoyé'}</span>}
          </span>
        )}
      </div>

      {/* Present at rest, legible on approach: never a hidden gesture only. */}
      {!gone && (
        <div className="turn__acts" data-open={held || undefined}>
          <button onClick={() => onReply(message)}>répondre</button>
          {mine && !message.pending && (
            <>
              <button onClick={() => onEdit(message)}>modifier</button>
              <button className="turn__undo" onClick={() => onRetract(message)}>
                retirer
              </button>
            </>
          )}
        </div>
      )}

      <span className="turn__cue" aria-hidden="true">
        ↩
      </span>
    </div>
  )
}
