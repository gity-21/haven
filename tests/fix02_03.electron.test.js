/**
 * Fix #2 — webSecurity:false kaldırıldı
 * Fix #3 — İzin whitelist'i kayıtsız şartsız onay yerine geçti
 */

const fs = require('fs');
const path = require('path');

const mainJs = fs.readFileSync(path.join(__dirname, '../app/main.js'), 'utf8');

describe('FIX #2 — Electron webSecurity', () => {
    test('webSecurity: false gerçek kod satırı olarak bulunmamalı', () => {
        const activeLines = mainJs.split('\n').filter(l =>
            /webSecurity\s*:\s*false/.test(l) && !l.trim().startsWith('//')
        );
        expect(activeLines).toHaveLength(0);
    });

    test('allowRunningInsecureContent gerçek kod satırı olarak bulunmamalı', () => {
        const activeLines = mainJs.split('\n').filter(l =>
            /allowRunningInsecureContent\s*:\s*true/.test(l) && !l.trim().startsWith('//')
        );
        expect(activeLines).toHaveLength(0);
    });

    test('contextIsolation: true hala aktif olmalı', () => {
        expect(mainJs).toMatch(/contextIsolation\s*:\s*true/);
    });

    test('nodeIntegration: false hala aktif olmalı', () => {
        expect(mainJs).toMatch(/nodeIntegration\s*:\s*false/);
    });
});

describe('FIX #3 — İzin whitelist', () => {
    test('ALLOWED_PERMISSIONS set tanımlı olmalı', () => {
        expect(mainJs).toContain('ALLOWED_PERMISSIONS');
    });

    test('Kayıtsız callback(true) else dalı bulunmamalı', () => {
        // Eski: } else { callback(true); // Diğer izinlere de izin ver
        expect(mainJs).not.toMatch(/callback\(true\).*Diğer/);
    });

    test('İzin kontrolü ALLOWED_PERMISSIONS.has() kullanmalı', () => {
        expect(mainJs).toContain('ALLOWED_PERMISSIONS.has(permission)');
    });

    test('Medya izinleri whitelist içinde olmalı', () => {
        expect(mainJs).toContain("'media'");
        expect(mainJs).toContain("'microphone'");
        expect(mainJs).toContain("'camera'");
    });
});
