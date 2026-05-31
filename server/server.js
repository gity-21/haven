const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const { rateLimit } = require('express-rate-limit');

// Local modules
const { PORT, HOST, CORS_WHITELIST } = require('./config');
const { initializeDatabase } = require('./database');
const { setupApiRoutes } = require('./api');
const { setupSocketListeners } = require('./socket');
const uploadRoutes = require('./upload');

global.validUploadTokens = new Set();

const app = express();
app.set('trust proxy', 1);

const server = http.createServer(app);

const corsOptions = {
    origin: function (origin, callback) {
        if (!origin || origin === 'file://' || origin.startsWith('file://')) {
            return callback(null, true);
        }
        if (CORS_WHITELIST.has(origin)) return callback(null, true);
        
        console.warn(`[CORS] Reddedilen origin: ${origin}`);
        callback(new Error(`CORS: İzin verilmeyen origin → ${origin}`));
    },
    methods: ['GET', 'POST', 'DELETE', 'OPTIONS'],
    credentials: false
};

const customCorsMiddleware = (req, res, next) => {
    const origin = req.headers.origin;
    
    if (origin && origin.endsWith('.trycloudflare.com')) {
        const host = req.headers.host;
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
    
    cors(corsOptions)(req, res, next);
};

const io = new Server(server, {
    cors: {
        origin: (origin, callback) => {
            if (!origin || origin === 'file://' || origin.startsWith('file://')) return callback(null, true);
            if (CORS_WHITELIST.has(origin)) return callback(null, true);
            if (origin.endsWith('.trycloudflare.com')) return callback(null, true);
            callback(new Error(`CORS: İzin verilmeyen origin → ${origin}`), false);
        },
        methods: ['GET', 'POST']
    },
    transports: ['polling', 'websocket'],
    allowUpgrades: true,
    upgradeTimeout: 10000,
    pingTimeout: 60000,
    pingInterval: 25000,
    connectTimeout: 45000,
    maxHttpBufferSize: 10e6
});

app.use(customCorsMiddleware);
app.options('*', customCorsMiddleware);
app.use(express.json());

const apiLimiter = rateLimit({
    windowMs: 1 * 60 * 1000, // 1 dakika
    max: 300,
    message: 'Çok fazla istek gönderdiniz, lütfen biraz bekleyin.',
    skip: (req) => req.path.startsWith('/socket.io')
});
app.use('/api', apiLimiter);

app.use(express.static(path.join(__dirname, '../app/renderer')));
const uploadsDir = process.env.DATA_DIR ? path.join(process.env.DATA_DIR, 'uploads') : path.join(__dirname, '../data/uploads');
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });
app.use('/uploads', express.static(uploadsDir));

app.use('/api/upload', uploadRoutes);

app.get('/api/health', (req, res) => res.json({ status: 'ok' }));

// Set up Admin API routes
setupApiRoutes(app, io);

app.get('/', (req, res) => res.sendFile(path.join(__dirname, '../app/renderer/login.html')));

async function startServer(portArg = null) {
    await initializeDatabase();
    
    setupSocketListeners(io);

    return new Promise((resolve, reject) => {
        const portToUse = portArg !== null ? portArg : PORT;

        server.once('error', (err) => {
            if (err.code === 'EADDRINUSE') {
                console.warn(`[UYARI] Port ${portToUse} kullanımda, rastgele port deneniyor...`);
                server.listen(0, HOST);
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
