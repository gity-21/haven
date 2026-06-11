/**
 * upload.ts - Dosya Yükleme Servisi
 *
 * FIX #11: Magic bytes (MIME) doğrulaması eklendi.
 * Eski kod sadece dosya uzantısına bakıyordu; .jpg uzantılı bir HTML
 * dosyası yüklenip servis edilebiliyordu.
 * Artık dosyanın gerçek içeriği (ilk 12 byte) kontrol ediliyor.
 */

import express, { Request, Response } from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';

const router = express.Router();

const dataDir: string = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
const uploadDir: string = path.join(dataDir, 'uploads');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

// ── İzin verilen MIME türleri ve uzantıları ───────────────────

interface AllowedType {
    mime: string;
    exts: string[];
}

const ALLOWED: AllowedType[] = [
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

const ALLOWED_EXTS: Set<string> = new Set(ALLOWED.flatMap(a => a.exts));
const ALLOWED_MIMES: Set<string> = new Set(ALLOWED.map(a => a.mime));

// ── Magic bytes tablosu (ilk N byte → MIME) ───────────────────
// file-type paketi olmadan hafif, inline kontrol

interface MagicEntry {
    bytes: number[];
    mime: string;
}

const MAGIC: MagicEntry[] = [
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

function detectMime(buffer: Buffer): string | null {
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

// ── Multer: RAM şişmesini önlemek için doğrudan diske yaz ──

const storage = multer.diskStorage({
    destination: (_req: Request, _file: Express.Multer.File, cb: (error: Error | null, destination: string) => void) => {
        cb(null, uploadDir); // Dosya geçici olarak uploads klasörüne yazılır
    },
    filename: (_req: Request, file: Express.Multer.File, cb: (error: Error | null, filename: string) => void) => {
        // Geçici bir isimle kaydet
        const tempName = 'temp_' + crypto.randomBytes(8).toString('hex') + path.extname(file.originalname);
        cb(null, tempName);
    }
});

const upload = multer({
    storage,
    limits: { fileSize: 10 * 1024 * 1024 }, // 10 MB limit
    fileFilter: (_req: Request, file: Express.Multer.File, cb: multer.FileFilterCallback) => {
        // 1. Uzantı ön kontrolü (hızlı ret)
        const ext = path.extname(file.originalname).toLowerCase();
        if (!ALLOWED_EXTS.has(ext)) {
            return cb(new Error(`İzin verilmeyen dosya uzantısı: ${ext}`));
        }
        cb(null, true);
    },
});

router.post('/', (req: Request, res: Response) => {
    upload.single('file')(req, res, (err: unknown) => {
        if (err) {
            const message = err instanceof Error ? err.message : 'Dosya yüklenemedi';
            return res.status(400).json({ success: false, message });
        }
        if (!req.file) {
            return res.status(400).json({ success: false, message: 'Dosya bulunamadı' });
        }

        const tempFilePath: string = req.file.path;
        
        try {
            // FIX #11: 2. Magic bytes ile gerçek MIME kontrolü
            // Dosyanın sadece ilk 12 byte'ını oku (Tüm dosyayı RAM'e almamak için)
            const buffer = Buffer.alloc(12);
            const fd = fs.openSync(tempFilePath, 'r');
            fs.readSync(fd, buffer, 0, 12, 0);
            fs.closeSync(fd);
            
            const detectedMime = detectMime(buffer);

            // text/plain için magic byte yok; uzantı .txt ise kabul et
            const ext = path.extname(req.file.originalname).toLowerCase();
            const finalMime = detectedMime || (ext === '.txt' ? 'text/plain' : null);

            if (!finalMime || !ALLOWED_MIMES.has(finalMime)) {
                console.warn(`[UPLOAD] MIME reddi: tespit=${detectedMime}, dosya=${req.file.originalname}`);
                fs.unlinkSync(tempFilePath); // Zararlı veya bozuk dosyayı diskten sil
                return res.status(400).json({
                    success: false,
                    message: 'Dosya içeriği izin verilen türlerle eşleşmiyor.',
                });
            }

            // 3. Güvenli rastgele isimle yeniden adlandır
            const safeExt: string = ext; 
            const safeName: string = crypto.randomBytes(16).toString('hex') + safeExt;
            const destPath: string = path.join(uploadDir, safeName);

            // Geçici dosyayı nihai ismine taşı
            fs.renameSync(tempFilePath, destPath);

            res.json({
                success:  true,
                url:      `/uploads/${safeName}`,
                filename: req.file.originalname,
                mimetype: finalMime,
            });
            
        } catch (error) {
            console.error('[UPLOAD] İşlem hatası:', error);
            // Hata olursa geçici dosyayı temizle
            if (fs.existsSync(tempFilePath)) fs.unlinkSync(tempFilePath);
            return res.status(500).json({ success: false, message: 'Dosya işlenemedi' });
        }
    });
});

export default router;
