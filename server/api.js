const express = require('express');
const { dbWrapper } = require('./database');
const { ADMIN_TOKEN } = require('./config');

function adminOnly(req, res, next) {
    if (!ADMIN_TOKEN) {
        return res.status(503).json({ success: false, error: 'Admin paneli devre dışı. Sunucuda ADMIN_TOKEN tanımlı değil.' });
    }
    const authHeader = req.headers['authorization'] || '';
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';
    if (!token || token !== ADMIN_TOKEN) {
        console.warn(`[ADMIN] Yetkisiz erişim denemesi — IP: ${req.ip}`);
        return res.status(403).json({ success: false, error: 'Geçersiz veya eksik admin token.' });
    }
    next();
}

function setupApiRoutes(app, io) {
    // Admin: Tüm odaları listele
    app.get('/api/admin/rooms', adminOnly, (req, res) => {
        try {
            const rooms = dbWrapper.prepare('SELECT room_key, created_at FROM rooms ORDER BY created_at DESC').all();
            const roomsWithStats = rooms.map(room => {
                const msgCount = dbWrapper.prepare('SELECT COUNT(*) as count FROM messages WHERE room_key = ?').get(room.room_key);
                const socketsInRoom = io.sockets.adapter.rooms.get(room.room_key);
                return {
                    ...room,
                    message_count: msgCount ? msgCount.count : 0,
                    online_count: socketsInRoom ? socketsInRoom.size : 0
                };
            });
            res.json({ success: true, rooms: roomsWithStats });
        } catch (e) {
            console.error('Admin odalar yüklenirken hata:', e);
            res.status(500).json({ success: false, error: 'Sunucu hatası' });
        }
    });

    // Admin: Tek bir odayı sil
    app.delete('/api/admin/rooms/:roomKey', adminOnly, (req, res) => {
        try {
            const roomKey = req.params.roomKey;
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
        } catch (e) {
            res.status(500).json({ success: false, error: 'Sunucu hatası' });
        }
    });

    // Admin: Tüm odaları sil
    app.delete('/api/admin/rooms', adminOnly, (req, res) => {
        try {
            const allRooms = dbWrapper.prepare('SELECT room_key FROM rooms').all();
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
        } catch (e) {
            res.status(500).json({ success: false, error: 'Sunucu hatası' });
        }
    });
}

module.exports = { setupApiRoutes };
