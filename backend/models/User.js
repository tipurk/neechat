const db = require('../db/database');

class User {
  static async findByUsername(username) {
    return new Promise((resolve, reject) => {
      db.get('SELECT * FROM users WHERE username = ?', [username], (err, row) => {
        if (err) reject(err);
        else resolve(row);
      });
    });
  }

  static async create({ username, password_hash, name }) {
    return new Promise((resolve, reject) => {
      db.run(
        'INSERT INTO users (username, password_hash, name) VALUES (?, ?, ?)',
        [username, password_hash, name],
        function (err) {
          if (err) reject(err);
          else resolve({ id: this.lastID, username, name });
        }
      );
    });
  }

  static async findById(id) {
    return new Promise((resolve, reject) => {
      db.get('SELECT id, username, name, avatar FROM users WHERE id = ?', [id], (err, row) => {
        if (err) reject(err);
        else resolve(row);
      });
    });
  }

  static async update(id, { name, avatar }) {
    return new Promise((resolve, reject) => {
      db.run(
        'UPDATE users SET name = ?, avatar = ? WHERE id = ?',
        [name, avatar, id],
        function (err) {
          if (err) reject(err);
          else resolve({ id, name, avatar });
        }
      );
    });
  }
static async setOnline(id) {
  return new Promise((resolve, reject) => {
    db.run('UPDATE users SET last_seen = CURRENT_TIMESTAMP WHERE id = ?', [id], (err) => {
      if (err) reject(err);
      else resolve();
    });
  });
}

  static async isOnline(id) {
    return new Promise((resolve, reject) => {
      db.get('SELECT last_seen FROM users WHERE id = ?', [id], (err, row) => {
        if (err) reject(err);
        else {
          if (!row) return resolve(false);
          const lastSeen = new Date(row.last_seen).getTime();
          const now = Date.now();
          const online = (now - lastSeen) < 30_000; // 30 секунд
          resolve(online);
        }
      });
    });
  }
}



module.exports = User;