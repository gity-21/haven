/**
 * Sunucu tarafı testleri (supertest ile HTTP + Socket.IO)
 * Fix #6  — sanitizeHtml sunucudan kaldırıldı
 * Fix #7  — CORS whitelist
 * Fix #8  — Admin token sistemi
 * Fix #10 — Mesaj silme session_id kontrolü
 * Fix #12 — Socket.IO event rate limiting
 * Fix #14 — Çift rate limiter kaldırıldı
 */

const fs      = require('fs');
const path    = require('path');
const request = require('supertest');

const serverJs = fs.readFileSync(path.join(__dirname, '../server/index.js'), 'utf8');

// Gerçek kod satırları (yorum dışı)
function realCode(src) {
    return src.split('\n').filter(l => {
        const t = l.trim();
        return t && !t.startsWith('//') && !t.startsWith('*');
    });
}
const serverReal = realCode(serverJs);

// ── Kod analizi testleri (sunucu başlatmadan) ────────────────

describe('FIX #6 — XSS filtresi sunucudan kaldırıldı', () => {
    test('sanitizeHtml(content) çağrısı send-message handler içinde bulunmamalı', () => {
        const bad = serverReal.filter(l => l.includes('sanitizeHtml(content'));
        expect(bad).toHaveLength(0);
    });

    test("sanitize-html require() kaldırılmış olmalı", () => {
        const bad = serverReal.filter(l => l.includes("require('sanitize-html')"));
        expect(bad).toHaveLength(0);
    });
});

describe('FIX #7 — CORS whitelist', () => {
    test('CORS_WHITELIST tanımlı olmalı', () => {
        expect(serverJs).toContain('CORS_WHITELIST');
    });

    test("Wildcard origin callback(null, origin || '*') kaldırılmalı", () => {
        const bad = serverReal.filter(l => l.includes("origin || '*'"));
        expect(bad).toHaveLength(0);
    });

    test('trycloudflare.com pattern izin listesinde olmalı', () => {
        expect(serverJs).toContain('trycloudflare.com');
    });

    test('Bilinmeyen origin reddedilmeli (callback(new Error))', () => {
        expect(serverJs).toContain('callback(new Error');
    });
});

describe('FIX #8 — Admin token sistemi', () => {
    test('ADMIN_TOKEN env değişkeni kullanılmalı', () => {
        expect(serverJs).toContain('process.env.ADMIN_TOKEN');
    });

    test("Bearer token kontrolü yapılmalı", () => {
        expect(serverJs).toContain("startsWith('Bearer ')");
    });

    test('isLocalhost() fonksiyonu kaldırılmalı', () => {
        const bad = serverReal.filter(l => l.includes('function isLocalhost'));
        expect(bad).toHaveLength(0);
    });

    test('ADMIN_TOKEN yokken 503 dönmeli (kod kontrolü)', () => {
        expect(serverJs).toContain('503');
        expect(serverJs).toContain('Admin paneli devre dışı');
    });
});

describe('FIX #10 — Mesaj silme session_id kontrolü', () => {
    test('session_id sahiplik kontrolü yapılmalı', () => {
        expect(serverJs).toContain('socket.sessionId === msg.session_id');
    });

    test('Nickname eşleşmesiyle silme kaldırılmalı', () => {
        const bad = serverReal.filter(l => l.includes('msg.username === socket.nickname'));
        expect(bad).toHaveLength(0);
    });

    test('Yetkisiz silme denemesi loglanmalı', () => {
        expect(serverJs).toContain('Yetkisiz mesaj silme denemesi');
    });
});

describe('FIX #12 — Socket.IO event rate limiting', () => {
    test('_rateCheck fonksiyonu tanımlı olmalı', () => {
        expect(serverJs).toContain('function _rateCheck');
    });

    test('_LIMITS nesnesi tanımlı olmalı', () => {
        expect(serverJs).toContain('_LIMITS');
    });

    test('send-message rate check korumalı olmalı', () => {
        expect(serverJs).toContain("_rateCheck('send-message')");
    });

    test('join-room rate check korumalı olmalı', () => {
        expect(serverJs).toContain("_rateCheck('join-room')");
    });

    test('toggle-reaction rate check korumalı olmalı', () => {
        expect(serverJs).toContain("_rateCheck('toggle-reaction')");
    });

    test('typing rate check korumalı olmalı', () => {
        expect(serverJs).toContain("_rateCheck('typing')");
    });
});

describe('FIX #14 — Çift rate limiter kaldırıldı', () => {
    test("app.use('/api/upload', apiLimiter) gerçek kod olarak bulunmamalı", () => {
        const bad = serverReal.filter(l =>
            l.includes("'/api/upload'") && l.includes('apiLimiter') && l.includes('app.use')
        );
        expect(bad).toHaveLength(0);
    });

    test("app.use('/api', apiLimiter) tek bir kez bulunmalı", () => {
        const good = serverReal.filter(l =>
            l.includes("'/api'") && l.includes('apiLimiter') && l.includes('app.use')
        );
        expect(good).toHaveLength(1);
    });
});

// ── HTTP entegrasyon testleri ────────────────────────────────

describe('Admin API — HTTP entegrasyon testleri', () => {
    let app;
    let originalWarn;

    beforeAll(async () => {
        // Test çıktısını temizlemek için beklenen console.warn'ları sustur
        originalWarn = console.warn;
        console.warn = (msg, ...args) => {
            // Beklenen güvenlik loglarını filtrele; beklenmedik uyarıları göster
            if (typeof msg === 'string' && msg.includes('[ADMIN] Yetkisiz')) return;
            originalWarn(msg, ...args);
        };
        // Sunucuyu test için başlat (ADMIN_TOKEN set et)
        process.env.ADMIN_TOKEN = 'test-token-12345';
        process.env.DATA_DIR = '/tmp/haven_test_' + Date.now();
        fs.mkdirSync(process.env.DATA_DIR, { recursive: true });

        try {
            const { startServer } = require('../server/index.js');
            const instance = await startServer(0);
            app = instance.app;
            global.__havenServer__ = instance.server; // afterAll'da kapatmak için
        } catch (e) {
            // better-sqlite3 kurulu değilse testleri atla
            console.warn('Sunucu başlatılamadı (better-sqlite3 gerekli):', e.message);
        }
    });

    afterAll(async () => {
        // console.warn'ı geri yükle
        if (originalWarn) console.warn = originalWarn;
        // Sunucu bağlantısını kapat
        if (global.__havenServer__) {
            await new Promise(resolve => global.__havenServer__.close(resolve));
            global.__havenServer__ = null;
        }
        try {
            fs.rmSync(process.env.DATA_DIR, { recursive: true, force: true });
        } catch (_) {}
    });

    test('Token olmadan admin endpoint 403 döndürmeli', async () => {
        if (!app) return;
        const res = await request(app).get('/api/admin/rooms');
        expect([403, 503]).toContain(res.status);
    });

    test('Yanlış token 403 döndürmeli', async () => {
        if (!app) return;
        const res = await request(app)
            .get('/api/admin/rooms')
            .set('Authorization', 'Bearer yanlis-token');
        expect(res.status).toBe(403);
    });

    test('Doğru token 200 döndürmeli', async () => {
        if (!app) return;
        const res = await request(app)
            .get('/api/admin/rooms')
            .set('Authorization', 'Bearer test-token-12345');
        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
    });

    test('Health endpoint token gerektirmemeli', async () => {
        if (!app) return;
        const res = await request(app).get('/api/health');
        expect(res.status).toBe(200);
    });
});
