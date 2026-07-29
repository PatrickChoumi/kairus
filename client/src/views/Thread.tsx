import { useCallback, useEffect, useLayoutEffect, useRef, useState, type Ref } from 'react'
import { useStore, useThread } from '../state/store'
import { Sigil } from '../ui/Sigil'
import { Bubble } from './Bubble'
import { Composer } from './Composer'
import { Lightbox } from './Lightbox'
import { dayLabel, sameBreath, sameDay } from '../lib/time'
import type { Attachment, Conversation } from '../net/types'

type Props = {
  conversation: Conversation
  onLeave: () => void
  headSigil: Ref<HTMLSpanElement>
  sigilHidden: boolean
}

const NEAR_BOTTOM = 120

export function Thread({ conversation, onLeave, headSigil, sigilHidden }: Props) {
  const me = useStore((s) => s.me)
  const messages = useThread(conversation.id)
  const typing = useStore((s) => Boolean(s.typing[conversation.id]))
  const online = useStore((s) => Boolean(s.online[conversation.peer.id]))
  const reading = useStore((s) => s.reading)
  const older = useStore((s) => s.older)
  const setReply = useStore((s) => s.reply)
  const setEdit = useStore((s) => s.edit)
  const retract = useStore((s) => s.retract)

  const stream = useRef<HTMLDivElement>(null)
  const wasNearBottom = useRef(true)
  const lastCount = useRef(0)
  const lastId = useRef<string | null>(null)

  useLayoutEffect(() => {
    const el = stream.current
    if (!el) return
    wasNearBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < NEAR_BOTTOM
  })

  // Arriving in a thread puts you at the present moment, with no scroll animation.
  useLayoutEffect(() => {
    const el = stream.current
    if (!el) return
    el.scrollTop = el.scrollHeight
    lastCount.current = messages.length
    lastId.current = messages[messages.length - 1]?.id ?? null
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversation.id])

  // New arrivals only pull you down if you were already there.
  useEffect(() => {
    const el = stream.current
    if (!el) return
    const grew = messages.length > lastCount.current
    const tailChanged = (messages[messages.length - 1]?.id ?? null) !== lastId.current
    lastCount.current = messages.length
    lastId.current = messages[messages.length - 1]?.id ?? null
    if (!grew && !tailChanged) return
    if (!wasNearBottom.current) return
    el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' })
  }, [messages])

  const head = useRef<HTMLElement>(null)
  const [looking, setLooking] = useState<{ attachment: Attachment; url: string } | null>(null)
  const openImage = useCallback(
    (attachment: Attachment, url: string) => setLooking({ attachment, url }),
    [],
  )

  const onScroll = () => {
    const el = stream.current
    if (!el) return
    if (el.scrollTop < 240) void older()
    // Written straight to the DOM: a hairline is not worth a render.
    if (head.current) {
      if (el.scrollTop > 4) head.current.dataset.lifted = 'true'
      else delete head.current.dataset.lifted
    }
  }

  if (!me) return null

  const byId = new Map(messages.map((m) => [m.id, m]))
  const lastMine = [...messages]
    .reverse()
    .find((m) => m.senderId === me.id && !m.pending && !m.deletedAt)

  return (
    <div className="thread" data-reading={reading || undefined}>
      <header className="thread__head" ref={head}>
        <button className="thread__back" onClick={onLeave} aria-label="revenir">
          <Sigil
            user={conversation.peer}
            size={38}
            present={online}
            stirring={typing}
            innerRef={headSigil}
            hidden={sigilHidden}
          />
          <span className="thread__who">
            <span className="thread__name">{conversation.peer.name}</span>
            <span className="thread__state">
              {typing ? 'écrit…' : online ? 'là' : `@${conversation.peer.handle}`}
            </span>
          </span>
          <span className="thread__caret" aria-hidden="true">
            ‹
          </span>
        </button>
      </header>

      <div className="stream" ref={stream} onScroll={onScroll}>
        <div className="stream__inner">
          {messages.length === 0 && (
            <p className="stream__void">Rien n’a encore été dit.</p>
          )}

          {messages.map((message, index) => {
            const previous = messages[index - 1]
            const next = messages[index + 1]
            const mine = message.senderId === me.id

            const opensDay = !previous || !sameDay(previous.createdAt, message.createdAt)
            const opens =
              opensDay ||
              !previous ||
              previous.senderId !== message.senderId ||
              !sameBreath(previous.createdAt, message.createdAt)
            const closes =
              !next ||
              next.senderId !== message.senderId ||
              !sameBreath(message.createdAt, next.createdAt) ||
              !sameDay(message.createdAt, next.createdAt)

            const quoted = message.replyTo ? (byId.get(message.replyTo) ?? null) : null

            return (
              <div key={message.id}>
                {opensDay && (
                  <div className="daymark">
                    <span>{dayLabel(message.createdAt)}</span>
                  </div>
                )}
                <Bubble
                  message={message}
                  mine={mine}
                  opens={opens}
                  closes={closes}
                  quoted={quoted}
                  quotedAuthor={
                    quoted ? (quoted.senderId === me.id ? 'vous' : conversation.peer.name) : null
                  }
                  read={
                    mine &&
                    message.id === lastMine?.id &&
                    conversation.peerReadAt >= message.createdAt
                  }
                  onReply={setReply}
                  onEdit={setEdit}
                  onRetract={retract}
                  onOpenImage={openImage}
                />
              </div>
            )
          })}

          {typing && (
            <div className="breath" aria-live="polite" aria-label="écrit">
              <span />
              <span />
              <span />
            </div>
          )}
        </div>
      </div>

      <Composer peerName={conversation.peer.name} />

      <Lightbox
        attachment={looking?.attachment ?? null}
        url={looking?.url ?? null}
        onClose={() => setLooking(null)}
      />
    </div>
  )
}
