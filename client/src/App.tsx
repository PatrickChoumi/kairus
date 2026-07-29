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
