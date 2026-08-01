import { useEffect, useRef, useState, type FormEvent } from 'react'
import { useStore } from '../state/store'
import { ApiError } from '../net/api'
import { SPRING } from '../motion/spring'
import { useSpringTo } from '../motion/hooks'

/*
 * Setting up the second factor.
 *
 * This takes the whole surface for the same reason the recovery phrase does:
 * it is a secret that has to move from here into another application, by hand
 * or by a scan, and hurrying it is how people end up locked out.
 *
 * Nothing is in force until the code below proves the authenticator holds the
 * secret — leaving is free, and leaves the account exactly as it was.
 */
export function Guard() {
  const arming = useStore((s) => s.arming)
  const confirm = useStore((s) => s.confirmFactor)
  const drop = useStore((s) => s.dropArming)

  const panel = useRef<HTMLDivElement>(null)
  const [code, setCode] = useState('')
  const [copied, setCopied] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

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

  if (!arming) return null

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(arming.secret)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 2000)
    } catch {
      // Clipboard access can be refused; the secret is on screen regardless.
      setCopied(false)
    }
  }

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (busy) return
    setError(null)
    setBusy(true)
    try {
      await confirm(code)
    } catch (problem) {
      setError(problem instanceof ApiError ? problem.message : 'impossible de confirmer')
      setCode('')
      setBusy(false)
    }
  }

  return (
    <main className="keepsake">
      <div className="keepsake__panel" ref={panel} style={{ opacity: 0 }}>
        <h1 className="keepsake__title">Double authentification</h1>
        <p className="keepsake__line">
          Ajoutez ce secret dans votre application d’authentification — Aegis, 1Password,
          Google Authenticator —, puis recopiez le code qu’elle affiche. Rien n’est activé
          tant que ce code n’a pas été vérifié.
        </p>

        <p className="keepsake__phrase">{arming.readable}</p>

        <div className="keepsake__acts">
          <button className="keepsake__copy" onClick={copy} type="button">
            {copied ? 'copié' : 'copier le secret'}
          </button>
          <a className="keepsake__copy" href={arming.uri}>
            ouvrir dans l’application
          </a>
        </div>

        <form onSubmit={submit}>
          <label className="field">
            <span className="field__mark">#</span>
            <input
              className="field__input"
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
              placeholder="le code à six chiffres"
              inputMode="numeric"
              autoComplete="one-time-code"
              autoFocus
              required
            />
          </label>

          <p className="threshold__error" data-shown={error ? true : undefined}>
            {error ?? ' '}
          </p>

          <button className="keepsake__go" type="submit" disabled={busy || code.length !== 6}>
            activer
          </button>
        </form>

        <div className="threshold__ways">
          <button type="button" onClick={drop}>
            plus tard
          </button>
        </div>

        <p className="keepsake__aside">
          Si vous perdez cette application, votre phrase de secours reprend le compte et
          désactive la double authentification. C’est la seule porte de sortie — gardez-la.
        </p>
      </div>
    </main>
  )
}
