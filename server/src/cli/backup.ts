/*
 * One-off backup, for a hand or a cron entry outside the process:
 *
 *   docker exec kairus node server/dist/cli/backup.js /data/backups
 */

import { prune, takeBackup } from '../backup.js'

const directory = process.argv[2] ?? process.env.BACKUP_DIR ?? 'backups'

try {
  const snapshot = await takeBackup(directory)
  const kept = prune(directory)
  console.log(
    `${snapshot.database}\n${snapshot.files} (${snapshot.blobs} file(s)${snapshot.copied ? ', copied' : ''})\n` +
      `${kept.length} snapshot(s) kept in ${directory}`,
  )
  process.exit(0)
} catch (error) {
  console.error('backup failed:', error)
  process.exit(1)
}
