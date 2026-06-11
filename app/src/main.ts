/**
 * main.ts - Electron Ana İşlem (Main Process)
 * 
 * Bu dosya uygulamanın masaüstü istemcisinin (Electron) başlangıç noktasıdır.
 * Neler Var:
 * - Ana pencere (BrowserWindow) oluşturma ve arayüz ayarları.
 * - IPC (Inter-Process Communication) iletişim kanallarının dinlenmesi (Minimize, Maximize, Kapatma).
 * - "Host" modunda uygulamanın arka planda kendi Node.js sunucusunu ve Cloudflare tünelini başlatması.
 * - İşletim sistemine özel GPU/Donanım hızlandırma optimizasyonları (Ayar flag'leri).
 * - Ekran ve kamera/ses izinlerine otomatik onay veren güvenlik ayarları.
 */

import { app, BrowserWindow, ipcMain, shell, clipboard, Tray, Menu, desktopCapturer, session, IpcMainInvokeEvent } from 'electron';
import path from 'path';
import fs from 'fs';
import { spawn, ChildProcess } from 'child_process';
import net from 'net';

// ── Yardımcı: Port kontrolü ──

const checkPort = (port: number): Promise<boolean> => new Promise((resolve) => {
    const tester = net.createServer()
        .once('error', (err: NodeJS.ErrnoException) => resolve(err.code === 'EADDRINUSE'))
        .once('listening', () => tester.once('close', () => resolve(false)).close())
        .listen(port);
});

// ── Uygulama adını ve ID'sini ayarla ──

app.name = 'Haven';
if (process.platform === 'win32') {
    app.setAppUserModelId('com.haven.app');
}

// ── Veri depolama konumu ──

const appDataPath: string = app.isPackaged
    ? path.join(app.getPath('userData'), 'data')
    : path.resolve(__dirname, '..', '..', 'data');

if (!fs.existsSync(appDataPath)) {
    fs.mkdirSync(appDataPath, { recursive: true });
}

// Sunucu tarafının bu yolu kullanması için ortam değişkenine kaydet
process.env.DATA_DIR = appDataPath;

// ── Chromium Bayrakları ──

// Mikrofon ve kamera erişimi için gerekli flag'lar
app.commandLine.appendSwitch('enable-speech-dispatcher');
app.commandLine.appendSwitch('enable-usermedia-screen-capturing');
app.commandLine.appendSwitch('allow-http-screen-capture');

// FIX: Uygulama arka plana atıldığında veya simge durumunda (minimized) iken
// mikrofonun ve WebRTC yayınlarının donmasını engellemek için Chromium'un tasarruf modlarını tamamen kapatıyoruz.
app.commandLine.appendSwitch('disable-background-timer-throttling');
app.commandLine.appendSwitch('disable-renderer-backgrounding');
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows');

// FIX: Electron DNS çözümleme sorunu — STUN sunucuları çözülemeyebilir.
// Chromium'un async DNS çözücüsünü etkinleştir (sistem DNS'ini daha güvenilir kullanır)
app.commandLine.appendSwitch('enable-features', 'AsyncDns');
// WebRTC'nin mDNS ICE adaylarını kullanmasına izin ver (yerel ağ keşfi için)
app.commandLine.appendSwitch('enable-webrtc-hide-local-ips-with-mdns', 'disabled');

// Linux'ta Wayland ve genel GPU performansı için ek optimizasyon
if (process.platform === 'linux') {
    app.commandLine.appendSwitch('enable-features', 'WaylandWindowDecorations,AsyncDns');
    app.commandLine.appendSwitch('enable-gpu-rasterization');
    app.commandLine.appendSwitch('ignore-gpu-blocklist');
}

// ── Modül seviyesi değişkenler ──

let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let isQuiting = false;
const isDev = process.argv.includes('--dev');

// Server instance tipi (server/src/index.ts'den)
interface ServerInstance {
    app: import('express').Application;
    server: import('http').Server;
    io: import('socket.io').Server;
}

let activeTunnel: ChildProcess | null = null;
let activeTunnelUrl: string | null = null;
let serverInstance: ServerInstance | null = null;

// ── Ana pencere oluşturma ──

function createWindow(): void {
    mainWindow = new BrowserWindow({
        width: 1200,
        height: 800,
        minWidth: 900,
        minHeight: 600,
        frame: false, // Özel başlık çubuğu
        backgroundColor: '#1a1a2e',
        icon: path.join(__dirname, '..', '..', 'assets', 'icon.png'),
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            contextIsolation: true,
            nodeIntegration: false,
            // FIX #2: webSecurity:false ve allowRunningInsecureContent kaldırıldı.
            webviewTag: true, // YouTube <webview> embed için
            experimentalFeatures: true,
            // FIX: WebRTC audio elementlerinin kullanıcı etkileşimi olmadan oynatılmasını sağla.
            autoplayPolicy: 'no-user-gesture-required',
            // FIX: Uygulama arka plana küçültüldüğünde mikrofon/ses kesilmesini önle.
            backgroundThrottling: false
        }
    });

    // Login sayfasıyla başla
    // Production: Vite build çıktısı (dist/), Dev: kaynak dosyalar (Vite dev server)
    const rendererDir = isDev
        ? path.join(__dirname, '..', 'renderer')
        : path.join(__dirname, '..', 'renderer', 'dist');
    mainWindow.loadFile(path.join(rendererDir, 'login.html'));

    // Zoom seviyesini kilitle
    mainWindow.webContents.on('did-finish-load', () => {
        mainWindow?.webContents.setZoomFactor(1);
        mainWindow?.webContents.setZoomLevel(0);
    });

    // Dış linkleri varsayılan tarayıcıda aç
    mainWindow.webContents.setWindowOpenHandler(({ url }) => {
        shell.openExternal(url);
        return { action: 'deny' as const };
    });

    // F12, Ctrl+Shift+I (DevTools) ve Ctrl+Plus/Minus/0 (Zoom) kısayollarını engelle
    mainWindow.webContents.on('before-input-event', (event, input) => {
        // DevTools'u engelle
        if (input.key === 'F12' || (input.control && input.shift && input.key.toLowerCase() === 'i')) {
            event.preventDefault();
        }
        // Ctrl+Plus, Ctrl+Minus, Ctrl+0 ile zoom'u engelle
        if (input.control && (input.key === '+' || input.key === '-' || input.key === '=' || input.key === '0')) {
            event.preventDefault();
        }
    });

    // FIX: Kullanıcılar uygulamanın kapandığını düşünüp mikrofonlarının açık kalmasından şikayetçi.
    // X tuşuna basıldığında uygulama doğrudan kapatılacak.
    mainWindow.on('close', function (_event: Electron.Event) {
        // Artık hide() yapmıyoruz, varsayılan Electron kapanma davranışına izin veriyoruz.
    });
}

// ============================================
// IPC Handlers - Güvenli İletişim
// ============================================

// Pencere kontrolleri
ipcMain.handle('window:minimize', () => {
    mainWindow?.minimize();
});

ipcMain.handle('window:maximize', () => {
    if (mainWindow?.isMaximized()) {
        mainWindow.unmaximize();
    } else {
        mainWindow?.maximize();
    }
    return mainWindow?.isMaximized();
});

ipcMain.handle('window:close', () => {
    mainWindow?.close();
});

ipcMain.handle('window:focus', () => {
    if (mainWindow) {
        if (mainWindow.isMinimized()) mainWindow.restore();
        mainWindow.focus();
    }
});

ipcMain.handle('window:isMaximized', () => {
    return mainWindow?.isMaximized();
});

// Uygulama verileri (örneğin Tunnel URL)
ipcMain.handle('get-tunnel-url', () => {
    try {
        const tunnelFile = path.join(appDataPath, 'tunnel-url.txt');
        if (fs.existsSync(tunnelFile)) {
            return fs.readFileSync(tunnelFile, 'utf-8').trim();
        }
    } catch (e) {
        console.error('Tunnel URL okunamadı:', (e as Error).message);
    }
    return null;
});

// Admin token'ını oku (sunucu otomatik üretip dosyaya yazmıştır)
ipcMain.handle('get-admin-token', () => {
    try {
        const tokenFile = path.join(appDataPath, 'admin-token.txt');
        if (fs.existsSync(tokenFile)) {
            return fs.readFileSync(tokenFile, 'utf-8').trim();
        }
    } catch (e) {
        console.error('Admin token okunamadı:', (e as Error).message);
    }
    return null;
});

ipcMain.handle('get-local-server-url', () => {
    if (serverInstance && serverInstance.server) {
        const addr = serverInstance.server.address();
        if (typeof addr === 'object' && addr) {
            return `http://127.0.0.1:${addr.port}`;
        }
    }
    return 'http://127.0.0.1:3847';
});

// ── Cloudflared tünel sürecini başlatan yardımcı fonksiyon ──

function spawnTunnel(
    cloudflaredBin: string,
    port: number,
    resolve: (url: string) => void,
    reject: (err: Error) => void
): void {
    activeTunnel = spawn(cloudflaredBin, [
        'tunnel',
        '--edge-ip-version', '4',
        '--url', `http://127.0.0.1:${port}`
    ], {
        windowsHide: true
    });

    let resolved = false;

    const handleOutput = (data: Buffer): void => {
        const output = data.toString();
        const match = output.match(/https:\/\/[a-zA-Z0-9-]+\.trycloudflare\.com/);
        if (match && !resolved) {
            resolved = true;
            activeTunnelUrl = match[0];
            resolve(activeTunnelUrl);
        }
    };

    activeTunnel.stdout?.on('data', handleOutput);
    activeTunnel.stderr?.on('data', handleOutput);

    activeTunnel.on('close', (code: number | null) => {
        console.log(`Cloudflare process kapandı. Code: ${code}`);
        activeTunnel = null;
        activeTunnelUrl = null;
        if (!resolved) {
            reject(new Error("Cloudflare tunnel başlatılamadı veya çok erken kapandı."));
        }
    });

    activeTunnel.on('error', (err: Error) => {
        activeTunnel = null;
        activeTunnelUrl = null;
        if (!resolved) {
            reject(err);
        }
    });
}

ipcMain.handle('start-host', async () => {
    try {
        // Sunucuyu başlatmadan önce portun kullanımda olup olmadığını kontrol et
        if (!serverInstance) {
            const inUse = await checkPort(3847);
            if (inUse) {
                console.log('[Electron-IPC] Port 3847 zaten kullanımda, arka plan sunucusu çalışıyor kabul ediliyor.');
            } else {
                const { startServer } = require('../../server/dist/index');
                serverInstance = await startServer(3847);
                const addr = serverInstance!.server.address();
                const port = typeof addr === 'object' && addr ? addr.port : 3847;
                console.log(`[Electron-IPC] Sunucu başarıyla başlatıldı, port: ${port}`);
            }
        }

        // 1) Eğer dışarıdan bir tünel açılmışsa onu kullan.
        try {
            const tunnelFile = path.join(appDataPath, 'tunnel-url.txt');
            if (fs.existsSync(tunnelFile)) {
                const url = fs.readFileSync(tunnelFile, 'utf-8').trim();
                if (url && url.includes('trycloudflare.com')) {
                    console.log("Harici tünel (start.sh) tespit edildi, tekrar tünel açılmayacak:", url);
                    return url;
                }
            }
        } catch (e) {
            console.error("Harici tünel kontrolünde hata:", e);
        }

        // Eğer zaten açık bir tünelimiz varsa yeniden kullan
        if (activeTunnel && activeTunnelUrl) {
            console.log("Mevcut Cloudflare tüneli yeniden kullanılıyor:", activeTunnelUrl);
            return activeTunnelUrl;
        }

        const activePort: number = serverInstance
            ? (() => { const a = serverInstance!.server.address(); return typeof a === 'object' && a ? a.port : 3847; })()
            : 3847;

        return new Promise<string>((resolve, reject) => {
            // Paketlenmiş modda: extraResources/cloudflared/cloudflared.exe
            // Geliştirme modunda: node_modules/cloudflared/bin/cloudflared.exe
            let cloudflaredBin: string;
            if (app.isPackaged) {
                cloudflaredBin = path.join(process.resourcesPath, 'cloudflared', 'cloudflared.exe');
            } else {
                cloudflaredBin = path.join(__dirname, '..', '..', 'node_modules', 'cloudflared', 'bin', 'cloudflared.exe');
            }

            // Binary yoksa indirmeyi dene
            if (!fs.existsSync(cloudflaredBin)) {
                console.log('[Tunnel] cloudflared binary bulunamadı, indiriliyor...');
                try {
                    const cf = require('cloudflared');
                    cf.install(cloudflaredBin).then(() => {
                        console.log('[Tunnel] cloudflared indirildi:', cloudflaredBin);
                        spawnTunnel(cloudflaredBin, activePort, resolve, reject);
                    }).catch((dlErr: Error) => {
                        reject(new Error('cloudflared indirilemedi: ' + dlErr.message));
                    });
                    return;
                } catch (e) {
                    reject(new Error('cloudflared binary bulunamadı ve indirilemedi: ' + (e as Error).message));
                    return;
                }
            }

            spawnTunnel(cloudflaredBin, activePort, resolve, reject);
        });
    } catch (err) {
        console.error("Host başlatılamadı:", err);
        throw err;
    }
});

// Sayfa navigasyonu
ipcMain.handle('navigate:chat', async () => {
    if (mainWindow) {
        const rendererDir = isDev
            ? path.join(__dirname, '..', 'renderer')
            : path.join(__dirname, '..', 'renderer', 'dist');
        await mainWindow.loadFile(path.join(rendererDir, 'chat.html'));
        mainWindow.focus();
        mainWindow.webContents.focus();
    }
});

ipcMain.handle('navigate:login', async () => {
    if (mainWindow) {
        const rendererDir = isDev
            ? path.join(__dirname, '..', 'renderer')
            : path.join(__dirname, '..', 'renderer', 'dist');
        await mainWindow.loadFile(path.join(rendererDir, 'login.html'));
        mainWindow.focus();
        mainWindow.webContents.focus();
    }
});

// Harici URL'leri varsayılan tarayıcıda güvenli şekilde aç
ipcMain.handle('open-external-url', (_event: IpcMainInvokeEvent, url: string) => {
    // Güvenlik kontrolü: Sadece http/https protokollerine izin ver
    if (url && (url.startsWith('http://') || url.startsWith('https://'))) {
        shell.openExternal(url);
    }
});

// Pano yazma — file:// bağlamında navigator.clipboard çalışmadığı için
ipcMain.handle('clipboard:write', (_event: IpcMainInvokeEvent, text: string) => {
    if (text && typeof text === 'string') {
        clipboard.writeText(text);
        return true;
    }
    return false;
});

// ============================================
// Uygulama Yaşam Döngüsü
// ============================================

ipcMain.handle('desktop-capturer-get-sources', async (_event: IpcMainInvokeEvent, opts: Electron.SourcesOptions) => {
    try {
        // Linux'ta PipeWire/Portal başarısız olabilir ve getSources asılabilir.
        // 10 saniyelik bir timeout ile bunu engelliyoruz.
        const timeoutPromise = new Promise<never>((_resolve, reject) =>
            setTimeout(() => reject(new Error('Ekran kaynakları zaman aşımına uğradı (10s)')), 10000)
        );
        const sources = await Promise.race([
            desktopCapturer.getSources(opts),
            timeoutPromise
        ]);
        return sources;
    } catch (err) {
        console.error('desktopCapturer.getSources hatası:', (err as Error).message);
        return []; // Boş dizi döndür, uygulama donmasın
    }
});

app.whenReady().then(async () => {
    // FIX #3: Sadece gerekli izinler onaylanıyor.
    const ALLOWED_PERMISSIONS: Set<string> = new Set([
        'media',           // Mikrofon + kamera (WebRTC)
        'camera',          // Kamera erişimi
        'microphone',      // Mikrofon erişimi
        'notifications',   // Masaüstü bildirimleri
        'display-capture', // Ekran paylaşımı
    ]);

    session.defaultSession.setPermissionRequestHandler((_webContents, permission, callback) => {
        callback(ALLOWED_PERMISSIONS.has(permission));
    });

    session.defaultSession.setPermissionCheckHandler((_webContents, permission) => {
        return ALLOWED_PERMISSIONS.has(permission);
    });

    // Arayüzün yüklenmesini engellememek için pencereyi hemen oluştur
    createWindow();

    // Sistem Tepsisi (Tray) İkonu ve Menüsü
    let iconPath: string;
    if (process.platform === 'win32') {
        iconPath = path.join(__dirname, '..', '..', 'assets', 'icon.ico');
    } else {
        iconPath = path.join(__dirname, '..', '..', 'assets', 'icon.png');
    }
    
    // Fallback if ico doesn't exist
    if (!fs.existsSync(iconPath)) {
        iconPath = path.join(__dirname, '..', '..', 'assets', 'icon.png');
    }

    tray = new Tray(iconPath);
    tray.setToolTip('Haven');
    
    const contextMenu = Menu.buildFromTemplate([
        { label: 'Haven', enabled: false },
        { type: 'separator' },
        { label: 'Göster', click: () => { mainWindow?.show(); } },
        { label: 'Çıkış', click: () => { 
            isQuiting = true; 
            app.quit(); 
        } }
    ]);
    tray.setContextMenu(contextMenu);
    
    tray.on('click', () => {
        mainWindow?.show();
    });

    app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) {
            createWindow();
        }
    });

    // Sunucuyu arka planda başlat
    if (!serverInstance) {
        (async () => {
            try {
                const { startServer } = require('../../server/dist/index');
                serverInstance = await startServer(3847);
                const addr = serverInstance!.server.address();
                const port = typeof addr === 'object' && addr ? addr.port : 3847;
                console.log(`[Electron] Sunucu başarıyla başlatıldı, port: ${port}`);
            } catch (err) {
                const error = err as NodeJS.ErrnoException;
                console.error('[Electron] Sunucu başlatılamadı:', error.message);
                if (error.code === 'EADDRINUSE') {
                    console.log('[Electron] Port 3847 meşgul, rastgele port deneniyor...');
                    try {
                        const { startServer } = require('../../server/dist/index');
                        serverInstance = await startServer(0);
                        const addr2 = serverInstance!.server.address();
                        const port2 = typeof addr2 === 'object' && addr2 ? addr2.port : 0;
                        console.log(`[Electron] Sunucu rastgele portta başlatıldı: ${port2}`);
                    } catch (err2) {
                        console.error('[Electron] Sunucu hiçbir portta başlatılamadı:', (err2 as Error).message);
                    }
                }
            }
        })();
    }
});

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        app.quit();
    }
});

// Güvenlik: Sadece dış navigasyonları engelle, dahili dosya navigasyonlarına izin ver
app.on('web-contents-created', (_event, contents) => {
    contents.on('will-navigate', (event, url) => {
        // file:// protokolü ile kendi uygulamamızın dosyalarına navigasyona izin ver
        if (url.startsWith('file://')) {
            return; // İzin ver
        }
        // Dış URL'leri engelle
        event.preventDefault();
    });
});
