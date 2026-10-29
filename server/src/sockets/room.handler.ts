function sanitizeProfilePic(pic: unknown): string | null {
    if (typeof pic !== 'string') return null;
    if (pic.length > 500000) return null; // 500KB max
    if (pic.startsWith('data:image/') || /^https?:\/\//i.test(pic)) {
        return pic;
    }
    return null;
}

import { Server } from 'socket.io';
import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import { dbWrapper } from '../database';
import type { HavenSocket } from '../types/socket-events';
import type { JoinRoomPayload, UpdateProfilePayload } from '../types';
import { activeRinging, activeVoiceUsers, updateOnlineUsers } from '../services/room.service';
import { validateNickname, validateRoomKey, validateAuthKey } from '../config/security';

export function registerRoomHandlers(
    io: Server,
    socket: HavenSocket,
    rateCheck: (eventName: string) => boolean
): void {
    // Kullanıcı giriş yaptığında (Bir Odaya katıldığında)
    socket.on('join-room', (data: JoinRoomPayload) => {
        if (!rateCheck('join-room')) return;
        if (!data || typeof data !== 'object') {
            socket.emit('join-error', 'Geçersiz istek verisi.');
            return;
        }

        const nickValidation = validateNickname(data.nickname);
        if (!nickValidation.valid) {
            socket.emit('join-error', nickValidation.error || 'Geçersiz takma ad.');
            return;
        }

        const roomValidation = validateRoomKey(data.roomKey);
        if (!roomValidation.valid) {
            socket.emit('join-error', roomValidation.error || 'Geçersiz oda anahtarı.');
            return;
        }

        const authValidation = validateAuthKey(data.authKey);
        if (!authValidation.valid) {
            socket.emit('join-error', authValidation.error || 'Geçersiz oda şifresi.');
            return;
        }

        const nickname = nickValidation.value!;
        const roomKey = roomValidation.value!;
        const authKey = authValidation.value!;
        const { userId, userSecret, avatarColor, profilePic, mode } = data;

        const joinMode = mode || 'create';

        // Odanın parolasını ve geçerlilik süresini kontrol et
        let room = dbWrapper.prepare('SELECT password_hash, expires_at FROM rooms WHERE room_key = ?').get(roomKey) as { password_hash: string; expires_at: string | null } | undefined;

        if (room && room.expires_at) {
            if (new Date(room.expires_at).getTime() <= Date.now()) {
                socket.emit('join-error', 'Bu geçici odanın kullanım süresi doldu ve imha edildi.');
                return;
            }
        }

        if (!room) {
            if (joinMode === 'join') {
                socket.emit('join-error', 'Bu oda mevcut değil! Lütfen geçerli bir oda anahtarı girin.');
                return;
            }
            // E2EE Salt üretimi
            const e2eeSalt = crypto.randomBytes(32).toString('hex');
            const hash = bcrypt.hashSync(authKey, 10);

            let expiresAt: string | null = null;
            if (data.expiresIn && typeof data.expiresIn === 'number' && data.expiresIn > 0) {
                expiresAt = new Date(Date.now() + data.expiresIn * 60 * 1000).toISOString();
            }

            dbWrapper.prepare('INSERT INTO rooms (room_key, password_hash, e2ee_salt, expires_at) VALUES (?, ?, ?, ?)').run(roomKey, hash, e2eeSalt, expiresAt);
            console.log(`[AUTH] Yeni oda oluşturuldu: ${roomKey}${expiresAt ? ` (İmha Tarihi: ${expiresAt})` : ''}`);
        } else {
            // Odaya giriliyor, şifre doğrula
            if (!bcrypt.compareSync(authKey, room.password_hash as string)) {
                console.log(`[AUTH] ${nickname} yanlış şifre ile ${roomKey} odasına girmeyi denedi.`);
                socket.emit('join-error', 'Geçersiz oda şifresi!');
                return;
            } else {
                console.log(`[AUTH] ${nickname}, ${roomKey} odasına başarıyla giriş yaptı.`);
            }
        }

        socket.userId = (typeof userId === 'string' && userId.length < 128) ? userId : null;
        socket.nickname = nickname;
        socket.roomKey = roomKey;
        socket.avatarColor = (typeof avatarColor === 'string' && /^#[0-9a-fA-F]{3,8}$/.test(avatarColor)) ? avatarColor : '#6366f1';
        socket.profilePic = sanitizeProfilePic(profilePic);
        socket.sessionId = socket.userId || crypto.randomUUID();
        socket.userSecret = (typeof userSecret === 'string' && userSecret.length < 128) ? userSecret : null;

        const uploadToken = crypto.randomBytes(16).toString('hex');
        socket.uploadToken = uploadToken;
        global.validUploadTokens.add(uploadToken);
        setTimeout(() => global.validUploadTokens.delete(uploadToken), 12 * 60 * 60 * 1000);
        socket.emit('upload-token', uploadToken);

        // Eski mesajları sahiplenme ve güncelleme
        if (socket.userSecret) {
            try {
                // 1) user_secret ile eşleşen mesajların ismini güncelle
                dbWrapper.prepare('UPDATE messages SET username = ?, avatar_color = ?, profile_pic = ? WHERE user_secret = ? AND room_key = ? AND username != ?')
                    .run(nickname, socket.avatarColor, socket.profilePic, socket.userSecret, roomKey, nickname);

                // 2) user_secret'i olmayan ama aynı profile_pic'e sahip mesajları da sahiplen
                if (socket.profilePic) {
                    dbWrapper.prepare('UPDATE messages SET user_id = ?, user_secret = ?, username = ?, avatar_color = ? WHERE profile_pic = ? AND room_key = ? AND (user_secret IS NULL OR user_secret = ?)')
                        .run(socket.userId, socket.userSecret, nickname, socket.avatarColor, socket.profilePic, roomKey, socket.userSecret);
                }
            } catch (e) {
                console.error('[DATABASE] Eski mesaj güncelleme hatası');
            }
        }

        socket.join(roomKey);

        // E2EE salt'ını istemciye gönder
        const roomSaltRow = dbWrapper.prepare('SELECT e2ee_salt FROM rooms WHERE room_key = ?').get(roomKey) as { e2ee_salt: string | null } | undefined;
        if (roomSaltRow && roomSaltRow.e2ee_salt) {
            socket.emit('room-e2ee-salt', { salt: roomSaltRow.e2ee_salt });
        } else {
            socket.emit('room-e2ee-salt', { salt: null });
        }

        updateOnlineUsers(io, roomKey);
        socket.to(roomKey).emit('user-joined', { msg: `${nickname} odaya katıldı.` });

        // Son 100 mesaj geçmişini gönder
        const history = dbWrapper.prepare(`
            SELECT m.id, m.room_key, m.username, m.avatar_color, m.content, m.type, m.reply_to, m.profile_pic, m.reactions, m.user_id, m.is_edited, m.edit_history, m.is_pinned, m.created_at, r.username as reply_username, r.content as reply_content 
            FROM messages m 
            LEFT JOIN messages r ON m.reply_to = r.id 
            WHERE m.room_key = ? 
            ORDER BY m.created_at DESC LIMIT 100
        `).all(roomKey).reverse();
        socket.emit('room-history', history);

        const ringingData = activeRinging.get(roomKey);
        if (ringingData && ringingData.callerId !== socket.id) {
            socket.emit('room-is-ringing', ringingData);
        }

        const voiceUsers = activeVoiceUsers.get(roomKey);
        if (voiceUsers && voiceUsers.size > 0) {
            const voiceUsersList = Array.from(voiceUsers.values());
            socket.emit('active-voice-users', voiceUsersList);
            if (!ringingData) {
                const firstUser = voiceUsersList[0];
                socket.emit('room-is-ringing', {
                    callerId: firstUser.userId,
                    callerName: firstUser.username,
                    avatarColor: firstUser.avatarColor,
                    profilePic: firstUser.profilePic
                });
            }
        }
    });

    // Kullanıcı kendi profilini güncellediğinde
    socket.on('update-profile', (data: UpdateProfilePayload) => {
        if (!socket.roomKey || !data || typeof data !== 'object') return;
        const { oldNickname, nickname, avatarColor, profilePic } = data;

        if (nickname) {
            const nickValidation = validateNickname(nickname);
            if (!nickValidation.valid) return;
            socket.nickname = nickValidation.value!;
        }

        const prevNickname = oldNickname || socket.nickname;
        if (avatarColor && typeof avatarColor === 'string' && /^#[0-9a-fA-F]{3,8}$/.test(avatarColor)) {
            socket.avatarColor = avatarColor;
        }
        if (profilePic !== undefined) {
            socket.profilePic = sanitizeProfilePic(profilePic);
        }

        // Veritabanındaki eski mesajları güncelle
        try {
            if (socket.userSecret) {
                dbWrapper.prepare('UPDATE messages SET username = ?, avatar_color = ?, profile_pic = ? WHERE user_secret = ? AND room_key = ?')
                    .run(socket.nickname, socket.avatarColor, socket.profilePic, socket.userSecret, socket.roomKey);
            } else if (prevNickname && prevNickname !== socket.nickname) {
                dbWrapper.prepare('UPDATE messages SET username = ? WHERE username = ? AND room_key = ?')
                    .run(socket.nickname, prevNickname, socket.roomKey);
            }

            if (prevNickname !== socket.nickname) {
                socket.to(socket.roomKey).emit('username-changed', {
                    oldUsername: prevNickname,
                    newUsername: socket.nickname,
                    avatarColor: socket.avatarColor,
                    profilePic: socket.profilePic,
                    userId: socket.userId || socket.id
                });
            }

            if (activeVoiceUsers.has(socket.roomKey)) {
                const voiceRoom = activeVoiceUsers.get(socket.roomKey)!;
                if (voiceRoom.has(socket.id)) {
                    const voiceUser = voiceRoom.get(socket.id)!;
                    voiceUser.username = socket.nickname!;
                    voiceUser.avatarColor = socket.avatarColor!;
                    voiceUser.profilePic = socket.profilePic || null;

                    io.to(socket.roomKey).emit('active-voice-users', Array.from(voiceRoom.values()));
                }
            }
        } catch (e) {
            console.error('[DATABASE] İsim güncelleme hatası');
        }

        updateOnlineUsers(io, socket.roomKey);
    });

    // Bağlantı koptuğunda
    socket.on('disconnect', () => {
        if (socket.roomKey) {
            socket.to(socket.roomKey).emit('user-left', { msg: `${socket.nickname} odadan ayrıldı.` });
            socket.to(socket.roomKey).emit('voice-leave', { userId: socket.id, username: socket.nickname });

            const voiceUsers = activeVoiceUsers.get(socket.roomKey);
            if (voiceUsers) {
                voiceUsers.delete(socket.id);
                if (voiceUsers.size === 0) {
                    activeVoiceUsers.delete(socket.roomKey);
                    activeRinging.delete(socket.roomKey);
                }
                io.to(socket.roomKey).emit('active-voice-users', Array.from(voiceUsers.values()));
            }

            const ringingData = activeRinging.get(socket.roomKey);
            if (ringingData && ringingData.callerId === socket.id) {
                activeRinging.delete(socket.roomKey);
                socket.to(socket.roomKey).emit('call-cancelled');
            }

            updateOnlineUsers(io, socket.roomKey);
        }

        if (socket.uploadToken) {
            global.validUploadTokens.delete(socket.uploadToken);
        }
    });
}
