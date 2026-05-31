const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
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

// Хранилище в оперативной памяти (работает без сбоев бэкенда)
const memoryUsers = [];
const memoryMessages = [];
const memoryGames = [];
const memoryGameMessages = []; // { gameId, from, text, timestamp }

// Инициализация стандартных игр, чтобы каталог не был пустым
memoryGames.push({
  id: 'clicker',
  title: '🚀 Супер Кликер',
  author: 'Система',
  code: `<!DOCTYPE html>
<html>
<head>
  <style>
    body { background: #111; color: #fff; text-align: center; font-family: sans-serif; padding-top: 40px; }
    button { padding: 15px 30px; font-size: 18px; font-weight: bold; background: #2ecc71; color: #fff; border: none; border-radius: 8px; cursor: pointer; }
    button:active { transform: scale(0.95); }
    h1 { font-size: 48px; margin: 20px 0; color: #2ecc71; }
  </style>
</head>
<body>
  <h3>Кликай как не в себя!</h3>
  <h1 id="score">0</h1>
  <button onclick="clickMe()">КЛИК!</button>
  <script>
    let count = 0;
    function clickMe() {
      count++;
      document.getElementById('score').innerText = count;
    }
  </script>
</body>
</html>`
});

// API Эндпоинты
app.post('/api/register', (req, res) => {
  const { displayName, password } = req.body;
  if (!displayName || !password) return res.status(400).json({ error: 'Заполните все поля!' });
  
  const username = `id_${crypto.randomBytes(3).toString('hex')}`;
  const newUser = { id: username, username, displayName, password, friends: [] };
  memoryUsers.push(newUser);
  
  res.json({ user: { id: username, username, displayName, friends: [] } });
});

app.post('/api/login', (req, res) => {
  const { username, password } = req.body;
  const user = memoryUsers.find(u => u.username === username && u.password === password);
  if (!user) return res.status(400).json({ error: 'Неверный ID или пароль' });
  res.json({ user: { id: user.id, username: user.username, displayName: user.displayName, friends: user.friends || [] } });
});

app.post('/api/friends/add', (req, res) => {
  const { myId, targetUsername } = req.body;
  const me = memoryUsers.find(u => u.id === myId);
  const target = memoryUsers.find(u => u.username === targetUsername);

  if (!target) return res.status(404).json({ error: 'Пользователь не найден' });
  if (me.username === targetUsername) return res.status(400).json({ error: 'Нельзя добавить себя' });
  
  if (!me.friends) me.friends = [];
  if (me.friends.includes(targetUsername)) return res.status(400).json({ error: 'Уже в друзьях' });

  me.friends.push(targetUsername);
  res.json({ success: true, friends: me.friends });
});

app.get('/api/games', (req, res) => res.json(memoryGames));

app.post('/api/games/create', (req, res) => {
  const { title, code, author } = req.body;
  if (!title || !code) return res.status(400).json({ error: 'Укажите название и код игры!' });
  
  const newGame = { id: `game_${crypto.randomBytes(3).toString('hex')}`, title, code, author };
  memoryGames.push(newGame);
  res.json(newGame);
});

app.get('/api/messages/init', (req, res) => {
  const userId = req.headers['x-user-id'];
  const user = memoryUsers.find(u => u.id === userId);
  if (!user) return res.json([]);
  const list = memoryMessages.filter(m => m.from === user.username || m.to === user.username);
  res.json(list);
});

app.get('/api/games/chat/:gameId', (req, res) => {
  const list = memoryGameMessages.filter(m => m.gameId === req.params.gameId);
  res.json(list);
});

// Отдача HTML интерфейса
app.get('/', (req, res) => {
  res.send(`
<!DOCTYPE html>
<html lang="ru">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Mesenjer + Игровые Комнаты</title>
  <script src="/socket.io/socket.io.js"></script>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: -apple-system, sans-serif; background: #0b0e14; color: #f5f6f7; padding: 15px; display: flex; justify-content: center; }
    .card { width: 100%; max-width: 500px; background: #151a24; padding: 20px; border-radius: 14px; border: 1px solid #222b3c; box-shadow: 0 8px 24px rgba(0,0,0,0.2); }
    input, textarea, button { width: 100%; padding: 12px; margin-bottom: 10px; border-radius: 8px; border: 1px solid #2c384e; background: #1c2331; color: #fff; font-size: 14px; outline: none; }
    button { background: #5865f2; font-weight: bold; cursor: pointer; border: none; }
    button:hover { background: #4752c4; }
    .nav { display: flex; gap: 6px; margin-bottom: 15px; }
    .nav button { background: #242c3d; margin: 0; }
    .nav button.active { background: #5865f2; }
    .box { height: 260px; overflow-y: auto; background: #0b0e14; border-radius: 8px; padding: 12px; margin-bottom: 10px; border: 1px solid #2c384e; display: flex; flex-direction: column; }
    .msg { margin: 4px 0; padding: 8px 12px; border-radius: 8px; background: #242c3d; max-width: 85%; width: fit-content; word-break: break-all; }
    .msg.my { background: #5865f2; margin-left: auto; }
    .item-row { padding: 10px; background: #1c2331; margin-bottom: 6px; border-radius: 8px; display: flex; justify-content: space-between; align-items: center; border: 1px solid #222b3c; }
    iframe { width: 100%; height: 280px; background: #fff; border-radius: 8px; border: none; margin-bottom: 12px; }
  </style>
</head>
<body>
<div class="card" id="app">
  <h2 style="text-align:center; margin-bottom:15px;">🔒 Вход в Mesenjer</h2>
  <input id="uid" placeholder="Ваш ID (id_xxxxxx)">
  <input id="upass" type="password" placeholder="Пароль">
  <button onclick="auth('login')">Войти</button>
  <button style="background:#2ecc71" onclick="auth('reg')">Зарегистрироваться</button>
</div>

<script>
  let user = null;
  let socket = null;
  let currentTab = 'chats';
  let activeChatPartner = '';
  let activeGameId = '';

  async function api(url, data) {
    const headers = { 'Content-Type': 'application/json' };
    if (user) headers['x-user-id'] = user.id;
    const r = await fetch(url, { method: 'POST', headers, body: JSON.stringify(data) });
    return r.json();
  }

  async function auth(mode) {
    if (mode === 'login') {
      const res = await api('/api/login', { username: document.getElementById('uid').value.trim(), password: document.getElementById('upass').value });
      if (res.error) return alert(res.error);
      user = res.user;
    } else {
      const name = prompt('Ваше имя в чате:'); if(!name) return;
      const res = await api('/api/register', { displayName: name, password: document.getElementById('upass').value || '1111' });
      alert('Ваш личный ID для входа: ' + res.user.username);
      user = res.user;
    }
    initApp();
  }

  function initApp() {
    socket = io();
    socket.emit('join', user.id);
    
    socket.on('new message', (m) => {
      if(currentTab === 'chats') renderPrivateMsg(m);
    });

    socket.on('new game message', (m) => {
      if(currentTab === 'play' && activeGameId === m.gameId) renderGameMsg(m);
    });

    renderLayout();
  }

  function renderLayout() {
    document.getElementById('app').innerHTML = \`
      <div style="font-size:13px; margin-bottom:12px; color:#b9bbbe; text-align:center;">
        ID: <code style="background:#000; padding:2px 6px; border-radius:4px; color:#fff;">\${user.username}</code> | Имя: <b>\${user.displayName}</b>
      </div>
      <div class="nav">
        <button id="b-chats" class="active" onclick="switchTab('chats')">💬 Чат</button>
        <button id="b-friends" onclick="switchTab('friends')">👥 Друзья</button>
        <button id="b-games" onclick="switchTab('games')">🎮 Игры</button>
      </div>
      <div id="tabContent"></div>
    \`;
    switchTab('chats');
  }

  function switchTab(tab) {
    currentTab = tab;
    document.querySelectorAll('.nav button').forEach(b => b.classList.remove('active'));
    const btn = document.getElementById('b-' + tab);
    if(btn) btn.classList.add('active');
    
    const block = document.getElementById('tabContent');
    if (tab === 'chats') {
      block.innerHTML = \`
        <input id="partner" placeholder="Введите ID собеседника..." value="\${activeChatPartner}" oninput="activeChatPartner=this.value.trim()">
        <div class="box" id="chatBox"></div>
        <div style="display:flex; gap:6px;"><input id="mText" placeholder="Сообщение..." style="margin:0;"><button style="width:60px;margin:0;" onclick="sendPrivate()">➔</button></div>
      \`;
      fetch('/api/messages/init').then(r=>r.json()).then(list => list.forEach(renderPrivateMsg));
    } 
    else if (tab === 'friends') {
      block.innerHTML = \`
        <div style="display:flex; gap:6px;"><input id="fId" placeholder="Добавить друга по ID" style="margin:0;"><button style="width:100px;margin:0;background:#2ecc71" onclick="addFriend()">+ Друг</button></div>
        <h4 style="margin:12px 0 6px 0;">Мой список друзей:</h4>
        <div id="friendsList"></div>
      \`;
      user.friends.forEach(f => {
        document.getElementById('friendsList').innerHTML += \`<div class="item-row"><span>👤 \${f}</span><button style="width:auto;padding:5px 12px;margin:0;" onclick="activeChatPartner='\${f}';switchTab('chats')">Чат</button></div>\`;
      });
    }
    else if (tab === 'games') {
      block.innerHTML = \`
        <button onclick="openPublishForm()" style="background:#e67e22; margin-bottom:15px;">➕ Опубликовать свою мини-игру</button>
        <h4 style="margin-bottom:8px;">Каталог пользовательских игр:</h4>
        <div id="gamesCatalog"></div>
      \`;
      fetch('/api/games').then(r=>r.json()).then(list => {
        list.forEach(g => {
          document.getElementById('gamesCatalog').innerHTML += \`<div class="item-row"><div><b>\${g.title}</b><br><small style="color:#b9bbbe">Автор: \${g.author}</small></div><button style="width:auto;padding:6px 14px;margin:0;" onclick="playGame('\${g.id}', \\\`\${btoa(unescape(encodeURIComponent(g.code)))}\\\`)">Запуск</button></div>\`;
        });
      });
    }
  }

  function sendPrivate() {
    const input = document.getElementById('mText');
    if(!input.value.trim() || !activeChatPartner) return;
    socket.emit('private message', { to: activeChatPartner, from: user.username, text: input.value.trim() });
    input.value = '';
  }

  function renderPrivateMsg(m) {
    const b = document.getElementById('chatBox'); if(!b) return;
    const d = document.createElement('div');
    d.className = 'msg ' + (m.from === user.username ? 'my' : '');
    d.textContent = (m.from === user.username ? '' : m.from + ': ') + m.text;
    b.appendChild(d); b.scrollTop = b.scrollHeight;
  }

  async function addFriend() {
    const id = document.getElementById('fId').value.trim();
    const res = await api('/api/friends/add', { myId: user.id, targetUsername: id });
    if(res.error) return alert(res.error);
    user.friends = res.friends;
    alert('Пользователь добавлен в друзья!');
    switchTab('friends');
  }

  function openPublishForm() {
    document.getElementById('tabContent').innerHTML = \`
      <h3>🛠️ Создание новой игры</h3>
      <input id="gTitle" placeholder="Название вашей игры">
      <textarea id="gCode" rows="10" placeholder="Вставьте сюда HTML/CSS/JS код мини-игры..."></textarea>
      <button onclick="saveGame()">Выложить игру для всех</button>
      <button style="background:#e74c3c" onclick="switchTab('games')">Отмена</button>
    \`;
  }

  async function saveGame() {
    const title = document.getElementById('gTitle').value.trim();
    const code = document.getElementById('gCode').value;
    if(!title || !code) return alert('Заполните данные!');
    const res = await api('/api/games/create', { title, code, author: user.username });
    if(res.error) return alert(res.error);
    alert('Игра успешно добавлена!');
    switchTab('games');
  }

  function playGame(gameId, base64) {
    activeGameId = gameId;
    currentTab = 'play';
    const decoded = decodeURIComponent(escape(atob(base64)));
    
    // Вход в изолированную комнату игры на сокетах
    socket.emit('join game room', gameId);

    document.getElementById('tabContent').innerHTML = \`
      <iframe id="gamePlatform"></iframe>
      <h3 style="margin-bottom:6px;">💬 Чат игровой комнаты</h3>
      <div class="box" id="gameChatBox"></div>
      <div style="display:flex; gap:6px;"><input id="gMsg" placeholder="Написать игрокам в комнате..." style="margin:0;"><button style="width:60px;margin:0;" onclick="sendGameMsg()">➔</button></div>
      <button style="background:#e74c3c; margin-top:12px;" onclick="exitGameRoom()">🚪 Выйти из игры</button>
    \`;

    const doc = document.getElementById('gamePlatform').contentWindow.document;
    doc.open(); doc.write(decoded); doc.close();

    fetch('/api/games/chat/' + gameId).then(r=>r.json()).then(list => list.forEach(renderGameMsg));
  }

  function sendGameMsg() {
    const input = document.getElementById('gMsg');
    if(!input.value.trim()) return;
    socket.emit('game message', { gameId: activeGameId, from: user.username, text: input.value.trim() });
    input.value = '';
  }

  function renderGameMsg(m) {
    const b = document.getElementById('gameChatBox'); if(!b) return;
    const d = document.createElement('div');
    d.className = 'msg ' + (m.from === user.username ? 'my' : '');
    d.textContent = m.from + ': ' + m.text;
    b.appendChild(d); b.scrollTop = b.scrollHeight;
  }

  function exitGameRoom() {
    socket.emit('leave game room', activeGameId);
    switchTab('games');
  }
</script>
</body>
</html>
  `);
});

// Сокет-логика серверов (Комнаты)
const liveSockets = new Map();
io.on('connection', (socket) => {
  socket.on('join', (userId) => { liveSockets.set(userId, socket.id); });

  // ЛС мессенджера
  socket.on('private message', (data) => {
    const { to, from, text } = data;
    const msg = { from, to, text, timestamp: new Date() };
    memoryMessages.push(msg);

    socket.emit('new message', msg);
    const targetUser = memoryUsers.find(u => u.username === to);
    if (targetUser && liveSockets.has(targetUser.id)) {
      io.to(liveSockets.get(targetUser.id)).emit('new message', msg);
    }
  });

  // Логика изолированных комнат для игр
  socket.on('join game room', (gameId) => {
    socket.join(gameId); // Подключаем сокет к комнате игры
  });

  socket.on('leave game room', (gameId) => {
    socket.leave(gameId); // Отключаем сокет от комнаты игры
  });

  socket.on('game message', (data) => {
    const { gameId, from, text } = data;
    const msg = { gameId, from, text, timestamp: new Date() };
    memoryGameMessages.push(msg);
    
    // Отправляем сообщение только участникам этой конкретной комнаты игры
    io.to(gameId).emit('new game message', msg);
  });
});

const PORT = process.env.PORT || 10000;
server.listen(PORT, () => console.log(`🚀 Сервер запущен на порту ${PORT}`));

