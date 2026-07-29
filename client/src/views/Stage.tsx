import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useStore } from '../state/store'
import { Rail } from './Rail'
import { Thread } from './Thread'
import { Cursor } from './Cursor'
import { Flight } from './Flight'
import { SPRING, prefersReducedMotion } from '../motion/spring'
import { useSpringTo } from '../motion/hooks'
import type { Rect } from '../motion/hooks'
import { rubberBand, useDrag } from '../motion/gesture'
import type { Conversation } from '../net/types'

type Morph = { user: Conversation['peer']; from: Rect; to: Rect }

const rectOf = (el: Element | null): Rect | null => {
  if (!el) return null
  const r = el.getBoundingClientRect()
  if (r.width === 0) return null
  return { x: r.left, y: r.top, width: r.width, height: r.height }
}

/**
 * The whole application is this one surface. The list and the thread are two
 * states of it, not two pages, and the transition between them is continuous.
 */
export function Stage() {
  const open = useStore((s) => s.open)
  const conversations = useStore((s) => s.conversations)
  const enter = useStore((s) => s.enter)
  const leave = useStore((s) => s.leave)
  const cursor = useStore((s) => s.cursor)
  const setCursor = useStore((s) => s.setCursor)

  /**
   * The thread stays mounted while it leaves, so the motion can finish. It is
   * derived rather than stored, because the header has to exist on the very
   * first render after opening — that is when its position is measured.
   */
  const [residual, setResidual] = useState<string | null>(null)
  const showing = open ?? residual
  const [morph, setMorph] = useState<Morph | null>(null)

  const railLayer = useRef<HTMLDivElement>(null)
  const threadLayer = useRef<HTMLDivElement>(null)
  const headSigil = useRef<HTMLSpanElement>(null)
  const pendingFrom = useRef<Rect | null>(null)
  const railSigil = useRef<HTMLElement | null>(null)

  useEffect(() => {
    if (open) setResidual(open)
  }, [open])

  const conversation = conversations.find((c) => c.id === showing) ?? null

  useSpringTo(open ? 1 : 0, SPRING.solid, (t) => {
    const rail = railLayer.current
    if (rail) {
      rail.style.opacity = String(1 - t)
      rail.style.transform = `scale(${1 - t * 0.04})`
      rail.style.pointerEvents = t > 0.5 ? 'none' : 'auto'
    }
    const thread = threadLayer.current
    if (thread) {
      thread.style.opacity = String(t)
      thread.style.transform = `translate3d(0, ${(1 - t) * 20}px, 0)`
      thread.style.pointerEvents = t > 0.5 ? 'auto' : 'none'
    }
    if (t < 0.01 && !useStore.getState().open) setResidual(null)
  })

  /**
   * While the mark is in flight there must be exactly one of it on screen, so
   * both the copy in the list and the copy in the header step aside.
   */
  const beginMorph = useCallback((next: Morph) => {
    if (railSigil.current) railSigil.current.style.visibility = 'hidden'
    setMorph(next)
  }, [])

  const endMorph = useCallback(() => {
    if (railSigil.current) railSigil.current.style.visibility = ''
    setMorph(null)
  }, [])

  /* ------------------------------------------------------------- opening */

  const onOpen = useCallback(
    (target: Conversation, sigil: HTMLElement | null) => {
      pendingFrom.current = rectOf(sigil)
      railSigil.current = sigil
      enter(target.id)
    },
    [enter],
  )

  // The thread has just mounted: measure where the mark landed and fly it there.
  useLayoutEffect(() => {
    if (!open || !conversation) return
    const from = pendingFrom.current
    pendingFrom.current = null
    if (!from || prefersReducedMotion()) return
    const to = rectOf(headSigil.current)
    if (!to) return
    beginMorph({ user: conversation.peer, from, to })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  /* ------------------------------------------------------------- closing */

  const close = useCallback(() => {
    const from = rectOf(headSigil.current)
    const to = rectOf(railSigil.current)
    const peer = conversation?.peer
    if (from && to && peer && !prefersReducedMotion()) {
      beginMorph({ user: peer, from, to })
    }
    leave()
  }, [beginMorph, conversation, leave])

  /* ------------------------------------------------------------ keyboard */

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const meta = event.metaKey || event.ctrlKey
      if (meta && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        setCursor(!useStore.getState().cursor)
        return
      }
      if (event.key === 'Escape') {
        if (useStore.getState().cursor) {
          setCursor(false)
        } else if (useStore.getState().open) {
          event.preventDefault()
          close()
        }
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [close, setCursor])

  /* -------------------------------------------------------------- gesture */

  const swipe = useDrag({
    axis: 'x',
    onMove(delta) {
      const el = threadLayer.current
      if (!el || delta <= 0) return
      const travel = rubberBand(delta, 140)
      el.style.transform = `translate3d(${travel}px, 0, 0)`
      el.style.opacity = String(1 - Math.min(travel / 320, 0.4))
    },
    onEnd(delta, velocity) {
      const el = threadLayer.current
      if (!el) return
      if (delta > 90 || velocity > 700) {
        el.style.transform = ''
        el.style.opacity = ''
        close()
      } else {
        el.style.transform = ''
        el.style.opacity = ''
      }
    },
  })

  return (
    <div className="stage" data-view={open ? 'thread' : 'rail'} data-cursor={cursor || undefined}>
      <div className="layer layer--rail" ref={railLayer}>
        <Rail onOpen={onOpen} dimmed={Boolean(open) || cursor} />
      </div>

      {conversation && (
        <div className="layer layer--thread" ref={threadLayer} {...swipe}>
          <Thread
            conversation={conversation}
            onLeave={close}
            headSigil={headSigil}
            sigilHidden={Boolean(morph)}
          />
        </div>
      )}

      {morph && (
        <Flight user={morph.user} from={morph.from} to={morph.to} onDone={endMorph} />
      )}

      <Cursor />
    </div>
  )
}
