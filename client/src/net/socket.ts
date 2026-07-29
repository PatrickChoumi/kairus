import { socketUrl } from './api'
import type { Inbound } from './types'

export type Outbound =
  | { t: 'hello'; token: string }
  | { t: 'send'; conversation: string; body: string; replyTo: string | null; nonce: string }
  | { t: 'typing'; conversation: string }
  | { t: 'read'; conversation: string }

export type Link = 'offline' | 'reaching' | 'live'

type Listener = (message: Inbound) => void
type LinkListener = (link: Link) => void

const BACKOFF = [400, 900, 1800, 3500, 6000, 10000]

/**
 * The live link. It reconnects on its own and holds anything you send while
 * it is away, so the interface never has to think about the network.
 */
class Connection {
  private socket: WebSocket | null = null
  private token: string | null = null
  private attempt = 0
  private timer: number | null = null
  private outbox: Outbound[] = []
  private listeners = new Set<Listener>()
  private linkListeners = new Set<LinkListener>()
  private closedByUs = false

  link: Link = 'offline'

  open(token: string): void {
    this.token = token
    this.closedByUs = false
    this.dial()
  }

  close(): void {
    this.closedByUs = true
    this.token = null
    this.outbox = []
    if (this.timer) window.clearTimeout(this.timer)
    this.timer = null
    this.socket?.close()
    this.socket = null
    this.setLink('offline')
  }

  send(frame: Outbound): void {
    if (this.socket?.readyState === WebSocket.OPEN && this.link === 'live') {
      this.socket.send(JSON.stringify(frame))
      return
    }
    // Transient signals are worthless once late; durable ones are kept.
    if (frame.t === 'typing') return
    this.outbox.push(frame)
  }

  on(listener: Listener): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  onLink(listener: LinkListener): () => void {
    this.linkListeners.add(listener)
    listener(this.link)
    return () => this.linkListeners.delete(listener)
  }

  private setLink(link: Link): void {
    if (this.link === link) return
    this.link = link
    for (const listener of this.linkListeners) listener(link)
  }

  private dial(): void {
    if (!this.token || this.closedByUs) return
    this.setLink(this.attempt === 0 ? 'reaching' : this.link === 'live' ? 'reaching' : 'offline')

    const socket = new WebSocket(socketUrl())
    this.socket = socket

    socket.onopen = () => {
      if (this.token) socket.send(JSON.stringify({ t: 'hello', token: this.token }))
    }

    socket.onmessage = (event) => {
      let message: Inbound
      try {
        message = JSON.parse(String(event.data)) as Inbound
      } catch {
        return
      }
      if (message.t === 'ready') {
        this.attempt = 0
        this.setLink('live')
        const pending = this.outbox
        this.outbox = []
        for (const frame of pending) socket.send(JSON.stringify(frame))
      }
      for (const listener of this.listeners) listener(message)
    }

    socket.onclose = () => {
      if (this.socket === socket) this.socket = null
      this.setLink('offline')
      this.retry()
    }

    socket.onerror = () => socket.close()
  }

  private retry(): void {
    if (this.closedByUs || !this.token) return
    const wait = BACKOFF[Math.min(this.attempt, BACKOFF.length - 1)] ?? 10000
    this.attempt += 1
    // Jitter keeps a restarted server from being hit by every client at once.
    const delay = wait * (0.7 + Math.random() * 0.6)
    this.timer = window.setTimeout(() => this.dial(), delay)
  }

  /** Called when the tab wakes up: don't wait out the backoff. */
  nudge(): void {
    if (this.closedByUs || !this.token) return
    if (this.socket?.readyState === WebSocket.OPEN) return
    if (this.timer) window.clearTimeout(this.timer)
    this.attempt = 0
    this.dial()
  }
}

export const connection = new Connection()

if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') connection.nudge()
  })
  window.addEventListener('online', () => connection.nudge())
}
