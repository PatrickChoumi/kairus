import { useEffect, useRef } from 'react'
import { useStore } from '../state/store'
import { SPRING } from '../motion/spring'
import { useSpringTo } from '../motion/hooks'

/** One line, bottom of the screen, gone in four seconds. */
export function Notice() {
  const notice = useStore((s) => s.notice)
  const notify = useStore((s) => s.notify)
  const node = useRef<HTMLDivElement>(null)
  const held = useRef<string | null>(null)

  if (notice) held.current = notice

  useSpringTo(notice ? 1 : 0, SPRING.solid, (t) => {
    const el = node.current
    if (!el) return
    el.style.opacity = String(t)
    el.style.transform = `translate3d(-50%, ${(1 - t) * 16}px, 0)`
    el.style.visibility = t < 0.01 ? 'hidden' : 'visible'
  })

  useEffect(() => {
    if (!notice) return
    const timer = window.setTimeout(() => notify(null), 4000)
    return () => window.clearTimeout(timer)
  }, [notice, notify])

  return (
    <div className="notice" ref={node} role="status" style={{ opacity: 0, visibility: 'hidden' }}>
      {held.current}
    </div>
  )
}
