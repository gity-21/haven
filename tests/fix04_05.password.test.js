/**
 * Fix #4 — localStorage'da düz metin şifre kaldırıldı
 * Fix #5 — Davet linkinde ?pass= parametresi kaldırıldı
 */

const fs = require('fs');
const path = require('path');

const loginJs = fs.readFileSync(path.join(__dirname, '../app/renderer/js/login.js'), 'utf8');
const chatJs  = fs.readFileSync(path.join(__dirname, '../app/renderer/js/chat.js'), 'utf8');

// Yorum satırı olmayan gerçek kod satırlarını filtrele
function realCodeLines(src) {
    return src.split('\n').filter(l => {
        const t = l.trim();
        return t && !t.startsWith('//') && !t.startsWith('*') && !t.startsWith('/*');
    });
}

const loginReal = realCodeLines(loginJs);
const chatReal  = realCodeLines(chatJs);

describe('FIX #4 — Şifre localStorage → sessionStorage', () => {
    test("login.js'te localStorage.setItem('dc_room_password') bulunmamalı", () => {
        const bad = loginReal.filter(l => l.includes("'dc_room_password'") && l.includes('setItem'));
        expect(bad).toHaveLength(0);
    });

    test("chat.js'te localStorage.getItem('dc_room_password') bulunmamalı", () => {
        const bad = chatReal.filter(l => l.includes("'dc_room_password'") && l.includes('getItem'));
        expect(bad).toHaveLength(0);
    });

    test("login.js sessionStorage.setItem('dc_session_password') kullanmalı", () => {
        const good = loginReal.filter(l => l.includes('dc_session_password') && l.includes('sessionStorage'));
        expect(good.length).toBeGreaterThan(0);
    });

    test("chat.js sessionStorage.getItem('dc_session_password') kullanmalı", () => {
        const good = chatReal.filter(l => l.includes('dc_session_password') && l.includes('sessionStorage'));
        expect(good.length).toBeGreaterThan(0);
    });

    test('E2EE türetimi sonrası sessionStorage temizlenmeli', () => {
        expect(chatJs).toContain("sessionStorage.removeItem('dc_session_password')");
    });

    test('state.roomPassword = null ile bellek referansı temizlenmeli', () => {
        expect(chatJs).toContain('state.roomPassword = null');
    });
});

describe('FIX #5 — Davet linkinden ?pass= kaldırıldı', () => {
    test('inviteLink içinde encodeURIComponent(passVal) bulunmamalı', () => {
        const bad = loginReal.filter(l =>
            l.includes('inviteLink') && l.includes('pass=') && l.includes('encodeURIComponent')
        );
        expect(bad).toHaveLength(0);
    });

    test("URL'den pass parametresi okunmamalı (urlParams.get('pass'))", () => {
        const bad = loginReal.filter(l =>
            l.includes("urlParams.get('pass')") || l.includes('urlParams.has(\'pass\')')
        );
        expect(bad).toHaveLength(0);
    });

    test("Davet linki sadece room parametresi içermeli", () => {
        const linkLine = loginReal.find(l => l.includes('inviteLink') && l.includes('?room='));
        expect(linkLine).toBeDefined();
        expect(linkLine).not.toContain('&pass=');
    });
});
