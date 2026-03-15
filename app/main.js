/**
 * main.js - Electron Ana İşlem (Main Process)
 * 
 * Bu dosya uygulamanın masaüstü istemcisinin (Electron) başlangıç noktasıdır.
 * Neler Var:
 * - Ana pencere (BrowserWindow) oluşturma ve arayüz ayarları.
 * - IPC (Inter-Process Communication) iletişim kanallarının dinlenmesi (Minimize, Maximize, Kapatma).
 * - "Host" modunda uygulamanın arka planda kendi Node.js sunucusunu ve Cloudflare tünelini başlatması.
 * - İşletim sistemine özel GPU/Donanım hızlandırma optimizasyonları (Ayar flag'leri).
 * - Ekran ve kamera/ses izinlerine otomatik onay veren güvenlik ayarları.
 */

const { app, BrowserWindow, ipcMain, shell } = require('electron');
const path = require('path');

// Uygulama adını ve ID'sini ayarla (Bildirimlerde 'Haven' görünmesi için)
app.name = 'Haven';
if (process.platform === 'win32') {
    app.setAppUserModelId('com.dc.private-chat');
}

const fs = require('fs');

// Veri depolama konumu (App Data altındaki DC-Chat-Data klasörü)
const appDataPath = app.isPackaged
    ? path.join(app.getPath('userData'), 'data')
    : path.resolve(__dirname, '..', 'data');

if (!fs.existsSync(appDataPath)) {
    fs.mkdirSync(appDataPath, { recursive: true });
}

// Sunucu tarafının bu yolu kullanması için ortam değişkenine kaydet
process.env.DATA_DIR = appDataPath;

// Mikrofon ve kamera erişimi için gerekli flag'lar
app.commandLine.appendSwitch('enable-speech-dispatcher');
app.commandLine.appendSwitch('enable-usermedia-screen-capturing');
app.commandLine.appendSwitch('allow-http-screen-capture');
// Disable hardware acceleration ONLY if there are specific known issues with transparent windows
// But generally, turning this off causes massive lag, especially on Linux (Wayland/X11).
// app.disableHardwareAcceleration();
// app.commandLine.appendSwitch('disable-gpu');
// app.commandLine.appendSwitch('disable-software-rasterizer');

// Linux'ta Wayland ve genel GPU performansı için ek optimizasyon (Opsiyonel ama faydalıdır)
if (process.platform === 'linux') {
    app.commandLine.appendSwitch('enable-features', 'WaylandWindowDecorations');
    app.commandLine.appendSwitch('enable-gpu-rasterization');
    app.commandLine.appendSwitch('ignore-gpu-blocklist'); // Genelde Arch'da kapalı kalan GPU'yu zorlar
}

let mainWindow;

/**
 * Ana pencereyi oluştur
 */
function createWindow() {
    mainWindow = new BrowserWindow({
        width: 1200,
        height: 800,
        minWidth: 900,
        minHeight: 600,
        frame: false, // Özel başlık çubuğu
        backgroundColor: '#1a1a2e',
        icon: path.join(__dirname, '..', 'assets', 'icon.png'),
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            contextIsolation: true,
            nodeIntegration: false,
            webSecurity: false,
            allowRunningInsecureContent: true,
            webviewTag: true, // YouTube <webview> embed için
            // yüksek izolasyonlu mikrofon/kamera erişimi için
            experimentalFeatures: true
        }
    });

    // Login sayfasıyla başla
    mainWindow.loadFile(path.join(__dirname, 'renderer', 'login.html'));

    // Zoom seviyesini kilitle (Zoom bug'ını önler - cascade/tekrarlama hatası)
    mainWindow.webContents.on('did-finish-load', () => {
        mainWindow.webContents.setZoomFactor(1);
        mainWindow.webContents.setZoomLevel(0);
    });

    // Dış linkleri varsayılan tarayıcıda aç
    mainWindow.webContents.setWindowOpenHandler(({ url }) => {
        shell.openExternal(url);
        return { action: 'deny' };
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
        console.error('Tunnel URL okunamadı:', e.message);
    }
    return null;
});

ipcMain.handle('get-local-server-url', () => {
    if (serverInstance && serverInstance.server) {
        return `http://127.0.0.1:${serverInstance.server.address().port}`;
    }
    return 'http://127.0.0.1:3847';
});

let activeTunnel = null;
let activeTunnelUrl = null;
let serverInstance = null;

ipcMain.handle('start-host', async () => {
    try {
        // 1) Eğer dc / start.sh üzerinden dışarıdan bir tünel açılmışsa DİREKT olarak onu kullan.
        // Cloudflare ücretsiz tünel limitine takılmamak ve çakışmayı (xhr poll error) önlemek için en güvenlisi bu.
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

        if (!serverInstance) {
            const { startServer } = require('../server/index.js');
            serverInstance = await startServer(0); // 0 = Let OS assign random available port
        }

        // Eğer zaten açık bir tünelimiz ve bağımız varsa, hiç kapatmadan aynı linki ve tüneli geri ver!
        if (activeTunnel && activeTunnelUrl) {
            console.log("Mevcut Cloudflare tüneli yeniden kullanılıyor:", activeTunnelUrl);
            return activeTunnelUrl;
        }

        const address = serverInstance.server.address();
        const activePort = address.port;

        return new Promise((resolve, reject) => {
            const { spawn } = require('child_process');

            // Windows'ta npx -> npx.cmd olmalı ve shell: true gerekiyor
            const npxCmd = process.platform === 'win32' ? 'npx.cmd' : 'npx';
            activeTunnel = spawn(npxCmd, [
                'cloudflared',
                'tunnel',
                '--edge-ip-version', '4',
                '--url', `http://127.0.0.1:${activePort}`
            ], {
                shell: true,
                windowsHide: true
            });

            let resolved = false;

            const handleOutput = (data) => {
                const output = data.toString();
                // Cloudflared çıktı formatı: |  https://lindsay-wage-degree.trycloudflare.com  |
                const match = output.match(/https:\/\/[a-zA-Z0-9-]+\.trycloudflare\.com/);

                if (match && !resolved) {
                    resolved = true;
                    activeTunnelUrl = match[0];
                    resolve(activeTunnelUrl);
                }
            };

            // cloudflared çıktıları konsol yapılandırmasına göre stdout veya stderr'de çıkabilir
            activeTunnel.stdout.on('data', handleOutput);
            activeTunnel.stderr.on('data', handleOutput);

            activeTunnel.on('close', (code) => {
                console.log(`Cloudflare process kapandı. Code: ${code}`);
                activeTunnel = null;
                activeTunnelUrl = null;
                if (!resolved) {
                    reject(new Error("Cloudflare tunnel başlatılamadı veya çok erken kapandı."));
                }
            });

            activeTunnel.on('error', (err) => {
                activeTunnel = null;
                activeTunnelUrl = null;
                if (!resolved) {
                    reject(err);
                }
            });
        });
    } catch (err) {
        console.error("Host başlatılamadı:", err);
        throw err;
    }
});

// Sayfa navigasyonu
ipcMain.handle('navigate:chat', async () => {
    if (mainWindow) {
        await mainWindow.loadFile(path.join(__dirname, 'renderer', 'chat.html'));
        mainWindow.focus();
        mainWindow.webContents.focus();
    }
});

ipcMain.handle('navigate:login', async () => {
    if (mainWindow) {
        await mainWindow.loadFile(path.join(__dirname, 'renderer', 'login.html'));
        mainWindow.focus();
        mainWindow.webContents.focus();
    }
});

// Harici URL'leri varsayılan tarayıcıda güvenli şekilde aç
ipcMain.handle('open-external-url', (event, url) => {
    // Güvenlik kontrolü: Sadece http/https protokollerine izin ver
    if (url && (url.startsWith('http://') || url.startsWith('https://'))) {
        shell.openExternal(url);
    }
});

// ============================================
// Uygulama Yaşam Döngüsü
// ============================================

const { desktopCapturer } = require('electron');
ipcMain.handle('desktop-capturer-get-sources', async (event, opts) => {
    try {
        // Linux'ta PipeWire/Portal başarısız olabilir ve getSources asılabilir.
        // 10 saniyelik bir timeout ile bunu engelliyoruz.
        const timeoutPromise = new Promise((_, reject) =>
            setTimeout(() => reject(new Error('Ekran kaynakları zaman aşımına uğradı (10s)')), 10000)
        );
        const sources = await Promise.race([
            desktopCapturer.getSources(opts),
            timeoutPromise
        ]);
        return sources;
    } catch (err) {
        console.error('desktopCapturer.getSources hatası:', err.message);
        return []; // Boş dizi döndür, uygulama donmasın
    }
});

app.whenReady().then(() => {
    const { session } = require('electron');

    // Medya donanımlarına erişim iznini otomatik olarak onayla
    session.defaultSession.setPermissionRequestHandler((webContents, permission, callback) => {
        if (permission === 'media' || permission === 'camera' || permission === 'microphone') {
            callback(true);
        } else {
            callback(true); // Diğer izinlere de izin ver (örneğin bildirimler için)
        }
    });

    session.defaultSession.setPermissionCheckHandler((webContents, permission) => {
        if (permission === 'media' || permission === 'camera' || permission === 'microphone') {
            return true;
        }
        return true;
    });

    createWindow();

    app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) {
            createWindow();
        }
    });
});

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        app.quit();
    }
});

// Güvenlik: Sadece dış navigasyonları engelle, dahili dosya navigasyonlarına izin ver
app.on('web-contents-created', (event, contents) => {
    contents.on('will-navigate', (event, url) => {
        // file:// protokolü ile kendi uygulamamızın dosyalarına navigasyona izin ver
        if (url.startsWith('file://')) {
            return; // İzin ver
        }
        // Dış URL'leri engelle
        event.preventDefault();
    });
});
