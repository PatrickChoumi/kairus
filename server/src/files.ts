import {
  copyFileSync,
  createReadStream,
  createWriteStream,
  mkdirSync,
  mkdtempSync,
  rmSync,
  statSync,
} from 'node:fs'
import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { pipeline } from 'node:stream/promises'
import type { IncomingMessage } from 'node:http'
import { db } from './db.js'
import { env } from './env.js'
import { log } from './log.js'

/*
 * Attachments.
 *
 * Files live on the volume, next to the database; only their description goes
 * into SQLite. A blob column would bloat every backup and every read of a
 * conversation, for something that is only ever fetched on its own.
 *
 * The security question here is not the upload, it is the *serving*: a file
 * someone else chose, served inline from your own origin, is a script
 * injection waiting to happen. Only a short list of image types is ever shown
 * in place; everything else is handed over as a download, with a type the
 * browser will not try to interpret.
 */

export const MAX_BYTES = Number(process.env.MAX_UPLOAD_BYTES ?? 8 * 1024 * 1024)

/** Types safe to render in place. Note what is missing: SVG carries scripts. */
const INLINE = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/avif'])

/**
 * Sound is served with its real type so `<audio>` can play it without a
 * download. An audio decoder is not a script host: none of these can carry
 * markup the browser would run with this origin's privileges.
 */
const AUDIBLE = new Set([
  'audio/webm',
  'audio/ogg',
  'audio/mpeg',
  'audio/mp4',
  'audio/aac',
  'audio/wav',
  'audio/x-wav',
])

export const isDisplayable = (mime: string): boolean => INLINE.has(mime)
export const isAudible = (mime: string): boolean => AUDIBLE.has(mime)

/**
 * Where the bytes live. Always a real directory — an in-memory database is
 * still a server that accepts uploads, and it must have somewhere to put them
 * rather than fail on the first one.
 */
const root =
  process.env.FILES_DIR?.trim() ||
  (env.dataDir === ':memory:'
    ? mkdtempSync(join(tmpdir(), 'kairus-files-'))
    : join(env.dataDir, 'files'))
mkdirSync(root, { recursive: true })

const pathOf = (id: string) => join(root, id)

export type Attachment = {
  id: string
  name: string
  mime: string
  size: number
  width: number | null
  height: number | null
  /** Seconds, for a voice message. */
  duration: number | null
  /** 0…100 loudness samples, comma-separated — the shape of the waveform. */
  peaks: string | null
}

type AttachmentRow = Attachment & { uploader_id: string; message_id: string | null }

const toAttachment = (r: AttachmentRow): Attachment => ({
  id: r.id,
  name: r.name,
  mime: r.mime,
  size: r.size,
  width: r.width,
  height: r.height,
  duration: r.duration,
  peaks: r.peaks,
})

/** At most 64 small integers. Anything else is not a waveform we drew. */
export function tamePeaks(raw: string | undefined): string | null {
  if (!raw) return null
  const values = raw
    .split(',')
    .slice(0, 64)
    .map((part) => Number(part.trim()))
    .filter((n) => Number.isFinite(n))
    .map((n) => Math.max(0, Math.min(100, Math.round(n))))
  return values.length > 0 ? values.join(',') : null
}

/** Keeps a filename printable without letting it name a path. */
export function tameName(raw: string): string {
  const base = raw.split(/[/\\]/).pop() ?? ''
  // Control characters can forge a header and hide the real extension.
  const cleaned = base
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .replace(/^\.+/, '')
    .trim()
  return (cleaned || 'fichier').slice(0, 120)
}

export class TooLarge extends Error {}

/**
 * Streams the body to disk, refusing as soon as it goes over the limit rather
 * than after having written the whole thing.
 */
export async function receive(
  req: IncomingMessage,
  uploaderId: string,
  meta: {
    name: string
    mime: string
    width: number | null
    height: number | null
    duration?: number | null
    peaks?: string | null
  },
): Promise<Attachment> {
  const id = randomUUID()
  const target = pathOf(id)
  let written = 0

  const guard = async function* (source: AsyncIterable<Buffer>) {
    for await (const chunk of source) {
      written += chunk.length
      if (written > MAX_BYTES) throw new TooLarge()
      yield chunk
    }
  }

  try {
    await pipeline(req, guard, createWriteStream(target))
  } catch (error) {
    rmSync(target, { force: true })
    throw error
  }

  if (written === 0) {
    rmSync(target, { force: true })
    throw new Error('empty file')
  }

  const row: AttachmentRow = {
    id,
    uploader_id: uploaderId,
    message_id: null,
    name: tameName(meta.name),
    mime: meta.mime,
    size: written,
    width: meta.width,
    height: meta.height,
    duration: meta.duration ?? null,
    peaks: meta.peaks ?? null,
  }
  db.prepare(
    `INSERT INTO attachments
       (id, uploader_id, message_id, name, mime, size, width, height, duration, peaks, created_at)
     VALUES
       (@id, @uploader_id, @message_id, @name, @mime, @size, @width, @height, @duration, @peaks, ?)`,
  ).run({ ...row }, Date.now())

  return toAttachment(row)
}

export function findAttachment(id: string): AttachmentRow | undefined {
  return db.prepare(`SELECT * FROM attachments WHERE id = ?`).get(id) as AttachmentRow | undefined
}

export function attachmentsOf(messageIds: string[]): Map<string, Attachment> {
  if (messageIds.length === 0) return new Map()
  const marks = messageIds.map(() => '?').join(',')
  const rows = db
    .prepare(`SELECT * FROM attachments WHERE message_id IN (${marks})`)
    .all(...messageIds) as AttachmentRow[]
  return new Map(rows.map((row) => [row.message_id as string, toAttachment(row)]))
}

export const attachmentOf = (messageId: string): Attachment | null => {
  const row = db.prepare(`SELECT * FROM attachments WHERE message_id = ?`).get(messageId) as
    | AttachmentRow
    | undefined
  return row ? toAttachment(row) : null
}

/**
 * Copies an attachment for a forward, bytes and all.
 *
 * Sharing one row between two messages would be cheaper, and wrong: retracting
 * either would erase the file under the other. A copy costs disk — bounded by
 * the upload limit — and keeps every message the sole owner of what it carries.
 */
export function duplicate(attachmentId: string, uploaderId: string): Attachment | null {
  const source = findAttachment(attachmentId)
  if (!source) return null

  const id = randomUUID()
  try {
    copyFileSync(pathOf(attachmentId), pathOf(id))
  } catch (error) {
    log.warn('attachment.copy.failed', { attachmentId, error: String(error) })
    return null
  }

  const row: AttachmentRow = { ...source, id, uploader_id: uploaderId, message_id: null }
  db.prepare(
    `INSERT INTO attachments
       (id, uploader_id, message_id, name, mime, size, width, height, duration, peaks, created_at)
     VALUES
       (@id, @uploader_id, @message_id, @name, @mime, @size, @width, @height, @duration, @peaks, ?)`,
  ).run({ ...row }, Date.now())
  return toAttachment(row)
}

/** Binds an upload to the message that carries it. Only its own uploader may. */
export function claim(attachmentId: string, uploaderId: string, messageId: string): boolean {
  const result = db
    .prepare(
      `UPDATE attachments SET message_id = ?
       WHERE id = ? AND uploader_id = ? AND message_id IS NULL`,
    )
    .run(messageId, attachmentId, uploaderId)
  return result.changes === 1
}

export function openAttachment(id: string): NodeJS.ReadableStream | null {
  try {
    statSync(pathOf(id))
  } catch {
    return null
  }
  return createReadStream(pathOf(id))
}

export function eraseAttachment(id: string): void {
  rmSync(pathOf(id), { force: true })
  db.prepare(`DELETE FROM attachments WHERE id = ?`).run(id)
}

/** A message taken back takes its file with it. */
export function eraseFor(messageId: string): void {
  const rows = db
    .prepare(`SELECT id FROM attachments WHERE message_id = ?`)
    .all(messageId) as { id: string }[]
  for (const row of rows) eraseAttachment(row.id)
}

const ORPHAN_AGE = 60 * 60_000

/** Uploads whose message was never sent. Without this they accumulate forever. */
export function sweepOrphans(now = Date.now()): number {
  const rows = db
    .prepare(`SELECT id FROM attachments WHERE message_id IS NULL AND created_at < ?`)
    .all(now - ORPHAN_AGE) as { id: string }[]
  for (const row of rows) eraseAttachment(row.id)
  if (rows.length) log.info('attachments.swept', { removed: rows.length })
  return rows.length
}

export function startFileSweeper(): () => void {
  const timer = setInterval(() => sweepOrphans(), ORPHAN_AGE)
  timer.unref?.()
  return () => clearInterval(timer)
}

/**
 * How a file should be handed over. Anything not on the inline list is served
 * as an opaque download — an HTML or SVG file rendered in place would run with
 * this origin's privileges.
 */
export function servingHeaders(
  attachment: Pick<Attachment, 'name' | 'mime' | 'size'>,
): Record<string, string> {
  const inline = isDisplayable(attachment.mime) || isAudible(attachment.mime)
  const filename = attachment.name.replace(/[^\w.\- ]/g, '_')
  return {
    'content-type': inline ? attachment.mime : 'application/octet-stream',
    'content-length': String(attachment.size),
    'content-disposition': `${inline ? 'inline' : 'attachment'}; filename="${filename}"`,
    // Minutes, not a year. An id never points at different bytes, so caching
    // is safe — but a message that was taken back must actually stop being
    // fetchable, and `immutable` would pin it on the device for good.
    'cache-control': 'private, max-age=300',
    'x-content-type-options': 'nosniff',
  }
}
