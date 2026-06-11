
const rtcConfig = {
    iceServers: [
        // Google STUN — domain + IP fallback (Electron DNS çözümleyemeyebilir)
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' },
        // Alternatif STUN sunucuları (Google DNS çözülemediğinde yedek)
        { urls: 'stun:stun.cloudflare.com:3478' },
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
        const savedMic = localStorage.getItem('haven_mic_device');
        const useNoiseSuppression = localStorage.getItem('haven_noise_suppression') !== 'false';
        
        const advancedAudioConfig = {
            echoCancellation: true,
            noiseSuppression: useNoiseSuppression,
            autoGainControl: true,
            googEchoCancellation: true,
            googExperimentalEchoCancellation: true,
            googNoiseSuppression: useNoiseSuppression,
            googExperimentalNoiseSuppression: useNoiseSuppression,
            googHighpassFilter: useNoiseSuppression,
            googTypingNoiseDetection: useNoiseSuppression,
            googAudioMirroring: false
        };

        const audioConstraint = savedMic ? { 
            deviceId: { exact: savedMic },
            ...advancedAudioConfig
        } : advancedAudioConfig;

        stream = await navigator.mediaDevices.getUserMedia({ 
            audio: audioConstraint, 
            video: withVideo 
        });
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
            ? '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"></path><path d="M19 10v2a7 7 0 0 1-14 0v-2"></path><line x1="12" y1="19" x2="12" y2="23"></line><line x1="8" y1="23" x2="16" y2="23"></line></svg> <span data-lang-key="audio_mic">' + (window.i18n ? window.i18n.t('audio_mic') : 'Mikrofon') + '</span>'
            : '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="color:var(--accent-danger);"><line x1="1" y1="1" x2="23" y2="23"></line><path d="M9 9v3a3 3 0 0 0 5.12 2.12M15 9.34V4a3 3 0 0 0-5.94-.6"></path><path d="M17 16.95A7 7 0 0 1 5 12H3a9 9 0 0 0 8.46 8.94V23h1v-2.06A8.96 8.96 0 0 0 19 16.95"></path></svg> <span style="color:var(--accent-danger);" data-lang-key="mute">' + (window.i18n ? window.i18n.t('mute') : 'Susturuldu') + '</span>';
    }
    if (el.btnToggleVideo) {
        el.btnToggleVideo.innerHTML = voiceState.isVideoOn
            ? '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="1" y1="1" x2="23" y2="23"></line><path d="M21 17.16V5a2 2 0 0 0-2-2H7.95"></path><path d="M3.27 3.27A2 2 0 0 0 1 5v14a2 2 0 0 0 2 2h14c.55 0 1.05-.22 1.41-.59"></path><polygon points="23 7 16 12 23 17 23 7"></polygon></svg> <span data-lang-key="chat_cam_on">' + (window.i18n ? window.i18n.t('chat_cam_on') : 'Kamera Kapat') + '</span>'
            : '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="23 7 16 12 23 17 23 7"></polygon><rect x="1" y="5" width="15" height="14" rx="2" ry="2"></rect></svg> <span data-lang-key="chat_cam_off">' + (window.i18n ? window.i18n.t('chat_cam_off') : 'Kamera Aç') + '</span>';
    }
    if (el.btnToggleScreen) {
        el.btnToggleScreen.innerHTML = voiceState.isScreenOn
            ? '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="3" width="20" height="14" rx="2" ry="2"></rect><line x1="8" y1="21" x2="16" y2="21"></line><line x1="12" y1="17" x2="12" y2="21"></line><line x1="1" y1="1" x2="23" y2="23"></line></svg> <span data-lang-key="chat_stop_screen">' + (window.i18n ? window.i18n.t('chat_stop_screen') : 'Paylaşımı Durdur') + '</span>'
            : '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="3" width="20" height="14" rx="2" ry="2"></rect><line x1="8" y1="21" x2="16" y2="21"></line><line x1="12" y1="17" x2="12" y2="21"></line></svg> <span data-lang-key="chat_screen_share">' + (window.i18n ? window.i18n.t('chat_screen_share') : 'Ekran Paylaş') + '</span>';
    }
}

function toggleMic() {
    if (!voiceState.isInVoice || !voiceState.localStream) return;

    const audioTracks = voiceState.localStream.getAudioTracks();
    if (audioTracks.length > 0) {
        voiceState.isMicOn = !voiceState.isMicOn;
        audioTracks[0].enabled = voiceState.isMicOn;
        updateToggleButtonsUI();
        
        if (state.socket) {
            state.socket.emit('mic-state', { isMicOn: voiceState.isMicOn });
        }
        updateMicBadge('local', voiceState.isMicOn);
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
    el.screenShareGrid.innerHTML = `<p style="color:var(--text-muted); text-align:center; width:100%; grid-column:1/-1;">${window.i18n ? window.i18n.t('resources_loading') : 'Kaynaklar yükleniyor...'}</p>`; // FIX #17

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
            ${window.i18n ? window.i18n.t('screen_sharing') : 'Ekran Paylaşılıyor'}
        `; // FIX #17
        // Badge'i card'ın ilk child div'inin sonuna ekle
        const innerDiv = card.querySelector('div');
        if (innerDiv) innerDiv.appendChild(badge);
    }
}

// Mikrofon kapalı badge'ini göster/gizle
function updateMicBadge(userId, isMicOn) {
    const card = document.getElementById(`voice-card-${userId}`);
    if (!card) return;

    let existingBadge = card.querySelector('.mic-status-badge');
    if (isMicOn) {
        if (existingBadge) existingBadge.remove();
    } else {
        if (!existingBadge) {
            const badge = document.createElement('div');
            badge.className = 'mic-status-badge';
            badge.style.cssText = 'position:absolute; bottom:-4px; right:-4px; background:var(--accent-danger); border:2px solid var(--bg-card); border-radius:50%; width:22px; height:22px; display:flex; align-items:center; justify-content:center; color:white; box-shadow:0 2px 4px rgba(0,0,0,0.3); z-index:10;';
            badge.innerHTML = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="1" y1="1" x2="23" y2="23"></line><path d="M9 9v3a3 3 0 0 0 5.12 2.12M15 9.34V4a3 3 0 0 0-5.94-.6"></path><path d="M17 16.95A7 7 0 0 1 5 12v-2m14 0v2a7 7 0 0 1-.11 1.23"></path><line x1="12" y1="19" x2="12" y2="23"></line><line x1="8" y1="23" x2="16" y2="23"></line></svg>`;
            
            card.style.position = 'relative';
            card.appendChild(badge);
        }
    }
}

function leaveVoiceRoom() {
    voiceState.isInVoice = false;

    if (voiceState.localStream) {
        voiceState.localStream.getTracks().forEach(track => track.stop());
        voiceState.localStream = null;
    }

    stopRingtone();

    // FIX #13: Tüm AudioContext ve MediaStreamSource nesneleri kapatılıyor.
    // Eski kod sadece 'local' meter'ı siliyordu; diğer peer meter'ları ve
    // AudioContext nesnesinin kendisi serbest bırakılmıyordu (bellek sızıntısı).
    Object.keys(volumeMeters).forEach(id => {
        cancelAnimationFrame(volumeMeters[id].animationFrame);
        try { volumeMeters[id].source.disconnect(); } catch (_) {}
        delete volumeMeters[id];
    });
    if (audioContext) {
        audioContext.close().catch(e => console.warn('[AudioContext] close hatası:', e));
        audioContext = null;
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

    // FIX #13: Eski meter varsa source'u da disconnect et
    if (volumeMeters[targetId]) {
        cancelAnimationFrame(volumeMeters[targetId].animationFrame);
        try { volumeMeters[targetId].source.disconnect(); } catch (_) {}
        delete volumeMeters[targetId];
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

                // FIX: Electron'da autoplay engellenebilir, açıkça play() çağır
                audioEl.play().catch(e => console.warn('[Ses] Audio play hatası (autoplay engeli?):', e));

                // Kullanıcının seçtiği hoparlörü uygula
                const savedSpeaker = localStorage.getItem('haven_speaker_device');
                if (savedSpeaker && typeof audioEl.setSinkId === 'function') {
                    audioEl.setSinkId(savedSpeaker).catch(e => console.warn('Hoparlör değiştirilemedi:', e));
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
        try { volumeMeters[targetId].source.disconnect(); } catch (_) {} // FIX #13
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
                    headers: state.uploadToken ? { 'x-upload-token': state.uploadToken } : {},
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