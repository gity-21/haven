// Eski odalar için (sunucu salt göndermezse) geriye dönük uyumluluk salt'ı kullanılır.
const LEGACY_SALT = 'HavenSecureSalt2026'; // Yalnızca salt'sız eski odalar için
let e2eeKey = null;
let pendingE2EEInit = false; // Salt bekleniyor mu?

// FIX: E2EE anahtar türetme süresi boyunca room-history'nin beklemesi için Promise mekanizması
let e2eeReadyResolve = null;
let e2eeReadyPromise = null;

// ============================================
// FIX #6: İSTEMCİ TARAFI XSS KORUMASI
// ============================================
// sanitize-html CDN olmadığında hafif bir allowlist ile çalışır.
// Şifre çözme sonrası metin içeriğine uygulanır; dosya/p2p mesajlarına dokunmaz.
function clientSanitize(text) {
    if (!text || typeof text !== 'string') return text;
    // İzin verilen HTML etiketleri dışında her şeyi düz metne indir
    // Basit regex tabanlı allowlist — dışarıdan kütüphane gerekmez
    const ALLOWED = ['b', 'i', 'em', 'strong', 'br'];
    // Tüm etiketleri bul; izin verilmeyenleri encode et
    return text.replace(/<\/?([a-zA-Z][a-zA-Z0-9]*)(?:\s[^>]*)?>|<([a-zA-Z][a-zA-Z0-9]*)(?:\s[^>]*)?>/g, (match, tag1, tag2) => {
        const tag = (tag1 || tag2 || '').toLowerCase();
        if (ALLOWED.includes(tag)) {
            return match.startsWith('</') ? `</${tag}>` : (tag === 'br' ? '<br>' : `<${tag}>`);
        }
        // İzin verilmeyen etiketi encode et
        return match.replace(/</g, '&lt;').replace(/>/g, '&gt;');
    });
}

// FIX #1: deriveE2EEKey artık salt parametresi alıyor.
// salt: sunucudan gelen per-room hex string; yoksa LEGACY_SALT kullanılır.
async function deriveE2EEKey(password, salt) {
    const enc = new TextEncoder();
    const saltBytes = enc.encode(salt || LEGACY_SALT);
    const keyMaterial = await crypto.subtle.importKey("raw", enc.encode(password), { name: "PBKDF2" }, false, ["deriveKey"]);
    return crypto.subtle.deriveKey(
        { name: "PBKDF2", salt: saltBytes, iterations: 100000, hash: "SHA-256" },
        keyMaterial, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]
    );
}

async function encryptMessage(text) {
    if (!e2eeKey || !text) return text;
    try {
        const iv = crypto.getRandomValues(new Uint8Array(12));
        const enc = new TextEncoder();
        const encrypted = await crypto.subtle.encrypt({ name: "AES-GCM", iv: iv }, e2eeKey, enc.encode(text));

        const encryptedBytes = new Uint8Array(encrypted);
        const combined = new Uint8Array(iv.length + encryptedBytes.length);
        combined.set(iv, 0);
        combined.set(encryptedBytes, iv.length);

        let binary = '';
        combined.forEach(b => binary += String.fromCharCode(b));
        return window.btoa(binary);
    } catch (e) {
        console.error("Şifreleme hatası:", e);
        return text;
    }
}

async function decryptMessage(base64text) {
    if (!e2eeKey || !base64text) return base64text;
    try {
        const binary = window.atob(base64text);
        const combined = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) combined[i] = binary.charCodeAt(i);

        const iv = combined.slice(0, 12);
        const data = combined.slice(12);

        const decrypted = await crypto.subtle.decrypt({ name: "AES-GCM", iv: iv }, e2eeKey, data);
        const dec = new TextDecoder();
        return dec.decode(decrypted);
    } catch (e) {
        // Eski veya şifrelenmemiş metin gelmiş olabilir, doğrudan geri döndür
        return base64text;
    }
}

async function initialize() {
    // Session ID oluştur veya al (Mesaj sahipliği ve yetki kontrolü için)
    state.sessionId = localStorage.getItem('haven_session_id');
    if (!state.sessionId) {
        state.sessionId = 'sess_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
        localStorage.setItem('haven_session_id', state.sessionId);
    }

    // Temayı Yükle
    const savedTheme = localStorage.getItem('haven_login_theme') || 'space';
    document.documentElement.setAttribute('data-theme', savedTheme);

    // Gürültü Engelleme Yükle
    const savedNoiseSetting = localStorage.getItem('haven_noise_suppression');
    const chatNoiseCheckbox = document.getElementById('settings-noise-suppression');
    if (chatNoiseCheckbox && savedNoiseSetting === 'false') {
        chatNoiseCheckbox.checked = false;
    }

    // Güvenlik Check — FIX #4: roomPassword sessionStorage'dan okunuyor
    // state.roomPassword bu noktada henüz set edilmiş durumda (satır 30)
    if (!state.nickname || !state.roomKey || !state.authKey || !state.roomPassword) {
        if (window.electronAPI && window.electronAPI.navigateToLogin) {
            window.electronAPI.navigateToLogin();
        } else {
            window.location.href = 'login.html';
        }
        return;
    }

    // FIX #1 + #4: E2EE anahtarı salt sunucudan geldikten sonra türetiliyor.
    // Salt, join-room eventi başarılı olduktan sonra room-e2ee-salt olarak geliyor.
    // pendingE2EEInit = true olarak işaretlenir; salt gelince initE2EEWithSalt() çağrılır.
    pendingE2EEInit = true; // salt gelince türetme başlatılacak

    // FIX: room-history'nin E2EE anahtarını bekleyebilmesi için Promise oluştur
    e2eeReadyPromise = new Promise(resolve => {
        e2eeReadyResolve = resolve;
    });

    // UI'da Odayı yaz
    el.roomNameDisplay.textContent = state.roomKey;

    connectSocket();
    setupEventListeners();
    setupWindowControls();

    if ("Notification" in window && Notification.permission !== "denied" && Notification.permission !== "granted") {
        Notification.requestPermission();
    }
}