/**
 * upload.js - Dosya Yükleme Servisi
 *
 * FIX #11: Magic bytes (MIME) doğrulaması eklendi.
 * Eski kod sadece dosya uzantısına bakıyordu; .jpg uzantılı bir HTML
 * dosyası yüklenip servis edilebiliyordu.
 * Artık dosyanın gerçek içeriği (ilk 12 byte) kontrol ediliyor.
 */

const express  = require('express');
const router   = express.Router();
const multer   = require('multer');
const path     = require('path');
const fs       = require('fs');
const crypto   = require('crypto');

const dataDir   = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
const uploadDir = path.join(dataDir, 'uploads');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

// ── İzin verilen MIME türleri ve uzantıları ───────────────────
const ALLOWED = [
    { mime: 'image/jpeg',      exts: ['.jpg', '.jpeg'] },
    { mime: 'image/png',       exts: ['.png']          },
    { mime: 'image/gif',       exts: ['.gif']          },
    { mime: 'image/webp',      exts: ['.webp']         },
    { mime: 'application/pdf', exts: ['.pdf']          },
    { mime: 'text/plain',      exts: ['.txt']          },
    { mime: 'application/zip', exts: ['.zip']          },
    { mime: 'video/mp4',       exts: ['.mp4']          },
    { mime: 'video/webm',      exts: ['.webm']         },
    { mime: 'audio/mpeg',      exts: ['.mp3']          },
    { mime: 'audio/ogg',       exts: ['.ogg']          },
    { mime: 'audio/wav',       exts: ['.wav']          },
    { mime: 'audio/mp4',       exts: ['.m4a']          },
    { mime: 'audio/webm',      exts: ['.webm']         },
];

const ALLOWED_EXTS = new Set(ALLOWED.flatMap(a => a.exts));
const ALLOWED_MIMES = new Set(ALLOWED.map(a => a.mime));

// ── Magic bytes tablosu (ilk N byte → MIME) ───────────────────
// file-type paketi olmadan hafif, inline kontrol
const MAGIC = [
    { bytes: [0xFF, 0xD8, 0xFF],             mime: 'image/jpeg'      },
    { bytes: [0x89, 0x50, 0x4E, 0x47],       mime: 'image/png'       },
    { bytes: [0x47, 0x49, 0x46],             mime: 'image/gif'       },
    { bytes: [0x52, 0x49, 0x46, 0x46],       mime: 'image/webp'      }, // RIFF....WEBP
    { bytes: [0x25, 0x50, 0x44, 0x46],       mime: 'application/pdf' },
    { bytes: [0x50, 0x4B, 0x03, 0x04],       mime: 'application/zip' },
    { bytes: [0x1A, 0x45, 0xDF, 0xA3],       mime: 'video/webm'      }, // MKV/WebM
    { bytes: [0x49, 0x44, 0x33],             mime: 'audio/mpeg'      }, // MP3 ID3
    { bytes: [0xFF, 0xFB],                   mime: 'audio/mpeg'      }, // MP3 sync
    { bytes: [0xFF, 0xF3],                   mime: 'audio/mpeg'      },
    { bytes: [0xFF, 0xF2],                   mime: 'audio/mpeg'      },
    { bytes: [0x4F, 0x67, 0x67, 0x53],       mime: 'audio/ogg'       },
    { bytes: [0x52, 0x49, 0x46, 0x46],       mime: 'audio/wav'       }, // RIFF....WAVE
];

function detectMime(buffer) {
    for (const { bytes, mime } of MAGIC) {
        if (bytes.every((b, i) => buffer[i] === b)) {
            // RIFF ayırt et: WEBP mi WAV mi?
            if (mime === 'image/webp' && buffer.slice(8, 12).toString('ascii') !== 'WEBP') continue;
            if (mime === 'audio/wav'  && buffer.slice(8, 12).toString('ascii') !== 'WAVE') continue;
            return mime;
        }
    }
    // MP4 / M4A: ftyp box offset 4-7
    if (buffer.length >= 8) {
        const ftyp = buffer.slice(4, 8).toString('ascii');
        if (['ftyp', 'moov', 'mdat'].includes(ftyp) ||
            ['mp41','mp42','isom','M4A ','M4V ','avc1','dash'].includes(buffer.slice(8,12).toString('ascii'))) {
            return 'video/mp4';
        }
    }
    return null;
}

// ── Multer: önce belleğe al, sonra MIME kontrolü, sonra diske yaz ──
const storage = multer.memoryStorage();

const upload = multer({
    storage,
    limits: { fileSize: 10 * 1024 * 1024 }, // 10 MB
    fileFilter: (req, file, cb) => {
        // 1. Uzantı ön kontrolü (hızlı ret)
        const ext = path.extname(file.originalname).toLowerCase();
        if (!ALLOWED_EXTS.has(ext)) {
            return cb(new Error(`İzin verilmeyen dosya uzantısı: ${ext}`), false);
        }
        cb(null, true);
    },
});

router.post('/', (req, res) => {
    const token = req.headers['x-upload-token'];
    if (!token || !global.validUploadTokens || !global.validUploadTokens.has(token)) {
        return res.status(403).json({ success: false, message: 'Yetkisiz dosya yükleme girişimi. Lütfen odaya tekrar bağlanın.' });
    }

    upload.single('file')(req, res, (err) => {
        if (err) {
            return res.status(400).json({ success: false, message: err.message || 'Dosya yüklenemedi' });
        }
        if (!req.file) {
            return res.status(400).json({ success: false, message: 'Dosya bulunamadı' });
        }

        // FIX #11: 2. Magic bytes ile gerçek MIME kontrolü
        const detectedMime = detectMime(req.file.buffer);

        // text/plain için magic byte yok; uzantı .txt ise kabul et
        const ext = path.extname(req.file.originalname).toLowerCase();
        const finalMime = detectedMime || (ext === '.txt' ? 'text/plain' : null);

        if (!finalMime || !ALLOWED_MIMES.has(finalMime)) {
            console.warn(`[UPLOAD] MIME reddi: bildirilen=${req.file.mimetype}, tespit=${detectedMime}, dosya=${req.file.originalname}`);
            return res.status(400).json({
                success: false,
                message: 'Dosya içeriği izin verilen türlerle eşleşmiyor.',
            });
        }

        // 3. Güvenli rastgele isimle diske yaz
        const safeExt   = ext; // uzantı zaten whitelist'ten geçti
        const safeName  = crypto.randomBytes(16).toString('hex') + safeExt;
        const destPath  = path.join(uploadDir, safeName);

        try {
            fs.writeFileSync(destPath, req.file.buffer);
        } catch (writeErr) {
            console.error('[UPLOAD] Diske yazma hatası:', writeErr);
            return res.status(500).json({ success: false, message: 'Dosya kaydedilemedi' });
        }

        res.json({
            success:  true,
            url:      `/uploads/${safeName}`,
            filename: req.file.originalname,
            mimetype: finalMime,
        });
    });
});

module.exports = router;
