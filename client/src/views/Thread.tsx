import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type Ref,
} from 'react'
import { useStore, useThread } from '../state/store'
import { Sigil } from '../ui/Sigil'
import { Turn } from './Turn'
import { Composer } from './Composer'
import { Lightbox } from './Lightbox'
import { Menu } from './Menu'
import { dayLabel, sameBreath, sameDay, silence } from '../lib/time'
import type { Attachment, Conversation } from '../net/types'

type Props = {
  conversation: Conversation
  onLeave: () => void
  headSigil: Ref<HTMLSpanElement>
  sigilHidden: boolean
}

const NEAR_BOTTOM = 120

/** What the line under the name says, which is never the word "online". */
function presence(conversation: Conversation, online: number, typing: boolean): string {
  if (typing) return 'écrit…'
  if (conversation.kind === 'group') {
    const total = conversation.members.length + 1
    return online > 0 ? `${total} personnes · ${online} là` : `${total} personnes`
  }
  return online > 0 ? 'là' : `@${conversation.members[0]?.handle ?? ''}`
}

export function Thread({ conversation, onLeave, headSigil, sigilHidden }: Props) {
  const me = useStore((s) => s.me)
  const messages = useThread(conversation.id)
  const typing = useStore((s) => Boolean(s.typing[conversation.id]))
  const online = useStore((s) => conversation.members.filter((m) => s.online[m.id]).length)
  const reading = useStore((s) => s.reading)
  const older = useStore((s) => s.older)
  const setReply = useStore((s) => s.reply)
  const setEdit = useStore((s) => s.edit)
  const retract = useStore((s) => s.retract)
  const setCursor = useStore((s) => s.setCursor)

  const stream = useRef<HTMLDivElement>(null)
  const wasNearBottom = useRef(true)
  const lastCount = useRef(0)
  const lastId = useRef<string | null>(null)
  const [menu, setMenu] = useState(false)

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

  const nameOf = (id: string): string =>
    id === me.id ? 'vous' : (conversation.members.find((m) => m.id === id)?.name ?? 'quelqu’un')
  const hueOf = (id: string): number | null =>
    id === me.id ? null : (conversation.members.find((m) => m.id === id)?.hue ?? null)

  const byId = new Map(messages.map((m) => [m.id, m]))
  const lastMine = [...messages]
    .reverse()
    .find((m) => m.senderId === me.id && !m.pending && !m.deletedAt)

  return (
    <div className="thread" data-reading={reading || undefined}>
      <header className="bar" ref={head}>
        <button className="bar__back" onClick={onLeave} aria-label="revenir à la liste">
          ‹
        </button>

        <Sigil
          user={conversation.face}
          size={30}
          present={online > 0}
          innerRef={headSigil}
          hidden={sigilHidden}
        />

        <span className="bar__who">
          <span className="bar__name">{conversation.face.name}</span>
          <span className="bar__state">{presence(conversation, online, typing)}</span>
        </span>

        <div className="bar__acts">
          <button onClick={() => setCursor(true)}>chercher</button>
          <button
            className="bar__more"
            data-menu-toggle
            onClick={() => setMenu((m) => !m)}
            aria-label="options de la conversation"
            aria-expanded={menu}
          >
            ···
          </button>
        </div>

        {menu && <Menu conversation={conversation} onClose={() => setMenu(false)} />}
      </header>

      <div className="stream" ref={stream} onScroll={onScroll}>
        <div className="stream__inner">
          {messages.length === 0 && (
            <p className="stream__void">
              Rien n’a encore été dit.
              <span>Écrivez la première ligne.</span>
            </p>
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

            // A silence takes up room, because on this axis time is distance.
            const pause =
              previous && !opensDay ? silence(previous.createdAt, message.createdAt) : null

            const quoted = message.replyTo ? (byId.get(message.replyTo) ?? null) : null

            return (
              <div key={message.id}>
                {opensDay && (
                  <div className="daymark">
                    <span>{dayLabel(message.createdAt)}</span>
                  </div>
                )}
                {pause && (
                  <div className="hush">
                    <span>{pause}</span>
                  </div>
                )}
                <Turn
                  message={message}
                  mine={mine}
                  opens={opens}
                  closes={closes}
                  author={nameOf(message.senderId)}
                  authorHue={hueOf(message.senderId)}
                  quoted={quoted}
                  quotedAuthor={quoted ? nameOf(quoted.senderId) : null}
                  read={
                    mine && message.id === lastMine?.id && conversation.readAt >= message.createdAt
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
            <div className="hush hush--live" aria-live="polite">
              <span>{conversation.face.name} écrit</span>
            </div>
          )}
        </div>
      </div>

      <Composer peerName={conversation.face.name} />

      <Lightbox
        attachment={looking?.attachment ?? null}
        url={looking?.url ?? null}
        onClose={() => setLooking(null)}
      />
    </div>
  )
}
