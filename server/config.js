require('dotenv').config();
const path = require('path');
const crypto = require('crypto');
const fs = require('fs');

const PORT = process.env.PORT || 3847;
const HOST = process.env.HOST || '0.0.0.0';

const CORS_WHITELIST = new Set([
    'http://localhost:3847',
    'http://127.0.0.1:3847',        
    process.env.TUNNEL_ORIGIN,
].filter(Boolean));

const adminTokenFile = process.env.DATA_DIR
    ? path.join(process.env.DATA_DIR, 'admin-token.txt')
    : path.join(__dirname, '..', 'data', 'admin-token.txt');

let ADMIN_TOKEN = process.env.ADMIN_TOKEN || null;
if (!ADMIN_TOKEN) {
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

module.exports = {
    PORT,
    HOST,
    CORS_WHITELIST,
    ADMIN_TOKEN
};
