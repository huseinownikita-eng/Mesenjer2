const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const mongoose = require('mongoose');
const cors = require('cors');
const dotenv = require('dotenv');
const crypto = require('crypto');

dotenv.config();

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*', methods: ['GET', 'POST'] }
});

app.use(cors({ origin: '*' }));
app.use(express.json());

// Подключение к MongoDB
const MONGODB_URI = process.env.MONGODB_URI;
if (!MONGODB_URI) {
  console.error('❌ Ошибка: Переменная MONGODB_URI не задана в Render!');
}

mongoose.connect(MONGODB_URI || 'mongodb://localhost:27017/messenger')
  .then(() => console.log('🍃 База данных успешно подключена'))
  .catch(err => console.error('❌ Ошибка базы данных:', err));

// Схемы данных (Mongoose)
const userSchema = new mongoose.Schema({
  username: { type: String, unique: true, required: true },
  displayName: { type: String, required: true },
  password: { type: String, required: true },
  isAdmin: { type: Boolean, default: false }
});
const User = mongoose.model('User', userSchema);

const messageSchema = new mongoose.Schema({
  conversationId: { type: String, required: true },
  from: { type: String, required: true },
  to: { type: String, required: true },
  text: { type: String, required: true },
  timestamp: { type: Date, default: Date.now }
});
const Message = mongoose.model('Message', messageSchema);

// API Эндпоинты
app.post('/api/register', async (req, res) => {
  try {
    const { displayName, password } = req.body;
    if (!displayName || !password) return res.status(400).json({ error: 'Заполните поля' });
    
    const username = `id_${crypto.randomBytes(3).toString('hex')}`;
    const newUser = new User({ username, displayName, password });
    await newUser.save();
    res.json({ user: { id: newUser._id, username, displayName, isAdmin: false } });
  } catch (e) { res.status(500).json({ error: 'Ошибка регистрации' }); }
});

app.post('/api/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    const user = await User.findOne({ username, password });
    if (!user) return res.status(400).json({ error: 'Неверный логин или пароль' });
    res.json({ user: { id: user._id, username: user.username, displayName: user.displayName, isAdmin: user.isAdmin } });
  } catch (e) { res.status(500).json({ error: 'Ошибка сервера' }); }
});

app.get('/api/users/search', async (req, res) => {
  const q = req.query.q || '';
  const users = await User.find({
    $or: [{ username: { $regex: q, $options: 'i' } }, { displayName: { $regex: q, $options: 'i' } }]
  }).limit(10);
  res.json(users);
});

app.get('/api/messages/init', async (req, res) => {
  try {
    const userId = req.headers['x-user-id'];
    const user = await User.findById(userId);
    if (!user) return res.json([]);
    const messages = await Message.find({ $or: [{ from: user.username }, { to: user.username }] });
    res.json(messages);
  } catch (e) { res.json([]); }
});

// Админ-панель: проверка пароля
app.post('/api/admin/access', async (req, res) => {
  const { password } = req.body;
  if (password === 'meml20142016') {
    const userId = req.headers['x-user-id'];
    if (userId) await User.findByIdAndUpdate(userId, { isAdmin: true });
    return res.json({ success: true });
  }
  res.status(403).json({ error: 'Неверный пароль' });
});

// Раздача HTML-интерфейса на главной странице
app.get('/', (req, res) => {
  res.send(`
<!DOCTYPE html>
<html lang="ru">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Mesenjer2.0</title>
  <script src="/socket.io/socket.io.js"></script>
  <style>
    :root {
      --bg: #0f0f1a; --surface: #1a1a2e; --surface2: #22223a; --primary: #6c5ce7;
      --text: #e0e0e0; --text2: #b0b0b0; --border: #2a2a40; --radius: 8px;
    }
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: sans-serif; background: var(--bg); color: var(--text); padding: 20px; display: flex; justify-content: center; }
    .window { width: 100%; max-width: 420px; background: var(--surface); padding: 20px; border-radius: 12px; border: 1px solid var(--border); }
    input, button { width: 100%; padding: 12px; margin: 8px 0; border-radius: var(--radius); border: none; font-size: 14px; }
    input { background: var(--surface2); color: #fff; border: 1px solid var(--border); }
    button { background: var(--primary); color: #fff; cursor: pointer; font-weight: bold; }
    .msg-box { height: 300px; overflow-y: auto; border: 1px solid var(--border); padding: 10px; margin: 10px 0; background: #131324; border-radius: var(--radius); }
    .chat-msg { margin: 6px 0; padding: 8px 12px; border-radius: var(--radius); background: var(--surface2); max-width: 80%; word-break: break-all; }
    .chat-msg.my { background: var(--primary); margin-left: auto; text-align: right; }
    .header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 15px; }
  </style>
</head>
<body>
<div class="window" id="screen">
  <h2>🔐 Вход в систему</h2>
  <input id="loginId" placeholder="Ваш ID (например: id_a1b2c3)">
  <input id="loginPass" type="password" placeholder="Пароль">
  <button onclick="auth('login')">Войти</button>
  <hr style="border-color: var(--border); margin: 15px 0;">
  <button style="background: #2ecc71;" onclick="auth('reg')">Создать аккаунт (Случайный ID)</button>
</div>

<script>
  let user = null;
  let socket = null;
  let currentChatPartner = '';

  async function apiRequest(url, data) {
    const headers = { 'Content-Type': 'application/json' };
    if (user) headers['x-user-id'] = user.id;
    const response = await fetch(url, { method: 'POST', headers, body: JSON.stringify(data) });
    return response.json();
  }

  async function auth(type) {
    if (type === 'login') {
      const username = document.getElementById('loginId').value.trim();
      const password = document.getElementById('loginPass').value;
      const res = await apiRequest('/api/login', { username, password });
      if (res.error) return alert(res.error);
      user = res.user;
    } else {
      const displayName = prompt('Введите ваше имя:');
      if (!displayName) return;
      const password = prompt('Придумайте пароль:') || '1234';
      const res = await apiRequest('/api/register', { displayName, password });
      if (res.error) return alert(res.error);
      alert('Ваш уникальный ID для входа: ' + res.user.username);
      user = res.user;
    }
    openMessenger();
  }

  function openMessenger() {
    socket = io();
    socket.emit('join', user.id);

    document.getElementById('screen').innerHTML = \`
      <div class="header">
        <div><b>\${user.displayName}</b> <small style="color:var(--text2)">@\${user.username}</small></div>
        <button style="width:auto; padding:5px 10px; margin:0;" onclick="activateAdmin()">🛡️</button>
      </div>
      <input id="partnerInput" placeholder="Введите ID собеседника для чата" oninput="currentChatPartner=this.value.trim()">
      <div class="msg-box" id="msgBox"></div>
      <div style="display:flex; gap:5px;">
        <input id="textInput" placeholder="Сообщение..." style="margin:0;">
        <button style="width:60px; margin:0;" onclick="sendMessage()">➤</button>
      </div>
    \`;

    // Загрузка истории
    fetch('/api/messages/init', { headers: { 'x-user-id': user.id } })
      .then(r => r.json())
      .then(messages => messages.forEach(displayMessage));

    socket.on('new message', displayMessage);
  }

  function displayMessage(msg) {
    const box = document.getElementById('msgBox');
    if (!box) return;
    const div = document.createElement('div');
    div.className = 'chat-msg ' + (msg.from === user.username ? 'my' : '');
    div.textContent = msg.from + ': ' + msg.text;
    box.appendChild(div);
    box.scrollTop = box.scrollHeight;
  }

  function sendMessage() {
    const input = document.getElementById('textInput');
    if (!input.value.trim() || !currentChatPartner) return alert('Укажите ID собеседника и текст');
    socket.emit('private message', { to: currentChatPartner, from: user.username, text: input.value.trim() });
    input.value = '';
  }

  async function activateAdmin() {
    const code = prompt('Введите код администратора:');
    if (!code) return;
    const res = await apiRequest('/api/admin/access', { password: code });
    if (res.success) alert('Права администратора получены!');
    else alert('Неверный код');
  }
</script>
</body>
</html>
  `);
});

// Socket.io серверная логика
const userSockets = new Map();
io.on('connection', (socket) => {
  socket.on('join', (userId) => { userSockets.set(userId, socket.id); });

  socket.on('private message', async (data) => {
    const { to, from, text } = data;
    const conversationId = [from, to].sort().join('___');
    
    const msg = new Message({ conversationId, from, to, text });
    await msg.save();

    socket.emit('new message', msg);
    
    const targetUser = await User.findOne({ username: to });
    if (targetUser && userSockets.has(targetUser._id.toString())) {
      io.to(userSockets.get(targetUser._id.toString())).emit('new message', msg);
    }
  });
});

const PORT = process.env.PORT || 10000;
server.listen(PORT, () => console.log(`🚀 Сервер запущен на порту ${PORT}`));

