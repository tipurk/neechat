// backend/db/init.js
const db = require('./database');

function initDatabase() {
  console.log('🗄️ Инициализация базы данных...');

  // Создаём таблицы
  db.serialize(() => {
    db.run(`
    CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT UNIQUE NOT NULL,
        password_hash TEXT NOT NULL,
        name TEXT,
        avatar TEXT DEFAULT '👤',
        last_seen DATETIME DEFAULT CURRENT_TIMESTAMP
    )
    `);
    
    db.run(`
      CREATE TABLE IF NOT EXISTS user_chat_read_status (
        user_id INTEGER NOT NULL,
        chat_id INTEGER NOT NULL,
        last_read_message_id INTEGER,
        FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE,
        FOREIGN KEY(chat_id) REFERENCES chats(id) ON DELETE CASCADE,
        FOREIGN KEY(last_read_message_id) REFERENCES messages(id) ON DELETE SET NULL,
        PRIMARY KEY(user_id, chat_id)
      )
    `);

    db.run(`
      CREATE TABLE IF NOT EXISTS chats (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        is_group BOOLEAN DEFAULT 0
      )
    `);

    db.run(`
      CREATE TABLE IF NOT EXISTS chat_members (
        chat_id INTEGER,
        user_id INTEGER,
        FOREIGN KEY(chat_id) REFERENCES chats(id) ON DELETE CASCADE,
        FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE,
        PRIMARY KEY(chat_id, user_id)
      )
    `);

    db.run(`
    CREATE TABLE IF NOT EXISTS messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        chat_id INTEGER NOT NULL,
        user_id INTEGER NOT NULL,
        text TEXT NOT NULL,
        reply_to INTEGER,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY(chat_id) REFERENCES chats(id) ON DELETE CASCADE,
        FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE,
        FOREIGN KEY(reply_to) REFERENCES messages(id) ON DELETE SET NULL
    )
    `);

    // Проверяем, есть ли уже пользователи
    db.get("SELECT COUNT(*) as cnt FROM users", (err, row) => {
      if (err) {
        console.error('❌ Ошибка при проверке пользователей:', err);
        return;
      }

      if (row.cnt === 0) {
        console.log('🆕 База пустая — создаём демо-пользователя и чат...');
        const demoPassHash = '$2b$10$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2.uheWG/igi'; // password = "password"

        db.run(
          "INSERT INTO users (username, password_hash, name) VALUES (?, ?, ?)",
          ['demo', demoPassHash, 'Demo User'],
          function (err) {
            if (err) {
              console.error('❌ Не удалось создать пользователя:', err.message);
              return;
            }
            const userId = this.lastID;
            console.log(`✅ Пользователь создан (ID: ${userId})`);

            // Создаём чат
            db.run(
              "INSERT INTO chats (name, is_group) VALUES (?, ?)",
              ['Общий чат', 1],
              function (err) {
                if (err) {
                  console.error('❌ Не удалось создать чат:', err.message);
                  return;
                }
                const chatId = this.lastID;
                console.log(`✅ Чат создан (ID: ${chatId})`);

                // Добавляем пользователя в чат
                db.run(
                  "INSERT INTO chat_members (chat_id, user_id) VALUES (?, ?)",
                  [chatId, userId],
                  (err) => {
                    if (err) {
                      console.error('❌ Не удалось добавить в чат:', err.message);
                    } else {
                      console.log('✅ Пользователь добавлен в чат');
                    }
                  }
                );
              }
            );
          }
        );
      } else {
        console.log('✅ Пользователи уже существуют — пропускаем создание демо-данных');
      }
    });
  });
}

module.exports = { initDatabase };