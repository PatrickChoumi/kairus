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
import { Sift } from './Sift'
import { Lightbox } from './Lightbox'
import { Menu } from './Menu'
import { dayLabel, sameBreath, sameDay } from '../lib/time'
import type { Attachment, Conversation, Message } from '../net/types'

type Props = {
  conversation: Conversation
  onLeave: () => void
  headSigil: Ref<HTMLSpanElement>
  sigilHidden: boolean
}

const NEAR_BOTTOM = 120
/** Far enough below the present that getting back is a drag, not a flick. */
const FAR = 400

/** What a message with no words is, in the one line the pin bar has for it. */
function summarise(message: Message): string {
  if (message.body) return message.body
  const mime = message.attachment?.mime ?? ''
  if (mime.startsWith('audio/')) return 'message vocal'
  if (mime.startsWith('image/')) return 'photo'
  return message.attachment ? 'fichier' : '…'
}

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
  const ringUp = useStore((s) => s.ringUp)
  const relay = useStore((s) => s.relay)
  const pin = useStore((s) => s.pin)
  const flag = useStore((s) => s.flag)

  const stream = useRef<HTMLDivElement>(null)
  const wasNearBottom = useRef(true)
  const lastCount = useRef(0)
  const lastId = useRef<string | null>(null)
  const [menu, setMenu] = useState(false)
  /*
   * Whether the present moment is off screen. State rather than a ref written
   * straight to the DOM: unlike the header hairline, a button that is not
   * rendered cannot be pressed.
   */
  const [adrift, setAdrift] = useState(false)
  /** Which pin the bar is showing, when there is more than one. */
  const [aimedPin, setAimedPin] = useState(0)

  useLayoutEffect(() => {
    const el = stream.current
    if (!el) return
    const below = el.scrollHeight - el.scrollTop - el.clientHeight
    wasNearBottom.current = below < NEAR_BOTTOM
    /*
     * Measured on every render, not only on scroll. Landing on a search
     * result, or on the line where reading stopped, puts the present moment
     * far below without a scroll event ever firing — and a button that only
     * appears once you scroll is missing exactly when it is most wanted.
     * Set only on a change, or this would render itself in a circle.
     */
    const far = below > FAR
    setAdrift((was) => (was === far ? was : far))
  })

  // Arriving in a thread puts you at the present moment, with no scroll animation.
  // A different conversation has its own pins; start at the first of them.
  useEffect(() => setAimedPin(0), [conversation.id])

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

  /*
   * Where "new" began.
   *
   * The count cannot come from the conversation: entering marks it read, so
   * it is already zero by the time this renders. The store keeps what was
   * waiting at the moment of entering, and the boundary is derived from it —
   * derived rather than stored, so it settles by itself as the history
   * finishes loading underneath.
   */
  const waiting = useStore((s) => s.fresh[conversation.id] ?? 0)
  const boundary =
    waiting > 0
      ? (messages.filter((m) => m.senderId !== me?.id).slice(-waiting)[0]?.id ?? null)
      : null

  /** Searching inside this conversation, as opposed to everywhere. */
  const [sifting, setSifting] = useState(false)

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
  const handleOf = (id: string): string =>
    conversation.members.find((m) => m.id === id)?.handle ?? ''
  const hueOf = (id: string): number | null =>
    id === me.id ? null : (conversation.members.find((m) => m.id === id)?.hue ?? null)

  const pins = conversation.pins ?? []
  const shownPin = pins[Math.min(aimedPin, Math.max(pins.length - 1, 0))] ?? null
  const pinnedIds = new Set(pins.map((p) => p.id))

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
          <button
            onClick={() => setSifting((on) => !on)}
            aria-label="chercher dans cette conversation"
            title="chercher ici"
            aria-expanded={sifting}
          >
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

      {sifting && <Sift conversationId={conversation.id} onClose={() => setSifting(false)} />}

      {shownPin && (
        <div className="pinbar">
          <button
            className="pinbar__go"
            onClick={() => {
              document
                .getElementById(`m-${shownPin.id}`)
                ?.scrollIntoView({ block: 'center', behavior: 'smooth' })
              // More than one: each visit moves to the next, as everywhere else.
              if (pins.length > 1) setAimedPin((i) => (i + 1) % pins.length)
            }}
            title="aller au message épinglé"
          >
            <span className="pinbar__mark" aria-hidden="true">
              <Icon name="pin" size={15} />
            </span>
            <span className="pinbar__what">
              <span className="pinbar__label">
                épinglé{pins.length > 1 ? ` · ${aimedPin + 1}/${pins.length}` : ''}
              </span>
              <span className="pinbar__body">{summarise(shownPin)}</span>
            </span>
          </button>
          <button
            className="pinbar__drop"
            onClick={() => pin(shownPin, false)}
            aria-label="détacher ce message"
            title="détacher"
          >
            <Icon name="close" size={16} />
          </button>
        </div>
      )}

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
                {/* Where you had stopped reading. */}
                {message.id === boundary && (
                  <div className="daymark daymark--fresh" id="fresh">
                    <span>nouveaux messages</span>
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
                  pinned={pinnedIds.has(message.id)}
                  onReply={setReply}
                  onEdit={setEdit}
                  onRetract={retract}
                  onRelay={relay}
                  onPin={pin}
                  onFlag={
                    mine
                      ? null
                      : (m) =>
                          flag({
                            message: m,
                            handle: handleOf(m.senderId),
                            name: nameOf(m.senderId),
                          })
                  }
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

      {/*
        Reading far up a long conversation, the way back to the present is a
        long drag. The button appears only once the bottom is properly out of
        sight — showing it at forty pixels would make it furniture.
      */}
      {adrift && (
        <button
          className="thread__present"
          onClick={() => {
            const el = stream.current
            if (!el) return
            el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' })
            setAdrift(false)
          }}
          aria-label="revenir au dernier message"
        >
          <Icon name="down" size={18} />
          {conversation.unread > 0 && (
            <span className="thread__present-count">{conversation.unread}</span>
          )}
        </button>
      )}

      <Composer peerName={conversation.face.name} />

      <Lightbox
        attachment={looking?.attachment ?? null}
        url={looking?.url ?? null}
        onClose={() => setLooking(null)}
      />
    </div>
  )
}
