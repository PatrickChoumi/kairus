import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import { v4 as uuid } from 'uuid';
import multer from 'multer';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
import rateLimit from 'express-rate-limit';
import { initDb, all, get, run } from './db.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const JWT_SECRET: string = process.env.JWT_SECRET || (() => { throw new Error('FATAL: JWT_SECRET not set'); })();
const CORS_ORIGIN = process.env.CORS_ORIGIN || 'http://localhost:5173';
const PORT = parseInt(process.env.PORT || '3001');

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, { cors: { origin: CORS_ORIGIN, methods: ['GET', 'POST'] } });

app.set('trust proxy', 1);
app.use(cors({ origin: CORS_ORIGIN }));
app.use(express.json({ limit: '10mb' }));

const uploadsDir = process.env.UPLOADS_DIR || path.join(__dirname, '..', 'uploads');
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });
app.use('/uploads', express.static(uploadsDir));

const upload = multer({
  storage: multer.diskStorage({
    destination: (_r, _f, cb) => cb(null, uploadsDir),
    filename: (_r, f, cb) => cb(null, `${uuid()}${path.extname(f.originalname)}`),
  }),
  limits: { fileSize: 50 * 1024 * 1024 },
  fileFilter: (_r, f, cb) => {
    const allowed = /\.(jpg|jpeg|png|gif|webp|mp4|mov|avi|pdf|doc|docx|txt|zip|webm)$/i;
    cb(null, allowed.test(path.extname(f.originalname)));
  },
});

/* ─── Types ─── */
interface User { id: string; phone: string; username?: string; display_name: string; avatar?: string; }
interface AuthReq extends express.Request { user?: User; }

/* ─── Auth helpers ─── */
function getUser(token: string): User | null {
  try {
    const p = jwt.verify(token, JWT_SECRET!) as unknown as { userId: string };
    return get('SELECT id, phone, username, display_name, avatar FROM users WHERE id = ?', [p.userId]) || null;
  } catch { return null; }
}

function auth(req: any, res: express.Response, next: express.NextFunction) {
  const user = getUser(req.headers.authorization?.split(' ')[1]);
  if (!user) return res.status(401).json({ error: 'Unauthorized' });
  req.user = user;
  next();
}

function validate(body: any, fields: string[]): string | null {
  for (const f of fields) { if (!body[f] || typeof body[f] !== 'string' || !body[f].trim()) return `${f} is required`; }
  return null;
}

/* ─── API Rate Limiting ─── */
const authLimiter = rateLimit({ windowMs: 60_000, max: 10, message: { error: 'Too many attempts' } });
const apiLimiter = rateLimit({ windowMs: 60_000, max: 200, message: { error: 'Rate limited' } });
app.use('/api/auth', authLimiter);
app.use('/api/', apiLimiter);

/* ─── Error handler ─── */
app.use((err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error(err);
  res.status(500).json({ error: 'Internal error' });
});

/* ─── Routes ─── */
app.get('/health', (_req, res) => res.json({ ok: true, timestamp: new Date().toISOString() }));

app.post('/api/auth/register', (req, res) => {
  const err = validate(req.body, ['phone', 'password', 'display_name']);
  if (err) return res.status(400).json({ error: err });
  const { phone, password, display_name } = req.body;
  if (password.length < 6) return res.status(400).json({ error: 'Password too short (min 6)' });
  if (get('SELECT id FROM users WHERE phone = ?', [phone])) return res.status(409).json({ error: 'Phone exists' });
  const id = uuid();
  run('INSERT INTO users (id, phone, display_name, password_hash) VALUES (?,?,?,?)', [id, phone, display_name, bcrypt.hashSync(password, 12)]);
  const token = jwt.sign({ userId: id }, JWT_SECRET, { expiresIn: '7d' });
  const refreshToken = jwt.sign({ userId: id, type: 'refresh' }, JWT_SECRET, { expiresIn: '30d' });
  res.json({ token, refreshToken, user: { id, phone, display_name } });
});

app.post('/api/auth/login', (req, res) => {
  const err = validate(req.body, ['phone', 'password']);
  if (err) return res.status(400).json({ error: err });
  const { phone, password } = req.body;
  const user = get('SELECT * FROM users WHERE phone = ?', [phone]);
  if (!user || !bcrypt.compareSync(password, user.password_hash)) return res.status(401).json({ error: 'Invalid credentials' });
  const token = jwt.sign({ userId: user.id }, JWT_SECRET, { expiresIn: '7d' });
  const refreshToken = jwt.sign({ userId: user.id, type: 'refresh' }, JWT_SECRET, { expiresIn: '30d' });
  res.json({ token, refreshToken, user: { id: user.id, phone: user.phone, username: user.username, display_name: user.display_name, avatar: user.avatar } });
});

app.post('/api/auth/refresh', (req, res) => {
  const { refreshToken } = req.body;
  if (!refreshToken) return res.status(400).json({ error: 'Missing refreshToken' });
  try {
    const p = jwt.verify(refreshToken, JWT_SECRET) as { userId: string; type: string };
    if (p.type !== 'refresh') return res.status(401).json({ error: 'Invalid token type' });
    const user = get('SELECT id, phone, username, display_name, avatar FROM users WHERE id = ?', [p.userId]);
    if (!user) return res.status(401).json({ error: 'User not found' });
    const token = jwt.sign({ userId: user.id }, JWT_SECRET, { expiresIn: '7d' });
    res.json({ token });
  } catch { return res.status(401).json({ error: 'Invalid token' }); }
});

app.get('/api/users/me', auth, (req: any, res) => res.json(req.user));

app.put('/api/users/me', auth, (req: any, res) => {
  const { display_name, username, avatar } = req.body;
  if (display_name) run('UPDATE users SET display_name=? WHERE id=?', [display_name, req.user.id]);
  if (username !== undefined) {
    if (get('SELECT id FROM users WHERE username=? AND id!=?', [username, req.user.id])) return res.status(409).json({ error: 'Username taken' });
    run('UPDATE users SET username=? WHERE id=?', [username, req.user.id]);
  }
  if (avatar !== undefined) run('UPDATE users SET avatar=? WHERE id=?', [avatar, req.user.id]);
  const updated = get('SELECT id, phone, username, display_name, avatar FROM users WHERE id=?', [req.user.id]);
  res.json(updated);
});

app.get('/api/users/search', auth, (req: any, res) => {
  const q = (req.query.q as string || '').trim();
  if (!q) return res.json([]);
  res.json(all("SELECT id, phone, username, display_name, avatar FROM users WHERE (display_name LIKE ? OR username LIKE ?) AND id != ? LIMIT 20", [`%${q}%`, `%${q}%`, req.user.id]));
});

/* ─── Chats ─── */
app.get('/api/chats', auth, (req: any, res) => {
  const chats = all(`SELECT c.*,
    (SELECT content FROM messages WHERE chat_id=c.id ORDER BY created_at DESC LIMIT 1) last_message,
    (SELECT created_at FROM messages WHERE chat_id=c.id ORDER BY created_at DESC LIMIT 1) last_message_time,
    (SELECT COUNT(*) FROM messages WHERE chat_id=c.id AND sender_id!=? AND id NOT IN (SELECT message_id FROM read_receipts WHERE user_id=?)) unread_count
    FROM chats c JOIN chat_members cm ON c.id=cm.chat_id WHERE cm.user_id=?
    ORDER BY last_message_time DESC`, [req.user.id, req.user.id, req.user.id]);
  res.json(chats.map(c => {
    const members = all('SELECT u.id,u.display_name,u.username,u.avatar FROM chat_members cm JOIN users u ON u.id=cm.user_id WHERE cm.chat_id=?', [c.id]);
    return { ...c, members, title: c.type === 'private' ? (members.find((m: any) => m.id !== req.user.id)?.display_name || 'Unknown') : c.title };
  }));
});

app.post('/api/chats', auth, (req: any, res) => {
  const { type, userId, title } = req.body;
  if (type === 'private' && userId) {
    const ex = get('SELECT c.id FROM chats c JOIN chat_members a ON a.chat_id=c.id AND a.user_id=? JOIN chat_members b ON b.chat_id=c.id AND b.user_id=? WHERE c.type=\'private\'', [req.user.id, userId]);
    if (ex) return res.json({ chatId: ex.id });
    const id = uuid();
    run('INSERT INTO chats (id,type,created_by) VALUES (?,?,?)', [id, 'private', req.user.id]);
    run('INSERT INTO chat_members (chat_id,user_id) VALUES (?,?),(?,?)', [id, req.user.id, id, userId]);
    return res.json({ chatId: id });
  }
  if (type === 'group') {
    const id = uuid();
    run('INSERT INTO chats (id,type,title,created_by) VALUES (?,?,?,?)', [id, 'group', title || 'Group', req.user.id]);
    run('INSERT INTO chat_members (chat_id,user_id) VALUES (?,?)', [id, req.user.id]);
    return res.json({ chatId: id, needsMembers: true });
  }
  res.status(400).json({ error: 'Invalid' });
});

app.post('/api/chats/:chatId/members', auth, (req: any, res) => {
  const { userId } = req.body;
  if (!userId) return res.status(400).json({ error: 'userId required' });
  const chat = get('SELECT * FROM chats WHERE id=?', [req.params.chatId]);
  if (!chat) return res.status(404).json({ error: 'Chat not found' });
  const isMember = get('SELECT * FROM chat_members WHERE chat_id=? AND user_id=?', [req.params.chatId, req.user.id]);
  if (!isMember) return res.status(403).json({ error: 'Not a member' });
  const already = get('SELECT * FROM chat_members WHERE chat_id=? AND user_id=?', [req.params.chatId, userId]);
  if (already) return res.json({ ok: true });
  run('INSERT INTO chat_members (chat_id,user_id) VALUES (?,?)', [req.params.chatId, userId]);
  io.to(req.params.chatId).emit('member_added', { chatId: req.params.chatId, userId });
  const otherSockets = onlineUsers.get(userId);
  if (otherSockets?.size) otherSockets.forEach(sid => { io.sockets.sockets.get(sid)?.join(req.params.chatId); });
  res.json({ ok: true });
});

app.delete('/api/chats/:chatId/members/:userId', auth, (req: any, res) => {
  run('DELETE FROM chat_members WHERE chat_id=? AND user_id=?', [req.params.chatId, req.params.userId]);
  io.to(req.params.chatId).emit('member_removed', { chatId: req.params.chatId, userId: req.params.userId });
  res.json({ ok: true });
});

app.get('/api/chats/:chatId', auth, (req: any, res) => {
  const chat = get('SELECT * FROM chats WHERE id=?', [req.params.chatId]);
  if (!chat) return res.status(404).json({ error: 'Not found' });
  const members = all('SELECT u.id,u.display_name,u.username,u.avatar FROM users u JOIN chat_members cm ON u.id=cm.user_id WHERE cm.chat_id=?', [req.params.chatId]);
  res.json({ ...chat, members, title: chat.type === 'private' ? (members.find((m: any) => m.id !== req.user.id)?.display_name || 'Unknown') : chat.title });
});

/* ─── Messages ─── */
app.get('/api/chats/:chatId/messages', auth, (req, res) => {
  const offset = parseInt(req.query.offset as string) || 0;
  const limit = Math.min(parseInt(req.query.limit as string) || 50, 100);
  const msgs = all(`SELECT m.*, u.display_name sender_name, u.username sender_username, u.avatar sender_avatar
    FROM messages m JOIN users u ON u.id=m.sender_id WHERE m.chat_id=?
    ORDER BY m.created_at DESC LIMIT ? OFFSET ?`, [req.params.chatId, limit, offset]);
  const enriched = msgs.reverse().map((m: any) => {
    const reactions = all('SELECT emoji, user_id FROM reactions WHERE message_id=?', [m.id]);
    const readBy = all('SELECT user_id FROM read_receipts WHERE message_id=?', [m.id]).map((r: any) => r.user_id);
    let replyPreview = null;
    if (m.reply_to) {
      const reply = get('SELECT id, content, sender_id, media_path FROM messages WHERE id=?', [m.reply_to]);
      if (reply) {
        const replySender = get('SELECT display_name FROM users WHERE id=?', [reply.sender_id]);
        replyPreview = { id: reply.id, content: reply.media_path ? '📷 Photo' : reply.content, senderName: replySender?.display_name || 'Unknown' };
      }
    }
    return { ...m, reactions, readBy, replyPreview };
  });
  res.json(enriched);
});

app.post('/api/chats/:chatId/messages', auth, (req: any, res) => {
  const { content, replyTo, mediaPath, mediaType } = req.body;
  if (!content && !mediaPath) return res.status(400).json({ error: 'Content or media required' });
  const id = uuid();
  const type = mediaPath ? 'image' : 'text';
  run('INSERT INTO messages (id,chat_id,sender_id,content,type,media_path,media_type,reply_to) VALUES (?,?,?,?,?,?,?,?)',
    [id, req.params.chatId, req.user.id, content || null, type, mediaPath || null, mediaType || null, replyTo || null]);
  const msg = get('SELECT m.*, u.display_name sender_name, u.username sender_username, u.avatar sender_avatar FROM messages m JOIN users u ON u.id=m.sender_id WHERE m.id=?', [id]);
  io.to(req.params.chatId).emit('new_message', msg);
  res.json(msg);
});

app.put('/api/messages/:id', auth, (req: any, res) => {
  const msg = get('SELECT * FROM messages WHERE id=? AND sender_id=?', [req.params.id, req.user.id]);
  if (!msg) return res.status(404).json({ error: 'Not found' });
  run('UPDATE messages SET content=?,edited=1,updated_at=datetime(\'now\') WHERE id=?', [req.body.content, req.params.id]);
  const updated = get('SELECT m.*,u.display_name sender_name,u.username sender_username,u.avatar sender_avatar FROM messages m JOIN users u ON u.id=m.sender_id WHERE m.id=?', [req.params.id]);
  io.to(msg.chat_id).emit('edit_message', updated);
  res.json(updated);
});

app.delete('/api/messages/:id', auth, (req: any, res) => {
  const msg = get('SELECT * FROM messages WHERE id=? AND sender_id=?', [req.params.id, req.user.id]);
  if (!msg) return res.status(404).json({ error: 'Not found' });
  run('DELETE FROM messages WHERE id=?', [req.params.id]);
  io.to(msg.chat_id).emit('delete_message', { id: req.params.id, chat_id: msg.chat_id });
  res.json({ ok: true });
});

/* ─── Read receipts ─── */
app.post('/api/chats/:chatId/read', auth, (req: any, res) => {
  const { messageIds } = req.body;
  if (!messageIds?.length) return res.json({ ok: true });
  const stmt = `INSERT OR IGNORE INTO read_receipts (message_id, user_id) VALUES ${messageIds.map(() => '(?,?)').join(',')}`;
  const params: string[] = [];
  messageIds.forEach((id: string) => { params.push(id, req.user.id); });
  run(stmt, params);
  res.json({ ok: true });
});

/* ─── Reactions ─── */
app.post('/api/messages/:id/reactions', auth, (req: any, res) => {
  const { emoji } = req.body;
  if (!emoji) return res.status(400).json({ error: 'Emoji required' });
  const msg = get('SELECT * FROM messages WHERE id=?', [req.params.id]);
  if (!msg) return res.status(404).json({ error: 'Message not found' });
  const existing = get('SELECT * FROM reactions WHERE message_id=? AND user_id=? AND emoji=?', [req.params.id, req.user.id, emoji]);
  if (existing) {
    run('DELETE FROM reactions WHERE message_id=? AND user_id=? AND emoji=?', [req.params.id, req.user.id, emoji]);
  } else {
    run('INSERT INTO reactions (message_id,user_id,emoji) VALUES (?,?,?)', [req.params.id, req.user.id, emoji]);
  }
  const reactions = all('SELECT emoji, user_id FROM reactions WHERE message_id=?', [req.params.id]);
  io.to(msg.chat_id).emit('reaction_updated', { messageId: req.params.id, reactions });
  res.json({ reactions });
});

/* ─── Message search ─── */
app.get('/api/messages/search', auth, (req: any, res) => {
  const q = (req.query.q as string || '').trim();
  if (!q) return res.json([]);
  const chatId = req.query.chatId as string;
  let sql = `SELECT m.*, u.display_name sender_name, u.username sender_username, u.avatar sender_avatar,
    c.title chat_title, c.type chat_type
    FROM messages m JOIN users u ON u.id=m.sender_id JOIN chats c ON c.id=m.chat_id
    JOIN chat_members cm ON cm.chat_id=m.chat_id AND cm.user_id=?
    WHERE m.content LIKE ?`;
  const params: any[] = [req.user.id, `%${q}%`];
  if (chatId) { sql += ' AND m.chat_id=?'; params.push(chatId); }
  sql += ' ORDER BY m.created_at DESC LIMIT 30';
  res.json(all(sql, params));
});

/* ─── Media ─── */
app.post('/api/media/upload', auth, upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file' });
  res.json({ path: `/uploads/${req.file.filename}`, type: req.file.mimetype, size: req.file.size, name: req.file.originalname });
});

/* ─── Contacts ─── */
app.get('/api/contacts', auth, (req: any, res) => {
  res.json(all('SELECT c.*,u.display_name,u.username,u.avatar,u.phone FROM contacts c JOIN users u ON u.id=c.contact_id WHERE c.user_id=?', [req.user.id]));
});

app.post('/api/contacts', auth, (req: any, res) => {
  run('INSERT OR IGNORE INTO contacts (user_id,contact_id,display_name) VALUES (?,?,?)', [req.user.id, req.body.contactId, req.body.displayName || null]);
  res.json({ ok: true });
});

app.delete('/api/contacts/:contactId', auth, (req: any, res) => {
  run('DELETE FROM contacts WHERE user_id=? AND contact_id=?', [req.user.id, req.params.contactId]);
  res.json({ ok: true });
});

/* ─── Socket.IO ─── */
const onlineUsers = new Map<string, Set<string>>();

io.use((socket, next) => {
  const user = getUser(socket.handshake.auth.token);
  if (!user) return next(new Error('Unauthorized'));
  socket.data.user = user;
  next();
});

io.on('connection', (socket) => {
  const user = socket.data.user as User;
  const uid = user.id;

  if (!onlineUsers.has(uid)) onlineUsers.set(uid, new Set());
  onlineUsers.get(uid)!.add(socket.id);
  all('SELECT chat_id FROM chat_members WHERE user_id=?', [uid]).forEach((r: any) => socket.join(r.chat_id));
  socket.broadcast.emit('user_online', { userId: uid, displayName: user.display_name });

  socket.on('create_chat', ({ type, userId, title }) => {
    const chatId = uuid();
    if (type === 'private') {
      const ex = get('SELECT c.id FROM chats c JOIN chat_members a ON a.chat_id=c.id AND a.user_id=? JOIN chat_members b ON b.chat_id=c.id AND b.user_id=? WHERE c.type=\'private\'', [uid, userId]);
      if (ex) return socket.emit('chat_created', { chatId: ex.id });
      run('INSERT INTO chats (id,type,created_by) VALUES (?,?,?)', [chatId, 'private', uid]);
      run('INSERT INTO chat_members (chat_id,user_id) VALUES (?,?),(?,?)', [chatId, uid, chatId, userId]);
    } else {
      run('INSERT INTO chats (id,type,title,created_by) VALUES (?,?,?,?)', [chatId, 'group', title || 'Group', uid]);
      run('INSERT INTO chat_members (chat_id,user_id) VALUES (?,?)', [chatId, uid]);
    }
    socket.join(chatId);
    const other = onlineUsers.get(userId);
    if (other) other.forEach(sid => io.sockets.sockets.get(sid)?.join(chatId));
    socket.emit('chat_created', { chatId });
  });

  socket.on('typing', ({ chatId }) => { socket.to(chatId).emit('typing', { userId: uid, displayName: user.display_name, chatId }); });
  socket.on('stop_typing', ({ chatId }) => { socket.to(chatId).emit('stop_typing', { userId: uid, chatId }); });

  socket.on('webrtc_offer', ({ to, offer }) => { const s = onlineUsers.get(to); if (s) s.forEach(sid => io.to(sid).emit('webrtc_offer', { from: uid, offer })); });
  socket.on('webrtc_answer', ({ to, answer }) => { const s = onlineUsers.get(to); if (s) s.forEach(sid => io.to(sid).emit('webrtc_answer', { from: uid, answer })); });
  socket.on('webrtc_ice', ({ to, candidate }) => { const s = onlineUsers.get(to); if (s) s.forEach(sid => io.to(sid).emit('webrtc_ice', { from: uid, candidate })); });

  socket.on('disconnect', () => {
    const sockets = onlineUsers.get(uid);
    if (sockets) {
      sockets.delete(socket.id);
      if (sockets.size === 0) {
        onlineUsers.delete(uid);
        socket.broadcast.emit('user_offline', { userId: uid });
      }
    }
  });
});

/* ─── Online status endpoint ─── */
app.get('/api/users/online', auth, (_req: any, res) => {
  res.json(Array.from(onlineUsers.keys()));
});

/* ─── Start ─── */
initDb().then(() => httpServer.listen(PORT, () => console.log(`kairus:${PORT}`)));
