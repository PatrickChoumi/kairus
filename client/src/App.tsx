import { useEffect } from 'react'
import { useStore } from './state/store'
import { Threshold } from './views/Threshold'
import { Stage } from './views/Stage'
import { Notice } from './ui/Notice'

export function App() {
  const status = useStore((s) => s.status)
  const theme = useStore((s) => s.theme)
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
      {status === 'in' && <Stage />}
      <Notice />
    </>
  )
}
