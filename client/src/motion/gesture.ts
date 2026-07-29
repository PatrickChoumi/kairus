import { useRef } from 'react'
import type { PointerEvent as ReactPointerEvent } from 'react'

type DragOptions = {
  /** Ignore drags that are mostly vertical — the thread still scrolls. */
  axis?: 'x' | 'y'
  /**
   * Once engaged, keep the gesture from reaching an outer drag handler.
   * A pull on a message answers it; it does not also close the thread.
   */
  exclusive?: boolean
  onStart?: () => void
  onMove?: (delta: number) => void
  onEnd?: (delta: number, velocity: number) => void
}

const ENGAGE_PX = 8

/**
 * A pointer drag that yields to scrolling. Returns props to spread on an
 * element; it never captures the pointer until the gesture is unambiguous.
 */
export function useDrag({ axis = 'x', exclusive = true, onStart, onMove, onEnd }: DragOptions) {
  const state = useRef({
    id: -1,
    startX: 0,
    startY: 0,
    lastAt: 0,
    lastDelta: 0,
    velocity: 0,
    engaged: false,
  })

  const onPointerDown = (e: ReactPointerEvent) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return
    const s = state.current
    s.id = e.pointerId
    s.startX = e.clientX
    s.startY = e.clientY
    s.lastAt = performance.now()
    s.lastDelta = 0
    s.velocity = 0
    s.engaged = false
  }

  const onPointerMove = (e: ReactPointerEvent) => {
    const s = state.current
    if (s.id !== e.pointerId) return

    const dx = e.clientX - s.startX
    const dy = e.clientY - s.startY
    const along = axis === 'x' ? dx : dy
    const across = axis === 'x' ? dy : dx

    if (!s.engaged) {
      if (Math.abs(along) < ENGAGE_PX) return
      // The dominant direction wins; anything else belongs to the scroller.
      if (Math.abs(across) > Math.abs(along)) {
        s.id = -1
        return
      }
      s.engaged = true
      ;(e.currentTarget as Element).setPointerCapture(e.pointerId)
      onStart?.()
    }

    if (exclusive) e.stopPropagation()

    const now = performance.now()
    const dt = Math.max(now - s.lastAt, 1)
    s.velocity = ((along - s.lastDelta) / dt) * 1000
    s.lastDelta = along
    s.lastAt = now
    onMove?.(along)
  }

  const finish = (e: ReactPointerEvent) => {
    const s = state.current
    if (s.id !== e.pointerId) return
    const engaged = s.engaged
    const delta = s.lastDelta
    const velocity = s.velocity
    s.id = -1
    s.engaged = false
    if (!engaged) return
    if ((e.currentTarget as Element).hasPointerCapture?.(e.pointerId)) {
      ;(e.currentTarget as Element).releasePointerCapture(e.pointerId)
    }
    onEnd?.(delta, velocity)
  }

  return {
    onPointerDown,
    onPointerMove,
    onPointerUp: finish,
    onPointerCancel: finish,
  }
}

/** Resistance past a limit, so a drag never feels unbounded. */
export function rubberBand(delta: number, limit: number): number {
  if (delta <= limit) return delta
  const excess = delta - limit
  return limit + excess / (1 + excess / limit)
}
