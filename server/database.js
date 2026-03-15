/**
 * database.js - Veritabanı ve Depolama Yönetimi
 * 
 * Neler Var:
 * - SQLite veritabanının `sql.js` yardımıyla bellekte oluşturulması ve diske yazılması işlemlerini yürütür.
 * - Veritabanı tablolarının (messages, rooms) başlangıçta oluşturulması.
 * - `sqlite` query'lerini (.get, .all, .run) Express/Socket.io backend'inin daha kolay kullanması için sarmalar (dbWrapper).
 * 
 * Ayarlar:
 * - Veritabanı dosyası `data/dc_chat_v2.db` yolunda tutulur.
 * - Her işlem sonrası `saveDatabase` fonksiyonu ile diske otomatik yazma (save) tetiklenir.
 */

const initSqlJs = require('sql.js');
const path = require('path');
const fs = require('fs');

const dataDir = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

const dbPath = path.join(dataDir, 'dc_chat_v2.db'); // Yeni DB dosyası (eskiyi silmemek/çakışmamak için v2)

let db = null;
let saveTimer = null;

function saveDatabase() {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    if (db) {
      const data = db.export();
      const buffer = Buffer.from(data);
      fs.writeFileSync(dbPath, buffer);
    }
  }, 100);
}

function saveDatabaseSync() {
  if (db) {
    const data = db.export();
    const buffer = Buffer.from(data);
    fs.writeFileSync(dbPath, buffer);
  }
}

const dbWrapper = {
  prepare(sql) {
    return {
      get(...params) {
        try {
          const stmt = db.prepare(sql);
          if (params.length > 0) stmt.bind(params);
          if (stmt.step()) {
            const columns = stmt.getColumnNames();
            const values = stmt.get();
            const row = {};
            columns.forEach((col, i) => { row[col] = values[i]; });
            stmt.free();
            return row;
          }
          stmt.free();
          return undefined;
        } catch (error) {
          console.error('DB get error:', sql, params, error.message);
          return undefined;
        }
      },
      all(...params) {
        try {
          const results = [];
          const stmt = db.prepare(sql);
          if (params.length > 0) stmt.bind(params);
          while (stmt.step()) {
            const columns = stmt.getColumnNames();
            const values = stmt.get();
            const row = {};
            columns.forEach((col, i) => { row[col] = values[i]; });
            results.push(row);
          }
          stmt.free();
          return results;
        } catch (error) {
          console.error('DB all error:', sql, params, error.message);
          return [];
        }
      },
      run(...params) {
        try {
          if (params.length > 0) db.run(sql, params);
          else db.run(sql);

          saveDatabase();
          const lastIdResult = db.exec('SELECT last_insert_rowid() as id');
          const lastId = lastIdResult.length > 0 ? lastIdResult[0].values[0][0] : 0;
          return { lastInsertRowid: lastId };
        } catch (error) {
          console.error('DB run error:', sql, params, error.message);
          return { lastInsertRowid: 0 };
        }
      }
    };
  },
  exec(sql) {
    try { db.run(sql); saveDatabase(); } catch (error) { console.error('DB exec error:', error.message); }
  },
  pragma(pragmaStr) {
    try { db.run(`PRAGMA ${pragmaStr}`); } catch (e) { }
  },
  save: saveDatabaseSync
};

async function initializeDatabase() {
  const SQL = await initSqlJs();

  if (fs.existsSync(dbPath)) {
    const fileBuffer = fs.readFileSync(dbPath);
    db = new SQL.Database(fileBuffer);
    console.log('📂 Mevcut oda veritabanı yüklendi (v2)');
  } else {
    db = new SQL.Database();
    console.log('🆕 Yeni oda veritabanı oluşturuldu (v2)');
  }

  // Sadece mesajlar tablosu yeterli. Kanal veya hesap yok.
  db.run(`
    CREATE TABLE IF NOT EXISTS messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      room_key TEXT NOT NULL,
      username TEXT NOT NULL,
      avatar_color TEXT NOT NULL,
      content TEXT NOT NULL,
      type TEXT DEFAULT 'message',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  try {
    db.run(`CREATE INDEX IF NOT EXISTS idx_messages_room ON messages(room_key, created_at DESC)`);
  } catch (e) { }

  // Yanıt (reply) özelliği için veritabanı güncellemesi
  try {
    db.run(`ALTER TABLE messages ADD COLUMN reply_to INTEGER`);
  } catch (e) { }

  // Profil fotoğrafı özelliği için
  try {
    db.run(`ALTER TABLE messages ADD COLUMN profile_pic TEXT`);
  } catch (e) { }

  // Oturum güvenliği için
  try {
    db.run(`ALTER TABLE messages ADD COLUMN session_id TEXT`);
  } catch (e) { }

  // Reaksiyonlar (Emojiler) için
  try {
    db.run(`ALTER TABLE messages ADD COLUMN reactions TEXT DEFAULT '{}'`);
  } catch (e) { }

  // Kalıcı kullanıcı kimliği için
  try {
    db.run(`ALTER TABLE messages ADD COLUMN user_id TEXT`);
  } catch (e) { }

  // Oda yetkilendirme (Password) tablosu
  db.run(`
    CREATE TABLE IF NOT EXISTS rooms (
      room_key TEXT PRIMARY KEY,
      password_hash TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  saveDatabaseSync();
  console.log('✅ Minimal veritabanı başarıyla başlatıldı');

  return dbWrapper;
}

module.exports = { initializeDatabase, dbWrapper };
