/**
 * preload.js - Güvenli IPC Köprüsü (Context Bridge)
 * 
 * Neler Var:
 * - Renderer process (ön yüz) ile Main process (arka plan) arasında güvenli ve yalıtılmış iletişim sağlar.
 * - Node.js entegrasyonu tamamen kapatıldığı için önyüzün yapabileceği işlemler (pencere küçültme, tünel açtırma vb.) burada sınırlandırılır.
 * 
 * Ayarlar/Expose Edilen Fonksiyonlar:
 * - Pencere kontrolleri (minimizeWindow, maximizeWindow, vb.)
 * - Yönlendirmeler (navigateToChat, navigateToLogin)
 * - Tünel/Sunucu Başlatma ve Okuma (startHost, getLocalServerUrl, getTunnelUrl)
 * - Ekran paylaşımı için masaüstü kaynaklarını alma (getDesktopSources)
 */

const { contextBridge, ipcRenderer, webFrame } = require('electron');

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
    minimizeWindow: () => ipcRenderer.invoke('window:minimize'),
    maximizeWindow: () => ipcRenderer.invoke('window:maximize'),
    closeWindow: () => ipcRenderer.invoke('window:close'),
    isMaximized: () => ipcRenderer.invoke('window:isMaximized'),
    focusWindow: () => ipcRenderer.invoke('window:focus'),

    // Sayfa navigasyonu (Electron navigasyonlarını IPC üzerinden yönet)
    navigateToChat: () => ipcRenderer.invoke('navigate:chat'),
    navigateToLogin: () => ipcRenderer.invoke('navigate:login'),

    // Cloudflare Tunnel URL'sini otomatik oku (Asenkron)
    getTunnelUrl: () => ipcRenderer.invoke('get-tunnel-url'),

    // Uygulama içi Host'u başlat
    startHost: () => ipcRenderer.invoke('start-host'),

    // Lokal sunucu URL'sini al (her zaman doğru portu döner)
    getLocalServerUrl: () => ipcRenderer.invoke('get-local-server-url'),

    // Harici bağlantıları varsayılan tarayıcıda aç
    openExternal: (url) => ipcRenderer.invoke('open-external-url', url),

    // Ekran Paylaşımı (Ekran/Pencere Listesi Alma)
    getDesktopSources: (opts) => ipcRenderer.invoke('desktop-capturer-get-sources', opts)
});

// DOM yüklendiğinde Ctrl+Scroll ve Ctrl+Plus/Minus zoom'u engelle
window.addEventListener('DOMContentLoaded', () => {
    // Ctrl + Scroll (tekerlek) ile zoom'u engelle
    document.addEventListener('wheel', (e) => {
        if (e.ctrlKey) {
            e.preventDefault();
        }
    }, { passive: false });

    // Ctrl+Plus / Ctrl+Minus / Ctrl+0 zoom kısayollarını engelle
    document.addEventListener('keydown', (e) => {
        if ((e.ctrlKey || e.metaKey) && (e.key === '+' || e.key === '-' || e.key === '=' || e.key === '0')) {
            e.preventDefault();
        }
    });
});
