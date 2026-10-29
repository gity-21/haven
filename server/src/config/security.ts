/**
 * server/src/config/security.ts — Güvenlik Kuralları ve Doğrulama Katmanı
 * 
 * SECURITY_RULES.md uyumlu güvenlik başlıkları, girdi doğrulama şemaları,
 * sanitizasyon ve hassas veri maskeleme yardımcıları.
 */

import { Request, Response, NextFunction } from 'express';

// ── 1. HTTP Güvenlik Başlıkları Middleware ──
export function securityHeadersMiddleware(req: Request, res: Response, next: NextFunction): void {
    // MIME-sniffing koruması
    res.setHeader('X-Content-Type-Options', 'nosniff');
    // Clickjacking koruması (iframe içi yükleme engeli)
    res.setHeader('X-Frame-Options', 'DENY');
    // XSS Filtresi (Eski tarayıcılar için)
    res.setHeader('X-XSS-Protection', '1; mode=block');
    // Gizlilik / Referrer politikası
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    // İndirilen dosyaların doğrudan açılmasını sınırla
    res.setHeader('X-Download-Options', 'noopen');

    // Electron ve Cloudflare tünelleriyle uyumlu CSP
    res.setHeader(
        'Content-Security-Policy',
        "default-src 'self' 'unsafe-inline' 'unsafe-eval' data: blob: file:; " +
        "connect-src 'self' ws: wss: http: https:; " +
        "img-src 'self' data: blob: https: file:; " +
        "media-src 'self' data: blob: https: file:; " +
        "object-src 'none';"
    );

    next();
}

// ── 2. Girdi Doğrulama ve Sınırlandırma (Input Validation) ──

export const INPUT_LIMITS = {
    MAX_NICKNAME_LENGTH: 32,
    MIN_NICKNAME_LENGTH: 1,
    MAX_ROOM_KEY_LENGTH: 64,
    MIN_ROOM_KEY_LENGTH: 2,
    MAX_MESSAGE_LENGTH: 8000,
    MAX_AUTH_KEY_LENGTH: 128,
    MIN_AUTH_KEY_LENGTH: 1,
};

export interface ValidationResult<T> {
    valid: boolean;
    value?: T;
    error?: string;
}

/**
 * Kullanıcı takma adını (nickname) doğrular ve temizler.
 */
export function validateNickname(raw: unknown): ValidationResult<string> {
    if (typeof raw !== 'string') {
        return { valid: false, error: 'Takma ad metin formatında olmalıdır.' };
    }
    const sanitized = raw.trim().replace(/[\u0000-\u001F\u007F-\u009F]/g, ''); // Kontrol karakterlerini temizle
    if (sanitized.length < INPUT_LIMITS.MIN_NICKNAME_LENGTH) {
        return { valid: false, error: 'Takma ad boş olamaz.' };
    }
    if (sanitized.length > INPUT_LIMITS.MAX_NICKNAME_LENGTH) {
        return { valid: false, error: `Takma ad en fazla ${INPUT_LIMITS.MAX_NICKNAME_LENGTH} karakter olabilir.` };
    }
    return { valid: true, value: sanitized };
}

/**
 * Oda anahtarını (roomKey) doğrular.
 */
export function validateRoomKey(raw: unknown): ValidationResult<string> {
    if (typeof raw !== 'string') {
        return { valid: false, error: 'Oda anahtarı metin formatında olmalıdır.' };
    }
    const sanitized = raw.trim();
    if (sanitized.length < INPUT_LIMITS.MIN_ROOM_KEY_LENGTH || sanitized.length > INPUT_LIMITS.MAX_ROOM_KEY_LENGTH) {
        return { valid: false, error: `Oda anahtarı ${INPUT_LIMITS.MIN_ROOM_KEY_LENGTH}-${INPUT_LIMITS.MAX_ROOM_KEY_LENGTH} karakter arasında olmalıdır.` };
    }
    // Sadece alfanumerik, tire, alt çizgi
    if (!/^[a-zA-Z0-9_-]+$/.test(sanitized)) {
        return { valid: false, error: 'Oda anahtarı sadece harf, rakam, tire ve alt çizgi içerebilir.' };
    }
    return { valid: true, value: sanitized };
}

/**
 * Oda şifresini (authKey) doğrular.
 */
export function validateAuthKey(raw: unknown): ValidationResult<string> {
    if (typeof raw !== 'string') {
        return { valid: false, error: 'Oda şifresi metin formatında olmalıdır.' };
    }
    if (raw.length < INPUT_LIMITS.MIN_AUTH_KEY_LENGTH || raw.length > INPUT_LIMITS.MAX_AUTH_KEY_LENGTH) {
        return { valid: false, error: `Oda şifresi ${INPUT_LIMITS.MIN_AUTH_KEY_LENGTH}-${INPUT_LIMITS.MAX_AUTH_KEY_LENGTH} karakter arasında olmalıdır.` };
    }
    return { valid: true, value: raw };
}

/**
 * Mesaj içeriğini doğrular.
 */
export function validateMessageContent(raw: unknown): ValidationResult<string> {
    if (typeof raw !== 'string') {
        return { valid: false, error: 'Mesaj içeriği geçerli bir metin olmalıdır.' };
    }
    const trimmed = raw.trim();
    if (trimmed.length === 0) {
        return { valid: false, error: 'Mesaj içeriği boş olamaz.' };
    }
    if (trimmed.length > INPUT_LIMITS.MAX_MESSAGE_LENGTH) {
        return { valid: false, error: `Mesaj uzunluğu ${INPUT_LIMITS.MAX_MESSAGE_LENGTH} karakteri aşamaz.` };
    }
    return { valid: true, value: trimmed };
}

// ── 3. Hassas Veri Maskeleme (Log Information Disclosure Koruması) ──

/**
 * Gizli anahtarları loglarda maskeler (örn: "sec_12345678" -> "sec_***78").
 */
export function maskSecret(secret?: string | null): string {
    if (!secret) return '***';
    if (secret.length <= 6) return '***';
    return secret.slice(0, 3) + '***' + secret.slice(-2);
}

