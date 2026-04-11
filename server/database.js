/**
 * database.js - Veritabanı Yönetimi
 *
 * FIX #9: sql.js (in-memory WASM) → better-sqlite3 (dosya tabanlı, senkron)
 *
 * Neden değiştirildi:
 * - sql.js her mesajda tüm DB'yi RAM'den diske export ediyordu (I/O bottleneck)
 * - DB büyüdükçe RAM kullanımı artıyordu (memory leak benzeri davranış)
 * - Sunucu çökünce son export anından bu yana mesajlar kaybolabiliyordu
 *
 * better-sqlite3 avantajları:
 * - Dosya tabanlı: her işlem doğrudan diske yazılır
 * - WAL modu: eş zamanlı okuma/yazma + çökme güvenliği
 * - Senkron API: aynı .prepare().get/all/run() kullanımı, wrapper gereksiz
 * - WASM yok: başlangıç süresi çok daha kısa
 *
 * Kurulum (proje dizininde çalıştır):
 *   npm uninstall sql.js
 *   npm install better-sqlite3
 */

const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const dataDir = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
}

// Yeni DB dosyası — eski dc_chat_v2.db ile çakışmıyor
const dbPath = path.join(dataDir, 'haven.db');

let db = null;

async function initializeDatabase() {
    db = new Database(dbPath);

    // WAL modu: okuma/yazma eş zamanlı çalışır, çökme durumunda veri güvenli kalır
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
    db.pragma('synchronous = NORMAL'); // WAL ile güvenli, FULL'dan hızlı

    // Tablolar
    db.exec(`
        CREATE TABLE IF NOT EXISTS rooms (
            room_key      TEXT PRIMARY KEY,
            password_hash TEXT NOT NULL,
            e2ee_salt     TEXT,         -- FIX #1: per-room rastgele PBKDF2 salt
            created_at    DATETIME DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS messages (
            id           INTEGER PRIMARY KEY AUTOINCREMENT,
            room_key     TEXT NOT NULL,
            username     TEXT NOT NULL,
            avatar_color TEXT NOT NULL DEFAULT '#6366f1',
            content      TEXT NOT NULL,
            type         TEXT DEFAULT 'message',
            reply_to     INTEGER,
            profile_pic  TEXT,
            session_id   TEXT,
            reactions    TEXT DEFAULT '{}',
            user_id      TEXT,
            created_at   DATETIME DEFAULT CURRENT_TIMESTAMP
        );

        CREATE INDEX IF NOT EXISTS idx_messages_room
            ON messages(room_key, created_at DESC);
    `);

    console.log('✅ better-sqlite3 veritabanı hazır (WAL modu):', dbPath);

    // better-sqlite3 API'si senkron ve doğrudan — dbWrapper'a gerek yok
    // index.js'deki tüm db.prepare().get/all/run() çağrıları olduğu gibi çalışır
    return db;
}

// Eski sql.js dbWrapper uyumluluğu için — index.js import'u değişmez
// { initializeDatabase, dbWrapper } destructuring'i bozmamak adına dbWrapper da export edilir.
// Ancak better-sqlite3'te dbWrapper = db'nin kendisi (aynı API).
// index.js'de dbWrapper kullanan admin endpoint'leri artık db'yi direkt kullanacak.
const dbWrapper = {
    prepare(sql) {
        return db.prepare(sql);
    }
};

module.exports = { initializeDatabase, dbWrapper };
