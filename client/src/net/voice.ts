import type { Prepared } from './files'

/*
 * Voice messages.
 *
 * Recording is `MediaRecorder`, which every current browser has; the format is
 * whatever it offers, since we only ever hand it back to the same family of
 * decoders. What takes a little more work is the *shape*: a voice message that
 * draws as a flat bar tells you nothing, so once the recording stops we decode
 * it and reduce it to a few dozen loudness samples. Those travel with the
 * attachment, which is why the waveform is there before a byte of audio is.
 */

const BARS = 44
/** Long enough for a thought, short enough not to be a podcast. */
export const MAX_SECONDS = 300

/** Formats used in order of preference; the first one supported wins. */
const FORMATS = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus']

export const canRecord = (): boolean =>
  typeof MediaRecorder !== 'undefined' && Boolean(navigator.mediaDevices?.getUserMedia)

function pickFormat(): string | undefined {
  if (typeof MediaRecorder === 'undefined') return undefined
  return FORMATS.find((type) => MediaRecorder.isTypeSupported?.(type))
}

/**
 * Reduces a recording to `BARS` loudness samples.
 *
 * Root mean square rather than peak: a single click would otherwise flatten
 * everything around it. The result is normalised, so a quiet recording still
 * draws as a waveform instead of a line.
 */
async function shapeOf(blob: Blob): Promise<{ peaks: number[]; duration: number }> {
  const Ctor = window.AudioContext ?? (window as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
  if (!Ctor) return { peaks: [], duration: 0 }

  const context = new Ctor()
  try {
    const audio = await context.decodeAudioData(await blob.arrayBuffer())
    const samples = audio.getChannelData(0)
    const span = Math.max(1, Math.floor(samples.length / BARS))

    const rough: number[] = []
    for (let bar = 0; bar < BARS; bar += 1) {
      let sum = 0
      const start = bar * span
      const end = Math.min(start + span, samples.length)
      for (let i = start; i < end; i += 1) sum += (samples[i] ?? 0) ** 2
      rough.push(Math.sqrt(sum / Math.max(1, end - start)))
    }

    const loudest = Math.max(...rough, 1e-6)
    return {
      // A floor of 6 keeps a silence from drawing as nothing at all.
      peaks: rough.map((value) => Math.max(6, Math.round((value / loudest) * 100))),
      duration: audio.duration,
    }
  } catch {
    return { peaks: [], duration: 0 }
  } finally {
    void context.close()
  }
}

export class Recording {
  private chunks: Blob[] = []
  private recorder: MediaRecorder
  private stream: MediaStream
  private startedAt = Date.now()
  private stopped?: Promise<void>

  private constructor(stream: MediaStream, recorder: MediaRecorder) {
    this.stream = stream
    this.recorder = recorder
    recorder.ondataavailable = (event) => {
      if (event.data.size > 0) this.chunks.push(event.data)
    }
    recorder.start(250)
  }

  static async begin(): Promise<Recording> {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    })
    const type = pickFormat()
    const recorder = new MediaRecorder(stream, type ? { mimeType: type } : undefined)
    return new Recording(stream, recorder)
  }

  /** Seconds elapsed — read on every frame by the composer, so no allocation. */
  get elapsed(): number {
    return (Date.now() - this.startedAt) / 1000
  }

  private halt(): Promise<void> {
    if (!this.stopped) {
      this.stopped = new Promise<void>((resolve) => {
        if (this.recorder.state === 'inactive') return resolve()
        this.recorder.onstop = () => resolve()
        this.recorder.stop()
      }).finally(() => {
        for (const track of this.stream.getTracks()) track.stop()
      })
    }
    return this.stopped
  }

  /** Stops and throws the bytes away — the microphone is released either way. */
  async abandon(): Promise<void> {
    await this.halt()
    this.chunks = []
  }

  /** Stops and returns something ready to upload, or null if nothing was said. */
  async finish(): Promise<Prepared | null> {
    const held = this.elapsed
    await this.halt()
    if (this.chunks.length === 0) return null

    const type = (this.recorder.mimeType || 'audio/webm').split(';')[0] ?? 'audio/webm'
    const blob = new Blob(this.chunks, { type })
    if (blob.size < 1024) return null

    const shape = await shapeOf(blob)
    const seconds = shape.duration > 0.2 ? shape.duration : held
    if (seconds < 0.6) return null

    return {
      blob,
      name: `voix-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.${
        type.includes('mp4') ? 'm4a' : type.includes('ogg') ? 'ogg' : 'webm'
      }`,
      type,
      width: null,
      height: null,
      duration: seconds,
      peaks: shape.peaks,
    }
  }
}

/** `1:07`, the way every player writes it. */
export function clockOf(seconds: number): string {
  const whole = Math.max(0, Math.round(seconds))
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`
}

/** Falls back to a flat-ish shape when the browser could not decode its own recording. */
export function peaksOf(raw: string | null): number[] {
  if (!raw) return Array.from({ length: 24 }, (_, i) => 30 + ((i * 37) % 45))
  return raw
    .split(',')
    .map((part) => Number(part))
    .filter((n) => Number.isFinite(n))
}
