/**
 * upload.js - Dosya Yükleme Servisi (File Upload Endpoint)
 * 
 * Neler Var:
 * - Resim (avatar vs.) gibi medyaların geçici/kalıcı olarak sunucuya yüklenmesi için /api/upload endpoint'ini tanımlar.
 * - `multer` kullanarak multipart/form-data işlemlerini yönetir.
 * 
 * Ayarlar / Güvenlik:
 * - Dosyalar `data/uploads` klasörüne yüklenir.
 * - Path traversal (dizin değiştirme) saldırılarını engellemek ve çakışmaları önlemek için dosya isimleri kriptografik olarak rastgele (UUID/hex) yeniden adlandırılır.
 * - Güvenlik maksadıyla sadece izin verilmiş uzantıların (.jpg, .png, vb) yüklenmesine izin verir.
 * - Dosya boyutu 10MB ile sınırlandırılmıştır (limits: { fileSize: 10MB }).
 */

const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');

const dataDir = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
const uploadDir = path.join(dataDir, 'uploads');
if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir, { recursive: true });
}

const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        cb(null, uploadDir)
    },
    filename: function (req, file, cb) {
        // Güvenlik: Kullanıcının verdiği orjinal dosya adını kullanma (Path Traversal Koruması)
        const ext = path.extname(file.originalname).toLowerCase();
        // Rastgele UUID tarzı güvenli isim
        const uniqueSuffix = require('crypto').randomBytes(16).toString('hex');
        cb(null, uniqueSuffix + ext)
    }
})

// Güvenli Dosya Türleri
const fileFilter = (req, file, cb) => {
    const allowedExts = ['.jpg', '.jpeg', '.png', '.gif', '.pdf', '.txt', '.doc', '.docx', '.zip', '.rar', '.mp4', '.mp3', '.webm', '.ogg', '.wav', '.m4a', '.aac'];
    const ext = path.extname(file.originalname).toLowerCase();

    // Tehlikeli uzantıları reddet
    if (!allowedExts.includes(ext)) {
        return cb(new Error('Güvenlik ihlali: Bu dosya türüne izin verilmiyor!'), false);
    }

    cb(null, true);
};

// 10MB limit!
const upload = multer({ storage: storage, limits: { fileSize: 10 * 1024 * 1024 }, fileFilter: fileFilter });

router.post('/', (req, res) => {
    upload.single('file')(req, res, function (err) {
        if (err) {
            return res.status(400).json({ success: false, message: err.message || 'Dosya yüklenemedi' });
        }

        if (!req.file) {
            return res.status(400).json({ success: false, message: 'Dosya yüklenemedi' });
        }

        const fileUrl = `/uploads/${req.file.filename}`;

        res.json({ success: true, url: fileUrl, filename: req.file.originalname, mimetype: req.file.mimetype });
    });
});

module.exports = router;
