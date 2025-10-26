const db = require('../db/database');

class Chat {
  static createTable() {
    db.run(`
      CREATE TABLE IF NOT EXISTS chats (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        is_group BOOLEAN DEFAULT 0
      )
    `);

    // Связь пользователь-чат (для групп)
    db.run(`
      CREATE TABLE IF NOT EXISTS chat_members (
        chat_id INTEGER,
        user_id INTEGER,
        FOREIGN KEY(chat_id) REFERENCES chats(id),
        FOREIGN KEY(user_id) REFERENCES users(id),
        PRIMARY KEY(chat_id, user_id)
      )
    `);
  }

  static async create({ name, is_group = false }) {
    return new Promise((resolve, reject) => {
      db.run(
        'INSERT INTO chats (name, is_group) VALUES (?, ?)',
        [name, is_group ? 1 : 0],
        function (err) {
          if (err) reject(err);
          else resolve({ id: this.lastID, name, is_group });
        }
      );
    });
  }

  static async getAll() {
    return new Promise((resolve, reject) => {
      db.all('SELECT * FROM chats', (err, rows) => {
        if (err) reject(err);
        else resolve(rows.map(c => ({ ...c, is_group: Boolean(c.is_group) })));
      });
    });
  }

  static async addMember(chatId, userId) {
    return new Promise((resolve, reject) => {
      db.run('INSERT OR IGNORE INTO chat_members (chat_id, user_id) VALUES (?, ?)', [chatId, userId], (err) => {
        if (err) reject(err);
        else resolve();
      });
    });
  }
}

module.exports = Chat;