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
import { Icon } from '../ui/Icon'
import { Bubble } from './Bubble'
import { Composer } from './Composer'
import { Lightbox } from './Lightbox'
import { Menu } from './Menu'
import { dayLabel, sameBreath, sameDay } from '../lib/time'
import type { Attachment, Conversation } from '../net/types'

type Props = {
  conversation: Conversation
  onLeave: () => void
  headSigil: Ref<HTMLSpanElement>
  sigilHidden: boolean
}

const NEAR_BOTTOM = 120

/** The line under the name: who is there, or who this is. */
function presence(conversation: Conversation, online: number, typing: boolean): string {
  if (typing) return 'écrit…'
  if (conversation.kind === 'group') {
    const total = conversation.members.length + 1
    return online > 0 ? `${total} membres · ${online} en ligne` : `${total} membres`
  }
  return online > 0 ? 'en ligne' : `@${conversation.members[0]?.handle ?? ''}`
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
  const ringUp = useStore((s) => s.ringUp)

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
          <Icon name="back" size={22} />
        </button>

        <Sigil
          user={conversation.face}
          size={34}
          present={online > 0}
          innerRef={headSigil}
          hidden={sigilHidden}
        />

        <span className="bar__who">
          <span className="bar__name">{conversation.face.name}</span>
          <span className="bar__state">{presence(conversation, online, typing)}</span>
        </span>

        <div className="bar__acts">
          {conversation.kind === 'direct' && (
            <button
              onClick={() => ringUp(conversation.id)}
              aria-label={`appeler ${conversation.face.name}`}
              title="appeler"
            >
              <Icon name="phone" />
            </button>
          )}
          <button onClick={() => setCursor(true)} aria-label="chercher" title="chercher">
            <Icon name="search" />
          </button>
          <button
            className="bar__more"
            data-menu-toggle
            onClick={() => setMenu((m) => !m)}
            aria-label="options de la conversation"
            aria-expanded={menu}
          >
            <Icon name="more" />
          </button>
        </div>

        {menu && <Menu conversation={conversation} onClose={() => setMenu(false)} />}
      </header>

      <div className="stream" ref={stream} onScroll={onScroll}>
        <div className="stream__inner">
          {messages.length === 0 && (
            <p className="stream__void">
              Rien n’a encore été dit.
              <span>Écrivez le premier message.</span>
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
                  author={
                    conversation.kind === 'group' && !mine && opens
                      ? nameOf(message.senderId)
                      : null
                  }
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
            <div className="typing" aria-live="polite" aria-label="écrit">
              <span />
              <span />
              <span />
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
