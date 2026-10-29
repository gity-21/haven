/**
 * server/src/sockets/message.handler.ts — Mesajlaşma & Etkileşim Soket Olayları
 *
 * Mesaj gönderme, düzenleme, silme, sabitleme, tepkiler, yazıyor sinyali ve anket oylamaları.
 * SECURITY_RULES.md uyumlu girdi doğrulama ve IDOR denetimi uygulanmıştır.
 */

import { Server } from 'socket.io';
import { HavenSocket, SendMessagePayload, TypingPayload, DeleteMessagePayload, ToggleReactionPayload } from '../types';
import { dbWrapper } from '../database';
import { validateMessageContent } from '../config/security';

const ALLOWED_MESSAGE_TYPES = new Set(['message', 'image', 'audio', 'video', 'file', 'poll', 'system', 'self-destruct']);

export function registerMessageHandlers(
    io: Server,
    socket: HavenSocket,
    rateCheck: (event: string) => boolean
): void {
    const db = dbWrapper;

    // ── Yeni Mesaj Gönderme ──
    socket.on('send-message', (data: SendMessagePayload) => {
        if (!rateCheck('send-message')) return;
        if (!socket.roomKey || !data || typeof data !== 'object') return;

        const validation = validateMessageContent(data.content);
        if (!validation.valid) {
            socket.emit('error', validation.error || 'Geçersiz mesaj içeriği.');
            return;
        }

        const safeContent = validation.value!;
        const msgType = (data.type && ALLOWED_MESSAGE_TYPES.has(data.type)) ? data.type : 'message';
        const replyTo = (typeof data.replyTo === 'number' || typeof data.replyTo === 'string') ? data.replyTo : null;

        const room = db.prepare('SELECT 1 FROM rooms WHERE room_key = ?').get(socket.roomKey);
        if (!room) return;

        let result;
        if (replyTo) {
            result = db.prepare(`INSERT INTO messages (room_key, username, avatar_color, profile_pic, content, type, reply_to, session_id, user_id, user_secret) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
                .run(socket.roomKey, socket.nickname, socket.avatarColor, socket.profilePic, safeContent, msgType, replyTo, socket.sessionId, socket.userId || null, socket.userSecret || null);
        } else {
            result = db.prepare(`INSERT INTO messages (room_key, username, avatar_color, profile_pic, content, type, session_id, user_id, user_secret) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
                .run(socket.roomKey, socket.nickname, socket.avatarColor, socket.profilePic, safeContent, msgType, socket.sessionId, socket.userId || null, socket.userSecret || null);
        }

        let replyData: { username: string; content: string } | null = null;
        if (replyTo) {
            const repMsg = db.prepare('SELECT username, content FROM messages WHERE id = ?').get(replyTo) as { username: string; content: string } | undefined;
            if (repMsg) {
                replyData = { username: repMsg.username, content: repMsg.content };
            }
        }

        const messageData = {
            id: result.lastInsertRowid,
            roomId: socket.roomKey,
            username: socket.nickname,
            avatarColor: socket.avatarColor,
            profilePic: socket.profilePic,
            profile_pic: socket.profilePic,
            user_id: socket.userId || null,
            content: safeContent,
            type: msgType,
            reply_to: replyTo,
            reply_username: replyData ? replyData.username : null,
            reply_content: replyData ? replyData.content : null,
            reactions: '{}',
            created_at: new Date().toISOString()
        };

        io.to(socket.roomKey).emit('new-message', messageData);
    });

    // ── Yazıyor Sinyali (Typing) ──
    socket.on('typing', (data: TypingPayload) => {
        if (!rateCheck('typing')) return;
        if (!socket.roomKey) return;
        socket.to(socket.roomKey).emit('user-typing', {
            username: socket.nickname,
            isTyping: !!data?.isTyping
        });
    });

    // ── Mesaj Sabitleme (Pin/Unpin) ──
    socket.on('pin-message', (data: { messageId: string | number, isPinned: boolean }) => {
        if (!socket.roomKey || !data || data.messageId === undefined) return;
        const isPinnedNum = data.isPinned ? 1 : 0;
        db.prepare('UPDATE messages SET is_pinned = ? WHERE id = ? AND room_key = ?').run(isPinnedNum, data.messageId, socket.roomKey);

        io.to(socket.roomKey).emit('message-pinned', {
            messageId: data.messageId,
            isPinned: !!data.isPinned
        });
    });

    // ── Mesaj Silme (IDOR Korumalı) ──
    socket.on('delete-message', (data: DeleteMessagePayload) => {
        const { messageId } = data;
        if (!socket.roomKey || !messageId) return;

        const msg = db.prepare('SELECT user_id, user_secret, session_id, type FROM messages WHERE id = ? AND room_key = ?').get(messageId, socket.roomKey) as { user_id: string | null; user_secret: string | null; session_id: string | null; type: string } | undefined;
        if (!msg) return;

        // IDOR Kontrolü: Mesaj gerçekten silmeye çalışan kullanıcıya mı ait?
        const isOwner =
            (socket.userSecret && msg.user_secret && socket.userSecret === msg.user_secret) ||
            (socket.sessionId && msg.session_id && socket.sessionId === msg.session_id) ||
            (socket.userId && msg.user_id && socket.userId === msg.user_id) ||
            (msg.type === 'self-destruct');

        if (!isOwner) {
            console.warn(`[GÜVENLİK/IDOR] Yetkisiz mesaj silme denemesi: ${socket.nickname} (id: ${messageId})`);
            return;
        }

        db.prepare('DELETE FROM messages WHERE id = ?').run(messageId);
        io.to(socket.roomKey).emit('message-deleted', messageId);
    });

    // ── Mesaj Düzenleme (IDOR Korumalı) ──
    socket.on('edit-message', (data: { messageId: string | number, newContent: string }) => {
        if (!rateCheck('edit-message')) return;
        if (!socket.roomKey || !data || !data.messageId || !data.newContent) return;

        const validation = validateMessageContent(data.newContent);
        if (!validation.valid) {
            socket.emit('error', validation.error || 'Geçersiz mesaj içeriği.');
            return;
        }

        const safeNewContent = validation.value!;
        const { messageId } = data;

        const msg = db.prepare('SELECT username, user_id, user_secret, session_id, content, created_at, edit_history FROM messages WHERE id = ? AND room_key = ?').get(messageId, socket.roomKey) as { username: string; user_id: string | null; user_secret: string | null; session_id: string | null; content: string; created_at: string; edit_history: string | null } | undefined;
        if (!msg) return;

        const isOwner =
            (socket.userSecret && msg.user_secret && socket.userSecret === msg.user_secret) ||
            (socket.sessionId && msg.session_id && socket.sessionId === msg.session_id) ||
            (socket.userId && msg.user_id && socket.userId === msg.user_id);

        if (!isOwner) {
            console.warn(`[GÜVENLİK/IDOR] Yetkisiz mesaj düzenleme denemesi: ${socket.nickname} (id: ${messageId})`);
            return;
        }

        let createdAtStr = msg.created_at;
        if (createdAtStr && !createdAtStr.endsWith('Z')) createdAtStr += 'Z';
        const msgTime = new Date(createdAtStr).getTime();
        const now = Date.now();
        if (now - msgTime > 15 * 60 * 1000) {
            socket.emit('error', 'Mesaj düzenleme süresi (15 dk) doldu.');
            return;
        }

        let historyArray: Array<{ content: string, edited_at: string }> = [];
        try {
            if (msg.edit_history) historyArray = JSON.parse(msg.edit_history);
        } catch (_e) { }

        historyArray.push({
            content: msg.content,
            edited_at: new Date().toISOString()
        });

        const newHistoryStr = JSON.stringify(historyArray);
        db.prepare('UPDATE messages SET content = ?, is_edited = 1, edit_history = ? WHERE id = ?').run(safeNewContent, newHistoryStr, messageId);

        io.to(socket.roomKey).emit('message-edited', {
            messageId,
            newContent: safeNewContent,
            editHistory: newHistoryStr,
            isEdited: true
        });
    });

    // ── Mesaj Tepkisi (Toggle Reaction) ──
    socket.on('toggle-reaction', (data: ToggleReactionPayload) => {
        if (!rateCheck('toggle-reaction')) return;
        if (!socket.roomKey || !data || !data.messageId || !data.emoji) return;

        const { messageId, emoji } = data;
        // Tepki formatı doğrulaması (maks 32 karakter)
        if (typeof emoji !== 'string' || emoji.length === 0 || emoji.length > 32) return;

        const msg = db.prepare('SELECT reactions FROM messages WHERE id = ? AND room_key = ?').get(messageId, socket.roomKey) as { reactions: string } | undefined;
        if (!msg) return;

        let reactionsObj: Record<string, string[]> = {};
        try {
            if (msg.reactions) reactionsObj = JSON.parse(msg.reactions);
        } catch (_e) { }

        if (!reactionsObj[emoji]) {
            reactionsObj[emoji] = [];
        }

        const userIndex = reactionsObj[emoji].indexOf(socket.nickname!);
        if (userIndex > -1) {
            reactionsObj[emoji].splice(userIndex, 1);
            if (reactionsObj[emoji].length === 0) {
                delete reactionsObj[emoji];
            }
        } else {
            reactionsObj[emoji].push(socket.nickname!);
        }

        const newReactionsStr = JSON.stringify(reactionsObj);
        db.prepare('UPDATE messages SET reactions = ? WHERE id = ?').run(newReactionsStr, messageId);

        io.to(socket.roomKey).emit('message-reaction-update', {
            messageId,
            reactions: newReactionsStr
        });
    });

    // ── Anket Oylaması (Vote Poll) ──
    socket.on('vote-poll', (data: { messageId: number | string, optionIndex: number, multiple: boolean }) => {
        if (!rateCheck('vote-poll')) return;
        if (!socket.roomKey || !data || !data.messageId || data.optionIndex === undefined) return;

        const { messageId, optionIndex, multiple } = data;
        if (typeof optionIndex !== 'number' || optionIndex < 0 || optionIndex > 20) return;

        const msg = db.prepare('SELECT reactions FROM messages WHERE id = ? AND room_key = ?').get(messageId, socket.roomKey) as { reactions: string } | undefined;
        if (!msg) return;

        let reactionsObj: Record<string, string[]> = {};
        try {
            if (msg.reactions) reactionsObj = JSON.parse(msg.reactions);
        } catch (_e) { }

        const pollKey = `pollopt_${optionIndex}`;

        if (!multiple) {
            Object.keys(reactionsObj).forEach(key => {
                if (key.startsWith('pollopt_') && key !== pollKey) {
                    const idx = reactionsObj[key].indexOf(socket.nickname!);
                    if (idx > -1) {
                        reactionsObj[key].splice(idx, 1);
                        if (reactionsObj[key].length === 0) delete reactionsObj[key];
                    }
                }
            });
        }

        if (!reactionsObj[pollKey]) reactionsObj[pollKey] = [];

        const userIndex = reactionsObj[pollKey].indexOf(socket.nickname!);
        if (userIndex > -1) {
            reactionsObj[pollKey].splice(userIndex, 1);
            if (reactionsObj[pollKey].length === 0) delete reactionsObj[pollKey];
        } else {
            reactionsObj[pollKey].push(socket.nickname!);
        }

        const newReactionsStr = JSON.stringify(reactionsObj);
        db.prepare('UPDATE messages SET reactions = ? WHERE id = ?').run(newReactionsStr, messageId);

        io.to(socket.roomKey).emit('message-reaction-update', {
            messageId,
            reactions: newReactionsStr
        });
    });
}
