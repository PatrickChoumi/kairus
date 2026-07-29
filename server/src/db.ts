import Database from 'better-sqlite3'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { env } from './env.js'
import { log } from './log.js'

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
    created_at INTEGER NOT NULL,
    -- 'direct' is between two people and cannot gain a third; 'group' can.
    kind       TEXT NOT NULL DEFAULT 'direct',
    title      TEXT,
    created_by TEXT REFERENCES users(id) ON DELETE SET NULL
  );

  CREATE TABLE IF NOT EXISTS participants (
    conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    user_id         TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    last_read_at    INTEGER NOT NULL DEFAULT 0,
    -- Someone added today does not get to read last month.
    joined_at       INTEGER NOT NULL DEFAULT 0,
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

  CREATE TABLE IF NOT EXISTS blocks (
    blocker_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    blocked_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at INTEGER NOT NULL,
    PRIMARY KEY (blocker_id, blocked_id)
  );

  CREATE INDEX IF NOT EXISTS idx_blocks_blocked ON blocks (blocked_id);

  CREATE TABLE IF NOT EXISTS push_subscriptions (
    endpoint   TEXT PRIMARY KEY,
    user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    p256dh     TEXT NOT NULL,
    auth       TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    -- Cleared on every success; a subscription that keeps failing is dropped.
    failures   INTEGER NOT NULL DEFAULT 0
  );

  CREATE INDEX IF NOT EXISTS idx_push_user ON push_subscriptions (user_id);

  CREATE TABLE IF NOT EXISTS attachments (
    id          TEXT PRIMARY KEY,
    uploader_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    -- Null until the message carrying it is actually sent.
    message_id  TEXT REFERENCES messages(id) ON DELETE CASCADE,
    name        TEXT NOT NULL,
    mime        TEXT NOT NULL,
    size        INTEGER NOT NULL,
    width       INTEGER,
    height      INTEGER,
    created_at  INTEGER NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_attachments_message ON attachments (message_id);
  CREATE INDEX IF NOT EXISTS idx_attachments_orphans ON attachments (message_id, created_at);

  CREATE INDEX IF NOT EXISTS idx_messages_conversation
    ON messages (conversation_id, created_at DESC);
  CREATE INDEX IF NOT EXISTS idx_participants_user
    ON participants (user_id);
`)

/* --------------------------------------------------------------- migrations */

/**
 * Adds a column to a database created before it existed.
 *
 * Deliberately tolerant of losing the race: if two processes start together
 * during a deployment, both see the column missing and both try to add it.
 * The loser gets a duplicate-column error, which means the work is done.
 */
function ensureColumn(table: string, column: string, definition: string): void {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]
  if (columns.some((c) => c.name === column)) return
  try {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    if (!/duplicate column name/i.test(message)) throw error
  }
}

ensureColumn('users', 'token_version', 'INTEGER NOT NULL DEFAULT 0')
ensureColumn('users', 'recovery_hash', "TEXT NOT NULL DEFAULT ''")
ensureColumn('conversations', 'kind', "TEXT NOT NULL DEFAULT 'direct'")
ensureColumn('conversations', 'title', 'TEXT')
ensureColumn('conversations', 'created_by', 'TEXT')
ensureColumn('participants', 'joined_at', 'INTEGER NOT NULL DEFAULT 0')
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
    log.warn('search.index.unavailable', { error: String(error) })
    return false
  }
}

export const hasFullTextSearch = installSearchIndex()
