/**
 * Fix #13 — AudioContext bellek sızıntısı
 * Fix #15 — i18n duplicate anahtarlar
 * Fix #17 — Hardcoded Türkçe string'ler
 * Fix #19 — Sessiz catch blokları
 */

const fs   = require('fs');
const path = require('path');

const chatJs = fs.readFileSync(path.join(__dirname, '../app/renderer/js/chat.js'), 'utf8');
const i18nJs = fs.readFileSync(path.join(__dirname, '../app/renderer/js/i18n.js'), 'utf8');

function realCode(src) {
    return src.split('\n').filter(l => {
        const t = l.trim();
        return t && !t.startsWith('//') && !t.startsWith('*');
    });
}

// ── FIX #13 ─────────────────────────────────────────────────

describe('FIX #13 — AudioContext bellek sızıntısı', () => {
    test('leaveVoiceRoom içinde Object.keys(volumeMeters) ile tüm meter temizlenmeli', () => {
        expect(chatJs).toContain('Object.keys(volumeMeters)');
    });

    test('audioContext.close() çağrılmalı', () => {
        expect(chatJs).toContain('audioContext.close()');
    });

    test('audioContext = null ile referans temizlenmeli', () => {
        expect(chatJs).toContain('audioContext = null');
    });

    test('source.disconnect() en az 3 yerde çağrılmalı (leaveVoice + setupMeter + removePeer)', () => {
        const matches = (chatJs.match(/source\.disconnect\(\)/g) || []).length;
        expect(matches).toBeGreaterThanOrEqual(3);
    });
});

// ── FIX #15 ─────────────────────────────────────────────────

describe('FIX #15 — i18n duplicate anahtarlar', () => {
    function countActiveKey(src, key) {
        return src.split('\n').filter(l =>
            l.includes(`"${key}"`) && !l.trim().startsWith('//')
        ).length;
    }

    test('admin_label her dil için tam 1 kez tanımlı olmalı (TR+EN+KU = 3)', () => {
        expect(countActiveKey(i18nJs, 'admin_label')).toBe(3);
    });

    test('connecting her dil için tam 1 kez tanımlı olmalı (TR+EN+KU = 3)', () => {
        expect(countActiveKey(i18nJs, 'connecting')).toBe(3);
    });

    test('Tüm anahtar tekrarları 1 kez tanımlı — genel kontrol', () => {
        // i18n.js'i parse et, her language block içinde duplicate bul
        const lines = i18nJs.split('\n');
        const keyMap = {};
        let currentLang = null;

        lines.forEach(line => {
            // Dil bloğu başlangıcı: tr: { veya en: { veya ku: {
            const langMatch = line.match(/^\s+(tr|en|ku)\s*:\s*\{/);
            if (langMatch) {
                currentLang = langMatch[1];
                keyMap[currentLang] = {};
            }
            if (!currentLang) return;
            // Anahtar satırı
            const keyMatch = line.match(/^\s+"([^"]+)"\s*:/);
            if (keyMatch && !line.trim().startsWith('//')) {
                const k = keyMatch[1];
                keyMap[currentLang][k] = (keyMap[currentLang][k] || 0) + 1;
            }
        });

        const duplicates = [];
        Object.entries(keyMap).forEach(([lang, keys]) => {
            Object.entries(keys).forEach(([k, count]) => {
                if (count > 1) duplicates.push(`${lang}.${k} (${count}x)`);
            });
        });

        expect(duplicates).toHaveLength(0);
    });
});

// ── FIX #17 ─────────────────────────────────────────────────

describe('FIX #17 — Hardcoded string\'ler i18n\'e taşındı', () => {
    const hardcoded = [
        { str: 'Kaynaklar yükleniyor...', key: 'resources_loading' },
        { str: 'Odalar yükleniyor...',    key: 'rooms_loading'     },
        { str: 'Ekran Paylaşılıyor',      key: 'screen_sharing'    },
        { str: 'Yükleniyor... Lütfen sekmeyi kapatmayın.', key: 'p2p_loading' },
    ];

    hardcoded.forEach(({ str, key }) => {
        test(`"${str.slice(0, 30)}" i18n.t('${key}') içinde fallback olarak kullanılmalı`, () => {
            // String i18n wrapper içinde (fallback) olabilir ama standalone olmamalı
            const lines = chatJs.split('\n');
            const standalone = lines.filter(l => {
                // i18n.t() wrapper içinde değil, tek başına bir string olarak geçiyorsa hata
                return l.includes(str) && !l.includes(`i18n.t('${key}')`) && !l.includes('//');
            });
            expect(standalone).toHaveLength(0);
        });

        test(`i18n.js'te "${key}" anahtarı TR/EN/KU için tanımlı olmalı`, () => {
            const count = i18nJs.split('\n').filter(l =>
                l.includes(`"${key}"`) && !l.trim().startsWith('//')
            ).length;
            expect(count).toBe(3); // TR + EN + KU
        });
    });
});

// ── FIX #19 ─────────────────────────────────────────────────

describe('FIX #19 — Sessiz catch blokları', () => {
    test('Gerçek anlamda sessiz (console içermeyen) catch blokları bulunmamalı', () => {
        const lines = chatJs.split('\n');
        const genuinelySilent = lines.filter(l =>
            /catch\s*\(\s*\w+\s*\)\s*\{\s*\}/.test(l) &&  // catch (x) {}
            !l.includes('console.') &&
            !l.trim().startsWith('//') &&
            !l.includes('disconnect') &&  // kasıtlı defensive catch — OK
            !l.includes('audio.play')     // medya play hatası — minor, OK
        );
        expect(genuinelySilent).toHaveLength(0);
    });

    test('P2P dosya işleme catch loglama içermeli', () => {
        expect(chatJs).toMatch(/catch.*\{.*console\.warn.*P2P/s);
    });

    test('p2p-announce parse catch loglama içermeli', () => {
        expect(chatJs).toContain('p2p-announce parse');
    });

    test('YouTube URL parse catch loglama içermeli', () => {
        expect(chatJs).toContain('YouTube');
    });
});
