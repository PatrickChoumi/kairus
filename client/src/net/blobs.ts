import { useEffect, useState } from 'react'
import { fileUrl } from './files'
import { getToken } from './api'

/*
 * An <img> cannot carry an Authorization header, and a token in the URL would
 * end up in browser history and server logs. So the bytes are fetched with the
 * session, and handed to the image as an object URL.
 *
 * The cache is what makes that affordable: scrolling back through a thread
 * must not re-download everything it passes.
 */

const LIMIT = 60
const held = new Map<string, Promise<string>>()

const evictOldest = () => {
  while (held.size > LIMIT) {
    const oldest = held.keys().next()
    if (oldest.done) return
    const pending = held.get(oldest.value)
    held.delete(oldest.value)
    void pending?.then((url) => URL.revokeObjectURL(url)).catch(() => undefined)
  }
}

export function fetchAttachment(id: string): Promise<string> {
  const existing = held.get(id)
  if (existing) return existing

  const token = getToken()
  const pending = fetch(fileUrl(id), {
    headers: token ? { authorization: `Bearer ${token}` } : {},
  })
    .then(async (response) => {
      if (!response.ok) throw new Error(String(response.status))
      return URL.createObjectURL(await response.blob())
    })
    .catch((error) => {
      // A failure must not be cached, or a blip would be permanent.
      held.delete(id)
      throw error
    })

  held.set(id, pending)
  evictOldest()
  return pending
}

export type BlobState = { url: string | null; failed: boolean }

/** Resolves an attachment to something an <img> can use. */
export function useAttachment(id: string | null): BlobState {
  const [state, setState] = useState<BlobState>({ url: null, failed: false })

  useEffect(() => {
    if (!id) {
      setState({ url: null, failed: false })
      return
    }
    let live = true
    setState({ url: null, failed: false })
    fetchAttachment(id)
      .then((url) => live && setState({ url, failed: false }))
      .catch(() => live && setState({ url: null, failed: true }))
    return () => {
      live = false
    }
  }, [id])

  return state
}

/** Drops one picture — what a retraction has to do on every screen showing it. */
export function forgetAttachment(id: string): void {
  const pending = held.get(id)
  if (!pending) return
  held.delete(id)
  void pending.then((url) => URL.revokeObjectURL(url)).catch(() => undefined)
}

/** Test seam, and what a sign-out should do to someone else's pictures. */
export function forgetAttachments(): void {
  for (const pending of held.values()) {
    void pending.then((url) => URL.revokeObjectURL(url)).catch(() => undefined)
  }
  held.clear()
}
