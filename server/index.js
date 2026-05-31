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
// sanitize-html kaldırıldı (FIX #6) — XSS koruması artık istemci tarafında
const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');
const crypto = require('crypto');

global.validUploadTokens = new Set();

const PORT = process.env.PORT || 3847;
const HOST = process.env.HOST || '0.0.0.0'; // 0.0.0.0 allows tunnel to connect via any interface

const app = express();
app.set('trust proxy', 1); // Fixes express-rate-limit warning behind Cloudflare tunnel

const server = http.createServer(app);

// FIX #7: CORS whitelist — artık her origin kabul edilmiyor.
// Electron (null origin), localhost ve *.trycloudflare.com'a izin veriliyor.
// Kendi sabit tünel domaininiz varsa TUNNEL_ORIGIN env'e ekleyin.
const CORS_WHITELIST = new Set([
    'http://localhost:3847',
    'http://127.0.0.1:3847',
    process.env.TUNNEL_ORIGIN, // Opsiyonel: sabit Cloudflare tünel domain'i
].filter(Boolean));

const corsOptions = {
    origin: function (origin, callback) {
        // Electron file:// ve Node.js iç isteklerinde origin null gelir → izin ver
        // Electron'da origin null VEYA 'file://' olarak gelebilir — her ikisine izin ver
        // Postman, curl vb. origin göndermeyen (tarayıcı dışı) istekler için izin ver.
        // Ancak 'null' stringi sandboxed iframe'lerden gelir, buna İZİN VERME!
        if (origin === undefined) {
            return callback(null, true);
        }

        // Electron 'file://' protokolü ile çalışır
        if (origin === 'file://' || origin.startsWith('file://')) {
            return callback(null, true);
        }

        // Whitelist (localhost ve process.env.TUNNEL_ORIGIN)
        if (CORS_WHITELIST.has(origin)) return callback(null, true);
        // Cloudflare ücretsiz tünel subdomain'leri dinamik; pattern ile izin ver
        if (origin.endsWith('.trycloudflare.com')) return callback(null, true);
        // Diğer tüm origin'ler reddedilir
        console.warn(`[CORS] Reddedilen origin: ${origin}`);
        callback(new Error(`CORS: İzin verilmeyen origin → ${origin}`));
    },
    methods: ['GET', 'POST', 'DELETE', 'OPTIONS'],
    credentials: false
};

// CORS middleware that dynamically checks Host for trycloudflare domains
const customCorsMiddleware = (req, res, next) => {
    const origin = req.headers.origin;
    
    if (origin && origin.endsWith('.trycloudflare.com')) {
        const host = req.headers.host;
        // Host header'ı origin ile eşleşmeli. (örn: origin https://xyz.trycloudflare.com ise host xyz.trycloudflare.com olmalı)
        if (host && origin.includes(host)) {
            res.header('Access-Control-Allow-Origin', origin);
            res.header('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
            res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization, x-upload-token');
            if (req.method === 'OPTIONS') return res.sendStatus(200);
            return next();
        } else {
            console.warn(`[CORS] Host mismatch for trycloudflare. Origin: ${origin}, Host: ${host}`);
            return res.status(403).json({ error: 'CORS: Origin/Host mismatch for Cloudflare tunnel.' });
        }
    }
    
    // Fall back to standard CORS
    cors(corsOptions)(req, res, next);
};

const io = new Server(server, {
    cors: {
        origin: (origin, callback) => {
            // Socket.IO request aware değildir, ama upgrade request'i yaparken zaten Origin header'ı kontrol ediliyor.
            // Socket.IO tarafı için manuel bir origin check:
            if (!origin || origin === 'file://' || origin.startsWith('file://')) return callback(null, true);
            if (CORS_WHITELIST.has(origin)) return callback(null, true);
            if (origin.endsWith('.trycloudflare.com')) return callback(null, true); // Socket.io engine.io handshake'inde Host header'ına erişmek zor, trycloudflare'e izin veriyoruz
            callback(new Error(`CORS: İzin verilmeyen origin → ${origin}`), false);
        },
        methods: ['GET', 'POST']
    },
    transports: ['polling', 'websocket'], // polling önce, sonra websocket'e upgrade (Cloudflare uyumlu)
    allowUpgrades: true,
    upgradeTimeout: 10000,
    pingTimeout: 60000,
    pingInterval: 25000,
    connectTimeout: 45000,
    maxHttpBufferSize: 10e6 // 10 MB (dosya transferi için)
});

app.use(customCorsMiddleware);
app.options('*', customCorsMiddleware); // Preflight isteklerini karşıla
app.use(express.json());

// DDoS / Brute-Force koruması (Rate Limiting)
const apiLimiter = rateLimit({
    windowMs: 1 * 60 * 1000, // 1 dakika
    max: 300,
    message: 'Çok fazla istek gönderdiniz, lütfen biraz bekleyin.'
});

const socketLimiter = rateLimit({
    windowMs: 1 * 60 * 1000, // 1 dakika
    max: 1500, // Socket.io pingleri fazla olabilir, limiti daha geniş tuttuk
    message: 'Çok fazla bağlantı isteği gönderdiniz.'
});

// Rate limiter’ları uygula
app.use('/socket.io', socketLimiter);
app.use('/api', apiLimiter);

// Uploads ve Statik Dosyalar
app.use(express.static(path.join(__dirname, '../app/renderer')));
const uploadsDir = process.env.DATA_DIR ? path.join(process.env.DATA_DIR, 'uploads') : path.join(__dirname, '../data/uploads');
const fs = require('fs');
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });

// XSS Koruması (MIME Sniffing engelleme)
app.use('/uploads', express.static(uploadsDir, {
    setHeaders: (res, path) => {
        res.setHeader('X-Content-Type-Options', 'nosniff');
    }
}));

// Upload routes
const uploadRoutes = require('./upload');
app.use('/api/upload', uploadRoutes);

app.get('/api/health', (req, res) => res.json({ status: 'ok' }));

// ============================================
// ADMIN API — Token tabanlı kimlik doğrulama
// ============================================
// FIX #8: IP kontrolü kaldırıldı. trust proxy açıkken X-Forwarded-For
// başlığını sahteleyerek admin erişimi bypass edilebiliyordu.
// Şimdi Bearer token zorunlu.

// ADMIN_TOKEN yoksa otomatik üret ve dosyaya yaz (Electron host modu için)
// const crypto = require('crypto');
const adminTokenFile = process.env.DATA_DIR
    ? path.join(process.env.DATA_DIR, 'admin-token.txt')
    : path.join(__dirname, '..', 'data', 'admin-token.txt');

let ADMIN_TOKEN = process.env.ADMIN_TOKEN || null;
if (!ADMIN_TOKEN) {
    // Otomatik token üret
    ADMIN_TOKEN = crypto.randomBytes(32).toString('hex');
    try {
        const tokenDir = path.dirname(adminTokenFile);
        if (!fs.existsSync(tokenDir)) fs.mkdirSync(tokenDir, { recursive: true });
        fs.writeFileSync(adminTokenFile, ADMIN_TOKEN, 'utf-8');
        console.log('[ADMIN] Otomatik admin token üretildi ve kaydedildi.');
    } catch (e) {
        console.error('[ADMIN] Token dosyası yazılamadı:', e.message);
    }
}

function adminOnly(req, res, next) {
    // ADMIN_TOKEN tanımlı değilse admin panel devre dışı
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

        // FIX #12: Socket.IO event rate limiting
        // HTTP katmanındaki rate limit Socket.IO eventlerini kapsamıyordu.
        // Her bağlantı için bağımsız sayaç; pencere dolunca event sessizce görmezden gelinir.
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
                // Sadece limit aşıldığında bir kere log bas, konsolu boğma (DoS önlemi)
                if (!c.warned) {
                    console.warn(`[RATE] ${socket.nickname || socket.id} → '${eventName}' limit aşıldı!`);
                    c.warned = true;
                }
                
                // Çok agresif saldırı durumunda (limitin çok üstüne çıkılırsa) bağlantıyı tamamen kes!
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
        socket.on('join-room', ({ userId, nickname, roomKey, avatarColor, profilePic, authKey, mode }) => {
            if (!_rateCheck('join-room')) return;
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
                    socket.emit('join-error', 'Bu oda mevcut değil! Lütfen geçerli bir oda anahtarı girin.');
                    return;
                }
                // FIX #1: Her oda için kriptografik olarak rastgele salt üretiliyor.
                // Eski sabit 'HavenSecureSalt2026' tüm odalarda aynı AES anahtarını
                // türetiyordu; rainbow table saldırısına açık bir tasarımdı.
                const { randomBytes } = require('crypto');
                const e2eeSalt = randomBytes(32).toString('hex'); // 64 hex karakter
                const hash = bcrypt.hashSync(authKey, 10);
                db.prepare('INSERT INTO rooms (room_key, password_hash, e2ee_salt) VALUES (?, ?, ?)').run(roomKey, hash, e2eeSalt);
                console.log(`[AUTH] Yeni oda oluşturuldu: ${roomKey}`);
            } else {
                // Odaya giriliyor, şifre doğrula
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
            socket.sessionId = uuidv4(); // Mesaj silme güvenliği için benzersiz oturum ID

            // Generate and emit uploadToken for this session
            const uploadToken = crypto.randomBytes(16).toString('hex');
            socket.uploadToken = uploadToken;
            global.validUploadTokens.add(uploadToken);
            setTimeout(() => global.validUploadTokens.delete(uploadToken), 12 * 60 * 60 * 1000); // 12 hours max
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

            // FIX #1: E2EE salt'ını istemciye gönder — istemci bunu PBKDF2'ye
            // parametre olarak kullanarak oda'ya özgü AES anahtarı türetir.
            // Salt gizli değil, şifre gibi saklama gerekliliği yok; per-room benzersizliği yeterli.
            const roomSaltRow = db.prepare('SELECT e2ee_salt FROM rooms WHERE room_key = ?').get(roomKey);
            if (roomSaltRow && roomSaltRow.e2ee_salt) {
                socket.emit('room-e2ee-salt', { salt: roomSaltRow.e2ee_salt });
            } else {
                // Eski oda (salt sütunu yok) — istemci fallback salt kullanacak
                socket.emit('room-e2ee-salt', { salt: null });
            }

            // Odadaki online kullanıcıları topla
            updateOnlineUsers(roomKey);

            // Yeni giriş bilgisini odadakilere gönder
            socket.to(roomKey).emit('user-joined', { msg: `${nickname} odaya katıldı.` });

            // Son 100 mesaj geçmişini gönder (LEFT JOIN ile yanıtlanan mesajı da getir)
            // GÜVENLİK (IDOR): user_secret'in istemciye sızmasını engellemek için SELECT ile sadece gereken kolonları alıyoruz
            const history = db.prepare(`
                SELECT m.id, m.room_key, m.username, m.avatar_color, m.content, m.type, m.reply_to, m.profile_pic, m.reactions, m.user_id, m.created_at, r.username as reply_username, r.content as reply_content 
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
                        avatarColor: socket.avatarColor,
                        profilePic: socket.profilePic,
                        userId: socket.userId || socket.id
                    });
                }

                // Eğer sesli aramadaysa, activeVoiceUsers listesinde de adını güncelle ve odadakilere yeni listeyi yolla
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

            // Yeni bilgileri odadaki online listesinde hemen güncelle
            updateOnlineUsers(socket.roomKey);
        });

        // Yeni mesaj geldiğinde
        socket.on('send-message', ({ content, type, replyTo } = {}) => {
            if (!_rateCheck('send-message')) return;
            if (!socket.roomKey || !content) return;

            const msgType = type || 'message';

            // FIX #6: sanitizeHtml sunucudan KALDIRILDI.
            // Mesajlar istemcide AES-GCM ile şifrelenip gönderildiğinden sunucu
            // şifreli Base64 görür; sanitize burada etkisizdi.
            // XSS koruması artık chat.js'de decryptMessage() sonrasında yapılıyor.
            const safeContent = content;

            // Oda varlığı ve yazma yetkisi kontrolü
            const room = db.prepare('SELECT 1 FROM rooms WHERE room_key = ?').get(socket.roomKey);
            if (!room) return;

            // DB'ye kaydet
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

            // Mesajı aynı odadaki TARAFLARA (kendisi dâhil) yayınla
            io.to(socket.roomKey).emit('new-message', messageData);
        });

        // Yazıyor göstergesi
        socket.on('typing', ({ isTyping } = {}) => {
            if (!_rateCheck('typing')) return;
            if (!socket.roomKey) return;
            socket.to(socket.roomKey).emit('user-typing', {
                username: socket.nickname,
                isTyping: !!isTyping
            });
        });

        // Mesaj silme işlemi
        socket.on('delete-message', ({ messageId } = {}) => {
            if (!socket.roomKey || !messageId) return;

            // FIX #10: Sahiplik kontrolü user_secret > session_id sırasıyla yapılıyor.
            // IDOR Zafiyeti Kapatıldı: Herkese yayınlanan user_id yerine gizli user_secret kullanılıyor.
            const msg = db.prepare('SELECT username, user_secret, session_id FROM messages WHERE id = ? AND room_key = ?').get(messageId, socket.roomKey);
            if (!msg) return;

            const isOwner =
                (socket.userSecret && msg.user_secret && socket.userSecret === msg.user_secret) ||
                (socket.sessionId && msg.session_id && socket.sessionId === msg.session_id);

            if (!isOwner) {
                console.warn(`[GÜVENLİK] Yetkisiz mesaj silme denemesi: ${socket.nickname} (id: ${messageId})`);
                return;
            }

            db.prepare('DELETE FROM messages WHERE id = ?').run(messageId);
            io.to(socket.roomKey).emit('message-deleted', messageId);
        });

        // Mesaj düzenleme işlemi
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

            // 15 Dakika kontrolü
            const msgTime = new Date(msg.created_at).getTime();
            const now = Date.now();
            if (now - msgTime > 15 * 60 * 1000) {
                // Zaman aşımı
                socket.emit('error', 'Mesaj düzenleme süresi (15 dk) doldu.');
                return;
            }

            // Geçmişi kaydet (Edit History)
            let historyArray = [];
            try {
                if (msg.edit_history) historyArray = JSON.parse(msg.edit_history);
            } catch(e) {}
            
            historyArray.push({
                content: msg.content,
                edited_at: new Date().toISOString()
            });
            const newHistoryStr = JSON.stringify(historyArray);

            // Veritabanını güncelle
            db.prepare('UPDATE messages SET content = ?, is_edited = 1, edit_history = ? WHERE id = ?').run(newContent, newHistoryStr, messageId);

            // Odaya duyur
            io.to(socket.roomKey).emit('message-edited', {
                messageId: messageId,
                newContent: newContent,
                editHistory: historyArray,
                isEdited: true
            });
        });

        // Mesaj Tepkisi Ekle/Çıkar (Toggle)
        socket.on('toggle-reaction', ({ messageId, emoji } = {}) => {
            if (!_rateCheck('toggle-reaction')) return;
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

            if (socket.uploadToken) {
                global.validUploadTokens.delete(socket.uploadToken);
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
        socket.on('webrtc-offer', ({ targetId, offer } = {}) => {
            io.to(targetId).emit('webrtc-offer', {
                senderId: socket.id,
                senderName: socket.nickname,
                offer
            });
        });

        // WebRTC: "Aramayı kabul ediyorum" sinyali (SDP Answer)
        socket.on('webrtc-answer', ({ targetId, answer } = {}) => {
            io.to(targetId).emit('webrtc-answer', {
                senderId: socket.id,
                answer
            });
        });

        // WebRTC: "Kamera/Mikrofon donanım yolları (ICE)" iletişimi
        socket.on('webrtc-candidate', ({ targetId, candidate } = {}) => {
            io.to(targetId).emit('webrtc-candidate', {
                senderId: socket.id,
                candidate
            });
        });

        // Ekran paylaşımı durumunu diğer kullanıcılara ilet
        socket.on('screen-share-state', ({ isSharing } = {}) => {
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
