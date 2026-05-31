/**
 * chat.js - Sohbet Odası ve İletişim Kontrolcüsü
 * 
 * Neler Var:
 * - Socket.io bağlantısını yönetir, mesajlaşma, resim gönderme, dosya transferi işlevlerini çalıştırır.
 * - Uçtan Uca Şifreleme (E2EE) algoritmalarını ve WebCrypto API kullanımını içerir (Mesajları AES-GCM 256bit ile şifreleme ve çözme).
 * - WebRTC üzerinden P2P Sınırsız dosya transferi, ekran paylaşımı ve sesli/görüntülü görüşme imkanı sunar.
 * - Bildirimleri, mesaj geçmişini ve kullanıcı arayüzü güncellemelerini idare eder.
 *
 * Ayarlar / Depolanan Veriler:
 * - haven_profile_pic, haven_server_url, haven_nickname, haven_room, haven_avatar, haven_login_theme
 * - (haven_room_password KALDIRILDI — FIX #4: artık sessionStorage kullanılıyor)
 */

const isWeb = window.location.protocol === 'http:' || window.location.protocol === 'https:';
const defaultServer = isWeb ? window.location.origin : 'http://localhost:3847';

// Kalıcı kullanıcı kimliği oluştur (bir kez üretilir, hep aynı kalır)
if (!localStorage.getItem('haven_user_id')) {
    localStorage.setItem('haven_user_id', 'user_' + Date.now() + '_' + Math.floor(Math.random() * 100000));
}
if (!localStorage.getItem('haven_user_token')) {
    localStorage.setItem('haven_user_token', crypto.randomUUID ? crypto.randomUUID() : 'token_' + Date.now() + '_' + Math.floor(Math.random() * 1000000000));
}

const state = {
    socket: null,
    userId: localStorage.getItem('haven_user_id'),
    userToken: localStorage.getItem('haven_user_token'),
    nickname: localStorage.getItem('haven_nickname'),
    roomKey: localStorage.getItem('haven_room'),
    avatarColor: localStorage.getItem('haven_avatar') || '#6366f1',
    profilePic: localStorage.getItem('haven_profile_pic') || null,
    authKey: localStorage.getItem('haven_auth_key') || null,
    // FIX #4: Şifre artık localStorage'dan değil sessionStorage'dan okunuyor.
    // sessionStorage sekme kapanınca silinir; diğer sekmelere ve eklentilere paylaşılmaz.
    roomPassword: sessionStorage.getItem('haven_session_password') || null,
    joinMode: localStorage.getItem('haven_join_mode') || 'join',
    serverUrl: isWeb ? window.location.origin : (localStorage.getItem('haven_server_url') || defaultServer),
    users: [], // Bu odadaki online kişiler
    lastMessageUserId: null, // Grouping için aslında username kullanılacak
    lastMessageTime: null,   // Son mesajın zamanı (5 dk gruplama için)
    lastMessageDateString: null, // Tarih ayırıcı için
    replyingTo: null, // Yanıtlanan mesaj ({id, username, content})
    adminToken: localStorage.getItem('haven_admin_token') || null, // FIX #8: Admin token (opsiyonel)
    pendingImages: [], // Gönderilmeyi bekleyen görseller (Blob objeleri)
    currentPreviewIndex: 0,
    viewOnceEnabled: false,
    editingMessageId: null, // Düzenlenen mesajın ID'si
    isSelfDestructText: false // Kaybolan mesaj modu
};

// Aktif Masaüstü Bildirimleri Takibi
const activeNotifications = new Set();
window.onfocus = () => {
    activeNotifications.forEach(n => n.close());
    activeNotifications.clear();
};

// UI Elementleri
const el = {
    connStatus: document.getElementById('connection-status'),
    chatMessages: document.getElementById('chat-messages'),
    messageInput: document.getElementById('message-input'),
    btnSend: document.getElementById('btn-send'),
    btnAttachFile: document.getElementById('btn-attach-file'),
    fileInput: document.getElementById('file-input'),
    emptyState: document.getElementById('empty-state'),
    toastContainer: document.getElementById('toast-container'),
    btnLogout: document.getElementById('btn-logout'),
    roomNameDisplay: document.getElementById('room-name-display'),
    headerOnlineText: document.getElementById('header-online-text'),
    headerUserCount: document.getElementById('header-user-count'),
    modalUsers: document.getElementById('modal-users'),
    btnCloseUsersModal: document.getElementById('btn-close-users-modal'),
    usersModalList: document.getElementById('users-modal-list'),
    btnJoinVoice: document.getElementById('btn-join-voice'),
    btnJoinVideo: document.getElementById('btn-join-video'),
    btnLeaveVoice: document.getElementById('btn-leave-voice'),
    btnToggleMic: document.getElementById('btn-toggle-mic'),
    btnToggleVideo: document.getElementById('btn-toggle-video'),
    btnToggleScreen: document.getElementById('btn-toggle-screen'),
    callStatusText: document.getElementById('call-status-text'),
    voiceContainer: document.getElementById('voice-call-container'),
    voiceParticipants: document.getElementById('voice-participants'),

    // Gelen Arama Elementleri
    modalIncomingCall: document.getElementById('modal-incoming-call'),
    btnDeclineCall: document.getElementById('btn-decline-call'),
    btnAcceptCall: document.getElementById('btn-accept-call'),
    incomingAvatar: document.getElementById('incoming-caller-avatar'),
    incomingName: document.getElementById('incoming-caller-name'),

    // Ekran Paylaşımı
    modalScreenShare: document.getElementById('modal-screen-share'),
    btnCloseScreenModal: document.getElementById('btn-close-screen-modal'),
    tabScreens: document.getElementById('tab-screens'),
    tabWindows: document.getElementById('tab-windows'),
    screenShareGrid: document.getElementById('screen-share-grid'),

    // Ayarlar / Tema
    btnChatSettings: document.getElementById('btn-chat-settings'),
    chatSettingsModal: document.getElementById('chat-settings-modal'),
    btnCloseChatSettings: document.getElementById('btn-close-chat-settings'),
    btnSaveChatSettings: document.getElementById('btn-save-chat-settings'),
    chatUsernameInput: document.getElementById('chat-username'),
    chatAvatarColorInput: document.getElementById('chat-avatar-color'),
    chatColorPreviewText: document.getElementById('chat-color-preview-text'),
    chatColorPickerContainer: document.getElementById('chat-color-picker'),
    chatThemeSelector: document.getElementById('chat-theme-selector'),
    chatLangSelect: document.getElementById('chat-lang-select'),
    chatAvatarUpload: document.getElementById('chat-avatar-upload'),
    chatAvatarPreviewImg: document.getElementById('chat-avatar-preview-img'),
    chatAvatarUploadIcon: document.getElementById('chat-avatar-upload-icon'),

    // Aktif Arama Bannerı
    activeCallBanner: document.getElementById('active-call-banner'),
    activeCallParticipants: document.getElementById('active-call-participants'),
    activeCallJoinBtn: document.getElementById('active-call-join-btn')
};

// WebRTC Durumları
const voiceState = {
    isInVoice: false,
    isMicOn: true,
    isVideoOn: false,
    isScreenOn: false,
    localStream: null,
    screenStream: null,
    peers: {},
    activeUsers: []
};

// ============================================
// UÇTAN UCA ŞİFRELEME (E2EE) MANTIĞI
// ============================================
let ringtoneAudio = null;

function playRingtone() {
    if (!ringtoneAudio) {
        ringtoneAudio = new Audio('assets/ringtone.mp3');
        ringtoneAudio.loop = true;
    }
    ringtoneAudio.play().catch(e => console.log('Zil sesi çalınamadı (İlke engeli vb.):', e));
}

function stopRingtone() {
    if (ringtoneAudio) {
        ringtoneAudio.pause();
        ringtoneAudio.currentTime = 0;
    }
}

// FIX #1: Sabit ENCRYPTION_SALT kaldırıldı.
// Salt artık sunucudan per-room olarak alınıyor (room-e2ee-salt eventi).