/**
 * index.js - Minimal Oda Tabanlı Sohbet Sunucusu (Backend Server)
 * 
 * Neler Var:
 * - Cihazın kendi içerisinde barındıracağı ana Express.js web sunucusu ve Socket.io tüneli burada yapılandırılır.
 * - Kullanıcıların (P2P veya websocket üzerinden) odalara katılması, mesaj göndermesi, WebRTC sinyalleşmesi (ses/video/dosya gönderimi) yönetilir.
 * - Odanın şifresinin hashlenerek SQLite veritabanında saklanması sağlanır.
 * 
 * Ayarlar / Özellikler:
 * - Çevrimiçi oda mantığına dayanır; sabit bir kullanıcı hesabı oluşturma veya davet kodu yoktur. Oda anahtarına ve şifresine sahip olanlar katılabilir.
 * - CORS (Cross-Origin Resource Sharing) ayarlarına, `electron` ve `cloudflare` isteklerine izin verilecek şekilde yapılandırılmıştır.
 * - `express-rate-limit` kullanılarak DDOS ve brute-force saldırılarına karşı korunma sağlanmıştır (Dakikada 300 istek limiti).
 * - "Zararlı HTML (XSS)" temizlemek için `sanitize-html` entegredir.
 * - `transports: ['polling', 'websocket']` Cloudflare Tünelleri göz önünde bulundurularak ayarlanmıştır.
 */

require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const path = require('path');
const { initializeDatabase, dbWrapper } = require('./database');
const { rateLimit } = require('express-rate-limit');
const sanitizeHtml = require('sanitize-html');
const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');

const PORT = process.env.PORT || 3847;
const HOST = process.env.HOST || '0.0.0.0'; // 0.0.0.0 allows tunnel to connect via any interface

const app = express();
app.set('trust proxy', 1); // Fixes express-rate-limit warning behind Cloudflare tunnel

const server = http.createServer(app);

// CORS: Electron file:// protokolünden origin 'null' olarak geliyor,
// Cloudflare tünelinden HTTPS origin geliyor. Hepsini kabul et.
const corsOptions = {
    origin: function (origin, callback) {
        // origin yok (Electron, Postman, NodeJS istekleri) ya da herhangi bir origin → kabul et
        callback(null, origin || '*');
    },
    methods: ['GET', 'POST', 'OPTIONS'],
    credentials: false // '*' origin ile credentials: true aynı anda kullanılamaz!
};

const io = new Server(server, {
    cors: corsOptions,
    transports: ['polling', 'websocket'], // polling önce, sonra websocket'e upgrade (Cloudflare uyumlu)
    allowUpgrades: true,
    upgradeTimeout: 10000,
    pingTimeout: 60000,
    pingInterval: 25000,
    connectTimeout: 45000,
    maxHttpBufferSize: 10e6 // 10 MB (dosya transferi için)
});

app.use(cors(corsOptions));
app.options('*', cors(corsOptions)); // Preflight isteklerini karşıla
app.use(express.json());

// DDoS / Brute-Force koruması (Rate Limiting)
// /socket.io/ polling endpoint'i hiçbir zaman rate-limit'e dahil etme!
const apiLimiter = rateLimit({
    windowMs: 1 * 60 * 1000, // 1 dakika
    max: 300,
    message: 'Çok fazla istek gönderdiniz, lütfen biraz bekleyin.',
    skip: (req) => req.path.startsWith('/socket.io')
});

// Rate limiter’ı yalnızca API rotalarına uygula
app.use('/api', apiLimiter);
app.use('/api/upload', apiLimiter);

// Uploads ve Statik Dosyalar
app.use(express.static(path.join(__dirname, '../app/renderer')));
const uploadsDir = process.env.DATA_DIR ? path.join(process.env.DATA_DIR, 'uploads') : path.join(__dirname, '../data/uploads');
const fs = require('fs');
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });
app.use('/uploads', express.static(uploadsDir));

// Upload routes
const uploadRoutes = require('./upload');
app.use('/api/upload', uploadRoutes);

app.get('/api/health', (req, res) => res.json({ status: 'ok' }));

// ============================================
// ADMIN API — Sadece localhost (sunucu sahibi) erişebilir
// ============================================
function isLocalhost(req) {
    const ip = req.ip || req.connection.remoteAddress || '';
    return ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1' || ip === 'localhost' || ip === '::ffff:127.0.0.1';
}

function adminOnly(req, res, next) {
    if (!isLocalhost(req)) {
        return res.status(403).json({ success: false, error: 'Bu işlem sadece sunucu sahibi tarafından yapılabilir.' });
    }
    next();
}

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

app.get('/', (req, res) => res.sendFile(path.join(__dirname, '../app/renderer/login.html')));

// Aktif arama (ringing) durumları: roomKey -> { callerId, callerName, avatarColor, profilePic }
const activeRinging = new Map();

// Sesli kanaldaki kullanıcılar: roomKey -> Map<socketId, { userId, username, avatarColor, profilePic }>
const activeVoiceUsers = new Map();

async function startServer(portArg = null) {
    const db = await initializeDatabase();

    // Socket.IO mantığı
    io.on('connection', (socket) => {
        // Kullanıcı giriş yaptığında (Bir Odaya katıldığında)
        socket.on('join-room', ({ userId, nickname, roomKey, avatarColor, profilePic, authKey, mode }) => {
            if (!nickname || !roomKey || !authKey) {
                socket.emit('join-error', 'Takma ad, oda anahtarı ve şifre gereklidir.');
                return;
            }

            const joinMode = mode || 'create'; // Eski istemciler için varsayılan: oda oluştur

            // Odanın parolasını kontrol et (veya oluştur)
            let room = db.prepare('SELECT password_hash FROM rooms WHERE room_key = ?').get(roomKey);

            if (!room) {
                // Oda mevcut değil
                if (joinMode === 'join') {
                    // "Ağa Katıl" modunda: mevcut olmayan odaya giriş engellenir
                    socket.emit('join-error', 'Bu oda mevcut değil! Lütfen geçerli bir oda anahtarı girin.');
                    return;
                }
                // "Ağ Kur" modunda: Oda ilk kez oluşturuluyor, şifrenizi hash'le
                const hash = bcrypt.hashSync(authKey, 10);
                db.prepare('INSERT INTO rooms (room_key, password_hash) VALUES (?, ?)').run(roomKey, hash);
                console.log(`[AUTH] Yeni oda oluşturuldu: ${roomKey}`);
            } else {
                // Odaya giriliyor, şifre doğrula
                if (!bcrypt.compareSync(authKey, room.password_hash)) {
                    console.log(`[AUTH] ${nickname} yanlış şifre ile ${roomKey} odasına girmeyi denedi.`);
                    socket.emit('join-error', 'Geçersiz oda şifresi!');
                    return; // Giremez!
                } else {
                    console.log(`[AUTH] ${nickname}, ${roomKey} odasına başarıyla giriş yaptı.`);
                }
            }

            socket.userId = userId || null;
            socket.nickname = nickname;
            socket.roomKey = roomKey;
            socket.avatarColor = avatarColor || '#6366f1';
            socket.profilePic = profilePic || null;
            socket.sessionId = uuidv4(); // Mesaj silme güvenliği için benzersiz oturum ID

            // Eski mesajları sahiplenme ve güncelleme
            if (socket.userId) {
                try {
                    // 1) user_id ile eşleşen mesajların ismini güncelle
                    db.prepare('UPDATE messages SET username = ?, avatar_color = ?, profile_pic = ? WHERE user_id = ? AND room_key = ? AND username != ?')
                        .run(nickname, socket.avatarColor, socket.profilePic, socket.userId, roomKey, nickname);

                    // 2) user_id'si olmayan ama aynı profile_pic'e sahip mesajları da sahiplen
                    if (socket.profilePic) {
                        db.prepare('UPDATE messages SET user_id = ?, username = ?, avatar_color = ? WHERE profile_pic = ? AND room_key = ? AND (user_id IS NULL OR user_id = ?)')
                            .run(socket.userId, nickname, socket.avatarColor, socket.profilePic, roomKey, socket.userId);
                    }
                } catch (e) {
                    console.error('Eski mesaj güncelleme hatası:', e);
                }
            }

            socket.join(roomKey);

            // Odadaki online kullanıcıları topla
            updateOnlineUsers(roomKey);

            // Yeni giriş bilgisini odadakilere gönder
            socket.to(roomKey).emit('user-joined', { msg: `${nickname} odaya katıldı.` });

            // Son 100 mesaj geçmişini gönder (LEFT JOIN ile yanıtlanan mesajı da getir)
            const history = db.prepare(`
                SELECT m.*, r.username as reply_username, r.content as reply_content 
                FROM messages m 
                LEFT JOIN messages r ON m.reply_to = r.id 
                WHERE m.room_key = ? 
                ORDER BY m.created_at DESC LIMIT 100
            `).all(roomKey).reverse(); // Eskiden yeniye doğru
            socket.emit('room-history', history);

            // Eğer odada aktif bir arama (ringing) varsa, yeni giren kullanıcıya bildir
            const ringingData = activeRinging.get(roomKey);
            if (ringingData && ringingData.callerId !== socket.id) {
                socket.emit('room-is-ringing', ringingData);
            }

            // Eğer odada sesli görüşmede olan kullanıcılar varsa, yeni girene bildir
            const voiceUsers = activeVoiceUsers.get(roomKey);
            if (voiceUsers && voiceUsers.size > 0) {
                const voiceUsersList = Array.from(voiceUsers.values());
                socket.emit('active-voice-users', voiceUsersList);
                // Eğer ringing yoksa ama sesli kanalda biri varsa da çaldır
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
        socket.on('update-profile', ({ oldNickname, nickname, avatarColor, profilePic }) => {
            if (!socket.roomKey) return;
            const prevNickname = oldNickname || socket.nickname;
            socket.nickname = nickname || socket.nickname;
            socket.avatarColor = avatarColor || socket.avatarColor;
            socket.profilePic = profilePic !== undefined ? profilePic : socket.profilePic;

            // Veritabanındaki eski mesajları güncelle (userId veya eski isim ile)
            try {
                if (socket.userId) {
                    // userId varsa, aynı kullanıcıya ait TÜM mesajları güncelle
                    db.prepare('UPDATE messages SET username = ?, avatar_color = ?, profile_pic = ? WHERE user_id = ? AND room_key = ?')
                        .run(socket.nickname, socket.avatarColor, socket.profilePic, socket.userId, socket.roomKey);
                } else if (prevNickname && prevNickname !== socket.nickname) {
                    // userId yoksa, eski isme göre güncelle (geriye uyumluluk)
                    db.prepare('UPDATE messages SET username = ? WHERE username = ? AND room_key = ?')
                        .run(socket.nickname, prevNickname, socket.roomKey);
                }
                console.log(`[PROFIL] ${prevNickname} → ${socket.nickname} (oda: ${socket.roomKey}), mesajlar güncellendi.`);

                // Odadaki diğer kullanıcılara isim değişikliğini bildir
                if (prevNickname !== socket.nickname) {
                    socket.to(socket.roomKey).emit('username-changed', {
                        oldUsername: prevNickname,
                        newUsername: socket.nickname,
                        avatarColor: socket.avatarColor
                    });
                }
            } catch (e) {
                console.error('İsim güncelleme hatası:', e);
            }

            // Yeni bilgileri odadaki online listesinde hemen güncelle
            updateOnlineUsers(socket.roomKey);
        });

        // Yeni mesaj geldiğinde
        socket.on('send-message', ({ content, type, replyTo }) => {
            if (!socket.roomKey || !content) return;

            const msgType = type || 'message';

            // XSS ve Zararlı HTML Etiketleri Koruması
            let safeContent = content;
            if (msgType === 'message') {
                safeContent = sanitizeHtml(content, {
                    allowedTags: ['b', 'i', 'em', 'strong', 'a', 'br'],
                    allowedAttributes: { 'a': ['href'] }
                });
            }

            // Oda varlığı ve yazma yetkisi kontrolü
            const room = db.prepare('SELECT 1 FROM rooms WHERE room_key = ?').get(socket.roomKey);
            if (!room) return;

            // DB'ye kaydet
            let result;
            if (replyTo) {
                result = db.prepare(`INSERT INTO messages (room_key, username, avatar_color, profile_pic, content, type, reply_to, session_id, user_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
                    .run(socket.roomKey, socket.nickname, socket.avatarColor, socket.profilePic, safeContent, msgType, replyTo, socket.sessionId, socket.userId || null);
            } else {
                result = db.prepare(`INSERT INTO messages (room_key, username, avatar_color, profile_pic, content, type, session_id, user_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
                    .run(socket.roomKey, socket.nickname, socket.avatarColor, socket.profilePic, safeContent, msgType, socket.sessionId, socket.userId || null);
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

            // Mesajı aynı odadaki TARAFLARA (kendisi dâhil) yayınla
            io.to(socket.roomKey).emit('new-message', messageData);
        });

        // Yazıyor göstergesi
        socket.on('typing', ({ isTyping }) => {
            if (!socket.roomKey) return;
            socket.to(socket.roomKey).emit('user-typing', {
                username: socket.nickname,
                isTyping: !!isTyping
            });
        });

        // Mesaj silme işlemi
        socket.on('delete-message', ({ messageId }) => {
            if (!socket.roomKey || !messageId) return;

            // Sadece kendi mesajını silebilir (kullanıcı adı VEYA user_id kontrolü)
            const msg = db.prepare('SELECT username, user_id FROM messages WHERE id = ? AND room_key = ?').get(messageId, socket.roomKey);
            if (!msg) return;
            const isOwner = msg.username === socket.nickname || (socket.userId && msg.user_id === socket.userId);
            if (!isOwner) return; // Yetkisiz silme denemesi

            db.prepare('DELETE FROM messages WHERE id = ?').run(messageId);
            io.to(socket.roomKey).emit('message-deleted', messageId);
        });

        // Mesaj Tepkisi Ekle/Çıkar (Toggle)
        socket.on('toggle-reaction', ({ messageId, emoji }) => {
            if (!socket.roomKey || !messageId || !emoji) return;

            const msg = db.prepare('SELECT reactions FROM messages WHERE id = ? AND room_key = ?').get(messageId, socket.roomKey);
            if (!msg) return;

            let reactionsObj = {};
            try {
                if (msg.reactions) reactionsObj = JSON.parse(msg.reactions);
            } catch (e) { }

            // Eğer bu emoji dizisi yoksa oluştur
            if (!reactionsObj[emoji]) {
                reactionsObj[emoji] = [];
            }

            const userIndex = reactionsObj[emoji].indexOf(socket.nickname);
            if (userIndex > -1) {
                // Varsa çıkar
                reactionsObj[emoji].splice(userIndex, 1);
                // Liste boşaldıysa key'i sil
                if (reactionsObj[emoji].length === 0) {
                    delete reactionsObj[emoji];
                }
            } else {
                // Yoksa ekle
                reactionsObj[emoji].push(socket.nickname);
            }

            const newReactionsStr = JSON.stringify(reactionsObj);
            db.prepare('UPDATE messages SET reactions = ? WHERE id = ?').run(newReactionsStr, messageId);

            io.to(socket.roomKey).emit('message-reaction-update', {
                messageId,
                reactions: newReactionsStr
            });
        });

        // Çıkış (Disconnect)
        socket.on('disconnect', () => {
            if (socket.roomKey) {
                socket.to(socket.roomKey).emit('user-left', { msg: `${socket.nickname} odadan ayrıldı.` });

                // Sesli kanaldaysa düşür
                socket.to(socket.roomKey).emit('voice-leave', { userId: socket.id, username: socket.nickname });

                // Sesli kanal listesinden çıkar
                const voiceUsers = activeVoiceUsers.get(socket.roomKey);
                if (voiceUsers) {
                    voiceUsers.delete(socket.id);
                    if (voiceUsers.size === 0) {
                        activeVoiceUsers.delete(socket.roomKey);
                        activeRinging.delete(socket.roomKey);
                    }
                    // Güncel listeyi odaya bildir
                    io.to(socket.roomKey).emit('active-voice-users', Array.from(voiceUsers.values()));
                }

                // Eğer arayan kişi çıktıysa, ringing durumunu temizle
                const ringingData = activeRinging.get(socket.roomKey);
                if (ringingData && ringingData.callerId === socket.id) {
                    activeRinging.delete(socket.roomKey);
                    // Odadakilere aramanın iptal olduğunu bildir
                    socket.to(socket.roomKey).emit('call-cancelled');
                }

                updateOnlineUsers(socket.roomKey);
            }
        });

        // ===================================
        // WebRTC P2P Sesli İletişim (Sinyal)
        // ===================================

        // Ses kanalına katılma isteği
        socket.on('voice-join', () => {
            if (!socket.roomKey) return;

            // Birisi sese katıldıysa, ringing durumunu temizle (arama cevaplandı)
            if (activeRinging.has(socket.roomKey)) {
                activeRinging.delete(socket.roomKey);
                // Odadakilere aramanın cevaplandığını bildir (çalma sesini durdursunlar)
                io.to(socket.roomKey).emit('call-answered');
            }

            // Sesli kanal kullanıcı listesine ekle
            if (!activeVoiceUsers.has(socket.roomKey)) {
                activeVoiceUsers.set(socket.roomKey, new Map());
            }
            activeVoiceUsers.get(socket.roomKey).set(socket.id, {
                userId: socket.id,
                username: socket.nickname,
                avatarColor: socket.avatarColor,
                profilePic: socket.profilePic
            });

            // Güncel sesli kanal listesini tüm odaya bildir
            io.to(socket.roomKey).emit('active-voice-users',
                Array.from(activeVoiceUsers.get(socket.roomKey).values())
            );

            // Odadakilere X kişisi sese katıldı sinyali yolla
            socket.to(socket.roomKey).emit('voice-join', {
                userId: socket.id,
                username: socket.nickname,
                avatarColor: socket.avatarColor,
                profilePic: socket.profilePic
            });
        });

        socket.on('voice-leave', () => {
            if (!socket.roomKey) return;

            // Sesli kanal listesinden çıkar
            const voiceUsers = activeVoiceUsers.get(socket.roomKey);
            if (voiceUsers) {
                voiceUsers.delete(socket.id);
                if (voiceUsers.size === 0) {
                    activeVoiceUsers.delete(socket.roomKey);
                    activeRinging.delete(socket.roomKey);
                }
                // Güncel listeyi odaya bildir
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
            // Odaya (veya arayan kişiye) reddedildiğini bildir
            socket.to(socket.roomKey).emit('voice-call-declined', {
                username: data.username
            });
        });

        // Odayı arama sinyali (Gelen Arama bildirimi)
        socket.on('voice-call-room', () => {
            if (!socket.roomKey) return;
            const ringingData = {
                callerId: socket.id,
                callerName: socket.nickname,
                avatarColor: socket.avatarColor,
                profilePic: socket.profilePic
            };
            // Ringing durumunu kaydet (sonradan giren kullanıcılar için)
            activeRinging.set(socket.roomKey, ringingData);
            socket.to(socket.roomKey).emit('room-is-ringing', ringingData);
        });

        // Arama sona erdiğinde (herkes sesten çıktığında) ringing durumunu temizle
        socket.on('call-ended', () => {
            if (!socket.roomKey) return;
            activeRinging.delete(socket.roomKey);
            // Sesli kanal listesinden de çıkar
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

        // WebRTC: İki kişi arasında "Aramayı başlatıyorum" sinyali (SDP Offer)
        socket.on('webrtc-offer', ({ targetId, offer }) => {
            io.to(targetId).emit('webrtc-offer', {
                senderId: socket.id,
                senderName: socket.nickname,
                offer
            });
        });

        // WebRTC: "Aramayı kabul ediyorum" sinyali (SDP Answer)
        socket.on('webrtc-answer', ({ targetId, answer }) => {
            io.to(targetId).emit('webrtc-answer', {
                senderId: socket.id,
                answer
            });
        });

        // WebRTC: "Kamera/Mikrofon donanım yolları (ICE)" iletişimi
        socket.on('webrtc-candidate', ({ targetId, candidate }) => {
            io.to(targetId).emit('webrtc-candidate', {
                senderId: socket.id,
                candidate
            });
        });

        // Ekran paylaşımı durumunu diğer kullanıcılara ilet
        socket.on('screen-share-state', ({ isSharing }) => {
            if (!socket.roomKey) return;
            socket.to(socket.roomKey).emit('screen-share-state', {
                userId: socket.id,
                username: socket.nickname,
                isSharing: !!isSharing
            });
        });

        // ============================================
        // WEBRTC P2P DOSYA TRANSFER SİNYALLERİ
        // ============================================
        socket.on('p2p-file-offer', ({ targetId, offer, fileMeta }) => {
            io.to(targetId).emit('p2p-file-offer', {
                senderId: socket.id,
                senderName: socket.nickname,
                offer,
                fileMeta
            });
        });

        socket.on('p2p-file-answer', ({ targetId, answer, fileId }) => {
            io.to(targetId).emit('p2p-file-answer', {
                senderId: socket.id,
                answer,
                fileId
            });
        });

        socket.on('p2p-file-candidate', ({ targetId, candidate, fileId }) => {
            io.to(targetId).emit('p2p-file-candidate', {
                senderId: socket.id,
                candidate,
                fileId
            });
        });
    });

    // Odaya özgü kullanıcı güncelleme fonksiyonu
    function updateOnlineUsers(roomKey) {
        if (!roomKey) return;

        // Bu odadaki socketleri bul
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

        // Sadece bu odaya online listesini yayınla
        io.to(roomKey).emit('online-users', users);
    }

    return new Promise((resolve, reject) => {
        const portToUse = portArg !== null ? portArg : PORT;

        server.once('error', (err) => {
            if (err.code === 'EADDRINUSE') {
                console.warn(`[UYARI] Port ${portToUse} kullanımda, rastgele port deneniyor...`);
                server.listen(0, HOST); // Fallback to random port
            } else {
                reject(err);
            }
        });

        server.listen(portToUse, HOST, () => {
            const actualPort = server.address().port;
            console.log(`\n🚀 Minimal Oda Sunucusu çalışıyor: http://${HOST}:${actualPort}`);
            resolve({ app, server, io });
        });
    });
}

if (require.main === module) {
    startServer().catch(console.error);
} else {
    module.exports = { startServer };
}
