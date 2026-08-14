import { useEffect, useRef, useState } from 'react'
import { api } from '../net/api'
import { useStore } from '../state/store'
import { Icon } from '../ui/Icon'
import { stamp } from '../lib/time'
import type { SearchHit } from '../net/types'

/*
 * Searching inside one conversation.
 *
 * Different from the Cursor, which looks everywhere and answers "where was
 * that said". Here one already knows where — the question is *when*, in two
 * years of it. So: more results, in date order rather than by relevance, and
 * every one of them lands you in the thread at that exact message.
 *
 * That last part is the whole feature. A result you cannot reach is a
 * taunt, and the message is very often not loaded — the thread holds the last
 * page and the answer is from March. `reach` walks the history back until it
 * has it.
 */

type Props = {
  conversationId: string
  onClose: () => void
}

export function Sift({ conversationId, onClose }: Props) {
  const reach = useStore((s) => s.reach)
  const notify = useStore((s) => s.notify)

  const field = useRef<HTMLInputElement>(null)
  const [term, setTerm] = useState('')
  const [hits, setHits] = useState<SearchHit[] | null>(null)
  const [looking, setLooking] = useState(false)
  const [going, setGoing] = useState<string | null>(null)

  useEffect(() => {
    const id = requestAnimationFrame(() => field.current?.focus())
    return () => cancelAnimationFrame(id)
  }, [])

  useEffect(() => {
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      event.stopPropagation()
      onClose()
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [onClose])

  // Typing is not a query. The wait is what keeps a long conversation from
  // being searched once per keystroke.
  useEffect(() => {
    const query = term.trim()
    if (query.length < 2) {
      setHits(null)
      setLooking(false)
      return
    }
    setLooking(true)
    let dropped = false
    const timer = window.setTimeout(() => {
      void api
        .search(query, conversationId)
        .then(({ hits: found }) => {
          if (dropped) return
          setHits(found)
          setLooking(false)
        })
        .catch(() => {
          if (dropped) return
          setHits([])
          setLooking(false)
        })
    }, 220)
    return () => {
      dropped = true
      window.clearTimeout(timer)
    }
  }, [term, conversationId])

  /** Lands in the thread on that message, pulling it into view if need be. */
  const go = async (hit: SearchHit) => {
    setGoing(hit.message.id)
    const got = await reach(hit.message.id)
    setGoing(null)
    if (!got) {
      notify('ce message est trop loin pour être rejoint')
      return
    }
    onClose()
    // After the close, so the thread has laid out again.
    requestAnimationFrame(() => {
      const el = document.getElementById(`m-${hit.message.id}`)
      el?.scrollIntoView({ block: 'center', behavior: 'smooth' })
      const line = el?.closest('.line')
      if (!(line instanceof HTMLElement)) return
      // A flash rather than a lasting mark: it answers "which one" and then
      // gets out of the way.
      line.dataset.found = 'true'
      window.setTimeout(() => delete line.dataset.found, 1600)
    })
  }

  const empty = hits !== null && hits.length === 0 && !looking

  return (
    <div className="sift">
      <div className="sift__field">
        <Icon name="search" size={16} />
        <input
          ref={field}
          value={term}
          onChange={(event) => setTerm(event.target.value.slice(0, 120))}
          placeholder="chercher dans cette conversation"
          aria-label="chercher dans cette conversation"
          autoComplete="off"
        />
        <button onClick={onClose} aria-label="fermer la recherche">
          <Icon name="close" size={16} />
        </button>
      </div>

      {(hits !== null || looking) && (
        <div className="sift__hits">
          {looking && <p className="sift__note">…</p>}
          {empty && <p className="sift__note">rien trouvé</p>}
          {!looking &&
            hits?.map((hit) => (
              <button
                key={hit.message.id}
                className="sift__hit"
                onClick={() => void go(hit)}
                data-going={going === hit.message.id || undefined}
              >
                <span className="sift__said">{hit.message.body || 'un message sans texte'}</span>
                <time dateTime={new Date(hit.message.createdAt).toISOString()}>
                  {stamp(hit.message.createdAt)}
                </time>
              </button>
            ))}
        </div>
      )}
    </div>
  )
}
