import { useEffect, useRef, useState } from 'react'
import { useStore, type SharedKind } from '../state/store'
import { useAttachment } from '../net/blobs'
import { readableSize } from '../net/files'
import { Icon } from '../ui/Icon'
import { SPRING } from '../motion/spring'
import { useSpringTo } from '../motion/hooks'
import { Lightbox } from './Lightbox'
import type { Shared } from '../net/types'

/*
 * Everything ever attached in a conversation.
 *
 * Looking for a photograph someone sent in March, by scrolling, is the kind of
 * small misery that makes people stop using an application. The data was
 * already there; it only needed a door.
 *
 * The grid deliberately shows nothing but the pictures — no names, no dates
 * crowding each tile. What one is doing here is recognising an image, and
 * recognition wants nothing in the way. The details are one tap further, in
 * the picture itself.
 */

const KINDS: { key: SharedKind; label: string }[] = [
  { key: 'image', label: 'images' },
  { key: 'audio', label: 'audio' },
  { key: 'file', label: 'fichiers' },
]

/** One tile. The bytes are fetched only when its turn comes. */
function Tile({ item, onOpen }: { item: Shared; onOpen: () => void }) {
  const { url, failed } = useAttachment(item.attachment.id)
  const image = item.attachment.mime.startsWith('image/')

  if (!image) {
    return (
      <button className="gallery__row" onClick={onOpen} type="button">
        <Icon name={item.attachment.mime.startsWith('audio/') ? 'play' : 'clip'} size={16} />
        <span className="gallery__name">{item.attachment.name}</span>
        <span className="gallery__size">{readableSize(item.attachment.size)}</span>
      </button>
    )
  }

  return (
    <button
      className="gallery__tile"
      onClick={onOpen}
      type="button"
      aria-label={item.attachment.name}
      data-failed={failed || undefined}
    >
      {url ? <img src={url} alt={item.attachment.name} loading="lazy" /> : <span />}
    </button>
  )
}

export function Gallery() {
  const gallery = useStore((s) => s.gallery)
  const shared = useStore((s) => s.shared)
  const browsing = useStore((s) => s.browsing)
  const browse = useStore((s) => s.browse)

  const panel = useRef<HTMLDivElement>(null)
  const [looking, setLooking] = useState<Shared | null>(null)
  const looked = useAttachment(looking?.attachment.id ?? null)

  const shown = Boolean(gallery)

  useSpringTo(shown ? 1 : 0, SPRING.crisp, (t) => {
    const el = panel.current
    if (!el) return
    el.style.opacity = String(t)
    el.style.transform = `translate3d(0, ${(1 - t) * 14}px, 0)`
  })

  useEffect(() => {
    if (!shown) return
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (event.key !== 'Escape') return
      // While a picture is open, Escape belongs to the picture.
      if (looking) return
      event.preventDefault()
      event.stopPropagation()
      browse(null)
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [shown, looking, browse])

  // Closing the gallery must not leave a picture floating over nothing.
  useEffect(() => {
    if (!shown) setLooking(null)
  }, [shown])

  if (!gallery) return null

  const empty = !browsing && shared.length === 0

  return (
    <div
      className="relay"
      role="dialog"
      aria-label="fichiers partagés"
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) browse(null)
      }}
    >
      <div className="relay__panel gallery" ref={panel} style={{ opacity: 0 }}>
        <header className="relay__head">
          <span className="relay__quest">
            <Icon name="images" size={15} />
            Fichiers partagés
          </span>
          <button className="relay__drop" onClick={() => browse(null)} aria-label="fermer">
            <Icon name="close" size={16} />
          </button>
        </header>

        <div className="gallery__kinds" role="tablist">
          {KINDS.map((kind) => (
            <button
              key={kind.key}
              role="tab"
              type="button"
              aria-selected={gallery.kind === kind.key}
              data-picked={gallery.kind === kind.key || undefined}
              onClick={() => browse(gallery.conversationId, kind.key)}
            >
              {kind.label}
            </button>
          ))}
        </div>

        {browsing && <p className="relay__none">un instant…</p>}

        {empty && (
          <p className="relay__none">
            {gallery.kind === 'image'
              ? 'aucune image ici pour l’instant'
              : gallery.kind === 'audio'
                ? 'aucun son ici pour l’instant'
                : 'aucun fichier ici pour l’instant'}
          </p>
        )}

        {!browsing && shared.length > 0 && (
          <div className={gallery.kind === 'image' ? 'gallery__grid' : 'gallery__list'}>
            {shared.map((item) => (
              <Tile key={item.attachment.id} item={item} onOpen={() => setLooking(item)} />
            ))}
          </div>
        )}
      </div>

      <Lightbox
        attachment={looking?.attachment ?? null}
        url={looked.url}
        onClose={() => setLooking(null)}
      />
    </div>
  )
}
