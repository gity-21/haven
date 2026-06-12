/**
 * socket.ts — Socket.IO Bağlantı ve Olay Yönetimi
 *
 * Sunucu bağlantısı, mesaj dinleme, typing indicator,
 * WebRTC signaling ve P2P dosya sinyalleri.
 */

import { io, Socket } from 'socket.io-client';
import { state, voiceState, activeNotifications, playRingtone, stopRingtone } from './state';
import { el } from './elements';
import { escapeHtml, clientSanitize, linkify } from './utils';
import { decryptMessage, getE2EEReadyPromise, setE2EEKey, isPendingE2EEInit, setPendingE2EEInit, deriveE2EEKey, resolveE2EEReady } from './e2ee';
import { showToast } from './ui/toast';
import { renderUsersModal } from './ui/users';
import { updateActiveCallBanner, createMediaElement, setupVolumeMeter, updateScreenShareBadge } from './ui/voice-ui';
import { appendMessage, scrollToBottom, updateStatus, buildReactionsHtml } from './messages';
import { createPeerConnection, removePeerConnection, joinVoiceRoom, leaveVoiceRoom, rtcConfig } from './voice';

/**
 * Socket.IO bağlantısını başlatır ve tüm olayları dinler.
 */
export function connectSocket(): void {
    if (state.socket) state.socket.disconnect();

    updateStatus(window.i18n ? window.i18n.t('connecting') : 'Bağlanıyor...', 'connecting');

    if (typeof io === 'undefined') {
        updateStatus(window.i18n ? window.i18n.t('socketio_fail') : 'Socket.IO kütüphanesi yüklenemedi!', 'reconnecting');
        showToast(window.i18n ? window.i18n.t('socketio_fail') : 'Socket.IO yüklenemedi.', 'error');
        return;
    }

    let cleanUrl = state.serverUrl.replace(/\/+$/, '');

    state.socket = io(cleanUrl, {
        reconnectionDelayMax: 5000,
        transports: ['websocket', 'polling'],
        upgrade: true,
        extraHeaders: { 'Bypass-Tunnel-Reminder': 'true' }
    }) as Socket;

    // ── E2EE Salt ──
    state.socket.on('room-e2ee-salt', async ({ salt }: { salt: string | null }) => {
        if (!isPendingE2EEInit()) return;
        setPendingE2EEInit(false);
        const pw = state.roomPassword;
        if (!pw) {
            console.error('[E2EE] Şifre bulunamadı.');
            resolveE2EEReady();
            return;
        }
        try {
            const key = await deriveE2EEKey(pw, salt || null);
            setE2EEKey(key);
            sessionStorage.removeItem('haven_session_password');
            state.roomPassword = null;
            console.log('[E2EE] Anahtar türetildi.', salt ? '(per-room salt)' : '(legacy salt)');
        } catch (err) {
            console.error('[E2EE] Anahtar türetme hatası:', err);
            showToast(window.i18n ? window.i18n.t('security_fail') : 'Güvenlik sistemi başlatılamadı!', 'error');
        }
        resolveE2EEReady();
    });

    // ── Connect ──
    state.socket.on('connect', () => {
        console.log('[Bağlantı] Sunucuya bağlandı! Socket ID:', state.socket!.id);
        updateStatus('', 'connected');

        state.socket!.emit('join-room', {
            userId: state.userId,
            userSecret: state.userSecret,
            nickname: state.nickname,
            roomKey: state.roomKey,
            avatarColor: state.avatarColor,
            profilePic: state.profilePic,
            authKey: state.authKey,
            mode: state.joinMode
        });
    });

    // ── Errors ──
    state.socket.on('join-error', (errMsg: string) => {
        localStorage.setItem('haven_login_error', 'Odaya Bağlanılamadı: ' + errMsg);
        if (window.electronAPI?.navigateToLogin) window.electronAPI.navigateToLogin();
        else window.location.href = 'login.html';
    });

    state.socket.on('connect_error', (err: Error) => {
        console.error('[HATA] Sunucuya bağlanılamadı:', err.message);
        if (voiceState.isInVoice) leaveVoiceRoom();
        localStorage.setItem('haven_login_error', 'Sunucu bağlantısı koptu.');
        if (window.electronAPI?.navigateToLogin) window.electronAPI.navigateToLogin();
        else window.location.href = 'login.html';
    });

    state.socket.on('disconnect', () => {
        if (voiceState.isInVoice) leaveVoiceRoom();
        localStorage.setItem('haven_login_error', 'Sunucu bağlantısı koptu (Disconnect).');
        if (window.electronAPI?.navigateToLogin) window.electronAPI.navigateToLogin();
        else window.location.href = 'login.html';
    });

    // ── User events ──
    state.socket.on('user-joined', (data: { msg: string }) => showToast(data.msg, 'success'));
    state.socket.on('user-left', (data: { msg: string }) => showToast(data.msg, 'info'));

    state.socket.on('online-users', (users: any[]) => {
        state.users = users;
        if (el.headerOnlineText) {
            el.headerOnlineText.textContent = `${users.length} ${window.i18n ? window.i18n.t('online_count') : 'Çevrimiçi'}`;
        }
        renderUsersModal();
    });

    state.socket.on('username-changed', ({ oldUsername, newUsername, avatarColor, profilePic, userId }: any) => {
        document.querySelectorAll('.message-username').forEach(usernameEl => {
            if (usernameEl.textContent === oldUsername) usernameEl.textContent = newUsername;
        });

        if (userId) {
            const card = document.getElementById(`voice-card-${userId}`);
            if (card) {
                const nameSpan = card.querySelector('span');
                if (nameSpan) nameSpan.textContent = newUsername;
                const avatarDiv = document.getElementById(`avatar-${userId}`);
                if (avatarDiv) {
                    if (profilePic) {
                        avatarDiv.style.backgroundImage = `url('${profilePic}')`;
                        avatarDiv.style.backgroundColor = 'transparent';
                        avatarDiv.textContent = '';
                    } else {
                        avatarDiv.style.backgroundImage = 'none';
                        avatarDiv.style.backgroundColor = avatarColor || '#6366f1';
                        avatarDiv.textContent = newUsername.charAt(0).toUpperCase();
                    }
                }
            }
        }
    });

    state.socket.on('room-deleted', (data: { message: string }) => {
        let displayMessage = data.message;
        if (window.i18n) {
            if (displayMessage.includes('Bu oda sunucu yöneticisi tarafından')) displayMessage = window.i18n.t('msg_room_deleted_single');
            else if (displayMessage.includes('Tüm odalar')) displayMessage = window.i18n.t('msg_room_deleted_all');
        }
        if (window.showConfirmModal) {
            window.showConfirmModal(displayMessage, () => { window.location.href = 'login.html'; }, true);
        } else {
            alert(displayMessage);
            window.location.href = 'login.html';
        }
    });

    state.socket.on('admin-stats-update', () => {
        // Admin paneli açıksa (tab aktif ve settings modal görünür) oda listesini yenile
        const adminTabBtn = document.getElementById('admin-tab-btn');
        const settingsModal = document.getElementById('chat-settings-modal');
        const panelAdmin = document.getElementById('panel-admin');
        const isAdminPanelVisible = adminTabBtn?.classList.contains('active')
            && settingsModal && settingsModal.style.display !== 'none'
            && panelAdmin && panelAdmin.style.display !== 'none';
        if (isAdminPanelVisible) {
            import('./ui/admin').then(m => m.loadAdminRooms());
        }
    });

    state.socket.on('user-mic-state', ({ userId, isMicOn }: { userId: string, isMicOn: boolean }) => {
        import('./ui/voice-ui').then(m => m.updateMicStatusUI(userId, isMicOn));
    });

    state.socket.on('message-pinned', ({ messageId, isPinned }: { messageId: number, isPinned: boolean }) => {
        // Find message element and update visual
        const messageRow = document.querySelector(`.msg-row-wrapper[data-message-id='${messageId}']`);
        if (messageRow) {
            const badge = messageRow.querySelector('.pinned-badge');
            if (isPinned && !badge) {
                const pinBadge = document.createElement('div');
                pinBadge.innerHTML = '📌 <span data-lang-key="pinned_msg_badge" style="font-size:10px;">Sabitlendi</span>';
                pinBadge.className = 'pinned-badge';
                pinBadge.style.cssText = 'font-size:11px; color:var(--accent-warning); margin-bottom:4px; display:inline-flex; align-items:center; gap:4px; background:rgba(245,158,11,0.1); padding:2px 6px; border-radius:4px; font-weight:600;';
                messageRow.insertBefore(pinBadge, messageRow.querySelector('.message-text'));
            } else if (!isPinned && badge) {
                badge.remove();
            }
        }
        
        // Update pinned messages state
        // We need the full message object for updatePinnedMessage. We can construct a partial one if needed, or re-fetch history.
        // Or if we already have it rendered:
        const msgEl = document.querySelector(`.message-text[data-message-id='${messageId}']`);
        const usernameEl = msgEl?.closest('.message-content')?.querySelector('.message-username');
        if (msgEl && usernameEl) {
            import('./ui/pinned').then(m => {
                m.updatePinnedMessage({
                    id: messageId,
                    content: msgEl.innerHTML,
                    username: usernameEl.textContent || 'Bilinmeyen',
                    is_pinned: isPinned,
                    created_at: new Date().toISOString() // Fallback if not found
                }, isPinned);
            });
        }
    });

    // ── Messages ──
    state.socket.on('new-message', async (msg: any) => {
        if (el.emptyState) el.emptyState.style.display = 'none';

        const readyPromise = getE2EEReadyPromise();
        if (readyPromise) await readyPromise;

        msg.content = await decryptMessage(msg.content);
        if (msg.reply_content) msg.reply_content = await decryptMessage(msg.reply_content);

        if (msg.type === 'message' || !msg.type) msg.content = clientSanitize(msg.content);
        if (msg.reply_content) msg.reply_content = clientSanitize(msg.reply_content);

        appendMessage(msg);
        scrollToBottom();

        if (msg.username !== state.nickname) {
            const isWindowFocused = document.hasFocus() && !document.hidden;
            if (!isWindowFocused) {
                try { const audio = new Audio('assets/notification.mp3'); audio.play().catch(() => { }); } catch (_e) { /* */ }
                if ('Notification' in window && Notification.permission === 'granted') {
                    const notify = new Notification(`Haven: @${msg.username}`, {
                        body: msg.content,
                        icon: '../../assets/icon.png',
                        silent: true
                    });
                    activeNotifications.add(notify);
                    notify.onclose = () => activeNotifications.delete(notify);
                    notify.onclick = () => {
                        if (window.electronAPI?.focusWindow) window.electronAPI.focusWindow();
                        else window.focus();
                    };
                }
            }
        }
    });

    // ── Typing ──
    const typingUsers: Map<string, string> = new Map();
    const typingTimeouts: Map<string, ReturnType<typeof setTimeout>> = new Map();
    const typingIndicator = document.getElementById('typing-indicator');
    const typingText = document.getElementById('typing-text');

    function updateTypingDisplay(): void {
        const names = Array.from(typingUsers.values());
        if (names.length === 0) {
            if (typingIndicator) typingIndicator.style.display = 'none';
        } else {
            if (typingIndicator) typingIndicator.style.display = 'flex';
            if (typingText) {
                if (names.length === 1) typingText.textContent = `${names[0]} ${window.i18n ? window.i18n.t('typing_one') : 'yazıyor...'}`;
                else if (names.length === 2) typingText.textContent = `${names[0]} & ${names[1]} ${window.i18n ? window.i18n.t('typing_two') : 'yazıyor...'}`;
                else typingText.textContent = `${names.length} ${window.i18n ? window.i18n.t('typing_many') : 'kişi yazıyor...'}`;
            }
        }
    }

    state.socket.on('user-typing', ({ username, isTyping }: { username: string; isTyping: boolean }) => {
        if (typingTimeouts.has(username)) {
            clearTimeout(typingTimeouts.get(username)!);
            typingTimeouts.delete(username);
        }
        if (isTyping) {
            typingUsers.set(username, username);
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

    // ── Message Delete ──
    state.socket.on('message-deleted', (messageId: string | number) => {
        import('./ui/pinned').then(m => m.deletePinnedMessage(messageId));

        if (!el.chatMessages) return;
        const rowWrapper = document.querySelector(`.msg-row-wrapper[data-message-id="${messageId}"]`);
        if (rowWrapper) {
            const parentGroup = rowWrapper.closest('.message-group');
            rowWrapper.remove();
            if (parentGroup && parentGroup.querySelectorAll('.msg-row-wrapper').length === 0) parentGroup.remove();
        } else {
            const msgGroup = document.querySelector(`.message-group[data-message-id="${messageId}"]`);
            if (msgGroup) msgGroup.remove();
        }

        // Yetim ayırıcıları temizle
        const children = Array.from(el.chatMessages.children);
        for (let i = children.length - 1; i >= 0; i--) {
            const child = children[i] as HTMLElement;
            if (!child.classList.contains('message-group') && child.id !== 'empty-state') {
                const nextSibling = child.nextElementSibling;
                if (!nextSibling || (!nextSibling.classList.contains('message-group') && nextSibling.id !== 'empty-state')) {
                    child.remove();
                }
            }
        }

        const remainingMessages = el.chatMessages.querySelectorAll('.message-group');
        if (remainingMessages.length === 0 && el.emptyState) {
            state.lastMessageUserId = null;
            state.lastMessageTime = null;
            state.lastMessageDateString = null;
            el.chatMessages.innerHTML = '';
            el.chatMessages.appendChild(el.emptyState);
            el.emptyState.style.display = 'flex';
        }
    });

    // ── Message Edited ──
    state.socket.on('message-edited', async (data: { messageId: string | number, newContent: string, editHistory: string, isEdited: boolean }) => {
        const messageRow = document.querySelector(`.msg-row-wrapper[data-message-id="${data.messageId}"]`);
        if (messageRow) {
            const textDiv = messageRow.querySelector('.message-text');
            if (textDiv) {
                try {
                    const { decryptMessage } = await import('./e2ee');
                    const raw = await decryptMessage(data.newContent);
                    let newHtml = linkify(escapeHtml(raw)).replace(/\n/g, '<br>');
                    if (data.isEdited) {
                        newHtml += ` <span style="font-size:10px; color:var(--text-muted); opacity:0.7; font-style:italic; cursor:pointer;" onclick="window.viewEditHistory('${btoa(encodeURIComponent(data.editHistory))}')" title="Düzenleme Geçmişi">(düzenlendi)</span>`;
                    }
                    textDiv.innerHTML = newHtml;
                    
                    import('./ui/pinned').then(m => m.updatePinnedMessageContent(data.messageId, newHtml));
                } catch (e) {
                    console.error('Mesaj güncellenirken hata:', e);
                }
            }
        }
    });

    // ── Reactions ──
    state.socket.on('message-reaction-update', ({ messageId, reactions }: { messageId: string | number; reactions: string }) => {
        if (!el.chatMessages) return;

        // Anket güncelleyici mantığı:
        const pollBox = document.getElementById(`poll-${messageId}`);
        if (pollBox) {
            try {
                const pollData = JSON.parse(pollBox.getAttribute('data-poll-json') || '{}');
                let reactionsObj: Record<string, string[]> = {};
                try { reactionsObj = JSON.parse(reactions); } catch(e) {}
                
                let totalVotes = 0;
                pollData.options.forEach((_opt: string, idx: number) => {
                    totalVotes += (reactionsObj[`pollopt_${idx}`] || []).length;
                });
                
                const listContainer = pollBox.querySelector('.poll-options-list');
                if (listContainer) {
                    Array.from(listContainer.children).forEach((btn: Element, idx: number) => {
                        const optKey = `pollopt_${idx}`;
                        const voters = reactionsObj[optKey] || [];
                        const count = voters.length;
                        const pct = totalVotes > 0 ? Math.round((count / totalVotes) * 100) : 0;
                        const isMyVote = voters.includes(state.nickname);
                        
                        const htmlBtn = btn as HTMLElement;
                        htmlBtn.className = `poll-option-btn ${isMyVote ? 'voted' : ''}`;
                        htmlBtn.style.border = `1px solid ${isMyVote ? 'var(--accent-primary)' : 'rgba(255,255,255,0.1)'}`;
                        
                        const bgDiv = htmlBtn.querySelector('.poll-bar-bg') as HTMLElement;
                        if (bgDiv) {
                            bgDiv.style.width = `${pct}%`;
                            bgDiv.style.background = isMyVote ? 'rgba(99,102,241,0.2)' : 'rgba(255,255,255,0.08)';
                        }
                        
                        const countSpan = htmlBtn.querySelector('.poll-count-text') as HTMLElement;
                        if (countSpan) {
                            countSpan.textContent = count > 0 ? `${count} (${pct}%)` : '';
                        }
                    });
                }
                
                const footer = pollBox.querySelector('.poll-footer');
                if (footer) {
                    footer.textContent = `${totalVotes} oy • ${pollData.multiple ? 'Çoklu seçim' : 'Tekli seçim'}`;
                }
            } catch(e) { console.error('Anket güncellenirken hata:', e); }
            return; // Normal emoji reaksiyonu olarak çizmeyi atla
        }

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

    // ── Room History ──
    state.socket.on('room-history', async (messages: any[]) => {
        const readyPromise = getE2EEReadyPromise();
        if (readyPromise) await readyPromise;

        if (!el.chatMessages) return;
        el.chatMessages.innerHTML = '';
        state.lastMessageUserId = null;
        state.lastMessageTime = null;
        state.lastMessageDateString = null;

        if (messages.length > 0) {
            for (const msg of messages) {
                msg.content = await decryptMessage(msg.content);
                if (msg.reply_content) msg.reply_content = await decryptMessage(msg.reply_content);
                if (msg.type === 'message' || !msg.type) msg.content = clientSanitize(msg.content);
                if (msg.reply_content) msg.reply_content = clientSanitize(msg.reply_content);
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
                reactions: msg.reactions,
                created_at: msg.created_at,
                user_id: msg.user_id,
                is_edited: msg.is_edited,
                edit_history: msg.edit_history,
                is_pinned: msg.is_pinned
            }));

            // Pass to pinned messages state
            import('./ui/pinned').then(m => {
                const parsedMsgs = messages.map(msg => ({
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
                    reactions: msg.reactions,
                    created_at: msg.created_at,
                    user_id: msg.user_id,
                    is_edited: msg.is_edited,
                    edit_history: msg.edit_history,
                    is_pinned: msg.is_pinned
                }));
                m.setPinnedMessages(parsedMsgs);
            });
            
            scrollToBottom();
        } else {
            if (el.emptyState) {
                el.chatMessages.appendChild(el.emptyState);
                el.emptyState.style.display = 'flex';
            }
        }
    });

    // ── WebRTC Signaling ──
    state.socket.on('room-is-ringing', (data: { callerName: string; avatarColor: string }) => {
        if (voiceState.isInVoice) return;
        if (el.incomingAvatar) {
            el.incomingAvatar.textContent = data.callerName[0].toUpperCase();
            (el.incomingAvatar as HTMLElement).style.backgroundColor = data.avatarColor || '#6366f1';
        }
        if (el.incomingName) el.incomingName.textContent = `${data.callerName} ${window.i18n ? window.i18n.t('calling') : 'Arıyor...'}`;
        el.modalIncomingCall?.classList.add('visible');
        playRingtone();
    });

    state.socket.on('voice-call-declined', (data: { username: string }) => {
        if (data?.username) {
            showToast(`${data.username} ${window.i18n ? window.i18n.t('call_rejected') : 'aramayı reddetti!'}`, 'error');
            stopRingtone();
        }
    });

    state.socket.on('call-answered', () => { stopRingtone(); el.modalIncomingCall?.classList.remove('visible'); });
    state.socket.on('call-cancelled', () => { stopRingtone(); el.modalIncomingCall?.classList.remove('visible'); showToast(window.i18n ? window.i18n.t('call_cancelled') : 'Arama iptal edildi.', 'info'); });
    state.socket.on('active-voice-users', (voiceUsers: any[]) => updateActiveCallBanner(voiceUsers));

    state.socket.on('voice-join', async (data: { userId: string; username: string; avatarColor: string; profilePic?: string; isMicOn?: boolean }) => {
        if (!voiceState.isInVoice) return;
        createMediaElement(data.userId, data.username, data.avatarColor, false, null, data.profilePic || null);
        import('./ui/voice-ui').then(m => m.updateMicStatusUI(data.userId, !!data.isMicOn));
        await createPeerConnection(data.userId, true);
    });

    state.socket.on('voice-leave', (data: { userId: string; username: string }) => {
        removePeerConnection(data.userId);
    });

    state.socket.on('webrtc-offer', async ({ senderId, senderName, offer }: { senderId: string; senderName: string; offer: RTCSessionDescriptionInit }) => {
        if (!voiceState.isInVoice) return;
        let pc = voiceState.peers[senderId];
        if (!pc) {
            const peer = state.users.find((u: any) => u.id === senderId);
            createMediaElement(senderId, senderName, peer?.avatarColor || '#6366f1', false, null, peer?.profilePic || null);
            pc = await createPeerConnection(senderId, false);
        }
        const offerCollision = (pc as any).makingOffer || pc.signalingState !== 'stable';
        (pc as any).ignoreOffer = !(pc as any).isPolite && offerCollision;
        if ((pc as any).ignoreOffer) return;
        try {
            await pc.setRemoteDescription(new RTCSessionDescription(offer));
            const answer = await pc.createAnswer();
            await pc.setLocalDescription(answer);
            state.socket!.emit('webrtc-answer', { targetId: senderId, answer: pc.localDescription });
        } catch (err) { console.error('Offer kabul Hatası:', err); }
    });

    state.socket.on('webrtc-answer', async ({ senderId, answer }: { senderId: string; answer: RTCSessionDescriptionInit }) => {
        if (!voiceState.isInVoice) return;
        const pc = voiceState.peers[senderId];
        if (pc) {
            try { await pc.setRemoteDescription(new RTCSessionDescription(answer)); } catch (err) { console.error('Answer hatası:', err); }
        }
    });

    state.socket.on('webrtc-candidate', async ({ senderId, candidate }: { senderId: string; candidate: RTCIceCandidateInit }) => {
        if (!voiceState.isInVoice) return;
        const pc = voiceState.peers[senderId];
        if (pc) {
            try { await pc.addIceCandidate(new RTCIceCandidate(candidate)); } catch (e) { if (!(pc as any).ignoreOffer) console.error('ICE Hatası:', e); }
        }
    });

    state.socket.on('screen-share-state', ({ userId, username, isSharing }: { userId: string; username: string; isSharing: boolean }) => {
        updateScreenShareBadge(userId, username, isSharing);
    });

    // ── P2P File Signals ──
    state.socket.on('p2p-file-offer', async ({ senderId, senderName, offer, fileMeta }: any) => {
        const file = window.pendingP2PFiles ? window.pendingP2PFiles[fileMeta.fileId] : null;
        if (!file) return;

        const pc = new RTCPeerConnection(rtcConfig);
        window.p2pConnections = window.p2pConnections || {};
        window.p2pConnections[fileMeta.fileId + '_' + senderId] = pc;

        pc.ondatachannel = (e) => {
            const dc = e.channel;
            dc.binaryType = 'arraybuffer';
            dc.onopen = async () => {
                const pBox = document.getElementById(`p2p-progress-sender-${fileMeta.fileId}`);
                if (pBox) pBox.style.display = 'block';
                const bar = document.getElementById(`p2p-bar-sender-${fileMeta.fileId}`);
                const txt = document.getElementById(`p2p-text-sender-${fileMeta.fileId}`);

                const chunkSize = 65536;
                let offset = 0;
                dc.bufferedAmountLowThreshold = 1024 * 512;

                while (offset < file.size) {
                    if (dc.bufferedAmount > dc.bufferedAmountLowThreshold) {
                        await new Promise<void>(r => {
                            const listener = () => { dc.removeEventListener('bufferedamountlow', listener); r(); };
                            dc.addEventListener('bufferedamountlow', listener);
                        });
                    }
                    if (dc.readyState !== 'open') break;
                    const chunk = await file.slice(offset, offset + chunkSize).arrayBuffer();
                    dc.send(chunk);
                    offset += chunk.byteLength;
                    const percent = ((offset / file.size) * 100).toFixed(1);
                    if (bar) bar.style.width = percent + '%';
                    if (txt) txt.textContent = escapeHtml(senderName) + ' %' + percent + ' indirdi';
                }

                if (dc.readyState === 'open') {
                    dc.send(JSON.stringify({ type: 'EOF' }));
                    if (txt) txt.textContent = window.i18n ? window.i18n.t('send_complete') : 'Gönderim Tamamlandı';
                }
            };
        };

        pc.onicecandidate = e => {
            if (e.candidate) state.socket!.emit('p2p-file-candidate', { targetId: senderId, candidate: e.candidate, fileId: fileMeta.fileId });
        };

        await pc.setRemoteDescription(new RTCSessionDescription(offer));
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        state.socket!.emit('p2p-file-answer', { targetId: senderId, answer, fileId: fileMeta.fileId });
    });

    state.socket.on('p2p-file-answer', async ({ senderId, answer, fileId }: any) => {
        window.p2pConnections = window.p2pConnections || {};
        const pc = window.p2pConnections[fileId];
        if (pc) { try { await pc.setRemoteDescription(new RTCSessionDescription(answer)); } catch (e) { console.error(e); } }
    });

    state.socket.on('p2p-file-candidate', async ({ senderId, candidate, fileId }: any) => {
        window.p2pConnections = window.p2pConnections || {};
        const pc = window.p2pConnections[fileId] || window.p2pConnections[fileId + '_' + senderId];
        if (pc) { try { await pc.addIceCandidate(new RTCIceCandidate(candidate)); } catch (e) { console.error(e); } }
    });
}
