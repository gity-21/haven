/**
 * index.ts - Minimal Oda Tabanlı Sohbet Sunucusu (Backend Server)
 * 
 * Modüler mimariye kavuşturulmuş sunucu giriş noktası.
 * Alt modüller:
 * - config/: Sabitler, CORS, Uploads ve Rate Limiter ayarları
 * - config/security: Güvenlik başlıkları (CSP, X-Frame-Options, nosniff)
 * - routes/: REST API endpoint'leri (Admin, Upload, Health)
 * - services/: İş mantığı ve oda yönetimi (Room, Voice, Ringing, Socket Rate Limiting)
 * - sockets/: Socket.io olay işleyicileri (Room, Message, Voice, File)
 */

import 'dotenv/config';
import express, { Request, Response, NextFunction } from 'express';
import http from 'http';
import { Server, Socket } from 'socket.io';
import cors from 'cors';
import path from 'path';
import fs from 'fs';

import { initializeDatabase } from './database';
import uploadRoutes from './upload';
import { createAdminRouter } from './routes/admin';
import { createSocketRateChecker } from './services/rate-limiter.service';
import { checkAndCleanExpiredRooms } from './services/room.service';
import { securityHeadersMiddleware } from './config/security';
import { registerRoomHandlers } from './sockets/room.handler';
import { registerMessageHandlers } from './sockets/message.handler';
import { registerVoiceHandlers } from './sockets/voice.handler';
import { registerFileHandlers } from './sockets/file.handler';
import {
    PORT,
    HOST,
    corsOptions,
    socketLimiter,
    apiLimiter,
    UPLOADS_DIR,
    FALLBACK_UPLOADS_DIR
} from './config';
import type { HavenSocket } from './types/socket-events';

// Global upload token store
declare global {
    var validUploadTokens: Set<string>;
}
if (!global.validUploadTokens) {
    global.validUploadTokens = new Set<string>();
}

export interface ServerResult {
    app: express.Application;
    server: http.Server;
    io: Server;
}

export async function startServer(portArg: number | null = null): Promise<ServerResult> {
    const app = express();
    app.set('trust proxy', 1);

    const server = http.createServer(app);

    const io = new Server(server, {
        cors: corsOptions,
        transports: ['polling', 'websocket'],
        allowUpgrades: true,
        upgradeTimeout: 10000,
        pingTimeout: 60000,
        pingInterval: 25000,
        connectTimeout: 45000,
        maxHttpBufferSize: 10e6 // 10 MB
    });

    // Middlewares
    app.use(cors(corsOptions));
    app.options('*', cors(corsOptions));
    app.use(securityHeadersMiddleware); // SECURITY_RULES.md - Güvenlik Başlıkları
    app.use(express.json({ limit: '2mb' })); // Aşırı büyük JSON payload engeli

    // Rate Limiting
    app.use('/socket.io', socketLimiter);
    app.use('/api', apiLimiter);

    // Static Files & Uploads (dotfiles engeli ile path traversal / gizli dosya sızıntısı önleme)
    app.use(express.static(path.join(__dirname, '../../app/renderer/dist'), { dotfiles: 'ignore' }));
    
    app.use('/uploads', express.static(UPLOADS_DIR, {
        dotfiles: 'ignore',
        setHeaders: (res: http.ServerResponse) => {
            res.setHeader('X-Content-Type-Options', 'nosniff');
        }
    }));

    if (fs.existsSync(FALLBACK_UPLOADS_DIR)) {
        app.use('/uploads', express.static(FALLBACK_UPLOADS_DIR, {
            dotfiles: 'ignore',
            setHeaders: (res: http.ServerResponse) => {
                res.setHeader('X-Content-Type-Options', 'nosniff');
            }
        }));
    }

    // API Routes
    app.use('/api/upload', uploadRoutes);
    app.get('/api/health', (_req: Request, res: Response) => res.json({ status: 'ok' }));
    app.use('/api/admin', createAdminRouter(io));

    // Davet Sayfası (Landing Page)
    app.get(['/invite', '/invite.html'], (_req: Request, res: Response) => {
        const distInvite = path.join(__dirname, '../../app/renderer/dist/invite.html');
        if (fs.existsSync(distInvite)) {
            res.sendFile(distInvite);
        } else {
            res.sendFile(path.join(__dirname, '../../app/renderer/invite.html'));
        }
    });

    // Global Hata Yakalayıcı (Bilgi sızıntısını önler - SECURITY_RULES.md Kural 8 & 10)
    app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
        console.error('[SERVER_ERROR]', err instanceof Error ? err.message : err);
        res.status(500).json({ success: false, error: 'Sunucu işlemi sırasında bir hata oluştu.' });
    });

    // Database Initialization
    await initializeDatabase();

    // Socket.io Handlers Registration
    io.on('connection', (rawSocket: Socket) => {
        const socket = rawSocket as HavenSocket;
        const rateCheck = createSocketRateChecker(socket);

        registerRoomHandlers(io, socket, rateCheck);
        registerMessageHandlers(io, socket, rateCheck);
        registerVoiceHandlers(io, socket);
        registerFileHandlers(io, socket);
    });

    // Periyodik olarak süresi dolan geçici odaları temizle (Burn-After-Reading)
    setInterval(() => {
        checkAndCleanExpiredRooms(io);
    }, 30000);

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
