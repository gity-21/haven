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
 * - dc_profile_pic, dc_server_url, dc_nickname, dc_room, dc_avatar, dc_login_theme, dc_room_password
 */

const isWeb = window.location.protocol === 'http:' || window.location.protocol === 'https:';
const defaultServer = isWeb ? window.location.origin : 'http://localhost:3847';

// Kalıcı kullanıcı kimliği oluştur (bir kez üretilir, hep aynı kalır)
if (!localStorage.getItem('dc_user_id')) {
    localStorage.setItem('dc_user_id', 'user_' + Date.now() + '_' + Math.floor(Math.random() * 100000));
}

const state = {
    socket: null,
    userId: localStorage.getItem('dc_user_id'),
    nickname: localStorage.getItem('dc_nickname'),
    roomKey: localStorage.getItem('dc_room'),
    avatarColor: localStorage.getItem('dc_avatar') || '#6366f1',
    profilePic: localStorage.getItem('dc_profile_pic') || null,
    authKey: localStorage.getItem('dc_auth_key') || null,
    roomPassword: localStorage.getItem('dc_room_password') || null,
    joinMode: localStorage.getItem('dc_join_mode') || 'join',
    serverUrl: isWeb ? window.location.origin : (localStorage.getItem('dc_server_url') || defaultServer),
    users: [], // Bu odadaki online kişiler
    lastMessageUserId: null, // Grouping için aslında username kullanılacak
    lastMessageTime: null,   // Son mesajın zamanı (5 dk gruplama için)
    lastMessageDateString: null, // Tarih ayırıcı için
    replyingTo: null, // Yanıtlanan mesaj ({id, username, content})
    pendingImages: [], // Gönderilmeyi bekleyen görseller (Blob objeleri)
    currentPreviewIndex: 0,
    viewOnceEnabled: false
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
    localStream: null,
    screenStream: null,
    peers: {}, // { userId: RTCPeerConnection }
    isInVoice: false,
    isVideoOn: false,
    isScreenOn: false,
    isMicOn: true,
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

const ENCRYPTION_SALT = "HavenSecureSalt2026";
let e2eeKey = null;

async function deriveE2EEKey(password) {
    const enc = new TextEncoder();
    const keyMaterial = await crypto.subtle.importKey("raw", enc.encode(password), { name: "PBKDF2" }, false, ["deriveKey"]);
    return crypto.subtle.deriveKey(
        { name: "PBKDF2", salt: enc.encode(ENCRYPTION_SALT), iterations: 100000, hash: "SHA-256" },
        keyMaterial, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]
    );
}

async function encryptMessage(text) {
    if (!e2eeKey || !text) return text;
    try {
        const iv = crypto.getRandomValues(new Uint8Array(12));
        const enc = new TextEncoder();
        const encrypted = await crypto.subtle.encrypt({ name: "AES-GCM", iv: iv }, e2eeKey, enc.encode(text));

        const encryptedBytes = new Uint8Array(encrypted);
        const combined = new Uint8Array(iv.length + encryptedBytes.length);
        combined.set(iv, 0);
        combined.set(encryptedBytes, iv.length);

        let binary = '';
        combined.forEach(b => binary += String.fromCharCode(b));
        return window.btoa(binary);
    } catch (e) {
        console.error("Şifreleme hatası:", e);
        return text;
    }
}

async function decryptMessage(base64text) {
    if (!e2eeKey || !base64text) return base64text;
    try {
        const binary = window.atob(base64text);
        const combined = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) combined[i] = binary.charCodeAt(i);

        const iv = combined.slice(0, 12);
        const data = combined.slice(12);

        const decrypted = await crypto.subtle.decrypt({ name: "AES-GCM", iv: iv }, e2eeKey, data);
        const dec = new TextDecoder();
        return dec.decode(decrypted);
    } catch (e) {
        // Eski veya şifrelenmemiş metin gelmiş olabilir, doğrudan geri döndür
        return base64text;
    }
}

async function initialize() {
    // Temayı Yükle
    const savedTheme = localStorage.getItem('dc_login_theme') || 'space';
    document.documentElement.setAttribute('data-theme', savedTheme);

    // AI/Güvenlik Check
    if (!state.nickname || !state.roomKey || !state.authKey || !state.roomPassword) {
        if (window.electronAPI && window.electronAPI.navigateToLogin) {
            window.electronAPI.navigateToLogin();
        } else {
            window.location.href = 'login.html';
        }
        return;
    }

    // E2EE Anahtarını Türet
    try {
        e2eeKey = await deriveE2EEKey(state.roomPassword);
    } catch (err) {
        console.error("E2EE Başlatılamadı:", err);
        showToast(window.i18n ? window.i18n.t('security_fail') : "Güvenlik sistemi başlatılamadı!", "error");
    }

    // UI'da Odayı yaz
    el.roomNameDisplay.textContent = state.roomKey;

    connectSocket();
    setupEventListeners();
    setupWindowControls();

    if ("Notification" in window && Notification.permission !== "denied" && Notification.permission !== "granted") {
        Notification.requestPermission();
    }
}

function connectSocket() {
    if (state.socket) state.socket.disconnect();

    updateStatus(window.i18n ? window.i18n.t('connecting') : 'Bağlanıyor...', 'connecting');

    // Socket.IO kütüphanesi yüklenmiş mi kontrol et
    if (typeof io === 'undefined') {
        updateStatus(window.i18n ? window.i18n.t('socketio_fail') : 'Socket.IO kütüphanesi yüklenemedi!', 'reconnecting');
        console.error('[HATA] Socket.IO kütüphanesi bulunamadı. io tanımsız.');
        showToast(window.i18n ? window.i18n.t('socketio_fail') : 'Socket.IO yüklenemedi.', 'error');
        return;
    }

    console.log('[Bağlantı] Sunucuya bağlanılıyor:', state.serverUrl);

    // Temiz URL: Sondaki slashları kaldır (Socket.io namespace hatasını önlemek için)
    let cleanUrl = state.serverUrl.replace(/\/+$/, "");
    // URL host check
    const isLocalhostHost = state.serverUrl.includes('localhost') || state.serverUrl.includes('127.0.0.1');

    // Socket Ayarları
    state.socket = io(cleanUrl, {
        reconnectionDelayMax: 5000,
        transports: ['websocket', 'polling'], // Prefer websocket for better tunnel performance
        upgrade: true,
        extraHeaders: {
            "Bypass-Tunnel-Reminder": "true"
        }
    });

    state.socket.on('connect', () => {
        console.log('[Bağlantı] Sunucuya bağlandı! Socket ID:', state.socket.id);
        updateStatus('', 'connected');

        // Odaya Gir
        state.socket.emit('join-room', {
            userId: state.userId,
            nickname: state.nickname,
            roomKey: state.roomKey,
            avatarColor: state.avatarColor,
            profilePic: state.profilePic,
            authKey: state.authKey,
            mode: state.joinMode
        });
    });

    // Odaya Giriş Hatası
    state.socket.on('join-error', (errMsg) => {
        localStorage.setItem('dc_login_error', "Odaya Bağlanılamadı: " + errMsg);
        if (window.electronAPI && window.electronAPI.navigateToLogin) {
            window.electronAPI.navigateToLogin();
        } else {
            window.location.href = 'login.html';
        }
    });

    // Bağlantı hatası
    state.socket.on('connect_error', (err) => {
        console.error('[HATA] Sunucuya bağlanılamadı:', err.message);
        updateStatus((window.i18n ? window.i18n.t('conn_failed') : 'Bağlantı hatası!') + ' ' + err.message, 'reconnecting');
        showToast((window.i18n ? window.i18n.t('conn_failed') : 'Bağlantı Hatası') + ': ' + err.message, 'error');
    });


    state.socket.on('disconnect', () => {
        updateStatus(window.i18n ? window.i18n.t('conn_lost') : 'Bağlantı koptu. Yeniden deneniyor...', 'reconnecting');
    });

    // Odaya birisi girdiğinde (notification)
    state.socket.on('user-joined', (data) => {
        showToast(data.msg, 'success');
    });

    // Odadan biri çıktığında
    state.socket.on('user-left', (data) => {
        showToast(data.msg, 'info');
    });

    // Odadakilerin listesi güncellendiğinde
    state.socket.on('online-users', (users) => {
        state.users = users;
        el.headerOnlineText.textContent = `${users.length} ${window.i18n ? window.i18n.t('online_count') : 'Çevrimiçi'}`;
        renderUsersModal();
    });

    // Başka bir kullanıcı ismini değiştirdiğinde ekrandaki mesajları güncelle
    state.socket.on('username-changed', ({ oldUsername, newUsername }) => {
        document.querySelectorAll('.message-username').forEach(usernameEl => {
            if (usernameEl.textContent === oldUsername) {
                usernameEl.textContent = newUsername;
            }
        });
    });

    // Sunucu yöneticisi mevcut odayı silerse
    state.socket.on('room-deleted', (data) => {
        let displayMessage = data.message;
        if (window.i18n) {
            if (displayMessage.includes('Bu oda sunucu yöneticisi tarafından')) {
                displayMessage = window.i18n.t('msg_room_deleted_single');
            } else if (displayMessage.includes('Tüm odalar')) {
                displayMessage = window.i18n.t('msg_room_deleted_all');
            }
        }

        if (window.showConfirmModal) {
            window.showConfirmModal(displayMessage, () => {
                window.location.href = 'login.html';
            }, true);
        } else {
            alert(displayMessage);
            window.location.href = 'login.html';
        }
    });

    // Yeni mesaj geldiğinde
    state.socket.on('new-message', async (msg) => {
        if (el.emptyState) el.emptyState.style.display = 'none';

        // Gelen mesajı Şifresini Çözerek Yükle
        msg.content = await decryptMessage(msg.content);
        if (msg.reply_content) {
            msg.reply_content = await decryptMessage(msg.reply_content);
        }

        appendMessage(msg);
        scrollToBottom();

        // Kendi mesajımız değilse ve pencere aktif değilse bildirim sesi çal
        if (msg.username !== state.nickname) {
            // Sadece pencere arka plandayken veya odak dışındayken bildirim gelsin
            const isWindowFocused = document.hasFocus() && !document.hidden;

            if (!isWindowFocused) {
                // Ses çal
                try {
                    const audio = new Audio('assets/notification.mp3');
                    audio.play().catch(() => { });
                } catch (e) { }

                // Masaüstü Bildirimi
                if ("Notification" in window && Notification.permission === "granted") {
                    const notify = new Notification(`Haven: @${msg.username}`, {
                        body: msg.content,
                        icon: '../../assets/icon.png',
                        silent: true // Sesi biz üstte çaldık
                    });

                    activeNotifications.add(notify);
                    notify.onclose = () => activeNotifications.delete(notify);

                    notify.onclick = () => {
                        if (window.electronAPI && window.electronAPI.focusWindow) {
                            window.electronAPI.focusWindow();
                        } else {
                            window.focus();
                        }
                    };
                }
            }
        }
    });

    // ===== YAZIYOR GÖSTERGESİ =====
    const typingUsers = new Map();
    const typingIndicator = document.getElementById('typing-indicator');
    const typingText = document.getElementById('typing-text');

    function updateTypingDisplay() {
        const names = Array.from(typingUsers.values());
        if (names.length === 0) {
            if (typingIndicator) typingIndicator.style.display = 'none';
        } else {
            if (typingIndicator) typingIndicator.style.display = 'flex';
            if (typingText) {
                if (names.length === 1) {
                    typingText.textContent = `${names[0]} ${window.i18n ? window.i18n.t('typing_one') : 'yazıyor...'}`;
                } else if (names.length === 2) {
                    typingText.textContent = `${names[0]} & ${names[1]} ${window.i18n ? window.i18n.t('typing_two') : 'yazıyor...'}`;
                } else {
                    typingText.textContent = `${names.length} ${window.i18n ? window.i18n.t('typing_many') : 'kişi yazıyor...'}`;
                }
            }
        }
    }

    const typingTimeouts = new Map();

    state.socket.on('user-typing', ({ username, isTyping }) => {
        // Varolan timeout'u temizle
        if (typingTimeouts.has(username)) {
            clearTimeout(typingTimeouts.get(username));
            typingTimeouts.delete(username);
        }

        if (isTyping) {
            typingUsers.set(username, username);
            // 3 saniye sinyal gelmezse otomatik temizle
            const tid = setTimeout(() => {
                typingUsers.delete(username);
                typingTimeouts.delete(username);
                updateTypingDisplay();
            }, 3000);
            typingTimeouts.set(username, tid);
        } else {
            typingUsers.delete(username);
        }
        updateTypingDisplay();
    });

    // Mesaj silindiğinde
    state.socket.on('message-deleted', (messageId) => {
        // Önce: gruplanmış satır mı? (msg-row-wrapper ya da data-message-id'li element)
        const rowWrapper = document.querySelector(`.msg-row-wrapper[data-message-id="${messageId}"]`);
        if (rowWrapper) {
            // Üst message-group'u bul
            const parentGroup = rowWrapper.closest('.message-group');
            rowWrapper.remove();

            // Eğer parent group'ta artık hiç mesaj satırı kalmadıysa, grubu da sil
            if (parentGroup) {
                const remainingRows = parentGroup.querySelectorAll('.msg-row-wrapper');
                if (remainingRows.length === 0) {
                    parentGroup.remove();
                }
            }
        } else {
            // Sonra: bağımsız mesaj grubu mu?
            const msgGroup = document.querySelector(`.message-group[data-message-id="${messageId}"]`);
            if (msgGroup) {
                msgGroup.remove();
            }
        }

        // Yetim tarih ayırıcılarını temizle
        // Her tarih ayırıcısından sonra bir mesaj grubu olmalı, yoksa ayırıcı da silinmeli
        cleanupOrphanedSeparators();

        // Tüm mesajlar silindiyse empty state'i göster
        const remainingMessages = el.chatMessages.querySelectorAll('.message-group');
        if (remainingMessages.length === 0) {
            // grouping state'ini sıfırla
            state.lastMessageUserId = null;
            state.lastMessageTime = null;
            state.lastMessageDateString = null;

            // Kalan tüm separatörleri temizle
            el.chatMessages.innerHTML = '';
            el.chatMessages.appendChild(el.emptyState);
            el.emptyState.style.display = 'flex';
        }
    });

    // Yetim tarih ayırıcılarını temizleyen yardımcı fonksiyon
    function cleanupOrphanedSeparators() {
        const children = Array.from(el.chatMessages.children);
        for (let i = children.length - 1; i >= 0; i--) {
            const child = children[i];
            // Tarih ayırıcıları message-group class'ına sahip değil ve empty-state de değil
            if (!child.classList.contains('message-group') && child.id !== 'empty-state') {
                // Sonraki kardeşe bak — bir message-group olmalı
                const nextSibling = child.nextElementSibling;
                if (!nextSibling || !nextSibling.classList.contains('message-group')) {
                    child.remove();
                }
            }
        }
    }

    // Tepki güncellendi (sunucudan)
    state.socket.on('message-reaction-update', ({ messageId, reactions }) => {
        // Satır içi wrapper'a ait reaction-bar
        const rowWrapper = el.chatMessages.querySelector(`.msg-row-wrapper[data-message-id="${messageId}"]`);
        if (rowWrapper) {
            let reactBar = rowWrapper.querySelector('.reaction-bar');
            if (!reactBar) {
                reactBar = document.createElement('div');
                reactBar.className = 'reaction-bar';
                rowWrapper.appendChild(reactBar);
            }
            reactBar.innerHTML = buildReactionsHtml(messageId, reactions);
            return;
        }
        // Ana mesaj grubuna ait reaction-bar
        const msgGroup = el.chatMessages.querySelector(`.message-group[data-message-id="${messageId}"]`);
        if (!msgGroup) return;
        let reactBar = msgGroup.querySelector('.reaction-bar');
        if (!reactBar) {
            reactBar = document.createElement('div');
            reactBar.className = 'reaction-bar';
            const contentDiv = msgGroup.querySelector('.message-content');
            if (contentDiv) contentDiv.appendChild(reactBar);
        }
        reactBar.innerHTML = buildReactionsHtml(messageId, reactions);
    });

    // Mesaj geçmişi
    state.socket.on('room-history', async (messages) => {
        el.chatMessages.innerHTML = '';
        state.lastMessageUserId = null;
        state.lastMessageTime = null;
        state.lastMessageDateString = null;

        if (messages.length > 0) {
            // Paralel şifre çözme işlemi
            for (let msg of messages) {
                msg.content = await decryptMessage(msg.content);
                if (msg.reply_content) {
                    msg.reply_content = await decryptMessage(msg.reply_content);
                }
            }

            messages.forEach(msg => appendMessage({
                id: msg.id,
                roomId: msg.room_key,
                username: msg.username,
                content: msg.content,
                avatarColor: msg.avatar_color,
                profile_pic: msg.profile_pic,
                type: msg.type,
                reply_to: msg.reply_to,
                reply_username: msg.reply_username,
                reply_content: msg.reply_content,
                reactions: msg.reactions || '{}',
                created_at: msg.created_at
            }));
            scrollToBottom();
        } else {
            el.chatMessages.appendChild(el.emptyState);
            el.emptyState.style.display = 'flex';
        }
    });

    // ============================================
    // WEBRTC SIGNALING DİNLEYİCİLERİ
    // ============================================

    // Odayı çaldırma sinyali (Biri arıyor)
    state.socket.on('room-is-ringing', (data) => {
        if (voiceState.isInVoice) return; // Zaten sesteysek umurumuzda değil

        // Modal aç
        const initial = data.callerName[0].toUpperCase();
        el.incomingAvatar.textContent = initial;
        el.incomingAvatar.style.backgroundColor = data.avatarColor || '#6366f1';
        el.incomingName.textContent = `${data.callerName} ${window.i18n ? window.i18n.t('calling') : 'Arıyor...'}`;

        el.modalIncomingCall.classList.add('visible');
        playRingtone();
    });

    state.socket.on('voice-call-declined', (data) => {
        if (data && data.username) {
            showToast(`${data.username} ${window.i18n ? window.i18n.t('call_rejected') : 'aramayı reddetti!'}`, 'error');
            stopRingtone();
        }
    });

    // Arama cevaplandığında çalma sesini ve modalı kapat
    state.socket.on('call-answered', () => {
        stopRingtone();
        el.modalIncomingCall.classList.remove('visible');
    });

    // Arayan kişi çıktığında (arama iptal) çalma sesini ve modalı kapat
    state.socket.on('call-cancelled', () => {
        stopRingtone();
        el.modalIncomingCall.classList.remove('visible');
        showToast(window.i18n ? window.i18n.t('call_cancelled') : 'Arama iptal edildi.', 'info');
    });

    // Aktif sesli kanal kullanıcı listesi güncellendiğinde
    state.socket.on('active-voice-users', (voiceUsers) => {
        updateActiveCallBanner(voiceUsers);
    });

    state.socket.on('voice-join', async (data) => {
        if (!voiceState.isInVoice) return; // Biz seste değilsek umursama

        console.log(`[Ses] ${data.username} sese katıldı. Bağlantı başlatılıyor...`);
        createMediaElement(data.userId, data.username, data.avatarColor, false, null, data.profilePic);
        await createPeerConnection(data.userId, true);
    });

    state.socket.on('voice-leave', (data) => {
        console.log(`[Ses] ${data.username} sesten ayrıldı.`);
        removePeerConnection(data.userId);
    });

    state.socket.on('webrtc-offer', async ({ senderId, senderName, offer }) => {
        if (!voiceState.isInVoice) return;

        console.log(`[Ses] Gelen Arama (Offer): ${senderName}`);

        let pc = voiceState.peers[senderId];
        if (!pc) {
            // İlk kez bağlanıyorsa elementi oluştur
            const peer = state.users.find(u => u.id === senderId);
            createMediaElement(senderId, senderName, peer?.avatarColor || '#6366f1', false, null, peer?.profilePic || null);
            pc = await createPeerConnection(senderId, false);
        }

        // WebRTC Perfect Negotiation (Çakışma Önleyici)
        const offerCollision = pc.makingOffer || pc.signalingState !== "stable";
        pc.ignoreOffer = !pc.isPolite && offerCollision;

        if (pc.ignoreOffer) {
            console.log(`[Ses] Çakışma önlendi (Offer ignored from ${senderName})`);
            return;
        }

        try {
            await pc.setRemoteDescription(new RTCSessionDescription(offer));
            const answer = await pc.createAnswer();
            await pc.setLocalDescription(answer);
            state.socket.emit('webrtc-answer', { targetId: senderId, answer: pc.localDescription });
        } catch (err) {
            console.error("Offer kabul Hatası:", err);
        }
    });

    state.socket.on('webrtc-answer', async ({ senderId, answer }) => {
        if (!voiceState.isInVoice) return;
        const pc = voiceState.peers[senderId];
        if (pc) {
            try {
                await pc.setRemoteDescription(new RTCSessionDescription(answer));
            } catch (err) {
                console.error("Answer kabul Hatası:", err);
            }
        }
    });

    state.socket.on('webrtc-candidate', async ({ senderId, candidate }) => {
        if (!voiceState.isInVoice) return;

        const pc = voiceState.peers[senderId];
        if (pc) {
            try {
                await pc.addIceCandidate(new RTCIceCandidate(candidate));
            } catch (e) {
                if (!pc.ignoreOffer) {
                    console.error("ICE Hatası:", e);
                }
            }
        }
    });

    // Diğer kullanıcıların ekran paylaşımı durumunu dinle
    state.socket.on('screen-share-state', ({ userId, username, isSharing }) => {
        console.log(`[Ekran] ${username} ekran paylaşımı: ${isSharing ? 'başladı' : 'bitti'}`);
        updateScreenShareBadge(userId, isSharing);
    });

    // ============================================
    // WEBRTC P2P DOSYA SİNYALLERİ (SENDER & RECEIVER)
    // ============================================

    state.socket.on('p2p-file-offer', async ({ senderId, senderName, offer, fileMeta }) => {
        const file = window.pendingP2PFiles ? window.pendingP2PFiles[fileMeta.fileId] : null;
        if (!file) {
            console.error("İstenen dosya bulunamadı:", fileMeta.fileId);
            return;
        }

        const pc = new RTCPeerConnection(rtcConfig);
        window.p2pConnections = window.p2pConnections || {};
        window.p2pConnections[fileMeta.fileId + "_" + senderId] = pc;

        pc.ondatachannel = (e) => {
            const dc = e.channel;
            dc.binaryType = 'arraybuffer';
            dc.onopen = async () => {
                // Sender UI Update
                const pBox = document.getElementById(`p2p-progress-sender-${fileMeta.fileId}`);
                if (pBox) pBox.style.display = 'block';
                const bar = document.getElementById(`p2p-bar-sender-${fileMeta.fileId}`);
                const txt = document.getElementById(`p2p-text-sender-${fileMeta.fileId}`);

                const chunkSize = 65536; // 64KB
                let offset = 0;
                // Buffer management based on bufferedAmountLowThreshold
                dc.bufferedAmountLowThreshold = 1024 * 512; // 512 KB

                const readSlice = (o) => file.slice(o, o + chunkSize).arrayBuffer();

                while (offset < file.size) {
                    if (dc.bufferedAmount > dc.bufferedAmountLowThreshold) {
                        await new Promise(r => {
                            const listener = () => {
                                dc.removeEventListener('bufferedamountlow', listener);
                                r();
                            };
                            dc.addEventListener('bufferedamountlow', listener);
                        });
                    }
                    if (dc.readyState !== 'open') break;

                    const chunk = await readSlice(offset);
                    dc.send(chunk);
                    offset += chunk.byteLength;

                    const percent = ((offset / file.size) * 100).toFixed(1);
                    if (bar) bar.style.width = percent + '%';
                    if (txt) txt.textContent = escapeHtml(senderName) + ' %' + percent + ' indirdi';
                }

                if (dc.readyState === 'open') {
                    dc.send(JSON.stringify({ type: 'EOF' }));
                    if (txt) txt.textContent = window.i18n ? window.i18n.t('send_complete') : 'Gönderim Tamamlandı';
                    const loadingBox = document.getElementById(`p2p-loading-box-${fileMeta.fileId}`);
                    if (loadingBox) {
                        loadingBox.innerHTML = '<span style="color:var(--accent-success);font-weight:bold;">✓</span><span style="color:var(--accent-success);">Gönderim Tamamlandı</span>';
                        loadingBox.style.background = 'rgba(72,187,120,0.1)';
                    }
                }
            };
        };

        pc.onicecandidate = e => {
            if (e.candidate) {
                state.socket.emit('p2p-file-candidate', { targetId: senderId, candidate: e.candidate, fileId: fileMeta.fileId });
            }
        };

        await pc.setRemoteDescription(new RTCSessionDescription(offer));
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);

        state.socket.emit('p2p-file-answer', { targetId: senderId, answer, fileId: fileMeta.fileId });
    });

    state.socket.on('p2p-file-answer', async ({ senderId, answer, fileId }) => {
        window.p2pConnections = window.p2pConnections || {};
        const pc = window.p2pConnections[fileId];
        if (pc) {
            try {
                await pc.setRemoteDescription(new RTCSessionDescription(answer));
            } catch (e) { console.error(e); }
        }
    });

    state.socket.on('p2p-file-candidate', async ({ senderId, candidate, fileId }) => {
        window.p2pConnections = window.p2pConnections || {};
        // RECEIVER key = fileId
        // SENDER key = fileId + "_" + senderId
        const pc = window.p2pConnections[fileId] || window.p2pConnections[fileId + "_" + senderId];
        if (pc) {
            try {
                await pc.addIceCandidate(new RTCIceCandidate(candidate));
            } catch (e) { console.error(e); }
        }
    });
}

function updateStatus(text, type) {
    el.connStatus.textContent = text;
    el.connStatus.className = `connection-status ${type}`;
    if (type === 'connected') {
        setTimeout(() => el.connStatus.className = 'connection-status', 2000);
    }
}

// Aktif arama bannerını güncelle
function updateActiveCallBanner(voiceUsers) {
    if (!el.activeCallBanner) return;

    // Eğer biz zaten sesteyiz veya kimse yoksa bannerı gizle
    if (voiceState.isInVoice || !voiceUsers || voiceUsers.length === 0) {
        el.activeCallBanner.style.display = 'none';
        return;
    }

    // Bannerı göster
    el.activeCallBanner.style.display = 'flex';

    // Katılımcı chip’lerini oluştur
    el.activeCallParticipants.innerHTML = voiceUsers.map(user => {
        const color = user.avatarColor || '#6366f1';
        return `<span class="active-call-participant-chip">
            <span class="active-call-participant-dot" style="background:${color}"></span>
            ${escapeHtml(user.username)}
        </span>`;
    }).join('');
}

// ============================================
// P2P SINIRSIZ DOSYA TRANSFER BAŞLATMA
// ============================================
window.startP2PDownload = async (fileId, targetId, filename, size, isAuto = false) => {
    const btn = document.getElementById(`p2p-btn-${fileId}`);
    if (btn) btn.style.display = 'none';

    const progressDiv = document.getElementById(`p2p-progress-receiver-${fileId}`);
    if (progressDiv) progressDiv.style.display = 'block';

    const pc = new RTCPeerConnection(rtcConfig);
    const dc = pc.createDataChannel('fileTransfer');

    let receivedBuffers = [];
    let receivedSize = 0;
    let isPaused = false;
    let isCancelled = false;

    // Duraklat / Devam düğmesi
    const pauseBtn = document.getElementById(`p2p-pause-${fileId}`);
    const cancelBtn = document.getElementById(`p2p-cancel-${fileId}`);

    if (pauseBtn) {
        pauseBtn.onclick = () => {
            isPaused = !isPaused;
            pauseBtn.textContent = isPaused ? (window.i18n ? window.i18n.t('resume') : '▶ Devam') : (window.i18n ? window.i18n.t('pause') : '⏸ Duraklat');
            pauseBtn.style.borderColor = isPaused ? 'var(--accent-success)' : 'var(--accent-info)';
            pauseBtn.style.color = isPaused ? 'var(--accent-success)' : 'var(--accent-info)';
        };
    }

    if (cancelBtn) {
        cancelBtn.onclick = () => {
            isCancelled = true;
            dc.close();
            pc.close();
            if (progressDiv) progressDiv.innerHTML = '<div style="color:var(--accent-danger);font-size:12px;text-align:center;padding:4px 0;">❌ İndirme iptal edildi</div>';
        };
    }

    dc.onmessage = async (e) => {
        if (isCancelled) return;

        while (isPaused) {
            await new Promise(r => setTimeout(r, 200));
            if (isCancelled) return;
        }

        if (typeof e.data === 'string') {
            try {
                const msg = JSON.parse(e.data);
                if (msg.type === 'EOF') {
                    const blob = new Blob(receivedBuffers);
                    receivedBuffers = []; // free memory
                    const blobUrl = URL.createObjectURL(blob);

                    if (isAuto) {
                        // Eğer otomatik görsel önizlemesi ise kutuyu resimle değiştir
                        const imgBox = document.getElementById(`p2p-img-box-${fileId}`);
                        if (imgBox) {
                            imgBox.innerHTML = `<img src="${blobUrl}" style="max-width:300px; width:100%; border-radius:8px; display:block; cursor:zoom-in;" onclick="window.previewMedia(this.src, 'image')" alt="${escapeHtml(filename)}">`;
                        }
                    } else {
                        const textEl = document.getElementById(`p2p-text-receiver-${fileId}`);
                        if (textEl) textEl.textContent = window.i18n ? window.i18n.t('download_complete') : '✅ Tamamlandı!';
                        if (pauseBtn) { pauseBtn.style.display = 'none'; }
                        if (cancelBtn) { cancelBtn.style.display = 'none'; }
                        const a = document.createElement('a');
                        a.href = blobUrl;
                        a.download = filename;
                        a.click();
                        // URL.revokeObjectURL(a.href); // Don't revoke immediately in case they click multiple times?
                    }
                }
            } catch (ex) { }
        } else { // ArrayBuffer
            receivedBuffers.push(e.data);
            receivedSize += e.data.byteLength;
            const percent = ((receivedSize / size) * 100).toFixed(1);
            if (!isAuto) {
                const barEl = document.getElementById(`p2p-bar-receiver-${fileId}`);
                const textEl = document.getElementById(`p2p-text-receiver-${fileId}`);
                if (barEl) barEl.style.width = percent + '%';
                if (textEl) textEl.textContent = percent + '%  (' + (receivedSize / 1024 / 1024).toFixed(1) + ' MB / ' + (size / 1024 / 1024).toFixed(1) + ' MB)';
            } else {
                const autoText = document.getElementById(`p2p-auto-text-${fileId}`);
                if (autoText) autoText.textContent = `%${percent} ${window.i18n ? window.i18n.t('loading_image') : 'Görsel Yükleniyor...'}`;
            }
        }
    };

    pc.onicecandidate = e => {
        if (e.candidate) {
            state.socket.emit('p2p-file-candidate', { targetId, candidate: e.candidate, fileId });
        }
    };

    window.p2pConnections = window.p2pConnections || {};
    window.p2pConnections[fileId] = pc;

    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);

    state.socket.emit('p2p-file-offer', { targetId, offer, fileMeta: { fileId } });
};
function formatDiscordDate(dateParam) {
    const d = new Date(dateParam);
    const now = new Date();

    const lang = (window.i18n && window.i18n.currentLang) ? window.i18n.currentLang : 'tr';
    const locale = (lang === 'en') ? 'en-US' : 'tr-TR';
    const timeStr = d.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' });

    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);
    const targetDate = new Date(d.getFullYear(), d.getMonth(), d.getDate());

    if (targetDate.getTime() === today.getTime()) {
        return `${window.i18n ? window.i18n.t('date_today') : 'bugün'} ${timeStr}`;
    } else if (targetDate.getTime() === yesterday.getTime()) {
        return `${window.i18n ? window.i18n.t('date_yesterday') : 'dün'} ${timeStr}`;
    } else {
        const dateStr = d.toLocaleDateString(locale, { day: '2-digit', month: '2-digit', year: 'numeric' });
        return `${dateStr} ${timeStr}`;
    }
}

function formatDateSeparator(dateParam) {
    const d = new Date(dateParam);
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const targetDate = new Date(d.getFullYear(), d.getMonth(), d.getDate());

    const lang = (window.i18n && window.i18n.currentLang) ? window.i18n.currentLang : 'tr';
    const locale = (lang === 'en') ? 'en-US' : 'tr-TR';

    if (targetDate.getTime() === today.getTime()) {
        const text = window.i18n ? window.i18n.t('date_today') : 'Bugün';
        return `<span data-lang-key="date_today">${text}</span>`;
    }
    return d.toLocaleDateString(locale, { day: 'numeric', month: 'long', year: 'numeric' });
}

function appendMessage(msg) {
    const msgDate = new Date(msg.created_at || new Date());

    // Separatör karşılaştırması için locale'den bağımsız olarak string yapalım veya hep aynı locale kullanalım (ör: en-CA yyyy-mm-dd)
    const msgDateString = msgDate.getFullYear() + "-" + msgDate.getMonth() + "-" + msgDate.getDate();

    // Tarih Separatör Kontrolü
    if (state.lastMessageDateString !== msgDateString) {
        const separatorHtml = `
          <div style="display: flex; align-items: center; text-align: center; margin: 24px 16px 8px 16px; user-select:none;">
              <div style="flex: 1; height: 1px; background: rgba(255,255,255,0.06);"></div>
              <span style="padding: 0 12px; color: var(--text-muted); font-size: 11px; font-weight: 700; text-transform:uppercase; letter-spacing:0.5px;">
                  ${formatDateSeparator(msgDate)}
              </span>
              <div style="flex: 1; height: 1px; background: rgba(255,255,255,0.06);"></div>
          </div>
        `;
        el.chatMessages.insertAdjacentHTML('beforeend', separatorHtml);
        state.lastMessageDateString = msgDateString;
        state.lastMessageUserId = null; // Yeni güne geçildiğinde avatarı zorla göster
        state.lastMessageTime = null;
    }

    // Aynı kullanıcı VE son mesajdan 5 dakikadan az geçtiyse grupla
    const msgTime = msgDate.getTime();
    const timeDiff = state.lastMessageTime ? (msgTime - state.lastMessageTime) : Infinity;
    const isSameUser = state.lastMessageUserId === msg.username && timeDiff < 5 * 60 * 1000;
    state.lastMessageUserId = msg.username;
    state.lastMessageTime = msgTime;

    const messageEl = document.createElement('div');
    messageEl.className = `message-group ${isSameUser ? 'continuation' : ''}`;

    // Mesaj tarihi formatter'ı
    const timeStr = formatDiscordDate(msgDate);
    const initial = msg.username ? msg.username[0].toUpperCase() : '?';

    const isMine = msg.username === state.nickname || (state.userId && msg.user_id === state.userId);

    // XSS Koruması — linkify sadece düz metin mesajlarda çalışsın, dosya mesajlarında işleme yapma
    let safeContent = (msg.type === 'file' || msg.type === 'p2p-announce')
        ? escapeHtml(msg.content)
        : linkify(escapeHtml(msg.content)).replace(/\n/g, '<br>');


    if (msg.type === 'p2p-announce') {
        try {
            const fileObj = JSON.parse(msg.content);
            const fileSizeMB = (fileObj.size / 1024 / 1024).toFixed(2);
            const isImage = fileObj.mimetype && fileObj.mimetype.startsWith('image/');
            const ext = (fileObj.filename || '').split('.').pop().toLowerCase();
            const fileIcon = ['zip', 'rar', '7z', 'tar', 'gz'].includes(ext) ? '🗜️'
                : ['mp4', 'mov', 'avi', 'mkv', 'webm'].includes(ext) ? '🎬'
                    : ['mp3', 'flac', 'wav', 'ogg', 'aac'].includes(ext) ? '🎵'
                        : ['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg'].includes(ext) ? '🖼️'
                            : ['pdf'].includes(ext) ? '📕'
                                : ['doc', 'docx'].includes(ext) ? '📝'
                                    : ['xls', 'xlsx'].includes(ext) ? '📊'
                                        : '📦';

            if (isMine) {
                if (isImage && window.pendingP2PFiles && window.pendingP2PFiles[fileObj.fileId]) {
                    const localUrl = URL.createObjectURL(window.pendingP2PFiles[fileObj.fileId]);
                    safeContent = `<img src="${localUrl}" style="max-width:300px; width:100%; border-radius:8px; display:block; cursor:zoom-in;" onclick="window.previewMedia(this.src, 'image')" alt="${escapeHtml(fileObj.filename)}">`;
                } else {
                    safeContent = `<div class="p2p-file-box" style="border:1px solid rgba(99,179,237,0.25);border-radius:12px;background:linear-gradient(135deg,rgba(49,130,206,0.1),rgba(99,102,241,0.08));padding:12px;backdrop-filter:blur(6px);max-width:300px;white-space:normal;display:inline-block;margin-top:4px;"><div style="display:flex;align-items:center;gap:8px;margin-bottom:8px;"><span style="font-size:20px;">${fileIcon}</span><div style="flex:1;min-width:0;"><div style="font-size:13px;font-weight:700;color:var(--text-primary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${escapeHtml(fileObj.filename)}</div><div style="font-size:11px;color:var(--text-muted);">${fileSizeMB} MB · P2P Transfer</div></div><span style="font-size:9px;font-weight:800;padding:2px 6px;border-radius:4px;background:rgba(99,179,237,0.15);color:#63b3ed;border:1px solid rgba(99,179,237,0.3);text-transform:uppercase;">Paylaşan</span></div><div id="p2p-loading-box-${fileObj.fileId}" style="font-size:11px;color:var(--text-muted);background:rgba(0,0,0,0.25);border-radius:8px;padding:8px 10px;display:flex;align-items:center;gap:8px;line-height:1.3;"><span>⏳</span><span>Yükleniyor... Lütfen sekmeyi kapatmayın.</span></div><div id="p2p-progress-sender-${fileObj.fileId}" style="margin-top:8px;display:none;"><div style="height:6px;background:rgba(255,255,255,0.1);border-radius:3px;overflow:hidden;"><div id="p2p-bar-sender-${fileObj.fileId}" style="width:0%;height:100%;background:linear-gradient(90deg,#4299e1,#667eea);transition:width 0.2s;border-radius:3px;"></div></div><div id="p2p-text-sender-${fileObj.fileId}" style="text-align:right;font-size:10px;margin-top:4px;color:var(--text-muted);font-weight:600;">Hazırlanıyor...</div></div></div>`;
                }
            } else {
                if (isImage) {
                    safeContent = `<div id="p2p-img-box-${fileObj.fileId}" class="p2p-image-preview-loading" style="border:1px solid rgba(255,255,255,0.08); border-radius:12px; background:rgba(255,255,255,0.03); padding:20px; text-align:center; max-width:260px; margin-top:4px;"><div class="loading-spinner-small" style="margin:0 auto 10px; border:2px solid rgba(255,255,255,0.1); border-top-color:var(--accent-primary); border-radius:50%; width:20px; height:20px; animation:spin 1s linear infinite;"></div><div id="p2p-auto-text-${fileObj.fileId}" style="font-size:11px; color:var(--text-muted); font-weight:600;">Görsel Hazırlanıyor...</div></div>`;
                    setTimeout(() => {
                        window.startP2PDownload(fileObj.fileId, fileObj.senderId, fileObj.filename, Number(fileObj.size), true);
                    }, 100);
                } else {
                    safeContent = `<div class="p2p-file-box" style="border:1px solid rgba(72,187,120,0.25);border-radius:12px;background:linear-gradient(135deg,rgba(56,161,105,0.08),rgba(99,102,241,0.06));padding:12px;backdrop-filter:blur(6px);max-width:300px;white-space:normal;display:inline-block;margin-top:4px;"><div style="display:flex;align-items:center;gap:8px;margin-bottom:8px;"><span style="font-size:20px;">${fileIcon}</span><div style="flex:1;min-width:0;"><div style="font-size:13px;font-weight:700;color:var(--text-primary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${escapeHtml(fileObj.filename)}</div><div style="font-size:11px;color:var(--text-muted);">${fileSizeMB} MB · Güvenli P2P</div></div><span style="font-size:9px;font-weight:800;padding:2px 6px;border-radius:4px;background:rgba(72,187,120,0.15);color:#68d391;border:1px solid rgba(72,187,120,0.3);text-transform:uppercase;">Gelen</span></div><button id="p2p-btn-${fileObj.fileId}" data-file-id="${fileObj.fileId}" data-sender-id="${fileObj.senderId}" data-filename="${escapeHtml(fileObj.filename)}" data-size="${fileObj.size}" onclick="(function(btn){window.startP2PDownload(btn.dataset.fileId, btn.dataset.senderId, btn.dataset.filename, Number(btn.dataset.size));})(this)" style="display:flex;align-items:center;justify-content:center;gap:8px;width:100%;height:36px;background:linear-gradient(135deg,#38a169,#48bb78);border:none;border-radius:8px;color:white;font-size:13px;font-weight:700;cursor:pointer;box-shadow:0 4px 12px rgba(56,161,105,0.25);transition:all 0.2s;" onmouseenter="this.style.transform='translateY(-1px)';this.style.boxShadow='0 6px 15px rgba(56,161,105,0.3)';" onmouseleave="this.style.transform='translateY(0)';this.style.boxShadow='0 4px 12px rgba(56,161,105,0.25)';"><svg width="14" height="14" fill="none" stroke="currentColor" stroke-width="3" viewBox="0 0 24 24"><path d="M12 5v14M5 12l7 7 7-7"/></svg>İndir</button><div id="p2p-progress-receiver-${fileObj.fileId}" style="display:none;margin-top:10px;"><div style="height:6px;background:rgba(255,255,255,0.1);border-radius:3px;overflow:hidden;margin-bottom:8px;"><div id="p2p-bar-receiver-${fileObj.fileId}" style="width:0%;height:100%;background:linear-gradient(90deg, #38a169, #68d391);transition:width 0.2s;border-radius:3px;"></div></div><div style="display:flex;align-items:center;justify-content:space-between;gap:8px;"><div id="p2p-text-receiver-${fileObj.fileId}" style="font-size:10px;color:var(--text-muted);flex:1;font-weight:600;">Bağlanılıyor...</div><div style="display:flex;gap:4px;"><button id="p2p-pause-${fileObj.fileId}" style="padding:4px 8px;border-radius:6px;background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.1);color:var(--text-primary);font-size:10px;font-weight:700;cursor:pointer;">⏸</button><button id="p2p-cancel-${fileObj.fileId}" style="padding:4px 8px;border-radius:6px;background:rgba(239,68,68,0.1);border:1px solid rgba(239,68,68,0.2);color:#ef4444;font-size:10px;font-weight:700;cursor:pointer;">✕</button></div></div></div></div>`;
                }
            }
        } catch (e) { }
    } else if (msg.type === 'file') {
        try {
            const fileObj = JSON.parse(msg.content);
            const serverPath = state.serverUrl.endsWith('/') ? state.serverUrl.slice(0, -1) : state.serverUrl;
            const safeUrl = escapeHtml(fileObj.url);

            if (fileObj.mimetype && fileObj.mimetype.startsWith('image/')) {
                safeContent = `<img src="${serverPath}${safeUrl}" style="max-width:300px; width:100%; border-radius:8px; display:block; cursor:zoom-in;" onclick="window.previewMedia(this.src, 'image')" alt="${escapeHtml(fileObj.filename)}">`;
            } else if (fileObj.mimetype && fileObj.mimetype.startsWith('video/')) {
                safeContent = `<video src="${serverPath}${safeUrl}" style="max-width:300px; width:100%; border-radius:8px; display:block; cursor:zoom-in;" onclick="window.previewMedia(this.src, 'video')" controls></video>`;
            } else if (fileObj.mimetype && fileObj.mimetype.startsWith('audio/')) {
                // Tema uyumlu minimalist ses oynatıcı
                const audioId = 'voice-' + (msg.id || Date.now() + '-' + Math.floor(Math.random() * 1000));

                safeContent = `<div class="voice-message-player" data-audio-src="${serverPath}${safeUrl}" data-audio-id="${audioId}"><button class="voice-msg-play-btn" onclick="window.toggleVoiceMsg('${audioId}', '${serverPath}${safeUrl}')" title="Oynat/Duraklat"><svg id="${audioId}-icon" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z"></path><path d="M19 10v2a7 7 0 0 1-14 0v-2"></path><line x1="12" y1="19" x2="12" y2="22"></line></svg></button><div class="voice-msg-waveform-bar" onclick="window.seekVoiceMsg(event, '${audioId}')"><canvas id="${audioId}-waveform" width="160" height="28"></canvas></div></div>`;
            } else {
                safeContent = `📎 <a href="${serverPath}${safeUrl}" target="_blank" style="color:var(--accent-primary);">${escapeHtml(fileObj.filename)}</a>`;
            }
        } catch (e) {
            // Hatalı JSON ise düz metin olarak kalsın
        }
    }

    // Hover toolbar (sağ taraf) - JS ile ekleniyor, actionsHtml artık kullanılmıyor
    const actionsHtml = '';

    // Yanıt Gösterimi
    // Yanıt Gösterimi
    let replyHtml = '';
    if (msg.reply_to && msg.reply_username) {
        replyHtml = `<div class="msg-reply-preview" onclick="document.querySelector('[data-message-id=\\'${msg.reply_to}\\']')?.scrollIntoView({behavior: 'smooth'})" style="font-size: 11px; padding: 4px 10px; margin-bottom: 6px; background: rgba(255,255,255,0.04); border-left: 3px solid var(--accent-primary); border-radius: 4px; cursor: pointer; color: var(--text-muted); display:inline-flex; align-items:center; gap:6px; max-width:100%;"><strong style="color:var(--text-primary);white-space:nowrap;">${escapeHtml(msg.reply_username)}</strong><span style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${escapeHtml(msg.reply_content).slice(0, 50)}${msg.reply_content && msg.reply_content.length > 50 ? '...' : ''}</span></div>`;
    }

    messageEl.dataset.messageId = msg.id;

    if (isSameUser && !msg.reply_to) {
        // --- MEVCUT BALONA YENİ SATIR EKLE ---
        const lastGroup = el.chatMessages.querySelector('.message-group:last-of-type');
        if (lastGroup) {
            const contentDiv = lastGroup.querySelector('.message-content');
            if (contentDiv) {
                // Her satır için kapsayıcı wrapper
                const rowDiv = document.createElement('div');
                rowDiv.className = 'msg-row-wrapper';
                rowDiv.dataset.messageId = msg.id;
                rowDiv.style.cssText = 'position:relative; display:block;';

                // Mesaj metni
                const newTextDiv = document.createElement('div');
                newTextDiv.className = 'message-text';
                newTextDiv.dataset.messageId = msg.id;
                newTextDiv.innerHTML = safeContent;
                rowDiv.appendChild(newTextDiv);

                // Her satıra ait tepki çubuğu
                const rowReactBar = document.createElement('div');
                rowReactBar.className = 'reaction-bar';
                rowReactBar.dataset.reactionFor = msg.id;
                rowReactBar.innerHTML = buildReactionsHtml(msg.id, msg.reactions || '{}');
                rowDiv.appendChild(rowReactBar);

                // Hover araç çubuğu — tüm satırlarda (hem kendi hem başkasının)
                const hoverToolbar = document.createElement('div');
                hoverToolbar.className = 'row-hover-toolbar';
                hoverToolbar.style.cssText = 'position:absolute; right:0; top:0; align-items:center; gap:4px; background:var(--bg-dark); border:1px solid var(--border-medium); border-radius:8px; padding:2px 6px;';

                // Yanıtla butonu
                const replyBtn = document.createElement('button');
                replyBtn.innerHTML = '↩️';
                replyBtn.title = 'Yanıtla';
                replyBtn.style.cssText = 'background:none;border:none;cursor:pointer;font-size:14px;padding:1px 3px;';
                replyBtn.onclick = () => window.initiateReply(msg.id, msg.username, msg.content);
                hoverToolbar.appendChild(replyBtn);

                // Emoji kısayolları
                ['👍', '❤️', '💀', '🔥'].forEach(em => {
                    const eBtn = document.createElement('button');
                    eBtn.textContent = em;
                    eBtn.style.cssText = 'background:none;border:none;cursor:pointer;font-size:14px;padding:1px 2px;';
                    eBtn.title = em;
                    eBtn.onclick = () => window.sendReaction(msg.id, em);
                    hoverToolbar.appendChild(eBtn);
                });

                // Sil butonu (sadece kendi mesajıysa)
                if (isMine) {
                    const delBtn = document.createElement('button');
                    delBtn.innerHTML = '🗑️';
                    delBtn.title = 'Sil';
                    delBtn.style.cssText = 'background:none;border:none;cursor:pointer;font-size:12px;color:var(--accent-danger);padding:1px 4px;';
                    delBtn.onclick = () => window.deleteMessage(msg.id, msg.roomId);
                    hoverToolbar.appendChild(delBtn);
                }

                rowDiv.appendChild(hoverToolbar);
                contentDiv.appendChild(rowDiv);

                // Sesli mesaj dalga formlarını çiz
                rowDiv.querySelectorAll('.voice-message-player').forEach(player => {
                    const audioId = player.dataset.audioId;
                    if (audioId) setTimeout(() => drawStaticWaveform(audioId, 0), 0);
                });

                scrollToBottom();
                return;
            }
        }
    }

    // --- Yeni Kullanıcı veya yanıtlı mesaj → yeni balon ---
    messageEl.className = 'message-group';

    const avatarStyle = msg.profile_pic ? `background-image: url('${msg.profile_pic}'); background-size: cover; background-position: center; color: transparent;` : `background-color: ${msg.avatarColor || '#6366f1'}`;

    messageEl.innerHTML = `<div class="message-avatar" style="${avatarStyle}">${msg.profile_pic ? '' : initial}</div><div class="message-content"><div class="message-header"><div><span class="message-username" style="color: ${msg.avatarColor || '#5865F2'}">${escapeHtml(msg.username)}</span><span class="message-timestamp" style="font-size:11px;color:var(--text-muted);margin-left:8px;">${timeStr}</span></div></div>${replyHtml}<div class="msg-row-wrapper" data-message-id="${msg.id}" style="position:relative;display:block;"><div class="message-text" data-message-id="${msg.id}">${safeContent}</div><div class="reaction-bar">${buildReactionsHtml(msg.id, msg.reactions || '{}')}</div></div></div>`;

    el.chatMessages.appendChild(messageEl);

    // İlk mesaj satırına hover toolbar ekle (sağ tarafta görünür, devam satırlarına benzer şekilde)
    const firstRowWrapper = messageEl.querySelector('.msg-row-wrapper');
    if (firstRowWrapper) {
        const hoverToolbar = document.createElement('div');
        hoverToolbar.className = 'row-hover-toolbar';
        hoverToolbar.style.cssText = 'position:absolute; right:0; top:0; align-items:center; gap:4px; background:var(--bg-dark); border:1px solid var(--border-medium); border-radius:8px; padding:2px 6px; z-index:10;';

        // Yanıtla butonu
        const replyBtn = document.createElement('button');
        replyBtn.innerHTML = '↩️';
        replyBtn.title = 'Yanıtla';
        replyBtn.style.cssText = 'background:none;border:none;cursor:pointer;font-size:14px;padding:1px 3px;';
        replyBtn.onclick = () => window.initiateReply(msg.id, msg.username, msg.content);
        hoverToolbar.appendChild(replyBtn);

        // Emoji kısayolları
        ['👍', '❤️', '💀', '🔥'].forEach(em => {
            const eBtn = document.createElement('button');
            eBtn.textContent = em;
            eBtn.style.cssText = 'background:none;border:none;cursor:pointer;font-size:14px;padding:1px 2px;';
            eBtn.title = em;
            eBtn.onclick = () => window.sendReaction(msg.id, em);
            hoverToolbar.appendChild(eBtn);
        });

        // Sil butonu (sadece kendi mesajıysa)
        if (isMine) {
            const delBtn = document.createElement('button');
            delBtn.innerHTML = '🗑️';
            delBtn.title = 'Sil';
            delBtn.style.cssText = 'background:none;border:none;cursor:pointer;font-size:12px;color:var(--accent-danger);padding:1px 4px;';
            delBtn.onclick = () => window.deleteMessage(msg.id, msg.roomId);
            hoverToolbar.appendChild(delBtn);
        }

        firstRowWrapper.appendChild(hoverToolbar);
    }

    // Sesli mesaj dalga formlarını hemen çiz
    messageEl.querySelectorAll('.voice-message-player').forEach(player => {
        const audioId = player.dataset.audioId;
        if (audioId) {
            setTimeout(() => drawStaticWaveform(audioId, 0), 0);
        }
    });

    // Resimlere sağ tıkla kopyalama/kaydetme menüsü
    messageEl.querySelectorAll('.message-text img').forEach(img => {
        img.addEventListener('contextmenu', (e) => {
            e.preventDefault();
            // Mevcut menüyü kaldır
            document.querySelectorAll('.img-context-menu').forEach(m => m.remove());

            const menu = document.createElement('div');
            menu.className = 'img-context-menu';
            menu.style.cssText = `position:fixed;left:${e.clientX}px;top:${e.clientY}px;z-index:9999;background:var(--bg-medium);border:1px solid var(--border-medium);border-radius:8px;padding:4px 0;box-shadow:0 8px 24px rgba(0,0,0,0.4);min-width:160px;`;

            const btnCopy = document.createElement('button');
            btnCopy.textContent = window.i18n ? window.i18n.t('copy_image') : '📋 Resmi Kopyala';
            btnCopy.style.cssText = 'display:block; width:100%; text-align:left; padding:8px 14px; background:none; border:none; color:var(--text-primary); cursor:pointer; font-size:13px;';
            btnCopy.onmouseenter = () => btnCopy.style.background = 'rgba(255,255,255,0.06)';
            btnCopy.onmouseleave = () => btnCopy.style.background = 'none';
            btnCopy.onclick = async () => {
                menu.remove();
                try {
                    const response = await fetch(img.src);
                    const blob = await response.blob();
                    await navigator.clipboard.write([new ClipboardItem({ [blob.type]: blob })]);
                    showToast(window.i18n ? window.i18n.t('image_copied') : 'Resim panoya kopyalandı!', 'success');
                } catch (err) {
                    showToast(window.i18n ? window.i18n.t('image_copy_fail') : 'Resim kopyalanamadı!', 'error');
                }
            };

            const btnSave = document.createElement('button');
            btnSave.textContent = window.i18n ? window.i18n.t('save_image') : '💾 Resmi Kaydet';
            btnSave.style.cssText = 'display:block; width:100%; text-align:left; padding:8px 14px; background:none; border:none; color:var(--text-primary); cursor:pointer; font-size:13px;';
            btnSave.onmouseenter = () => btnSave.style.background = 'rgba(255,255,255,0.06)';
            btnSave.onmouseleave = () => btnSave.style.background = 'none';
            btnSave.onclick = () => {
                menu.remove();
                const a = document.createElement('a');
                a.href = img.src;
                a.download = img.alt || 'resim';
                a.click();
            };

            menu.appendChild(btnCopy);
            menu.appendChild(btnSave);
            document.body.appendChild(menu);

            // Menü dışına tıklayınca kapat
            setTimeout(() => {
                document.addEventListener('click', function closeMenu() {
                    menu.remove();
                    document.removeEventListener('click', closeMenu);
                }, { once: true });
            }, 10);
        });
    });

    // Küçük bir gecikme ile tekrar scroll yap (DOM'un kendini çizmesini bekle)
    setTimeout(() => {
        scrollToBottom();
    }, 10);
}

function scrollToBottom() {
    el.chatMessages.scrollTop = el.chatMessages.scrollHeight;
}

function setupEventListeners() {
    // Mesaj Gönderme
    el.btnSend.addEventListener('click', sendMessage);
    el.messageInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            sendMessage();
            // Mesaj gönderilince typing durumu kapat
            if (state.socket) state.socket.emit('typing', { isTyping: false });
            clearTimeout(state._typingTimeout);
            state._isTyping = false;
        }
    });

    // Yazıyor göstergesi gönder - her 1.5 saniyede tekrar sinyal gönder
    el.messageInput.addEventListener('input', () => {
        if (!state.socket) return;
        const now = Date.now();
        // Her 1.5 saniyede bir typing:true gönder (sürekli yazdığı sürece)
        if (!state._lastTypingEmit || now - state._lastTypingEmit > 1500) {
            state._lastTypingEmit = now;
            state.socket.emit('typing', { isTyping: true });
        }
        // 1 saniye yazmazsa typing:false gönder
        clearTimeout(state._typingTimeout);
        state._typingTimeout = setTimeout(() => {
            state._lastTypingEmit = 0;
            state.socket.emit('typing', { isTyping: false });
        }, 1000);
    });

    // Dosya Ekleme
    el.btnAttachFile?.addEventListener('click', () => {
        el.fileInput?.click();
    });

    el.fileInput?.addEventListener('change', async (e) => {
        const file = e.target.files[0];
        if (file) {
            // Eğer görsel ise WhatsApp tarzı önizlemeye yolla
            if (file.type.startsWith('image/')) {
                window.addPendingImage(file);
            } else {
                // Diğer dosyalar için direkt P2P baslat
                await window.sendP2PFile(file);
            }
            e.target.value = '';
        }
    });

    window.sendP2PFile = async (file) => {
        if (!file) return;

        window.pendingP2PFiles = window.pendingP2PFiles || {};
        const fileId = 'file_' + Date.now() + '_' + Math.floor(Math.random() * 10000);
        window.pendingP2PFiles[fileId] = file;

        const fileMsgContent = JSON.stringify({
            fileId,
            filename: file.name || (file.type.startsWith('image/') ? `image_${Date.now()}.${file.type.split('/')[1]}` : 'clipboard_file'),
            mimetype: file.type || 'application/octet-stream',
            size: file.size,
            senderId: state.socket.id
        });

        // Nesne datasını E2EE ile şifrele
        const encryptedContent = await encryptMessage(fileMsgContent);

        state.socket.emit('send-message', {
            content: encryptedContent,
            type: 'p2p-announce',
            replyTo: state.replyingTo ? state.replyingTo.id : null
        });
        window.cancelReply();
    };


    // Yapıştırma (Ctrl+V) Desteği - Görsel ve URL için
    el.messageInput.addEventListener('paste', async (e) => {
        const clipboardData = (e.clipboardData || window.clipboardData);
        if (!clipboardData) return;

        let handled = false;

        // 1. Dosya/Blob kontrolü (Ekran görüntüsü, kopyalanmış dosya vb.)
        const items = clipboardData.items;
        for (let i = 0; i < items.length; i++) {
            const item = items[i];
            if (item.kind === 'file' && item.type.startsWith('image/')) {
                const blob = item.getAsFile();
                if (blob) {
                    e.preventDefault();
                    handled = true;
                    window.addPendingImage(blob);
                }
            }
        }

        // 2. URL kontrolü (Web'den direkt link kopyalanmışsa)
        if (!handled) {
            const text = clipboardData.getData('text');
            if (text && (text.match(/\.(jpeg|jpg|gif|png|webp|svg)$/i) || text.startsWith('data:image/'))) {
                try {
                    const res = await fetch(text);
                    const blob = await res.blob();
                    if (blob && blob.type.startsWith('image/')) {
                        e.preventDefault();
                        handled = true;
                        window.addPendingImage(blob);
                    }
                } catch (err) {
                    console.log('Paste URL image fetch bypass.');
                }
            }
        }
    });

    // --- WHATSAPP TARZI GÖRSEL ÖNİZLEME MANTIĞI ---
    window.addPendingImage = (blob) => {
        state.pendingImages.push(blob);
        state.currentPreviewIndex = state.pendingImages.length - 1;
        state.viewOnceEnabled = false; // Reset view-once on new images
        openImagePreviewModal();
    };

    window.removePendingImage = (index) => {
        state.pendingImages.splice(index, 1);
        if (state.pendingImages.length === 0) {
            closeImagePreviewModal();
            return;
        }
        if (state.currentPreviewIndex >= state.pendingImages.length) {
            state.currentPreviewIndex = state.pendingImages.length - 1;
        }
        renderImageSendPreview();
    };

    function openImagePreviewModal() {
        const modal = document.getElementById('modal-image-send-preview');
        if (modal) {
            modal.style.display = 'flex';
            renderImageSendPreview();
        }
    }

    function closeImagePreviewModal() {
        const modal = document.getElementById('modal-image-send-preview');
        if (modal) {
            modal.style.display = 'none';
            state.pendingImages = [];
            const captionInput = document.getElementById('preview-caption-input');
            if (captionInput) captionInput.value = '';
        }
    }

    function renderImageSendPreview() {
        const fullImg = document.getElementById('preview-full-image');
        const thumbContainer = document.getElementById('preview-thumbnails');
        const viewOnceBtn = document.getElementById('btn-toggle-view-once');

        if (!fullImg || !thumbContainer) return;

        // Ana Görsel
        const currentBlob = state.pendingImages[state.currentPreviewIndex];
        const url = URL.createObjectURL(currentBlob);
        fullImg.src = url;
        fullImg.onload = () => URL.revokeObjectURL(url);

        // View Once Durumu (UI)
        if (viewOnceBtn) {
            viewOnceBtn.classList.toggle('active', state.viewOnceEnabled);
        }

        // Thumbnails
        const addMoreBtn = document.getElementById('btn-preview-add-more');
        thumbContainer.innerHTML = '';
        state.pendingImages.forEach((blob, idx) => {
            const tUrl = URL.createObjectURL(blob);
            const thumb = document.createElement('div');
            thumb.className = `thumb-item ${idx === state.currentPreviewIndex ? 'active' : ''}`;
            thumb.innerHTML = `<img src="${tUrl}" onload="URL.revokeObjectURL('${tUrl}')">`;
            thumb.onclick = () => {
                state.currentPreviewIndex = idx;
                renderImageSendPreview();
            };
            thumbContainer.appendChild(thumb);
        });
        thumbContainer.appendChild(addMoreBtn); // + butonu sona gelsin

        const captionInput = document.getElementById('preview-caption-input');
        if (captionInput) captionInput.focus();
    }

    // Modal Event Listeners
    document.getElementById('btn-close-image-preview')?.addEventListener('click', closeImagePreviewModal);
    document.getElementById('btn-toggle-view-once')?.addEventListener('click', () => {
        state.viewOnceEnabled = !state.viewOnceEnabled;
        document.getElementById('btn-toggle-view-once')?.classList.toggle('active', state.viewOnceEnabled);
    });

    document.getElementById('btn-preview-add-more')?.addEventListener('click', () => {
        el.fileInput?.click();
    });

    document.getElementById('btn-send-from-preview')?.addEventListener('click', () => {
        sendMessageFromPreview();
    });

    // Preview modalında Enter basınca gönder
    document.getElementById('preview-caption-input')?.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            sendMessageFromPreview();
        }
    });

    async function sendMessageFromPreview() {
        const captionInput = document.getElementById('preview-caption-input');
        const caption = captionInput?.value.trim();
        const hasImages = state.pendingImages.length > 0;

        if (hasImages) {
            // Görselleri artık P2P yerine SUNUCUYA yüklüyoruz (Sayfa yenileyince kaybolmaması için)
            for (const blob of state.pendingImages) {
                try {
                    // Dosya adı yoksa oluştur
                    const filename = (blob.name && blob.name !== 'image.png') ? blob.name : `image_${Date.now()}.jpg`;
                    const file = new File([blob], filename, { type: blob.type });

                    await window.uploadFileToChat(file);
                } catch (err) {
                    console.error("Görsel yükleme hatası:", err);
                    showToast(window.i18n ? window.i18n.t('image_send_fail') : "Görsel gönderilemedi!", "error");
                }
            }
        }

        if (caption) {
            const encryptedContent = await encryptMessage(caption);
            state.socket.emit('send-message', {
                content: encryptedContent,
                type: 'message',
                replyTo: state.replyingTo ? state.replyingTo.id : null
            });
        }

        closeImagePreviewModal();
    }

    // --- SUNUCUYA DOSYA YÜKLEME MANTIĞI ---
    window.uploadFileToChat = async (file) => {
        if (!file) return;

        const formData = new FormData();
        formData.append('file', file);

        // İlerleme çubuğunu göster
        const progressContainer = document.getElementById('upload-progress-container');
        const progressBar = document.getElementById('upload-progress-bar');
        const filenameLabel = document.getElementById('upload-filename');
        const percentageLabel = document.getElementById('upload-percentage');

        if (progressContainer) {
            progressContainer.style.display = 'block';
            filenameLabel.textContent = file.name;
            progressBar.style.width = '0%';
            percentageLabel.textContent = '0%';
        }

        return new Promise((resolve, reject) => {
            const xhr = new XMLHttpRequest();
            const uploadUrl = state.serverUrl.endsWith('/') ? `${state.serverUrl}api/upload` : `${state.serverUrl}/api/upload`;

            xhr.open('POST', uploadUrl, true);

            xhr.upload.onprogress = (e) => {
                if (e.lengthComputable) {
                    const percent = Math.round((e.loaded / e.total) * 100);
                    if (progressBar) progressBar.style.width = percent + '%';
                    if (percentageLabel) percentageLabel.textContent = percent + '%';
                }
            };

            xhr.onload = async () => {
                if (progressContainer) progressContainer.style.display = 'none';

                if (xhr.status === 200) {
                    const res = JSON.parse(xhr.responseText);
                    if (res.success) {
                        // Dosya bilgilerini E2EE ile şifrele (İçerik sunucuda açık ama mesaj şifreli)
                        const fileData = JSON.stringify({
                            url: res.url,
                            filename: res.filename,
                            mimetype: res.mimetype,
                            size: file.size
                        });

                        const encryptedContent = await encryptMessage(fileData);

                        state.socket.emit('send-message', {
                            content: encryptedContent,
                            type: 'file',
                            replyTo: state.replyingTo ? state.replyingTo.id : null
                        });
                        resolve(res);
                    } else {
                        showToast(res.message || (window.i18n ? window.i18n.t('upload_fail') : 'Yükleme başarısız!'), 'error');
                        reject(new Error(res.message));
                    }
                } else {
                    showToast(window.i18n ? window.i18n.t('server_error') : 'Sunucu hatası!', 'error');
                    reject(new Error('Server error'));
                }
            };

            xhr.onerror = () => {
                if (progressContainer) progressContainer.style.display = 'none';
                showToast(window.i18n ? window.i18n.t('conn_failed') : 'Bağlantı hatası!', 'error');
                reject(new Error('Network error'));
            };

            xhr.send(formData);
        });
    };

    // Özel Onay Modalı Gösterme Fonksiyonu
    window.showConfirmModal = function (message, onConfirm) {
        const modal = document.getElementById('custom-confirm-modal');
        const msgEl = document.getElementById('custom-confirm-message');
        const btnCancel = document.getElementById('btn-custom-confirm-cancel');
        const btnOk = document.getElementById('btn-custom-confirm-ok');

        if (!modal || !btnCancel || !btnOk) {
            if (confirm(message)) onConfirm();
            return;
        }

        msgEl.textContent = message;
        modal.style.display = 'flex';
        setTimeout(() => modal.style.opacity = '1', 10);

        const closeHandler = () => {
            modal.style.opacity = '0';
            setTimeout(() => modal.style.display = 'none', 200);
            btnCancel.removeEventListener('click', closeHandler);
            btnOk.removeEventListener('click', okHandler);
        };

        const okHandler = () => {
            closeHandler();
            onConfirm();
        };

        btnCancel.addEventListener('click', closeHandler);
        btnOk.addEventListener('click', okHandler);
    };

    // Oturum Kapatma (Login ekranına dön)
    el.btnLogout.addEventListener('click', () => {
        window.showConfirmModal(window.i18n ? window.i18n.t('msg_leave_room') : 'Gizli odadan çıkmak istediğinize emin misiniz?', () => {
            localStorage.removeItem('dc_nickname');
            localStorage.removeItem('dc_room');
            localStorage.removeItem('dc_auth_key');
            localStorage.removeItem('dc_room_password');
            if (window.electronAPI && window.electronAPI.navigateToLogin) {
                window.electronAPI.navigateToLogin();
            } else {
                window.location.href = 'login.html';
            }
        });
    });

    const mobileBtnLogout = document.getElementById('mobile-btn-logout');
    if (mobileBtnLogout) {
        mobileBtnLogout.addEventListener('click', () => {
            document.getElementById('mobile-dropdown-menu').style.display = 'none';
            el.btnLogout.click();
        });
    }

    // Kişiler Modalı Açma
    el.headerUserCount.addEventListener('click', () => {
        el.modalUsers.classList.add('visible');
    });

    // Kişiler Modalı Kapatma
    el.btnCloseUsersModal.addEventListener('click', () => {
        el.modalUsers.classList.remove('visible');
    });

    // Chat Ayarları Modalı
    if (el.btnChatSettings && el.chatSettingsModal) {
        // Renk paleti oluşturma
        const colors = ['#6366f1', '#ef4444', '#10b981', '#f59e0b', '#0ea5e9', '#ec4899', '#8b5cf6', '#14b8a6', '#000000'];
        colors.forEach(color => {
            const btn = document.createElement('div');
            btn.dataset.color = color;
            btn.style.width = '24px';
            btn.style.height = '24px';
            btn.style.borderRadius = '50%';
            btn.style.backgroundColor = color;
            btn.style.cursor = 'pointer';
            btn.style.border = color === state.avatarColor ? '2px solid white' : '2px solid transparent';
            btn.style.boxShadow = color === state.avatarColor ? `0 0 10px ${color}80` : 'none';
            btn.style.transition = '0.2s';

            btn.onclick = () => {
                Array.from(el.chatColorPickerContainer.children).forEach(c => {
                    c.style.border = '2px solid transparent';
                    c.style.boxShadow = 'none';
                });
                btn.style.border = '2px solid white';
                btn.style.boxShadow = `0 0 10px ${color}80`;
                el.chatAvatarColorInput.value = color;
                if (el.chatColorPreviewText) {
                    el.chatColorPreviewText.style.color = color;
                }
            };
            el.chatColorPickerContainer.appendChild(btn);
        });

        // ===== SEKME GEÇİŞ MANTIĞI =====
        let micTestStream = null;
        let micTestAnimFrame = null;

        const settingsTabs = document.querySelectorAll('.settings-tab');
        const settingsPanels = document.querySelectorAll('.settings-panel');

        settingsTabs.forEach(tab => {
            tab.addEventListener('click', () => {
                // Aktif sekmeyi güncelle
                settingsTabs.forEach(t => {
                    t.classList.remove('active');
                    t.style.removeProperty('background');
                    t.style.removeProperty('color');
                });
                tab.classList.add('active');

                // İlgili paneli göster
                const tabName = tab.dataset.tab;
                settingsPanels.forEach(p => p.style.display = 'none');
                const panel = document.getElementById(`panel-${tabName}`);
                if (panel) panel.style.display = 'block';

                // Ses sekmesine geçince cihazları yükle
                if (tabName === 'ses') {
                    loadAudioDevices();
                }

                // Admin sekmesine geçildiğinde odaları yükle
                if (tabName === 'admin') {
                    loadAdminRooms();
                }

                // Ses sekmesinden çıkınca mikrofon testini durdur
                if (tabName !== 'ses') {
                    stopMicTest();
                }
            });
        });

        // ===== SES AYGITI LİSTELEME =====
        async function loadAudioDevices() {
            try {
                let devices = await navigator.mediaDevices.enumerateDevices();
                const needsPermission = devices.some(d => d.kind === 'audioinput' && d.label === '');

                if (needsPermission) {
                    const tempStream = await navigator.mediaDevices.getUserMedia({ audio: true });
                    tempStream.getTracks().forEach(t => t.stop());
                    devices = await navigator.mediaDevices.enumerateDevices();
                }

                const micSelect = document.getElementById('settings-mic-select');
                const speakerSelect = document.getElementById('settings-speaker-select');

                if (micSelect) {
                    micSelect.innerHTML = '';
                    const audioInputs = devices.filter(d => d.kind === 'audioinput');
                    if (audioInputs.length === 0) {
                        micSelect.innerHTML = '<option value="">Mikrofon bulunamadı</option>';
                    } else {
                        audioInputs.forEach((device, i) => {
                            const opt = document.createElement('option');
                            opt.value = device.deviceId;
                            opt.textContent = device.label || `Mikrofon ${i + 1} `;
                            micSelect.appendChild(opt);
                        });
                    }
                    // Kayıtlı cihazı seç
                    const savedMic = localStorage.getItem('dc_mic_device');
                    if (savedMic) micSelect.value = savedMic;
                }

                if (speakerSelect) {
                    speakerSelect.innerHTML = '';
                    const audioOutputs = devices.filter(d => d.kind === 'audiooutput');
                    if (audioOutputs.length === 0) {
                        speakerSelect.innerHTML = '<option value="">Hoparlör bulunamadı</option>';
                    } else {
                        audioOutputs.forEach((device, i) => {
                            const opt = document.createElement('option');
                            opt.value = device.deviceId;
                            opt.textContent = device.label || `Hoparlör ${i + 1} `;
                            speakerSelect.appendChild(opt);
                        });
                    }
                    const savedSpeaker = localStorage.getItem('dc_speaker_device');
                    if (savedSpeaker) speakerSelect.value = savedSpeaker;
                }
            } catch (err) {
                console.error('Ses cihazları yüklenemedi:', err);
                const micSelect = document.getElementById('settings-mic-select');
                if (micSelect) micSelect.innerHTML = '<option value="">Erişim reddedildi</option>';
            }
        }

        // ===== MİKROFON TESTİ =====
        function stopMicTest() {
            if (micTestStream) {
                micTestStream.getTracks().forEach(t => t.stop());
                micTestStream = null;
            }
            if (micTestAnimFrame) {
                cancelAnimationFrame(micTestAnimFrame);
                micTestAnimFrame = null;
            }
            const container = document.getElementById('mic-level-container');
            const bar = document.getElementById('mic-level-bar');
            if (container) container.style.display = 'none';
            if (bar) bar.style.width = '0%';

            const btn = document.getElementById('btn-test-mic');
            if (btn) btn.textContent = window.i18n ? window.i18n.t('btn_test_mic') : '🎙️ Mikrofonu Test Et';
        }

        const btnTestMic = document.getElementById('btn-test-mic');
        if (btnTestMic) {
            btnTestMic.addEventListener('click', async () => {
                // Zaten test ediyorsak durdur
                if (micTestStream) {
                    stopMicTest();
                    return;
                }

                const micSelect = document.getElementById('settings-mic-select');
                const deviceId = micSelect?.value || undefined;

                try {
                    const constraints = { audio: deviceId ? { deviceId: { exact: deviceId } } : true };
                    micTestStream = await navigator.mediaDevices.getUserMedia(constraints);

                    btnTestMic.textContent = window.i18n ? window.i18n.t('btn_stop_test') : '⏹️ Testi Durdur';
                    const container = document.getElementById('mic-level-container');
                    const bar = document.getElementById('mic-level-bar');
                    if (container) container.style.display = 'block';

                    const testCtx = new (window.AudioContext || window.webkitAudioContext)();
                    const source = testCtx.createMediaStreamSource(micTestStream);
                    const analyser = testCtx.createAnalyser();
                    analyser.fftSize = 256;
                    analyser.smoothingTimeConstant = 0.5;
                    source.connect(analyser);
                    const dataArray = new Uint8Array(analyser.frequencyBinCount);

                    function updateBar() {
                        analyser.getByteFrequencyData(dataArray);
                        let sum = 0;
                        for (let i = 0; i < dataArray.length; i++) sum += dataArray[i];
                        const avg = sum / dataArray.length;
                        const percent = Math.min(100, (avg / 50) * 100);
                        if (bar) bar.style.width = percent + '%';
                        micTestAnimFrame = requestAnimationFrame(updateBar);
                    }
                    updateBar();
                } catch (err) {
                    showToast((window.i18n ? window.i18n.t('mic_access_fail') : 'Mikrofon erişilemedi') + ': ' + err.message, 'error');
                }
            });
        }

        // ===== HOPARLÖR TESTİ =====
        const btnTestSpeaker = document.getElementById('btn-test-speaker');
        if (btnTestSpeaker) {
            btnTestSpeaker.addEventListener('click', () => {
                const speakerSelect = document.getElementById('settings-speaker-select');
                const testAudio = new Audio('assets/notification.mp3');

                if (speakerSelect?.value && typeof testAudio.setSinkId === 'function') {
                    testAudio.setSinkId(speakerSelect.value).then(() => {
                        testAudio.play();
                    }).catch(e => {
                        console.warn('setSinkId hatası:', e);
                        testAudio.play();
                    });
                } else {
                    testAudio.play();
                }
                showToast(window.i18n ? window.i18n.t('test_sound') : 'Test sesi çalınıyor...', 'info');
            });
        }

        // ===== AYARLAR MODALINI AÇMA =====
        el.btnChatSettings.addEventListener('click', () => {
            // Mevcut ayarları forma doldur
            el.chatUsernameInput.value = state.nickname || '';
            el.chatAvatarColorInput.value = state.avatarColor || '#6366f1';
            el.chatColorPreviewText.textContent = state.nickname || (window.i18n ? window.i18n.t('sample_user') : 'Örnek Kullanıcı');
            el.chatColorPreviewText.style.color = state.avatarColor || '#6366f1';

            if (el.chatColorPickerContainer) {
                const currentColor = state.avatarColor || '#6366f1';
                Array.from(el.chatColorPickerContainer.children).forEach(c => {
                    if (c.dataset.color === currentColor) {
                        c.style.border = '2px solid white';
                        c.style.boxShadow = `0 0 10px ${c.dataset.color}80`;
                    } else {
                        c.style.border = '2px solid transparent';
                        c.style.boxShadow = 'none';
                    }
                });
            }

            if (el.chatThemeSelector) {
                el.chatThemeSelector.value = localStorage.getItem('dc_login_theme') || 'space';
            }

            if (el.chatLangSelect) {
                el.chatLangSelect.value = localStorage.getItem('dc_app_lang') || 'tr';
            }

            if (state.profilePic) {
                el.chatAvatarPreviewImg.src = state.profilePic;
                el.chatAvatarPreviewImg.style.display = 'block';
                el.chatAvatarUploadIcon.style.display = 'none';
            } else {
                el.chatAvatarPreviewImg.style.display = 'none';
                el.chatAvatarUploadIcon.style.display = 'block';
            }

            // İlk sekmeyi aktif yap
            settingsTabs.forEach(t => {
                t.classList.remove('active');
                t.style.removeProperty('background');
                t.style.removeProperty('color');
            });
            settingsPanels.forEach(p => p.style.display = 'none');
            const firstTab = document.querySelector('.settings-tab[data-tab="profil"]');
            const firstPanel = document.getElementById('panel-profil');
            if (firstTab) { firstTab.classList.add('active'); }
            if (firstPanel) firstPanel.style.display = 'block';

            el.chatSettingsModal.style.display = 'flex';
            setTimeout(() => el.chatSettingsModal.style.opacity = '1', 10);
        });

        // Takma ad değiştiğinde preview yazısını güncelle
        el.chatUsernameInput.addEventListener('input', (e) => {
            el.chatColorPreviewText.textContent = e.target.value.trim() || (window.i18n ? window.i18n.t('sample_user') : 'Örnek Kullanıcı');
        });

        el.chatAvatarUpload.addEventListener('change', (e) => {
            const file = e.target.files[0];
            if (!file) return;

            const reader = new FileReader();
            reader.onload = function (evt) {
                const img = new Image();
                img.onload = function () {
                    const canvas = document.createElement('canvas');
                    const MAX_WIDTH = 128;
                    const MAX_HEIGHT = 128;
                    let width = img.width;
                    let height = img.height;

                    if (width > height) {
                        if (width > MAX_WIDTH) { height *= MAX_WIDTH / width; width = MAX_WIDTH; }
                    } else {
                        if (height > MAX_HEIGHT) { width *= MAX_HEIGHT / height; height = MAX_HEIGHT; }
                    }
                    canvas.width = width; canvas.height = height;
                    const ctx = canvas.getContext('2d');
                    ctx.drawImage(img, 0, 0, width, height);

                    const dataUrl = canvas.toDataURL('image/jpeg', 0.8);
                    state.profilePic = dataUrl;

                    el.chatAvatarPreviewImg.src = dataUrl;
                    el.chatAvatarPreviewImg.style.display = 'block';
                    el.chatAvatarUploadIcon.style.display = 'none';
                };
                img.src = evt.target.result;
            };
            reader.readAsDataURL(file);
        });

        if (el.chatThemeSelector) {
            el.chatThemeSelector.addEventListener('change', (e) => {
                const selectedTheme = e.target.value;
                document.documentElement.setAttribute('data-theme', selectedTheme);
            });
        }

        if (el.chatLangSelect && window.i18n) {
            el.chatLangSelect.addEventListener('change', (e) => {
                window.i18n.setLanguage(e.target.value);
            });
        }

        const closeChatSettings = () => {
            stopMicTest();
            // Eğer iptal edildiyse veya kapatılırsa, temayı eski haline (kayıtlı olana) döndür
            const savedTheme = localStorage.getItem('dc_login_theme') || 'space';
            document.documentElement.setAttribute('data-theme', savedTheme);
            if (el.chatThemeSelector) el.chatThemeSelector.value = savedTheme;

            // Dili de kayitli olandan dondur eger iptal edildiyse
            const savedLang = localStorage.getItem('dc_app_lang') || 'tr';
            if (window.i18n) window.i18n.setLanguage(savedLang);
            if (el.chatLangSelect) el.chatLangSelect.value = savedLang;

            el.chatSettingsModal.style.opacity = '0';
            setTimeout(() => el.chatSettingsModal.style.display = 'none', 300);
        };

        el.btnCloseChatSettings.addEventListener('click', closeChatSettings);

        el.btnSaveChatSettings.addEventListener('click', () => {
            const oldNickname = state.nickname;
            state.nickname = el.chatUsernameInput.value.trim() || 'Kullanıcı';
            state.avatarColor = el.chatAvatarColorInput.value;

            localStorage.setItem('dc_nickname', state.nickname);
            localStorage.setItem('dc_avatar', state.avatarColor);

            if (state.profilePic) {
                localStorage.setItem('dc_profile_pic', state.profilePic);
            } else {
                localStorage.removeItem('dc_profile_pic');
            }

            if (el.chatThemeSelector) {
                const selectedTheme = el.chatThemeSelector.value;
                document.documentElement.setAttribute('data-theme', selectedTheme);
                localStorage.setItem('dc_login_theme', selectedTheme);
            }

            if (el.chatLangSelect && window.i18n) {
                window.i18n.setLanguage(el.chatLangSelect.value);
            }

            // Ses cihaz tercihlerini kaydet
            const micSelect = document.getElementById('settings-mic-select');
            const speakerSelect = document.getElementById('settings-speaker-select');
            if (micSelect?.value) localStorage.setItem('dc_mic_device', micSelect.value);
            if (speakerSelect?.value) localStorage.setItem('dc_speaker_device', speakerSelect.value);

            // Ekrandaki eski mesajlardaki kullanıcı adlarını ve renklerini anında güncelle
            const nicknameToCheck = oldNickname || state.nickname;
            document.querySelectorAll('.message-group').forEach(groupEl => {
                const usernameEl = groupEl.querySelector('.message-username');
                if (usernameEl && (usernameEl.textContent === nicknameToCheck || usernameEl.textContent === state.nickname)) {
                    usernameEl.textContent = state.nickname;
                    usernameEl.style.color = state.avatarColor;

                    const avatarEl = groupEl.querySelector('.message-avatar');
                    if (avatarEl) {
                        if (state.profilePic) {
                            avatarEl.style.backgroundImage = `url('${state.profilePic}')`;
                            avatarEl.style.backgroundColor = 'transparent';
                            avatarEl.style.color = 'transparent';
                            avatarEl.textContent = '';
                        } else {
                            avatarEl.style.backgroundImage = 'none';
                            avatarEl.style.backgroundColor = state.avatarColor;
                            avatarEl.style.color = 'white';
                            avatarEl.textContent = state.nickname.charAt(0).toUpperCase();
                        }
                    }
                }
            });

            if (state.socket) {
                state.socket.emit('update-profile', {
                    oldNickname: oldNickname,
                    nickname: state.nickname,
                    avatarColor: state.avatarColor,
                    profilePic: state.profilePic
                });
            }

            closeChatSettings();
            showToast(window.i18n ? window.i18n.t('settings_saved') : 'Ayarları kaydettiniz!', 'success');
        });

        el.chatSettingsModal.addEventListener('click', (e) => {
            if (e.target === el.chatSettingsModal) {
                closeChatSettings();
            }
        });
    }

    // Ses İletişimi Butonları
    el.btnJoinVoice?.addEventListener('click', () => {
        initiateVoiceCall(false);
    });
    el.btnJoinVideo?.addEventListener('click', () => {
        initiateVoiceCall(true);
    });
    el.btnLeaveVoice?.addEventListener('click', leaveVoiceRoom);
    el.btnToggleMic?.addEventListener('click', toggleMic);
    el.btnToggleVideo?.addEventListener('click', toggleVideo);
    el.btnToggleScreen?.addEventListener('click', toggleScreen);

    // Sağ Tık Menü Kapatma (Herhangi bir yere tıklandığında)
    document.addEventListener('click', (e) => {
        const userMenu = document.getElementById('user-context-menu');
        const triggerArea = e.target.closest('[oncontextmenu]');
        if (userMenu && !userMenu.contains(e.target) && !triggerArea) {
            userMenu.style.display = 'none';
        }
    });

    // Gelen Arama Modalı Tuşları
    el.btnDeclineCall?.addEventListener('click', () => {
        el.modalIncomingCall.classList.remove('visible');
        stopRingtone();
        if (state.socket) {
            state.socket.emit('voice-call-declined', { username: state.nickname });
        }
    });
    el.btnAcceptCall?.addEventListener('click', () => {
        el.modalIncomingCall.classList.remove('visible');
        stopRingtone();
        joinVoiceRoom(false); // Çağrıya cevap ver, sese gir
        if (el.activeCallBanner) el.activeCallBanner.style.display = 'none';
    });

    // Aktif Arama Banner'ından Katıl butonu
    el.activeCallJoinBtn?.addEventListener('click', () => {
        stopRingtone();
        el.modalIncomingCall.classList.remove('visible');
        joinVoiceRoom(false); // Sese katıl (çaldırmadan)
        if (el.activeCallBanner) el.activeCallBanner.style.display = 'none';
    });

    // Sayfa kapatılırken veya yenilenirken sesi otomatik terk et (Bug fix)
    window.addEventListener('beforeunload', () => {
        if (voiceState.isInVoice) leaveVoiceRoom();
    });
}

async function sendMessage() {
    const rawContent = el.messageInput.value.trim();
    const hasImages = state.pendingImages && state.pendingImages.length > 0;

    if (!rawContent && !hasImages) return;
    if (!state.socket) return;

    const doSend = async () => {
        // Önce görselleri gönder
        if (hasImages) {
            for (const blob of state.pendingImages) {
                // Burada da sunucuya yükle kullanıyoruz (Sayfa yenileme fix)
                const filename = (blob.name && blob.name !== 'image.png') ? blob.name : `image_${Date.now()}.jpg`;
                const file = new File([blob], filename, { type: blob.type });
                await window.uploadFileToChat(file);
            }
            state.pendingImages = [];
            const container = document.getElementById('image-preview-container');
            if (container) {
                container.style.display = 'none';
                container.innerHTML = '';
            }
        }

        // Varsa metni gönder
        if (rawContent) {
            const encryptedContent = await encryptMessage(rawContent);
            state.socket.emit('send-message', {
                content: encryptedContent,
                type: 'message',
                replyTo: state.replyingTo ? state.replyingTo.id : null
            });
        }

        el.messageInput.value = '';
        el.messageInput.style.height = 'auto';
        window.cancelReply();
        setTimeout(() => el.messageInput.focus(), 10);
    };

    if (hasImages) {
        const msgMulti = window.i18n
            ? window.i18n.t('msg_send_multiple_images').replace('{count}', state.pendingImages.length)
            : `${state.pendingImages.length} adet görseli göndermek istediğinize emin misiniz?`;
        window.showConfirmModal(msgMulti, doSend);
    } else {
        await doSend();
    }
}

// Global Yanıt (Reply) Metodları
window.initiateReply = (msgId, username, content) => {
    state.replyingTo = { id: msgId, username, content };
    let previewEl = document.getElementById('reply-preview-box');

    // Eğer preview kutusu DOM'da yoksa chat.html üzerinde oluşturalım
    if (!previewEl) {
        previewEl = document.createElement('div');
        previewEl.id = 'reply-preview-box';
        previewEl.style.display = 'none';
        previewEl.style.alignItems = 'center';
        previewEl.style.justifyContent = 'space-between';
        previewEl.style.background = 'rgba(255, 255, 255, 0.05)';
        previewEl.style.padding = '8px 12px';
        previewEl.style.borderLeft = '3px solid var(--accent-primary)';
        previewEl.style.margin = '0 16px 8px 16px';
        previewEl.style.borderRadius = 'var(--radius-sm)';
        previewEl.style.fontSize = '12px';
        previewEl.style.color = 'var(--text-muted)';

        // input container'ın hemen üstüne ekleyelim
        const inputContainer = document.querySelector('.chat-input-container');
        inputContainer.parentNode.insertBefore(previewEl, inputContainer);
    }

    const maxContent = content.length > 60 ? content.slice(0, 60) + '...' : content;
    previewEl.innerHTML = `
        <div>
            <strong style="color:var(--text-primary); margin-right:6px;">${escapeHtml(username)}</strong> 
            <span>${escapeHtml(maxContent)} ${window.i18n ? window.i18n.t('msg_replying') : 'yanıtlanıyor'}</span>
        </div>
        <button onclick="window.cancelReply()" style="background:none; border:none; color:var(--text-muted); cursor:pointer; font-size:16px;">✕</button>
    `;
    previewEl.style.display = 'flex';

    el.messageInput.focus();
};

window.cancelReply = () => {
    state.replyingTo = null;
    const previewEl = document.getElementById('reply-preview-box');
    if (previewEl) {
        previewEl.style.display = 'none';
    }
};


function renderUsersModal() {
    if (!el.usersModalList) return;
    el.usersModalList.innerHTML = state.users.map(u => {
        const initial = u.username[0].toUpperCase();
        const avatarStyle = u.profilePic ? `background-image: url('${u.profilePic}'); background-size: cover; background-position: center; color: transparent; border: 1px solid rgba(255, 255, 255, 0.1);` : `background-color:${u.avatarColor};`;
        return `
            <div class="user-list-item" style="display:flex; align-items:center; gap:12px; padding:10px; border-bottom:1px solid rgba(255,255,255,0.05);">
                <div class="message-avatar" style="${avatarStyle} width:32px; height:32px; font-size:14px; position:relative; box-shadow:none;">
                    ${u.profilePic ? '' : initial}
                    <div style="position:absolute; bottom:0; right:0; width:10px; height:10px; background-color:var(--accent-success); border-radius:50%; border:2px solid var(--bg-dark);"></div>
                </div>
                <span style="font-weight:600;">${escapeHtml(u.username)} ${u.username === state.nickname ? (window.i18n ? `(${window.i18n.t('you')})` : '(Sen)') : ''}</span>
            </div>`;
    }).join('');
}

function setupWindowControls() {
    if (window.electronAPI) {
        document.getElementById('btn-minimize')?.addEventListener('click', () => window.electronAPI.minimizeWindow());
        document.getElementById('btn-maximize')?.addEventListener('click', () => window.electronAPI.maximizeWindow());
        document.getElementById('btn-close')?.addEventListener('click', () => window.electronAPI.closeWindow());
    } else {
        const titlebar = document.querySelector('.titlebar');
        if (titlebar) {
            titlebar.style.display = 'none'; // Web görünümü (Mobil/Browser için) gizli kalsın
        }
    }
}

function showToast(message, type = 'info') {
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;

    // Icon container based on type
    const iconSpan = document.createElement('span');
    iconSpan.className = 'toast-icon';
    if (type === 'success') {
        iconSpan.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>';
    } else if (type === 'error') {
        iconSpan.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>';
    } else {
        iconSpan.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="16" x2="12" y2="12"></line><line x1="12" y1="8" x2="12.01" y2="8"></line></svg>';
    }

    const contentDiv = document.createElement('div');
    contentDiv.className = 'toast-content';
    contentDiv.textContent = message;

    const closeBtn = document.createElement('span');
    closeBtn.className = 'toast-close';
    closeBtn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>';
    closeBtn.onclick = () => {
        toast.style.animation = 'toastOut 0.3s cubic-bezier(0.175, 0.885, 0.32, 1.275) forwards';
        setTimeout(() => toast.remove(), 300);
    };

    const progressBar = document.createElement('div');
    progressBar.className = 'toast-progress';

    toast.appendChild(iconSpan);
    toast.appendChild(contentDiv);
    toast.appendChild(closeBtn);
    toast.appendChild(progressBar);

    el.toastContainer.appendChild(toast);

    setTimeout(() => {
        if (toast.parentNode) {
            toast.style.animation = 'toastOut 0.3s cubic-bezier(0.175, 0.885, 0.32, 1.275) forwards';
            setTimeout(() => toast.remove(), 300);
        }
    }, 3000);
}

function escapeHtml(str) {
    if (!str) return '';
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}

/**
 * Reaksiyon nesnesinden emoji chip HTML'i oluşturur.
 */
function buildReactionsHtml(messageId, reactionsStr) {
    let obj = {};
    try { if (reactionsStr) obj = JSON.parse(reactionsStr); } catch (e) { }
    const entries = Object.entries(obj).filter(([, users]) => users.length > 0);
    if (entries.length === 0) return '';
    return entries.map(([emoji, users]) => {
        const isMineReaction = users.includes(state.nickname);
        // Tooltip için kullanıcı bilgilerini bul (profil resmi veya baş harf + renk)
        const tooltipAvatars = users.slice(0, 5).map(uname => {
            const userInfo = state.users.find(u => u.username === uname);
            if (userInfo && userInfo.profilePic) {
                return `<img src="${userInfo.profilePic}" alt="${escapeHtml(uname)}" title="${escapeHtml(uname)}" style="width:20px;height:20px;border-radius:50%;border:1.5px solid rgba(255,255,255,0.15);object-fit:cover;flex-shrink:0;">`;
            }
            const color = (userInfo && userInfo.avatarColor) || '#6366f1';
            const initial = uname ? uname[0].toUpperCase() : '?';
            return `<span title="${escapeHtml(uname)}" style="width:20px;height:20px;border-radius:50%;background:${color};display:inline-flex;align-items:center;justify-content:center;font-size:10px;font-weight:700;color:#fff;border:1.5px solid rgba(255,255,255,0.15);flex-shrink:0;">${initial}</span>`;
        }).join('');
        const extraCount = users.length > 5 ? `<span style="font-size:10px;color:var(--text-muted);margin-left:2px;">+${users.length - 5}</span>` : '';
        const tip = users.join(', ');
        // Profil resimleri tooltip içinde küçük tooltip-body div içinde gösterilecek
        const tooltipId = `rtip-${messageId}-${emoji.codePointAt(0)}`;
        return `<span style="position:relative;display:inline-block;margin:2px 2px 0 0;">
  <button class="reaction-chip${isMineReaction ? ' reaction-mine' : ''}" onclick="window.sendReaction(${messageId},'${emoji}')" title="${escapeHtml(tip)}"
    style="display:inline-flex;align-items:center;gap:4px;padding:2px 8px;border-radius:12px;font-size:13px;border:1px solid ${isMineReaction ? 'var(--accent-primary)' : 'rgba(255,255,255,0.12)'};background:${isMineReaction ? 'rgba(99,102,241,0.15)' : 'rgba(255,255,255,0.05)'};cursor:pointer;transition:transform .1s;"
    onmouseenter="this.style.transform='scale(1.1)';var t=document.getElementById('${tooltipId}');if(t)t.style.display='flex';"
    onmouseleave="this.style.transform='scale(1)';var t=document.getElementById('${tooltipId}');if(t)t.style.display='none';"
  >${emoji} <span style="font-size:12px;font-weight:600;color:var(--text-muted)">${users.length}</span></button>
  <div id="${tooltipId}" style="display:none;position:absolute;bottom:calc(100% + 6px);left:50%;transform:translateX(-50%);background:var(--bg-dark,#1a1a2e);border:1px solid rgba(255,255,255,0.12);border-radius:10px;padding:6px 8px;pointer-events:none;z-index:999;flex-direction:column;align-items:center;gap:4px;min-width:80px;box-shadow:0 4px 16px rgba(0,0,0,0.4);">
    <div style="display:flex;align-items:center;gap:3px;flex-wrap:nowrap;">${tooltipAvatars}${extraCount}</div>
    <div style="font-size:10px;color:var(--text-muted);text-align:center;max-width:140px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${escapeHtml(tip)}</div>
  </div>
</span>`;
    }).join('');
}

window.sendReaction = (messageId, emoji) => {
    if (!state.socket) return;
    state.socket.emit('toggle-reaction', { messageId, emoji });
};

/**
 * YouTube video ID'sini URL'den çıkarır. Bulunamazsa null döner.
 */
function extractYouTubeId(url) {
    try {
        const u = new URL(url);
        // youtu.be/VIDEOID
        if (u.hostname === 'youtu.be') return u.pathname.slice(1).split('?')[0];
        // youtube.com/watch?v=VIDEOID
        if (u.hostname.includes('youtube.com')) {
            const v = u.searchParams.get('v');
            if (v) return v;
            // youtube.com/shorts/VIDEOID
            const parts = u.pathname.split('/');
            const shortsIdx = parts.indexOf('shorts');
            if (shortsIdx !== -1) return parts[shortsIdx + 1];
            // youtube.com/embed/VIDEOID
            const embedIdx = parts.indexOf('embed');
            if (embedIdx !== -1) return parts[embedIdx + 1];
        }
    } catch (e) { }
    return null;
}

/**
 * Metin içindeki URL'leri tıklanabilir <a> etiketlerine dönüştürür.
 * YouTube linkleri ayrıca embed player ile gösterilir.
 * escapeHtml() sonrası çağrılmalıdır (XSS güvenliği korunur).
 */
function linkify(text) {
    if (!text) return '';
    const urlRegex = /(https?:\/\/[^\s<>&"']+)/gi;
    return text.replace(urlRegex, function (url) {
        // Sondaki noktalama işaretlerini temizle
        let cleanUrl = url;
        const trailingPunctuation = /[.,;:!?)\]]+$/;
        const trailingMatch = cleanUrl.match(trailingPunctuation);
        let trailing = '';
        if (trailingMatch) {
            trailing = trailingMatch[0];
            cleanUrl = cleanUrl.slice(0, -trailing.length);
        }

        // Electron varsa openExternal ile aç
        const linkHtml = `<a href="${cleanUrl}" target="_blank" rel="noopener noreferrer" class="chat-link" onclick="if(window.electronAPI){event.preventDefault();window.electronAPI.openExternal(this.href)}">${cleanUrl}</a>${trailing}`;

        return linkHtml;
    });
}




// ============================================
// WEBRTC P2P SES SİSTEMİ MANTIĞI
// ============================================

const rtcConfig = {
    iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' },
        // TODO (Güvenlik): Google STUN yerine aşağıdaki gibi bir TURN sunucusu eklenmesi IP sızıntılarını tamamen durdurur:
        // { urls: 'turn:ornek-turn.com:3478', username: 'kullanici', credential: 'sifre' }
    ]
};

async function initiateVoiceCall(withVideo = false) {
    try {
        await joinVoiceRoom(withVideo); // Biz sese giriyoruz
        state.socket.emit('voice-call-room'); // Herkesin telefonunu çaldır
        showToast(window.i18n ? window.i18n.t('searching_users') : 'Odadakiler aranıyor...', 'success');
    } catch (e) {
        // joinVoiceRoom hata attıysa zaten toast gösterdi, sadece log yeterli
        console.error('[Ses] Arama başlatılamadı:', e);
    }
}

async function joinVoiceRoom(withVideo = false) {
    if (voiceState.isInVoice) return; // Zaten sesteyse tekrar girme

    let stream;
    try {
        stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: withVideo });
    } catch (err) {
        console.error("getUserMedia hatası:", err);

        if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
            showToast(window.i18n ? window.i18n.t('mic_denied') : 'Mikrofon/Kamera izni reddedildi.', 'error');
        } else if (err.name === 'NotFoundError') {
            showToast(window.i18n ? window.i18n.t('no_device') : 'Mikrofon veya kamera cihazı bulunamadı.', 'error');
        } else {
            showToast(`${window.i18n ? window.i18n.t('access_error') : 'Erişim sağlanamadı'}: ${err.message}`, 'error');
        }

        throw err;
    }

    voiceState.localStream = stream;
    voiceState.isInVoice = true;
    voiceState.isVideoOn = withVideo;
    voiceState.isScreenOn = false;

    el.voiceContainer.style.display = 'block';
    if (el.activeCallBanner) el.activeCallBanner.style.display = 'none';
    el.btnJoinVoice.style.display = 'none';
    if (el.btnJoinVideo) el.btnJoinVideo.style.display = 'none';
    if (el.callStatusText) el.callStatusText.textContent = withVideo ? (window.i18n ? window.i18n.t('video_call_connected') : 'Görüntülü Görüşme Bağlı') : (window.i18n ? window.i18n.t('voice_call_connected') : 'Sesli Görüşme Bağlı');

    updateToggleButtonsUI();

    // UI'a Kendimizi ekleyelim
    createMediaElement('local', state.nickname, state.avatarColor, true, stream, state.profilePic);

    // Kendi sesimizi analiz için bağlayalım
    setupVolumeMeter(stream, 'local');

    state.socket.emit('voice-join');
    showToast(withVideo ? (window.i18n ? window.i18n.t('joined_video') : 'Görüntülü sohbete katıldınız!') : (window.i18n ? window.i18n.t('joined_voice') : 'Sesli sohbete katıldınız!'), 'success');
}

function updateToggleButtonsUI() {
    if (el.btnToggleMic) {
        el.btnToggleMic.innerHTML = voiceState.isMicOn
            ? '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"></path><path d="M19 10v2a7 7 0 0 1-14 0v-2"></path><line x1="12" y1="19" x2="12" y2="23"></line><line x1="8" y1="23" x2="16" y2="23"></line></svg> ' + (window.i18n ? window.i18n.t('audio_mic') : 'Mikrofon')
            : '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="color:var(--accent-danger);"><line x1="1" y1="1" x2="23" y2="23"></line><path d="M9 9v3a3 3 0 0 0 5.12 2.12M15 9.34V4a3 3 0 0 0-5.94-.6"></path><path d="M17 16.95A7 7 0 0 1 5 12H3a9 9 0 0 0 8.46 8.94V23h1v-2.06A8.96 8.96 0 0 0 19 16.95"></path></svg> <span style="color:var(--accent-danger);">' + (window.i18n ? window.i18n.t('mute') : 'Susturuldu') + '</span>';
    }
    if (el.btnToggleVideo) {
        el.btnToggleVideo.innerHTML = voiceState.isVideoOn
            ? '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="1" y1="1" x2="23" y2="23"></line><path d="M21 17.16V5a2 2 0 0 0-2-2H7.95"></path><path d="M3.27 3.27A2 2 0 0 0 1 5v14a2 2 0 0 0 2 2h14c.55 0 1.05-.22 1.41-.59"></path><polygon points="23 7 16 12 23 17 23 7"></polygon></svg> ' + (window.i18n ? window.i18n.t('chat_cam_on') : 'Kamera Kapat')
            : '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="23 7 16 12 23 17 23 7"></polygon><rect x="1" y="5" width="15" height="14" rx="2" ry="2"></rect></svg> ' + (window.i18n ? window.i18n.t('chat_cam_off') : 'Kamera Aç');
    }
    if (el.btnToggleScreen) {
        el.btnToggleScreen.innerHTML = voiceState.isScreenOn
            ? '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="3" width="20" height="14" rx="2" ry="2"></rect><line x1="8" y1="21" x2="16" y2="21"></line><line x1="12" y1="17" x2="12" y2="21"></line><line x1="1" y1="1" x2="23" y2="23"></line></svg> ' + (window.i18n ? window.i18n.t('chat_stop_screen') : 'Paylaşımı Durdur')
            : '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="3" width="20" height="14" rx="2" ry="2"></rect><line x1="8" y1="21" x2="16" y2="21"></line><line x1="12" y1="17" x2="12" y2="21"></line></svg> ' + (window.i18n ? window.i18n.t('chat_screen_share') : 'Ekran Paylaş');
    }
}

function toggleMic() {
    if (!voiceState.isInVoice || !voiceState.localStream) return;

    const audioTracks = voiceState.localStream.getAudioTracks();
    if (audioTracks.length > 0) {
        voiceState.isMicOn = !voiceState.isMicOn;
        audioTracks[0].enabled = voiceState.isMicOn;
        updateToggleButtonsUI();
    }
}

async function toggleVideo() {
    if (!voiceState.isInVoice) return;

    if (voiceState.isVideoOn) {
        // Stop video track
        const tracks = voiceState.localStream.getVideoTracks();
        tracks.forEach(track => {
            track.stop();
            voiceState.localStream.removeTrack(track);
        });
        voiceState.isVideoOn = false;
        const videoEl = document.getElementById('video-local');
        if (videoEl) videoEl.style.display = 'none';

        // Update senders for all peers
        Object.values(voiceState.peers).forEach(pc => {
            const senders = pc.getSenders();
            const sender = senders.find(s => s.track && s.track.kind === 'video');
            if (sender) pc.removeTrack(sender);
        });

    } else {
        try {
            const tempStream = await navigator.mediaDevices.getUserMedia({ video: true });
            const videoTrack = tempStream.getVideoTracks()[0];
            voiceState.localStream.addTrack(videoTrack);
            voiceState.isVideoOn = true;

            const videoEl = document.getElementById('video-local');
            if (videoEl) {
                videoEl.srcObject = voiceState.localStream;
                videoEl.style.display = 'block';
            }

            // Update senders for all peers
            Object.values(voiceState.peers).forEach(pc => {
                pc.addTrack(videoTrack, voiceState.localStream);
            });
        } catch (err) {
            console.error(err);
            showToast(window.i18n ? window.i18n.t('cam_failed') : 'Kamera açılamadı!', 'error');
            return;
        }
    }
    updateToggleButtonsUI();
}

async function toggleScreen() {
    if (!voiceState.isInVoice) return;

    if (voiceState.isScreenOn) {
        if (voiceState.screenStream) {
            voiceState.screenStream.getTracks().forEach(track => track.stop());
            voiceState.screenStream = null;
        }
        voiceState.isScreenOn = false;

        // Ekran paylaşımı badge'ini kaldır
        updateScreenShareBadge('local', false);

        // Diğer kullanıcılara ekran paylaşımının bittiğini bildir
        if (state.socket) {
            state.socket.emit('screen-share-state', { isSharing: false });
        }

        Object.values(voiceState.peers).forEach(pc => {
            const senders = pc.getSenders();
            const sender = senders.find(s => s.track && s.track.kind === 'video');
            if (sender) {
                if (voiceState.isVideoOn && voiceState.localStream.getVideoTracks()[0]) {
                    sender.replaceTrack(voiceState.localStream.getVideoTracks()[0]);
                } else {
                    pc.removeTrack(sender);
                }
            }
        });

        const videoEl = document.getElementById('video-local');
        if (videoEl && voiceState.isVideoOn) {
            videoEl.srcObject = voiceState.localStream;
            videoEl.style.display = 'block';
        } else if (videoEl) {
            videoEl.style.display = 'none';
        }

        showToast(window.i18n ? window.i18n.t('toast_screen_share_stopped') : 'Ekran paylaşımı durduruldu.', 'info');

    } else {
        try {
            if (window.electronAPI && window.electronAPI.getDesktopSources) {
                // Electron ortamındayız, özel menü aç
                openScreenShareModal();
                return;
            } else {
                // Tarayıcı ortamındayız, standart API kullan (Sesi de al)
                const constraints = {
                    video: {
                        cursor: "always"
                    },
                    audio: false // Genelde tarayıcı sekmesi paylaşımında false iyidir, sistem sesini alamayabilir
                };
                const screenStream = await navigator.mediaDevices.getDisplayMedia(constraints);
                startScreenShareWithStream(screenStream);
            }
        } catch (err) {
            console.error(err);
            showToast(window.i18n ? window.i18n.t('screen_share_failed') : 'Ekran paylaşılamadı!', 'error');
            return;
        }
    }
    updateToggleButtonsUI();
}

// Electron için Ekran/Pencere Listesi Modalı
async function openScreenShareModal() {
    el.modalScreenShare.classList.add('visible');
    el.screenShareGrid.innerHTML = '<p style="color:var(--text-muted); text-align:center; width:100%; grid-column:1/-1;">Kaynaklar yükleniyor...</p>';

    async function loadSources(type) {
        try {
            const sources = await window.electronAPI.getDesktopSources({ types: [type] });
            el.screenShareGrid.innerHTML = '';

            if (!sources || sources.length === 0) {
                // PipeWire/Portal hatası veya kaynak bulunamadı - kullanıcıya fallback sun
                el.screenShareGrid.innerHTML = `
                    <div style="grid-column:1/-1; text-align:center; padding: 24px;">
                        <p style="color:var(--accent-warning); margin-bottom:12px; font-size:14px;">
                            ⚠️ Ekran kaynakları alınamadı.
                        </p>
                        <p style="color:var(--text-muted); margin-bottom:16px; font-size:12px;">
                            Linux'ta PipeWire/Portal servisi düzgün çalışmıyor olabilir.
                        </p>
                        <button id="btn-screen-share-fallback" style="padding:10px 24px; background:var(--accent-primary); color:var(--text-on-accent); border:none; border-radius:8px; cursor:pointer; font-weight:600; font-size:13px; transition:0.2s;">
                            Tarayıcı Ekran Seçicisini Kullan
                        </button>
                    </div>
                `;
                // Fallback: getDisplayMedia API'si ile geri dön
                const fallbackBtn = document.getElementById('btn-screen-share-fallback');
                if (fallbackBtn) {
                    fallbackBtn.onclick = async () => {
                        el.modalScreenShare.classList.remove('visible');
                        try {
                            const screenStream = await navigator.mediaDevices.getDisplayMedia({
                                video: { cursor: "always" },
                                audio: false
                            });
                            startScreenShareWithStream(screenStream);
                            updateToggleButtonsUI();
                        } catch (fallbackErr) {
                            console.error('Fallback ekran paylaşımı hatası:', fallbackErr);
                            showToast(window.i18n ? window.i18n.t('screen_share_failed') : 'Ekran paylaşılamadı!', 'error');
                        }
                    };
                }
                return;
            }

            sources.forEach(source => {
                const item = document.createElement('div');
                item.style.cssText = 'background:var(--bg-dark); border-radius:var(--radius-sm); padding:10px; cursor:pointer; text-align:center; border:2px solid transparent; transition:var(--transition-fast);';

                item.onmouseover = () => item.style.borderColor = 'var(--accent-primary)';
                item.onmouseout = () => item.style.borderColor = 'transparent';

                item.innerHTML = `
                    <img src="${source.thumbnail.toDataURL ? source.thumbnail.toDataURL() : source.thumbnail}" style="width:100%; aspect-ratio:16/9; object-fit:contain; background:#000; border-radius:4px; margin-bottom:8px;">
                    <div style="font-size:12px; color:var(--text-primary); white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${escapeHtml(source.name)}</div>
                `;

                item.onclick = async () => {
                    el.modalScreenShare.classList.remove('visible');
                    try {
                        // Desktop capturer stream al
                        const constraints = {
                            video: {
                                mandatory: {
                                    chromeMediaSource: 'desktop',
                                    chromeMediaSourceId: source.id
                                }
                            },
                            audio: {
                                mandatory: {
                                    chromeMediaSource: 'desktop'
                                }
                            }
                        };
                        const stream = await navigator.mediaDevices.getUserMedia(constraints);
                        startScreenShareWithStream(stream);
                    } catch (err) {
                        try {
                            // Ses desteği olmadan tekrar dene (Örn: macOS/Linux pencerelerinde ses alınmaz)
                            const streamWithoutAudio = await navigator.mediaDevices.getUserMedia({
                                video: {
                                    mandatory: {
                                        chromeMediaSource: 'desktop',
                                        chromeMediaSourceId: source.id
                                    }
                                }
                            });
                            startScreenShareWithStream(streamWithoutAudio);
                        } catch (e2) {
                            console.error("Stream alma hatası:", e2);
                            showToast(window.i18n ? window.i18n.t('source_share_failed') : 'Bu kaynak paylaşılamadı.', 'error');
                        }
                    }
                };

                el.screenShareGrid.appendChild(item);
            });
        } catch (err) {
            console.error(err);
            el.screenShareGrid.innerHTML = '<p style="color:var(--accent-danger); text-align:center; width:100%; grid-column:1/-1;">Kaynaklar alınamadı.</p>';
        }
    }

    // Modal sekmeleri (Ekranlar / Pencereler)
    el.tabScreens.onclick = () => {
        el.tabScreens.className = 'screen-tab active';
        el.tabScreens.style.background = 'var(--bg-hover)';
        el.tabScreens.style.color = 'white';

        el.tabWindows.className = 'screen-tab';
        el.tabWindows.style.background = 'var(--bg-light)';
        el.tabWindows.style.color = 'var(--text-muted)';

        loadSources('screen');
    };

    el.tabWindows.onclick = () => {
        el.tabWindows.className = 'screen-tab active';
        el.tabWindows.style.background = 'var(--bg-hover)';
        el.tabWindows.style.color = 'white';

        el.tabScreens.className = 'screen-tab';
        el.tabScreens.style.background = 'var(--bg-light)';
        el.tabScreens.style.color = 'var(--text-muted)';

        loadSources('window');
    };

    el.btnCloseScreenModal.onclick = () => el.modalScreenShare.classList.remove('visible');

    // Varsayılan olarak ekranları yükle
    el.tabScreens.onclick();
}

function startScreenShareWithStream(screenStream) {
    voiceState.screenStream = screenStream;
    const screenVideoTrack = screenStream.getVideoTracks()[0];
    const screenAudioTrack = screenStream.getAudioTracks()[0]; // Web'den veya Electron'dan ses geldiyse ekle
    voiceState.isScreenOn = true;

    screenVideoTrack.onended = () => {
        toggleScreen();
    };

    // Kendi video elementimizde ekran paylaşımını göster (kullanıcı ne paylaştığını görsün)
    const videoEl = document.getElementById('video-local');
    if (videoEl) {
        videoEl.srcObject = screenStream;
        videoEl.style.display = 'block';
        // Ekran paylaşımında mirror (ayna) efektini kapat
        videoEl.style.transform = 'none';
    }

    // Kendi kartımıza "Ekran Paylaşılıyor" göstergesi ekle
    updateScreenShareBadge('local', true);

    // Diğer kullanıcılara ekran paylaşımı durumunu bildir
    if (state.socket) {
        state.socket.emit('screen-share-state', { isSharing: true });
    }

    Object.keys(voiceState.peers).forEach(targetId => {
        const pc = voiceState.peers[targetId];
        const senders = pc.getSenders();
        const videoSender = senders.find(s => s.track && s.track.kind === 'video');

        if (videoSender) {
            // Zaten bir video kanalı (transceiver) varsa sadece track'i değiştir
            videoSender.replaceTrack(screenVideoTrack);
        } else {
            // İlk defa video ekleniyorsa
            pc.addTrack(screenVideoTrack, voiceState.screenStream);
        }

        // Seçime bağlı ses aktarımı
        if (screenAudioTrack) {
            const audioSender = senders.find(s => s.track && s.track.kind === 'audio' && s.track.id !== voiceState.localStream?.getAudioTracks()[0]?.id);
            if (audioSender) {
                audioSender.replaceTrack(screenAudioTrack);
            } else {
                pc.addTrack(screenAudioTrack, voiceState.screenStream);
            }
        }
    });

    updateToggleButtonsUI();
    showToast(window.i18n ? window.i18n.t('toast_screen_share_started') : 'Ekran paylaşımı başlatıldı!', 'success');
}

// Ekran paylaşımı badge'ini göster/gizle
function updateScreenShareBadge(userId, isSharing) {
    const card = document.getElementById(`voice-card-${userId}`);
    if (!card) return;

    // Mevcut badge'i kaldır
    const existingBadge = card.querySelector('.screen-share-badge');
    if (existingBadge) existingBadge.remove();

    if (isSharing) {
        const badge = document.createElement('div');
        badge.className = 'screen-share-badge';
        badge.style.cssText = 'display:flex; align-items:center; gap:4px; padding:4px 10px; background:rgba(99,102,241,0.2); border:1px solid rgba(99,102,241,0.4); border-radius:6px; font-size:11px; color:#a5b4fc; font-weight:600; margin-top:6px; animation: pulse-badge 2s infinite;';
        badge.innerHTML = `
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <rect x="2" y="3" width="20" height="14" rx="2" ry="2"></rect>
                <line x1="8" y1="21" x2="16" y2="21"></line>
                <line x1="12" y1="17" x2="12" y2="21"></line>
            </svg>
            Ekran Paylaşılıyor
        `;
        // Badge'i card'ın ilk child div'inin sonuna ekle
        const innerDiv = card.querySelector('div');
        if (innerDiv) innerDiv.appendChild(badge);
    }
}

function leaveVoiceRoom() {
    voiceState.isInVoice = false;

    if (voiceState.localStream) {
        voiceState.localStream.getTracks().forEach(track => track.stop());
        voiceState.localStream = null;
    }

    stopRingtone();

    // Sesi analiz etmeyi bırak
    if (volumeMeters['local']) {
        cancelAnimationFrame(volumeMeters['local'].animationFrame);
        delete volumeMeters['local'];
    }
    if (voiceState.screenStream) {
        voiceState.screenStream.getTracks().forEach(track => track.stop());
        voiceState.screenStream = null;
    }

    voiceState.isVideoOn = false;
    voiceState.isScreenOn = false;

    // Tüm P2P bağlantılarını kapat
    Object.keys(voiceState.peers).forEach(userId => {
        removePeerConnection(userId);
    });

    el.voiceContainer.style.display = 'none';
    el.btnJoinVoice.style.display = 'flex';
    if (el.btnJoinVideo) el.btnJoinVideo.style.display = 'flex';
    el.voiceParticipants.innerHTML = '';

    state.socket.emit('voice-leave');
    state.socket.emit('call-ended'); // Ringing durumunu temizle
    showToast(window.i18n ? window.i18n.t('left_call') : 'Görüşmeden ayrıldınız.', 'info');
}

// ============================================
// SPEAKING INDICATOR (AUDIO METER)
// ============================================
let audioContext = null;
const volumeMeters = {};

function setupVolumeMeter(stream, targetId) {
    if (!audioContext) {
        audioContext = new (window.AudioContext || window.webkitAudioContext)();
    }

    if (audioContext.state === 'suspended') {
        audioContext.resume();
    }

    const audioTrack = stream.getAudioTracks()[0];
    if (!audioTrack) return;

    // Eski meter varsa temizle
    if (volumeMeters[targetId]) {
        cancelAnimationFrame(volumeMeters[targetId].animationFrame);
    }

    try {
        const audioStream = new MediaStream([audioTrack]);
        const source = audioContext.createMediaStreamSource(audioStream);
        const analyser = audioContext.createAnalyser();

        analyser.fftSize = 256;
        analyser.smoothingTimeConstant = 0.4;
        source.connect(analyser);

        const dataArray = new Uint8Array(analyser.frequencyBinCount);

        function checkVolume() {
            analyser.getByteFrequencyData(dataArray);
            let sum = 0;
            for (let i = 0; i < dataArray.length; i++) {
                sum += dataArray[i];
            }
            const average = sum / dataArray.length;

            const avatarEl = document.getElementById(`avatar-${targetId}`);
            if (avatarEl) {
                if (average > 12) {
                    avatarEl.style.boxShadow = '0 0 0 4px var(--accent-success), 0 4px 12px rgba(0,0,0,0.3)';
                } else {
                    avatarEl.style.boxShadow = '0 4px 12px rgba(0,0,0,0.2)';
                }
            }

            volumeMeters[targetId].animationFrame = requestAnimationFrame(checkVolume);
        }

        volumeMeters[targetId] = {
            source,
            analyser,
            animationFrame: requestAnimationFrame(checkVolume)
        };
    } catch (e) {
        console.warn('Audio Context failed to attach', e);
    }
}

async function createPeerConnection(targetId, isInitiator) {
    const pc = new RTCPeerConnection(rtcConfig);
    voiceState.peers[targetId] = pc;

    // Perfect Negotiation Değişkenleri
    pc.makingOffer = false;
    pc.ignoreOffer = false;
    // Çakışma anında kimin boyun eğeceğini (polite) belirleyen evrensel kural: ID büyüklüğü
    pc.isPolite = state.socket.id > targetId;

    // Kendi medyamızı karşıya gönder
    if (voiceState.localStream) {
        voiceState.localStream.getTracks().forEach(track => {
            pc.addTrack(track, voiceState.localStream);
        });
    }

    // Eğer o anda ekran paylaşımı açıksa ve kamera yoksaydı
    if (voiceState.isScreenOn && voiceState.screenStream) {
        const senders = pc.getSenders();
        const videoSender = senders.find(s => s.track && s.track.kind === 'video');
        if (videoSender) {
            videoSender.replaceTrack(voiceState.screenStream.getVideoTracks()[0]);
        } else {
            pc.addTrack(voiceState.screenStream.getVideoTracks()[0], voiceState.screenStream);
        }
    }

    pc.onnegotiationneeded = async () => {
        try {
            pc.makingOffer = true;
            console.log(`[Ses] Olay İstendi (NegotiationNeeded) -> ${targetId}`);
            // Görüntü/Ekran gibi yeni bir medya eklendiğinde WebRTC'yi yeniden yapılandırır
            const offer = await pc.createOffer();
            await pc.setLocalDescription(offer);
            state.socket.emit('webrtc-offer', { targetId, offer: pc.localDescription });
        } catch (err) {
            console.error("Negotiation error:", err);
        } finally {
            pc.makingOffer = false;
        }
    };

    // ICE (Veri yolları) bulununca karşıya at
    pc.onicecandidate = (event) => {
        if (event.candidate) {
            state.socket.emit('webrtc-candidate', { targetId, candidate: event.candidate });
        }
    };

    // Karşıdan bir media stream gelirse
    pc.ontrack = (event) => {
        const stream = event.streams[0];
        const audioEl = document.getElementById(`audio-${targetId}`);
        const videoEl = document.getElementById(`video-${targetId}`);

        if (event.track.kind === 'audio') {
            // Ses track'lerini mevcut audio elementine ekle veya yeni stream oluştur
            if (audioEl) {
                if (!audioEl.srcObject) {
                    audioEl.srcObject = new MediaStream([event.track]);
                    setupVolumeMeter(audioEl.srcObject, targetId);
                } else {
                    audioEl.srcObject.addTrack(event.track);
                    setupVolumeMeter(audioEl.srcObject, targetId);
                }
            }
        }

        // Video pencerelerinin gösterilmesi için
        if (stream) {
            if (event.track.kind === 'video') {
                if (videoEl) {
                    // Siyah ekran sorununu önlemek için ufak bir bekleme ve stream güncellemesi
                    setTimeout(() => {
                        videoEl.srcObject = null;
                        videoEl.srcObject = stream;
                        videoEl.style.display = 'block';
                    }, 50);
                }
            }
        }

        event.track.onended = () => {
            if (event.track.kind === 'video') {
                if (videoEl && (!stream.getVideoTracks().length || stream.getVideoTracks().every(t => t.readyState === 'ended'))) {
                    videoEl.style.display = 'none';
                }
            }
        };
        event.track.onmute = () => {
            if (event.track.kind === 'video') {
                if (videoEl) videoEl.style.display = 'none';
            }
        };
        event.track.onunmute = () => {
            if (event.track.kind === 'video') {
                if (videoEl) {
                    videoEl.srcObject = stream;
                    videoEl.style.display = 'block';
                }
            }
        };
    };

    // Bağlantı düşerse
    pc.oniceconnectionstatechange = () => {
        if (pc.iceConnectionState === 'disconnected' || pc.iceConnectionState === 'failed') {
            removePeerConnection(targetId);
        }
    };

    return pc;
}

function removePeerConnection(targetId) {
    if (voiceState.peers[targetId]) {
        voiceState.peers[targetId].close();
        delete voiceState.peers[targetId];
    }

    if (volumeMeters[targetId]) {
        cancelAnimationFrame(volumeMeters[targetId].animationFrame);
        delete volumeMeters[targetId];
    }

    // UI üzerindeki elementi sil
    const circle = document.getElementById(`voice-card-${targetId}`);
    if (circle) circle.remove();
}

function createMediaElement(userId, username, color, isLocal = false, stream = null, profilePic = null) {
    if (document.getElementById(`voice-card-${userId}`)) return;

    const initial = username[0].toUpperCase();
    const elId = `voice-card-${userId}`;
    const audioContent = isLocal ? '' : `<audio id="audio-${userId}" autoplay></audio>`;

    const videoContent = `<video id="video-${userId}" autoplay playsinline ${isLocal ? 'muted' : ''} style="display:${(isLocal && (voiceState.isVideoOn || voiceState.isScreenOn)) ? 'block' : 'none'}; width: 100%; max-width: 250px; border-radius: 8px; margin-top: 8px; background: #000; aspect-ratio: 16/9; object-fit: cover; cursor: zoom-in;" onclick="this.classList.toggle('fullscreen-video')" title="Tam boy/Küçült (Tıkla)"></video>`;

    const contextAttr = isLocal ? '' : `oncontextmenu="window.openUserMenu(event, '${userId}')"`;

    // Profil fotoğrafı varsa onu göster, yoksa renk + baş harf
    let avatarContent;
    if (profilePic) {
        avatarContent = `<div id="avatar-${userId}" style="width:56px; height:56px; border-radius:50%; background-image:url('${profilePic}'); background-size:cover; background-position:center; box-shadow:0 4px 12px rgba(0,0,0,0.2); transition: box-shadow 0.15s ease-in-out;"></div>`;
    } else {
        avatarContent = `<div id="avatar-${userId}" style="width:56px; height:56px; border-radius:50%; background-color:${color || '#6366f1'}; color:white; display:flex; align-items:center; justify-content:center; font-size:24px; font-weight:bold; box-shadow:0 4px 12px rgba(0,0,0,0.2); transition: box-shadow 0.15s ease-in-out;">${initial}</div>`;
    }

    const cardHtml = `
      <div id="${elId}" ${contextAttr} style="display:flex; flex-direction:column; align-items:center; justify-content:center; background:rgba(255,255,255,0.05); padding:20px; min-width:140px; min-height:140px; border-radius:12px; border:1px solid rgba(255,255,255,0.05); ${isLocal ? '' : 'cursor:context-menu;'} transition:0.2s;">
        <div style="display:flex; flex-direction:column; align-items:center; justify-content:center; gap:12px;">
            ${avatarContent}
            <span style="font-size:14px; color:var(--text-primary); font-weight:600; text-align:center; max-width:140px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">
              ${escapeHtml(username)} ${isLocal ? (window.i18n ? `(${window.i18n.t('you')})` : '(Sen)') : ''}
            </span>
        </div>
        ${videoContent}
        ${audioContent}
      </div>
    `;

    el.voiceParticipants.insertAdjacentHTML('beforeend', cardHtml);

    if (isLocal && stream && (voiceState.isVideoOn || voiceState.isScreenOn)) {
        const vid = document.getElementById(`video-${userId}`);
        if (vid) vid.srcObject = stream;
    }
}

// Global silme onayı
window.deleteMessage = function (messageId, roomId) {
    if (window.showConfirmModal) {
        window.showConfirmModal(window.i18n ? window.i18n.t('msg_delete_message') : 'Bu mesajı silmek istediğinize emin misiniz?', () => {
            if (state.socket) {
                state.socket.emit('delete-message', { messageId, roomId });
            }
        });
    } else {
        if (confirm(window.i18n ? window.i18n.t('msg_delete_message') : 'Bu mesajı silmek istediğinize emin misiniz?')) {
            if (state.socket) {
                state.socket.emit('delete-message', { messageId, roomId });
            }
        }
    }
};

window.toggleUserMute = function (userId) {
    const audioEl = document.getElementById(`audio-${userId}`);
    if (audioEl) {
        audioEl.muted = !audioEl.muted;
    }
};

window.changeUserVolume = function (userId, vol) {
    const audioEl = document.getElementById(`audio-${userId}`);
    if (audioEl) {
        audioEl.volume = parseFloat(vol);
        // Sesi açarsa ve mute'luysa muteden çıkar
        if (audioEl.muted && parseFloat(vol) > 0) {
            audioEl.muted = false;
        }
    }
};

window.openUserMenu = function (e, userId) {
    e.preventDefault();
    const menu = document.getElementById('user-context-menu');
    const slider = document.getElementById('context-volume-slider');
    const muteBtn = document.getElementById('context-mute-btn');
    const audioEl = document.getElementById(`audio-${userId}`);

    if (!menu || !audioEl) return;

    // Değerleri oku
    slider.value = audioEl.volume;
    muteBtn.textContent = audioEl.muted ? (window.i18n ? window.i18n.t('unmute') : 'Sesi Aç') : (window.i18n ? window.i18n.t('mute') : 'Sustur');
    muteBtn.style.color = audioEl.muted ? 'var(--accent-danger)' : 'white';
    muteBtn.style.background = audioEl.muted ? 'rgba(239, 68, 68, 0.2)' : 'rgba(255,255,255,0.05)';

    // Olay dinleyicileri (mevcutları üzerine yazıyoruz)
    slider.oninput = (ev) => {
        window.changeUserVolume(userId, ev.target.value);
        if (parseFloat(ev.target.value) > 0) {
            muteBtn.textContent = window.i18n ? window.i18n.t('mute') : 'Sustur';
            muteBtn.style.color = 'white';
            muteBtn.style.background = 'rgba(255,255,255,0.05)';
        }
    };

    muteBtn.onclick = () => {
        window.toggleUserMute(userId);
        muteBtn.textContent = audioEl.muted ? (window.i18n ? window.i18n.t('unmute') : 'Sesi Aç') : (window.i18n ? window.i18n.t('mute') : 'Sustur');
        muteBtn.style.color = audioEl.muted ? 'var(--accent-danger)' : 'white';
        muteBtn.style.background = audioEl.muted ? 'rgba(239, 68, 68, 0.2)' : 'rgba(255,255,255,0.05)';
    };

    // Menü pozisyonu
    menu.style.display = 'block';

    let x = e.clientX;
    let y = e.clientY;
    if (x + menu.offsetWidth > window.innerWidth) x -= menu.offsetWidth;
    if (y + menu.offsetHeight > window.innerHeight) y -= menu.offsetHeight;

    menu.style.left = x + 'px';
    menu.style.top = y + 'px';
};

// ============================================
// MOBİL HAMBURGER MENÜ
// ============================================
(function setupMobileMenu() {
    const btnMenu = document.getElementById('btn-mobile-menu');
    const dropdown = document.getElementById('mobile-dropdown-menu');
    if (!btnMenu || !dropdown) return;

    // Toggle açma/kapama
    btnMenu.addEventListener('click', (e) => {
        e.stopPropagation();
        e.preventDefault();
        const isOpen = dropdown.style.display === 'block';
        dropdown.style.display = isOpen ? 'none' : 'block';
    });

    // Dropdown'a dokunulduğunda alttaki elemanlara geçmesini engelle
    dropdown.addEventListener('click', (e) => {
        e.stopPropagation();
    });
    dropdown.addEventListener('touchstart', (e) => {
        e.stopPropagation();
    });
    dropdown.addEventListener('touchend', (e) => {
        e.stopPropagation();
    });

    // Dışarı tıklayınca kapat
    document.addEventListener('click', (e) => {
        if (!dropdown.contains(e.target) && e.target !== btnMenu && !btnMenu.contains(e.target)) {
            dropdown.style.display = 'none';
        }
    });

    // Mobil buton handler yardımcısı - hem click hem touchend'de çalışır
    function mobileAction(btnId, action) {
        const btn = document.getElementById(btnId);
        if (!btn) return;
        let handled = false;

        btn.addEventListener('touchend', (e) => {
            e.stopPropagation();
            e.preventDefault();
            if (handled) return;
            handled = true;
            dropdown.style.display = 'none';
            setTimeout(() => { action(); handled = false; }, 50);
        });

        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            e.preventDefault();
            if (handled) { handled = false; return; }
            dropdown.style.display = 'none';
            action();
        });
    }

    mobileAction('mobile-btn-voice', () => {
        if (el.btnJoinVoice) el.btnJoinVoice.click();
    });

    mobileAction('mobile-btn-video', () => {
        if (el.btnJoinVideo) el.btnJoinVideo.click();
    });

    mobileAction('mobile-btn-settings', () => {
        const chatSettings = document.getElementById('btn-chat-settings');
        if (chatSettings) chatSettings.click();
    });

    mobileAction('mobile-btn-logout', () => {
        if (el.btnLogout) el.btnLogout.click();
    });
})();

// ============================================
// SESLİ MESAJ KAYIT SİSTEMİ
// ============================================
(function setupVoiceRecording() {
    const btnRecord = document.getElementById('btn-voice-record');
    const recordBar = document.getElementById('voice-record-bar');
    const btnCancel = document.getElementById('voice-record-cancel');
    const btnSend = document.getElementById('voice-record-send');
    const timerEl = document.getElementById('voice-record-timer');
    const waveformCanvas = document.getElementById('voice-record-waveform');
    const inputWrapper = document.querySelector('.chat-input-wrapper');

    if (!btnRecord || !recordBar) return;

    let mediaRecorder = null;
    let audioChunks = [];
    let recordingStream = null;
    let analyser = null;
    let audioContext = null;
    let animFrame = null;
    let timerInterval = null;
    let startTime = 0;

    function formatTime(seconds) {
        const m = Math.floor(seconds / 60);
        const s = Math.floor(seconds % 60);
        return `${m}:${s.toString().padStart(2, '0')}`;
    }

    function drawWaveform() {
        if (!analyser || !waveformCanvas) return;
        const ctx = waveformCanvas.getContext('2d');
        const bufferLength = analyser.frequencyBinCount;
        const dataArray = new Uint8Array(bufferLength);

        function draw() {
            animFrame = requestAnimationFrame(draw);
            analyser.getByteTimeDomainData(dataArray);

            const w = waveformCanvas.width;
            const h = waveformCanvas.height;
            ctx.clearRect(0, 0, w, h);

            ctx.lineWidth = 2;
            const theme = document.documentElement.getAttribute('data-theme');
            ctx.strokeStyle = theme === 'antigravity' ? '#000000' : '#8496a0';
            ctx.beginPath();

            const sliceWidth = w / bufferLength;
            let x = 0;

            for (let i = 0; i < bufferLength; i++) {
                const v = dataArray[i] / 128.0;
                const y = v * h / 2;
                if (i === 0) ctx.moveTo(x, y);
                else ctx.lineTo(x, y);
                x += sliceWidth;
            }
            ctx.lineTo(w, h / 2);
            ctx.stroke();
        }
        draw();
    }

    async function startRecording() {
        try {
            recordingStream = await navigator.mediaDevices.getUserMedia({ audio: true });
            audioContext = new AudioContext();
            const source = audioContext.createMediaStreamSource(recordingStream);
            analyser = audioContext.createAnalyser();
            analyser.fftSize = 256;
            source.connect(analyser);

            mediaRecorder = new MediaRecorder(recordingStream);
            audioChunks = [];

            mediaRecorder.ondataavailable = (e) => {
                if (e.data.size > 0) audioChunks.push(e.data);
            };

            mediaRecorder.start();
            startTime = Date.now();

            // UI
            inputWrapper.style.display = 'none';
            recordBar.style.display = 'flex';

            // Timer
            timerInterval = setInterval(() => {
                const elapsed = (Date.now() - startTime) / 1000;
                timerEl.textContent = formatTime(elapsed);
            }, 100);

            // Waveform
            drawWaveform();

        } catch (err) {
            console.error('Mikrofon erişim hatası:', err);
            showToast(window.i18n ? window.i18n.t('mic_denied_short') : 'Mikrofon erişimi reddedildi!', 'error');
        }
    }

    function stopRecording() {
        if (animFrame) cancelAnimationFrame(animFrame);
        if (timerInterval) clearInterval(timerInterval);
        if (mediaRecorder && mediaRecorder.state !== 'inactive') {
            mediaRecorder.stop();
        }
        if (recordingStream) {
            recordingStream.getTracks().forEach(t => t.stop());
        }
        if (audioContext) {
            audioContext.close();
        }

        recordBar.style.display = 'none';
        inputWrapper.style.display = 'flex';
        timerEl.textContent = '0:00';
    }

    btnRecord.addEventListener('click', () => {
        startRecording();
    });

    btnCancel.addEventListener('click', () => {
        stopRecording();
        audioChunks = [];
    });

    btnSend.addEventListener('click', () => {
        if (!mediaRecorder || mediaRecorder.state === 'inactive') return;

        mediaRecorder.onstop = async () => {
            const blob = new Blob(audioChunks, { type: 'audio/webm' });
            audioChunks = [];

            // Dosya olarak upload et
            const formData = new FormData();
            formData.append('file', blob, `sesli-mesaj-${Date.now()}.webm`);

            try {
                const response = await fetch(`${state.serverUrl}/api/upload`, {
                    method: 'POST',
                    body: formData
                });
                const data = await response.json();
                if (data.success) {
                    const fileMsgContent = JSON.stringify({
                        url: data.url,
                        filename: data.filename,
                        mimetype: 'audio/webm'
                    });
                    const encryptedContent = await encryptMessage(fileMsgContent);
                    state.socket.emit('send-message', {
                        content: encryptedContent,
                        type: 'file',
                        replyTo: state.replyingTo ? state.replyingTo.id : null
                    });
                    window.cancelReply();
                } else {
                    showToast((window.i18n ? window.i18n.t('voice_upload_fail') : 'Ses kaydı yüklenemedi') + ': ' + data.message, 'error');
                }
            } catch (err) {
                showToast(window.i18n ? window.i18n.t('voice_record_fail') : 'Ses kaydı gönderilemedi!', 'error');
            }
        };

        stopRecording();
    });
})();

// ============================================
// SESLİ MESAJ OYNATICI FONKSİYONLARI
// ============================================
const voiceAudioPlayers = {};

const micIconHTML = '<path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z"></path><path d="M19 10v2a7 7 0 0 1-14 0v-2"></path><line x1="12" y1="19" x2="12" y2="22"></line>';
const pauseIconHTML = '<rect x="6" y="4" width="4" height="16"></rect><rect x="14" y="4" width="4" height="16"></rect>';

window.toggleVoiceMsg = function (audioId, src) {
    let player = voiceAudioPlayers[audioId];

    if (!player) {
        player = new Audio(src);
        voiceAudioPlayers[audioId] = player;

        // İlk waveform çiz
        player.addEventListener('loadedmetadata', () => drawStaticWaveform(audioId, 0));
        player.addEventListener('canplay', () => drawStaticWaveform(audioId, 0), { once: true });

        // Progress — dalga formunu ilerlemeye göre yeniden çiz
        player.addEventListener('timeupdate', () => {
            if (player.duration) {
                const pct = player.currentTime / player.duration;
                drawStaticWaveform(audioId, pct);
            }
        });

        // Bittiğinde
        player.addEventListener('ended', () => {
            const icon = document.getElementById(audioId + '-icon');
            if (icon) icon.innerHTML = micIconHTML;
            drawStaticWaveform(audioId, 0);
        });
    }

    const icon = document.getElementById(audioId + '-icon');

    if (player.paused) {
        // Diğer çalanları durdur
        Object.keys(voiceAudioPlayers).forEach(id => {
            if (id !== audioId && !voiceAudioPlayers[id].paused) {
                voiceAudioPlayers[id].pause();
                const otherIcon = document.getElementById(id + '-icon');
                if (otherIcon) otherIcon.innerHTML = micIconHTML;
            }
        });
        player.play();
        if (icon) icon.innerHTML = pauseIconHTML;
    } else {
        player.pause();
        if (icon) icon.innerHTML = micIconHTML;
    }
};

window.seekVoiceMsg = function (event, audioId) {
    const player = voiceAudioPlayers[audioId];
    if (!player || !player.duration) return;
    const bar = event.currentTarget;
    const rect = bar.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const pct = x / rect.width;
    player.currentTime = pct * player.duration;
    drawStaticWaveform(audioId, pct);
};

function formatVoiceDuration(sec) {
    if (!sec || !isFinite(sec)) return '0:00';
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60);
    return `${m}:${s.toString().padStart(2, '0')}`;
}

function drawStaticWaveform(audioId, progress) {
    const canvas = document.getElementById(audioId + '-waveform');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const w = canvas.width;
    const h = canvas.height;
    const pct = progress || 0;

    ctx.clearRect(0, 0, w, h);

    const barWidth = 3;
    const barGap = 2;
    const bars = Math.floor(w / (barWidth + barGap));
    const progressBar = Math.floor(bars * pct);

    for (let i = 0; i < bars; i++) {
        const seed = Math.sin(i * 12.9898 + parseInt(audioId.replace(/\D/g, '') || 0)) * 43758.5453;
        const barHeight = (Math.abs(seed % 1) * 0.7 + 0.3) * h * 0.8;
        const x = i * (barWidth + barGap);
        const y = (h - barHeight) / 2;

        // Çalınan kısım accent rengi, çalınmamış kısım soluk tema rengi
        const theme = document.documentElement.getAttribute('data-theme') || 'space';
        const unfills = theme === 'antigravity' ? 'rgba(0,0,0,0.6)' : 'rgba(255, 255, 255, 0.2)';
        ctx.fillStyle = i < progressBar ? '#14b8a6' : unfills;
        ctx.fillRect(x, y, barWidth, barHeight);
    }
}

// DOM'daki z-index / isolation sorunlarını önlemek için, medya önizleme pencereleri `body`nin sonuna eklenir.
window.previewMedia = function (url, type) {
    // Varsa eski div'i sil
    const oldOverlay = document.getElementById('media-preview-overlay');
    if (oldOverlay) oldOverlay.remove();

    const overlay = document.createElement('div');
    overlay.id = 'media-preview-overlay';
    overlay.style.cssText = 'position:fixed; top:0; left:0; width:100vw; height:100vh; background:rgba(0,0,0,0.85); backdrop-filter:blur(10px); z-index:999999; display:flex; align-items:center; justify-content:center; cursor:zoom-out; flex-direction:column; padding: 24px;-webkit-app-region: no-drag; overflow:hidden;';

    let mediaEl;
    let scale = 1;
    let isDragging = false;
    let startX, startY, translateX = 0, translateY = 0;

    if (type === 'image') {
        const imgContainer = document.createElement('div');
        imgContainer.style.cssText = 'width:100%; height:100%; display:flex; align-items:center; justify-content:center; cursor:zoom-in; transition: transform 0.1s ease-out;';

        mediaEl = document.createElement('img');
        mediaEl.src = url;
        mediaEl.style.cssText = 'max-width:90vw; max-height:90vh; object-fit:contain; border-radius:12px; box-shadow:0 12px 48px rgba(0,0,0,0.8); pointer-events:none; transition: transform 0.1s;';

        imgContainer.appendChild(mediaEl);
        overlay.appendChild(imgContainer);

        // Zoom 
        overlay.addEventListener('wheel', (e) => {
            e.preventDefault();
            const zoomAmount = 0.1;
            if (e.deltaY < 0) {
                scale += zoomAmount; // Büyüt
            } else {
                scale -= zoomAmount; // Küçült
            }
            scale = Math.max(0.2, Math.min(scale, 5)); // Sınır
            imgContainer.style.transform = `translate(${translateX}px, ${translateY}px) scale(${scale})`;
            if (scale > 1) {
                imgContainer.style.cursor = 'grab';
                overlay.style.cursor = 'default';
            } else {
                imgContainer.style.cursor = 'zoom-in';
                overlay.style.cursor = 'zoom-out';
                translateX = 0;
                translateY = 0;
                imgContainer.style.transform = `translate(0px, 0px) scale(${scale})`;
            }
        });

        // Sürükleme (Pan)
        overlay.addEventListener('mousedown', (e) => {
            if (scale > 1) {
                isDragging = true;
                startX = e.clientX - translateX;
                startY = e.clientY - translateY;
                imgContainer.style.cursor = 'grabbing';
            }
        });

        overlay.addEventListener('mousemove', (e) => {
            if (!isDragging) return;
            e.preventDefault();
            translateX = e.clientX - startX;
            translateY = e.clientY - startY;
            imgContainer.style.transform = `translate(${translateX}px, ${translateY}px) scale(${scale})`;
        });

        overlay.addEventListener('mouseup', () => {
            isDragging = false;
            if (scale > 1) imgContainer.style.cursor = 'grab';
        });
        overlay.addEventListener('mouseleave', () => {
            isDragging = false;
        });

    } else if (type === 'video') {
        mediaEl = document.createElement('video');
        mediaEl.src = url;
        mediaEl.controls = true;
        mediaEl.autoplay = true;
        mediaEl.style.cssText = 'max-width:90vw; max-height:90vh; border-radius:12px; box-shadow:0 12px 48px rgba(0,0,0,0.8);';
        mediaEl.onclick = (e) => e.stopPropagation();
        overlay.appendChild(mediaEl);
    }

    // Kapatma butonu
    const closeBtn = document.createElement('div');
    closeBtn.innerHTML = '✕';
    closeBtn.className = 'media-preview-close';
    closeBtn.onclick = (e) => {
        e.stopPropagation();
        overlay.remove();
    };

    // Tıklayınca her halükarda kapansın (video dışında ve sürükleme değilse)
    let clickStartX, clickStartY;
    overlay.addEventListener('mousedown', (e) => {
        clickStartX = e.clientX;
        clickStartY = e.clientY;
    });
    overlay.addEventListener('click', (e) => {
        const deltaX = Math.abs(e.clientX - clickStartX);
        const deltaY = Math.abs(e.clientY - clickStartY);
        // Sürükleme yapmadıysa kapat
        if (deltaX < 5 && deltaY < 5 && e.target !== closeBtn && type !== 'video') {
            overlay.remove();
        }
    });

    overlay.appendChild(closeBtn);

    // Zoom talimatı (Sadece görsel için)
    if (type === 'image') {
        const helpText = document.createElement('div');
        helpText.textContent = window.i18n ? window.i18n.t('zoom_help') : 'Büyütmek için fare tekerleğini kullanın • Sürükleyerek gezinin • Kapatmak için tıklayın';
        helpText.className = 'media-preview-help';
        overlay.appendChild(helpText);
    }

    document.body.appendChild(overlay);
};

// ============================================
// ADMIN PANEL MANTIĞI
// ============================================

function checkAdminStatus() {
    const adminTabBtn = document.getElementById('admin-tab-btn');
    const adminTabSep = document.getElementById('admin-tab-separator');
    const adminTabLbl = document.getElementById('admin-tab-label');

    const isLocalhostHost = state.serverUrl.includes('localhost') || state.serverUrl.includes('127.0.0.1');

    if (isLocalhostHost) {
        if (adminTabBtn) adminTabBtn.style.display = 'flex';
        if (adminTabSep) adminTabSep.style.display = 'block';
        if (adminTabLbl) adminTabLbl.style.display = 'block';
    }
}

async function loadAdminRooms() {
    const listContainer = document.getElementById('admin-rooms-list');
    if (!listContainer) return;

    listContainer.innerHTML = '<div style="color:var(--text-muted); font-size:12px; text-align:center; padding:20px;">Odalar yükleniyor...</div>';

    try {
        const res = await fetch(`${state.serverUrl}/api/admin/rooms`);
        const data = await res.json();

        if (!data.success) {
            listContainer.innerHTML = `<div style="color:var(--accent-danger); font-size:12px; text-align:center; padding:20px;">Erişim Reddedildi veya Hata!</div>`;
            return;
        }

        if (data.rooms.length === 0) {
            listContainer.innerHTML = '<div style="color:var(--text-muted); font-size:12px; text-align:center; padding:20px;">Sunucuda kayıtlı oda bulunmuyor.</div>';
            return;
        }

        listContainer.innerHTML = '';
        data.rooms.forEach(room => {
            const item = document.createElement('div');
            item.style.cssText = 'display:flex; align-items:center; justify-content:space-between; background:rgba(255,255,255,0.03); border:1px solid rgba(255,255,255,0.05); padding:12px 16px; border-radius:8px;';

            let dateStr = new Date(room.created_at + 'Z').toLocaleString([], { dateStyle: 'short', timeStyle: 'short' });

            item.innerHTML = `
                <div style="display:flex; flex-direction:column; gap:4px;">
                    <span style="font-weight:600; font-size:14px;">#${room.room_key}</span>
                    <span style="font-size:11px; color:var(--text-muted);">
                        ${room.message_count} ${window.i18n ? window.i18n.t('admin_msg_count') : 'mesaj'} • ${room.online_count} ${window.i18n ? window.i18n.t('admin_online_count') : 'çevrimiçi'} • ${dateStr}
                    </span>
                </div>
                <button title="${window.i18n ? window.i18n.t('admin_del_room') : 'Bu odayı sil'}" class="admin-del-room-btn" data-key="${room.room_key}" style="background:rgba(239, 68, 68, 0.15); border:none; color:var(--accent-danger); width:32px; height:32px; border-radius:6px; cursor:pointer; display:flex; align-items:center; justify-content:center; transition:0.2s;">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
                </button>
            `;
            listContainer.appendChild(item);
        });

        // Silme butonlarına olay ata
        const delBtns = document.querySelectorAll('.admin-del-room-btn');
        delBtns.forEach(btn => {
            btn.addEventListener('click', async (e) => {
                const roomKey = e.currentTarget.dataset.key;
                if (confirm(window.i18n ? window.i18n.t('admin_confirm_del').replace('{key}', roomKey) : `'${roomKey}' odasını ve tüm mesajlarını silmek istediğine emin misin?`)) {
                    await fetch(`${state.serverUrl}/api/admin/rooms/${roomKey}`, { method: 'DELETE' });
                    loadAdminRooms();
                }
            });
        });

    } catch (err) {
        listContainer.innerHTML = `<div style="color:var(--text-muted); font-size:12px; text-align:center; padding:20px;">${window.i18n ? window.i18n.t('admin_server_error') : 'Sunucuya bağlanılamadı.'}</div>`;
    }
}

// Tüm odaları temizle butonu
document.addEventListener('DOMContentLoaded', () => {
    const btnDeleteAll = document.getElementById('btn-admin-delete-all');
    if (btnDeleteAll) {
        btnDeleteAll.addEventListener('click', async () => {
            if (confirm(window.i18n ? window.i18n.t('admin_confirm_del_all') : "DİKKAT! Sunucudaki TÜM odalar ve mesajlar silinecek. Emin misiniz?")) {
                try {
                    await fetch(`${state.serverUrl}/api/admin/rooms`, { method: 'DELETE' });
                    loadAdminRooms();
                } catch (e) {
                    alert(window.i18n ? window.i18n.t('admin_error') : "Bir hata oluştu.");
                }
            }
        });
    }

    // Admin durumunu kontrol et
    setTimeout(checkAdminStatus, 500);
});

// Başlat
initialize();
