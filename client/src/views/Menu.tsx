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
  const flag = useStore((s) => s.flag)
  const leaveGroup = useStore((s) => s.leaveGroup)
  const hush = useStore((s) => s.hush)
  const browse = useStore((s) => s.browse)

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
  // -1 is until said otherwise; a date in the future is a silence still running.
  const muted = conversation.mutedUntil === -1 || conversation.mutedUntil > Date.now()

  return (
    <div className="menu" ref={panel} role="menu">
      <button role="menuitem" onClick={act(toggleReading)}>
        {reading ? 'quitter le mode lecture' : 'mode lecture'}
      </button>

      <button role="menuitem" onClick={act(() => browse(conversation.id))}>
        fichiers partagés
      </button>

      {/*
        Silence is offered in the two shapes people actually want: "not for the
        next couple of hours" and "not any more". A list of six durations is a
        decision to make when all one wanted was quiet.
      */}
      {muted ? (
        <button role="menuitem" onClick={act(() => void hush(conversation.id, 0))}>
          réactiver les notifications
        </button>
      ) : (
        <>
          <button role="menuitem" onClick={act(() => void hush(conversation.id, 120))}>
            silence pendant 2 heures
          </button>
          <button role="menuitem" onClick={act(() => void hush(conversation.id))}>
            silence jusqu’à nouvel ordre
          </button>
        </>
      )}

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
          <>
            <button
              role="menuitem"
              onClick={act(() =>
                flag({ message: null, handle: peer.handle, name: peer.name }),
              )}
            >
              signaler {peer.name}
            </button>
            <button
              role="menuitem"
              className="menu__grave"
              onClick={act(() => void block(peer.handle))}
            >
              bloquer {peer.name}
            </button>
          </>
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
