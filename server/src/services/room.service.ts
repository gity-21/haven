/**
 * server/src/services/room.service.ts — Oda & Kullanıcı Yönetim Servisi
 *
 * Çevrimiçi kullanıcı listelerinin senkronizasyonu ve oda istatistikleri.
 */

import { Server } from 'socket.io';
import { HavenSocket, OnlineUser, RingingData, VoiceUserData } from '../types';
import { dbWrapper } from '../database';

// Aktif arama (ringing) durumları: roomKey -> RingingData
export const activeRinging = new Map<string, RingingData>();

// Sesli kanaldaki kullanıcılar: roomKey -> Map<socketId, VoiceUserData>
export const activeVoiceUsers = new Map<string, Map<string, VoiceUserData>>();

/**
 * Süresi dolmuş geçici (Burn-After-Reading) odaları tespit eder ve kalıcı olarak imha eder.
 */
export function checkAndCleanExpiredRooms(ioServer: Server): void {
    try {
        const now = new Date().toISOString();
        const expiredRooms = dbWrapper.prepare(
            'SELECT room_key FROM rooms WHERE expires_at IS NOT NULL AND expires_at <= ?'
        ).all(now) as Array<{ room_key: string }>;

        for (const room of expiredRooms) {
            console.log(`[BURN-ROOM] Odanın süresi doldu, imha ediliyor: ${room.room_key}`);

            ioServer.to(room.room_key).emit('room-deleted', {
                message: 'Bu geçici odanın kullanım süresi doldu ve tüm mesajlarıyla birlikte kalıcı olarak imha edildi.'
            });

            const socketsInRoom = ioServer.sockets.adapter.rooms.get(room.room_key);
            if (socketsInRoom) {
                for (const socketId of socketsInRoom) {
                    const clientSocket = ioServer.sockets.sockets.get(socketId);
                    clientSocket?.leave(room.room_key);
                }
            }

            activeRinging.delete(room.room_key);
            activeVoiceUsers.delete(room.room_key);

            dbWrapper.prepare('DELETE FROM messages WHERE room_key = ?').run(room.room_key);
            dbWrapper.prepare('DELETE FROM rooms WHERE room_key = ?').run(room.room_key);
        }
    } catch (e) {
        console.error('[BURN-ROOM] İmha kontrolü hatası:', e);
    }
}

/**
 * Belirli bir odadaki tüm bağlı kullanıcıları bulur ve istemcilere duyurur.
 */
export function updateOnlineUsers(ioServer: Server, roomKey: string): void {
    if (!roomKey) return;

    const sockets = ioServer.sockets.adapter.rooms.get(roomKey);
    const users: OnlineUser[] = [];

    if (sockets) {
        for (const clientId of sockets) {
            const clientSocket = ioServer.sockets.sockets.get(clientId) as HavenSocket | undefined;
            if (clientSocket && clientSocket.nickname) {
                users.push({
                    username: clientSocket.nickname,
                    avatarColor: clientSocket.avatarColor || '#6366f1',
                    profilePic: clientSocket.profilePic || null,
                    id: clientId
                });
            }
        }
    }

    ioServer.to(roomKey).emit('online-users', users);
}

