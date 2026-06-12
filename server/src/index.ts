/**
 * index.ts - Minimal Oda Tabanlı Sohbet Sunucusu (Backend Server)
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

import 'dotenv/config';
import express, { Request, Response, NextFunction } from 'express';
import http from 'http';
import { Server, Socket } from 'socket.io';
import cors from 'cors';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import { v4 as uuidv4 } from 'uuid';
import { rateLimit } from 'express-rate-limit';

import { initializeDatabase, dbWrapper, DatabaseWrapper } from './database';
import uploadRoutes from './upload';
import type {
    JoinRoomPayload,
    SendMessagePayload,
    UpdateProfilePayload,
    TypingPayload,
    DeleteMessagePayload,
    ToggleReactionPayload,
    WebRTCOfferPayload,
    WebRTCAnswerPayload,
    WebRTCCandidatePayload,
    P2PFileOfferPayload,
    P2PFileAnswerPayload,
    P2PFileCandidatePayload,
    ScreenShareStatePayload,
    VoiceCallDeclinedPayload,
    OnlineUser,
    RingingData,
    VoiceUserData,
    SocketUserData,
} from './types';

// ── Soket üzerindeki ek alanlar için tip genişletme ──

interface HavenSocket extends Socket {
    userId?: string | null;
    userSecret?: string | null;
    nickname?: string;
    roomKey?: string;
    avatarColor?: string;
    profilePic?: string | null;
    sessionId?: string;
    uploadToken?: string;
}

// Global upload token store
declare global {
    var validUploadTokens: Set<string>;
}
if (!global.validUploadTokens) {
    global.validUploadTokens = new Set<string>();
}

// ── Rate limiter iç tipi ──

interface RateLimitConfig {
    max: number;
    windowMs: number;
}

interface RateCounter {
    count: number;
    start: number;
    warned?: boolean;
}

// ── Sabitler ──

const PORT: number = parseInt(process.env.PORT || '3847', 10);
const HOST: string = process.env.HOST || '0.0.0.0'; // 0.0.0.0 allows tunnel to connect via any interface

const app = express();
app.set('trust proxy', 1); // Fixes express-rate-limit warning behind Cloudflare tunnel

const server = http.createServer(app);

// FIX #7: CORS whitelist — artık her origin kabul edilmiyor.
// Electron (null origin), localhost ve *.trycloudflare.com'a izin veriliyor.
// Kendi sabit tünel domaininiz varsa TUNNEL_ORIGIN env'e ekleyin.
const CORS_WHITELIST: Set<string> = new Set(
    [
        'http://localhost:3847',
        'http://127.0.0.1:3847',
        process.env.TUNNEL_ORIGIN, // Opsiyonel: sabit Cloudflare tünel domain'i
    ].filter((x): x is string => Boolean(x))
);

const corsOptions: cors.CorsOptions = {
    origin: function (origin: string | undefined, callback: (err: Error | null, allow?: boolean) => void) {
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

        // Diğer tüm origin'ler reddedilir
        console.warn(`[CORS] Reddedilen origin: ${origin}`);
        callback(new Error(`CORS: İzin verilmeyen origin → ${origin}`));
    },
    methods: ['GET', 'POST', 'DELETE', 'OPTIONS'],
    credentials: false
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

// Rate limiter'ları uygula
app.use('/socket.io', socketLimiter);
app.use('/api', apiLimiter);

// Uploads ve Statik Dosyalar
app.use(express.static(path.join(__dirname, '../../app/renderer')));
const uploadsDir: string = process.env.DATA_DIR ? path.join(process.env.DATA_DIR, 'uploads') : path.join(__dirname, '../../data/uploads');
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });

// XSS Koruması (MIME Sniffing engelleme)
app.use('/uploads', express.static(uploadsDir, {
    setHeaders: (res: http.ServerResponse, _filePath: string) => {
        res.setHeader('X-Content-Type-Options', 'nosniff');
    }
}));

// Upload routes
app.use('/api/upload', uploadRoutes);

app.get('/api/health', (_req: Request, res: Response) => res.json({ status: 'ok' }));

// ============================================
// ADMIN API — Token tabanlı kimlik doğrulama
// ============================================
// FIX #8: IP kontrolü kaldırıldı. trust proxy açıkken X-Forwarded-For
// başlığını sahteleyerek admin erişimi bypass edilebiliyordu.
// Şimdi Bearer token zorunlu.

// ADMIN_TOKEN yoksa otomatik üret ve dosyaya yaz (Electron host modu için)
const adminTokenFile: string = process.env.DATA_DIR
    ? path.join(process.env.DATA_DIR, 'admin-token.txt')
    : path.join(__dirname, '..', 'data', 'admin-token.txt');

let ADMIN_TOKEN: string | null = process.env.ADMIN_TOKEN || null;
if (!ADMIN_TOKEN) {
    if (fs.existsSync(adminTokenFile)) {
        ADMIN_TOKEN = fs.readFileSync(adminTokenFile, 'utf-8').trim();
    } else {
        // Otomatik token üret
        ADMIN_TOKEN = crypto.randomBytes(32).toString('hex');
        try {
            const tokenDir = path.dirname(adminTokenFile);
            if (!fs.existsSync(tokenDir)) fs.mkdirSync(tokenDir, { recursive: true });
            fs.writeFileSync(adminTokenFile, ADMIN_TOKEN, 'utf-8');
            console.log('[ADMIN] Otomatik admin token üretildi ve kaydedildi.');
        } catch (e) {
            console.error('[ADMIN] Token dosyası yazılamadı:', (e as Error).message);
        }
    }
}

function adminOnly(req: Request, res: Response, next: NextFunction): void {
    // ADMIN_TOKEN tanımlı değilse admin panel devre dışı
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

// Admin: Tüm odaları listele
app.get('/api/admin/rooms', adminOnly, (_req: Request, res: Response) => {
    try {
        const rooms = dbWrapper.prepare('SELECT room_key, created_at FROM rooms ORDER BY created_at DESC').all() as Array<{ room_key: string; created_at: string }>;
        const roomsWithStats = rooms.map(room => {
            const msgCount = dbWrapper.prepare('SELECT COUNT(*) as count FROM messages WHERE room_key = ?').get(room.room_key) as { count: number } | undefined;
            const socketsInRoom = io.sockets.adapter.rooms.get(room.room_key);
            console.log(`[DEBUG] Room ${room.room_key} msgCount:`, msgCount);
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
app.delete('/api/admin/rooms/:roomKey', adminOnly, (req: Request, res: Response) => {
    try {
        const roomKey = req.params.roomKey as string;
        const socketsInRoom = io.sockets.adapter.rooms.get(roomKey);
        if (socketsInRoom) {
            for (const socketId of socketsInRoom) {
                const clientSocket = io.sockets.sockets.get(socketId);
                if (clientSocket) {
                    clientSocket.emit('room-deleted', { message: 'Bu oda sunucu yöneticisi tarafından kalıcı olarak silindi.' });
                    clientSocket.leave(roomKey as string);
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
app.delete('/api/admin/rooms', adminOnly, (_req: Request, res: Response) => {
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

app.get('/', (_req: Request, res: Response) => res.sendFile(path.join(__dirname, '../../app/renderer/login.html')));

// Aktif arama (ringing) durumları: roomKey -> { callerId, callerName, avatarColor, profilePic }
const activeRinging = new Map<string, RingingData>();

// Sesli kanaldaki kullanıcılar: roomKey -> Map<socketId, VoiceUserData>
const activeVoiceUsers = new Map<string, Map<string, VoiceUserData>>();

// ── Server'ı başlat ──

export interface ServerResult {
    app: express.Application;
    server: http.Server;
    io: Server;
}

export async function startServer(portArg: number | null = null): Promise<ServerResult> {
    const db: DatabaseWrapper = await initializeDatabase();

    // Socket.IO mantığı
    io.on('connection', (rawSocket: Socket) => {
        const socket = rawSocket as HavenSocket;

        // FIX #12: Socket.IO event rate limiting
        // HTTP katmanındaki rate limit Socket.IO eventlerini kapsamıyordu.
        // Her bağlantı için bağımsız sayaç; pencere dolunca event sessizce görmezden gelinir.
        const _eventCounters: Record<string, RateCounter> = {};
        const _LIMITS: Record<string, RateLimitConfig> = {
            'send-message': { max: 15, windowMs: 5000 }, // 5 sn'de 15 mesaj
            'join-room': { max: 3, windowMs: 10000 }, // 10 sn'de 3 deneme
            'toggle-reaction': { max: 30, windowMs: 5000 }, // 5 sn'de 30 tepki
            'typing': { max: 20, windowMs: 5000 }, // 5 sn'de 20 yazıyor sinyali
            'edit-message': { max: 15, windowMs: 5000 }, // 5 sn'de 15 düzenleme
        };

        function _rateCheck(eventName: string): boolean {
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
        socket.on('join-room', (data: JoinRoomPayload) => {
            if (!_rateCheck('join-room')) return;
            const { userId, userSecret, nickname, roomKey, avatarColor, profilePic, authKey, mode } = data;
            if (!nickname || !roomKey || !authKey) {
                socket.emit('join-error', 'Takma ad, oda anahtarı ve şifre gereklidir.');
                return;
            }

            const joinMode = mode || 'create';

            // Odanın parolasını kontrol et (veya oluştur)
            let room = db.prepare('SELECT password_hash FROM rooms WHERE room_key = ?').get(roomKey) as { password_hash: string } | undefined;

            if (!room) {
                if (joinMode === 'join') {
                    socket.emit('join-error', 'Bu oda mevcut değil! Lütfen geçerli bir oda anahtarı girin.');
                    return;
                }
                // FIX #1: Her oda için kriptografik olarak rastgele salt üretiliyor.
                // Eski sabit 'HavenSecureSalt2026' tüm odalarda aynı AES anahtarını
                // türetiyordu; rainbow table saldırısına açık bir tasarımdı.
                const e2eeSalt = crypto.randomBytes(32).toString('hex'); // 64 hex karakter
                const hash = bcrypt.hashSync(authKey, 10);
                db.prepare('INSERT INTO rooms (room_key, password_hash, e2ee_salt) VALUES (?, ?, ?)').run(roomKey, hash, e2eeSalt);
                console.log(`[AUTH] Yeni oda oluşturuldu: ${roomKey}`);
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

            socket.userId = userId || null;
            socket.nickname = nickname;
            socket.roomKey = roomKey;
            socket.avatarColor = avatarColor || '#6366f1';
            socket.profilePic = profilePic || null;
            socket.sessionId = data.userId || crypto.randomUUID();
            socket.userSecret = data.userSecret || null;

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

            // FIX #1: E2EE salt'ını istemciye gönder — istemci bunu PBKDF2'ye
            // parametre olarak kullanarak oda'ya özgü AES anahtarı türetir.
            // Salt gizli değil, şifre gibi saklama gerekliliği yok; per-room benzersizliği yeterli.
            const roomSaltRow = db.prepare('SELECT e2ee_salt FROM rooms WHERE room_key = ?').get(roomKey) as { e2ee_salt: string | null } | undefined;
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
            if (!socket.roomKey) return;
            const { oldNickname, nickname, avatarColor, profilePic } = data;
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
                console.error('İsim güncelleme hatası:', e);
            }

            updateOnlineUsers(io, socket.roomKey);
        });

        // Yeni mesaj geldiğinde
        socket.on('send-message', (data: SendMessagePayload) => {
            if (!_rateCheck('send-message')) return;
            const { content, type, replyTo } = data;
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
            
            // Admin panelini güncellemesi için global emit
            io.emit('admin-stats-update');
        });

        // Yazıyor göstergesi
        socket.on('typing', (data: TypingPayload) => {
            if (!_rateCheck('typing')) return;
            if (!socket.roomKey) return;
            socket.to(socket.roomKey).emit('user-typing', {
                username: socket.nickname,
                isTyping: !!data.isTyping
            });
        });

        // Mesaj sabitleme işlemi
        socket.on('pin-message', (data: { messageId: number, isPinned: boolean }) => {
            const { messageId, isPinned } = data;
            if (!socket.roomKey || !messageId) return;

            const msg = db.prepare('SELECT id FROM messages WHERE id = ? AND room_key = ?').get(messageId, socket.roomKey);
            if (msg) {
                db.prepare('UPDATE messages SET is_pinned = ? WHERE id = ?').run(isPinned ? 1 : 0, messageId);
                io.to(socket.roomKey).emit('message-pinned', { messageId, isPinned: !!isPinned });
            }
        });

        // Mesaj silme işlemi
        socket.on('delete-message', (data: DeleteMessagePayload) => {
            const { messageId } = data;
            if (!socket.roomKey || !messageId) return;

            // FIX #10: Sahiplik kontrolü user_secret > session_id sırasıyla yapılıyor.
            // IDOR Zafiyeti Kapatıldı: Herkese yayınlanan user_id yerine gizli user_secret kullanılıyor.
            const msg = db.prepare('SELECT username, user_secret, session_id, type FROM messages WHERE id = ? AND room_key = ?').get(messageId, socket.roomKey) as { username: string; user_secret: string | null; session_id: string | null; type: string | null } | undefined;
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

        // Mesaj Düzenleme (Edit Message)
        socket.on('edit-message', (data: { messageId: string | number, newContent: string }) => {
            if (!_rateCheck('edit-message')) return;
            const { messageId, newContent } = data;
            if (!socket.roomKey || !messageId || !newContent) return;

            const msg = db.prepare('SELECT username, user_id, user_secret, session_id, content, created_at, edit_history FROM messages WHERE id = ? AND room_key = ?').get(messageId, socket.roomKey) as { username: string; user_id: string | null; user_secret: string | null; session_id: string | null; content: string; created_at: string; edit_history: string | null } | undefined;
            if (!msg) return;

            const isOwner =
                (socket.userSecret && msg.user_secret && socket.userSecret === msg.user_secret) ||
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

            let historyArray: Array<{ content: string, edited_at: string }> = [];
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
                messageId,
                newContent,
                editHistory: newHistoryStr,
                isEdited: true
            });
        });

        // Mesaj Tepkisi Ekle/Çıkar (Toggle)
        socket.on('toggle-reaction', (data: ToggleReactionPayload) => {
            if (!_rateCheck('toggle-reaction')) return;
            const { messageId, emoji } = data;
            if (!socket.roomKey || !messageId || !emoji) return;

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
                // Yoksa ekle
                reactionsObj[emoji].push(socket.nickname!);
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
        socket.on('voice-join', (data?: { isMicOn?: boolean }) => {
            if (!socket.roomKey) return;

            if (activeRinging.has(socket.roomKey)) {
                activeRinging.delete(socket.roomKey);
                io.to(socket.roomKey).emit('call-answered');
            }

            if (!activeVoiceUsers.has(socket.roomKey)) {
                activeVoiceUsers.set(socket.roomKey, new Map());
            }
            activeVoiceUsers.get(socket.roomKey)!.set(socket.id, {
                userId: socket.id,
                username: socket.nickname!,
                avatarColor: socket.avatarColor!,
                profilePic: socket.profilePic || null,
                isMicOn: !!(data?.isMicOn)
            });

            // Güncel sesli kanal listesini tüm odaya bildir
            io.to(socket.roomKey).emit('active-voice-users',
                Array.from(activeVoiceUsers.get(socket.roomKey)!.values())
            );

            socket.to(socket.roomKey).emit('voice-join', {
                userId: socket.id,
                username: socket.nickname,
                avatarColor: socket.avatarColor,
                profilePic: socket.profilePic,
                isMicOn: !!(data?.isMicOn)
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

        socket.on('mic-state', (data: { isMicOn: boolean }) => {
            if (!socket.roomKey) return;
            const users = activeVoiceUsers.get(socket.roomKey);
            if (users) {
                const user = users.get(socket.id);
                if (user) user.isMicOn = !!data.isMicOn;
            }
            socket.to(socket.roomKey).emit('user-mic-state', {
                userId: socket.id,
                isMicOn: !!data.isMicOn
            });
        });

        socket.on('voice-call-declined', (data: VoiceCallDeclinedPayload) => {
            if (!socket.roomKey) return;
            socket.to(socket.roomKey).emit('voice-call-declined', {
                username: data.username
            });
        });

        socket.on('voice-call-room', () => {
            if (!socket.roomKey) return;
            const ringingData: RingingData = {
                callerId: socket.id,
                callerName: socket.nickname!,
                avatarColor: socket.avatarColor!,
                profilePic: socket.profilePic || null
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

        // WebRTC: İki kişi arasında "Aramayı başlatıyorum" sinyali (SDP Offer)
        socket.on('webrtc-offer', (data: WebRTCOfferPayload) => {
            io.to(data.targetId).emit('webrtc-offer', {
                senderId: socket.id,
                senderName: socket.nickname,
                offer: data.offer
            });
        });

        // WebRTC: "Aramayı kabul ediyorum" sinyali (SDP Answer)
        socket.on('webrtc-answer', (data: WebRTCAnswerPayload) => {
            io.to(data.targetId).emit('webrtc-answer', {
                senderId: socket.id,
                answer: data.answer
            });
        });

        // WebRTC: "Kamera/Mikrofon donanım yolları (ICE)" iletişimi
        socket.on('webrtc-candidate', (data: WebRTCCandidatePayload) => {
            io.to(data.targetId).emit('webrtc-candidate', {
                senderId: socket.id,
                candidate: data.candidate
            });
        });

        // Ekran paylaşımı durumunu diğer kullanıcılara ilet
        socket.on('screen-share-state', (data: ScreenShareStatePayload) => {
            if (!socket.roomKey) return;
            socket.to(socket.roomKey).emit('screen-share-state', {
                userId: socket.id,
                username: socket.nickname,
                isSharing: !!data.isSharing
            });
        });

        // ============================================
        // WEBRTC P2P DOSYA TRANSFER SİNYALLERİ
        // ============================================
        socket.on('p2p-file-offer', (data: P2PFileOfferPayload) => {
            io.to(data.targetId).emit('p2p-file-offer', {
                senderId: socket.id,
                senderName: socket.nickname,
                offer: data.offer,
                fileMeta: data.fileMeta
            });
        });

        socket.on('p2p-file-answer', (data: P2PFileAnswerPayload) => {
            io.to(data.targetId).emit('p2p-file-answer', {
                senderId: socket.id,
                answer: data.answer,
                fileId: data.fileId
            });
        });

        socket.on('p2p-file-candidate', (data: P2PFileCandidatePayload) => {
            io.to(data.targetId).emit('p2p-file-candidate', {
                senderId: socket.id,
                candidate: data.candidate,
                fileId: data.fileId
            });
        });
    });

    // Odaya özgü kullanıcı güncelleme fonksiyonu
    function updateOnlineUsers(ioServer: Server, roomKey: string): void {
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

    return new Promise<ServerResult>((resolve, reject) => {
        const portToUse = portArg !== null ? portArg : PORT;

        server.once('error', (err: NodeJS.ErrnoException) => {
            if (err.code === 'EADDRINUSE') {
                console.warn(`[UYARI] Port ${portToUse} kullanımda, rastgele port deneniyor...`);
                server.listen(0, HOST);
            } else {
                reject(err);
            }
        });

        server.listen(portToUse, HOST, () => {
            const addr = server.address();
            const actualPort = typeof addr === 'object' && addr ? addr.port : portToUse;
            console.log(`\n🚀 Minimal Oda Sunucusu çalışıyor: http://${HOST}:${actualPort}`);
            resolve({ app, server, io });
        });
    });
}

if (require.main === module) {
    startServer().catch(console.error);
}

export default { startServer };
