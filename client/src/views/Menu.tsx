import { useEffect, useRef } from 'react'
import { useStore } from '../state/store'
import type { Conversation } from '../net/types'

type Props = {
  conversation: Conversation
  onClose: () => void
}

/**
 * Everything you can do to the conversation you are in, in one place you can
 * see. The Cursor can still reach all of it by name — but nobody should have
 * to know a command exists in order to find it.
 */
export function Menu({ conversation, onClose }: Props) {
  const panel = useRef<HTMLDivElement>(null)
  const reading = useStore((s) => s.reading)
  const toggleReading = useStore((s) => s.toggleReading)
  const setCursor = useStore((s) => s.setCursor)
  const block = useStore((s) => s.block)
  const leaveGroup = useStore((s) => s.leaveGroup)

  useEffect(() => {
    const away = (event: PointerEvent) => {
      const target = event.target as Element | null
      if (panel.current?.contains(target ?? null)) return
      // The button that opened it must not count as "outside": closing here
      // and re-opening on its click would leave the menu permanently stuck.
      if (target?.closest('[data-menu-toggle]')) return
      onClose()
    }
    const key = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      event.stopPropagation()
      onClose()
    }
    // Capture, so closing the menu does not also close the conversation.
    window.addEventListener('pointerdown', away, true)
    window.addEventListener('keydown', key, true)
    return () => {
      window.removeEventListener('pointerdown', away, true)
      window.removeEventListener('keydown', key, true)
    }
  }, [onClose])

  const act = (run: () => void) => () => {
    run()
    onClose()
  }

  const peer = conversation.members[0]

  return (
    <div className="menu" ref={panel} role="menu">
      <button role="menuitem" onClick={act(toggleReading)}>
        {reading ? 'quitter le mode lecture' : 'mode lecture'}
      </button>

      {conversation.kind === 'group' ? (
        <>
          <button
            role="menuitem"
            onClick={act(() => setCursor(true, 'ajouter quelqu’un au groupe'))}
          >
            ajouter quelqu’un
          </button>
          <button role="menuitem" onClick={act(() => setCursor(true, 'renommer le groupe'))}>
            renommer le groupe
          </button>
          <button
            role="menuitem"
            className="menu__grave"
            onClick={act(() => void leaveGroup(conversation.id))}
          >
            quitter le groupe
          </button>
        </>
      ) : (
        peer && (
          <button
            role="menuitem"
            className="menu__grave"
            onClick={act(() => void block(peer.handle))}
          >
            bloquer {peer.name}
          </button>
        )
      )}

      <span className="menu__note">
        {conversation.kind === 'group'
          ? `${conversation.members.length + 1} personnes`
          : `@${peer?.handle ?? ''}`}
      </span>
    </div>
  )
}
