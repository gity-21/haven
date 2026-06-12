/**
 * state.ts — Merkezi Uygulama Durumu
 *
 * chat.js'deki tüm global state ve voiceState nesnelerinin tek yetkili kaynağı.
 * Diğer modüller bu dosyadan import ederek duruma erişir.
 */

import type { AppState, VoiceState, VolumeMeterEntry } from '../types/state';

// ── Kalıcı kullanıcı kimliği ──

if (!localStorage.getItem('haven_user_id')) {
    localStorage.setItem('haven_user_id', 'user_' + Date.now() + '_' + Math.floor(Math.random() * 100000));
}

// FIX: IDOR zafiyetine karşı gizli oturum anahtarı oluştur (asla yayınlanmaz)
if (!localStorage.getItem('haven_user_secret')) {
    const array = new Uint8Array(16);
    crypto.getRandomValues(array);
    const secret = Array.from(array, byte => byte.toString(16).padStart(2, '0')).join('');
    localStorage.setItem('haven_user_secret', 'secret_' + secret);
}

// ── Web/Electron ortam tespiti ──

export const isWeb: boolean = window.location.protocol === 'http:' || window.location.protocol === 'https:';
export const defaultServer: string = isWeb ? window.location.origin : 'http://localhost:3847';

// ── Ana uygulama durumu ──

export const state: AppState = {
    socket: null,
    userId: localStorage.getItem('haven_user_id')!,
    userSecret: localStorage.getItem('haven_user_secret')!,
    nickname: localStorage.getItem('haven_nickname')!,
    roomKey: localStorage.getItem('haven_room')!,
    avatarColor: localStorage.getItem('haven_avatar') || '#6366f1',
    profilePic: localStorage.getItem('haven_profile_pic') || null,
    authKey: localStorage.getItem('haven_auth_key') || null,
    // FIX #4: Şifre artık localStorage'dan değil sessionStorage'dan okunuyor.
    roomPassword: sessionStorage.getItem('haven_session_password') || null,
    joinMode: (localStorage.getItem('haven_join_mode') as 'create' | 'join') || 'join',
    serverUrl: isWeb ? window.location.origin : (localStorage.getItem('haven_server_url') || defaultServer),
    users: [],
    lastMessageUserId: null,
    lastMessageTime: null,
    lastMessageDateString: null,
    replyingTo: null,
    adminToken: localStorage.getItem('haven_admin_token') || null,
    pendingImages: [],
    currentPreviewIndex: 0,
    viewOnceEnabled: false,
    isSelfDestructText: false,
    editingMessageId: null
};

// ── WebRTC Durumları ──

export const voiceState: VoiceState = {
    localStream: null,
    screenStream: null,
    peers: {},
    isInVoice: false,
    isVideoOn: false,
    isScreenOn: false,
    isMicOn: true,
};

// ── Volume meter'lar ──

export const volumeMeters: Record<string, VolumeMeterEntry> = {};

// ── Aktif Masaüstü Bildirimleri ──

export const activeNotifications: Set<Notification> = new Set();

window.onfocus = () => {
    activeNotifications.forEach(n => n.close());
    activeNotifications.clear();
};

// ── Zil sesi ──

let ringtoneAudio: HTMLAudioElement | null = null;

export function playRingtone(): void {
    if (!ringtoneAudio) {
        ringtoneAudio = new Audio('assets/ringtone.mp3');
        ringtoneAudio.loop = true;
    }
    ringtoneAudio.play().catch(e => console.log('Zil sesi çalınamadı (İlke engeli vb.):', e));
}

export function stopRingtone(): void {
    if (ringtoneAudio) {
        ringtoneAudio.pause();
        ringtoneAudio.currentTime = 0;
    }
}
