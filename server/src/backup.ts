import { mkdirSync, readdirSync, rmSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { db } from './db.js'

/*
 * Backups.
 *
 * The database is a single file on a single volume: if it goes, every
 * conversation goes with it. Copying it is not enough — in WAL mode the most
 * recent writes live in the sidecar file, so a plain copy can be torn.
 * SQLite's own backup API takes a consistent snapshot of a live database,
 * which is what this uses.
 */

const EVERY_MS = Number(process.env.BACKUP_EVERY_HOURS ?? 24) * 3_600_000
const KEEP = Number(process.env.BACKUP_KEEP ?? 7)
const PREFIX = 'kairus-'

const stamp = () => new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)

/** Takes one consistent snapshot. Returns where it landed. */
export async function takeBackup(directory: string): Promise<string> {
  mkdirSync(directory, { recursive: true })
  const target = join(directory, `${PREFIX}${stamp()}.db`)
  await db.backup(target)
  return target
}

/** Keeps the newest `KEEP` snapshots and removes the rest. */
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

  snapshots.forEach((snapshot, index) => {
    if (index < keep) {
      kept.push(snapshot.name)
      return
    }
    rmSync(join(directory, snapshot.name), { force: true })
  })
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
      const target = await takeBackup(directory)
      const kept = prune(directory)
      console.log(`[kairus] backup ${target} (${kept.length} kept)`)
    } catch (error) {
      // A failed backup must never take the server down with it.
      console.error('[kairus] backup failed:', error)
    }
  }

  // One at boot, so a fresh deployment is covered before the first interval.
  void run()
  const timer = setInterval(() => void run(), EVERY_MS)
  timer.unref?.()
  return () => clearInterval(timer)
}
