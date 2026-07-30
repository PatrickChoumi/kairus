import { connection } from './socket'
import type { CallAct } from './types'

/*
 * Voice calls.
 *
 * The audio goes straight from one browser to the other: the server carries
 * the introductions and nothing else. That is what WebRTC is for, and it is
 * also the only honest way to run calls on one small machine — a relayed call
 * costs bandwidth per minute per pair, a direct one costs nothing.
 *
 * Two browsers can still fail to find each other behind certain routers. STUN
 * covers most of it; the rest needs a relay the server would have to be told
 * about (`ICE_SERVERS`). When no path is found, the call ends saying so
 * rather than sitting in silence.
 */

export type CallState = 'ringing' | 'incoming' | 'live' | 'ended'

export type CallSnapshot = {
  id: string
  conversationId: string
  peerId: string
  /** Whether we placed it. */
  outgoing: boolean
  state: CallState
  muted: boolean
  /** When it was picked up, for the timer. */
  since: number | null
  /** Why it ended, when that is worth saying. */
  reason: string | null
}

/** How long a phone rings before giving up on the other side. */
const NO_ANSWER_MS = 45_000

const MIC = {
  audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
  video: false,
} as const

export const canCall = (): boolean =>
  typeof RTCPeerConnection !== 'undefined' && Boolean(navigator.mediaDevices?.getUserMedia)

type Report = (snapshot: CallSnapshot | null) => void

class Caller {
  private snapshot: CallSnapshot | null = null
  private pc: RTCPeerConnection | null = null
  private local: MediaStream | null = null
  private sink: HTMLAudioElement | null = null
  private ice: RTCIceServer[] = [{ urls: 'stun:stun.l.google.com:19302' }]
  /** An offer that arrived before it was accepted, and candidates before it. */
  private pendingOffer: RTCSessionDescriptionInit | null = null
  private earlyCandidates: RTCIceCandidateInit[] = []
  private giveUp: number | null = null
  private report: Report = () => undefined

  onChange(report: Report): void {
    this.report = report
  }

  /** The server tells us what to use when the socket says hello. */
  useIceServers(servers: RTCIceServer[] | undefined): void {
    if (servers?.length) this.ice = servers
  }

  get current(): CallSnapshot | null {
    return this.snapshot
  }

  private set(patch: Partial<CallSnapshot>): void {
    if (!this.snapshot) return
    this.snapshot = { ...this.snapshot, ...patch }
    this.report(this.snapshot)
  }

  private signal(act: CallAct, payload?: unknown): void {
    const call = this.snapshot
    if (!call) return
    connection.send({
      t: 'call',
      act,
      conversation: call.conversationId,
      call: call.id,
      payload,
    })
  }

  /* ------------------------------------------------------------- plumbing */

  private async wire(): Promise<RTCPeerConnection> {
    const pc = new RTCPeerConnection({ iceServers: this.ice })
    this.pc = pc

    this.local = await navigator.mediaDevices.getUserMedia(MIC)
    for (const track of this.local.getTracks()) pc.addTrack(track, this.local)

    pc.onicecandidate = (event) => {
      if (event.candidate) this.signal('ice', event.candidate.toJSON())
    }

    pc.ontrack = (event) => {
      const stream = event.streams[0]
      if (!stream) return
      const audio = this.sink ?? new Audio()
      this.sink = audio
      audio.autoplay = true
      audio.srcObject = stream
      void audio.play().catch(() => undefined)
    }

    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'connected' && this.snapshot?.state !== 'live') {
        this.clearTimer()
        this.set({ state: 'live', since: Date.now() })
      }
      if (pc.connectionState === 'failed') {
        this.finish('aucun chemin entre les deux appareils', true)
      }
    }

    return pc
  }

  private clearTimer(): void {
    if (this.giveUp !== null) window.clearTimeout(this.giveUp)
    this.giveUp = null
  }

  private teardown(): void {
    this.clearTimer()
    for (const track of this.local?.getTracks() ?? []) track.stop()
    this.local = null
    this.pc?.close()
    this.pc = null
    if (this.sink) {
      this.sink.pause()
      this.sink.srcObject = null
      this.sink = null
    }
    this.pendingOffer = null
    this.earlyCandidates = []
  }

  /** Ends the call locally, telling the other side unless they told us first. */
  private finish(reason: string | null, tell: boolean): void {
    if (!this.snapshot) return
    if (tell) this.signal('end')
    this.teardown()
    this.set({ state: 'ended', reason })
    const ending = this.snapshot
    // The overlay lingers for a moment so the reason can be read.
    window.setTimeout(() => {
      if (this.snapshot === ending) {
        this.snapshot = null
        this.report(null)
      }
    }, 1600)
  }

  /* -------------------------------------------------------------- placing */

  async place(conversationId: string, peerId: string): Promise<void> {
    if (this.snapshot) return
    this.snapshot = {
      id: crypto.randomUUID(),
      conversationId,
      peerId,
      outgoing: true,
      state: 'ringing',
      muted: false,
      since: null,
      reason: null,
    }
    this.report(this.snapshot)

    try {
      const pc = await this.wire()
      const offer = await pc.createOffer()
      await pc.setLocalDescription(offer)
      this.signal('ring', offer)
      this.giveUp = window.setTimeout(() => this.finish('pas de réponse', true), NO_ANSWER_MS)
    } catch {
      this.finish('le micro n’est pas accessible', true)
    }
  }

  /* ------------------------------------------------------------- answering */

  async accept(): Promise<void> {
    const call = this.snapshot
    if (!call || call.state !== 'incoming' || !this.pendingOffer) return
    try {
      const pc = await this.wire()
      await pc.setRemoteDescription(this.pendingOffer)
      this.pendingOffer = null
      for (const candidate of this.earlyCandidates) {
        await pc.addIceCandidate(candidate).catch(() => undefined)
      }
      this.earlyCandidates = []

      const answer = await pc.createAnswer()
      await pc.setLocalDescription(answer)
      this.signal('accept', answer)
      this.clearTimer()
      // `connected` normally follows within a second; this is the fallback.
      this.set({ state: 'live', since: Date.now() })
    } catch {
      this.finish('le micro n’est pas accessible', true)
    }
  }

  decline(): void {
    if (!this.snapshot) return
    this.signal('decline')
    this.teardown()
    this.snapshot = null
    this.report(null)
  }

  hangUp(): void {
    if (!this.snapshot) return
    if (this.snapshot.state === 'incoming') return this.decline()
    this.finish(null, true)
  }

  toggleMute(): void {
    const call = this.snapshot
    if (!call || !this.local) return
    const muted = !call.muted
    for (const track of this.local.getAudioTracks()) track.enabled = !muted
    this.set({ muted })
  }

  /* --------------------------------------------------------------- inbound */

  async receive(frame: {
    act: CallAct
    conversation: string
    call: string
    from: string
    payload?: unknown
  }): Promise<void> {
    const call = this.snapshot

    if (frame.act === 'ring') {
      // Already on one: tell them so rather than let it ring into nothing.
      if (call) {
        connection.send({
          t: 'call',
          act: 'busy',
          conversation: frame.conversation,
          call: frame.call,
        })
        return
      }
      this.pendingOffer = frame.payload as RTCSessionDescriptionInit
      this.snapshot = {
        id: frame.call,
        conversationId: frame.conversation,
        peerId: frame.from,
        outgoing: false,
        state: 'incoming',
        muted: false,
        since: null,
        reason: null,
      }
      this.report(this.snapshot)
      this.giveUp = window.setTimeout(() => {
        if (this.snapshot?.state === 'incoming') this.finish('appel manqué', false)
      }, NO_ANSWER_MS)
      return
    }

    // Anything else is only meaningful for the call actually in progress.
    if (!call || frame.call !== call.id) return

    switch (frame.act) {
      case 'accept': {
        if (!this.pc) return
        await this.pc
          .setRemoteDescription(frame.payload as RTCSessionDescriptionInit)
          .catch(() => undefined)
        for (const candidate of this.earlyCandidates) {
          await this.pc.addIceCandidate(candidate).catch(() => undefined)
        }
        this.earlyCandidates = []
        this.clearTimer()
        this.set({ state: 'live', since: Date.now() })
        break
      }
      case 'ice': {
        const candidate = frame.payload as RTCIceCandidateInit
        if (!candidate) return
        if (this.pc?.remoteDescription) {
          await this.pc.addIceCandidate(candidate).catch(() => undefined)
        } else {
          this.earlyCandidates.push(candidate)
        }
        break
      }
      case 'decline':
        this.finish('appel refusé', false)
        break
      case 'busy':
        this.finish('déjà en ligne', false)
        break
      case 'end':
        this.finish(call.state === 'ringing' ? 'personne n’a répondu' : null, false)
        break
    }
  }

  /** The link died mid-call: there is nothing left to negotiate over. */
  dropped(): void {
    if (this.snapshot) this.finish('connexion perdue', false)
  }
}

export const caller = new Caller()
