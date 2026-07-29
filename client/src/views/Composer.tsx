import {
  useEffect,
  useRef,
  useState,
  type ClipboardEvent,
  type DragEvent,
  type KeyboardEvent,
} from 'react'
import { useStore, useThread } from '../state/store'
import { SPRING } from '../motion/spring'
import { useSpringTo } from '../motion/hooks'

const MAX_HEIGHT = 168

export function Composer({ peerName }: { peerName: string }) {
  const say = useStore((s) => s.say)
  const attach = useStore((s) => s.attach)
  const revise = useStore((s) => s.revise)
  const breathe = useStore((s) => s.breathe)
  const replyTo = useStore((s) => s.replyTo)
  const setReply = useStore((s) => s.reply)
  const editing = useStore((s) => s.editing)
  const setEdit = useStore((s) => s.edit)
  const open = useStore((s) => s.open)
  const me = useStore((s) => s.me)
  const messages = useThread(open)

  const [draft, setDraft] = useState('')
  const [hovering, setHovering] = useState(false)
  const area = useRef<HTMLTextAreaElement>(null)
  const send = useRef<HTMLButtonElement>(null)
  const picker = useRef<HTMLInputElement>(null)
  const dragDepth = useRef(0)

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

  // Rewriting starts from what you actually wrote.
  useEffect(() => {
    if (!editing) return
    setDraft(editing.body)
    area.current?.focus()
    requestAnimationFrame(() => {
      const el = area.current
      el?.setSelectionRange(el.value.length, el.value.length)
    })
  }, [editing])

  const dispatch = () => {
    if (!ready) return
    if (editing) revise(draft)
    else say(draft)
    setDraft('')
    requestAnimationFrame(resize)
  }

  /** Files go with whatever was already written, as its caption. */
  const carry = (files: File[]) => {
    if (files.length === 0 || editing) return
    const caption = draft.trim()
    setDraft('')
    requestAnimationFrame(resize)
    void attach(files, caption)
  }

  const onPaste = (event: ClipboardEvent<HTMLTextAreaElement>) => {
    const files = [...event.clipboardData.files]
    if (files.length === 0) return
    // A screenshot in the clipboard is the fastest way to send one.
    event.preventDefault()
    carry(files)
  }

  const onDrop = (event: DragEvent) => {
    event.preventDefault()
    dragDepth.current = 0
    setHovering(false)
    carry([...event.dataTransfer.files])
  }

  const abandon = () => {
    setEdit(null)
    setDraft('')
    requestAnimationFrame(resize)
  }

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault()
      dispatch()
      return
    }
    if (event.key === 'Escape') {
      if (editing) {
        event.preventDefault()
        abandon()
      } else if (replyTo) {
        event.preventDefault()
        setReply(null)
      }
      return
    }
    // An empty composer plus ArrowUp reopens the last thing you said.
    if (event.key === 'ArrowUp' && draft === '' && !editing) {
      const target = [...messages]
        .reverse()
        .find((m) => m.senderId === me?.id && !m.pending && !m.deletedAt)
      if (target) {
        event.preventDefault()
        setEdit(target)
      }
    }
  }

  return (
    <div
      className="composer"
      data-editing={editing ? true : undefined}
      data-hovering={hovering || undefined}
      onDragEnter={(e) => {
        e.preventDefault()
        dragDepth.current += 1
        if (!editing) setHovering(true)
      }}
      onDragOver={(e) => e.preventDefault()}
      onDragLeave={() => {
        dragDepth.current -= 1
        if (dragDepth.current <= 0) setHovering(false)
      }}
      onDrop={onDrop}
    >
      {(replyTo || editing) && (
        <div className="composer__reply">
          <span className="composer__reply-mark">{editing ? '✎' : '↩'}</span>
          <span className="composer__reply-body">
            {editing ? 'vous modifiez ce message' : replyTo?.body}
          </span>
          <button
            className="composer__reply-drop"
            onClick={() => (editing ? abandon() : setReply(null))}
            aria-label={editing ? 'annuler la modification' : 'annuler la réponse'}
          >
            ×
          </button>
        </div>
      )}

      <div className="composer__line">
        <input
          ref={picker}
          className="composer__picker"
          type="file"
          multiple
          onChange={(e) => {
            carry([...(e.target.files ?? [])])
            e.target.value = ''
          }}
          tabIndex={-1}
          aria-hidden="true"
        />
        <button
          className="composer__clip"
          type="button"
          onClick={() => picker.current?.click()}
          disabled={Boolean(editing)}
          aria-label="joindre un fichier"
        >
          <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
            <path
              d="M12 5v14M5 12h14"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.7"
              strokeLinecap="round"
            />
          </svg>
        </button>
        <textarea
          ref={area}
          className="composer__input"
          rows={1}
          value={draft}
          placeholder={editing ? 'réécrire' : `écrire à ${peerName}`}
          onChange={(e) => {
            setDraft(e.target.value)
            if (!editing) breathe()
          }}
          onKeyDown={onKeyDown}
          onPaste={onPaste}
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
          aria-label={editing ? 'enregistrer' : 'envoyer'}
        >
          <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
            {editing ? (
              <path
                d="M5 12.5 10 17.5 19 7"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            ) : (
              <path
                d="M5 12h13M12 5.5 18.5 12 12 18.5"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            )}
          </svg>
        </button>
      </div>

      {hovering && <div className="composer__catch">déposez pour envoyer</div>}
    </div>
  )
}
