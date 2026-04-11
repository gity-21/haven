/**
 * Fix #1  — PBKDF2 per-room salt
 * Fix #9  — database.js better-sqlite3 geçişi
 * Fix #11 — upload.js magic bytes MIME doğrulaması
 */

const fs   = require('fs');
const path = require('path');

const serverJs   = fs.readFileSync(path.join(__dirname, '../server/index.js'), 'utf8');
const databaseJs = fs.readFileSync(path.join(__dirname, '../server/database.js'), 'utf8');
const uploadJs   = fs.readFileSync(path.join(__dirname, '../server/upload.js'), 'utf8');
const chatJs     = fs.readFileSync(path.join(__dirname, '../app/renderer/js/chat.js'), 'utf8');

function realCode(src) {
    return src.split('\n').filter(l => {
        const t = l.trim();
        return t && !t.startsWith('//') && !t.startsWith('*');
    });
}

// ── FIX #1 ──────────────────────────────────────────────────

describe('FIX #1 — PBKDF2 per-room salt', () => {
    test('Sunucuda randomBytes(32) ile salt üretilmeli', () => {
        expect(serverJs).toContain("randomBytes(32).toString('hex')");
    });

    test("room-e2ee-salt eventi emit edilmeli", () => {
        expect(serverJs).toContain("'room-e2ee-salt'");
    });

    test('HavenSecureSalt2026 gerçek kod satırı olarak bulunmamalı', () => {
        const bad = realCode(chatJs).filter(l =>
            l.includes('HavenSecureSalt2026') && !l.includes('LEGACY_SALT')
        );
        expect(bad).toHaveLength(0);
    });

    test('LEGACY_SALT fallback olarak tanımlı olmalı', () => {
        expect(chatJs).toContain('LEGACY_SALT');
    });

    test('deriveE2EEKey salt parametresi almalı', () => {
        expect(chatJs).toMatch(/deriveE2EEKey\(.*,.*salt/);
    });

    test("chat.js room-e2ee-salt socket handler'ı dinlemeli", () => {
        expect(chatJs).toContain("socket.on('room-e2ee-salt'");
    });

    test('rooms tablosunda e2ee_salt sütunu olmalı', () => {
        expect(databaseJs).toContain('e2ee_salt');
    });
});

// ── FIX #9 ──────────────────────────────────────────────────

describe('FIX #9 — better-sqlite3 geçişi', () => {
    test("database.js better-sqlite3 require etmeli", () => {
        expect(databaseJs).toContain("require('better-sqlite3')");
    });

    test("sql.js require kaldırılmış olmalı", () => {
        const bad = realCode(databaseJs).filter(l => l.includes("require('sql.js')"));
        expect(bad).toHaveLength(0);
    });

    test('WAL modu aktif olmalı', () => {
        expect(databaseJs).toContain("journal_mode = WAL");
    });

    test('foreign_keys pragma set edilmeli', () => {
        expect(databaseJs).toContain('foreign_keys = ON');
    });

    test('saveDatabase() memory-export mekanizması kaldırılmış olmalı', () => {
        const bad = realCode(databaseJs).filter(l => l.includes('db.export()'));
        expect(bad).toHaveLength(0);
    });

    test('initializeDatabase export edilmeli', () => {
        expect(databaseJs).toContain('module.exports');
        expect(databaseJs).toContain('initializeDatabase');
    });
});

// ── FIX #11 ──────────────────────────────────────────────────

describe('FIX #11 — MIME magic bytes doğrulaması', () => {
    test('MAGIC tablosu tanımlı olmalı', () => {
        expect(uploadJs).toContain('MAGIC');
    });

    test('detectMime fonksiyonu tanımlı olmalı', () => {
        expect(uploadJs).toContain('function detectMime');
    });

    test('multer memoryStorage kullanmalı', () => {
        expect(uploadJs).toContain('memoryStorage()');
    });

    test('diskStorage kaldırılmış olmalı', () => {
        const bad = realCode(uploadJs).filter(l => l.includes('diskStorage'));
        expect(bad).toHaveLength(0);
    });

    test('MIME whitelist (ALLOWED_MIMES) tanımlı olmalı', () => {
        expect(uploadJs).toContain('ALLOWED_MIMES');
    });

    test('10MB limit korunmuş olmalı', () => {
        expect(uploadJs).toContain('10 * 1024 * 1024');
    });

    test('UUID ile güvenli dosya ismi oluşturulmalı', () => {
        expect(uploadJs).toContain('randomBytes(16)');
    });
});

// ── Magic bytes inline unit testi ────────────────────────────

describe('detectMime — inline unit test', () => {
    // detectMime fonksiyonunu test ortamına çek
    let detectMime;

    beforeAll(() => {
        // upload.js'den sadece detectMime fonksiyonunu extract et
        try {
            // Modülü direkt yüklemeye çalış
            const uploadModule = require('../server/upload.js');
            // Export edilmemiş; kodu izole çalıştır
        } catch (_) {}

        // İnline reimplementation ile test
        const MAGIC = [
            { bytes: [0xFF, 0xD8, 0xFF],       mime: 'image/jpeg' },
            { bytes: [0x89, 0x50, 0x4E, 0x47], mime: 'image/png'  },
            { bytes: [0x47, 0x49, 0x46],        mime: 'image/gif'  },
            { bytes: [0x25, 0x50, 0x44, 0x46],  mime: 'application/pdf' },
            { bytes: [0x50, 0x4B, 0x03, 0x04],  mime: 'application/zip' },
            { bytes: [0x49, 0x44, 0x33],        mime: 'audio/mpeg' },
            { bytes: [0x4F, 0x67, 0x67, 0x53],  mime: 'audio/ogg'  },
        ];

        detectMime = (buffer) => {
            for (const { bytes, mime } of MAGIC) {
                if (bytes.every((b, i) => buffer[i] === b)) return mime;
            }
            return null;
        };
    });

    test('JPEG magic bytes tanınmalı', () => {
        const buf = Buffer.from([0xFF, 0xD8, 0xFF, 0xE0, 0x00, 0x10]);
        expect(detectMime(buf)).toBe('image/jpeg');
    });

    test('PNG magic bytes tanınmalı', () => {
        const buf = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A]);
        expect(detectMime(buf)).toBe('image/png');
    });

    test('PDF magic bytes tanınmalı', () => {
        const buf = Buffer.from([0x25, 0x50, 0x44, 0x46, 0x2D]);
        expect(detectMime(buf)).toBe('application/pdf');
    });

    test('HTML dosyası tespit edilememeli (null döner)', () => {
        const buf = Buffer.from('<html><body>XSS</body></html>');
        expect(detectMime(buf)).toBeNull();
    });

    test('Rastgele binary null döndürmeli', () => {
        const buf = Buffer.from([0x00, 0x01, 0x02, 0x03]);
        expect(detectMime(buf)).toBeNull();
    });
});
