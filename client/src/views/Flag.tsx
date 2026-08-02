import { useEffect, useRef, useState, type FormEvent } from 'react'
import { useStore } from '../state/store'
import { Icon } from '../ui/Icon'
import { SPRING } from '../motion/spring'
import { useSpringTo } from '../motion/hooks'

/*
 * Reporting.
 *
 * Blocking already lets someone make it stop for themselves. This is the
 * other half — telling whoever runs the server that something happened —
 * and it says plainly what it does and does not do. A screen that implied an
 * account would be dealt with, when nothing automatic happens at all, would
 * be worse than no screen: it would be a promise to someone who is already
 * having a bad day.
 */

const REASONS = ['harcèlement', 'contenu illégal', 'usurpation', 'spam'] as const

export function Flag() {
  const flagging = useStore((s) => s.flagging)
  const flag = useStore((s) => s.flag)
  const flagWith = useStore((s) => s.flagWith)

  const panel = useRef<HTMLDivElement>(null)
  const field = useRef<HTMLInputElement>(null)
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)

  const shown = Boolean(flagging)

  useSpringTo(shown ? 1 : 0, SPRING.crisp, (t) => {
    const el = panel.current
    if (!el) return
    el.style.opacity = String(t)
    el.style.transform = `translate3d(0, ${(1 - t) * 12}px, 0) scale(${0.98 + t * 0.02})`
  })

  useEffect(() => {
    if (!shown) return
    setReason('')
    setBusy(false)
    const id = requestAnimationFrame(() => field.current?.focus())
    return () => cancelAnimationFrame(id)
  }, [shown])

  useEffect(() => {
    if (!shown) return
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      event.stopPropagation()
      flag(null)
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [shown, flag])

  if (!flagging) return null

  const send = async (event: FormEvent) => {
    event.preventDefault()
    if (busy || !reason.trim()) return
    setBusy(true)
    await flagWith(reason.trim())
    setBusy(false)
  }

  return (
    <div
      className="relay"
      role="dialog"
      aria-label="signaler"
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) flag(null)
      }}
    >
      <div className="relay__panel" ref={panel} style={{ opacity: 0 }}>
        <header className="relay__head">
          <span className="relay__quest relay__quest--grave">
            <Icon name="flag" size={15} />
            Signaler {flagging.name}
          </span>
          <button className="relay__drop" onClick={() => flag(null)} aria-label="annuler">
            <Icon name="close" size={16} />
          </button>
        </header>

        {flagging.message && (
          <p className="relay__what">{flagging.message.body || 'un message sans texte'}</p>
        )}

        <form className="flag__form" onSubmit={send}>
          <div className="flag__reasons">
            {REASONS.map((one) => (
              <button
                key={one}
                type="button"
                data-picked={reason === one || undefined}
                onClick={() => setReason(one)}
              >
                {one}
              </button>
            ))}
          </div>

          <input
            ref={field}
            className="relay__field"
            value={reason}
            onChange={(e) => setReason(e.target.value.slice(0, 300))}
            placeholder="en quelques mots"
            autoComplete="off"
          />

          <button className="flag__go" type="submit" disabled={busy || !reason.trim()}>
            signaler
          </button>
        </form>

        {/* What this does, and what it does not. */}
        <p className="flag__truth">
          Le signalement est transmis à qui administre ce serveur, avec une copie du message
          telle qu’elle est maintenant. Rien ne se produit automatiquement — aucun compte ne
          disparaît sur un nombre de signalements. Pour que cela s’arrête tout de suite de
          votre côté, bloquez la personne.
        </p>
      </div>
    </div>
  )
}
