import { useEffect, useRef, useState, type FormEvent } from 'react'
import { useStore } from '../state/store'
import { ApiError } from '../net/api'
import { SPRING } from '../motion/spring'
import { useSpringTo } from '../motion/hooks'

type Mode = 'enter' | 'create'

/** The way in. One column, no boxes, nothing to read twice. */
export function Threshold() {
  const signIn = useStore((s) => s.signIn)
  const signUp = useStore((s) => s.signUp)

  const [mode, setMode] = useState<Mode>('enter')
  const [handle, setHandle] = useState('')
  const [name, setName] = useState('')
  const [password, setPassword] = useState('')
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
      else await signUp(handle, name, password)
    } catch (problem) {
      setError(problem instanceof ApiError ? problem.message : 'impossible de continuer')
      setBusy(false)
    }
  }

  const swap = () => {
    setMode((m) => (m === 'enter' ? 'create' : 'enter'))
    setError(null)
  }

  return (
    <main className="threshold">
      <div className="threshold__panel" ref={panel}>
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

          <label className="field">
            <span className="field__mark">·</span>
            <input
              className="field__input"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="phrase secrète"
              autoComplete={mode === 'enter' ? 'current-password' : 'new-password'}
              minLength={8}
              required
            />
          </label>

          <button className="threshold__go" type="submit" disabled={busy}>
            {mode === 'enter' ? 'entrer' : 'commencer'}
          </button>
        </form>

        <p className="threshold__error" data-shown={error ? true : undefined}>
          {error ?? ' '}
        </p>

        <button className="threshold__swap" type="button" onClick={swap}>
          {mode === 'enter' ? 'pas encore de nom ? en choisir un' : 'j’ai déjà un nom'}
        </button>
      </div>
    </main>
  )
}
