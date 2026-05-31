const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const mongoose = require('mongoose');
const cors = require('cors');
require('dotenv').config();

const app = express();
app.use(cors());
app.use(express.json());

const server = http.createServer(app);
const io = socketIo(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

// -------------------- Модели --------------------
const userSchema = new mongoose.Schema({
  username: { type: String, required: true, unique: true, lowercase: true },
  displayName: { type: String, required: true },
  password: { type: String, required: true },
  isAdmin: { type: Boolean, default: false },
  createdAt: { type: Date, default: Date.now }
});

const messageSchema = new mongoose.Schema({
  from: { type: String, required: true },
  to: { type: String, required: true },
  text: { type: String, required: true },
  timestamp: { type: Date, default: Date.now },
  conversationId: { type: String, required: true },
  read: { type: Boolean, default: false }
});

const User = mongoose.model('User', userSchema);
const Message = mongoose.model('Message', messageSchema);

// -------------------- Подключение к БД --------------------
mongoose.connect(process.env.MONGO_URI)
  .then(() => console.log('✅ MongoDB connected'))
  .catch(err => console.error('❌ MongoDB error:', err));

// -------------------- Вспомогательные функции --------------------
function generateUsername() {
  const adj = ['cool','fast','smart','bright','dark','wild','calm','bold','keen','warm'];
  const noun = ['fox','owl','wolf','bear','hawk','lynx','deer','dove','lion','tiger'];
  const a = adj[Math.floor(Math.random() * adj.length)];
  const n = noun[Math.floor(Math.random() * noun.length)];
  const num = Math.floor(Math.random() * 9000) + 1000;
  return `${a}_${n}_${num}`;
}

function getConversationId(user1, user2) {
  const sorted = [user1, user2].sort();
  return sorted.join('___');
}

// Middleware для получения пользователя по заголовку (упрощённо)
async function attachUser(req, res, next) {
  const userId = req.headers['x-user-id'];
  if (!userId) return res.status(401).json({ error: 'Не авторизован' });
  const user = await User.findById(userId);
  if (!user) return res.status(401).json({ error: 'Пользователь не найден' });
  req.user = user;
  next();
}

// -------------------- REST API --------------------
// Регистрация (генерирует случайный username)
app.post('/api/register', async (req, res) => {
  try {
    const { displayName, password } = req.body;
    if (!displayName || !password) return res.status(400).json({ error: 'Заполните все поля' });
    if (password.length < 4) return res.status(400).json({ error: 'Пароль минимум 4 символа' });

    // Генерируем уникальный username
    let username;
    let exists = true;
    while (exists) {
      username = generateUsername();
      exists = await User.findOne({ username });
    }

    const user = new User({ username, displayName, password });
    await user.save();
    res.json({ success: true, user: { id: user._id, username: user.username, displayName: user.displayName, isAdmin: user.isAdmin } });
  } catch (err) {
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

// Логин
app.post('/api/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    const user = await User.findOne({ username: username.toLowerCase().trim() });
    if (!user || user.password !== password) return res.status(401).json({ error: 'Неверные данные' });
    res.json({ success: true, user: { id: user._id, username: user.username, displayName: user.displayName, isAdmin: user.isAdmin } });
  } catch (err) {
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

// Поиск пользователей
app.get('/api/users/search', attachUser, async (req, res) => {
  try {
    const q = req.query.q || '';
    const users = await User.find({
      $and: [
        { _id: { $ne: req.user._id } },
        { $or: [
          { username: { $regex: q, $options: 'i' } },
          { displayName: { $regex: q, $options: 'i' } }
        ]}
      ]
    }).select('-password -__v');
    res.json(users);
  } catch (err) {
    res.status(500).json({ error: 'Ошибка поиска' });
  }
});

// Получить данные о себе
app.get('/api/me', attachUser, (req, res) => {
  res.json({ id: req.user._id, username: req.user.username, displayName: req.user.displayName, isAdmin: req.user.isAdmin });
});

// Обновить отображаемое имя
app.put('/api/user/displayName', attachUser, async (req, res) => {
  try {
    const { displayName } = req.body;
    if (!displayName) return res.status(400).json({ error: 'Имя не может быть пустым' });
    req.user.displayName = displayName;
    await req.user.save();
    res.json({ success: true, displayName });
  } catch (err) {
    res.status(500).json({ error: 'Ошибка' });
  }
});

// Сменить пароль
app.put('/api/user/password', attachUser, async (req, res) => {
  try {
    const { newPassword } = req.body;
    if (!newPassword || newPassword.length < 4) return res.status(400).json({ error: 'Пароль минимум 4 символа' });
    req.user.password = newPassword;
    await req.user.save();
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Ошибка' });
  }
});

// Удалить аккаунт
app.delete('/api/user', attachUser, async (req, res) => {
  try {
    const userId = req.user._id;
    const username = req.user.username;
    await User.findByIdAndDelete(userId);
    // Удаляем все сообщения пользователя
    await Message.deleteMany({ $or: [{ from: username }, { to: username }] });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Ошибка' });
  }
});

// Админ: активировать права (если верный пароль)
app.post('/api/admin/access', attachUser, async (req, res) => {
  const { password } = req.body;
  if (password === 'meml20142016') {
    req.user.isAdmin = true;
    await req.user.save();
    res.json({ success: true, isAdmin: true });
  } else {
    res.status(403).json({ error: 'Неверный пароль администратора' });
  }
});

// Админ: получить всех пользователей
app.get('/api/admin/users', attachUser, async (req, res) => {
  if (!req.user.isAdmin) return res.status(403).json({ error: 'Доступ запрещён' });
  const users = await User.find().select('-password -__v');
  res.json(users);
});

// Админ: удалить пользователя
app.delete('/api/admin/user/:id', attachUser, async (req, res) => {
  if (!req.user.isAdmin) return res.status(403).json({ error: 'Доступ запрещён' });
  const userToDelete = await User.findById(req.params.id);
  if (!userToDelete) return res.status(404).json({ error: 'Не найден' });
  await Message.deleteMany({ $or: [{ from: userToDelete.username }, { to: userToDelete.username }] });
  await User.findByIdAndDelete(req.params.id);
  res.json({ success: true });
});

// Админ: получить все переписки (для админки)
app.get('/api/admin/conversations', attachUser, async (req, res) => {
  if (!req.user.isAdmin) return res.status(403).json({ error: 'Доступ запрещён' });
  const messages = await Message.aggregate([
    { $group: { _id: "$conversationId", count: { $sum: 1 }, lastMessage: { $last: "$$ROOT" } } },
    { $sort: { "lastMessage.timestamp": -1 } }
  ]);
  res.json(messages);
});

// Админ: удалить переписку
app.delete('/api/admin/conversation/:convId', attachUser, async (req, res) => {
  if (!req.user.isAdmin) return res.status(403).json({ error: 'Доступ запрещён' });
  await Message.deleteMany({ conversationId: req.params.convId });
  res.json({ success: true });
});

// -------------------- WebSocket (Socket.IO) --------------------
const onlineUsers = {}; // socketId -> userId (или username)

io.on('connection', (socket) => {
  let currentUsername = null;

  // Клиент отправляет userId при подключении
  socket.on('join', async (userId) => {
    try {
      const user = await User.findById(userId);
      if (!user) return socket.disconnect();
      currentUsername = user.username;
      onlineUsers[socket.id] = currentUsername;
      console.log(`✅ ${currentUsername} подключился`);
    } catch (e) {
      socket.disconnect();
    }
  });

  // Приватное сообщение
  socket.on('private message', async ({ to, text }) => {
    if (!currentUsername || !text.trim()) return;
    const conversationId = getConversationId(currentUsername, to);
    const msg = new Message({
      from: currentUsername,
      to,
      text: text.trim(),
      conversationId,
      read: false
    });
    await msg.save();

    // Отправляем отправителю подтверждение
    socket.emit('new message', msg);

    // Ищем получателя среди онлайн-сокетов
    for (let [id, username] of Object.entries(onlineUsers)) {
      if (username === to) {
        io.to(id).emit('new message', msg);
        break;
      }
    }
  });

  // Пометить сообщения как прочитанные (когда открыт чат)
  socket.on('mark read', async ({ conversationId, user }) => {
    await Message.updateMany(
      { conversationId, to: user, read: false },
      { $set: { read: true } }
    );
  });

  socket.on('disconnect', () => {
    delete onlineUsers[socket.id];
    console.log(`❌ ${currentUsername} отключился`);
  });
});

// -------------------- Запуск --------------------
const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
  console.log(`🚀 Сервер запущен на порту ${PORT}`);
});