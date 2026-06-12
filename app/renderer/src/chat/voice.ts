/**
 * voice.ts — WebRTC Sesli/Görüntülü Arama Sistemi
 *
 * RTCPeerConnection yönetimi, mikrofon/kamera/ekran toggle,
 * Noise Gate, STUN konfigürasyonu ve P2P dosya transfer başlatma.
 */

import { state, voiceState, volumeMeters, playRingtone, stopRingtone } from './state';
import { el } from './elements';
import { escapeHtml } from './utils';
import { showToast } from './ui/toast';
import { createMediaElement, setupVolumeMeter, updateScreenShareBadge, updateActiveCallBanner, updateMicStatusUI } from './ui/voice-ui';

// ── RTC Config ──

export const rtcConfig: RTCConfiguration = {
    iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' },
        { urls: 'stun:stun.cloudflare.com:3478' },
        { urls: 'stun:stun.nextcloud.com:443' },
        { urls: 'stun:stun.relay.metered.ca:80' },
    ]
};

// ── Noise Gate referansları ──

interface NoiseGateRefs {
    context: AudioContext;
    source: MediaStreamAudioSourceNode;
    analyser: AnalyserNode;
    gainNode: GainNode;
    destination: MediaStreamAudioDestinationNode;
}

// ── Peer Connection ──

export async function createPeerConnection(targetId: string, isInitiator: boolean): Promise<RTCPeerConnection> {
    const pc = new RTCPeerConnection(rtcConfig);
    voiceState.peers[targetId] = pc;

    // Perfect Negotiation
    (pc as any).makingOffer = false;
    (pc as any).ignoreOffer = false;
    (pc as any).isPolite = state.socket!.id! > targetId;

    if (voiceState.localStream) {
        voiceState.localStream.getTracks().forEach((track: MediaStreamTrack) => {
            pc.addTrack(track, voiceState.localStream!);
        });
    }

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
            (pc as any).makingOffer = true;
            const offer = await pc.createOffer();
            await pc.setLocalDescription(offer);
            state.socket!.emit('webrtc-offer', { targetId, offer: pc.localDescription });
        } catch (err) {
            console.error('Negotiation error:', err);
        } finally {
            (pc as any).makingOffer = false;
        }
    };

    pc.onicecandidate = (event) => {
        if (event.candidate) {
            state.socket!.emit('webrtc-candidate', { targetId, candidate: event.candidate });
        }
    };

    pc.ontrack = (event) => {
        const stream = event.streams[0];
        const audioEl = document.getElementById(`audio-${targetId}`) as HTMLAudioElement | null;
        const videoEl = document.getElementById(`video-${targetId}`) as HTMLVideoElement | null;

        if (event.track.kind === 'audio') {
            if (audioEl) {
                if (!audioEl.srcObject) {
                    audioEl.srcObject = new MediaStream([event.track]);
                    setupVolumeMeter(audioEl.srcObject as MediaStream, targetId);
                } else {
                    (audioEl.srcObject as MediaStream).addTrack(event.track);
                    setupVolumeMeter(audioEl.srcObject as MediaStream, targetId);
                }
                audioEl.play().catch(e => console.warn('[Ses] Audio play hatası:', e));

                const savedSpeaker = localStorage.getItem('haven_speaker_device');
                if (savedSpeaker && typeof (audioEl as any).setSinkId === 'function') {
                    (audioEl as any).setSinkId(savedSpeaker).catch((e: Error) => console.warn('Hoparlör değiştirilemedi:', e));
                }
            }
        }

        if (stream && event.track.kind === 'video') {
            if (videoEl) {
                setTimeout(() => {
                    videoEl.srcObject = null;
                    videoEl.srcObject = stream;
                    videoEl.style.display = 'block';
                }, 50);
            }
        }

        event.track.onended = () => {
            if (event.track.kind === 'video' && videoEl) {
                if (!stream.getVideoTracks().length || stream.getVideoTracks().every(t => t.readyState === 'ended')) {
                    videoEl.style.display = 'none';
                }
            }
        };
        event.track.onmute = () => {
            if (event.track.kind === 'video' && videoEl) videoEl.style.display = 'none';
        };
        event.track.onunmute = () => {
            if (event.track.kind === 'video' && videoEl) {
                videoEl.srcObject = stream;
                videoEl.style.display = 'block';
            }
        };
    };

    pc.oniceconnectionstatechange = () => {
        if (pc.iceConnectionState === 'disconnected' || pc.iceConnectionState === 'failed') {
            removePeerConnection(targetId);
        }
    };

    return pc;
}

export function removePeerConnection(targetId: string): void {
    if (voiceState.peers[targetId]) {
        voiceState.peers[targetId].close();
        delete voiceState.peers[targetId];
    }

    if (volumeMeters[targetId]) {
        cancelAnimationFrame(volumeMeters[targetId].animationFrame);
        try { volumeMeters[targetId].source.disconnect(); } catch (_) { /* */ }
        delete volumeMeters[targetId];
    }

    const circle = document.getElementById(`voice-card-${targetId}`);
    if (circle) circle.remove();
}

// ── Toggle Butonları UI ──

export function updateToggleButtonsUI(): void {
    if (el.btnToggleMic) {
        el.btnToggleMic.innerHTML = voiceState.isMicOn
            ? '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"></path><path d="M19 10v2a7 7 0 0 1-14 0v-2"></path><line x1="12" y1="19" x2="12" y2="23"></line><line x1="8" y1="23" x2="16" y2="23"></line></svg> <span>' + (window.i18n ? window.i18n.t('audio_mic') : 'Mikrofon') + '</span>'
            : '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="color:var(--accent-danger);"><line x1="1" y1="1" x2="23" y2="23"></line><path d="M9 9v3a3 3 0 0 0 5.12 2.12M15 9.34V4a3 3 0 0 0-5.94-.6"></path></svg> <span style="color:var(--accent-danger);">' + (window.i18n ? window.i18n.t('mute') : 'Susturuldu') + '</span>';
    }
    if (el.btnToggleVideo) {
        el.btnToggleVideo.innerHTML = voiceState.isVideoOn
            ? '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="23 7 16 12 23 17 23 7"></polygon><rect x="1" y="5" width="15" height="14" rx="2" ry="2"></rect></svg> <span>' + (window.i18n ? window.i18n.t('chat_cam_on') : 'Kamera Kapat') + '</span>'
            : '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="23 7 16 12 23 17 23 7"></polygon><rect x="1" y="5" width="15" height="14" rx="2" ry="2"></rect></svg> <span>' + (window.i18n ? window.i18n.t('chat_cam_off') : 'Kamera Aç') + '</span>';
    }
    if (el.btnToggleScreen) {
        el.btnToggleScreen.innerHTML = voiceState.isScreenOn
            ? '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="3" width="20" height="14" rx="2" ry="2"></rect><line x1="8" y1="21" x2="16" y2="21"></line><line x1="12" y1="17" x2="12" y2="21"></line></svg> <span>' + (window.i18n ? window.i18n.t('chat_stop_screen') : 'Paylaşımı Durdur') + '</span>'
            : '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="3" width="20" height="14" rx="2" ry="2"></rect><line x1="8" y1="21" x2="16" y2="21"></line><line x1="12" y1="17" x2="12" y2="21"></line></svg> <span>' + (window.i18n ? window.i18n.t('chat_screen_share') : 'Ekran Paylaş') + '</span>';
    }
}

// ── Ses odasına katıl ──

export async function joinVoiceRoom(withVideo = false): Promise<void> {
    if (voiceState.isInVoice) return;

    let stream: MediaStream;
    try {
        const savedMic = localStorage.getItem('haven_mic_device');
        const useNoiseSuppression = localStorage.getItem('haven_noise_suppression') !== 'false';

        const advancedAudioConfig: MediaTrackConstraints = {
            echoCancellation: true,
            noiseSuppression: useNoiseSuppression,
            autoGainControl: true,
        };

        const audioConstraint: MediaTrackConstraints = savedMic
            ? { deviceId: { exact: savedMic }, ...advancedAudioConfig }
            : advancedAudioConfig;

        stream = await navigator.mediaDevices.getUserMedia({ audio: audioConstraint, video: withVideo });
    } catch (err) {
        const error = err as DOMException;
        if (error.name === 'NotAllowedError') {
            showToast(window.i18n ? window.i18n.t('mic_denied') : 'Mikrofon/Kamera izni reddedildi.', 'error');
        } else if (error.name === 'NotFoundError') {
            showToast(window.i18n ? window.i18n.t('no_device') : 'Mikrofon veya kamera cihazı bulunamadı.', 'error');
        } else {
            showToast(`${window.i18n ? window.i18n.t('access_error') : 'Erişim sağlanamadı'}: ${error.message}`, 'error');
        }
        throw err;
    }

    voiceState.localStream = stream;
    voiceState.isInVoice = true;
    voiceState.isVideoOn = withVideo;
    voiceState.isScreenOn = false;

    // Noise Gate
    const useNoiseGate = localStorage.getItem('haven_noise_suppression') !== 'false';
    if (useNoiseGate) {
        try {
            const ngContext = new AudioContext();
            const source = ngContext.createMediaStreamSource(stream);
            const analyser = ngContext.createAnalyser();
            analyser.fftSize = 2048;
            analyser.smoothingTimeConstant = 0.3;
            const gainNode = ngContext.createGain();
            gainNode.gain.value = 1.0;
            const destination = ngContext.createMediaStreamDestination();

            source.connect(analyser);
            source.connect(gainNode);
            gainNode.connect(destination);

            const dataArray = new Float32Array(analyser.fftSize);
            const NOISE_THRESHOLD = -50;
            const ATTACK_TIME = 0.01;
            const RELEASE_TIME = 0.15;
            let isGateOpen = false;

            function processNoiseGate(): void {
                if (!voiceState.isInVoice) return;
                analyser.getFloatTimeDomainData(dataArray);
                let sumSquares = 0;
                for (let i = 0; i < dataArray.length; i++) {
                    sumSquares += dataArray[i] * dataArray[i];
                }
                const rms = Math.sqrt(sumSquares / dataArray.length);
                const dB = 20 * Math.log10(Math.max(rms, 1e-10));
                const now = ngContext.currentTime;
                if (dB > NOISE_THRESHOLD) {
                    if (!isGateOpen) {
                        gainNode.gain.cancelScheduledValues(now);
                        gainNode.gain.setTargetAtTime(1.0, now, ATTACK_TIME);
                        isGateOpen = true;
                    }
                } else {
                    if (isGateOpen) {
                        gainNode.gain.cancelScheduledValues(now);
                        gainNode.gain.setTargetAtTime(0.0, now, RELEASE_TIME);
                        isGateOpen = false;
                    }
                }
                requestAnimationFrame(processNoiseGate);
            }
            processNoiseGate();

            const processedStream = destination.stream;
            if (withVideo) {
                const videoTrack = stream.getVideoTracks()[0];
                if (videoTrack) processedStream.addTrack(videoTrack);
            }
            voiceState.localStream = processedStream;
            (voiceState as any)._noiseGate = { context: ngContext, source, analyser, gainNode, destination } as NoiseGateRefs;
        } catch (ngErr) {
            console.warn('[Noise Gate] Kurulamadı:', ngErr);
            voiceState.localStream = stream;
        }
    }

    if (el.voiceContainer) el.voiceContainer.style.display = 'block';
    if (el.activeCallBanner) el.activeCallBanner.style.display = 'none';
    if (el.btnJoinVoice) el.btnJoinVoice.style.display = 'none';
    if (el.btnJoinVideo) el.btnJoinVideo.style.display = 'none';
    if (el.callStatusText) el.callStatusText.textContent = withVideo
        ? (window.i18n ? window.i18n.t('video_call_connected') : 'Görüntülü Görüşme Bağlı')
        : (window.i18n ? window.i18n.t('voice_call_connected') : 'Sesli Görüşme Bağlı');

    updateToggleButtonsUI();
    createMediaElement('local', state.nickname, state.avatarColor, true, voiceState.localStream, state.profilePic);
    setupVolumeMeter(voiceState.localStream, 'local');

    state.socket!.emit('voice-join', { isMicOn: voiceState.isMicOn });
    showToast(withVideo
        ? (window.i18n ? window.i18n.t('joined_video') : 'Görüntülü sohbete katıldınız!')
        : (window.i18n ? window.i18n.t('joined_voice') : 'Sesli sohbete katıldınız!'), 'success');
}

export async function initiateVoiceCall(withVideo = false): Promise<void> {
    try {
        await joinVoiceRoom(withVideo);
        state.socket!.emit('voice-call-room');
        showToast(window.i18n ? window.i18n.t('searching_users') : 'Odadakiler aranıyor...', 'success');
    } catch (e) {
        console.error('[Ses] Arama başlatılamadı:', e);
    }
}

export function leaveVoiceRoom(): void {
    voiceState.isInVoice = false;

    if (voiceState.localStream) {
        voiceState.localStream.getTracks().forEach((track: MediaStreamTrack) => track.stop());
        voiceState.localStream = null;
    }

    stopRingtone();

    Object.keys(volumeMeters).forEach(id => {
        cancelAnimationFrame(volumeMeters[id].animationFrame);
        try { volumeMeters[id].source.disconnect(); } catch (_) { /* */ }
        delete volumeMeters[id];
    });

    if (voiceState.screenStream) {
        voiceState.screenStream.getTracks().forEach((track: MediaStreamTrack) => track.stop());
        voiceState.screenStream = null;
    }

    voiceState.isVideoOn = false;
    voiceState.isScreenOn = false;

    Object.keys(voiceState.peers).forEach(userId => removePeerConnection(userId));

    if (el.voiceContainer) el.voiceContainer.style.display = 'none';
    if (el.btnJoinVoice) el.btnJoinVoice.style.display = 'flex';
    if (el.btnJoinVideo) el.btnJoinVideo.style.display = 'flex';
    if (el.voiceParticipants) el.voiceParticipants.innerHTML = '';

    state.socket!.emit('voice-leave');
    state.socket!.emit('call-ended');
    showToast(window.i18n ? window.i18n.t('left_call') : 'Görüşmeden ayrıldınız.', 'info');
}

// ── Toggle Mic ──

export function toggleMic(): void {
    if (!voiceState.isInVoice || !voiceState.localStream) return;
    const audioTracks = voiceState.localStream.getAudioTracks();
    if (audioTracks.length > 0) {
        voiceState.isMicOn = !voiceState.isMicOn;
        audioTracks[0].enabled = voiceState.isMicOn;
        updateToggleButtonsUI();
        state.socket!.emit('mic-state', { isMicOn: voiceState.isMicOn });
        updateMicStatusUI('local', voiceState.isMicOn);
    }
}

// ── Toggle Video ──

export async function toggleVideo(): Promise<void> {
    if (!voiceState.isInVoice) return;

    if (voiceState.isVideoOn) {
        const tracks = voiceState.localStream!.getVideoTracks();
        tracks.forEach((track: MediaStreamTrack) => {
            track.stop();
            voiceState.localStream!.removeTrack(track);
        });
        voiceState.isVideoOn = false;
        const videoEl = document.getElementById('video-local') as HTMLVideoElement | null;
        if (videoEl) videoEl.style.display = 'none';

        Object.values(voiceState.peers).forEach((pc: RTCPeerConnection) => {
            const senders = pc.getSenders();
            const sender = senders.find((s: RTCRtpSender) => s.track && s.track.kind === 'video');
            if (sender) pc.removeTrack(sender);
        });
    } else {
        try {
            const tempStream = await navigator.mediaDevices.getUserMedia({ video: true });
            const videoTrack = tempStream.getVideoTracks()[0];
            voiceState.localStream!.addTrack(videoTrack);
            voiceState.isVideoOn = true;

            const videoEl = document.getElementById('video-local') as HTMLVideoElement | null;
            if (videoEl) {
                videoEl.srcObject = voiceState.localStream;
                videoEl.style.display = 'block';
            }

            Object.values(voiceState.peers).forEach((pc: RTCPeerConnection) => {
                pc.addTrack(videoTrack, voiceState.localStream!);
            });
        } catch (err) {
            showToast(window.i18n ? window.i18n.t('cam_failed') : 'Kamera açılamadı!', 'error');
            return;
        }
    }
    updateToggleButtonsUI();
}

// ── Screen Share ──

export function startScreenShareWithStream(screenStream: MediaStream): void {
    voiceState.screenStream = screenStream;
    const screenVideoTrack = screenStream.getVideoTracks()[0];
    const screenAudioTrack = screenStream.getAudioTracks()[0];
    voiceState.isScreenOn = true;

    screenVideoTrack.onended = () => { toggleScreen(); };

    const videoEl = document.getElementById('video-local') as HTMLVideoElement | null;
    if (videoEl) {
        videoEl.srcObject = screenStream;
        videoEl.style.display = 'block';
        videoEl.style.transform = 'none';
    }

    updateScreenShareBadge('local', state.nickname, true);
    if (state.socket) state.socket.emit('screen-share-state', { isSharing: true });

    Object.keys(voiceState.peers).forEach(targetId => {
        const pc = voiceState.peers[targetId];
        const senders = pc.getSenders();
        const videoSender = senders.find((s: RTCRtpSender) => s.track && s.track.kind === 'video');

        if (videoSender) {
            videoSender.replaceTrack(screenVideoTrack);
        } else {
            pc.addTrack(screenVideoTrack, voiceState.screenStream!);
        }

        if (screenAudioTrack) {
            const audioSender = senders.find((s: RTCRtpSender) => s.track && s.track.kind === 'audio' && s.track.id !== voiceState.localStream?.getAudioTracks()[0]?.id);
            if (audioSender) {
                audioSender.replaceTrack(screenAudioTrack);
            } else {
                pc.addTrack(screenAudioTrack, voiceState.screenStream!);
            }
        }
    });

    updateToggleButtonsUI();
    showToast(window.i18n ? window.i18n.t('toast_screen_share_started') : 'Ekran paylaşımı başlatıldı!', 'success');
}

export async function toggleScreen(): Promise<void> {
    if (!voiceState.isInVoice) return;

    if (voiceState.isScreenOn) {
        if (voiceState.screenStream) {
            voiceState.screenStream.getTracks().forEach((track: MediaStreamTrack) => track.stop());
            voiceState.screenStream = null;
        }
        voiceState.isScreenOn = false;
        updateScreenShareBadge('local', state.nickname, false);
        if (state.socket) state.socket.emit('screen-share-state', { isSharing: false });

        Object.values(voiceState.peers).forEach((pc: RTCPeerConnection) => {
            const senders = pc.getSenders();
            const sender = senders.find((s: RTCRtpSender) => s.track && s.track.kind === 'video');
            if (sender) {
                if (voiceState.isVideoOn && voiceState.localStream!.getVideoTracks()[0]) {
                    sender.replaceTrack(voiceState.localStream!.getVideoTracks()[0]);
                } else {
                    pc.removeTrack(sender);
                }
            }
        });

        const videoEl = document.getElementById('video-local') as HTMLVideoElement | null;
        if (videoEl && voiceState.isVideoOn) {
            videoEl.srcObject = voiceState.localStream;
            videoEl.style.display = 'block';
        } else if (videoEl) {
            videoEl.style.display = 'none';
        }

        showToast(window.i18n ? window.i18n.t('toast_screen_share_stopped') : 'Ekran paylaşımı durduruldu.', 'info');
    } else {
        try {
            if (window.electronAPI && typeof window.electronAPI.getDesktopSources === 'function') {
                openScreenShareModal();
                return;
            } else {
                const screenStream = await navigator.mediaDevices.getDisplayMedia({ video: { cursor: 'always' } as any, audio: false });
                startScreenShareWithStream(screenStream);
            }
        } catch (err) {
            showToast(window.i18n ? window.i18n.t('screen_share_failed') : 'Ekran paylaşılamadı!', 'error');
            return;
        }
    }
    updateToggleButtonsUI();
}

// ── Electron Ekran Paylaşım Modalı ──

async function openScreenShareModal(): Promise<void> {
    if (!el.modalScreenShare || !el.screenShareGrid) return;
    el.modalScreenShare.classList.add('visible');
    el.screenShareGrid.innerHTML = `<p style="color:var(--text-muted); text-align:center; width:100%; grid-column:1/-1;">${window.i18n ? window.i18n.t('resources_loading') : 'Kaynaklar yükleniyor...'}</p>`;

    async function loadSources(type: string): Promise<void> {
        try {
            const sources = await window.electronAPI!.getDesktopSources({ types: [type] });
            el.screenShareGrid!.innerHTML = '';

            if (!sources || sources.length === 0) {
                el.screenShareGrid!.innerHTML = `<div style="grid-column:1/-1; text-align:center; padding: 24px;"><p style="color:var(--accent-warning); margin-bottom:12px;">⚠️ Ekran kaynakları alınamadı.</p><button id="btn-screen-share-fallback" style="padding:10px 24px; background:var(--accent-primary); color:var(--text-on-accent); border:none; border-radius:8px; cursor:pointer; font-weight:600;">Tarayıcı Ekran Seçicisini Kullan</button></div>`;
                document.getElementById('btn-screen-share-fallback')?.addEventListener('click', async () => {
                    el.modalScreenShare!.classList.remove('visible');
                    try {
                        const screenStream = await navigator.mediaDevices.getDisplayMedia({ video: { cursor: 'always' } as any, audio: false });
                        startScreenShareWithStream(screenStream);
                        updateToggleButtonsUI();
                    } catch (_) {
                        showToast(window.i18n ? window.i18n.t('screen_share_failed') : 'Ekran paylaşılamadı!', 'error');
                    }
                });
                return;
            }

            sources.forEach((source: any) => {
                const item = document.createElement('div');
                item.style.cssText = 'background:var(--bg-dark); border-radius:var(--radius-sm); padding:10px; cursor:pointer; text-align:center; border:2px solid transparent; transition:var(--transition-fast);';
                item.onmouseover = () => item.style.borderColor = 'var(--accent-primary)';
                item.onmouseout = () => item.style.borderColor = 'transparent';
                item.innerHTML = `<img src="${source.thumbnail.toDataURL ? source.thumbnail.toDataURL() : source.thumbnail}" style="width:100%; aspect-ratio:16/9; object-fit:contain; background:#000; border-radius:4px; margin-bottom:8px;"><div style="font-size:12px; color:var(--text-primary); white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${escapeHtml(source.name)}</div>`;

                item.onclick = async () => {
                    el.modalScreenShare!.classList.remove('visible');
                    try {
                        const stream = await navigator.mediaDevices.getUserMedia({
                            video: { mandatory: { chromeMediaSource: 'desktop', chromeMediaSourceId: source.id } } as any,
                            audio: { mandatory: { chromeMediaSource: 'desktop' } } as any
                        });
                        startScreenShareWithStream(stream);
                    } catch (_) {
                        try {
                            const streamNoAudio = await navigator.mediaDevices.getUserMedia({
                                video: { mandatory: { chromeMediaSource: 'desktop', chromeMediaSourceId: source.id } } as any
                            });
                            startScreenShareWithStream(streamNoAudio);
                        } catch (e2) {
                            showToast(window.i18n ? window.i18n.t('source_share_failed') : 'Bu kaynak paylaşılamadı.', 'error');
                        }
                    }
                };

                el.screenShareGrid!.appendChild(item);
            });
        } catch (err) {
            el.screenShareGrid!.innerHTML = '<p style="color:var(--accent-danger); text-align:center; width:100%; grid-column:1/-1;">Kaynaklar alınamadı.</p>';
        }
    }

    if (el.tabScreens) el.tabScreens.onclick = () => loadSources('screen');
    if (el.tabWindows) el.tabWindows.onclick = () => loadSources('window');
    if (el.btnCloseScreenModal) el.btnCloseScreenModal.onclick = () => el.modalScreenShare!.classList.remove('visible');

    loadSources('screen');
}

// ── P2P Download ──

export { updateActiveCallBanner };
