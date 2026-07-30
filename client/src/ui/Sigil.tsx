import type { CSSProperties, Ref } from 'react'
import type { Face } from '../net/types'

type Props = {
  /** Anything with a name and a colour: a person, or a group. */
  user: Face
  size?: number
  /** Whether anyone is there. Stated, not merely implied by a glow. */
  present?: boolean
  innerRef?: Ref<HTMLSpanElement>
  hidden?: boolean
}

/** Up to two letters, so a group named "Hut 8" reads as H8 rather than H. */
function letters(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean)
  if (words.length === 0) return '·'
  const first = [...(words[0] ?? '')][0] ?? ''
  const second = words.length > 1 ? ([...(words[1] ?? '')][0] ?? '') : ''
  return (first + second).toUpperCase()
}

/**
 * A person or a group, rendered as a mark.
 *
 * Square, not round: the circular avatar is the single most recognisable
 * borrowed gesture in messaging, and Kairus does not borrow it. The colour is
 * derived on the server, so an identity always wears the same one.
 */
export function Sigil({ user, size = 34, present, innerRef, hidden }: Props) {
  const style = {
    '--hue': user.hue,
    '--size': `${size}px`,
    visibility: hidden ? 'hidden' : undefined,
  } as CSSProperties

  return (
    <span
      ref={innerRef}
      className="mark"
      style={style}
      data-present={present || undefined}
      aria-hidden="true"
    >
      {letters(user.name)}
    </span>
  )
}
