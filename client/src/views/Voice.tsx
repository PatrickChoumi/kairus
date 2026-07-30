import { useEffect, useRef, useState } from 'react'
import { useAttachment } from '../net/blobs'
import { clockOf, peaksOf } from '../net/voice'
import { Icon } from '../ui/Icon'
import type { Message } from '../net/types'

/*
 * A voice message.
 *
 * The waveform is drawn from samples that travelled with the attachment, so
 * the bubble has its final shape before any audio is fetched — nothing jumps
 * under the reader, and a message you never play costs nothing to show. The
 * bytes are only requested when you press play.
 */

/** One player at a time, the way every messenger behaves. */
let playing: HTMLAudioElement | null = null

export function Voice({ message }: { message: Message }) {
  const attachment = message.attachment
  const [wanted, setWanted] = useState(false)
  const [running, setRunning] = useState(false)
  const [at, setAt] = useState(0)

  // Nothing is downloaded until someone asks to hear it.
  const remote = useAttachment(wanted && !message.pending ? (attachment?.id ?? null) : null)
  const url = message.preview ?? remote.url
  const audio = useRef<HTMLAudioElement | null>(null)

  const total = attachment?.duration ?? 0
  const bars = peaksOf(attachment?.peaks ?? null)
  const done = total > 0 ? Math.min(at / total, 1) : 0

  useEffect(() => {
    if (!url) return
    const el = audio.current ?? new Audio()
    audio.current = el
    if (el.src !== url) el.src = url

    const onTime = () => setAt(el.currentTime)
    const onEnd = () => {
      setRunning(false)
      setAt(0)
      if (playing === el) playing = null
    }
    el.addEventListener('timeupdate', onTime)
    el.addEventListener('ended', onEnd)
    el.addEventListener('pause', () => setRunning(false))
    return () => {
      el.removeEventListener('timeupdate', onTime)
      el.removeEventListener('ended', onEnd)
    }
  }, [url])

  // Asked to play before the bytes were here: start as soon as they arrive.
  useEffect(() => {
    if (!running || !audio.current || !url) return
    if (playing && playing !== audio.current) playing.pause()
    playing = audio.current
    void audio.current.play().catch(() => setRunning(false))
  }, [running, url])

  // Leaving the thread should not leave a voice playing into an empty room.
  useEffect(
    () => () => {
      const el = audio.current
      if (!el) return
      el.pause()
      if (playing === el) playing = null
    },
    [],
  )

  if (!attachment) return null

  const toggle = () => {
    if (running) {
      audio.current?.pause()
      setRunning(false)
      return
    }
    setWanted(true)
    setRunning(true)
  }

  /** Clicking the waveform seeks, which is the only reason to draw it wide. */
  const seek = (event: React.MouseEvent<HTMLDivElement>) => {
    if (total <= 0) return
    const box = event.currentTarget.getBoundingClientRect()
    const fraction = Math.min(Math.max((event.clientX - box.left) / box.width, 0), 1)
    setWanted(true)
    setAt(fraction * total)
    if (audio.current && audio.current.readyState > 0) audio.current.currentTime = fraction * total
  }

  return (
    <div className="voice" data-playing={running || undefined}>
      <button
        className="voice__go"
        type="button"
        onClick={toggle}
        disabled={Boolean(message.pending)}
        aria-label={running ? 'mettre en pause' : 'écouter'}
      >
        <Icon name={running ? 'pause' : 'play'} size={18} />
      </button>

      <div className="voice__wave" onClick={seek} role="presentation">
        {bars.map((height, index) => (
          <span
            key={index}
            style={{ ['--h' as string]: `${height}%` }}
            data-played={index / bars.length < done || undefined}
          />
        ))}
      </div>

      <span className="voice__time">
        {message.pending
          ? `${Math.round((message.progress ?? 0) * 100)} %`
          : clockOf(running || at > 0 ? total - at : total)}
      </span>

      {remote.failed && <span className="voice__lost">indisponible</span>}
    </div>
  )
}
