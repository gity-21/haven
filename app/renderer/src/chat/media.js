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

async function checkAdminStatus() {
    const adminTabBtn = document.getElementById('admin-tab-btn');
    const adminTabSep = document.getElementById('admin-tab-separator');
    const adminTabLbl = document.getElementById('admin-tab-label');

    const isLocalhostHost = state.serverUrl.includes('localhost') || state.serverUrl.includes('127.0.0.1');

    if (isLocalhostHost) {
        // Electron'daysa admin token'ı otomatik al (sunucu başlarken üretip dosyaya yazmıştır)
        if (window.electronAPI && window.electronAPI.getAdminToken && !state.adminToken) {
            try {
                const token = await window.electronAPI.getAdminToken();
                if (token) {
                    state.adminToken = token;
                    localStorage.setItem('haven_admin_token', token);
                    console.log('[ADMIN] Admin token otomatik olarak alındı.');
                }
            } catch (e) {
                console.warn('[ADMIN] Admin token alınamadı:', e);
            }
        }

        if (adminTabBtn) adminTabBtn.style.display = 'flex';
        if (adminTabSep) adminTabSep.style.display = 'block';
        if (adminTabLbl) adminTabLbl.style.display = 'block';
    }
}

async function loadAdminRooms() {
    const listContainer = document.getElementById('admin-rooms-list');
    if (!listContainer) return;

    listContainer.innerHTML = `<div style="color:var(--text-muted); font-size:12px; text-align:center; padding:20px;">${window.i18n ? window.i18n.t('rooms_loading') : 'Odalar yükleniyor...'}</div>`; // FIX #17

    try {
        // FIX #8: Admin API artık Bearer token gerektiriyor
        const adminHeaders = state.adminToken
            ? { 'Authorization': `Bearer ${state.adminToken}` }
            : {};
        const res = await fetch(`${state.serverUrl}/api/admin/rooms`, { headers: adminHeaders });
        const data = await res.json();

        if (!data.success) {
            listContainer.innerHTML = `<div style="color:var(--accent-danger); font-size:12px; text-align:center; padding:20px;">Erişim Reddedildi veya Hata! ADMIN_TOKEN kontrol edin.</div>`;
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
                    // FIX #8: Bearer token eklendi
                    await fetch(`${state.serverUrl}/api/admin/rooms/${roomKey}`, {
                        method: 'DELETE',
                        headers: state.adminToken ? { 'Authorization': `Bearer ${state.adminToken}` } : {}
                    });
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
                    // FIX #8: Bearer token eklendi
                    await fetch(`${state.serverUrl}/api/admin/rooms`, {
                        method: 'DELETE',
                        headers: state.adminToken ? { 'Authorization': `Bearer ${state.adminToken}` } : {}
                    });
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

