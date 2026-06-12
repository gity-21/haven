/**
 * preload.ts - Güvenli IPC Köprüsü (Context Bridge)
 * 
 * Neler Var:
 * - Renderer process (ön yüz) ile Main process (arka plan) arasında güvenli ve yalıtılmış iletişim sağlar.
 * - Node.js entegrasyonu tamamen kapatıldığı için önyüzün yapabileceği işlemler burada sınırlandırılır.
 * 
 * Expose Edilen Fonksiyonlar:
 * - Pencere kontrolleri (minimizeWindow, maximizeWindow, vb.)
 * - Yönlendirmeler (navigateToChat, navigateToLogin)
 * - Tünel/Sunucu Başlatma ve Okuma (startHost, getLocalServerUrl, getTunnelUrl)
 * - Ekran paylaşımı için masaüstü kaynaklarını alma (getDesktopSources)
 */

import { contextBridge, ipcRenderer, webFrame } from 'electron';

// Zoom seviyesini sıfırla ve kilitle (Zoom bug'ını önler)
webFrame.setZoomLevel(0);
webFrame.setZoomFactor(1);
// Zoom değişikliklerini engelle
webFrame.setVisualZoomLevelLimits(1, 1);

/**
 * Renderer'a güvenli API exposure
 */
contextBridge.exposeInMainWorld('electronAPI', {
    // Pencere kontrolleri (chat.js ve login.js'nin beklediği format)
    minimizeWindow: (): Promise<void> => ipcRenderer.invoke('window:minimize'),
    maximizeWindow: (): Promise<boolean> => ipcRenderer.invoke('window:maximize'),
    closeWindow: (): Promise<void> => ipcRenderer.invoke('window:close'),
    isMaximized: (): Promise<boolean> => ipcRenderer.invoke('window:isMaximized'),
    focusWindow: (): Promise<void> => ipcRenderer.invoke('window:focus'),

    // Sayfa navigasyonu (Electron navigasyonlarını IPC üzerinden yönet)
    navigateToChat: (): Promise<void> => ipcRenderer.invoke('navigate:chat'),
    navigateToLogin: (): Promise<void> => ipcRenderer.invoke('navigate:login'),

    // Cloudflare Tunnel URL'sini otomatik oku (Asenkron)
    getTunnelUrl: (): Promise<string | null> => ipcRenderer.invoke('get-tunnel-url'),

    // Uygulama içi Host'u başlat
    startHost: (): Promise<string> => ipcRenderer.invoke('start-host'),

    // Lokal sunucu URL'sini al (her zaman doğru portu döner)
    getLocalServerUrl: (): Promise<string> => ipcRenderer.invoke('get-local-server-url'),

    // Harici bağlantıları varsayılan tarayıcıda aç
    openExternal: (url: string): Promise<void> => ipcRenderer.invoke('open-external-url', url),

    // Clipboard (Pano)
    writeToClipboard: (text: string): Promise<boolean> => ipcRenderer.invoke('clipboard:write', text),

    // Ekran Paylaşımı (Ekran/Pencere Listesi Alma)
    getDesktopSources: (opts: { types: string[] }): Promise<Electron.DesktopCapturerSource[]> =>
        ipcRenderer.invoke('desktop-capturer-get-sources', opts),

    // Admin token'ını al (sunucu sahibi için otomatik yetkilendirme)
    getAdminToken: (): Promise<string | null> => ipcRenderer.invoke('get-admin-token')
});

// DOM yüklendiğinde Ctrl+Scroll ve Ctrl+Plus/Minus zoom'u engelle
window.addEventListener('DOMContentLoaded', () => {
    // Ctrl + Scroll (tekerlek) ile zoom'u engelle
    document.addEventListener('wheel', (e: WheelEvent) => {
        if (e.ctrlKey) {
            e.preventDefault();
        }
    }, { passive: false });

    // Ctrl+Plus / Ctrl+Minus / Ctrl+0 zoom kısayollarını engelle
    document.addEventListener('keydown', (e: KeyboardEvent) => {
        if ((e.ctrlKey || e.metaKey) && (e.key === '+' || e.key === '-' || e.key === '=' || e.key === '0')) {
            e.preventDefault();
        }
    });
});
