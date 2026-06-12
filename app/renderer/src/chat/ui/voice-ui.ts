/**
 * voice-ui.ts — Ses Arayüzü Modülü
 *
 * Sesli/görüntülü arama katılımcı kartları, aktif arama bannerı,
 * ekran paylaşımı badge ve ses seviyesi metre fonksiyonları.
 */

import { state, voiceState, volumeMeters } from '../state';
import { el } from '../elements';
import { escapeHtml } from '../utils';
import type { VoiceUserData } from '../../types/socket-events';
import type { VolumeMeterEntry } from '../../types/state';

/**
 * Aktif arama bannerını günceller (sesli kanalda kim var gösterir).
 */
export function updateActiveCallBanner(voiceUsers: VoiceUserData[]): void {
    if (!el.activeCallBanner || !el.activeCallParticipants) return;

    if (!voiceUsers || voiceUsers.length === 0) {
        el.activeCallBanner.style.display = 'none';
        return;
    }

    // Eğer bu kullanıcı zaten sesteyse bannerı gösterme
    if (voiceState.isInVoice) {
        el.activeCallBanner.style.display = 'none';
        return;
    }

    el.activeCallBanner.style.display = 'flex';
    el.activeCallParticipants.textContent = voiceUsers
        .map(u => u.username)
        .join(', ');
}

/**
 * Ekran paylaşımı badge'ini günceller.
 */
export function updateScreenShareBadge(userId: string, username: string, isSharing: boolean): void {
    const existingBadge = document.getElementById(`screen-badge-${userId}`);

    if (isSharing) {
        if (!existingBadge && el.voiceParticipants) {
            const badge = document.createElement('div');
            badge.id = `screen-badge-${userId}`;
            badge.style.cssText = 'background:rgba(99, 102, 241, 0.2); border:1px solid rgba(99, 102, 241, 0.3); padding:6px 12px; border-radius:8px; font-size:12px; color:var(--accent-primary); display:flex; align-items:center; gap:6px;';
            badge.innerHTML = `
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <rect x="2" y="3" width="20" height="14" rx="2" ry="2"></rect>
                    <line x1="8" y1="21" x2="16" y2="21"></line>
                    <line x1="12" y1="17" x2="12" y2="21"></line>
                </svg>
                ${escapeHtml(username)} ${window.i18n ? window.i18n.t('sharing_screen') : 'ekranını paylaşıyor'}
            `;
            el.voiceParticipants.appendChild(badge);
        }
    } else {
        if (existingBadge) existingBadge.remove();
    }
}

/**
 * Ses seviyesi metre'sini ayarlar (konuşma tespiti için).
 */
export function setupVolumeMeter(stream: MediaStream, targetId: string): void {
    // Eğer zaten varsa eski olanı temizle
    if (volumeMeters[targetId]) {
        cancelAnimationFrame(volumeMeters[targetId].animationFrame);
        try { volumeMeters[targetId].source.disconnect(); } catch (_) { /* ignore */ }
        delete volumeMeters[targetId];
    }

    try {
        const audioContext = new AudioContext();
        const source = audioContext.createMediaStreamSource(stream);
        const analyser = audioContext.createAnalyser();

        analyser.fftSize = 256;
        analyser.smoothingTimeConstant = 0.4;
        source.connect(analyser);

        const dataArray = new Uint8Array(analyser.frequencyBinCount);

        function checkVolume(): void {
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

/**
 * Ses/görüntü katılımcı kartını oluşturur.
 */
export function createMediaElement(
    userId: string,
    username: string,
    color: string,
    isLocal = false,
    stream: MediaStream | null = null,
    profilePic: string | null = null
): void {
    if (document.getElementById(`voice-card-${userId}`)) return;

    const initial = username[0].toUpperCase();
    const elId = `voice-card-${userId}`;
    const audioContent = isLocal ? '' : `<audio id="audio-${userId}" autoplay></audio>`;

    const videoContent = `<video id="video-${userId}" autoplay playsinline ${isLocal ? 'muted' : ''} style="display:${(isLocal && (voiceState.isVideoOn || voiceState.isScreenOn)) ? 'block' : 'none'}; width: 100%; max-width: 250px; border-radius: 8px; margin-top: 8px; background: #000; aspect-ratio: 16/9; object-fit: cover; cursor: zoom-in;" onclick="this.classList.toggle('fullscreen-video')" title="Tam boy/Küçült (Tıkla)"></video>`;

    const contextAttr = isLocal ? '' : `oncontextmenu="window.openUserMenu(event, '${userId}')"`;

    let avatarContent: string;
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
            <div id="mic-status-${userId}" style="color:var(--accent-danger); font-size:16px; margin-top:-8px; display:none;">🔇</div>
        </div>
        ${videoContent}
        ${audioContent}
      </div>
    `;

    el.voiceParticipants?.insertAdjacentHTML('beforeend', cardHtml);

    if (isLocal && stream && (voiceState.isVideoOn || voiceState.isScreenOn)) {
        const vid = document.getElementById(`video-${userId}`) as HTMLVideoElement | null;
        if (vid) vid.srcObject = stream;
    }
}

/**
 * Ses ayarlarındaki giriş/çıkış cihazlarını listeler ve kaydeder.
 */
export async function loadAudioDevices(): Promise<void> {
    try {
        let devices = await navigator.mediaDevices.enumerateDevices();
        const needsPermission = devices.some(d => d.kind === 'audioinput' && d.label === '');

        if (needsPermission) {
            const tempStream = await navigator.mediaDevices.getUserMedia({ audio: true });
            tempStream.getTracks().forEach(t => t.stop());
            devices = await navigator.mediaDevices.enumerateDevices();
        }

        const micSelect = document.getElementById('settings-mic-select') as HTMLSelectElement | null;
        const speakerSelect = document.getElementById('settings-speaker-select') as HTMLSelectElement | null;

        if (micSelect) {
            micSelect.innerHTML = '';
            const audioInputs = devices.filter(d => d.kind === 'audioinput');
            if (audioInputs.length === 0) {
                micSelect.innerHTML = `<option value="">${window.i18n ? window.i18n.t('mic_not_found') : 'Mikrofon bulunamadı'}</option>`;
            } else {
                audioInputs.forEach((device, i) => {
                    const opt = document.createElement('option');
                    opt.value = device.deviceId;
                    opt.textContent = device.label || `Mikrofon ${i + 1}`;
                    micSelect.appendChild(opt);
                });
            }
            const savedMic = localStorage.getItem('haven_mic_device');
            if (savedMic) micSelect.value = savedMic;
        }

        if (speakerSelect) {
            speakerSelect.innerHTML = '';
            const audioOutputs = devices.filter(d => d.kind === 'audiooutput');
            if (audioOutputs.length === 0) {
                speakerSelect.innerHTML = `<option value="">${window.i18n ? window.i18n.t('speaker_not_found') : 'Hoparlör bulunamadı'}</option>`;
            } else {
                audioOutputs.forEach((device, i) => {
                    const opt = document.createElement('option');
                    opt.value = device.deviceId;
                    opt.textContent = device.label || `Hoparlör ${i + 1}`;
                    speakerSelect.appendChild(opt);
                });
            }
            const savedSpeaker = localStorage.getItem('haven_speaker_device');
            if (savedSpeaker) speakerSelect.value = savedSpeaker;
        }
    } catch (err) {
        console.error('Ses cihazları alınamadı:', err);
    }
}

/**
 * Mikrofon durum ikonunu günceller.
 */
export function updateMicStatusUI(userId: string, isMicOn: boolean): void {
    const micStatusEl = document.getElementById(`mic-status-${userId}`);
    if (micStatusEl) {
        micStatusEl.style.display = isMicOn ? 'none' : 'block';
    }
}
