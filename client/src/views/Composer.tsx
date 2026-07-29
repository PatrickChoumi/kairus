import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
import { useStore, useThread } from '../state/store'
import { SPRING } from '../motion/spring'
import { useSpringTo } from '../motion/hooks'

const MAX_HEIGHT = 168

export function Composer({ peerName }: { peerName: string }) {
  const say = useStore((s) => s.say)
  const breathe = useStore((s) => s.breathe)
  const replyTo = useStore((s) => s.replyTo)
  const setReply = useStore((s) => s.reply)
  const open = useStore((s) => s.open)
  const me = useStore((s) => s.me)
  const messages = useThread(open)

  const [draft, setDraft] = useState('')
  const area = useRef<HTMLTextAreaElement>(null)
  const send = useRef<HTMLButtonElement>(null)

  const ready = draft.trim().length > 0

  useSpringTo(ready ? 1 : 0, SPRING.crisp, (t) => {
    const el = send.current
    if (!el) return
    el.style.opacity = String(t)
    el.style.transform = `scale(${0.6 + t * 0.4})`
    el.style.pointerEvents = t > 0.5 ? 'auto' : 'none'
  })

  // A textarea that grows with what you write, and stops growing politely.
  const resize = () => {
    const el = area.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, MAX_HEIGHT)}px`
  }

  useEffect(resize, [draft])

  // Switching threads gives you a clean slate and the cursor.
  useEffect(() => {
    setDraft('')
    area.current?.focus()
  }, [open])

  useEffect(() => {
    if (replyTo) area.current?.focus()
  }, [replyTo])

  const dispatch = () => {
    if (!ready) return
    say(draft)
    setDraft('')
    requestAnimationFrame(resize)
  }

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault()
      dispatch()
      return
    }
    if (event.key === 'Escape' && replyTo) {
      event.preventDefault()
      setReply(null)
      return
    }
    // An empty composer plus ArrowUp answers the last thing said to you.
    if (event.key === 'ArrowUp' && draft === '') {
      const target = [...messages].reverse().find((m) => m.senderId !== me?.id)
      if (target) {
        event.preventDefault()
        setReply(target)
      }
    }
  }

  return (
    <div className="composer">
      {replyTo && (
        <div className="composer__reply">
          <span className="composer__reply-mark">↩</span>
          <span className="composer__reply-body">{replyTo.body}</span>
          <button
            className="composer__reply-drop"
            onClick={() => setReply(null)}
            aria-label="annuler la réponse"
          >
            ×
          </button>
        </div>
      )}

      <div className="composer__line">
        <textarea
          ref={area}
          className="composer__input"
          rows={1}
          value={draft}
          placeholder={`écrire à ${peerName}`}
          onChange={(e) => {
            setDraft(e.target.value)
            breathe()
          }}
          onKeyDown={onKeyDown}
          onFocus={() => {
            document.documentElement.dataset.writing = 'true'
          }}
          onBlur={() => {
            delete document.documentElement.dataset.writing
          }}
        />
        <button
          ref={send}
          className="composer__send"
          onClick={dispatch}
          tabIndex={ready ? 0 : -1}
          aria-label="envoyer"
        >
          <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
            <path
              d="M5 12h13M12 5.5 18.5 12 12 18.5"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </button>
      </div>
    </div>
  )
}
