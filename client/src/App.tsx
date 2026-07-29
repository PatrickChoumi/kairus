import { useEffect } from 'react'
import { useStore } from './state/store'
import { Threshold } from './views/Threshold'
import { Stage } from './views/Stage'
import { Keepsake } from './views/Keepsake'
import { Notice } from './ui/Notice'

export function App() {
  const status = useStore((s) => s.status)
  const theme = useStore((s) => s.theme)
  const keepsake = useStore((s) => s.keepsake)
  const boot = useStore((s) => s.boot)

  useEffect(() => {
    void boot()
  }, [boot])

  useEffect(() => {
    document.documentElement.dataset.theme = theme
  }, [theme])

  // Arriving from a notification: open what it was about, once and only once.
  useEffect(() => {
    if (status !== 'in') return

    const openFromUrl = () => {
      const wanted = new URLSearchParams(location.search).get('c')
      if (!wanted) return
      history.replaceState(null, '', location.pathname)
      useStore.getState().enter(wanted)
    }
    openFromUrl()

    const fromWorker = (event: MessageEvent) => {
      const data = event.data as { t?: string; conversation?: string } | null
      if (data?.t === 'open-conversation' && data.conversation) {
        useStore.getState().enter(data.conversation)
      }
    }
    navigator.serviceWorker?.addEventListener('message', fromWorker)
    return () => navigator.serviceWorker?.removeEventListener('message', fromWorker)
  }, [status])

  return (
    <>
      {status === 'booting' && <div className="waking" aria-label="chargement" />}
      {status === 'out' && <Threshold />}
      {/* A phrase that will never be shown again comes before everything else. */}
      {status === 'in' && (keepsake ? <Keepsake /> : <Stage />)}
      <Notice />
    </>
  )
}
