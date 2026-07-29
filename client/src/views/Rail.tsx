import { useEffect, useRef, useState } from 'react'
import { useStore } from '../state/store'
import { Sigil } from '../ui/Sigil'
import { stamp } from '../lib/time'
import type { Conversation } from '../net/types'

type Props = {
  /** Hands the row's sigil to the stage so it can carry it into the thread. */
  onOpen: (conversation: Conversation, sigil: HTMLElement | null) => void
  dimmed: boolean
}

export function Rail({ onOpen, dimmed }: Props) {
  const me = useStore((s) => s.me)
  const conversations = useStore((s) => s.conversations)
  const online = useStore((s) => s.online)
  const typing = useStore((s) => s.typing)
  const link = useStore((s) => s.link)
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
        <Sigil user={me} size={34} />
        <div className="rail__self">
          <span className="rail__name">{me.name}</span>
          <span className="rail__handle">@{me.handle}</span>
        </div>
        <span className="link" data-link={link} title={link === 'live' ? 'connecté' : 'reconnexion'} />
      </header>

      {conversations.length === 0 ? (
        <div className="rail__void">
          <p>Rien encore.</p>
          <button className="rail__void-go" onClick={() => setCursor(true)}>
            appeler quelqu’un
          </button>
        </div>
      ) : (
        <ul className="rail__list">
          {conversations.map((conversation, index) => {
            const last = conversation.lastMessage
            const mine = last?.senderId === me.id
            const stirring = Boolean(typing[conversation.id])
            return (
              <li key={conversation.id} style={{ ['--i' as string]: index }}>
                <button
                  className="row"
                  data-aimed={index === aimed || undefined}
                  data-unread={conversation.unread > 0 || undefined}
                  onPointerEnter={() => setAimed(index)}
                  onClick={() => onOpen(conversation, sigils.current.get(conversation.id) ?? null)}
                >
                  <Sigil
                    user={conversation.peer}
                    size={44}
                    present={online[conversation.peer.id]}
                    stirring={stirring}
                    innerRef={(el) => sigils.current.set(conversation.id, el)}
                  />
                  <span className="row__text">
                    <span className="row__name">{conversation.peer.name}</span>
                    <span className="row__last">
                      {stirring ? (
                        <em className="row__stirring">écrit…</em>
                      ) : last ? (
                        <>
                          {mine && <span className="row__you">vous · </span>}
                          {last.body}
                        </>
                      ) : (
                        <span className="row__empty">conversation ouverte</span>
                      )}
                    </span>
                  </span>
                  <span className="row__aside">
                    <time className="row__time">{last ? stamp(last.createdAt) : ''}</time>
                    {conversation.unread > 0 && <span className="row__dot" />}
                  </span>
                </button>
              </li>
            )
          })}
        </ul>
      )}

      <footer className="rail__hint">
        <kbd>⌘</kbd>
        <kbd>K</kbd>
        <span>pour tout faire</span>
      </footer>
    </div>
  )
}
