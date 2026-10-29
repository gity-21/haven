/**
 * server/src/config/index.ts — Merkezi Konfigürasyon ve Sabitler
 * 
 * Çevre değişkenleri, ağ ayarları, rate limiting limitleri ve dosya yolları
 * tek bir merkezden yönetilir.
 */

import path from 'path';
import fs from 'fs';
import cors from 'cors';
import { rateLimit } from 'express-rate-limit';

// ── Sunucu Ağ Ayarları ──
export const PORT: number = parseInt(process.env.PORT || '3847', 10);
export const HOST: string = process.env.HOST || '0.0.0.0';
export const NODE_ENV: string = process.env.NODE_ENV || 'production';

// ── Dizin Yapısı & Dosya Yolları ──
export const ROOT_DIR: string = path.resolve(__dirname, '../../..');
export const DATA_DIR: string = process.env.DATA_DIR || path.resolve(__dirname, '../../data');
export const UPLOADS_DIR: string = path.join(DATA_DIR, 'uploads');
export const FALLBACK_UPLOADS_DIR: string = path.join(ROOT_DIR, 'data/uploads');
export const RENDERER_DIST_DIR: string = path.resolve(__dirname, '../../../app/renderer/dist');
export const ADMIN_TOKEN_FILE: string = process.env.DATA_DIR
    ? path.join(process.env.DATA_DIR, 'admin-token.txt')
    : path.join(DATA_DIR, 'admin-token.txt');

// uploads dizinlerinin varlığını garanti et
if (!fs.existsSync(UPLOADS_DIR)) {
    fs.mkdirSync(UPLOADS_DIR, { recursive: true });
}

// ── CORS İzin Listesi ve Seçenekleri ──
export const CORS_WHITELIST: Set<string> = new Set(
    [
        'http://localhost:3847',
        'http://127.0.0.1:3847',
        process.env.TUNNEL_ORIGIN,
    ].filter((x): x is string => Boolean(x))
);

export const corsOptions: cors.CorsOptions = {
    origin: function (origin: string | undefined, callback: (err: Error | null, allow?: boolean) => void) {
        if (origin === undefined) {
            return callback(null, true);
        }
        if (origin === 'file://' || origin.startsWith('file://')) {
            return callback(null, true);
        }
        if (CORS_WHITELIST.has(origin)) return callback(null, true);
        if (origin.endsWith('.trycloudflare.com')) {
            return callback(null, true);
        }
        console.warn(`[CORS] Reddedilen origin: ${origin}`);
        callback(new Error(`CORS: İzin verilmeyen origin → ${origin}`));
    },
    methods: ['GET', 'POST', 'DELETE', 'OPTIONS'],
    credentials: false
};

// ── Socket.IO Rate Limiting Yapılandırması ──
export interface RateLimitConfig {
    max: number;
    windowMs: number;
}

export const SOCKET_RATE_LIMITS: Record<string, RateLimitConfig> = {
    'send-message': { max: 15, windowMs: 5000 },      // 5 sn'de 15 mesaj
    'join-room': { max: 3, windowMs: 10000 },         // 10 sn'de 3 oda katılımı
    'toggle-reaction': { max: 30, windowMs: 5000 },   // 5 sn'de 30 tepki
    'typing': { max: 20, windowMs: 5000 },            // 5 sn'de 20 sinyal
    'edit-message': { max: 15, windowMs: 5000 },      // 5 sn'de 15 düzenleme
};

// ── HTTP API Rate Limiting Limitleri & Middleware'leri ──
export const HTTP_RATE_LIMITS = {
    socketHandshake: {
        windowMs: 60 * 1000,
        max: 300,
    },
    generalApi: {
        windowMs: 15 * 60 * 1000,
        max: 500,
    },
    adminLogin: {
        windowMs: 15 * 60 * 1000,
        max: 10,
    },
};

export const apiLimiter = rateLimit({
    windowMs: 1 * 60 * 1000,
    max: 300,
    message: 'Çok fazla istek gönderdiniz, lütfen biraz bekleyin.'
});

export const socketLimiter = rateLimit({
    windowMs: 1 * 60 * 1000,
    max: 1500,
    message: 'Çok fazla bağlantı isteği gönderdiniz.'
});
