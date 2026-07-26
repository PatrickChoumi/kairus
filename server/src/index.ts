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
import { initDb, all, get, run } from './db.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const JWT_SECRET = process.env.JWT_SECRET || 'kairus-dev';

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, { cors: { origin: '*', methods: ['GET', 'POST'] } });

app.use(cors());
app.use(express.json());

const uploadsDir = path.join(__dirname, '..', 'uploads');
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir);
app.use('/uploads', express.static(uploadsDir));

const upload = multer({
  storage: multer.diskStorage({
    destination: (_r, _f, cb) => cb(null, uploadsDir),
    filename: (_r, f, cb) => cb(null, `${uuid()}${path.extname(f.originalname)}`),
  }),
  limits: { fileSize: 50 * 1024 * 1024 },
});

function getUser(token: string) {
  try {
    const p = jwt.verify(token, JWT_SECRET) as { userId: string };
    return get('SELECT id, phone, username, display_name, avatar FROM users WHERE id = ?', [p.userId]);
  } catch { return null; }
}

function auth(req: any, res: any, next: any) {
  const user = getUser(req.headers.authorization?.split(' ')[1]);
  if (!user) return res.status(401).json({ error: 'Unauthorized' });
  req.user = user;
  next();
}

app.post('/api/auth/register', (req, res) => {
  const { phone, password, display_name } = req.body;
  if (!phone || !password || !display_name) return res.status(400).json({ error: 'Missing fields' });
  if (get('SELECT id FROM users WHERE phone = ?', [phone])) return res.status(409).json({ error: 'Phone exists' });
  const id = uuid();
  run('INSERT INTO users (id, phone, display_name, password_hash) VALUES (?,?,?,?)', [id, phone, display_name, bcrypt.hashSync(password, 10)]);
  const token = jwt.sign({ userId: id }, JWT_SECRET, { expiresIn: '30d' });
  run('INSERT INTO sessions (token, user_id) VALUES (?,?)', [token, id]);
  res.json({ token, user: { id, phone, display_name } });
});

app.post('/api/auth/login', (req, res) => {
  const { phone, password } = req.body;
  const user = get('SELECT * FROM users WHERE phone = ?', [phone]);
  if (!user || !bcrypt.compareSync(password, user.password_hash)) return res.status(401).json({ error: 'Invalid' });
  const token = jwt.sign({ userId: user.id }, JWT_SECRET, { expiresIn: '30d' });
  run('INSERT INTO sessions (token, user_id) VALUES (?,?)', [token, user.id]);
  res.json({ token, user: { id: user.id, phone: user.phone, username: user.username, display_name: user.display_name, avatar: user.avatar } });
});

app.get('/api/users/search', auth, (req, res) => {
  const q = req.query.q || '';
  res.json(all("SELECT id, phone, username, display_name, avatar FROM users WHERE (display_name LIKE ? OR username LIKE ?) AND id != ? LIMIT 20", [`%${q}%`, `%${q}%`, req.user.id]));
});

app.get('/api/chats', auth, (req, res) => {
  const chats = all(`SELECT c.*,
    (SELECT content FROM messages WHERE chat_id=c.id ORDER BY created_at DESC LIMIT 1) last_message,
    (SELECT created_at FROM messages WHERE chat_id=c.id ORDER BY created_at DESC LIMIT 1) last_message_time
    FROM chats c JOIN chat_members cm ON c.id=cm.chat_id WHERE cm.user_id=?
    ORDER BY last_message_time DESC`, [req.user.id]);
  res.json(chats.map(c => {
    const members = all('SELECT u.id,u.display_name,u.username,u.avatar FROM chat_members cm JOIN users u ON u.id=cm.user_id WHERE cm.chat_id=?', [c.id]);
    return { ...c, members, title: c.type === 'private' ? (members.find(m => m.id !== req.user.id)?.display_name || 'Unknown') : c.title };
  }));
});

app.post('/api/chats', auth, (req, res) => {
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
    return res.json({ chatId: id });
  }
  res.status(400).json({ error: 'Invalid' });
});

app.get('/api/chats/:chatId/messages', auth, (req, res) => {
  const offset = parseInt(req.query.offset as string) || 0;
  const limit = Math.min(parseInt(req.query.limit as string) || 50, 100);
  const msgs = all(`SELECT m.*, u.display_name sender_name, u.username sender_username, u.avatar sender_avatar
    FROM messages m JOIN users u ON u.id=m.sender_id WHERE m.chat_id=?
    ORDER BY m.created_at DESC LIMIT ? OFFSET ?`, [req.params.chatId, limit, offset]);
  res.json(msgs.reverse());
});

app.post('/api/chats/:chatId/messages', auth, (req, res) => {
  const { content, replyTo, mediaPath, mediaType } = req.body;
  const id = uuid();
  const type = mediaPath ? 'image' : 'text';
  run('INSERT INTO messages (id,chat_id,sender_id,content,type,media_path,media_type,reply_to) VALUES (?,?,?,?,?,?,?,?)',
    [id, req.params.chatId, req.user.id, content || null, type, mediaPath || null, mediaType || null, replyTo || null]);
  const msg = get('SELECT m.*, u.display_name sender_name, u.username sender_username, u.avatar sender_avatar FROM messages m JOIN users u ON u.id=m.sender_id WHERE m.id=?', [id]);
  io.to(req.params.chatId).emit('new_message', msg);
  res.json(msg);
});

app.put('/api/messages/:id', auth, (req, res) => {
  const msg = get('SELECT * FROM messages WHERE id=? AND sender_id=?', [req.params.id, req.user.id]);
  if (!msg) return res.status(404).json({ error: 'Not found' });
  run('UPDATE messages SET content=?,edited=1,updated_at=datetime(\'now\') WHERE id=?', [req.body.content, req.params.id]);
  const updated = get('SELECT m.*,u.display_name sender_name,u.username sender_avatar FROM messages m JOIN users u ON u.id=m.sender_id WHERE m.id=?', [req.params.id]);
  io.to(msg.chat_id).emit('edit_message', updated);
  res.json(updated);
});

app.delete('/api/messages/:id', auth, (req, res) => {
  const msg = get('SELECT * FROM messages WHERE id=? AND sender_id=?', [req.params.id, req.user.id]);
  if (!msg) return res.status(404).json({ error: 'Not found' });
  run('DELETE FROM messages WHERE id=?', [req.params.id]);
  io.to(msg.chat_id).emit('delete_message', { id: req.params.id, chat_id: msg.chat_id });
  res.json({ ok: true });
});

app.post('/api/media/upload', auth, upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file' });
  res.json({ path: `/uploads/${req.file.filename}`, type: req.file.mimetype, size: req.file.size });
});

app.get('/api/contacts', auth, (req, res) => {
  res.json(all('SELECT c.*,u.display_name,u.username,u.avatar,u.phone FROM contacts c JOIN users u ON u.id=c.contact_id WHERE c.user_id=?', [req.user.id]));
});

app.post('/api/contacts', auth, (req, res) => {
  run('INSERT OR IGNORE INTO contacts (user_id,contact_id,display_name) VALUES (?,?,?)', [req.user.id, req.body.contactId, req.body.displayName || null]);
  res.json({ ok: true });
});

app.delete('/api/contacts/:contactId', auth, (req, res) => {
  run('DELETE FROM contacts WHERE user_id=? AND contact_id=?', [req.user.id, req.params.contactId]);
  res.json({ ok: true });
});

const userSockets = new Map<string, string>();

io.use((socket, next) => {
  const user = getUser(socket.handshake.auth.token);
  if (!user) return next(new Error('Unauthorized'));
  socket.data.user = user;
  next();
});

io.on('connection', (socket) => {
  const user = socket.data.user;
  userSockets.set(user.id, socket.id);
  all('SELECT chat_id FROM chat_members WHERE user_id=?', [user.id]).forEach(r => socket.join(r.chat_id));

  socket.on('create_chat', ({ type, userId, title }) => {
    const chatId = uuid();
    if (type === 'private') {
      const ex = get('SELECT c.id FROM chats c JOIN chat_members a ON a.chat_id=c.id AND a.user_id=? JOIN chat_members b ON b.chat_id=c.id AND b.user_id=? WHERE c.type=\'private\'', [user.id, userId]);
      if (ex) return socket.emit('chat_created', { chatId: ex.id });
      run('INSERT INTO chats (id,type,created_by) VALUES (?,?,?)', [chatId, 'private', user.id]);
      run('INSERT INTO chat_members (chat_id,user_id) VALUES (?,?),(?,?)', [chatId, user.id, chatId, userId]);
    } else {
      run('INSERT INTO chats (id,type,title,created_by) VALUES (?,?,?,?)', [chatId, 'group', title || 'Group', user.id]);
      run('INSERT INTO chat_members (chat_id,user_id) VALUES (?,?)', [chatId, user.id]);
    }
    socket.join(chatId);
    const other = userSockets.get(userId);
    if (other) io.sockets.sockets.get(other)?.join(chatId);
    socket.emit('chat_created', { chatId });
  });

  socket.on('typing', ({ chatId }) => { socket.to(chatId).emit('typing', { userId: user.id, displayName: user.display_name, chatId }); });
  socket.on('stop_typing', ({ chatId }) => { socket.to(chatId).emit('stop_typing', { userId: user.id, chatId }); });

  socket.on('webrtc_offer', ({ to, offer }) => { const s = userSockets.get(to); if (s) io.to(s).emit('webrtc_offer', { from: user.id, offer }); });
  socket.on('webrtc_answer', ({ to, answer }) => { const s = userSockets.get(to); if (s) io.to(s).emit('webrtc_answer', { from: user.id, answer }); });
  socket.on('webrtc_ice', ({ to, candidate }) => { const s = userSockets.get(to); if (s) io.to(s).emit('webrtc_ice', { from: user.id, candidate }); });

  socket.on('disconnect', () => { for (const [uid, sid] of userSockets) if (sid === socket.id) { userSockets.delete(uid); break; } });
});

initDb().then(() => httpServer.listen(process.env.PORT || 3001, () => console.log(`kairus:${process.env.PORT || 3001}`)));
