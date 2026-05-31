
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
            } catch (ex) { console.warn('[P2P] Dosya işleme hatası:', ex.message); } // FIX #19
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
    let createdAtStr = msg.created_at || new Date().toISOString();
    if (createdAtStr && !createdAtStr.endsWith('Z')) createdAtStr += 'Z';
    const msgDate = new Date(createdAtStr);

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
    let safeContent;
    if (msg.type === 'self-destruct') {
        const uniqueId = 'sd-' + msg.id;
        const b64Content = btoa(encodeURIComponent(msg.content));
        safeContent = `<div id="${uniqueId}" class="self-destruct-msg" style="cursor:pointer; display:inline-flex; align-items:center; gap:8px; background:rgba(239,68,68,0.1); border:1px solid rgba(239,68,68,0.3); padding:8px 14px; border-radius:8px; color:#ef4444;" onclick="window.viewSelfDestruct('${uniqueId}', '${b64Content}', ${msg.id})"><span class="sd-icon"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline></svg></span><span style="font-weight:600; font-size:13px; filter:blur(4px); transition:filter 0.3s; user-select:none;">Gizli Mesaj (Tıkla)</span></div>`;
    } else if (msg.type === 'file' || msg.type === 'p2p-announce') {
        safeContent = escapeHtml(msg.content);
    } else {
        safeContent = linkify(escapeHtml(msg.content)).replace(/\n/g, '<br>');
    }


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
                    safeContent = `<div class="p2p-file-box" style="border:1px solid rgba(99,179,237,0.25);border-radius:12px;background:linear-gradient(135deg,rgba(49,130,206,0.1),rgba(99,102,241,0.08));padding:12px;backdrop-filter:blur(6px);max-width:300px;white-space:normal;display:inline-block;margin-top:4px;"><div style="display:flex;align-items:center;gap:8px;margin-bottom:8px;"><span style="font-size:20px;">${fileIcon}</span><div style="flex:1;min-width:0;"><div style="font-size:13px;font-weight:700;color:var(--text-primary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${escapeHtml(fileObj.filename)}</div><div style="font-size:11px;color:var(--text-muted);">${fileSizeMB} MB · P2P Transfer</div></div><span style="font-size:9px;font-weight:800;padding:2px 6px;border-radius:4px;background:rgba(99,179,237,0.15);color:#63b3ed;border:1px solid rgba(99,179,237,0.3);text-transform:uppercase;">Paylaşan</span></div><div id="p2p-loading-box-${fileObj.fileId}" style="font-size:11px;color:var(--text-muted);background:rgba(0,0,0,0.25);border-radius:8px;padding:8px 10px;display:flex;align-items:center;gap:8px;line-height:1.3;"><span>⏳</span><span>${window.i18n ? window.i18n.t('p2p_loading') : 'Yükleniyor...'}</span></div><div id="p2p-progress-sender-${fileObj.fileId}" style="margin-top:8px;display:none;"><div style="height:6px;background:rgba(255,255,255,0.1);border-radius:3px;overflow:hidden;"><div id="p2p-bar-sender-${fileObj.fileId}" style="width:0%;height:100%;background:linear-gradient(90deg,#4299e1,#667eea);transition:width 0.2s;border-radius:3px;"></div></div><div id="p2p-text-sender-${fileObj.fileId}" style="text-align:right;font-size:10px;margin-top:4px;color:var(--text-muted);font-weight:600;">Hazırlanıyor...</div></div></div>`;
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
        } catch (e) { console.warn('[Mesaj] p2p-announce parse hatası:', e.message); } // FIX #19
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

                if (msg.is_edited) {
                    const badge = document.createElement('span');
                    badge.className = 'edit-badge';
                    badge.style.cssText = 'font-size:10px; color:var(--text-muted); margin-left:6px; cursor:pointer; text-decoration:underline;';
                    badge.textContent = '(düzenlendi)';
                    if (msg.edit_history) badge.dataset.history = msg.edit_history;
                    badge.onclick = async () => {
                        if (!badge.dataset.history) return;
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
                    rowDiv.appendChild(badge);
                }

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

                // Düzenle butonu (sadece kendi mesajıysa ve 15 dk geçmediyse)
                let createdAtStr = msg.created_at;
        if (createdAtStr && !createdAtStr.endsWith('Z')) createdAtStr += 'Z';
        const msgTime = new Date(createdAtStr).getTime();
                const isEditable = isMine && (Date.now() - msgTime <= 15 * 60 * 1000);
                
                if (isEditable && msg.type === 'message') {
                    const editBtn = document.createElement('button');
                    editBtn.innerHTML = '✏️';
                    editBtn.title = 'Düzenle';
                    editBtn.style.cssText = 'background:none;border:none;cursor:pointer;font-size:12px;padding:1px 4px;';
                    editBtn.onclick = () => window.initiateEdit(msg.id, msg.content);
                    hoverToolbar.appendChild(editBtn);
                }

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

    const editBadgeHtml = msg.is_edited ? `<span class="edit-badge" style="font-size:10px; color:var(--text-muted); margin-left:6px; cursor:pointer; text-decoration:underline;" data-history='${msg.edit_history ? msg.edit_history.replace(/'/g, "&#39;") : "[]"}' onclick="window.viewEditHistory(this)">(düzenlendi)</span>` : '';
    
    messageEl.innerHTML = `<div class="message-avatar" style="${avatarStyle}">${msg.profile_pic ? '' : initial}</div><div class="message-content"><div class="message-header"><div><span class="message-username" style="color: ${msg.avatarColor || '#5865F2'}">${escapeHtml(msg.username)}</span><span class="message-timestamp" style="font-size:11px;color:var(--text-muted);margin-left:8px;">${timeStr}</span></div></div>${replyHtml}<div class="msg-row-wrapper" data-message-id="${msg.id}" style="position:relative;display:block;"><div class="message-text" data-message-id="${msg.id}">${safeContent}</div>${editBadgeHtml}<div class="reaction-bar">${buildReactionsHtml(msg.id, msg.reactions || '{}')}</div></div></div>`;

    el.chatMessages.appendChild(messageEl);

    window.viewEditHistory = async (badgeElem) => {
        if (!badgeElem.dataset.history) return;
        const hArr = JSON.parse(badgeElem.dataset.history);
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

        // Düzenle butonu (sadece kendi mesajıysa ve 15 dk geçmediyse)
        let createdAtStr = msg.created_at;
        if (createdAtStr && !createdAtStr.endsWith('Z')) createdAtStr += 'Z';
        const msgTime = new Date(createdAtStr).getTime();
        const isEditable = isMine && (Date.now() - msgTime <= 15 * 60 * 1000);
        
        if (isEditable && msg.type === 'message') {
            const editBtn = document.createElement('button');
            editBtn.innerHTML = '✏️';
            editBtn.title = 'Düzenle';
            editBtn.style.cssText = 'background:none;border:none;cursor:pointer;font-size:12px;padding:1px 4px;';
            editBtn.onclick = () => window.initiateEdit(msg.id, msg.content);
            hoverToolbar.appendChild(editBtn);
        }

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

// ============================================
// KAYBOLAN MESAJ (SELF-DESTRUCT) GÖRÜNTÜLEME
// ============================================
window.viewSelfDestruct = (uniqueId, b64Content, messageId) => {
    const box = document.getElementById(uniqueId);
    if (!box || box.dataset.viewed === 'true') return;

    box.dataset.viewed = 'true';
    box.style.cursor = 'default';
    box.onclick = null;
    const textSpan = box.querySelector('span:not(.sd-icon)');
    const iconContainer = box.querySelector('.sd-icon');

    try {
        const rawContent = decodeURIComponent(atob(b64Content));
        if (textSpan) {
            textSpan.innerHTML = linkify(escapeHtml(rawContent)).replace(/\n/g, '<br>');
            textSpan.style.filter = 'none';
            textSpan.style.userSelect = 'text';
        }
        if (iconContainer) iconContainer.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 0 0 2.5 2.5z"></path></svg>';
        box.style.background = 'rgba(245, 158, 11, 0.1)';
        box.style.borderColor = 'rgba(245, 158, 11, 0.3)';
        box.style.color = '#f59e0b';
    } catch (e) {
        if (textSpan) textSpan.textContent = 'Şifre Çözülemedi';
    }

    // Geri sayım göstergesi
    let secondsLeft = 5;
    const countdownEl = document.createElement('span');
    countdownEl.style.cssText = 'font-size:11px; opacity:0.7; margin-left:6px; min-width:18px; text-align:center; font-weight:700;';
    countdownEl.textContent = secondsLeft + 's';
    box.appendChild(countdownEl);

    const countdownInterval = setInterval(() => {
        secondsLeft--;
        if (countdownEl) countdownEl.textContent = secondsLeft + 's';
    }, 1000);

    // 5 saniye sonra sil
    setTimeout(() => {
        clearInterval(countdownInterval);
        box.style.transition = 'opacity 0.5s, transform 0.5s';
        box.style.opacity = '0';
        box.style.transform = 'scale(0.9)';

        setTimeout(() => {
            // Sunucuya sil komutu gönder
            if (state.socket && state.socket.connected) {
                state.socket.emit('delete-message', { messageId: Number(messageId) });
            }
            // Lokal olarak DOM'dan kaldır
            const rowWrapper = document.querySelector(`.msg-row-wrapper[data-message-id="${messageId}"]`);
            if (rowWrapper) {
                const parentGroup = rowWrapper.closest('.message-group');
                rowWrapper.remove();
                if (parentGroup && parentGroup.querySelectorAll('.msg-row-wrapper').length === 0) {
                    parentGroup.remove();
                }
            } else {
                const parentGroup = box.closest('.message-group');
                if (parentGroup) parentGroup.remove();
            }
        }, 500);
    }, 5000);
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
    try { if (reactionsStr) obj = JSON.parse(reactionsStr); } catch (e) { console.warn('[Reactions] JSON parse hatası:', e.message); } // FIX #19
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
    } catch (e) { console.warn('[YouTube] URL parse hatası:', e.message); } // FIX #19
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