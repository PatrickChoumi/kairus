import { useEffect, useRef } from 'react'
import { createSpring, type Spring, type SpringConfig } from './spring'

/**
 * Drives a value with a spring and hands each frame to `apply`.
 * `apply` writes to the DOM directly — React never re-renders at 60fps here.
 */
export function useSpringTo(
  target: number,
  config: SpringConfig,
  apply: (value: number) => void,
  { immediate = false }: { immediate?: boolean } = {},
): void {
  const applyRef = useRef(apply)
  applyRef.current = apply

  const spring = useRef<Spring | null>(null)
  if (!spring.current) {
    spring.current = createSpring(target, config, (v) => applyRef.current(v))
  }

  const first = useRef(true)
  useEffect(() => {
    const s = spring.current
    if (!s) return
    if (first.current) {
      first.current = false
      s.set(target)
      return
    }
    if (immediate) s.set(target)
    else s.to(target)
  }, [target, immediate])

  useEffect(() => () => spring.current?.dispose(), [])
}

/** A spring you drive imperatively — for gestures, where input is continuous. */
export function useSpringHandle(
  initial: number,
  config: SpringConfig,
  apply: (value: number) => void,
): Spring {
  const applyRef = useRef(apply)
  applyRef.current = apply

  const ref = useRef<Spring | null>(null)
  ref.current ??= createSpring(initial, config, (v) => applyRef.current(v))

  useEffect(() => () => ref.current?.dispose(), [])
  return ref.current
}

export type Rect = { x: number; y: number; width: number; height: number }
