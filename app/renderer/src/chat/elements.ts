/**
 * elements.ts — DOM Element Referansları
 *
 * chat.html'deki tüm DOM elementlerinin merkezi referans objesi.
 * getElementById çağrıları bir kez yapılır, sonuç diğer modüllerce kullanılır.
 */

export interface ChatElements {
    connStatus: HTMLElement | null;
    chatMessages: HTMLElement | null;
    messageInput: HTMLTextAreaElement | null;
    btnSend: HTMLElement | null;
    btnAttachFile: HTMLElement | null;
    fileInput: HTMLInputElement | null;
    emptyState: HTMLElement | null;
    toastContainer: HTMLElement | null;
    btnLogout: HTMLElement | null;
    roomNameDisplay: HTMLElement | null;
    headerOnlineText: HTMLElement | null;
    headerUserCount: HTMLElement | null;
    modalUsers: HTMLElement | null;
    btnCloseUsersModal: HTMLElement | null;
    usersModalList: HTMLElement | null;
    btnJoinVoice: HTMLElement | null;
    btnJoinVideo: HTMLElement | null;
    btnLeaveVoice: HTMLElement | null;
    btnToggleMic: HTMLElement | null;
    btnToggleVideo: HTMLElement | null;
    btnToggleScreen: HTMLElement | null;
    callStatusText: HTMLElement | null;
    voiceContainer: HTMLElement | null;
    voiceParticipants: HTMLElement | null;

    // Gelen Arama Elementleri
    modalIncomingCall: HTMLElement | null;
    btnDeclineCall: HTMLElement | null;
    btnAcceptCall: HTMLElement | null;
    incomingAvatar: HTMLElement | null;
    incomingName: HTMLElement | null;

    // Ekran Paylaşımı
    modalScreenShare: HTMLElement | null;
    btnCloseScreenModal: HTMLElement | null;
    tabScreens: HTMLElement | null;
    tabWindows: HTMLElement | null;
    screenShareGrid: HTMLElement | null;

    // Ayarlar / Tema
    btnChatSettings: HTMLElement | null;
    chatSettingsModal: HTMLElement | null;
    btnCloseChatSettings: HTMLElement | null;
    btnSaveChatSettings: HTMLElement | null;
    chatUsernameInput: HTMLInputElement | null;
    chatAvatarColorInput: HTMLInputElement | null;
    chatColorPreviewText: HTMLElement | null;
    chatColorPickerContainer: HTMLElement | null;
    chatThemeSelector: HTMLSelectElement | null;
    chatLangSelect: HTMLSelectElement | null;
    chatAvatarUpload: HTMLInputElement | null;
    chatAvatarPreviewImg: HTMLImageElement | null;
    chatAvatarUploadIcon: HTMLElement | null;

    // Aktif Arama Bannerı
    activeCallBanner: HTMLElement | null;
    activeCallParticipants: HTMLElement | null;
    activeCallJoinBtn: HTMLElement | null;
}

export const el: ChatElements = {
    connStatus: document.getElementById('connection-status'),
    chatMessages: document.getElementById('chat-messages'),
    messageInput: document.getElementById('message-input') as HTMLTextAreaElement | null,
    btnSend: document.getElementById('btn-send'),
    btnAttachFile: document.getElementById('btn-attach-file'),
    fileInput: document.getElementById('file-input') as HTMLInputElement | null,
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

    // Gelen Arama
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

    // Ayarlar
    btnChatSettings: document.getElementById('btn-chat-settings'),
    chatSettingsModal: document.getElementById('chat-settings-modal'),
    btnCloseChatSettings: document.getElementById('btn-close-chat-settings'),
    btnSaveChatSettings: document.getElementById('btn-save-chat-settings'),
    chatUsernameInput: document.getElementById('chat-username') as HTMLInputElement | null,
    chatAvatarColorInput: document.getElementById('chat-avatar-color') as HTMLInputElement | null,
    chatColorPreviewText: document.getElementById('chat-color-preview-text'),
    chatColorPickerContainer: document.getElementById('chat-color-picker'),
    chatThemeSelector: document.getElementById('chat-theme-selector') as HTMLSelectElement | null,
    chatLangSelect: document.getElementById('chat-lang-select') as HTMLSelectElement | null,
    chatAvatarUpload: document.getElementById('chat-avatar-upload') as HTMLInputElement | null,
    chatAvatarPreviewImg: document.getElementById('chat-avatar-preview-img') as HTMLImageElement | null,
    chatAvatarUploadIcon: document.getElementById('chat-avatar-upload-icon'),

    // Aktif Arama Banner
    activeCallBanner: document.getElementById('active-call-banner'),
    activeCallParticipants: document.getElementById('active-call-participants'),
    activeCallJoinBtn: document.getElementById('active-call-join-btn'),
};
