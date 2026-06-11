/**
 * voice-player.ts — Sesli Mesaj Oynatıcı
 *
 * Waveform (dalga formu) çizimi, play/pause toggle ve seek fonksiyonları.
 */

// ── Modül durumu ──

const voiceAudioPlayers: Record<string, HTMLAudioElement> = {};

// ── SVG İkonları ──

const micIconHTML = '<path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z"></path><path d="M19 10v2a7 7 0 0 1-14 0v-2"></path><line x1="12" y1="19" x2="12" y2="22"></line>';
const pauseIconHTML = '<rect x="6" y="4" width="4" height="16"></rect><rect x="14" y="4" width="4" height="16"></rect>';

// ── Waveform çizimi ──

function drawStaticWaveform(audioId: string, progress: number): void {
    const canvas = document.getElementById(audioId + '-waveform') as HTMLCanvasElement | null;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const w = canvas.width;
    const h = canvas.height;
    const pct = progress || 0;

    ctx.clearRect(0, 0, w, h);

    const barWidth = 3;
    const barGap = 2;
    const bars = Math.floor(w / (barWidth + barGap));
    const progressBar = Math.floor(bars * pct);

    for (let i = 0; i < bars; i++) {
        const seed = Math.sin(i * 12.9898 + parseInt(audioId.replace(/\D/g, '') || '0')) * 43758.5453;
        const barHeight = (Math.abs(seed % 1) * 0.7 + 0.3) * h * 0.8;
        const x = i * (barWidth + barGap);
        const y = (h - barHeight) / 2;

        const theme = document.documentElement.getAttribute('data-theme') || 'space';
        const unfills = theme === 'antigravity' ? 'rgba(0,0,0,0.6)' : 'rgba(255, 255, 255, 0.2)';
        ctx.fillStyle = i < progressBar ? '#14b8a6' : unfills;
        ctx.fillRect(x, y, barWidth, barHeight);
    }
}

// ── Süre formatlama ──

function formatVoiceDuration(sec: number): string {
    if (!sec || !isFinite(sec)) return '0:00';
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60);
    return `${m}:${s.toString().padStart(2, '0')}`;
}

// ── Play/Pause Toggle ──

export function toggleVoiceMsg(audioId: string, src: string): void {
    let player = voiceAudioPlayers[audioId];

    if (!player) {
        player = new Audio(src);
        voiceAudioPlayers[audioId] = player;

        player.addEventListener('loadedmetadata', () => drawStaticWaveform(audioId, 0));
        player.addEventListener('canplay', () => drawStaticWaveform(audioId, 0), { once: true });

        player.addEventListener('timeupdate', () => {
            if (player.duration) {
                const pct = player.currentTime / player.duration;
                drawStaticWaveform(audioId, pct);
            }
        });

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
}

// ── Seek ──

export function seekVoiceMsg(event: MouseEvent, audioId: string): void {
    const player = voiceAudioPlayers[audioId];
    if (!player || !player.duration) return;
    const bar = event.currentTarget as HTMLElement;
    const rect = bar.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const pct = x / rect.width;
    player.currentTime = pct * player.duration;
    drawStaticWaveform(audioId, pct);
}

// Global referanslar
window.toggleVoiceMsg = toggleVoiceMsg;
window.seekVoiceMsg = seekVoiceMsg;
