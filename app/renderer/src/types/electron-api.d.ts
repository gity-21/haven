/**
 * electron-api.d.ts — Electron contextBridge API Tip Tanımları
 *
 * preload.ts üzerinden renderer'a açılan window.electronAPI arayüzü.
 */

export interface DesktopSource {
    id: string;
    name: string;
    thumbnail: { toDataURL: () => string };
}

export interface ElectronAPI {
    minimizeWindow: () => Promise<void>;
    maximizeWindow: () => Promise<boolean>;
    closeWindow: () => Promise<void>;
    isMaximized: () => Promise<boolean>;
    focusWindow: () => Promise<void>;
    navigateToChat: () => Promise<void>;
    navigateToLogin: () => Promise<void>;
    getTunnelUrl: () => Promise<string | null>;
    startHost: () => Promise<string>;
    getLocalServerUrl: () => Promise<string>;
    openExternal: (url: string) => Promise<void>;
    writeToClipboard: (text: string) => Promise<boolean>;
    getDesktopSources: (opts: { types: string[] }) => Promise<DesktopSource[]>;
    getAdminToken: () => Promise<string | null>;
}

export interface I18n {
    t: (key: string) => string;
    setLanguage: (lang: string) => void;
    currentLanguage: string;
    translatePage?: () => void;
}

declare global {
    interface Window {
        electronAPI?: ElectronAPI;
        i18n?: I18n;

        // P2P global referanslar
        pendingP2PFiles?: Record<string, File>;
        p2pConnections?: Record<string, RTCPeerConnection>;

        // Global fonksiyonlar (chat.js'den window'a atananlar)
        startP2PDownload: (fileId: string, targetId: string, filename: string, size: number, isAuto?: boolean) => Promise<void>;
        sendP2PFile: (file: File) => Promise<void>;
        uploadFileToChat: (file: File) => Promise<unknown>;
        addPendingImage: (blob: Blob) => void;
        removePendingImage: (index: number) => void;
        showConfirmModal: (message: string, onConfirm: () => void, singleButton?: boolean) => void;
        showAlertModal: (message: string, title?: string) => Promise<void>;
        initiateReply: (msgId: number | string, username: string, content: string) => void;
        cancelReply: () => void;
        deleteMessage: (messageId: number | string, roomId?: string) => void;
        sendReaction: (messageId: number | string, emoji: string) => void;
        toggleUserMute: (userId: string) => void;
        changeUserVolume: (userId: string, vol: number | string) => void;
        openUserMenu: (e: MouseEvent, userId: string) => void;
        toggleVoiceMsg: (audioId: string, src: string) => void;
        seekVoiceMsg: (event: MouseEvent, audioId: string) => void;
        previewMedia: (url: string, type: 'image' | 'video') => void;
    }
}
