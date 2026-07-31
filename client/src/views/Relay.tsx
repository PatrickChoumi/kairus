import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { useStore } from '../state/store'
import { Sigil } from '../ui/Sigil'
import { Icon } from '../ui/Icon'
import { SPRING } from '../motion/spring'
import { useSpringTo } from '../motion/hooks'

/*
 * Where a message goes next.
 *
 * Deliberately not folded into the Cursor: the Cursor answers "what do you
 * want to do", and at this point that is already settled. All that is left is
 * a list of conversations and one choice — so this asks nothing else, and
 * shows what is being sent so nobody forwards the wrong thing.
 */

const fits = (haystack: string, needle: string) =>
  haystack.toLowerCase().includes(needle.toLowerCase())

/** What a message with no words is, in the one line the header has for it. */
function summarise(body: string, mime: string | undefined): string {
  if (body) return body
  if (mime?.startsWith('audio/')) return 'un message vocal'
  if (mime?.startsWith('image/')) return 'une photo'
  return mime ? 'un fichier' : '…'
}

export function Relay() {
  const relaying = useStore((s) => s.relaying)
  const relay = useStore((s) => s.relay)
  const relayTo = useStore((s) => s.relayTo)
  const conversations = useStore((s) => s.conversations)

  const [query, setQuery] = useState('')
  const [aimed, setAimed] = useState(0)
  const panel = useRef<HTMLDivElement>(null)
  const field = useRef<HTMLInputElement>(null)

  const shown = Boolean(relaying)

  useSpringTo(shown ? 1 : 0, SPRING.crisp, (t) => {
    const el = panel.current
    if (!el) return
    el.style.opacity = String(t)
    el.style.transform = `translate3d(0, ${(1 - t) * 12}px, 0) scale(${0.98 + t * 0.02})`
  })

  useEffect(() => {
    if (!shown) return
    setQuery('')
    setAimed(0)
    const id = requestAnimationFrame(() => field.current?.focus())
    return () => cancelAnimationFrame(id)
  }, [shown])

  const matches = useMemo(() => {
    const term = query.trim()
    return conversations.filter((c) => !term || fits(c.face.name, term))
  }, [conversations, query])

  useEffect(() => {
    setAimed((i) => Math.min(i, Math.max(matches.length - 1, 0)))
  }, [matches.length])

  if (!relaying) return null

  const send = (conversationId: string) => relayTo(conversationId)

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === 'Escape') {
      event.preventDefault()
      relay(null)
      return
    }
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      setAimed((i) => Math.min(i + 1, matches.length - 1))
      return
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault()
      setAimed((i) => Math.max(i - 1, 0))
      return
    }
    if (event.key === 'Enter') {
      const target = matches[aimed]
      if (target) {
        event.preventDefault()
        send(target.id)
      }
    }
  }

  return (
    <div
      className="relay"
      role="dialog"
      aria-label="transférer le message"
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) relay(null)
      }}
    >
      <div className="relay__panel" ref={panel} style={{ opacity: 0 }}>
        <header className="relay__head">
          <span className="relay__quest">
            <Icon name="forward" size={15} />
            Transférer vers
          </span>
          <button className="relay__drop" onClick={() => relay(null)} aria-label="annuler">
            <Icon name="close" size={16} />
          </button>
        </header>

        {/* What is being sent, so nobody forwards the wrong thing. */}
        <p className="relay__what">
          {summarise(relaying.body, relaying.attachment?.mime)}
        </p>

        <input
          ref={field}
          className="relay__field"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder="une conversation"
          autoComplete="off"
          spellCheck={false}
        />

        {matches.length === 0 ? (
          <p className="relay__none">Aucune conversation de ce nom.</p>
        ) : (
          <ul className="relay__list">
            {matches.map((conversation, index) => (
              <li key={conversation.id} data-aimed={index === aimed || undefined}>
                <button
                  className="relay__row"
                  onPointerEnter={() => setAimed(index)}
                  onClick={() => send(conversation.id)}
                >
                  <Sigil user={conversation.face} size={30} />
                  <span className="relay__name">{conversation.face.name}</span>
                  {conversation.kind === 'group' && (
                    <span className="relay__hint">{conversation.members.length + 1} personnes</span>
                  )}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}
