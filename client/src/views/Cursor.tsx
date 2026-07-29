import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { useStore } from '../state/store'
import { api } from '../net/api'
import { Sigil } from '../ui/Sigil'
import { SPRING } from '../motion/spring'
import { useSpringTo } from '../motion/hooks'
import type { SearchHit, User } from '../net/types'

const GROUPS = ['conversations', 'quelqu’un d’autre', 'dit plus tôt', 'réglages'] as const
type Group = (typeof GROUPS)[number]

type Item = {
  key: string
  group: Group
  label: string
  hint?: string
  face?: User
  run: () => void
}

const fits = (haystack: string, needle: string) =>
  haystack.toLowerCase().includes(needle.toLowerCase())

/**
 * The Cursor. Kairus has no menus, no settings screen and no toolbar — this
 * one field is where every action lives.
 */
export function Cursor() {
  const shown = useStore((s) => s.cursor)
  const setCursor = useStore((s) => s.setCursor)
  const conversations = useStore((s) => s.conversations)
  const enter = useStore((s) => s.enter)
  const startWith = useStore((s) => s.startWith)
  const theme = useStore((s) => s.theme)
  const setTheme = useStore((s) => s.setTheme)
  const reading = useStore((s) => s.reading)
  const toggleReading = useStore((s) => s.toggleReading)
  const openId = useStore((s) => s.open)
  const leave = useStore((s) => s.leave)
  const signOut = useStore((s) => s.signOut)

  const [query, setQuery] = useState('')
  const [people, setPeople] = useState<User[]>([])
  const [hits, setHits] = useState<SearchHit[]>([])
  const [aimed, setAimed] = useState(0)

  const veil = useRef<HTMLDivElement>(null)
  const panel = useRef<HTMLDivElement>(null)
  const field = useRef<HTMLInputElement>(null)
  const scroller = useRef<HTMLUListElement>(null)

  useSpringTo(shown ? 1 : 0, SPRING.solid, (t) => {
    const el = panel.current
    if (el) {
      el.style.opacity = String(t)
      el.style.transform = `translate3d(0, ${(1 - t) * -14}px, 0) scale(${0.97 + t * 0.03})`
    }
    const backdrop = veil.current
    if (backdrop) {
      backdrop.style.opacity = String(t)
      // Stays out of the way entirely once it has faded.
      backdrop.style.visibility = t < 0.01 ? 'hidden' : 'visible'
      backdrop.style.pointerEvents = t > 0.6 ? 'auto' : 'none'
    }
  })

  useEffect(() => {
    if (!shown) {
      setQuery('')
      setPeople([])
      setHits([])
      setAimed(0)
      return
    }
    const id = requestAnimationFrame(() => field.current?.focus())
    return () => cancelAnimationFrame(id)
  }, [shown])

  // Remote lookups are debounced; local matches are instant.
  useEffect(() => {
    const term = query.replace(/^@/, '').trim()
    if (!shown || term.length < 2) {
      setPeople([])
      setHits([])
      return
    }
    let live = true
    const timer = window.setTimeout(async () => {
      const [found, searched] = await Promise.allSettled([api.people(term), api.search(term)])
      if (!live) return
      setPeople(found.status === 'fulfilled' ? found.value.people : [])
      setHits(searched.status === 'fulfilled' ? searched.value.hits : [])
    }, 160)
    return () => {
      live = false
      window.clearTimeout(timer)
    }
  }, [query, shown])

  const items = useMemo<Item[]>(() => {
    const term = query.trim()
    const list: Item[] = []

    for (const conversation of conversations) {
      if (term && !fits(conversation.peer.name + ' ' + conversation.peer.handle, term.replace(/^@/, ''))) {
        continue
      }
      list.push({
        key: `c:${conversation.id}`,
        group: 'conversations',
        label: conversation.peer.name,
        hint: `@${conversation.peer.handle}`,
        face: conversation.peer,
        run: () => enter(conversation.id),
      })
    }

    const known = new Set(conversations.map((c) => c.peer.id))
    for (const person of people) {
      if (known.has(person.id)) continue
      list.push({
        key: `p:${person.id}`,
        group: 'quelqu’un d’autre',
        label: person.name,
        hint: `@${person.handle}`,
        face: person,
        run: () => void startWith(person.handle),
      })
    }

    for (const hit of hits) {
      list.push({
        key: `m:${hit.message.id}`,
        group: 'dit plus tôt',
        label: hit.message.body,
        hint: hit.peer.name,
        run: () => enter(hit.conversationId),
      })
    }

    const commands: Item[] = [
      {
        key: 'x:theme',
        group: 'réglages',
        label: theme === 'dark' ? 'passer en clair' : 'passer en sombre',
        run: () => setTheme(theme === 'dark' ? 'light' : 'dark'),
      },
      {
        key: 'x:reading',
        group: 'réglages',
        label: reading ? 'quitter le mode lecture' : 'mode lecture',
        hint: 'texte plus grand, tout le reste s’efface',
        run: toggleReading,
      },
      ...(openId
        ? [
            {
              key: 'x:leave',
              group: 'réglages' as const,
              label: 'fermer la conversation',
              run: leave,
            },
          ]
        : []),
      {
        key: 'x:out',
        group: 'réglages',
        label: 'se déconnecter',
        run: signOut,
      },
    ]

    for (const command of commands) {
      if (!term || fits(command.label, term)) list.push(command)
    }

    // A handle typed in full stays openable — but only when it reads as a
    // handle, or when nothing else answered. Otherwise every ordinary word
    // would suggest opening a conversation with a stranger of that name.
    const bare = term.replace(/^@/, '')
    const looksDeliberate = term.startsWith('@') || list.length === 0
    if (
      looksDeliberate &&
      /^[a-z0-9_]{3,20}$/.test(bare) &&
      !list.some((i) => i.hint === `@${bare}`)
    ) {
      list.push({
        key: `n:${bare}`,
        group: 'quelqu’un d’autre',
        label: `ouvrir @${bare}`,
        run: () => void startWith(bare),
      })
    }

    // Groups must stay contiguous, or a heading would be printed twice.
    return list.sort((a, b) => GROUPS.indexOf(a.group) - GROUPS.indexOf(b.group))
  }, [
    conversations,
    people,
    hits,
    query,
    theme,
    reading,
    openId,
    enter,
    startWith,
    setTheme,
    toggleReading,
    leave,
    signOut,
  ])

  useEffect(() => setAimed(0), [query])

  useEffect(() => {
    scroller.current?.children[aimed]?.scrollIntoView({ block: 'nearest' })
  }, [aimed])

  const choose = (item: Item | undefined) => {
    if (!item) return
    item.run()
    setCursor(false)
  }

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      setAimed((i) => Math.min(i + 1, items.length - 1))
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      setAimed((i) => Math.max(i - 1, 0))
    } else if (event.key === 'Enter') {
      event.preventDefault()
      choose(items[aimed])
    } else if (event.key === 'Escape') {
      event.preventDefault()
      setCursor(false)
    }
  }

  let group = ''

  return (
    <div
      className="cursor"
      ref={veil}
      style={{ opacity: 0, visibility: 'hidden' }}
      onPointerDown={() => setCursor(false)}
    >
      <div
        className="cursor__panel"
        ref={panel}
        style={{ opacity: 0 }}
        onPointerDown={(e) => e.stopPropagation()}
      >
        <input
          ref={field}
          className="cursor__field"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder="un nom, un mot, une intention"
          aria-label="commande"
          autoComplete="off"
          spellCheck={false}
        />

        <ul className="cursor__list" ref={scroller}>
          {items.map((item, index) => {
            const header = item.group !== group ? item.group : null
            group = item.group
            return (
              <li
                key={item.key}
                className="cursor__item"
                data-aimed={index === aimed || undefined}
                data-group={header ?? undefined}
                onPointerEnter={() => setAimed(index)}
                onPointerUp={() => choose(item)}
              >
                {header && <span className="cursor__group">{header}</span>}
                <span className="cursor__row">
                  {item.face ? (
                    <Sigil user={item.face} size={26} />
                  ) : (
                    <span className="cursor__glyph">›</span>
                  )}
                  <span className="cursor__label">{item.label}</span>
                  {item.hint && <span className="cursor__hint">{item.hint}</span>}
                </span>
              </li>
            )
          })}

          {items.length === 0 && <li className="cursor__none">rien sous ce nom</li>}
        </ul>
      </div>
    </div>
  )
}
