import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import './styles/tokens.css'
import './styles/base.css'
import './styles/app.css'

const root = document.getElementById('root')
if (!root) throw new Error('missing #root')

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

/*
 * The service worker, and the one thing it must not do: leave someone looking
 * at a version that no longer exists.
 *
 * The worker calls `skipWaiting` and `clients.claim`, so a new one takes over
 * as soon as it is found. But the page already open keeps running the code it
 * loaded — which is how a deployment can go through and change nothing on
 * screen until someone thinks to hard-refresh. So: reload once when the
 * controller changes, and go looking for a new worker whenever the tab comes
 * back to the foreground, since this application is often left open for days.
 */
if ('serviceWorker' in navigator && import.meta.env.PROD) {
  const sw = navigator.serviceWorker
  // On a first visit there is no controller to change from, and the very
  // first claim would otherwise reload a page that is already current.
  const wasControlled = Boolean(sw.controller)
  let reloading = false

  sw.addEventListener('controllerchange', () => {
    if (!wasControlled || reloading) return
    reloading = true
    window.location.reload()
  })

  window.addEventListener('load', () => {
    void sw.register('/sw.js').then((registration) => {
      const look = () => {
        if (document.visibilityState === 'visible') void registration.update()
      }
      document.addEventListener('visibilitychange', look)
    })
  })
}
