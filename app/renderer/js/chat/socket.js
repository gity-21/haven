
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

    // FIX #1: Sunucudan gelen per-room E2EE salt'ı ile anahtar türet
    state.socket.on('room-e2ee-salt', async ({ salt }) => {
        if (!pendingE2EEInit) return;
        pendingE2EEInit = false;
        const pw = state.roomPassword; // sessionStorage'dan okunmuştu
        if (!pw) {
            console.error('[E2EE] Şifre bulunamadı, anahtar türetilemiyor.');
            if (e2eeReadyResolve) e2eeReadyResolve(); // Bekleyenleri serbest bırak
            return;
        }
        try {
            // salt null ise eski oda — legacy salt ile geriye uyumlu çalış
            e2eeKey = await deriveE2EEKey(pw, salt || null);
            sessionStorage.removeItem('haven_session_password');
            state.roomPassword = null;
            console.log('[E2EE] Anahtar türetildi.', salt ? '(per-room salt)' : '(legacy salt)');
        } catch (err) {
            console.error('[E2EE] Anahtar türetme hatası:', err);
            showToast(window.i18n ? window.i18n.t('security_fail') : 'Güvenlik sistemi başlatılamadı!', 'error');
        }
        // FIX: E2EE anahtarı hazır — room-history bekleyenlerini serbest bırak
        if (e2eeReadyResolve) {
            e2eeReadyResolve();
            e2eeReadyResolve = null;
        }
    });

    state.socket.on('connect', () => {
        console.log('[Bağlantı] Sunucuya bağlandı! Socket ID:', state.socket.id);
        updateStatus('', 'connected');

        // Odaya Gir
        state.socket.emit('join-room', {
            userId: state.userId,
            userToken: state.userToken,
            nickname: state.nickname,
            roomKey: state.roomKey,
            avatarColor: state.avatarColor,
            profilePic: state.profilePic,
            authKey: state.authKey,
            mode: state.joinMode,
            sessionId: state.sessionId
        });
    });

    // Upload token'ı geldiğinde sakla
    state.socket.on('upload-token', (token) => {
        state.uploadToken = token;
    });

    // Odaya Giriş Hatası
    state.socket.on('join-error', (errMsg) => {
        localStorage.setItem('haven_login_error', "Odaya Bağlanılamadı: " + errMsg);
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

    state.socket.on('error', (err) => {
        console.error('[HATA] Sunucu Hatası:', err);
        showToast(err, 'error');
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
    state.socket.on('username-changed', ({ oldUsername, newUsername, avatarColor, profilePic, userId }) => {
        document.querySelectorAll('.message-username').forEach(usernameEl => {
            if (usernameEl.textContent === oldUsername) {
                usernameEl.textContent = newUsername;
            }
        });

        // Sesli sohbetteyse katılımcı kartını güncelle
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
                        avatarDiv.style.color = 'transparent';
                        avatarDiv.textContent = '';
                    } else {
                        avatarDiv.style.backgroundImage = 'none';
                        avatarDiv.style.backgroundColor = avatarColor || '#6366f1';
                        avatarDiv.style.color = 'white';
                        avatarDiv.textContent = newUsername.charAt(0).toUpperCase();
                    }
                }
            }
        }
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

        // FIX: E2EE anahtarı henüz hazır olmayabilir (PBKDF2 türetme sürüyor olabilir)
        if (e2eeReadyPromise) {
            await e2eeReadyPromise;
        }

        // Gelen mesajı şifresini çöz
        msg.content = await decryptMessage(msg.content);
        if (msg.reply_content) {
            msg.reply_content = await decryptMessage(msg.reply_content);
        }

        // FIX #6: XSS koruması şifre çözme SONRASI istemci tarafında yapılıyor.
        // Sunucudaki sanitize şifreli içeriğe uygulandığından etkisizdi.
        if (msg.type === 'message' || !msg.type) {
            msg.content = clientSanitize(msg.content);
        }
        if (msg.reply_content) {
            msg.reply_content = clientSanitize(msg.reply_content);
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
                } catch (e) { console.warn('[Bildirim] Ses çalma hatası:', e.message); } // FIX #19

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

    // Mesaj düzenlendiğinde
    state.socket.on('message-edited', async ({ messageId, newContent, editHistory, isEdited }) => {
        try {
            // Şifreyi çöz
            const decryptedContent = await decryptMessage(newContent);
            const safeContent = clientSanitize(decryptedContent);

            // Ekranda mesajı bul
            const textElement = document.querySelector(`.message-text[data-message-id="${messageId}"]`);
            if (textElement) {
                textElement.innerHTML = safeContent;
                
                // "(düzenlendi)" ibaresi ekle
                let badge = textElement.parentElement.querySelector('.edit-badge');
                if (!badge) {
                    badge = document.createElement('span');
                    badge.className = 'edit-badge';
                    badge.style.cssText = 'font-size:10px; color:var(--text-muted); margin-left:6px; cursor:pointer; text-decoration:underline;';
                    badge.textContent = '(düzenlendi)';
                    textElement.parentElement.appendChild(badge);
                }

                // Geçmişi görebilmek için veriyi dataset'e yaz
                // Gelen editHistory arrayindeki contentler hala şifreli! Tıklanınca çözülecek.
                badge.dataset.history = JSON.stringify(editHistory);
                badge.onclick = async () => {
                    const hArr = JSON.parse(badge.dataset.history);
                    let historyHtml = '<b>Geçmiş Sürümler:</b><br><br>';
                    for (let i = 0; i < hArr.length; i++) {
                        const hItem = hArr[i];
                        const dateStr = new Date(hItem.edited_at).toLocaleTimeString();
                        try {
                            const oldDecrypted = await decryptMessage(hItem.content);
                            historyHtml += `<i>[${dateStr} öncesi]</i><br>${clientSanitize(oldDecrypted)}<br><hr style="border-top:1px solid var(--border-light);margin:4px 0">`;
                        } catch(e) {
                            historyHtml += `<i>[${dateStr} öncesi]</i><br>[Şifre çözülemedi]<br><hr>`;
                        }
                    }
                    window.showConfirmModal(historyHtml, () => {});
                };
            }
        } catch (error) {
            console.error('Düzenlenen mesajın şifresi çözülemedi:', error);
        }
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
        // FIX: E2EE anahtarının hazır olmasını bekle (PBKDF2 türetmesi ~100-500ms sürer)
        // Salt eventi daha önce gelse bile deriveE2EEKey async, bu yüzden anahtar henüz hazır olmayabilir.
        if (e2eeReadyPromise) {
            await e2eeReadyPromise;
        }

        el.chatMessages.innerHTML = '';
        state.lastMessageUserId = null;
        state.lastMessageTime = null;
        state.lastMessageDateString = null;

        if (messages.length > 0) {
            // Şifre çözme + FIX #6: istemci tarafı XSS koruması
            for (let msg of messages) {
                msg.content = await decryptMessage(msg.content);
                if (msg.reply_content) {
                    msg.reply_content = await decryptMessage(msg.reply_content);
                }
                // Şifre çözme sonrası sanitize
                if (msg.type === 'message' || !msg.type) {
                    msg.content = clientSanitize(msg.content);
                }
                if (msg.reply_content) {
                    msg.reply_content = clientSanitize(msg.reply_content);
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
                created_at: msg.created_at,
                is_edited: msg.is_edited,
                edit_history: msg.edit_history
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
        voiceState.activeUsers = voiceUsers;
        updateActiveCallBanner(voiceUsers);
        
        if (voiceState.isInVoice) {
            voiceUsers.forEach(user => {
                if (user.id !== state.socket.id) {
                    // Kullanıcı kartı (element) oluşmuşsa badge'i günceller
                    if (typeof updateMicBadge === 'function') {
                        updateMicBadge(user.id, user.isMicOn);
                    }
                }
            });
        }
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
            
            // Eğer kişinin mic durumu cache'te varsa rozeti oluştur
            const activeUser = voiceState.activeUsers?.find(u => u.id === senderId);
            if (activeUser && typeof updateMicBadge === 'function') {
                updateMicBadge(senderId, activeUser.isMicOn);
            }
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

    // Diğer kullanıcıların mikrofon durumunu dinle
    state.socket.on('user-mic-state', ({ userId, isMicOn }) => {
        updateMicBadge(userId, isMicOn);
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