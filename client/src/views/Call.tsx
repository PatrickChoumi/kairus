import { useEffect, useState } from 'react'
import { useStore } from '../state/store'
import { Sigil } from '../ui/Sigil'
import { Icon } from '../ui/Icon'
import { clockOf } from '../net/voice'

/*
 * A call, in the only two shapes it has: someone is ringing you, or you are
 * talking. It takes the whole surface because nothing else matters while it
 * is happening, and it says out loud what state it is in — a call that shows
 * nothing but a spinner is a call you do not trust.
 */

function saying(state: string, outgoing: boolean, reason: string | null): string {
  if (reason) return reason
  if (state === 'incoming') return 'appel entrant'
  if (state === 'ringing') return outgoing ? 'ça sonne…' : 'connexion…'
  if (state === 'ended') return 'appel terminé'
  return ''
}

export function Call() {
  const call = useStore((s) => s.call)
  const conversations = useStore((s) => s.conversations)
  const answer = useStore((s) => s.answerCall)
  const hangUp = useStore((s) => s.hangUp)
  const toggleMute = useStore((s) => s.toggleMute)

  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    if (call?.state !== 'live') return
    const timer = window.setInterval(() => setNow(Date.now()), 500)
    return () => window.clearInterval(timer)
  }, [call?.state])

  // Escape hangs up, which is what every other overlay here does with Escape.
  useEffect(() => {
    if (!call) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        hangUp()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [call, hangUp])

  if (!call) return null

  const conversation = conversations.find((c) => c.id === call.conversationId)
  const peer = conversation?.members.find((m) => m.id === call.peerId)
  const face = peer ?? conversation?.face ?? { id: call.peerId, name: 'quelqu’un', hue: 250 }
  const elapsed = call.since ? (now - call.since) / 1000 : 0

  return (
    <div className="call" data-state={call.state} role="dialog" aria-label="appel">
      <div className="call__who">
        <Sigil user={face} size={96} />
        <p className="call__name">{face.name}</p>
        <p className="call__state">
          {call.state === 'live' ? clockOf(elapsed) : saying(call.state, call.outgoing, call.reason)}
        </p>
        {call.state === 'live' && call.muted && <p className="call__muted">micro coupé</p>}
      </div>

      <div className="call__acts">
        {call.state === 'incoming' ? (
          <>
            <button className="call__refuse" onClick={hangUp} aria-label="refuser">
              <Icon name="hangup" size={26} />
            </button>
            <button className="call__take" onClick={answer} aria-label="répondre">
              <Icon name="phone" size={26} />
            </button>
          </>
        ) : (
          call.state !== 'ended' && (
            <>
              <button
                className="call__mute"
                onClick={toggleMute}
                aria-label={call.muted ? 'rétablir le micro' : 'couper le micro'}
                aria-pressed={call.muted}
              >
                <Icon name={call.muted ? 'muted' : 'sound'} size={22} />
              </button>
              <button className="call__refuse" onClick={hangUp} aria-label="raccrocher">
                <Icon name="hangup" size={26} />
              </button>
            </>
          )
        )}
      </div>
    </div>
  )
}
