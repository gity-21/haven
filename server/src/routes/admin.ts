/**
 * server/src/routes/admin.ts — Admin Yönetim API Endpoint'leri
 *
 * Token tabanlı kimlik doğrulama ile odaları listeleme, silme ve temizleme işlemleri.
 */

import { Router, Request, Response, NextFunction } from 'express';
import { Server } from 'socket.io';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { dbWrapper } from '../database';
import { ADMIN_TOKEN_FILE } from '../config';

// ── Admin Token Yönetimi ──
let ADMIN_TOKEN: string | null = process.env.ADMIN_TOKEN || null;
if (!ADMIN_TOKEN) {
    if (fs.existsSync(ADMIN_TOKEN_FILE)) {
        ADMIN_TOKEN = fs.readFileSync(ADMIN_TOKEN_FILE, 'utf-8').trim();
    } else {
        ADMIN_TOKEN = crypto.randomBytes(32).toString('hex');
        try {
            const tokenDir = path.dirname(ADMIN_TOKEN_FILE);
            if (!fs.existsSync(tokenDir)) fs.mkdirSync(tokenDir, { recursive: true });
            fs.writeFileSync(ADMIN_TOKEN_FILE, ADMIN_TOKEN, 'utf-8');
            console.log('[ADMIN] Otomatik admin token üretildi ve kaydedildi.');
        } catch (e) {
            console.error('[ADMIN] Token dosyası yazılamadı:', (e as Error).message);
        }
    }
}

export function getAdminToken(): string | null {
    return ADMIN_TOKEN;
}

// ── Admin Kimlik Doğrulama Middleware ──
export function adminOnly(req: Request, res: Response, next: NextFunction): void {
    if (!ADMIN_TOKEN) {
        res.status(503).json({ success: false, error: 'Admin paneli devre dışı. Sunucuda ADMIN_TOKEN tanımlı değil.' });
        return;
    }
    const authHeader = req.headers['authorization'] || '';
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';
    if (!token || token !== ADMIN_TOKEN) {
        console.warn(`[ADMIN] Yetkisiz erişim denemesi — IP: ${req.ip}`);
        res.status(403).json({ success: false, error: 'Geçersiz veya eksik admin token.' });
        return;
    }
    next();
}

// ── Router Oluşturucu ──
export function createAdminRouter(io: Server): Router {
    const router = Router();

    // Admin: Tüm odaları listele
    router.get('/rooms', adminOnly, (_req: Request, res: Response) => {
        try {
            const rooms = dbWrapper.prepare('SELECT room_key, created_at FROM rooms ORDER BY created_at DESC').all() as Array<{ room_key: string; created_at: string }>;
            const roomsWithStats = rooms.map(room => {
                const msgCount = dbWrapper.prepare('SELECT COUNT(*) as count FROM messages WHERE room_key = ?').get(room.room_key) as { count: number } | undefined;
                const socketsInRoom = io.sockets.adapter.rooms.get(room.room_key);
                return {
                    ...room,
                    message_count: msgCount ? msgCount.count : 0,
                    online_count: socketsInRoom ? socketsInRoom.size : 0
                };
            });
            res.json({ success: true, rooms: roomsWithStats });
        } catch (e) {
            console.error('[ADMIN] Odalar listelenirken hata:', e);
            res.status(500).json({ success: false, error: 'Sunucu hatası' });
        }
    });

    // Admin: Tek bir odayı sil
    router.delete('/rooms/:roomKey', adminOnly, (req: Request, res: Response) => {
        try {
            const roomKey = req.params.roomKey as string;
            const socketsInRoom = io.sockets.adapter.rooms.get(roomKey);
            if (socketsInRoom) {
                for (const socketId of socketsInRoom) {
                    const clientSocket = io.sockets.sockets.get(socketId);
                    if (clientSocket) {
                        clientSocket.emit('room-deleted', { message: 'Bu oda sunucu yöneticisi tarafından kalıcı olarak silindi.' });
                        clientSocket.leave(roomKey);
                    }
                }
            }
            dbWrapper.prepare('DELETE FROM messages WHERE room_key = ?').run(roomKey);
            dbWrapper.prepare('DELETE FROM rooms WHERE room_key = ?').run(roomKey);
            res.json({ success: true, message: `Oda silindi.` });
        } catch (_e) {
            res.status(500).json({ success: false, error: 'Sunucu hatası' });
        }
    });

    // Admin: Tüm odaları sil
    router.delete('/rooms', adminOnly, (_req: Request, res: Response) => {
        try {
            const allRooms = dbWrapper.prepare('SELECT room_key FROM rooms').all() as Array<{ room_key: string }>;
            allRooms.forEach(room => {
                const socketsInRoom = io.sockets.adapter.rooms.get(room.room_key);
                if (socketsInRoom) {
                    for (const socketId of socketsInRoom) {
                        const clientSocket = io.sockets.sockets.get(socketId);
                        if (clientSocket) {
                            clientSocket.emit('room-deleted', { message: 'Tüm odalar sunucu yöneticisi tarafından kalıcı olarak silindi.' });
                            clientSocket.leave(room.room_key);
                        }
                    }
                }
            });
            dbWrapper.prepare('DELETE FROM messages').run();
            dbWrapper.prepare('DELETE FROM rooms').run();
            res.json({ success: true, message: 'Tüm odalar silindi.' });
        } catch (_e) {
            res.status(500).json({ success: false, error: 'Sunucu hatası' });
        }
    });

    return router;
}

