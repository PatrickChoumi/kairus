import { copyFileSync, linkSync, mkdirSync, readdirSync, rmSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { db } from './db.js'
import { filesRoot } from './files.js'
import { log } from './log.js'

/*
 * Backups.
 *
 * The database is a single file on a single volume: if it goes, every
 * conversation goes with it. Copying it is not enough — in WAL mode the most
 * recent writes live in the sidecar file, so a plain copy can be torn.
 * SQLite's own backup API takes a consistent snapshot of a live database,
 * which is what this uses.
 *
 * And the database is only half of it. Every photograph and every voice
 * message is a file on disk that the database merely points at, so a snapshot
 * of the database alone restores into a conversation full of broken images —
 * arguably worse than an honest total loss, because it looks like it worked.
 *
 * The blobs are never rewritten once stored, so a snapshot takes hard links
 * rather than copies: the second backup of a gigabyte of photographs costs
 * kilobytes, and dropping an old snapshot only drops its links. The space
 * comes back when the last snapshot holding a blob goes. Across filesystems —
 * a backup directory on another mount, which is the good case for a backup —
 * links are impossible and the bytes are copied instead: slower, still right.
 */

const EVERY_MS = Number(process.env.BACKUP_EVERY_HOURS ?? 24) * 3_600_000
const KEEP = Number(process.env.BACKUP_KEEP ?? 7)
const PREFIX = 'kairus-'
const FILES_SUFFIX = '.files'

const stamp = () => new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)

export type Snapshot = {
  /** The database file. */
  database: string
  /** The directory holding this snapshot's attachments. */
  files: string
  /** How many attachments it holds. */
  blobs: number
  /** True when the bytes had to be copied because links were not possible. */
  copied: boolean
}

/**
 * Puts every attachment into `into`, by link where the filesystem allows it.
 * Returns how many, and whether it had to fall back to copying.
 */
function mirrorFiles(into: string): { blobs: number; copied: boolean } {
  const source = filesRoot()
  mkdirSync(into, { recursive: true })

  let names: string[]
  try {
    names = readdirSync(source)
  } catch {
    // No uploads yet. The empty directory stays, so a restore has somewhere
    // to land and the procedure does not change with the contents.
    return { blobs: 0, copied: false }
  }

  let blobs = 0
  let copied = false

  for (const name of names) {
    const from = join(source, name)
    // Whatever else lives here is not ours to snapshot.
    if (!statSync(from).isFile()) continue
    const to = join(into, name)
    try {
      linkSync(from, to)
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code
      if (code === 'EEXIST') {
        blobs += 1
        continue
      }
      // EXDEV: another mount. EPERM: a filesystem that refuses links.
      copyFileSync(from, to)
      copied = true
    }
    blobs += 1
  }

  return { blobs, copied }
}

/** Takes one consistent snapshot: the database, and the files it points at. */
export async function takeBackup(directory: string): Promise<Snapshot> {
  mkdirSync(directory, { recursive: true })
  const name = `${PREFIX}${stamp()}`
  const database = join(directory, `${name}.db`)
  const files = join(directory, `${name}${FILES_SUFFIX}`)

  /*
   * The files first, then the database. Taken the other way round, an upload
   * landing between the two would be recorded in the snapshot's database
   * without its bytes — a row pointing at nothing. This order can only produce
   * the opposite: a blob nobody references, which costs a little disk and
   * breaks nothing at all.
   */
  const mirrored = mirrorFiles(files)
  await db.backup(database)

  return { database, files, blobs: mirrored.blobs, copied: mirrored.copied }
}

/**
 * Keeps the newest `keep` snapshots and removes the rest, each with the files
 * that belong to it. Returns the names of the databases kept.
 */
export function prune(directory: string, keep = KEEP): string[] {
  const kept: string[] = []
  let entries: string[]
  try {
    entries = readdirSync(directory)
  } catch {
    return kept
  }

  const snapshots = entries
    .filter((name) => name.startsWith(PREFIX) && name.endsWith('.db'))
    .map((name) => ({ name, at: statSync(join(directory, name)).mtimeMs }))
    .sort((a, b) => b.at - a.at)

  const alive = new Set<string>()
  snapshots.forEach((snapshot, index) => {
    if (index < keep) {
      kept.push(snapshot.name)
      alive.add(snapshot.name.slice(0, -'.db'.length))
      return
    }
    rmSync(join(directory, snapshot.name), { force: true })
  })

  // Then the file directories, including any left orphaned by an interrupted
  // run: a snapshot without its database is not restorable, only expensive.
  for (const name of entries) {
    if (!name.startsWith(PREFIX) || !name.endsWith(FILES_SUFFIX)) continue
    if (alive.has(name.slice(0, -FILES_SUFFIX.length))) continue
    rmSync(join(directory, name), { recursive: true, force: true })
  }

  return kept
}

/**
 * Starts the schedule when BACKUP_DIR is set. A single-instance deployment has
 * no cron of its own, so the process carries its own — an unattended backup
 * that exists beats a documented one that nobody runs.
 */
export function startBackups(): () => void {
  const directory = process.env.BACKUP_DIR?.trim()
  if (!directory) return () => undefined

  const run = async () => {
    try {
      const snapshot = await takeBackup(directory)
      const kept = prune(directory)
      log.info('backup', {
        target: snapshot.database,
        blobs: snapshot.blobs,
        copied: snapshot.copied,
        kept: kept.length,
      })
    } catch (error) {
      // A failed backup must never take the server down with it.
      log.error('backup.failed', { error: error instanceof Error ? error.message : String(error) })
    }
  }

  // One at boot, so a fresh deployment is covered before the first interval.
  void run()
  const timer = setInterval(() => void run(), EVERY_MS)
  timer.unref?.()
  return () => clearInterval(timer)
}
