import Database from 'better-sqlite3'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { env } from './env.js'

/** `:memory:` is a database that never touches the disk — used by the tests. */
const inMemory = env.dataDir === ':memory:'
if (!inMemory) mkdirSync(env.dataDir, { recursive: true })

export const db = new Database(inMemory ? ':memory:' : join(env.dataDir, 'kairus.db'))

db.pragma('journal_mode = WAL')
db.pragma('foreign_keys = ON')

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id            TEXT PRIMARY KEY,
    handle        TEXT NOT NULL UNIQUE,
    name          TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    hue           INTEGER NOT NULL,
    created_at    INTEGER NOT NULL,
    -- Bumped whenever every existing session must stop being accepted.
    token_version INTEGER NOT NULL DEFAULT 0,
    -- Hash of the one-time phrase that can take an account back.
    recovery_hash TEXT NOT NULL DEFAULT ''
  );

  CREATE TABLE IF NOT EXISTS conversations (
    id         TEXT PRIMARY KEY,
    created_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS participants (
    conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    user_id         TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    last_read_at    INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (conversation_id, user_id)
  );

  CREATE TABLE IF NOT EXISTS messages (
    id              TEXT PRIMARY KEY,
    conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    sender_id       TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    body            TEXT NOT NULL,
    reply_to        TEXT,
    created_at      INTEGER NOT NULL,
    edited_at       INTEGER,
    -- Retracting empties the body but keeps the row, so replies still resolve.
    deleted_at      INTEGER
  );

  CREATE INDEX IF NOT EXISTS idx_messages_conversation
    ON messages (conversation_id, created_at DESC);
  CREATE INDEX IF NOT EXISTS idx_participants_user
    ON participants (user_id);
`)

/* --------------------------------------------------------------- migrations */

/** Adds a column to a database created before it existed. */
function ensureColumn(table: string, column: string, definition: string): void {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]
  if (columns.some((c) => c.name === column)) return
  db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`)
}

ensureColumn('users', 'token_version', 'INTEGER NOT NULL DEFAULT 0')
ensureColumn('users', 'recovery_hash', "TEXT NOT NULL DEFAULT ''")
ensureColumn('messages', 'edited_at', 'INTEGER')
ensureColumn('messages', 'deleted_at', 'INTEGER')

/* ------------------------------------------------------------------ search */

const exists = (name: string): boolean =>
  !!db.prepare(`SELECT 1 FROM sqlite_master WHERE name = ?`).get(name)

/**
 * A real full-text index. `body LIKE '%term%'` cannot use an index at all, so
 * every keystroke in the Cursor would scan the whole message table. FTS5 is
 * compiled into the bundled SQLite, but if it ever is not, searching falls
 * back to the slow path rather than failing.
 */
function installSearchIndex(): boolean {
  try {
    const fresh = !exists('messages_fts')
    db.exec(`
      CREATE VIRTUAL TABLE IF NOT EXISTS messages_fts USING fts5(
        body,
        content='messages',
        content_rowid='rowid',
        tokenize="unicode61 remove_diacritics 2"
      );

      CREATE TRIGGER IF NOT EXISTS messages_fts_insert AFTER INSERT ON messages BEGIN
        INSERT INTO messages_fts(rowid, body) VALUES (new.rowid, new.body);
      END;

      CREATE TRIGGER IF NOT EXISTS messages_fts_delete AFTER DELETE ON messages BEGIN
        INSERT INTO messages_fts(messages_fts, rowid, body) VALUES ('delete', old.rowid, old.body);
      END;

      CREATE TRIGGER IF NOT EXISTS messages_fts_update AFTER UPDATE OF body ON messages BEGIN
        INSERT INTO messages_fts(messages_fts, rowid, body) VALUES ('delete', old.rowid, old.body);
        INSERT INTO messages_fts(rowid, body) VALUES (new.rowid, new.body);
      END;
    `)
    // A database that predates the index needs its existing messages indexed.
    if (fresh) db.exec(`INSERT INTO messages_fts(messages_fts) VALUES ('rebuild')`)
    return true
  } catch (error) {
    console.warn('[kairus] full-text search unavailable, falling back to scans:', error)
    return false
  }
}

export const hasFullTextSearch = installSearchIndex()
