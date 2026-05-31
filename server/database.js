/**
 * database.js - Veritabanı Yönetimi
 *
 * sql.js (WASM tabanlı SQLite) kullanılıyor.
 * Native derleme (C++ / Visual Studio Build Tools) gerektirmez.
 *
 * better-sqlite3 uyumlu senkron API wrapper:
 *   db.prepare(sql).get(params)   → tek satır döner
 *   db.prepare(sql).all(params)   → tüm satırları döner
 *   db.prepare(sql).run(params)   → { changes, lastInsertRowid } döner
 *   db.exec(sql)                  → toplu SQL çalıştırır
 *   db.pragma(str)                → sql.js'de PRAGMA komutu çalıştırır
 *
 * Veriler data/haven.db dosyasına periyodik ve değişiklik sonrası kaydedilir.
 */

const initSqlJs = require('sql.js');
const path = require('path');
const fs = require('fs');

const dataDir = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
}

const dbPath = path.join(dataDir, 'haven.db');

let sqliteDb = null;   // sql.js Database nesnesi
let isDirty = false;   // Diske yazma gerekiyor mu?

// ---- Diske kaydetme mantığı ----
function saveToDisk() {
    if (!sqliteDb || !isDirty) return;
    try {
        const data = sqliteDb.export();
        const buffer = Buffer.from(data);
        fs.writeFileSync(dbPath, buffer);
        isDirty = false;
    } catch (e) {
        console.error('DB diske kaydedilemedi:', e);
    }
}

// Her 30 saniyede bir otomatik kaydet
let saveInterval = null;

// ---- better-sqlite3 uyumlu wrapper ----
function createBetterSqlite3Wrapper(db) {
    const wrapper = {
        prepare(sql) {
            return {
                get(...params) {
                    const flatParams = params.length === 1 && Array.isArray(params[0]) ? params[0] : params;
                    try {
                        const stmt = db.prepare(sql);
                        stmt.bind(flatParams.length > 0 ? flatParams : undefined);
                        if (stmt.step()) {
                            const row = stmt.getAsObject();
                            stmt.free();
                            return row;
                        }
                        stmt.free();
                        return undefined;
                    } catch (e) {
                        throw e;
                    }
                },
                all(...params) {
                    const flatParams = params.length === 1 && Array.isArray(params[0]) ? params[0] : params;
                    try {
                        const results = [];
                        const stmt = db.prepare(sql);
                        stmt.bind(flatParams.length > 0 ? flatParams : undefined);
                        while (stmt.step()) {
                            results.push(stmt.getAsObject());
                        }
                        stmt.free();
                        return results;
                    } catch (e) {
                        throw e;
                    }
                },
                run(...params) {
                    const flatParams = params.length === 1 && Array.isArray(params[0]) ? params[0] : params;
                    try {
                        db.run(sql, flatParams.length > 0 ? flatParams : undefined);
                        isDirty = true;
                        // Hemen kaydet (veri kaybını önlemek için)
                        saveToDisk();
                        return {
                            changes: db.getRowsModified(),
                            lastInsertRowid: getLastInsertRowId(db)
                        };
                    } catch (e) {
                        throw e;
                    }
                }
            };
        },
        exec(sql) {
            db.run(sql);
            isDirty = true;
            saveToDisk();
        },
        pragma(pragmaStr) {
            // sql.js'de PRAGMA ifadelerini doğrudan çalıştır
            try {
                db.run(`PRAGMA ${pragmaStr}`);
            } catch (e) {
                // Bazı PRAGMA'lar sql.js'de desteklenmeyebilir (WAL modu gibi)
                console.warn(`[DB] PRAGMA ${pragmaStr} uygulanamadı (sql.js sınırlaması):`, e.message);
            }
        }
    };
    return wrapper;
}

function getLastInsertRowId(db) {
    try {
        const stmt = db.prepare('SELECT last_insert_rowid() as id');
        if (stmt.step()) {
            const row = stmt.getAsObject();
            stmt.free();
            return row.id;
        }
        stmt.free();
    } catch (e) {
        console.error('last_insert_rowid hatası:', e);
    }
    return 0;
}

let db = null; // wrapper referansı (index.js'deki db değişkeni ile uyumlu)

async function initializeDatabase() {
    const SQL = await initSqlJs();

    // Mevcut DB dosyasını yükle veya yeni oluştur
    if (fs.existsSync(dbPath)) {
        const fileBuffer = fs.readFileSync(dbPath);
        sqliteDb = new SQL.Database(fileBuffer);
        console.log('📂 Mevcut veritabanı yüklendi:', dbPath);
    } else {
        sqliteDb = new SQL.Database();
        console.log('🆕 Yeni veritabanı oluşturuldu:', dbPath);
    }

    // PRAGMA ayarları
    try { sqliteDb.run('PRAGMA foreign_keys = ON'); } catch (e) { /* ignore */ }
    try { sqliteDb.run('PRAGMA synchronous = NORMAL'); } catch (e) { /* ignore */ }

    // Tablolar
    sqliteDb.run(`
        CREATE TABLE IF NOT EXISTS rooms (
            room_key      TEXT PRIMARY KEY,
            password_hash TEXT NOT NULL,
            e2ee_salt     TEXT,
            created_at    DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    `);

    sqliteDb.run(`
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
            is_edited    BOOLEAN DEFAULT 0,
            edit_history TEXT DEFAULT '[]',
            created_at   DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    `);

    // Geriye dönük uyumluluk: Eski veritabanı dosyaları için sütunları eklemeyi dene
    try { sqliteDb.run('ALTER TABLE messages ADD COLUMN is_edited BOOLEAN DEFAULT 0'); } catch (e) { /* Sütun zaten varsa hata verir, yoksay */ }
    try { sqliteDb.run("ALTER TABLE messages ADD COLUMN edit_history TEXT DEFAULT '[]'"); } catch (e) { /* Sütun zaten varsa hata verir, yoksay */ }

    sqliteDb.run(`
        CREATE INDEX IF NOT EXISTS idx_messages_room
            ON messages(room_key, created_at DESC)
    `);

    isDirty = true;
    saveToDisk();

    // Periyodik kaydetme (30 saniyede bir)
    saveInterval = setInterval(saveToDisk, 30000);

    // Kapanışta kaydet
    process.on('exit', saveToDisk);
    process.on('SIGINT', () => { saveToDisk(); process.exit(0); });
    process.on('SIGTERM', () => { saveToDisk(); process.exit(0); });

    db = createBetterSqlite3Wrapper(sqliteDb);

    console.log('✅ sql.js veritabanı hazır:', dbPath);

    // better-sqlite3 API uyumlu wrapper döndür
    return db;
}

// Eski import uyumluluğu: { initializeDatabase, dbWrapper }
const dbWrapper = {
    prepare(sql) {
        if (!db) throw new Error('Veritabanı henüz başlatılmadı');
        return db.prepare(sql);
    }
};

module.exports = { initializeDatabase, dbWrapper };
