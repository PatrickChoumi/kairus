import { useEffect, useRef, useState, type FormEvent } from 'react'
import { useStore } from '../state/store'
import { ApiError } from '../net/api'
import { SPRING } from '../motion/spring'
import { useSpringTo } from '../motion/hooks'

type Mode = 'enter' | 'create' | 'recover'

const LABELS: Record<Mode, string> = {
  enter: 'entrer',
  create: 'commencer',
  recover: 'reprendre le compte',
}

/** The way in. One column, no boxes, nothing to read twice. */
export function Threshold() {
  const signIn = useStore((s) => s.signIn)
  const signUp = useStore((s) => s.signUp)
  const recover = useStore((s) => s.recover)

  const [mode, setMode] = useState<Mode>('enter')
  const [handle, setHandle] = useState('')
  const [name, setName] = useState('')
  const [password, setPassword] = useState('')
  const [phrase, setPhrase] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const panel = useRef<HTMLDivElement>(null)
  const [arrived, setArrived] = useState(false)

  useEffect(() => {
    const id = requestAnimationFrame(() => setArrived(true))
    return () => cancelAnimationFrame(id)
  }, [])

  useSpringTo(arrived ? 1 : 0, SPRING.solid, (t) => {
    const el = panel.current
    if (!el) return
    el.style.opacity = String(t)
    el.style.transform = `translate3d(0, ${(1 - t) * 18}px, 0)`
  })

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (busy) return
    setError(null)
    setBusy(true)
    try {
      if (mode === 'enter') await signIn(handle, password)
      else if (mode === 'create') await signUp(handle, name, password)
      else await recover(handle, phrase, password)
    } catch (problem) {
      const message =
        problem instanceof ApiError ? problem.message : 'impossible de continuer'
      const wait =
        problem instanceof ApiError && problem.retryAfter
          ? ` — réessayez dans ${problem.retryAfter} s`
          : ''
      setError(message + wait)
      setBusy(false)
    }
  }

  const go = (next: Mode) => {
    setMode(next)
    setError(null)
  }

  return (
    <main className="threshold">
      <div className="threshold__panel" ref={panel} style={{ opacity: 0 }}>
        <h1 className="wordmark">kairus</h1>
        <p className="threshold__line">là où l’interface disparaît</p>

        <form className="threshold__form" onSubmit={submit}>
          <label className="field">
            <span className="field__mark">@</span>
            <input
              className="field__input"
              value={handle}
              onChange={(e) => setHandle(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, ''))}
              placeholder="votre nom d’usage"
              autoComplete="username"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              maxLength={20}
              autoFocus
              required
            />
          </label>

          {mode === 'create' && (
            <label className="field">
              <span className="field__mark">·</span>
              <input
                className="field__input"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="comment on vous appelle"
                autoComplete="name"
                maxLength={40}
              />
            </label>
          )}

          {mode === 'recover' && (
            <label className="field">
              <span className="field__mark">↺</span>
              <input
                className="field__input"
                value={phrase}
                onChange={(e) => setPhrase(e.target.value)}
                placeholder="phrase de secours"
                autoComplete="off"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                required
              />
            </label>
          )}

          <label className="field">
            <span className="field__mark">·</span>
            <input
              className="field__input"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder={mode === 'recover' ? 'nouvelle phrase secrète' : 'phrase secrète'}
              autoComplete={mode === 'enter' ? 'current-password' : 'new-password'}
              minLength={8}
              required
            />
          </label>

          <button className="threshold__go" type="submit" disabled={busy}>
            {LABELS[mode]}
          </button>
        </form>

        <p className="threshold__error" data-shown={error ? true : undefined}>
          {error ?? ' '}
        </p>

        <div className="threshold__ways">
          {mode !== 'enter' && (
            <button type="button" onClick={() => go('enter')}>
              j’ai déjà un nom
            </button>
          )}
          {mode !== 'create' && (
            <button type="button" onClick={() => go('create')}>
              en choisir un
            </button>
          )}
          {mode !== 'recover' && (
            <button type="button" onClick={() => go('recover')}>
              phrase secrète oubliée
            </button>
          )}
        </div>
      </div>
    </main>
  )
}
