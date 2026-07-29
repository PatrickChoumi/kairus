import { useEffect, useRef } from 'react'
import { SPRING } from '../motion/spring'
import { useSpringTo } from '../motion/hooks'
import { keepFile, readableSize } from '../net/files'
import type { Attachment } from '../net/types'

type Props = {
  attachment: Attachment | null
  url: string | null
  onClose: () => void
}

/** An image, alone, on the whole surface. Escape or a click puts it away. */
export function Lightbox({ attachment, url, onClose }: Props) {
  const veil = useRef<HTMLDivElement>(null)
  const shown = Boolean(attachment && url)

  useSpringTo(shown ? 1 : 0, SPRING.solid, (t) => {
    const el = veil.current
    if (!el) return
    el.style.opacity = String(t)
    el.style.visibility = t < 0.01 ? 'hidden' : 'visible'
    el.style.pointerEvents = t > 0.6 ? 'auto' : 'none'
    const picture = el.firstElementChild as HTMLElement | null
    if (picture) picture.style.transform = `scale(${0.94 + t * 0.06})`
  })

  useEffect(() => {
    if (!shown) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      // Escape belongs to the picture while it is open, not to the thread.
      event.preventDefault()
      event.stopPropagation()
      onClose()
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [shown, onClose])

  return (
    <div
      className="lightbox"
      ref={veil}
      style={{ opacity: 0, visibility: 'hidden' }}
      onPointerDown={onClose}
      role="dialog"
      aria-label={attachment?.name}
    >
      <div className="lightbox__picture" onPointerDown={(e) => e.stopPropagation()}>
        {url && <img src={url} alt={attachment?.name ?? ''} />}
      </div>

      {attachment && (
        <div className="lightbox__foot" onPointerDown={(e) => e.stopPropagation()}>
          <span className="lightbox__name">{attachment.name}</span>
          <span className="lightbox__size">{readableSize(attachment.size)}</span>
          <button onClick={() => void keepFile(attachment)}>enregistrer</button>
        </div>
      )}
    </div>
  )
}
