// backend/server.js
const express = require('express');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcrypt');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');
const multer = require('multer');
const fs = require('fs');

// Папка для загрузок
const UPLOADS_DIR = path.join(__dirname, '../uploads');
if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });

// Подключаем и инициализируем БД
require('./db/database'); // просто подключение
const { initDatabase } = require('./db/init');
initDatabase(); // создаём таблицы

// Настройка multer
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, UPLOADS_DIR);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    const name = Date.now() + '-' + Math.round(Math.random() * 1E9) + ext;
    cb(null, name);
  }
});

const upload = multer({ storage });

// Модели
const User = require('./models/User');
const Chat = require('./models/Chat');
const Message = require('./models/Message');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
  cors: { origin: "*" }
});

app.use(cors({
  origin: "https://nee-chat.cloudpub.ru", // замените на ваш домен
  credentials: true // если используете куки
}));
app.use(express.json());
app.use(express.static(path.join(__dirname, '../frontend')));

// После инициализации Express
app.use('/uploads', express.static(path.join(__dirname, '../uploads')));

// JWT secret
const JWT_SECRET = 'mini_messenger_secret_2025';

// Middleware: проверка токена
function auth(req, res, next) {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'Требуется авторизация' });
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.userId = decoded.id;
    next();
  } catch (e) {
    res.status(401).json({ error: 'Неверный токен' });
  }
}


// Регистрация
app.post('/api/register', async (req, res) => {
  try {
    const { username, password, name } = req.body;
    const hashed = await bcrypt.hash(password, 10);
    const password_hash = await bcrypt.hash(password, 10);
    const user = await User.create({ username, password_hash, name });
    await Chat.addMember(1, user.id); // добавляем в общий чат
    const personalChat = await Chat.create({ name: `Чат ${name}`, is_group: false });
    await Chat.addMember(personalChat.id, user.id);
    const token = jwt.sign({ id: user.id }, JWT_SECRET, { expiresIn: '7d' });
    res.json({ token, user: { id: user.id, name: user.name, avatar: user.avatar } });
  } catch (e) {
    res.status(400).json({ error: e.message || 'Ошибка регистрации' });
  }
});

// Вход
app.post('/api/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    const user = await User.findByUsername(username);
    if (!user || !(await bcrypt.compare(password, user.password_hash))) {
      return res.status(401).json({ error: 'Неверный логин или пароль' });
    }
    const token = jwt.sign({ id: user.id }, JWT_SECRET, { expiresIn: '7d' });
    res.json({ token, user: { id: user.id, name: user.name, avatar: user.avatar } });
  } catch (e) {
    res.status(500).json({ error: 'Ошибка входа' });
  }
});

// Профиль
app.get('/api/profile', auth, async (req, res) => {
  const user = await User.findById(req.userId);
  res.json(user);
});

app.post('/api/profile', auth, async (req, res) => {
  const { name, avatar } = req.body;
  const updated = await User.update(req.userId, { name, avatar });
  res.json(updated);
});

// Удалить чат (только если приватный и не "Общий чат")
// Удалить чат (только если приватный и не "Общий чат")
app.delete('/api/chats/:id', auth, async (req, res) => {
  const chatId = req.params.id;
  const userId = req.userId;
  const db = require('./db/database');

  try {
    // Получаем данные чата и его участников
    const chat = await new Promise((resolve, reject) => {
      db.get(`
        SELECT c.id, c.name, c.is_group
        FROM chats c
        JOIN chat_members cm ON c.id = cm.chat_id
        WHERE c.id = ? AND cm.user_id = ?
      `, [chatId, userId], (err, row) => {
        if (err) reject(err);
        else resolve(row);
      });
    });

    if (!chat) return res.status(404).json({ error: 'Чат не найден' });

    // 🔹 Запрещаем удалять "Общий чат"
    if (chat.name === 'Общий чат') {
      return res.status(403).json({ error: 'Нельзя удалить общий чат' });
    }

    if (chat.is_group) {
      return res.status(400).json({ error: 'Нельзя удалять групповые чаты' });
    }

    // 🔹 Получаем участников чата, чтобы отправить им уведомление
    const members = await new Promise((resolve, reject) => {
      db.all(`
        SELECT user_id FROM chat_members WHERE chat_id = ?
      `, [chatId], (err, rows) => {
        if (err) reject(err);
        else resolve(rows.map(r => r.user_id));
      });
    });

    // Удаляем чат и всё связанное
    await new Promise((resolve, reject) => {
      db.run('DELETE FROM chat_members WHERE chat_id = ?', [chatId], (err) => {
        if (err) reject(err);
        else resolve();
      });
    });
    await new Promise((resolve, reject) => {
      db.run('DELETE FROM messages WHERE chat_id = ?', [chatId], (err) => {
        if (err) reject(err);
        else resolve();
      });
    });
    await new Promise((resolve, reject) => {
      db.run('DELETE FROM chats WHERE id = ?', [chatId], (err) => {
        if (err) reject(err);
        else resolve();
      });
    });

    // 🔹 Отправляем уведомление всем участникам чата (кроме удалившего)
    members.forEach(memberId => {
      if (memberId !== userId) {
        io.to(`user_${memberId}`).emit('chatDeleted', { chatId });
      }
    });

    res.json({ success: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Ошибка удаления чата' });
  }
});

  app.get('/api/chats/unread-counts', auth, async (req, res) => {
    const userId = req.userId;
    const db = require('./db/database');

    try {
      const counts = await new Promise((resolve, reject) => {
        db.all(`
          SELECT 
            c.id AS chat_id,
            COUNT(m.id) AS unread_count
          FROM chats c
          JOIN chat_members cm ON c.id = cm.chat_id
          LEFT JOIN user_chat_read_status rcs ON c.id = rcs.chat_id AND rcs.user_id = ?
          LEFT JOIN messages m ON m.chat_id = c.id
            AND (rcs.last_read_message_id IS NULL OR m.id > rcs.last_read_message_id)
          WHERE cm.user_id = ?
          GROUP BY c.id
        `, [userId, userId], (err, rows) => {
          if (err) reject(err);
          else resolve(rows);
        });
      });

      const result = {};
      counts.forEach(row => {
        result[row.chat_id] = row.unread_count;
      });

      res.json(result);
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: 'Ошибка загрузки счётчиков' });
    }
  });
  
app.post('/api/chats/:id/mark-as-read', auth, async (req, res) => {
  const chatId = req.params.id;
  const userId = req.userId;
  const db = require('./db/database');

  try {
    // Получаем ID последнего сообщения в чате
    const lastMsg = await new Promise((resolve, reject) => {
      db.get('SELECT id FROM messages WHERE chat_id = ? ORDER BY id DESC LIMIT 1', [chatId], (err, row) => {
        if (err) reject(err);
        else resolve(row);
      });
    });

    if (!lastMsg) {
      // Если нет сообщений — просто вставим NULL
      await new Promise((resolve, reject) => {
        db.run(`
          INSERT OR REPLACE INTO user_chat_read_status (user_id, chat_id, last_read_message_id)
          VALUES (?, ?, NULL)
        `, [userId, chatId], (err) => {
          if (err) reject(err);
          else resolve();
        });
      });
    } else {
      await new Promise((resolve, reject) => {
        db.run(`
          INSERT OR REPLACE INTO user_chat_read_status (user_id, chat_id, last_read_message_id)
          VALUES (?, ?, ?)
        `, [userId, chatId, lastMsg.id], (err) => {
          if (err) reject(err);
          else resolve();
        });
      });
    }

    res.json({ success: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Ошибка обновления статуса' });
  }
});

// Получить участников чата
app.get('/api/chats/:chatId/members', auth, async (req, res) => {
  const chatId = req.params.chatId;
  const db = require('./db/database');
  try {
    const members = await new Promise((resolve, reject) => {
      db.all(`
        SELECT u.id, u.username, u.name, u.avatar
        FROM users u
        JOIN chat_members cm ON u.id = cm.user_id
        WHERE cm.chat_id = ?
      `, [chatId], (err, rows) => {
        if (err) reject(err);
        else resolve(rows);
      });
    });
    res.json(members);
  } catch (e) {
    res.status(500).json({ error: 'Ошибка загрузки участников' });
  }
});

// Чаты
app.get('/api/chats', auth, async (req, res) => {
  try {
    // Получаем ID чатов, в которых состоит пользователь
    const db = require('./db/database');
    const chatRows = await new Promise((resolve, reject) => {
      db.all(`
        SELECT c.id, c.name, c.is_group
        FROM chats c
        JOIN chat_members cm ON c.id = cm.chat_id
        WHERE cm.user_id = ?
      `, [req.userId], (err, rows) => {
        if (err) reject(err);
        else resolve(rows);
      });
    });
    res.json(chatRows.map(c => ({ ...c, is_group: Boolean(c.is_group) })));
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Ошибка загрузки чатов' });
  }
});

// Удаление сообщения (только своё!)
app.delete('/api/messages/:id', auth, async (req, res) => {
  const messageId = req.params.id;
  const userId = req.userId;

  const db = require('./db/database');
  try {
    // Проверяем, что сообщение принадлежит пользователю
    const msg = await new Promise((resolve, reject) => {
      db.get('SELECT user_id FROM messages WHERE id = ?', [messageId], (err, row) => {
        if (err) reject(err);
        else resolve(row);
      });
    });

    if (!msg) return res.status(404).json({ error: 'Сообщение не найдено' });
    if (msg.user_id !== userId) return res.status(403).json({ error: 'Нельзя удалять чужие сообщения' });

    // Удаляем
    await new Promise((resolve, reject) => {
      db.run('DELETE FROM messages WHERE id = ?', [messageId], (err) => {
        if (err) reject(err);
        else resolve();
      });
    });

    // Уведомляем через WebSocket (опционально)
    // Можно отправить событие 'messageDeleted'

    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: 'Ошибка удаления' });
  }
});

// Новый маршрут: отправка изображения
app.post('/api/messages/image', auth, upload.single('file'), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'Файл не загружен' });
  }

  const { chatId, reply_to } = req.body; // добавим поддержку ответа на изображение
  const userId = req.userId;
  const filePath = `/uploads/${req.file.filename}`;

  try {
    // Сохраняем сообщение
    const db = require('./db/database');
    const msgId = await new Promise((resolve, reject) => {
      db.run(
        'INSERT INTO messages (chat_id, user_id, text, reply_to) VALUES (?, ?, ?, ?)',
        [chatId, userId, filePath, reply_to || null],
        function (err) {
          if (err) reject(err);
          else resolve(this.lastID);
        }
      );
    });

    // Получаем данные отправителя
    const sender = await User.findById(userId);

    // Получаем данные цитируемого сообщения (если есть)
    let reply_text = null;
    let reply_name = null;
    if (reply_to) {
      const replyMsg = await new Promise((resolve, reject) => {
        db.get(`
          SELECT m.text, u.name 
          FROM messages m
          JOIN users u ON m.user_id = u.id
          WHERE m.id = ?
        `, [reply_to], (err, row) => {
          if (err) reject(err);
          else resolve(row);
        });
      });
      if (replyMsg) {
        reply_text = replyMsg.text;
        reply_name = replyMsg.name;
      }
    }

    // Полное сообщение для отправки
    const fullMsg = {
      id: msgId,
      chat_id: chatId,
      user_id: userId,
      text: filePath,
      created_at: new Date().toISOString(),
      name: sender.name,
      avatar: sender.avatar,
      reply_to,
      reply_text,
      reply_name
    };

    // Отправляем сообщение в чат через WebSocket
    io.to(`chat_${chatId}`).emit('newMessage', fullMsg);

    // 🔹 Рассылка счётчиков непрочитанных (для всех, кроме отправителя)
    const members = await new Promise((resolve, reject) => {
      db.all('SELECT user_id FROM chat_members WHERE chat_id = ?', [chatId], (err, rows) => {
        if (err) reject(err);
        else resolve(rows.map(r => r.user_id));
      });
    });

    for (const memberId of members) {
      if (memberId !== userId) { // не отправителю
        // Получаем счётчик непрочитанных для этого пользователя
        const count = await new Promise((resolve, reject) => {
          db.get(`
            SELECT COUNT(m.id) AS unread_count
            FROM messages m
            LEFT JOIN user_chat_read_status rcs ON m.chat_id = rcs.chat_id AND rcs.user_id = ?
            WHERE m.chat_id = ? AND (rcs.last_read_message_id IS NULL OR m.id > rcs.last_read_message_id)
          `, [memberId, chatId], (err, row) => {
            if (err) reject(err);
            else resolve(row?.unread_count || 0);
          });
        });

        // Отправляем обновление счётчика
        io.to(`user_${memberId}`).emit('unreadCountUpdated', { chatId, count });
      }
    }

    res.json({ success: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Ошибка сохранения изображения' });
  }
});

// Сообщения
app.get('/api/messages/:chatId', auth, async (req, res) => {
  const messages = await Message.getByChat(req.params.chatId);
  res.json(messages);
});

// Отправка сообщения
app.post('/api/messages', auth, async (req, res) => {
  const { chatId, text, reply_to } = req.body;
  const userId = req.userId;

  try {
    // Сохраняем сообщение
    const msg = await Message.create({ chat_id: chatId, user_id: userId, text, reply_to });

    // Получаем данные отправителя
    const sender = await User.findById(userId);

    // Получаем данные цитируемого сообщения (если есть)
    let reply_text = null;
    let reply_name = null;
    if (reply_to) {
      const db = require('./db/database');
      const replyMsg = await new Promise((resolve, reject) => {
        db.get(`
          SELECT m.text, u.name 
          FROM messages m
          JOIN users u ON m.user_id = u.id
          WHERE m.id = ?
        `, [reply_to], (err, row) => {
          if (err) reject(err);
          else resolve(row);
        });
      });
      if (replyMsg) {
        reply_text = replyMsg.text;
        reply_name = replyMsg.name;
      }
    }

    // Полное сообщение для отправки
    const fullMsg = {
      ...msg,
      name: sender.name,
      avatar: sender.avatar,
      user_id: sender.id,
      reply_text,
      reply_name
    };

    // Отправляем сообщение в чат через WebSocket
    io.to(`chat_${chatId}`).emit('newMessage', fullMsg);

    // 🔹 Рассылка счётчиков непрочитанных (для всех, кроме отправителя)
    const db = require('./db/database');
    const members = await new Promise((resolve, reject) => {
      db.all('SELECT user_id FROM chat_members WHERE chat_id = ?', [chatId], (err, rows) => {
        if (err) reject(err);
        else resolve(rows.map(r => r.user_id));
      });
    });

    for (const memberId of members) {
      if (memberId !== userId) { // не отправителю
        // Получаем счётчик непрочитанных для этого пользователя
        const count = await new Promise((resolve, reject) => {
          db.get(`
            SELECT COUNT(m.id) AS unread_count
            FROM messages m
            LEFT JOIN user_chat_read_status rcs ON m.chat_id = rcs.chat_id AND rcs.user_id = ?
            WHERE m.chat_id = ? AND (rcs.last_read_message_id IS NULL OR m.id > rcs.last_read_message_id)
          `, [memberId, chatId], (err, row) => {
            if (err) reject(err);
            else resolve(row?.unread_count || 0);
          });
        });

        // Отправляем обновление счётчика
        io.to(`user_${memberId}`).emit('unreadCountUpdated', { chatId, count });
      }
    }

    res.json(fullMsg);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Ошибка сохранения сообщения' });
  }
});

app.get('/api/users', auth, async (req, res) => {
  const db = require('./db/database');
  try {
    const users = await new Promise((resolve, reject) => {
      db.all('SELECT id, username, name, avatar FROM users WHERE id != ?', [req.userId], (err, rows) => {
        if (err) reject(err);
        else resolve(rows);
      });
    });
    res.json(users);
  } catch (e) {
    res.status(500).json({ error: 'Ошибка загрузки пользователей' });
  }
});

// Создать личный чат с другим пользователем
// Создать личный чат с другим пользователем
app.post('/api/chats/private', auth, async (req, res) => {
  const { userId: targetUserId } = req.body;
  const currentUserId = req.userId;

  if (!targetUserId || targetUserId == currentUserId) {
    return res.status(400).json({ error: 'Некорректный ID пользователя' });
  }

  const db = require('./db/database');
  try {
    // Проверим, существует ли уже чат между ними
    const existing = await new Promise((resolve, reject) => {
      db.get(`
        SELECT c.id FROM chats c
        JOIN chat_members cm1 ON c.id = cm1.chat_id AND cm1.user_id = ?
        JOIN chat_members cm2 ON c.id = cm2.chat_id AND cm2.user_id = ?
        WHERE c.is_group = 0
      `, [currentUserId, targetUserId], (err, row) => {
        if (err) reject(err);
        else resolve(row);
      });
    });

    if (existing) {
      return res.json({ id: existing.id, name: 'Личный чат', is_group: false });
    }

    // Создаём новый чат
    // Получаем имя собеседника
    const targetUser = await User.findById(targetUserId);
    const chatName = targetUser ? `${targetUser.name || targetUser.username}` : `Чат с пользователем ${targetUserId}`;
    const chatId = await new Promise((resolve, reject) => {
      db.run('INSERT INTO chats (name, is_group) VALUES (?, 0)', [chatName], function (err) {
        if (err) reject(err);
        else resolve(this.lastID);
      });
    });

    // Добавляем обоих участников
    await new Promise((resolve, reject) => {
      db.run('INSERT INTO chat_members (chat_id, user_id) VALUES (?, ?)', [chatId, currentUserId], (err) => {
        if (err) reject(err);
        else resolve();
      });
    });
    await new Promise((resolve, reject) => {
      db.run('INSERT INTO chat_members (chat_id, user_id) VALUES (?, ?)', [chatId, targetUserId], (err) => {
        if (err) reject(err);
        else resolve();
      });
    });

    // 🔹 Отправляем уведомление пользователю, с которым создали чат
    io.to(`user_${targetUserId}`).emit('newChatCreated', {
      id: chatId,
      name: chatName,
      is_group: false
    });

    res.json({ id: chatId, name: chatName, is_group: false });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Ошибка создания чата' });
  }
});

// Настройки (заглушка)
app.get('/api/settings', auth, (req, res) => {
  res.json({ theme: 'light', notifications: true });
});

// Обслуживаем фронтенд
app.get('/*path', (req, res) => {
  res.sendFile(path.join(__dirname, '../frontend/index.html'));
});

// Получить онлайн-статус пользователя
app.get('/api/users/:id/online', auth, async (req, res) => {
  try {
    const isOnline = await User.isOnline(req.params.id);
    res.json({ online: isOnline });
  } catch (e) {
    res.status(500).json({ error: 'Ошибка проверки статуса' });
  }
});

// WebSocket
io.use((socket, next) => {
  const token = socket.handshake.auth.token;
  if (!token) return next(new Error('Токен не предоставлен'));
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    socket.userId = decoded.id;
    next();
  } catch (e) {
    next(new Error('Неверный токен'));
  }
});

io.on('connection', (socket) => {
  console.log('Пользователь подключён:', socket.userId);

  User.setOnline(socket.userId);

  socket.join(`user_${socket.userId}`);

  socket.on('joinChat', (chatId) => {
    socket.join(`chat_${chatId}`);
  });

  socket.on('disconnect', () => {
    console.log('Пользователь отключён:', socket.userId);
  });
  
  socket.on('typing', (data) => {
  const { chatId, typing } = data;
  // Отправляем событие всем в чате, кроме отправителя
  socket.to(`chat_${chatId}`).emit('typing', {
    userId: socket.userId,
    typing
  });
});
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`🚀 Сервер запущен на http://localhost:${PORT}`);
});