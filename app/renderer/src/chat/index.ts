/**
 * index.ts — Chat Modülü Ana Giriş Noktası
 *
 * Tüm alt modülleri bir araya getirip uygulamayı başlatır.
 * Vite bu dosyayı chat.html'in script entry noktası olarak bundle'lar.
 */

// ── CSS imports (Vite bundle'a dahil eder) ──
import '../../css/style.css';
import '../../css/soft-login.css';
import '../../css/antigravity.css';

import { state, voiceState, stopRingtone } from './state';
import { el } from './elements';
import { setPendingE2EEInit, createE2EEReadyPromise } from './e2ee';
import { encryptMessage } from './e2ee';
import { connectSocket } from './socket';
import { sendMessage, scrollToBottom } from './messages';
import { showToast } from './ui/toast';
import { setupWindowControls } from './ui/users';
import { setupAdminEvents, loadAdminRooms } from './ui/admin';
import { loadAudioDevices } from './ui/voice-ui';
import { escapeHtml } from './utils';
import { rtcConfig, initiateVoiceCall, joinVoiceRoom, leaveVoiceRoom, toggleMic, toggleVideo, toggleScreen, startScreenShareWithStream } from './voice';

// ── UI modüllerini import et (side-effects: window globals set edilir) ──
import '../i18n';
import '../matrix';
import '../antigravity';
import './ui/media-preview';
import './ui/voice-player';
import './ui/modals';
import { initPinnedMessages } from './ui/pinned';

// ── initialize ──

async function initialize(): Promise<void> {
    // Temayı Yükle
    const savedTheme = localStorage.getItem('haven_login_theme') || 'space';
    document.documentElement.setAttribute('data-theme', savedTheme);

    // Gürültü Engelleme Yükle
    const savedNoiseSetting = localStorage.getItem('haven_noise_suppression');
    const chatNoiseCheckbox = document.getElementById('settings-noise-suppression') as HTMLInputElement | null;
    if (chatNoiseCheckbox && savedNoiseSetting === 'false') {
        chatNoiseCheckbox.checked = false;
    }

    // Güvenlik Check
    if (!state.nickname || !state.roomKey || !state.authKey || !state.roomPassword) {
        if (window.electronAPI?.navigateToLogin) {
            window.electronAPI.navigateToLogin();
        } else {
            window.location.href = 'login.html';
        }
        return;
    }

    // E2EE hazırlığı
    setPendingE2EEInit(true);
    createE2EEReadyPromise();

    // Pinned messages init
    initPinnedMessages();

    // UI'da Odayı yaz
    if (el.roomNameDisplay) el.roomNameDisplay.textContent = state.roomKey;

    connectSocket();
    setupEventListeners();
    setupWindowControls();

    if ('Notification' in window && Notification.permission !== 'denied' && Notification.permission !== 'granted') {
        Notification.requestPermission();
    }
}

// ── setupEventListeners ──

function setupEventListeners(): void {
    // Mesaj Gönderme
    el.btnSend?.addEventListener('click', sendMessage);
    el.messageInput?.addEventListener('keydown', (e: KeyboardEvent) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            sendMessage();
        } else {
            handleTyping();
        }
    });

    el.btnSelfDestruct?.addEventListener('click', () => {
        state.isSelfDestructText = !state.isSelfDestructText;
        if (state.isSelfDestructText) {
            el.btnSelfDestruct!.style.background = 'rgba(239, 68, 68, 0.15)';
            el.btnSelfDestruct!.style.color = '#ef4444';
            el.btnSelfDestruct!.style.boxShadow = '0 0 10px rgba(239, 68, 68, 0.3)';
            if (el.messageInput) {
                el.messageInput.placeholder = 'Kendini imha eden mesaj yaz...';
                el.messageInput.style.borderColor = 'rgba(239, 68, 68, 0.5)';
            }
        } else {
            el.btnSelfDestruct!.style.background = 'none';
            el.btnSelfDestruct!.style.color = 'var(--text-muted)';
            el.btnSelfDestruct!.style.boxShadow = 'none';
            if (el.messageInput) {
                el.messageInput.placeholder = 'Mesajınızı yazın...';
                el.messageInput.style.borderColor = 'transparent';
            }
        }
    });

    // Yazıyor göstergesi
    el.messageInput?.addEventListener('input', () => {
        if (!state.socket) return;
        const now = Date.now();
        if (!(state as any)._lastTypingEmit || now - (state as any)._lastTypingEmit > 1500) {
            (state as any)._lastTypingEmit = now;
            state.socket.emit('typing', { isTyping: true });
        }
        clearTimeout((state as any)._typingTimeout);
        (state as any)._typingTimeout = setTimeout(() => {
            (state as any)._lastTypingEmit = 0;
            state.socket!.emit('typing', { isTyping: false });
        }, 1000);
    });

    // Dosya Ekleme
    el.btnAttachFile?.addEventListener('click', () => el.fileInput?.click());
    el.fileInput?.addEventListener('change', async (e: Event) => {
        const file = (e.target as HTMLInputElement).files?.[0];
        if (file) {
            if (file.type.startsWith('image/')) {
                window.addPendingImage(file);
            } else {
                await window.sendP2PFile(file);
            }
            (e.target as HTMLInputElement).value = '';
        }
    });

    // ── P2P File Send ──
    window.sendP2PFile = async (file: File) => {
        if (!file) return;
        window.pendingP2PFiles = window.pendingP2PFiles || {};
        const fileId = 'file_' + Date.now() + '_' + Math.floor(Math.random() * 10000);
        window.pendingP2PFiles[fileId] = file;

        const fileMsgContent = JSON.stringify({
            fileId,
            filename: file.name || (file.type.startsWith('image/') ? `image_${Date.now()}.${file.type.split('/')[1]}` : 'clipboard_file'),
            mimetype: file.type || 'application/octet-stream',
            size: file.size,
            senderId: state.socket!.id
        });

        const encryptedContent = await encryptMessage(fileMsgContent);
        state.socket!.emit('send-message', {
            content: encryptedContent,
            type: 'p2p-announce',
            replyTo: state.replyingTo ? state.replyingTo.id : null
        });
        window.cancelReply();
    };

    // ── P2P Download ──
    window.startP2PDownload = async (fileId: string, targetId: string, filename: string, size: number, isAuto = false) => {
        const btn = document.getElementById(`p2p-btn-${fileId}`);
        if (btn) btn.style.display = 'none';
        const progressDiv = document.getElementById(`p2p-progress-receiver-${fileId}`);
        if (progressDiv) progressDiv.style.display = 'block';

        const pc = new RTCPeerConnection(rtcConfig);
        const dc = pc.createDataChannel('fileTransfer');
        let receivedBuffers: ArrayBuffer[] = [];
        let receivedSize = 0;
        let isPaused = false;
        let isCancelled = false;

        const pauseBtn = document.getElementById(`p2p-pause-${fileId}`);
        const cancelBtn = document.getElementById(`p2p-cancel-${fileId}`);
        if (pauseBtn) {
            pauseBtn.onclick = () => {
                isPaused = !isPaused;
                pauseBtn.textContent = isPaused ? '▶ Devam' : '⏸ Duraklat';
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

        dc.onmessage = async (e: MessageEvent) => {
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
                        receivedBuffers = [];
                        const blobUrl = URL.createObjectURL(blob);
                        if (isAuto) {
                            const imgBox = document.getElementById(`p2p-img-box-${fileId}`);
                            if (imgBox) imgBox.innerHTML = `<img src="${blobUrl}" style="max-width:300px; width:100%; border-radius:8px; display:block; cursor:zoom-in;" onclick="window.previewMedia(this.src, 'image')" alt="${escapeHtml(filename)}">`;
                        } else {
                            const textEl = document.getElementById(`p2p-text-receiver-${fileId}`);
                            if (textEl) textEl.textContent = '✅ Tamamlandı!';
                            if (pauseBtn) pauseBtn.style.display = 'none';
                            if (cancelBtn) cancelBtn.style.display = 'none';
                            const a = document.createElement('a');
                            a.href = blobUrl;
                            a.download = filename;
                            a.click();
                        }
                    }
                } catch (_ex) { /* ignore */ }
            } else {
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
            if (e.candidate) state.socket!.emit('p2p-file-candidate', { targetId, candidate: e.candidate, fileId });
        };

        window.p2pConnections = window.p2pConnections || {};
        window.p2pConnections[fileId] = pc;

        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        state.socket!.emit('p2p-file-offer', { targetId, offer, fileMeta: { fileId } });
    };

    // ── Clipboard paste ──
    el.messageInput?.addEventListener('paste', async (e: ClipboardEvent) => {
        const clipboardData = e.clipboardData;
        if (!clipboardData) return;
        let handled = false;
        const items = clipboardData.items;
        for (let i = 0; i < items.length; i++) {
            const item = items[i];
            if (item.kind === 'file' && item.type.startsWith('image/')) {
                const blob = item.getAsFile();
                if (blob) { e.preventDefault(); handled = true; window.addPendingImage(blob); }
            }
        }
        if (!handled) {
            const text = clipboardData.getData('text');
            if (text && (text.match(/\.(jpeg|jpg|gif|png|webp|svg)$/i) || text.startsWith('data:image/'))) {
                try {
                    const res = await fetch(text);
                    const blob = await res.blob();
                    if (blob && blob.type.startsWith('image/')) { e.preventDefault(); window.addPendingImage(blob); }
                } catch (_err) { /* ignore */ }
            }
        }
    });

    // ── Image Preview Modal ──
    window.addPendingImage = (blob: Blob) => {
        state.pendingImages.push(blob);
        state.currentPreviewIndex = state.pendingImages.length - 1;
        state.viewOnceEnabled = false;
        openImagePreviewModal();
    };

    window.removePendingImage = (index: number) => {
        state.pendingImages.splice(index, 1);
        if (state.pendingImages.length === 0) { closeImagePreviewModal(); return; }
        if (state.currentPreviewIndex >= state.pendingImages.length) state.currentPreviewIndex = state.pendingImages.length - 1;
        renderImageSendPreview();
    };

    function openImagePreviewModal(): void {
        const modal = document.getElementById('modal-image-send-preview');
        if (modal) { modal.style.display = 'flex'; renderImageSendPreview(); }
    }

    function closeImagePreviewModal(): void {
        const modal = document.getElementById('modal-image-send-preview');
        if (modal) {
            modal.style.display = 'none';
            state.pendingImages = [];
            const captionInput = document.getElementById('preview-caption-input') as HTMLInputElement | null;
            if (captionInput) captionInput.value = '';
        }
    }

    function renderImageSendPreview(): void {
        const fullImg = document.getElementById('preview-full-image') as HTMLImageElement | null;
        const thumbContainer = document.getElementById('preview-thumbnails');
        if (!fullImg || !thumbContainer) return;

        const currentBlob = state.pendingImages[state.currentPreviewIndex];
        const url = URL.createObjectURL(currentBlob);
        fullImg.src = url;
        fullImg.onload = () => URL.revokeObjectURL(url);

        const addMoreBtn = document.getElementById('btn-preview-add-more');
        thumbContainer.innerHTML = '';
        state.pendingImages.forEach((blob, idx) => {
            const tUrl = URL.createObjectURL(blob);
            const thumb = document.createElement('div');
            thumb.className = `thumb-item ${idx === state.currentPreviewIndex ? 'active' : ''}`;
            thumb.innerHTML = `<img src="${tUrl}" onload="URL.revokeObjectURL('${tUrl}')">`;
            thumb.onclick = () => { state.currentPreviewIndex = idx; renderImageSendPreview(); };
            thumbContainer.appendChild(thumb);
        });
        if (addMoreBtn) thumbContainer.appendChild(addMoreBtn);
        const captionInput = document.getElementById('preview-caption-input') as HTMLInputElement | null;
        if (captionInput) captionInput.focus();
    }

    document.getElementById('btn-close-image-preview')?.addEventListener('click', closeImagePreviewModal);
    document.getElementById('btn-toggle-view-once')?.addEventListener('click', () => {
        state.viewOnceEnabled = !state.viewOnceEnabled;
        document.getElementById('btn-toggle-view-once')?.classList.toggle('active', state.viewOnceEnabled);
    });
    document.getElementById('btn-preview-add-more')?.addEventListener('click', () => el.fileInput?.click());
    document.getElementById('btn-send-from-preview')?.addEventListener('click', () => sendMessageFromPreview());
    document.getElementById('preview-caption-input')?.addEventListener('keydown', (e: KeyboardEvent) => {
        if (e.key === 'Enter') sendMessageFromPreview();
    });

    async function sendMessageFromPreview(): Promise<void> {
        const captionInput = document.getElementById('preview-caption-input') as HTMLInputElement | null;
        const caption = captionInput?.value.trim();
        const hasImages = state.pendingImages.length > 0;

        if (hasImages) {
            for (const blob of state.pendingImages) {
                try {
                    let filename: string;
                    if ((blob as File).name && (blob as File).name !== 'image.png') {
                        filename = (blob as File).name;
                    } else {
                        const extMap: Record<string, string> = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/webp': 'webp' };
                        filename = `image_${Date.now()}.${extMap[blob.type] || 'png'}`;
                    }
                    const file = new File([blob], filename, { type: blob.type });
                    await window.uploadFileToChat(file);
                } catch (err) {
                    showToast(window.i18n ? window.i18n.t('image_send_fail') : 'Görsel gönderilemedi!', 'error');
                }
            }
        }
        if (caption) {
            const encryptedContent = await encryptMessage(caption);
            state.socket!.emit('send-message', { content: encryptedContent, type: 'message', replyTo: state.replyingTo ? state.replyingTo.id : null });
        }
        closeImagePreviewModal();
    }

    // ── File Upload ──
    window.uploadFileToChat = async (file: File) => {
        if (!file) return;
        const formData = new FormData();
        formData.append('file', file);

        const progressContainer = document.getElementById('upload-progress-container');
        const progressBar = document.getElementById('upload-progress-bar');
        const filenameLabel = document.getElementById('upload-filename');
        const percentageLabel = document.getElementById('upload-percentage');

        if (progressContainer) {
            progressContainer.style.display = 'block';
            if (filenameLabel) filenameLabel.textContent = file.name;
            if (progressBar) progressBar.style.width = '0%';
            if (percentageLabel) percentageLabel.textContent = '0%';
        }

        return new Promise<any>((resolve, reject) => {
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
                        const fileData = JSON.stringify({ url: res.url, filename: res.filename, mimetype: res.mimetype, size: file.size });
                        const encryptedContent = await encryptMessage(fileData);
                        state.socket!.emit('send-message', { content: encryptedContent, type: 'file', replyTo: state.replyingTo ? state.replyingTo.id : null });
                        resolve(res);
                    } else {
                        showToast(res.message || 'Yükleme başarısız!', 'error');
                        reject(new Error(res.message));
                    }
                } else {
                    let errMsg = 'Sunucu hatası!';
                    try { const errRes = JSON.parse(xhr.responseText); if (errRes.message) errMsg = errRes.message; } catch (_) { /* */ }
                    showToast(errMsg, 'error');
                    reject(new Error(errMsg));
                }
            };

            xhr.onerror = () => {
                if (progressContainer) progressContainer.style.display = 'none';
                showToast('Bağlantı hatası!', 'error');
                reject(new Error('Network error'));
            };

            xhr.send(formData);
        });
    };

    // ── Logout ──
    el.btnLogout?.addEventListener('click', () => {
        window.showConfirmModal(window.i18n ? window.i18n.t('msg_leave_room') : 'Gizli odadan çıkmak istediğinize emin misiniz?', () => {
            localStorage.removeItem('haven_room');
            localStorage.removeItem('haven_auth_key');
            sessionStorage.removeItem('haven_session_password');
            if (window.electronAPI?.navigateToLogin) window.electronAPI.navigateToLogin();
            else window.location.href = 'login.html';
        });
    });

    // ── Users modal ──
    el.headerUserCount?.addEventListener('click', () => el.modalUsers?.classList.add('visible'));
    el.btnCloseUsersModal?.addEventListener('click', () => el.modalUsers?.classList.remove('visible'));

    // ── Settings (placeholder — orijinal koddan korunmuş mantık) ──
    setupSettingsModal();

    // ── Voice buttons ──
    el.btnJoinVoice?.addEventListener('click', () => initiateVoiceCall(false));
    el.btnJoinVideo?.addEventListener('click', () => initiateVoiceCall(true));
    el.btnLeaveVoice?.addEventListener('click', leaveVoiceRoom);
    el.btnToggleMic?.addEventListener('click', toggleMic);
    el.btnToggleVideo?.addEventListener('click', toggleVideo);
    el.btnToggleScreen?.addEventListener('click', toggleScreen);

    // ── Incoming call modal ──
    el.btnDeclineCall?.addEventListener('click', () => {
        el.modalIncomingCall?.classList.remove('visible');
        stopRingtone();
        if (state.socket) state.socket.emit('voice-call-declined', { username: state.nickname });
    });
    el.btnAcceptCall?.addEventListener('click', () => {
        el.modalIncomingCall?.classList.remove('visible');
        stopRingtone();
        joinVoiceRoom(false);
        if (el.activeCallBanner) el.activeCallBanner.style.display = 'none';
    });
    el.activeCallJoinBtn?.addEventListener('click', () => {
        stopRingtone();
        el.modalIncomingCall?.classList.remove('visible');
        joinVoiceRoom(false);
        if (el.activeCallBanner) el.activeCallBanner.style.display = 'none';
    });

    // ── Context menu ──
    document.addEventListener('click', (e: MouseEvent) => {
        const userMenu = document.getElementById('user-context-menu');
        const triggerArea = (e.target as HTMLElement).closest('[oncontextmenu]');
        if (userMenu && !userMenu.contains(e.target as Node) && !triggerArea) userMenu.style.display = 'none';
    });

    // ── Beforeunload ──
    window.addEventListener('beforeunload', () => {
        if (voiceState.isInVoice) leaveVoiceRoom();
    });
}

// ── Settings Modal Setup ──

function setupSettingsModal(): void {
    if (!el.btnChatSettings || !el.chatSettingsModal) return;

    const colors = ['#6366f1', '#ef4444', '#10b981', '#f59e0b', '#0ea5e9', '#ec4899', '#8b5cf6', '#14b8a6', '#000000'];
    if (el.chatColorPickerContainer) {
        colors.forEach(color => {
            const btn = document.createElement('div');
            btn.dataset.color = color;
            btn.style.cssText = `width:24px;height:24px;border-radius:50%;background-color:${color};cursor:pointer;border:${color === state.avatarColor ? '2px solid white' : '2px solid transparent'};transition:0.2s;`;
            btn.onclick = () => {
                Array.from(el.chatColorPickerContainer!.children).forEach((c: Element) => {
                    (c as HTMLElement).style.border = '2px solid transparent';
                    (c as HTMLElement).style.boxShadow = 'none';
                });
                btn.style.border = '2px solid white';
                btn.style.boxShadow = `0 0 10px ${color}80`;
                if (el.chatAvatarColorInput) el.chatAvatarColorInput.value = color;
                if (el.chatColorPreviewText) el.chatColorPreviewText.style.color = color;
            };
            el.chatColorPickerContainer!.appendChild(btn);
        });
    }

    el.btnChatSettings.addEventListener('click', () => {
        if (el.chatUsernameInput) el.chatUsernameInput.value = state.nickname || '';
        if (el.chatAvatarColorInput) el.chatAvatarColorInput.value = state.avatarColor || '#6366f1';
        if (el.chatColorPreviewText) {
            el.chatColorPreviewText.textContent = state.nickname || 'Örnek Kullanıcı';
            el.chatColorPreviewText.style.color = state.avatarColor || '#6366f1';
        }
        if (el.chatThemeSelector) el.chatThemeSelector.value = localStorage.getItem('haven_login_theme') || 'space';
        if (el.chatLangSelect) el.chatLangSelect.value = localStorage.getItem('haven_app_lang') || 'tr';
        if (state.profilePic && el.chatAvatarPreviewImg) {
            el.chatAvatarPreviewImg.src = state.profilePic;
            el.chatAvatarPreviewImg.style.display = 'block';
            if (el.chatAvatarUploadIcon) el.chatAvatarUploadIcon.style.display = 'none';
        }
        el.chatSettingsModal!.style.display = 'flex';
        setTimeout(() => el.chatSettingsModal!.style.opacity = '1', 10);

        // Admin sekmesi zaten aktifse verileri tazele
        const adminTabBtn = document.getElementById('admin-tab-btn');
        if (adminTabBtn?.classList.contains('active')) {
            loadAdminRooms();
        }
    });

    const closeChatSettings = (): void => {
        const savedTheme = localStorage.getItem('haven_login_theme') || 'space';
        document.documentElement.setAttribute('data-theme', savedTheme);
        el.chatSettingsModal!.style.opacity = '0';
        setTimeout(() => {
            el.chatSettingsModal!.style.display = 'none';
        }, 300);
    };

    el.btnCloseChatSettings?.addEventListener('click', closeChatSettings);

    el.btnSaveChatSettings?.addEventListener('click', () => {
        const oldNickname = state.nickname;
        state.nickname = el.chatUsernameInput?.value.trim() || 'Kullanıcı';
        state.avatarColor = el.chatAvatarColorInput?.value || '#6366f1';

        localStorage.setItem('haven_nickname', state.nickname);
        localStorage.setItem('haven_avatar', state.avatarColor);
        if (state.profilePic) localStorage.setItem('haven_profile_pic', state.profilePic);
        else localStorage.removeItem('haven_profile_pic');

        if (el.chatThemeSelector) {
            document.documentElement.setAttribute('data-theme', el.chatThemeSelector.value);
            localStorage.setItem('haven_login_theme', el.chatThemeSelector.value);
        }
        if (el.chatLangSelect && window.i18n) window.i18n.setLanguage(el.chatLangSelect.value);

        const micSelect = document.getElementById('settings-mic-select') as HTMLSelectElement | null;
        const speakerSelect = document.getElementById('settings-speaker-select') as HTMLSelectElement | null;
        if (micSelect?.value) localStorage.setItem('haven_mic_device', micSelect.value);
        if (speakerSelect?.value) localStorage.setItem('haven_speaker_device', speakerSelect.value);

        if (state.socket) {
            state.socket.emit('update-profile', {
                oldNickname, nickname: state.nickname, avatarColor: state.avatarColor, profilePic: state.profilePic
            });
        }

        closeChatSettings();
        showToast(window.i18n ? window.i18n.t('settings_saved') : 'Ayarları kaydettiniz!', 'success');
    });

    // Eski listener, aşağıda clone edilerek değiştirildi

    el.chatAvatarUpload?.addEventListener('change', (e: Event) => {
        const file = (e.target as HTMLInputElement).files?.[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = (evt) => {
            const img = new Image();
            img.onload = () => {
                const canvas = document.createElement('canvas');
                let width = img.width, height = img.height;
                if (width > 128) { height *= 128 / width; width = 128; }
                if (height > 128) { width *= 128 / height; height = 128; }
                canvas.width = width;
                canvas.height = height;
                canvas.getContext('2d')!.drawImage(img, 0, 0, width, height);
                state.profilePic = canvas.toDataURL('image/jpeg', 0.8);
                if (el.chatAvatarPreviewImg) {
                    el.chatAvatarPreviewImg.src = state.profilePic;
                    el.chatAvatarPreviewImg.style.display = 'block';
                }
                if (el.chatAvatarUploadIcon) el.chatAvatarUploadIcon.style.display = 'none';
            };
            img.src = evt.target!.result as string;
        };
        reader.readAsDataURL(file);
    });

    if (el.chatThemeSelector) {
        el.chatThemeSelector.addEventListener('change', (e: Event) => {
            document.documentElement.setAttribute('data-theme', (e.target as HTMLSelectElement).value);
        });
    }

    // ── Ses Testleri (Mikrofon & Hoparlör) ──
    let chatMicTestStream: MediaStream | null = null;
    let chatMicTestAnimFrame: number | null = null;

    function chatStopMicTest(): void {
        if (chatMicTestAnimFrame) cancelAnimationFrame(chatMicTestAnimFrame);
        if (chatMicTestStream) {
            chatMicTestStream.getTracks().forEach(t => t.stop());
            chatMicTestStream = null;
        }
        const container = document.getElementById('mic-level-container');
        const bar = document.getElementById('mic-level-bar');
        if (container) container.style.display = 'none';
        if (bar) (bar as HTMLElement).style.width = '0%';
        const btn = document.getElementById('btn-test-mic');
        if (btn) btn.textContent = '🎙️ Mikrofonu Test Et';
    }

    const btnTestMic = document.getElementById('btn-test-mic');
    if (btnTestMic) {
        btnTestMic.addEventListener('click', async () => {
            if (chatMicTestStream) { chatStopMicTest(); return; }

            const micSelect = document.getElementById('settings-mic-select') as HTMLSelectElement | null;
            const deviceId = micSelect?.value || undefined;

            try {
                const constraints: MediaStreamConstraints = { audio: deviceId ? { deviceId: { exact: deviceId } } : true };
                chatMicTestStream = await navigator.mediaDevices.getUserMedia(constraints);

                btnTestMic.textContent = '⏹️ Testi Durdur';
                const container = document.getElementById('mic-level-container');
                const bar = document.getElementById('mic-level-bar') as HTMLElement | null;
                if (container) container.style.display = 'block';

                const testCtx = new AudioContext();
                const source = testCtx.createMediaStreamSource(chatMicTestStream);
                const analyser = testCtx.createAnalyser();
                analyser.fftSize = 256;
                analyser.smoothingTimeConstant = 0.5;
                source.connect(analyser);
                const dataArray = new Uint8Array(analyser.frequencyBinCount);

                function updateBar(): void {
                    analyser.getByteFrequencyData(dataArray);
                    let sum = 0;
                    for (let i = 0; i < dataArray.length; i++) sum += dataArray[i];
                    const avg = sum / dataArray.length;
                    const percent = Math.min(100, (avg / 50) * 100);
                    if (bar) bar.style.width = percent + '%';
                    chatMicTestAnimFrame = requestAnimationFrame(updateBar);
                }
                updateBar();
            } catch (err) {
                const error = err as DOMException;
                if ((window as any).showAlertModal) (window as any).showAlertModal('Mikrofon erişilemedi: ' + error.message);
            }
        });
    }

    const btnTestSpeaker = document.getElementById('btn-test-speaker');
    if (btnTestSpeaker) {
        btnTestSpeaker.addEventListener('click', () => {
            const speakerSelect = document.getElementById('settings-speaker-select') as HTMLSelectElement | null;
            const testAudio = new Audio('../../assets/notification.mp3');

            if (speakerSelect?.value && typeof (testAudio as any).setSinkId === 'function') {
                (testAudio as any).setSinkId(speakerSelect.value).then(() => {
                    testAudio.play();
                }).catch((e: Error) => {
                    console.warn('setSinkId hatası:', e);
                    testAudio.play();
                });
            } else {
                testAudio.play();
            }
        });
    }

    // Modal kapanırken testi durdur
    function closeChatSettingsWrapper() {
        chatStopMicTest();
        closeChatSettings();
    }

    // Override the click listener for closing settings
    const btnCloseChatSettings = document.getElementById('btn-close-chat-settings');
    if (btnCloseChatSettings) {
        const newBtn = btnCloseChatSettings.cloneNode(true);
        btnCloseChatSettings.parentNode?.replaceChild(newBtn, btnCloseChatSettings);
        newBtn.addEventListener('click', closeChatSettingsWrapper);
    }
    
    el.chatSettingsModal.addEventListener('click', (e: MouseEvent) => {
        if (e.target === el.chatSettingsModal) closeChatSettingsWrapper();
    });

    // Settings Modal Tab Logic
    const settingsTabs = document.querySelectorAll('.settings-tab');
    const settingsPanels = document.querySelectorAll('.settings-panel');

    settingsTabs.forEach(tab => {
        tab.addEventListener('click', () => {
            settingsTabs.forEach(t => t.classList.remove('active'));
            tab.classList.add('active');

            const tabName = (tab as HTMLElement).dataset.tab;
            settingsPanels.forEach(p => (p as HTMLElement).style.display = 'none');
            const panel = document.getElementById(`panel-${tabName}`);
            if (panel) panel.style.display = 'block';

            if (tabName === 'ses') {
                loadAudioDevices();
            }

            if (tabName === 'admin') {
                loadAdminRooms();
            }
        });
    });
}

// ── Mobile Menu (IIFE) ──

(function setupMobileMenu(): void {
    const btnMenu = document.getElementById('btn-mobile-menu');
    const dropdown = document.getElementById('mobile-dropdown-menu');
    if (!btnMenu || !dropdown) return;

    btnMenu.addEventListener('click', (e: Event) => {
        e.stopPropagation();
        dropdown.style.display = dropdown.style.display === 'block' ? 'none' : 'block';
    });

    document.addEventListener('click', (e: Event) => {
        if (!dropdown.contains(e.target as Node) && e.target !== btnMenu) dropdown.style.display = 'none';
    });

    function mobileAction(btnId: string, action: () => void): void {
        const btn = document.getElementById(btnId);
        if (!btn) return;
        btn.addEventListener('click', (e: Event) => {
            e.stopPropagation();
            dropdown!.style.display = 'none';
            action();
        });
    }

    mobileAction('mobile-btn-voice', () => el.btnJoinVoice?.click());
    mobileAction('mobile-btn-video', () => el.btnJoinVideo?.click());
    mobileAction('mobile-btn-settings', () => el.btnChatSettings?.click());
    mobileAction('mobile-btn-logout', () => el.btnLogout?.click());
})();

// ── Voice Recording (IIFE) ──

(function setupVoiceRecording(): void {
    const btnRecord = document.getElementById('btn-voice-record');
    const recordBar = document.getElementById('voice-record-bar');
    const btnCancel = document.getElementById('voice-record-cancel');
    const btnSend = document.getElementById('voice-record-send');
    const timerEl = document.getElementById('voice-record-timer');
    const waveformCanvas = document.getElementById('voice-record-waveform') as HTMLCanvasElement | null;
    const inputWrapper = document.querySelector('.chat-input-wrapper') as HTMLElement | null;

    if (!btnRecord || !recordBar) return;

    let mediaRecorder: MediaRecorder | null = null;
    let audioChunks: Blob[] = [];
    let recordingStream: MediaStream | null = null;
    let analyser: AnalyserNode | null = null;
    let recAudioContext: AudioContext | null = null;
    let animFrame: number | null = null;
    let timerInterval: ReturnType<typeof setInterval> | null = null;
    let startTime = 0;

    function formatTime(seconds: number): string {
        const m = Math.floor(seconds / 60);
        const s = Math.floor(seconds % 60);
        return `${m}:${s.toString().padStart(2, '0')}`;
    }

    function drawWaveform(): void {
        if (!analyser || !waveformCanvas) return;
        const ctx = waveformCanvas.getContext('2d')!;
        const bufferLength = analyser.frequencyBinCount;
        const dataArray = new Uint8Array(bufferLength);

        function draw(): void {
            animFrame = requestAnimationFrame(draw);
            analyser!.getByteTimeDomainData(dataArray);
            const w = waveformCanvas!.width, h = waveformCanvas!.height;
            ctx.clearRect(0, 0, w, h);
            ctx.lineWidth = 2;
            ctx.strokeStyle = '#8496a0';
            ctx.beginPath();
            const sliceWidth = w / bufferLength;
            let x = 0;
            for (let i = 0; i < bufferLength; i++) {
                const v = dataArray[i] / 128.0;
                const y = v * h / 2;
                if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
                x += sliceWidth;
            }
            ctx.lineTo(w, h / 2);
            ctx.stroke();
        }
        draw();
    }

    async function startRecording(): Promise<void> {
        try {
            recordingStream = await navigator.mediaDevices.getUserMedia({ audio: true });
            recAudioContext = new AudioContext();
            const source = recAudioContext.createMediaStreamSource(recordingStream);
            analyser = recAudioContext.createAnalyser();
            analyser.fftSize = 256;
            source.connect(analyser);

            mediaRecorder = new MediaRecorder(recordingStream);
            audioChunks = [];
            mediaRecorder.ondataavailable = (e: BlobEvent) => { if (e.data.size > 0) audioChunks.push(e.data); };
            mediaRecorder.start();
            startTime = Date.now();

            if (inputWrapper) inputWrapper.style.display = 'none';
            recordBar!.style.display = 'flex';
            timerInterval = setInterval(() => {
                if (timerEl) timerEl.textContent = formatTime((Date.now() - startTime) / 1000);
            }, 100);
            drawWaveform();
        } catch (err) {
            showToast('Mikrofon erişimi reddedildi!', 'error');
        }
    }

    function stopRecording(): void {
        if (animFrame) cancelAnimationFrame(animFrame);
        if (timerInterval) clearInterval(timerInterval);
        if (mediaRecorder && mediaRecorder.state !== 'inactive') mediaRecorder.stop();
        if (recordingStream) recordingStream.getTracks().forEach(t => t.stop());
        if (recAudioContext) recAudioContext.close();
        recordBar!.style.display = 'none';
        if (inputWrapper) inputWrapper.style.display = 'flex';
        if (timerEl) timerEl.textContent = '0:00';
    }

    btnRecord.addEventListener('click', startRecording);
    btnCancel?.addEventListener('click', () => { stopRecording(); audioChunks = []; });
    btnSend?.addEventListener('click', () => {
        if (!mediaRecorder || mediaRecorder.state === 'inactive') return;
        mediaRecorder.onstop = async () => {
            const blob = new Blob(audioChunks, { type: 'audio/webm' });
            audioChunks = [];
            const formData = new FormData();
            formData.append('file', blob, `sesli-mesaj-${Date.now()}.webm`);
            try {
                const response = await fetch(`${state.serverUrl}/api/upload`, { method: 'POST', body: formData });
                const data = await response.json();
                if (data.success) {
                    const fileMsgContent = JSON.stringify({ url: data.url, filename: data.filename, mimetype: 'audio/webm' });
                    const encryptedContent = await encryptMessage(fileMsgContent);
                    state.socket!.emit('send-message', { content: encryptedContent, type: 'file', replyTo: state.replyingTo ? state.replyingTo.id : null });
                    window.cancelReply();
                } else {
                    showToast('Ses kaydı yüklenemedi: ' + data.message, 'error');
                }
            } catch (_err) {
                showToast('Ses kaydı gönderilemedi!', 'error');
            }
        };
        stopRecording();
    });
})();

// ── Admin Panel ──
setupAdminEvents();

// ── Başlat ──
initialize();
