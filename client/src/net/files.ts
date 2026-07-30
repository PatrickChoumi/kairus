import { apiUrl, getToken } from './api'
import type { Attachment } from './types'

/*
 * Sending a file.
 *
 * Images are shrunk in the browser before they leave it. A photograph from a
 * phone is several thousand pixels wide and a few megabytes; nobody reads it
 * at that size in a conversation, and uploading it whole costs the sender
 * their connection and the server its disk.
 */

const MAX_EDGE = 1600
const QUALITY = 0.82
/** Below this, re-encoding usually makes the file bigger, not smaller. */
const WORTH_SHRINKING = 200 * 1024

export const isImage = (type: string): boolean =>
  /^image\/(png|jpeg|gif|webp|avif)$/.test(type)

export type Prepared = {
  blob: Blob
  name: string
  type: string
  width: number | null
  height: number | null
  /** Seconds, for a voice message. */
  duration?: number
  /** 0…100 loudness samples: the shape to draw. */
  peaks?: number[]
}

export const isVoice = (type: string): boolean => type.startsWith('audio/')

const readImage = (file: Blob): Promise<HTMLImageElement | null> =>
  new Promise((resolve) => {
    const url = URL.createObjectURL(file)
    const image = new Image()
    image.onload = () => {
      URL.revokeObjectURL(url)
      resolve(image)
    }
    image.onerror = () => {
      URL.revokeObjectURL(url)
      resolve(null)
    }
    image.src = url
  })

/** Shrinks an oversized image and reports the dimensions either way. */
export async function prepare(file: File): Promise<Prepared> {
  const plain: Prepared = {
    blob: file,
    name: file.name,
    type: file.type || 'application/octet-stream',
    width: null,
    height: null,
  }
  // Animation would be flattened to a single frame by a canvas.
  if (!isImage(file.type) || file.type === 'image/gif') return plain

  const image = await readImage(file)
  if (!image) return plain

  const { naturalWidth: w, naturalHeight: h } = image
  const scale = Math.min(1, MAX_EDGE / Math.max(w, h))
  if (scale === 1 && file.size < WORTH_SHRINKING) {
    return { ...plain, width: w, height: h }
  }

  const canvas = document.createElement('canvas')
  canvas.width = Math.round(w * scale)
  canvas.height = Math.round(h * scale)
  const context = canvas.getContext('2d')
  if (!context) return { ...plain, width: w, height: h }
  context.drawImage(image, 0, 0, canvas.width, canvas.height)

  const shrunk = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, 'image/webp', QUALITY),
  )
  // If the re-encode is not actually smaller, send the original.
  if (!shrunk || shrunk.size >= file.size) return { ...plain, width: w, height: h }

  return {
    blob: shrunk,
    name: file.name.replace(/\.[^.]+$/, '') + '.webp',
    type: 'image/webp',
    width: canvas.width,
    height: canvas.height,
  }
}

export class UploadError extends Error {}

/** Uploads the bytes and returns what the message will carry. */
export async function upload(
  prepared: Prepared,
  onProgress?: (fraction: number) => void,
): Promise<Attachment> {
  const token = getToken()
  // XMLHttpRequest, not fetch: it is still the only way to watch an upload.
  return new Promise((resolve, reject) => {
    const request = new XMLHttpRequest()
    request.open('POST', apiUrl('/api/files'))
    request.setRequestHeader('content-type', prepared.type)
    request.setRequestHeader('x-file-name', encodeURIComponent(prepared.name))
    if (prepared.width) request.setRequestHeader('x-file-width', String(prepared.width))
    if (prepared.height) request.setRequestHeader('x-file-height', String(prepared.height))
    if (prepared.duration) request.setRequestHeader('x-file-duration', prepared.duration.toFixed(2))
    if (prepared.peaks?.length) request.setRequestHeader('x-file-peaks', prepared.peaks.join(','))
    if (token) request.setRequestHeader('authorization', `Bearer ${token}`)

    request.upload.onprogress = (event) => {
      if (event.lengthComputable) onProgress?.(event.loaded / event.total)
    }
    request.onload = () => {
      let payload: { attachment?: Attachment; error?: string } = {}
      try {
        payload = JSON.parse(request.responseText)
      } catch {
        /* an unreadable body is handled below */
      }
      if (request.status === 200 && payload.attachment) resolve(payload.attachment)
      else reject(new UploadError(payload.error ?? 'l’envoi a échoué'))
    }
    request.onerror = () => reject(new UploadError('le réseau ne répond pas'))
    request.onabort = () => reject(new UploadError('envoi interrompu'))
    request.send(prepared.blob)
  })
}

export const fileUrl = (id: string): string => apiUrl(`/api/files/${id}`)

/** Downloads through fetch so the session token can be presented. */
export async function keepFile(attachment: Attachment): Promise<void> {
  const token = getToken()
  const response = await fetch(fileUrl(attachment.id), {
    headers: token ? { authorization: `Bearer ${token}` } : {},
  })
  if (!response.ok) throw new UploadError('ce fichier n’est plus disponible')

  const blob = await response.blob()
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = attachment.name
  link.click()
  URL.revokeObjectURL(url)
}

export function readableSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} o`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} ko`
  return `${(bytes / (1024 * 1024)).toFixed(1)} Mo`
}
