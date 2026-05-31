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

// Подключение к базе данных MongoDB с защитой от пустой строки
const MONGODB_URI = process.env.MONGODB_URI ? process.env.MONGODB_URI.trim().replace(/\.+$/, '') : '';

if (!MONGODB_URI) {
  console.log('⚠️ Внимание: MONGODB_URI не настроена в Render. Используется локальная память.');
} else {
  mongoose.connect(MONGODB_URI)
    .then(() => console.log('🍃 База данных успешно подключена'))
    .catch(err => console.error('❌ Ошибка подключения к MongoDB:', err));
}

// Схемы для MongoDB
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

// Временное хранилище в оперативной памяти (если БД недоступна, чтобы приложение не выдавало "Ошибка сервера")
const memoryUsers = [];
const memoryMessages = [];

// API Эндпоинты
app.post('/api/register', async (req, res) => {
  try {
    const { displayName, password } = req.body;
    if (!displayName || !password) return res.status(400).json({ error: 'Заполните поля!' });
    
    const username = `id_${crypto.randomBytes(3).toString('hex')}`;

    if (mongoose.connection.readyState === 1) {
      const newUser = new User({ username, displayName, password });
      await newUser.save();
      return res.json({ user: { id: newUser._id, username, displayName, isAdmin: false } });
    } else {
      const mockUser = { id: crypto.randomUUID(), username, displayName, password, isAdmin: false };
      memoryUsers.push(mockUser);
      return res.json({ user: { id: mockUser.id, username, displayName, isAdmin: false } });
    }
  } catch (e) { 
    console.error(e);
    res.status(500).json({ error: 'Ошибка при регистрации' }); 
  }
});

app.post('/api/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    
    if (mongoose.connection.readyState === 1) {
      const user = await User.findOne({ username, password });
      if (!user) return res.status(400).json({ error: 'Неверный ID или пароль' });
      return res.json({ user: { id: user._id, username: user.username, displayName: user.displayName, isAdmin: user.isAdmin } });
    } else {
      const user = memoryUsers.find(u => u.username === username && u.password === password);
      if (!user) return res.status(400).json({ error: 'Неверный ID или пароль (Резервный режим)' });
      return res.json({ user: { id: user.id, username: user.username, displayName: user.displayName, isAdmin: user.isAdmin } });
    }
  } catch (e) { 
    res.status(500).json({ error: 'Ошибка авторизации на сервере' }); 
  }
});

app.get('/api/messages/init', async (req, res) => {
  try {
    const userId = req.headers['x-user-id'];
    let myUsername = '';

    if (mongoose.connection.readyState === 1) {
      const user = await User.findById(userId);
      if (user) myUsername = user.username;
    } else {
      const user = memoryUsers.find(u => u.id === userId);
      if (user) myUsername = user.username;
    }

    if (!myUsername) return res.json([]);

    if (mongoose.connection.readyState === 1) {
      const messages = await Message.find({ $or: [{ from: myUsername }, { to: myUsername }] });
      res.json(messages);
    } else {
      const messages = memoryMessages.filter(m => m.from === myUsername || m.to === myUsername);
      res.json(messages);
    }
  } catch (e) { res.json([]); }
});

// Отдача чистого HTML-интерфейса мессенджера
app.get('/', (req, res) => {
  res.send(`
<!DOCTYPE html>
<html lang="ru">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Mesenjer 2.0</title>
  <script src="/socket.io/socket.io.js"></script>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; background: #0b0e14; color: #f5f6f7; display: flex; justify-content: center; align-items: center; min-height: 100vh; padding: 10px; }
    .card { width: 100%; max-width: 400px; background: #151a24; padding: 24px; border-radius: 16px; box-shadow: 0 8px 24px rgba(0,0,0,0.3); border: 1px solid #222b3c; }
    h2 { font-size: 20px; margin-bottom: 16px; text-align: center; color: #ffffff; }
    input { width: 100%; padding: 12px; margin-bottom: 12px; border-radius: 8px; border: 1px solid #2c384e; background: #1c2331; color: #fff; font-size: 15px; outline: none; }
    input:focus { border-color: #5865f2; }
    button { width: 100%; padding: 12px; border-radius: 8px; border: none; background: #5865f2; color: #fff; font-size: 15px; font-weight: 600; cursor: pointer; transition: background 0.2s; }
    button:hover { background: #4752c4; }
    .secondary-btn { background: #242c3d; margin-top: 8px; border: 1px solid #2c384e; }
    .secondary-btn:hover { background: #2e384e; }
    .chat-box { height: 320px; overflow-y: auto; background: #0b0e14; border-radius: 8px; padding: 12px; margin: 12px 0; border: 1px solid #2c384e; }
    .msg { margin: 6px 0; padding: 8px 12px; border-radius: 8px; max-width: 85%; word-wrap: break-word; font-size: 14px; line-height: 1.4; }
    .msg.incoming { background: #242c3d; color: #f5f6f7; align-self: flex-start; }
    .msg.outgoing { background: #5865f2; color: #fff; margin-left: auto; }
    .flex-row { display: flex; gap: 8px; }
  </style>
</head>
<body>
<div class="card" id="window">
  <h2>🔒 Вход в Mesenjer</h2>
  <input id="uid" placeholder="Ваш ID (id_xxxxxx)">
  <input id="upass" type="password" placeholder="Пароль">
  <button onclick="sign('login')">Войти</button>
  <button class="secondary-btn" onclick="sign('reg')">Создать новый аккаунт</button>
</div>

<script>
  let account = null;
  let socket = null;
  let activeChat = '';

  async function api(path, payload) {
    const options = {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    };
    if (account) options.headers['x-user-id'] = account.id;
    const res = await fetch(path, options);
    return res.json();
  }

  async function sign(mode) {
    if (mode === 'login') {
      const username = document.getElementById('uid').value.trim();
      const password = document.getElementById('upass').value;
      if(!username || !password) return alert('Заполните поля!');
      const data = await api('/api/login', { username, password });
      if (data.error) return alert(data.error);
      account = data.user;
    } else {
      const displayName = prompt('Введите ваше имя для чата:');
      if (!displayName) return;
      const password = prompt('Придумайте пароль:') || '1111';
      const data = await api('/api/register', { displayName, password });
      if (data.error) return alert(data.error);
      alert('Ваш созданный личный ID для входа: ' + data.user.username);
      account = data.user;
    }
    loadChatView();
  }

  function loadChatView() {
    socket = io();
    socket.emit('join', account.id);

    document.getElementById('window').innerHTML = \`
      <div style="margin-bottom: 12px; font-size: 14px; color: #b9bbbe;">
        Имя: <b>\${account.displayName}</b><br>Ваш ID: <code style="background:#000;padding:2px 4px;border-radius:4px;">\${account.username}</code>
      </div>
      <input id="target" placeholder="Кому пишем? Введите ID получателя" oninput="activeChat=this.value.trim()">
      <div class="chat-box" id="chatBox" style="display:flex; flex-direction:column;"></div>
      <div class="flex-row">
        <input id="text" placeholder="Сообщение..." style="margin:0;">
        <button style="width:70px;" onclick="send()">➔</button>
      </div>
    \`;

    fetch('/api/messages/init', { headers: { 'x-user-id': account.id } })
      .then(r => r.json())
      .then(list => list.forEach(renderMsg));

    socket.on('new message', renderMsg);
  }

  function renderMsg(m) {
    const box = document.getElementById('chatBox');
    if (!box) return;
    const item = document.createElement('div');
    const isMy = m.from === account.username;
    item.className = 'msg ' + (isMy ? 'outgoing' : 'incoming');
    item.textContent = (isMy ? '' : m.from + ': ') + m.text;
    box.appendChild(item);
    box.scrollTop = box.scrollHeight;
  }

  function send() {
    const el = document.getElementById('text');
    if (!el.value.trim() || !activeChat) return alert('Заполните ID получателя и текст!');
    socket.emit('private message', { to: activeChat, from: account.username, text: el.value.trim() });
    el.value = '';
  }
</script>
</body>
</html>
  `);
});

// Логика работы через веб-сокеты
const liveSockets = new Map();
io.on('connection', (socket) => {
  socket.on('join', (userId) => { liveSockets.set(userId, socket.id); });

  socket.on('private message', async (data) => {
    const { to, from, text } = data;
    const conversationId = [from, to].sort().join('___');
    
    const msgData = { conversationId, from, to, text, timestamp: new Date() };

    if (mongoose.connection.readyState === 1) {
      const msg = new Message(msgData);
      await msg.save();
      socket.emit('new message', msg);
    } else {
      memoryMessages.push(msgData);
      socket.emit('new message', msgData);
    }
    
    // Поиск получателя на бэкенде
    let targetId = '';
    if (mongoose.connection.readyState === 1) {
      const targetUser = await User.findOne({ username: to });
      if (targetUser) targetId = targetUser._id.toString();
    } else {
      const targetUser = memoryUsers.find(u => u.username === to);
      if (targetUser) targetId = targetUser.id;
    }

    if (targetId && liveSockets.has(targetId)) {
      io.to(liveSockets.get(targetId)).emit('new message', msgData);
    }
  });
});

const PORT = process.env.PORT || 10000;
server.listen(PORT, () => console.log(`🚀 Сервер готов на порту ${PORT}`));

