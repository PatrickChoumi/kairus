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
import { canRecord, clockOf, MAX_SECONDS, Recording } from '../net/voice'
import { Icon } from '../ui/Icon'

const MAX_HEIGHT = 168

export function Composer({ peerName }: { peerName: string }) {
  const say = useStore((s) => s.say)
  const attach = useStore((s) => s.attach)
  const revise = useStore((s) => s.revise)
  const breathe = useStore((s) => s.breathe)
  const notify = useStore((s) => s.notify)
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

  /* ------------------------------------------------------------- recording */

  const recording = useRef<Recording | null>(null)
  const [held, setHeld] = useState(0)
  const [taping, setTaping] = useState(false)

  // One interval while recording, rather than a render per elapsed second.
  useEffect(() => {
    if (!taping) return
    const timer = window.setInterval(() => {
      const seconds = recording.current?.elapsed ?? 0
      setHeld(seconds)
      if (seconds >= MAX_SECONDS) void release()
    }, 200)
    return () => window.clearInterval(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [taping])

  const startTaping = async () => {
    if (taping || editing) return
    try {
      recording.current = await Recording.begin()
      setHeld(0)
      setTaping(true)
    } catch {
      notify('le micro n’est pas accessible — il faut l’autoriser dans le navigateur')
    }
  }

  const release = async () => {
    const tape = recording.current
    recording.current = null
    setTaping(false)
    if (!tape) return
    const prepared = await tape.finish()
    if (!prepared) {
      notify('trop court pour être envoyé')
      return
    }
    void attach([prepared])
  }

  const dropTaping = async () => {
    const tape = recording.current
    recording.current = null
    setTaping(false)
    await tape?.abandon()
  }

  // Leaving the thread with the microphone still open would be rude.
  useEffect(
    () => () => {
      void recording.current?.abandon()
      recording.current = null
    },
    [],
  )

  const ready = draft.trim().length > 0

  // The button is always there; only its weight changes with what you wrote.
  useSpringTo(ready ? 1 : 0, SPRING.crisp, (t) => {
    const el = send.current
    if (!el) return
    el.style.opacity = String(0.45 + t * 0.55)
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
          <span className="composer__reply-mark">
            <Icon name={editing ? 'edit' : 'reply'} size={15} />
          </span>
          <span className="composer__reply-body">
            {editing ? 'vous modifiez ce message' : replyTo?.body}
          </span>
          <button
            className="composer__reply-drop"
            onClick={() => (editing ? abandon() : setReply(null))}
            aria-label={editing ? 'annuler la modification' : 'annuler la réponse'}
          >
            <Icon name="close" size={15} />
          </button>
        </div>
      )}

      {taping ? (
        <div className="composer__line composer__line--taping">
          <button
            className="composer__drop"
            type="button"
            onClick={() => void dropTaping()}
            aria-label="annuler l’enregistrement"
            title="annuler"
          >
            <Icon name="trash" />
          </button>

          <span className="composer__taping">
            <span className="composer__pulse" aria-hidden="true" />
            <span className="composer__held">{clockOf(held)}</span>
            <span className="composer__hint">enregistrement…</span>
          </span>

          <button
            className="composer__send"
            type="button"
            onClick={() => void release()}
            aria-label="envoyer le message vocal"
            title="envoyer"
          >
            <Icon name="send" />
          </button>
        </div>
      ) : (
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
            title="joindre un fichier"
          >
            <Icon name="clip" />
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

          {/* Say it instead of writing it — but only once there is nothing written. */}
          {!ready && !editing && canRecord() && (
            <button
              className="composer__mic"
              type="button"
              onClick={() => void startTaping()}
              aria-label="enregistrer un message vocal"
              title="message vocal"
            >
              <Icon name="mic" />
            </button>
          )}

          <button
            ref={send}
            className="composer__send"
            onClick={dispatch}
            disabled={!ready}
            aria-label={editing ? 'enregistrer' : 'envoyer'}
            title={editing ? 'enregistrer' : 'envoyer'}
          >
            <Icon name={editing ? 'check' : 'send'} />
          </button>
        </div>
      )}

      {hovering && <div className="composer__catch">déposez pour envoyer</div>}
    </div>
  )
}
