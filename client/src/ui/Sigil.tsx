import type { CSSProperties, Ref } from 'react'
import type { Face } from '../net/types'

type Props = {
  /** Anything with a name and a colour: a person, or a group. */
  user: Face
  size?: number
  /** A slow pulse when the other person is here. */
  present?: boolean
  /** The pulse quickens while they write. */
  stirring?: boolean
  innerRef?: Ref<HTMLSpanElement>
  hidden?: boolean
}

const initial = (name: string) => {
  const trimmed = name.trim()
  if (!trimmed) return '·'
  return [...trimmed][0]?.toUpperCase() ?? '·'
}

/**
 * A person, rendered as a single mark. The colour is derived from the handle
 * on the server, so an identity always wears the same face.
 */
export function Sigil({ user, size = 40, present, stirring, innerRef, hidden }: Props) {
  const style = {
    '--hue': user.hue,
    '--size': `${size}px`,
    visibility: hidden ? 'hidden' : undefined,
  } as CSSProperties

  return (
    <span
      ref={innerRef}
      className="sigil"
      style={style}
      data-present={present || undefined}
      data-stirring={stirring || undefined}
      aria-hidden="true"
    >
      <span className="sigil__face">{initial(user.name)}</span>
    </span>
  )
}
