import { useEffect, useRef } from 'react'
import { createSpring, lerp, SPRING } from '../motion/spring'
import type { Rect } from '../motion/hooks'
import { Sigil } from '../ui/Sigil'
import type { Face } from '../net/types'

type Props = {
  user: Face
  from: Rect
  to: Rect
  onDone: () => void
}

/**
 * The single element that travels between the two states of the surface: the
 * person's mark, flying from its place in the list to its place above the
 * thread. Nothing else moves independently, which is what makes the two views
 * read as one surface rather than two screens.
 */
export function Flight({ user, from, to, onDone }: Props) {
  const node = useRef<HTMLDivElement>(null)
  const done = useRef(onDone)
  done.current = onDone

  useEffect(() => {
    const el = node.current
    if (!el) {
      done.current()
      return
    }

    const scaleTo = from.width === 0 ? 1 : to.width / from.width

    const spring = createSpring(0, SPRING.glide, (t) => {
      const x = lerp(from.x, to.x, t)
      const y = lerp(from.y, to.y, t)
      const scale = lerp(1, scaleTo, t)
      el.style.transform = `translate3d(${x}px, ${y}px, 0) scale(${scale})`
      if (t >= 0.999) {
        spring.dispose()
        done.current()
      }
    })
    spring.to(1)
    return () => spring.dispose()
  }, [from, to])

  return (
    <div
      className="flight"
      ref={node}
      style={{
        width: from.width,
        height: from.height,
        transform: `translate3d(${from.x}px, ${from.y}px, 0)`,
      }}
      aria-hidden="true"
    >
      <Sigil user={user} size={from.width} />
    </div>
  )
}
