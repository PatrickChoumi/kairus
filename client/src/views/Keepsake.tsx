import { useEffect, useRef, useState } from 'react'
import { useStore } from '../state/store'
import { SPRING } from '../motion/spring'
import { useSpringTo } from '../motion/hooks'

/**
 * The recovery phrase, at the only moment it exists in the open.
 *
 * Kairus has no email and no telephone, so there is nothing to send this to
 * later — after this screen the server only holds a hash of it. That is why it
 * takes the whole surface and asks to be acknowledged rather than dismissed.
 */
export function Keepsake() {
  const phrase = useStore((s) => s.keepsake)
  const keep = useStore((s) => s.keep)
  const panel = useRef<HTMLDivElement>(null)
  const [copied, setCopied] = useState(false)
  const [held, setHeld] = useState(false)

  const [arrived, setArrived] = useState(false)
  useEffect(() => {
    const id = requestAnimationFrame(() => setArrived(true))
    return () => cancelAnimationFrame(id)
  }, [])

  useSpringTo(arrived ? 1 : 0, SPRING.solid, (t) => {
    const el = panel.current
    if (!el) return
    el.style.opacity = String(t)
    el.style.transform = `translate3d(0, ${(1 - t) * 16}px, 0)`
  })

  if (!phrase) return null

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(phrase)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 2000)
    } catch {
      // Clipboard access can be refused; the phrase is on screen regardless.
      setCopied(false)
    }
  }

  return (
    <main className="keepsake">
      <div className="keepsake__panel" ref={panel} style={{ opacity: 0 }}>
        <h1 className="keepsake__title">Votre phrase de secours</h1>
        <p className="keepsake__line">
          C’est la seule façon de revenir si vous oubliez votre phrase secrète.
          Elle ne sera plus jamais affichée.
        </p>

        <p className="keepsake__phrase">{phrase}</p>

        <div className="keepsake__acts">
          <button className="keepsake__copy" onClick={copy}>
            {copied ? 'copiée' : 'copier'}
          </button>
        </div>

        <label className="keepsake__vow">
          <input type="checkbox" checked={held} onChange={(e) => setHeld(e.target.checked)} />
          <span>Je l’ai mise à l’abri.</span>
        </label>

        <button className="keepsake__go" onClick={keep} disabled={!held}>
          continuer
        </button>
      </div>
    </main>
  )
}
