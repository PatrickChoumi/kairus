import { useEffect, useRef, useState } from 'react'
import { useStore } from '../state/store'
import { Sigil } from '../ui/Sigil'
import { Icon } from '../ui/Icon'
import { stamp } from '../lib/time'
import type { Conversation } from '../net/types'

/**
 * Whether this conversation has been silenced. -1 is until said otherwise; a
 * date is a silence that lapses on its own, so it has to be compared to now
 * rather than merely tested.
 */
const silenced = (conversation: Conversation): boolean =>
  conversation.mutedUntil === -1 || conversation.mutedUntil > Date.now()

/** What a message with no words is, in the one line the list has for it. */
function summarise(message: NonNullable<Conversation['lastMessage']>): string {
  if (message.body) return message.body
  const mime = message.attachment?.mime ?? ''
  if (mime.startsWith('audio/')) return 'message vocal'
  if (mime.startsWith('image/')) return 'photo'
  return message.attachment ? 'fichier' : ''
}

type Props = {
  /** Hands the row's mark to the stage so it can carry it into the thread. */
  onOpen: (conversation: Conversation, sigil: HTMLElement | null) => void
  dimmed: boolean
}

/**
 * The list of conversations, in the shape everyone already knows: an avatar, a
 * name, the last thing said, the hour and a count. The controls above it are
 * words rather than icons — there are few enough of them to name.
 */
export function Rail({ onOpen, dimmed }: Props) {
  const me = useStore((s) => s.me)
  const conversations = useStore((s) => s.conversations)
  const online = useStore((s) => s.online)
  const typing = useStore((s) => s.typing)
  const link = useStore((s) => s.link)
  const open = useStore((s) => s.open)
  const setCursor = useStore((s) => s.setCursor)

  const sigils = useRef(new Map<string, HTMLSpanElement | null>())
  const [aimed, setAimed] = useState(0)

  useEffect(() => {
    setAimed((i) => Math.min(i, Math.max(conversations.length - 1, 0)))
  }, [conversations.length])

  // The rail answers to the keyboard so the pointer stays optional.
  useEffect(() => {
    if (dimmed) return
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null
      if (target && /input|textarea/i.test(target.tagName)) return
      if (conversations.length === 0) return

      if (event.key === 'ArrowDown' || event.key === 'j') {
        event.preventDefault()
        setAimed((i) => Math.min(i + 1, conversations.length - 1))
      } else if (event.key === 'ArrowUp' || event.key === 'k') {
        event.preventDefault()
        setAimed((i) => Math.max(i - 1, 0))
      } else if (event.key === 'Enter') {
        const conversation = conversations[aimed]
        if (conversation) {
          event.preventDefault()
          onOpen(conversation, sigils.current.get(conversation.id) ?? null)
        }
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [aimed, conversations, dimmed, onOpen])

  if (!me) return null

  return (
    <div className="rail" aria-hidden={dimmed || undefined}>
      <header className="rail__head">
        <div className="rail__self">
          <span className="wordmark">kairus</span>
          <span className="rail__me">
            {me.name} <span>@{me.handle}</span>
            <span className="link" data-link={link} title={link === 'live' ? 'connecté' : 'reconnexion'} />
          </span>
        </div>

        <nav className="rail__acts">
          <button onClick={() => setCursor(true)} aria-label="chercher" title="chercher">
            <Icon name="search" />
          </button>
          <button
            onClick={() => setCursor(true, '@')}
            aria-label="écrire à quelqu’un"
            title="écrire à quelqu’un"
          >
            <Icon name="compose" />
          </button>
          <button
            onClick={() => setCursor(true, 'réunir un groupe')}
            aria-label="réunir un groupe"
            title="réunir un groupe"
          >
            <Icon name="group" />
          </button>
          <button
            onClick={() => setCursor(true, 'réglages')}
            aria-label="réglages"
            title="réglages"
          >
            <Icon name="settings" />
          </button>
        </nav>
      </header>

      {conversations.length === 0 ? (
        <div className="rail__void">
          <p>Aucune conversation.</p>
          <p className="rail__void-how">
            Écrivez à quelqu’un par son nom d’usage, ou réunissez un groupe.
          </p>
          <div className="rail__void-acts">
            <button onClick={() => setCursor(true, '@')}>
              <Icon name="compose" size={16} /> écrire à quelqu’un
            </button>
            <button onClick={() => setCursor(true, 'réunir un groupe')}>
              <Icon name="group" size={16} /> réunir un groupe
            </button>
          </div>
        </div>
      ) : (
        <ul className="rail__list">
          {conversations.map((conversation, index) => {
            const last = conversation.lastMessage
            const mine = last?.senderId === me.id
            const stirring = Boolean(typing[conversation.id])
            const present = conversation.members.some((m) => online[m.id])
            return (
              <li key={conversation.id} style={{ ['--i' as string]: index }}>
                <button
                  className="row"
                  data-aimed={index === aimed || undefined}
                  data-current={conversation.id === open || undefined}
                  data-unread={conversation.unread > 0 || undefined}
                  onPointerEnter={() => setAimed(index)}
                  onClick={() => onOpen(conversation, sigils.current.get(conversation.id) ?? null)}
                >
                  <Sigil
                    user={conversation.face}
                    size={42}
                    present={present}
                    innerRef={(el) => sigils.current.set(conversation.id, el)}
                  />

                  <span className="row__text">
                    <span className="row__top">
                      <span className="row__name">
                        {conversation.face.name}
                        {conversation.kind === 'group' && (
                          <span className="row__count">{conversation.members.length + 1}</span>
                        )}
                      </span>
                      <time className="row__when">{last ? stamp(last.createdAt) : ''}</time>
                    </span>

                    <span className="row__bottom">
                      <span className="row__last">
                        {stirring ? (
                          <em className="row__stirring">écrit…</em>
                        ) : conversation.draft && conversation.id !== open ? (
                          /* What you left half-written outranks what was said:
                             it is the thing you have to come back and finish. */
                          <>
                            <span className="row__draft">Brouillon :</span> {conversation.draft}
                          </>
                        ) : last ? (
                          <>
                            {mine && <span className="row__you">vous : </span>}
                            {summarise(last)}
                          </>
                        ) : (
                          <span className="row__empty">rien encore</span>
                        )}
                      </span>
                      {silenced(conversation) && (
                        <span className="row__hushed" aria-label="notifications coupées">
                          <Icon name="muted" size={13} />
                        </span>
                      )}
                      {conversation.unread > 0 && (
                        <span className="row__unread" data-hushed={silenced(conversation) || undefined}>
                          {conversation.unread}
                        </span>
                      )}
                    </span>
                  </span>
                </button>
              </li>
            )
          })}
        </ul>
      )}

      <footer className="rail__foot">
        <span>
          <kbd>⌘</kbd>
          <kbd>K</kbd> ouvre la même chose au clavier
        </span>
      </footer>
    </div>
  )
}
