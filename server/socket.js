const { dbWrapper: db } = require('./database');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');

// Aktif arama (ringing) durumları: roomKey -> { callerId, callerName, avatarColor, profilePic }
const activeRinging = new Map();

// Sesli kanaldaki kullanıcılar: roomKey -> Map<socketId, { userId, username, avatarColor, profilePic }>
const activeVoiceUsers = new Map();

function setupSocketListeners(io) {
    io.on('connection', (socket) => {

        const _eventCounters = {};
        const _LIMITS = {
            'send-message':    { max: 15,  windowMs: 5000  }, // 5 sn'de 15 mesaj
            'join-room':       { max: 3,   windowMs: 10000 }, // 10 sn'de 3 deneme
            'toggle-reaction': { max: 30,  windowMs: 5000  }, // 5 sn'de 30 tepki
            'typing':          { max: 20,  windowMs: 5000  }, // 5 sn'de 20 yazıyor sinyali
        };

        function _rateCheck(eventName) {
            const limit = _LIMITS[eventName];
            if (!limit) return true;
            const now = Date.now();
            const c = _eventCounters[eventName];
            if (!c || (now - c.start) > limit.windowMs) {
                _eventCounters[eventName] = { count: 1, start: now, warned: false };
                return true;
            }
            if (c.count >= limit.max) {
                if (!c.warned) {
                    console.warn(`[RATE] ${socket.nickname || socket.id} → '${eventName}' limit aşıldı!`);
                    c.warned = true;
                }
                
                if (c.count > limit.max + 50) {
                    console.error(`[DDOS] ${socket.nickname || socket.id} aşırı istek gönderdiği için bağlantısı koparıldı!`);
                    socket.disconnect(true);
                }
                
                c.count++;
                return false;
            }
            c.count++;
            return true;
        }

        // Kullanıcı giriş yaptığında (Bir Odaya katıldığında)
        socket.on('join-room', ({ userId, nickname, roomKey, avatarColor, profilePic, authKey, mode, sessionId, userToken }) => {
            if (!_rateCheck('join-room')) return;
            if (!nickname || !roomKey || !authKey) {
                socket.emit('join-error', 'Takma ad, oda anahtarı ve şifre gereklidir.');
                return;
            }

            const joinMode = mode || 'create';

            let room = db.prepare('SELECT password_hash FROM rooms WHERE room_key = ?').get(roomKey);

            if (!room) {
                if (joinMode === 'join') {
                    socket.emit('join-error', 'Bu oda mevcut değil! Lütfen geçerli bir oda anahtarı girin.');
                    return;
                }
                const e2eeSalt = crypto.randomBytes(32).toString('hex');
                const hash = bcrypt.hashSync(authKey, 10);
                db.prepare('INSERT INTO rooms (room_key, password_hash, e2ee_salt) VALUES (?, ?, ?)').run(roomKey, hash, e2eeSalt);
                console.log(`[AUTH] Yeni oda oluşturuldu: ${roomKey}`);
            } else {
                if (!bcrypt.compareSync(authKey, room.password_hash)) {
                    console.log(`[AUTH] ${nickname} yanlış şifre ile ${roomKey} odasına girmeyi denedi.`);
                    socket.emit('join-error', 'Geçersiz oda şifresi!');
                    return;
                } else {
                    console.log(`[AUTH] ${nickname}, ${roomKey} odasına başarıyla giriş yaptı.`);
                }
            }

            socket.userId = userId || null;
            socket.nickname = nickname;
            socket.roomKey = roomKey;
            socket.avatarColor = avatarColor || '#6366f1';
            socket.profilePic = profilePic || null;
            socket.sessionId = sessionId || crypto.randomUUID();
            socket.userSecret = userToken || null;

            const uploadToken = crypto.randomBytes(16).toString('hex');
            socket.uploadToken = uploadToken;
            global.validUploadTokens.add(uploadToken);
            setTimeout(() => global.validUploadTokens.delete(uploadToken), 12 * 60 * 60 * 1000);
            socket.emit('upload-token', uploadToken);

            // Eski mesajları sahiplenme ve güncelleme
            if (socket.userSecret) {
                try {
                    // 1) user_secret ile eşleşen mesajların ismini güncelle
                    db.prepare('UPDATE messages SET username = ?, avatar_color = ?, profile_pic = ? WHERE user_secret = ? AND room_key = ? AND username != ?')
                        .run(nickname, socket.avatarColor, socket.profilePic, socket.userSecret, roomKey, nickname);

                    // 2) user_secret'i olmayan ama aynı profile_pic'e sahip mesajları da sahiplen
                    if (socket.profilePic) {
                        db.prepare('UPDATE messages SET user_id = ?, user_secret = ?, username = ?, avatar_color = ? WHERE profile_pic = ? AND room_key = ? AND (user_secret IS NULL OR user_secret = ?)')
                            .run(socket.userId, socket.userSecret, nickname, socket.avatarColor, socket.profilePic, roomKey, socket.userSecret);
                    }
                } catch (e) {
                    console.error('Eski mesaj güncelleme hatası:', e);
                }
            }

            socket.join(roomKey);

            const roomSaltRow = db.prepare('SELECT e2ee_salt FROM rooms WHERE room_key = ?').get(roomKey);
            if (roomSaltRow && roomSaltRow.e2ee_salt) {
                socket.emit('room-e2ee-salt', { salt: roomSaltRow.e2ee_salt });
            } else {
                socket.emit('room-e2ee-salt', { salt: null });
            }

            updateOnlineUsers(io, roomKey);
            socket.to(roomKey).emit('user-joined', { msg: `${nickname} odaya katıldı.` });

            // Son 100 mesaj geçmişini gönder (LEFT JOIN ile yanıtlanan mesajı da getir)
            // GÜVENLİK (IDOR): user_secret'in istemciye sızmasını engellemek için SELECT ile sadece gereken kolonları alıyoruz
            const history = db.prepare(`
                SELECT m.id, m.room_key, m.username, m.avatar_color, m.content, m.type, m.reply_to, m.profile_pic, m.reactions, m.user_id, m.created_at, r.username as reply_username, r.content as reply_content 
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

        socket.on('update-profile', ({ oldNickname, nickname, avatarColor, profilePic } = {}) => {
            if (!socket.roomKey) return;
            const prevNickname = oldNickname || socket.nickname;
            socket.nickname = nickname || socket.nickname;
            socket.avatarColor = avatarColor || socket.avatarColor;
            socket.profilePic = profilePic !== undefined ? profilePic : socket.profilePic;

            // Veritabanındaki eski mesajları güncelle (userSecret veya eski isim ile)
            try {
                if (socket.userSecret) {
                    // userSecret varsa, aynı kullanıcıya ait TÜM mesajları güncelle
                    db.prepare('UPDATE messages SET username = ?, avatar_color = ?, profile_pic = ? WHERE user_secret = ? AND room_key = ?')
                        .run(socket.nickname, socket.avatarColor, socket.profilePic, socket.userSecret, socket.roomKey);
                } else if (prevNickname && prevNickname !== socket.nickname) {
                    db.prepare('UPDATE messages SET username = ? WHERE username = ? AND room_key = ?')
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
                    const voiceRoom = activeVoiceUsers.get(socket.roomKey);
                    if (voiceRoom.has(socket.id)) {
                        const voiceUser = voiceRoom.get(socket.id);
                        voiceUser.username = socket.nickname;
                        voiceUser.avatarColor = socket.avatarColor;
                        voiceUser.profilePic = socket.profilePic;

                        io.to(socket.roomKey).emit('active-voice-users', Array.from(voiceRoom.values()));
                    }
                }
            } catch (e) {
                console.error('İsim güncelleme hatası:', e);
            }

            updateOnlineUsers(io, socket.roomKey);
        });

        socket.on('send-message', ({ content, type, replyTo } = {}) => {
            if (!_rateCheck('send-message')) return;
            if (!socket.roomKey || !content) return;

            const msgType = type || 'message';
            const safeContent = content;

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

            let replyData = null;
            if (replyTo) {
                const repMsg = db.prepare('SELECT username, content FROM messages WHERE id = ?').get(replyTo);
                if (repMsg) {
                    replyData = { username: repMsg.username, content: repMsg.content };
                }
            }

            const messageData = {
                id: result.lastInsertRowid,
                roomId: socket.roomKey,
                username: socket.nickname,
                avatarColor: socket.avatarColor,
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

        socket.on('typing', ({ isTyping } = {}) => {
            if (!_rateCheck('typing')) return;
            if (!socket.roomKey) return;
            socket.to(socket.roomKey).emit('user-typing', {
                username: socket.nickname,
                isTyping: !!isTyping
            });
        });

        socket.on('delete-message', ({ messageId } = {}) => {
            if (!socket.roomKey || !messageId) return;

            // FIX #10: Sahiplik kontrolü user_secret > session_id sırasıyla yapılıyor.
            // IDOR Zafiyeti Kapatıldı: Herkese yayınlanan user_id yerine gizli user_secret kullanılıyor.
            const msg = db.prepare('SELECT username, user_secret, session_id, type FROM messages WHERE id = ? AND room_key = ?').get(messageId, socket.roomKey);
            if (!msg) return;

            const isOwner =
                (socket.userSecret && msg.user_secret && socket.userSecret === msg.user_secret) ||
                (socket.sessionId && msg.session_id && socket.sessionId === msg.session_id) ||
                (msg.type === 'self-destruct');

            if (!isOwner) {
                console.warn(`[GÜVENLİK] Yetkisiz mesaj silme denemesi: ${socket.nickname} (id: ${messageId})`);
                return;
            }

            db.prepare('DELETE FROM messages WHERE id = ?').run(messageId);
            io.to(socket.roomKey).emit('message-deleted', messageId);
        });

        socket.on('edit-message', ({ messageId, newContent } = {}) => {
            if (!_rateCheck('edit-message')) return;
            if (!socket.roomKey || !messageId || !newContent) return;

            const msg = db.prepare('SELECT username, user_id, session_id, content, created_at, edit_history FROM messages WHERE id = ? AND room_key = ?').get(messageId, socket.roomKey);
            if (!msg) return;

            const isOwner =
                (socket.sessionId && msg.session_id && socket.sessionId === msg.session_id) ||
                (socket.userId    && msg.user_id    && socket.userId    === msg.user_id);

            if (!isOwner) {
                console.warn(`[GÜVENLİK] Yetkisiz mesaj düzenleme denemesi: ${socket.nickname} (id: ${messageId})`);
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

            let historyArray = [];
            try {
                if (msg.edit_history) historyArray = JSON.parse(msg.edit_history);
            } catch(e) {}
            
            historyArray.push({
                content: msg.content,
                edited_at: new Date().toISOString()
            });
            const newHistoryStr = JSON.stringify(historyArray);

            db.prepare('UPDATE messages SET content = ?, is_edited = 1, edit_history = ? WHERE id = ?').run(newContent, newHistoryStr, messageId);

            io.to(socket.roomKey).emit('message-edited', {
                messageId: messageId,
                newContent: newContent,
                editHistory: historyArray,
                isEdited: true
            });
        });

        socket.on('toggle-reaction', ({ messageId, emoji } = {}) => {
            if (!_rateCheck('toggle-reaction')) return;
            if (!socket.roomKey || !messageId || !emoji) return;

            const msg = db.prepare('SELECT reactions FROM messages WHERE id = ? AND room_key = ?').get(messageId, socket.roomKey);
            if (!msg) return;

            let reactionsObj = {};
            try {
                if (msg.reactions) reactionsObj = JSON.parse(msg.reactions);
            } catch (e) { }

            if (!reactionsObj[emoji]) {
                reactionsObj[emoji] = [];
            }

            const userIndex = reactionsObj[emoji].indexOf(socket.nickname);
            if (userIndex > -1) {
                reactionsObj[emoji].splice(userIndex, 1);
                if (reactionsObj[emoji].length === 0) {
                    delete reactionsObj[emoji];
                }
            } else {
                reactionsObj[emoji].push(socket.nickname);
            }

            const newReactionsStr = JSON.stringify(reactionsObj);
            db.prepare('UPDATE messages SET reactions = ? WHERE id = ?').run(newReactionsStr, messageId);

            io.to(socket.roomKey).emit('message-reaction-update', {
                messageId,
                reactions: newReactionsStr
            });
        });

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

        // WebRTC P2P Sesli İletişim (Sinyal)
        socket.on('voice-join', () => {
            if (!socket.roomKey) return;

            if (activeRinging.has(socket.roomKey)) {
                activeRinging.delete(socket.roomKey);
                io.to(socket.roomKey).emit('call-answered');
            }

            if (!activeVoiceUsers.has(socket.roomKey)) {
                activeVoiceUsers.set(socket.roomKey, new Map());
            }
            
            const users = activeVoiceUsers.get(socket.roomKey);
            users.set(socket.id, { id: socket.id, username: socket.nickname, avatarColor: socket.avatarColor, profilePic: socket.profilePic, isMicOn: true });

            io.to(socket.roomKey).emit('active-voice-users', Array.from(users.values()));

            socket.to(socket.roomKey).emit('voice-join', {
                userId: socket.id,
                username: socket.nickname,
                avatarColor: socket.avatarColor,
                profilePic: socket.profilePic
            });
        });

        socket.on('voice-leave', () => {
            if (!socket.roomKey) return;

            const voiceUsers = activeVoiceUsers.get(socket.roomKey);
            if (voiceUsers) {
                voiceUsers.delete(socket.id);
                if (voiceUsers.size === 0) {
                    activeVoiceUsers.delete(socket.roomKey);
                    activeRinging.delete(socket.roomKey);
                }
                io.to(socket.roomKey).emit('active-voice-users',
                    Array.from((activeVoiceUsers.get(socket.roomKey) || new Map()).values())
                );
            }

            socket.to(socket.roomKey).emit('voice-leave', {
                userId: socket.id,
                username: socket.nickname
            });
        });

        socket.on('voice-call-declined', (data) => {
            if (!socket.roomKey) return;
            socket.to(socket.roomKey).emit('voice-call-declined', {
                username: data.username
            });
        });

        socket.on('voice-call-room', () => {
            if (!socket.roomKey) return;
            const ringingData = {
                callerId: socket.id,
                callerName: socket.nickname,
                avatarColor: socket.avatarColor,
                profilePic: socket.profilePic
            };
            activeRinging.set(socket.roomKey, ringingData);
            socket.to(socket.roomKey).emit('room-is-ringing', ringingData);
        });

        socket.on('call-ended', () => {
            if (!socket.roomKey) return;
            activeRinging.delete(socket.roomKey);
            const voiceUsers = activeVoiceUsers.get(socket.roomKey);
            if (voiceUsers) {
                voiceUsers.delete(socket.id);
                if (voiceUsers.size === 0) {
                    activeVoiceUsers.delete(socket.roomKey);
                }
                io.to(socket.roomKey).emit('active-voice-users',
                    Array.from((activeVoiceUsers.get(socket.roomKey) || new Map()).values())
                );
            }
        });

        socket.on('webrtc-offer', ({ targetId, offer } = {}) => {
            io.to(targetId).emit('webrtc-offer', {
                senderId: socket.id,
                senderName: socket.nickname,
                offer
            });
        });

        socket.on('webrtc-answer', ({ targetId, answer } = {}) => {
            io.to(targetId).emit('webrtc-answer', {
                senderId: socket.id,
                answer
            });
        });

        socket.on('webrtc-candidate', ({ targetId, candidate } = {}) => {
            io.to(targetId).emit('webrtc-candidate', {
                senderId: socket.id,
                candidate
            });
        });

        socket.on('screen-share-state', ({ isSharing } = {}) => {
            if (!socket.roomKey) return;
            socket.to(socket.roomKey).emit('screen-share-state', {
                userId: socket.id,
                username: socket.nickname,
                isSharing: !!isSharing
            });
        });

        socket.on('mic-state', ({ isMicOn } = {}) => {
            if (!socket.roomKey) return;
            
            const users = activeVoiceUsers.get(socket.roomKey);
            if (users) {
                const user = users.get(socket.id);
                if (user) user.isMicOn = !!isMicOn;
            }
            
            socket.to(socket.roomKey).emit('user-mic-state', {
                userId: socket.id,
                isMicOn: !!isMicOn
            });
        });

        socket.on('p2p-file-offer', ({ targetId, offer, fileMeta } = {}) => {
            io.to(targetId).emit('p2p-file-offer', {
                senderId: socket.id,
                senderName: socket.nickname,
                offer,
                fileMeta
            });
        });

        socket.on('p2p-file-answer', ({ targetId, answer, fileId } = {}) => {
            io.to(targetId).emit('p2p-file-answer', {
                senderId: socket.id,
                answer,
                fileId
            });
        });

        socket.on('p2p-file-candidate', ({ targetId, candidate, fileId } = {}) => {
            io.to(targetId).emit('p2p-file-candidate', {
                senderId: socket.id,
                candidate,
                fileId
            });
        });
    });
}

function updateOnlineUsers(io, roomKey) {
    if (!roomKey) return;

    const sockets = io.sockets.adapter.rooms.get(roomKey);
    const users = [];

    if (sockets) {
        for (const clientId of sockets) {
            const clientSocket = io.sockets.sockets.get(clientId);
            if (clientSocket && clientSocket.nickname) {
                users.push({
                    username: clientSocket.nickname,
                    avatarColor: clientSocket.avatarColor,
                    profilePic: clientSocket.profilePic || null,
                    id: clientId
                });
            }
        }
    }

    io.to(roomKey).emit('online-users', users);
}

module.exports = { setupSocketListeners };
