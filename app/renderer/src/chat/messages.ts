/**
 * messages.ts — Mesaj Oluşturma, Render ve Gönderme
 *
 * appendMessage, sendMessage, reactions, reply, delete ve scrollToBottom.
 */

import { state, activeNotifications, voiceState } from './state';
import { el } from './elements';
import { escapeHtml, linkify, formatDiscordDate, formatDateSeparator, clientSanitize } from './utils';
import { encryptMessage, decryptMessage, getE2EEReadyPromise } from './e2ee';
import { showToast } from './ui/toast';

// ── Durum fonksiyonu ──

export function updateStatus(text: string, type: string): void {
    if (!el.connStatus) return;
    el.connStatus.textContent = text;
    el.connStatus.className = `connection-status ${type}`;
    if (type === 'connected') {
        setTimeout(() => {
            if (el.connStatus) el.connStatus.className = 'connection-status';
        }, 2000);
    }
}

// ── Scroll ──

export function scrollToBottom(): void {
    if (el.chatMessages) {
        el.chatMessages.scrollTop = el.chatMessages.scrollHeight;
    }
}

// ── Reaction HTML builder ──

export function buildReactionsHtml(messageId: number | string, reactionsStr: string): string {
    let obj: Record<string, string[]> = {};
    try { if (reactionsStr) obj = JSON.parse(reactionsStr); } catch (_e) { /* ignore */ }
    const entries = Object.entries(obj).filter(([, users]) => users.length > 0);
    if (entries.length === 0) return '';
    return entries.map(([emoji, users]) => {
        const isMineReaction = users.includes(state.nickname);
        const tooltipAvatars = users.slice(0, 5).map(uname => {
            const userInfo = state.users.find((u: any) => u.username === uname);
            if (userInfo && userInfo.profilePic) {
                return `<img src="${userInfo.profilePic}" alt="${escapeHtml(uname)}" title="${escapeHtml(uname)}" style="width:20px;height:20px;border-radius:50%;border:1.5px solid rgba(255,255,255,0.15);object-fit:cover;flex-shrink:0;">`;
            }
            const color = (userInfo && userInfo.avatarColor) || '#6366f1';
            const initial = uname ? uname[0].toUpperCase() : '?';
            return `<span title="${escapeHtml(uname)}" style="width:20px;height:20px;border-radius:50%;background:${color};display:inline-flex;align-items:center;justify-content:center;font-size:10px;font-weight:700;color:#fff;border:1.5px solid rgba(255,255,255,0.15);flex-shrink:0;">${initial}</span>`;
        }).join('');
        const extraCount = users.length > 5 ? `<span style="font-size:10px;color:var(--text-muted);margin-left:2px;">+${users.length - 5}</span>` : '';
        const tip = users.join(', ');
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

// ── Hover toolbar oluşturucu ──

function createHoverToolbar(msg: ChatMessage, isMine: boolean): HTMLDivElement {
    const hoverToolbar = document.createElement('div');
    hoverToolbar.className = 'row-hover-toolbar';
    hoverToolbar.style.cssText = 'position:absolute; right:0; top:-14px; align-items:center; gap:4px; background:var(--bg-dark); border:1px solid var(--border-medium); border-radius:8px; padding:2px 6px; z-index:20;';

    // Reply'de kullanılacak temiz metin (HTML tag'lerinden arındırılmış)
    const cleanContent = msg.content.replace(/<[^>]*>/g, '').slice(0, 100);

    const replyBtn = document.createElement('button');
    replyBtn.innerHTML = '↩️';
    replyBtn.title = 'Yanıtla';
    replyBtn.style.cssText = 'background:none;border:none;cursor:pointer;font-size:14px;padding:1px 3px;';
    replyBtn.onclick = (e) => {
        e.stopPropagation();
        window.initiateReply(msg.id, msg.username, cleanContent);
    };
    hoverToolbar.appendChild(replyBtn);

    const pinBtn = document.createElement('button');
    pinBtn.innerHTML = '📌';
    pinBtn.title = msg.is_pinned ? 'Sabitlemeyi Kaldır' : 'Sabitle';
    pinBtn.style.cssText = 'background:none;border:none;cursor:pointer;font-size:14px;padding:1px 3px;';
    pinBtn.onclick = (e) => {
        e.stopPropagation();
        import('./state').then(m => {
            if (m.state.socket) {
                m.state.socket.emit('pin-message', { messageId: msg.id, isPinned: !msg.is_pinned });
            }
        });
    };
    hoverToolbar.appendChild(pinBtn);

    ['👍', '❤️', '💀', '🔥'].forEach(em => {
        const eBtn = document.createElement('button');
        eBtn.textContent = em;
        eBtn.style.cssText = 'background:none;border:none;cursor:pointer;font-size:14px;padding:1px 2px;';
        eBtn.title = em;
        eBtn.onclick = () => window.sendReaction(msg.id, em);
        hoverToolbar.appendChild(eBtn);
    });

    if (isMine) {
        if (msg.type === 'message') {
            const editBtn = document.createElement('button');
            editBtn.innerHTML = '✏️';
            editBtn.title = 'Düzenle';
            editBtn.style.cssText = 'background:none;border:none;cursor:pointer;font-size:12px;padding:1px 4px;';
            editBtn.onclick = (e) => {
                e.stopPropagation();
                window.initiateEdit(msg.id, btoa(encodeURIComponent(msg.content)));
            };
            hoverToolbar.appendChild(editBtn);
        }

        const delBtn = document.createElement('button');
        delBtn.innerHTML = '🗑️';
        delBtn.title = 'Sil';
        delBtn.style.cssText = 'background:none;border:none;cursor:pointer;font-size:12px;color:var(--accent-danger);padding:1px 4px;';
        delBtn.onclick = () => window.deleteMessage(msg.id, msg.roomId);
        hoverToolbar.appendChild(delBtn);
    }

    return hoverToolbar;
}

// ── Mesaj tipi ──

export interface ChatMessage {
    id: number | string;
    roomId?: string;
    username: string;
    content: string;
    avatarColor?: string;
    profile_pic?: string;
    type?: string;
    reply_to?: number | string;
    reply_username?: string;
    reply_content?: string;
    reactions?: string;
    created_at?: string;
    user_id?: string;
    is_edited?: boolean | number;
    edit_history?: string;
    is_pinned?: boolean | number;
}

// ── appendMessage ──

export function appendMessage(msg: ChatMessage): void {
    if (!el.chatMessages) return;
    const msgDate = new Date(msg.created_at || new Date());
    const msgDateString = msgDate.getFullYear() + '-' + msgDate.getMonth() + '-' + msgDate.getDate();

    // Tarih Separatörü
    if (state.lastMessageDateString !== msgDateString) {
        const separatorHtml = `
          <div style="display: flex; align-items: center; text-align: center; margin: 24px 16px 8px 16px; user-select:none;">
              <div style="flex: 1; height: 1px; background: rgba(255,255,255,0.06);"></div>
              <span style="padding: 0 12px; color: var(--text-muted); font-size: 11px; font-weight: 700; text-transform:uppercase; letter-spacing:0.5px;">
                  ${formatDateSeparator(msgDate.toISOString())}
              </span>
              <div style="flex: 1; height: 1px; background: rgba(255,255,255,0.06);"></div>
          </div>
        `;
        el.chatMessages.insertAdjacentHTML('beforeend', separatorHtml);
        state.lastMessageDateString = msgDateString;
        state.lastMessageUserId = null;
        state.lastMessageTime = null;
    }

    const msgTime = msgDate.getTime();
    const timeDiff = state.lastMessageTime ? (msgTime - state.lastMessageTime) : Infinity;
    const isSameUser = state.lastMessageUserId === msg.username && timeDiff < 5 * 60 * 1000;
    state.lastMessageUserId = msg.username;
    state.lastMessageTime = msgTime;

    const timeStr = formatDiscordDate(msgDate.toISOString());
    const initial = msg.username ? msg.username[0].toUpperCase() : '?';
    const isMine = msg.username === state.nickname || (state.userId && msg.user_id === state.userId);

    // İçerik hazırlama
    let isMentioned = false;
    let safeContent = '';
    if (msg.type === 'self-destruct') {
        const uniqueId = 'sd-' + msg.id;
        const b64Content = btoa(encodeURIComponent(msg.content || ''));
        safeContent = `<div id="${uniqueId}" class="self-destruct-msg" style="cursor:pointer; display:inline-flex; align-items:center; gap:8px; background:rgba(239,68,68,0.1); border:1px solid rgba(239,68,68,0.3); padding:8px 14px; border-radius:8px; color:#ef4444;" onclick="window.viewSelfDestruct('${uniqueId}', '${msg.content}', ${msg.id})"><span class="sd-icon"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline></svg></span><span style="font-weight:600; font-size:13px; filter:blur(4px); transition:filter 0.3s; user-select:none;">Gizli Mesaj (Tıkla)</span></div>`;
    } else {
        safeContent = (msg.type === 'file' || msg.type === 'p2p-announce')
            ? escapeHtml(msg.content)
            : linkify(escapeHtml(msg.content)).replace(/\n/g, '<br>');

        if (msg.type !== 'file' && msg.type !== 'p2p-announce') {
            safeContent = safeContent.replace(/@([a-zA-Z0-9_]+)/g, (match, username) => {
                if (username.toLowerCase() === state.nickname.toLowerCase()) {
                    isMentioned = true;
                }
                return `<span class="mention">@${username}</span>`;
            });
        }

        if (msg.is_edited) {
            safeContent += ` <span style="font-size:10px; color:var(--text-muted); opacity:0.7; font-style:italic; cursor:pointer;" onclick="window.viewEditHistory('${btoa(encodeURIComponent(msg.edit_history || '[]'))}')" title="Düzenleme Geçmişi">(düzenlendi)</span>`;
        }
    }

    // p2p-announce & file rendering (inline HTML — orijinal mantık korunuyor)
    if (msg.type === 'p2p-announce') {
        try {
            const fileObj = JSON.parse(msg.content);
            const fileSizeMB = (fileObj.size / 1024 / 1024).toFixed(2);
            const isImage = fileObj.mimetype && fileObj.mimetype.startsWith('image/');
            const ext = (fileObj.filename || '').split('.').pop()!.toLowerCase();
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
        } catch (_e) { /* ignore */ }
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
                const audioId = 'voice-' + (msg.id || Date.now() + '-' + Math.floor(Math.random() * 1000));
                safeContent = `<div class="voice-message-player" data-audio-src="${serverPath}${safeUrl}" data-audio-id="${audioId}"><button class="voice-msg-play-btn" onclick="window.toggleVoiceMsg('${audioId}', '${serverPath}${safeUrl}')" title="Oynat/Duraklat"><svg id="${audioId}-icon" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z"></path><path d="M19 10v2a7 7 0 0 1-14 0v-2"></path><line x1="12" y1="19" x2="12" y2="22"></line></svg></button><div class="voice-msg-waveform-bar" onclick="window.seekVoiceMsg(event, '${audioId}')"><canvas id="${audioId}-waveform" width="160" height="28"></canvas></div></div>`;
            } else {
                safeContent = `📎 <a href="${serverPath}${safeUrl}" target="_blank" style="color:var(--accent-primary);">${escapeHtml(fileObj.filename)}</a>`;
            }
        } catch (_e) { /* ignore */ }
    } else if (msg.type === 'poll') {
        try {
            const pollData = JSON.parse(msg.content);
            const pollHtmlId = `poll-${msg.id}`;
            let optionsHtml = '';
            
            let reactionsObj: Record<string, string[]> = {};
            if ((msg as any).reactions) {
                try { reactionsObj = JSON.parse((msg as any).reactions); } catch(e) {}
            }
            
            let totalVotes = 0;
            pollData.options.forEach((opt: string, idx: number) => {
                const optKey = `pollopt_${idx}`;
                totalVotes += (reactionsObj[optKey] || []).length;
            });
            
            pollData.options.forEach((opt: string, idx: number) => {
                const optKey = `pollopt_${idx}`;
                const voters = reactionsObj[optKey] || [];
                const count = voters.length;
                const pct = totalVotes > 0 ? Math.round((count / totalVotes) * 100) : 0;
                const isMyVote = voters.includes(state.nickname);
                
                optionsHtml += `
                    <button class="poll-option-btn ${isMyVote ? 'voted' : ''}" data-idx="${idx}" onclick="window.votePoll(${msg.id}, ${idx}, ${pollData.multiple})" style="position:relative; width:100%; text-align:left; padding:10px 14px; background:rgba(255,255,255,0.05); border:1px solid ${isMyVote ? 'var(--accent-primary)' : 'rgba(255,255,255,0.1)'}; border-radius:8px; cursor:pointer; color:var(--text-primary); font-size:14px; font-weight:500; overflow:hidden; display:flex; justify-content:space-between; align-items:center; transition:0.2s; margin-bottom:6px;">
                        <div class="poll-bar-bg" style="position:absolute; top:0; left:0; height:100%; width:${pct}%; background:${isMyVote ? 'rgba(99,102,241,0.2)' : 'rgba(255,255,255,0.08)'}; z-index:1; transition:width 0.4s cubic-bezier(0.4, 0, 0.2, 1);"></div>
                        <span style="position:relative; z-index:2; flex:1;">${escapeHtml(opt)}</span>
                        <span class="poll-count-text" style="position:relative; z-index:2; font-size:12px; color:var(--text-muted); font-weight:600; min-width:40px; text-align:right;">${count > 0 ? count + ' (' + pct + '%)' : ''}</span>
                    </button>
                `;
            });
            
            safeContent = `
                <div class="poll-box" id="${pollHtmlId}" data-poll-json="${escapeHtml(JSON.stringify(pollData))}" style="border:1px solid rgba(255,255,255,0.08); border-radius:12px; background:linear-gradient(135deg,rgba(0,0,0,0.2),rgba(99,102,241,0.05)); padding:16px; max-width:320px; width:100%; margin-top:4px;">
                    <div style="display:flex; align-items:center; gap:8px; margin-bottom:12px;">
                        <span style="font-size:20px;">📊</span>
                        <div style="font-weight:700; font-size:15px; color:white; line-height:1.4;">${escapeHtml(pollData.question)}</div>
                    </div>
                    <div class="poll-options-list">
                        ${optionsHtml}
                    </div>
                    <div class="poll-footer" style="font-size:11px; color:var(--text-muted); text-align:right; margin-top:8px;">${totalVotes} oy • ${pollData.multiple ? 'Çoklu seçim' : 'Tekli seçim'}</div>
                </div>
            `;
        } catch (_e) { /* ignore */ }
    }

    // Yanıt gösterimi
    let replyHtml = '';
    if (msg.reply_to && msg.reply_username) {
        replyHtml = `<div class="msg-reply-preview" onclick="document.querySelector('[data-message-id=\\'${msg.reply_to}\\']')?.scrollIntoView({behavior: 'smooth'})" style="font-size: 11px; padding: 4px 10px; margin-bottom: 6px; background: rgba(255,255,255,0.04); border-left: 3px solid var(--accent-primary); border-radius: 4px; cursor: pointer; color: var(--text-muted); display:inline-flex; align-items:center; gap:6px; max-width:100%;"><strong style="color:var(--text-primary);white-space:nowrap;">${escapeHtml(msg.reply_username)}</strong><span style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${escapeHtml(msg.reply_content || '').slice(0, 50)}${msg.reply_content && msg.reply_content.length > 50 ? '...' : ''}</span></div>`;
    }

    // Aynı kullanıcı gruplama
    if (isSameUser && !msg.reply_to) {
        const lastGroup = el.chatMessages.querySelector('.message-group:last-of-type');
        if (lastGroup) {
            const contentDiv = lastGroup.querySelector('.message-content');
            if (contentDiv) {
                const rowDiv = document.createElement('div');
                rowDiv.className = 'msg-row-wrapper' + (isMentioned ? ' mentioned' : '');
                rowDiv.dataset.messageId = String(msg.id);
                rowDiv.style.cssText = 'position:relative; display:block;';

                const newTextDiv = document.createElement('div');
                newTextDiv.className = 'message-text';
                newTextDiv.dataset.messageId = String(msg.id);
                newTextDiv.innerHTML = safeContent;

                if (msg.is_pinned) {
                    const pinBadge = document.createElement('div');
                    pinBadge.innerHTML = '📌 <span data-lang-key="pinned_msg_badge" style="font-size:10px;">Sabitlendi</span>';
                    pinBadge.className = 'pinned-badge';
                    pinBadge.style.cssText = 'font-size:11px; color:var(--accent-warning); margin-bottom:4px; display:inline-flex; align-items:center; gap:4px; background:rgba(245,158,11,0.1); padding:2px 6px; border-radius:4px; font-weight:600;';
                    rowDiv.appendChild(pinBadge);
                }
                
                rowDiv.appendChild(newTextDiv);

                const rowReactBar = document.createElement('div');
                rowReactBar.className = 'reaction-bar';
                rowReactBar.dataset.reactionFor = String(msg.id);
                rowReactBar.innerHTML = buildReactionsHtml(msg.id, msg.reactions || '{}');
                rowDiv.appendChild(rowReactBar);

                rowDiv.appendChild(createHoverToolbar(msg, !!isMine));
                contentDiv.appendChild(rowDiv);
                scrollToBottom();
                
                if (isMentioned && !isMine) {
                    new Audio('assets/notification.mp3').play().catch(() => {});
                }
                return;
            }
        }
    }

    // Yeni mesaj grubu
    const messageEl = document.createElement('div');
    messageEl.className = 'message-group';
    messageEl.dataset.messageId = String(msg.id);

    const avatarStyle = msg.profile_pic
        ? `background-image: url('${msg.profile_pic}'); background-size: cover; background-position: center; color: transparent;`
        : `background-color: ${msg.avatarColor || '#6366f1'}`;

    const pinnedBadgeHtml = msg.is_pinned ? `<div class="pinned-badge" style="font-size:11px; color:var(--accent-warning); margin-bottom:4px; display:inline-flex; align-items:center; gap:4px; background:rgba(245,158,11,0.1); padding:2px 6px; border-radius:4px; font-weight:600;">📌 <span data-lang-key="pinned_msg_badge" style="font-size:10px;">Sabitlendi</span></div>` : '';

    messageEl.innerHTML = `<div class="message-avatar" style="${avatarStyle}">${msg.profile_pic ? '' : initial}</div><div class="message-content"><div class="message-header"><div><span class="message-username" style="color: ${msg.avatarColor || '#5865F2'}">${escapeHtml(msg.username)}</span><span class="message-timestamp" style="font-size:11px;color:var(--text-muted);margin-left:8px;">${timeStr}</span></div></div>${replyHtml}<div class="msg-row-wrapper${isMentioned ? ' mentioned' : ''}" data-message-id="${msg.id}" style="position:relative;display:block;">${pinnedBadgeHtml}<div class="message-text" data-message-id="${msg.id}">${safeContent}</div><div class="reaction-bar">${buildReactionsHtml(msg.id, msg.reactions || '{}')}</div></div></div>`;

    el.chatMessages.appendChild(messageEl);

    const msgRow = messageEl.querySelector('.msg-row-wrapper');
    if (msgRow) {
        msgRow.appendChild(createHoverToolbar(msg, !!isMine));
    }

    if (isMentioned && !isMine) {
        new Audio('assets/notification.mp3').play().catch(() => {});
    }

    // Resim context menu
    messageEl.querySelectorAll('.message-text img').forEach((img: Element) => {
        (img as HTMLElement).addEventListener('contextmenu', (e: Event) => {
            e.preventDefault();
            const me = e as MouseEvent;
            document.querySelectorAll('.img-context-menu').forEach(m => m.remove());

            const menu = document.createElement('div');
            menu.className = 'img-context-menu';
            menu.style.cssText = `position:fixed;left:${me.clientX}px;top:${me.clientY}px;z-index:9999;background:var(--bg-medium);border:1px solid var(--border-medium);border-radius:8px;padding:4px 0;box-shadow:0 8px 24px rgba(0,0,0,0.4);min-width:160px;`;

            const btnCopy = document.createElement('button');
            btnCopy.textContent = window.i18n ? window.i18n.t('copy_image') : '📋 Resmi Kopyala';
            btnCopy.style.cssText = 'display:block; width:100%; text-align:left; padding:8px 14px; background:none; border:none; color:var(--text-primary); cursor:pointer; font-size:13px;';
            btnCopy.onclick = async () => {
                menu.remove();
                try {
                    const response = await fetch((img as HTMLImageElement).src);
                    const blob = await response.blob();
                    await navigator.clipboard.write([new ClipboardItem({ [blob.type]: blob })]);
                    showToast(window.i18n ? window.i18n.t('image_copied') : 'Resim panoya kopyalandı!', 'success');
                } catch (_err) {
                    showToast(window.i18n ? window.i18n.t('image_copy_fail') : 'Resim kopyalanamadı!', 'error');
                }
            };

            const btnSave = document.createElement('button');
            btnSave.textContent = window.i18n ? window.i18n.t('save_image') : '💾 Resmi Kaydet';
            btnSave.style.cssText = 'display:block; width:100%; text-align:left; padding:8px 14px; background:none; border:none; color:var(--text-primary); cursor:pointer; font-size:13px;';
            btnSave.onclick = () => {
                menu.remove();
                const a = document.createElement('a');
                a.href = (img as HTMLImageElement).src;
                a.download = (img as HTMLImageElement).alt || 'resim';
                a.click();
            };

            menu.appendChild(btnCopy);
            menu.appendChild(btnSave);
            document.body.appendChild(menu);

            setTimeout(() => {
                document.addEventListener('click', function closeMenu() {
                    menu.remove();
                    document.removeEventListener('click', closeMenu);
                }, { once: true });
            }, 10);
        });
    });

    setTimeout(() => scrollToBottom(), 10);
}

// ── sendMessage ──

export async function sendMessage(): Promise<void> {
    if (!el.messageInput) return;
    const rawContent = el.messageInput.value.trim();
    const hasImages = state.pendingImages && state.pendingImages.length > 0;

    if (!rawContent && !hasImages) return;
    if (!state.socket) return;

    const doSend = async (): Promise<void> => {
        if (hasImages) {
            for (const blob of state.pendingImages) {
                let filename: string;
                if ((blob as File).name && (blob as File).name !== 'image.png') {
                    filename = (blob as File).name;
                } else {
                    const extMap: Record<string, string> = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/webp': 'webp' };
                    const ext = extMap[blob.type] || 'png';
                    filename = `image_${Date.now()}.${ext}`;
                }
                const file = new File([blob], filename, { type: blob.type });
                await window.uploadFileToChat(file);
            }
            state.pendingImages = [];
        }

        if (rawContent) {
            const encryptedContent = await encryptMessage(rawContent);
            if (state.editingMessageId) {
                state.socket!.emit('edit-message', {
                    messageId: state.editingMessageId,
                    newContent: encryptedContent
                });
                window.cancelEdit();
            } else {
                state.socket!.emit('send-message', {
                    content: encryptedContent,
                    type: state.isSelfDestructText ? 'self-destruct' : 'message',
                    replyTo: state.replyingTo ? state.replyingTo.id : null
                });
            }
        }

        el.messageInput!.value = '';
        el.messageInput!.style.height = 'auto';
        window.cancelReply();
        setTimeout(() => el.messageInput?.focus(), 10);
    };

    if (hasImages) {
        const msgMulti = window.i18n
            ? window.i18n.t('msg_send_multiple_images').replace('{count}', String(state.pendingImages.length))
            : `${state.pendingImages.length} adet görseli göndermek istediğinize emin misiniz?`;
        window.showConfirmModal(msgMulti, doSend);
    } else {
        await doSend();
    }
}

export async function sendDataMessage(content: string, type: string, replyTo: number | null = null): Promise<void> {
    if (!state.socket) return;
    const encryptedContent = await encryptMessage(content);
    state.socket.emit('send-message', {
        content: encryptedContent,
        type,
        replyTo
    });
}

// ── Reply ──

window.initiateReply = (msgId: number | string, username: string, content: string) => {
    state.replyingTo = { id: msgId, username, content };
    let previewEl = document.getElementById('reply-preview-box');

    if (!previewEl) {
        previewEl = document.createElement('div');
        previewEl.id = 'reply-preview-box';
        previewEl.style.cssText = 'display:none; align-items:center; justify-content:space-between; background:rgba(255,255,255,0.05); padding:8px 12px; border-left:3px solid var(--accent-primary); margin:0 16px 8px 16px; border-radius:var(--radius-sm); font-size:12px; color:var(--text-muted);';
        const inputContainer = document.querySelector('.chat-input-container');
        if (inputContainer && inputContainer.parentNode) {
            inputContainer.parentNode.insertBefore(previewEl, inputContainer);
        }
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
    el.messageInput?.focus();
};

window.cancelReply = () => {
    state.replyingTo = null;
    const previewEl = document.getElementById('reply-preview-box');
    if (previewEl) previewEl.style.display = 'none';
};

// ── Delete ──

window.deleteMessage = (messageId: number | string, roomId?: string) => {
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

// ── Reaction ──

window.sendReaction = (messageId: number | string, emoji: string) => {
    if (!state.socket) return;
    state.socket.emit('toggle-reaction', { messageId, emoji });
};

// ── User menu ──

window.toggleUserMute = (userId: string) => {
    const audioEl = document.getElementById(`audio-${userId}`) as HTMLAudioElement | null;
    if (audioEl) audioEl.muted = !audioEl.muted;
};

window.changeUserVolume = (userId: string, vol: string | number) => {
    const audioEl = document.getElementById(`audio-${userId}`) as HTMLAudioElement | null;
    if (audioEl) {
        audioEl.volume = Number(vol);
        if (audioEl.muted && Number(vol) > 0) audioEl.muted = false;
    }
};

window.openUserMenu = (e: MouseEvent, userId: string) => {
    e.preventDefault();
    const menu = document.getElementById('user-context-menu');
    const slider = document.getElementById('context-volume-slider') as HTMLInputElement | null;
    const muteBtn = document.getElementById('context-mute-btn');
    const audioEl = document.getElementById(`audio-${userId}`) as HTMLAudioElement | null;

    if (!menu || !audioEl || !slider || !muteBtn) return;

    slider.value = String(audioEl.volume);
    muteBtn.textContent = audioEl.muted ? (window.i18n ? window.i18n.t('unmute') : 'Sesi Aç') : (window.i18n ? window.i18n.t('mute') : 'Sustur');

    slider.oninput = (ev: Event) => {
        window.changeUserVolume(userId, (ev.target as HTMLInputElement).value);
    };

    muteBtn.onclick = () => {
        window.toggleUserMute(userId);
        muteBtn.textContent = audioEl.muted ? (window.i18n ? window.i18n.t('unmute') : 'Sesi Aç') : (window.i18n ? window.i18n.t('mute') : 'Sustur');
    };

    menu.style.display = 'block';
    let x = e.clientX;
    let y = e.clientY;
    if (x + menu.offsetWidth > window.innerWidth) x -= menu.offsetWidth;
    if (y + menu.offsetHeight > window.innerHeight) y -= menu.offsetHeight;
    menu.style.left = x + 'px';
    menu.style.top = y + 'px';
};

// ── Edit Message ──

window.initiateEdit = (msgId: number | string, contentBase64: string) => {
    state.editingMessageId = msgId;
    let previewEl = document.getElementById('edit-preview-box');

    if (!previewEl) {
        previewEl = document.createElement('div');
        previewEl.id = 'edit-preview-box';
        previewEl.style.cssText = 'display:none; align-items:center; justify-content:space-between; background:rgba(255,255,255,0.05); padding:8px 12px; border-left:3px solid #f59e0b; margin:0 16px 8px 16px; border-radius:var(--radius-sm); font-size:12px; color:var(--text-muted);';
        const inputContainer = document.querySelector('.chat-input-container');
        if (inputContainer && inputContainer.parentNode) {
            inputContainer.parentNode.insertBefore(previewEl, inputContainer);
        }
    }

    try {
        const rawContent = decodeURIComponent(atob(contentBase64));
        el.messageInput!.value = rawContent;
        el.messageInput!.style.height = 'auto';
        el.messageInput!.focus();
        
        previewEl.innerHTML = `
            <div>
                <strong style="color:#f59e0b; margin-right:6px;">Mesajı Düzenle</strong>
                <span>(ID: ${msgId})</span>
            </div>
            <button onclick="window.cancelEdit()" style="background:none; border:none; color:var(--text-muted); cursor:pointer; font-size:16px;">✕</button>
        `;
        previewEl.style.display = 'flex';
    } catch(e) {
        console.error('Mesaj çözülemedi', e);
    }
};

window.cancelEdit = () => {
    state.editingMessageId = null;
    const previewEl = document.getElementById('edit-preview-box');
    if (previewEl) previewEl.style.display = 'none';
    if (el.messageInput) {
        el.messageInput.value = '';
        el.messageInput.style.height = 'auto';
    }
};

window.viewEditHistory = async (historyStr: string) => {
    try {
        const arr = JSON.parse(decodeURIComponent(atob(historyStr)));
        let html = '<div style="max-height:300px; overflow-y:auto; text-align: left; padding: 0 10px;">';
        const { decryptMessage } = await import('./e2ee');
        const { linkify, escapeHtml } = await import('./utils');
        
        for (let i = arr.length - 1; i >= 0; i--) {
            const item = arr[i];
            const dateStr = new Date(item.edited_at).toLocaleString();
            let rawContent = item.content;
            try {
                rawContent = await decryptMessage(item.content);
            } catch (e) {
                // Ignore if not encrypted or decryption fails
            }
            const safeContent = linkify(escapeHtml(rawContent)).replace(/\n/g, '<br>');

            html += `<div style="padding:10px; border-bottom:1px solid #333; margin-bottom:5px;">
                <div style="font-size:10px; color:#aaa; margin-bottom:4px;">${dateStr}</div>
                <div style="font-size:13px; color:#ddd; word-wrap:break-word;">${safeContent}</div>
            </div>`;
        }
        html += '</div>';
        
        window.showConfirmModal(html, () => {}, true, true);
    } catch(e) {
        console.error(e);
        if (window.showToast) window.showToast('Geçmiş okunamadı', 'error');
    }
};

window.votePoll = (messageId: number, optionIndex: number, multiple: boolean) => {
    if (!state.socket) return;
    state.socket.emit('vote-poll', { messageId, optionIndex, multiple });
};

// ── Self Destruct Message ──

window.viewSelfDestruct = async (uniqueId: string, encryptedContent: string, messageId: number | string) => {
    const box = document.getElementById(uniqueId);
    if (!box || box.dataset.viewed === 'true') return;
    
    box.dataset.viewed = 'true';
    box.style.cursor = 'default';
    box.onclick = null;
    const textSpan = box.querySelector('span:not(.sd-icon)');
    const iconContainer = box.querySelector('.sd-icon');
    
    try {
        const { decryptMessage } = await import('./e2ee');
        const rawContent = await decryptMessage(encryptedContent);
        if (textSpan) {
            textSpan.innerHTML = linkify(escapeHtml(rawContent)).replace(/\n/g, '<br>');
            (textSpan as HTMLElement).style.filter = 'none';
            (textSpan as HTMLElement).style.userSelect = 'text';
        }
        if (iconContainer) iconContainer.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 0 0 2.5 2.5z"></path></svg>';
        box.style.background = 'rgba(245, 158, 11, 0.1)';
        box.style.borderColor = 'rgba(245, 158, 11, 0.3)';
        box.style.color = '#f59e0b';
    } catch (e) {
        if (textSpan) textSpan.textContent = 'Şifre Çözülemedi';
    }

    let secondsLeft = 5;
    const countdownEl = document.createElement('span');
    countdownEl.style.cssText = 'font-size:11px; opacity:0.7; margin-left:4px; min-width:18px; text-align:center; font-weight:700;';
    countdownEl.textContent = secondsLeft + 's';
    box.appendChild(countdownEl);

    const countdownInterval = setInterval(() => {
        secondsLeft--;
        countdownEl.textContent = secondsLeft + 's';
        if (secondsLeft <= 0) {
            clearInterval(countdownInterval);
            if (state.socket) {
                state.socket.emit('delete-message', { messageId });
            }
        }
    }, 1000);
};

