/**
 * e2ee.ts — Uçtan Uca Şifreleme (E2EE) Modülü
 *
 * WebCrypto API kullanarak AES-GCM 256bit ile mesaj şifreleme ve çözme.
 * PBKDF2 ile oda şifresinden anahtar türetme.
 *
 * FIX #1: Salt artık per-room olarak sunucudan alınıyor.
 */

// ── Sabitler ──

/** Eski odalar için (sunucu salt göndermezse) geriye dönük uyumluluk salt'ı */
const LEGACY_SALT = 'HavenSecureSalt2026';

// ── Modül durumu ──

let e2eeKey: CryptoKey | null = null;
let pendingE2EEInit = false;

// FIX: E2EE anahtar türetme süresi boyunca room-history'nin beklemesi için Promise
let e2eeReadyResolve: ((value: void) => void) | null = null;
let e2eeReadyPromise: Promise<void> | null = null;

// ── Getter/Setter'lar ──

export function getE2EEKey(): CryptoKey | null {
    return e2eeKey;
}

export function setE2EEKey(key: CryptoKey | null): void {
    e2eeKey = key;
}

export function isPendingE2EEInit(): boolean {
    return pendingE2EEInit;
}

export function setPendingE2EEInit(value: boolean): void {
    pendingE2EEInit = value;
}

export function getE2EEReadyPromise(): Promise<void> | null {
    return e2eeReadyPromise;
}

/** E2EE hazır olduğunda çözülen bir Promise oluşturur */
export function createE2EEReadyPromise(): Promise<void> {
    e2eeReadyPromise = new Promise<void>(resolve => {
        e2eeReadyResolve = resolve;
    });
    return e2eeReadyPromise;
}

/** E2EE hazır promise'ini çözer */
export function resolveE2EEReady(): void {
    if (e2eeReadyResolve) {
        e2eeReadyResolve();
        e2eeReadyResolve = null;
    }
}

// ── E2EE Fonksiyonları ──

/**
 * Oda şifresinden AES-GCM anahtarı türetir.
 * @param password Kullanıcının girdiği oda şifresi (düz metin)
 * @param salt Sunucudan gelen per-room salt (hex string) veya null (eski odalar)
 */
export async function deriveE2EEKey(password: string, salt: string | null): Promise<CryptoKey> {
    const enc = new TextEncoder();
    const saltBytes = enc.encode(salt || LEGACY_SALT);
    const keyMaterial = await crypto.subtle.importKey(
        'raw',
        enc.encode(password),
        { name: 'PBKDF2' },
        false,
        ['deriveKey']
    );
    return crypto.subtle.deriveKey(
        { name: 'PBKDF2', salt: saltBytes, iterations: 100000, hash: 'SHA-256' },
        keyMaterial,
        { name: 'AES-GCM', length: 256 },
        false,
        ['encrypt', 'decrypt']
    );
}

/**
 * Metni AES-GCM ile şifreler.
 * @returns Base64 kodlanmış şifreli metin (IV + ciphertext)
 */
export async function encryptMessage(text: string): Promise<string> {
    if (!e2eeKey || !text) return text;
    try {
        const iv = crypto.getRandomValues(new Uint8Array(12));
        const enc = new TextEncoder();
        const encrypted = await crypto.subtle.encrypt(
            { name: 'AES-GCM', iv },
            e2eeKey,
            enc.encode(text)
        );

        const encryptedBytes = new Uint8Array(encrypted);
        const combined = new Uint8Array(iv.length + encryptedBytes.length);
        combined.set(iv, 0);
        combined.set(encryptedBytes, iv.length);

        let binary = '';
        combined.forEach(b => binary += String.fromCharCode(b));
        return window.btoa(binary);
    } catch (e) {
        console.error('Şifreleme hatası:', e);
        return text;
    }
}

/**
 * Base64 kodlanmış şifreli metni AES-GCM ile çözer.
 */
export async function decryptMessage(base64text: string): Promise<string> {
    if (!e2eeKey || !base64text) return base64text;
    try {
        const binary = window.atob(base64text);
        const combined = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) combined[i] = binary.charCodeAt(i);

        const iv = combined.slice(0, 12);
        const data = combined.slice(12);

        const decrypted = await crypto.subtle.decrypt(
            { name: 'AES-GCM', iv },
            e2eeKey,
            data
        );
        const dec = new TextDecoder();
        return dec.decode(decrypted);
    } catch (_e) {
        // Eski veya şifrelenmemiş metin gelmiş olabilir, doğrudan geri döndür
        return base64text;
    }
}
