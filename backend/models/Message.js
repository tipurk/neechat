const db = require('../db/database');

class Message {
  static createTable() {
    db.run(`
      CREATE TABLE IF NOT EXISTS messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        chat_id INTEGER NOT NULL,
        user_id INTEGER NOT NULL,
        text TEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY(chat_id) REFERENCES chats(id),
        FOREIGN KEY(user_id) REFERENCES users(id)
      )
    `);
  }

  static async create({ chat_id, user_id, text, reply_to }) {
    return new Promise((resolve, reject) => {
      db.run(
        'INSERT INTO messages (chat_id, user_id, text, reply_to) VALUES (?, ?, ?, ?)',
        [chat_id, user_id, text, reply_to || null],
        function (err) {
          if (err) reject(err);
          else resolve({ id: this.lastID, chat_id, user_id, text, reply_to, created_at: new Date().toISOString() });
        }
      );
    });
  }

  static async getByChat(chatId) {
    return new Promise((resolve, reject) => {
      db.all(
        `SELECT 
          m.id, m.chat_id, m.user_id, m.text, m.reply_to, m.created_at,
          u.name, u.avatar,
          rm.text AS reply_text,
          ru.name AS reply_name
        FROM messages m
        JOIN users u ON m.user_id = u.id
        LEFT JOIN messages rm ON m.reply_to = rm.id
        LEFT JOIN users ru ON rm.user_id = ru.id
        WHERE m.chat_id = ?
        ORDER BY m.created_at ASC`,
        [chatId],
        (err, rows) => {
          if (err) reject(err);
          else resolve(rows);
        }
      );
    });
  }
}

module.exports = Message;