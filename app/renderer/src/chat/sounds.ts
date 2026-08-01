/**
 * Web Audio API kullanılarak bildirim sesleri (beep) üreten modül.
 * MP3 veya WAV dosyalarına ihtiyaç duymadan temiz ve modern uyarı sesleri (synthesizer) çalar.
 */

const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();

function playTone(frequency: number, type: OscillatorType, duration: number, volume: number) {
    if (audioCtx.state === 'suspended') {
        audioCtx.resume().catch(() => {});
    }
    const osc = audioCtx.createOscillator();
    const gainNode = audioCtx.createGain();
    
    osc.type = type;
    osc.frequency.setValueAtTime(frequency, audioCtx.currentTime);
    
    // Ses patlamasını (pop) önlemek için yumuşak bir zarf (envelope) uygula
    gainNode.gain.setValueAtTime(0, audioCtx.currentTime);
    gainNode.gain.linearRampToValueAtTime(volume, audioCtx.currentTime + 0.05);
    gainNode.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + duration);
    
    osc.connect(gainNode);
    gainNode.connect(audioCtx.destination);
    
    osc.start();
    osc.stop(audioCtx.currentTime + duration);
}

// Odaya Biri Girdiğinde (Yumuşak ve Tiz Bir Blip)
export function playRoomJoinSound() {
    playTone(600, 'sine', 0.2, 0.05);
    setTimeout(() => playTone(800, 'sine', 0.3, 0.05), 100);
}

// Odadan Biri Çıktığında (Daha Pes Bir Blip)
export function playRoomLeaveSound() {
    playTone(600, 'sine', 0.2, 0.05);
    setTimeout(() => playTone(400, 'sine', 0.3, 0.05), 100);
}

// Sese Biri Girdiğinde (Discord benzeri, yükselen 3 nota)
export function playVoiceJoinSound() {
    playTone(440, 'triangle', 0.15, 0.03); // A4
    setTimeout(() => playTone(554, 'triangle', 0.15, 0.03), 100); // C#5
    setTimeout(() => playTone(659, 'triangle', 0.3, 0.03), 200); // E5
}

// Sesten Biri Çıktığında (Discord benzeri, alçalan 3 nota)
export function playVoiceLeaveSound() {
    playTone(659, 'triangle', 0.15, 0.03); // E5
    setTimeout(() => playTone(554, 'triangle', 0.15, 0.03), 100); // C#5
    setTimeout(() => playTone(440, 'triangle', 0.3, 0.03), 200); // A4
}
