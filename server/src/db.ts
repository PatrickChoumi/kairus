import initSqlJs from 'sql.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_PATH = path.join(__dirname, '..', 'kairus.db');

let db: any;
let saveTimeout: ReturnType<typeof setTimeout> | null = null;

function save() {
  if (saveTimeout) clearTimeout(saveTimeout);
  saveTimeout = setTimeout(() => {
    try { fs.writeFileSync(DB_PATH, Buffer.from(db.export())); } catch {}
  }, 1000);
}

export async function initDb() {
  const SQL = await initSqlJs();
  db = fs.existsSync(DB_PATH)
    ? new SQL.Database(fs.readFileSync(DB_PATH))
    : new SQL.Database();

  db.run('PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON');

  db.run(`CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY, phone TEXT UNIQUE NOT NULL, username TEXT UNIQUE,
    display_name TEXT NOT NULL, avatar TEXT, password_hash TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')))`);

  db.run(`CREATE TABLE IF NOT EXISTS chats (
    id TEXT PRIMARY KEY, type TEXT NOT NULL CHECK(type IN ('private','group')),
    title TEXT, avatar TEXT, created_by TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (created_by) REFERENCES users(id))`);

  db.run(`CREATE TABLE IF NOT EXISTS chat_members (
    chat_id TEXT NOT NULL, user_id TEXT NOT NULL,
    joined_at TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (chat_id, user_id),
    FOREIGN KEY (chat_id) REFERENCES chats(id) ON DELETE CASCADE,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE)`);

  db.run(`CREATE TABLE IF NOT EXISTS messages (
    id TEXT PRIMARY KEY, chat_id TEXT NOT NULL, sender_id TEXT NOT NULL,
    content TEXT, type TEXT NOT NULL DEFAULT 'text', media_path TEXT, media_type TEXT,
    reply_to TEXT, edited INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (chat_id) REFERENCES chats(id) ON DELETE CASCADE,
    FOREIGN KEY (sender_id) REFERENCES users(id))`);

  db.run(`CREATE TABLE IF NOT EXISTS contacts (
    user_id TEXT NOT NULL, contact_id TEXT NOT NULL, display_name TEXT,
    added_at TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (user_id, contact_id),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (contact_id) REFERENCES users(id) ON DELETE CASCADE)`);

  db.run(`CREATE TABLE IF NOT EXISTS reactions (
    message_id TEXT NOT NULL, user_id TEXT NOT NULL, emoji TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (message_id, user_id, emoji),
    FOREIGN KEY (message_id) REFERENCES messages(id) ON DELETE CASCADE,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE)`);

  db.run(`CREATE TABLE IF NOT EXISTS read_receipts (
    message_id TEXT NOT NULL, user_id TEXT NOT NULL,
    read_at TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (message_id, user_id),
    FOREIGN KEY (message_id) REFERENCES messages(id) ON DELETE CASCADE,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE)`);

  db.run('CREATE INDEX IF NOT EXISTS idx_messages_chat ON messages(chat_id, created_at)');
  db.run('CREATE INDEX IF NOT EXISTS idx_chat_members_user ON chat_members(user_id)');
  db.run('CREATE INDEX IF NOT EXISTS idx_reactions_message ON reactions(message_id)');
  db.run('CREATE INDEX IF NOT EXISTS idx_read_receipts_message ON read_receipts(message_id)');
  save();
}

export function all(sql: string, params: any[] = []): any[] {
  const stmt = db.prepare(sql);
  if (params.length) stmt.bind(params);
  const rows: any[] = [];
  while (stmt.step()) rows.push(stmt.getAsObject());
  stmt.free();
  return rows;
}

export function get(sql: string, params: any[] = []) {
  const rows = all(sql, params);
  return rows[0];
}

export function run(sql: string, params: any[] = []) {
  db.run(sql, params);
  save();
}

export function close() {
  if (saveTimeout) clearTimeout(saveTimeout);
  fs.writeFileSync(DB_PATH, Buffer.from(db.export()));
  db.close();
}
