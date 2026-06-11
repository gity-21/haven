/**
 * utils.ts — Yardımcı Fonksiyonlar
 *
 * HTML kaçışlama, XSS sanitizasyonu, linkify, tarih formatlama,
 * YouTube embed çıkarma ve diğer yardımcı işlevler.
 */

// ── XSS Koruması ──

/**
 * FIX #6: İstemci tarafı XSS koruması.
 * Şifre çözme sonrası metin içeriğine uygulanır.
 * İzin verilen HTML etiketleri dışında her şeyi encode eder.
 */
export function clientSanitize(text: string): string {
    if (!text || typeof text !== 'string') return text;
    const ALLOWED = ['b', 'i', 'em', 'strong', 'br'];
    return text.replace(/<\/?([a-zA-Z][a-zA-Z0-9]*)(?:\s[^>]*)?>|<([a-zA-Z][a-zA-Z0-9]*)(?:\s[^>]*)?>/g, (match, tag1, tag2) => {
        const tag = (tag1 || tag2 || '').toLowerCase();
        if (ALLOWED.includes(tag)) return match;
        return match.replace(/</g, '&lt;').replace(/>/g, '&gt;');
    });
}

// ── HTML Escape ──

/**
 * HTML özel karakterlerini güvenli karşılıklarıyla değiştirir.
 */
export function escapeHtml(text: string): string {
    if (!text) return '';
    return text
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

// ── Linkify ──

/**
 * Düz metin URL'lerini tıklanabilir <a> etiketlerine çevirir.
 * Electron'da electronAPI.openExternal ile, web'de yeni sekmede açılır.
 */
export function linkify(text: string): string {
    // URL regex'i
    const urlPattern = /(\bhttps?:\/\/[^\s<>"']+)/gi;
    return text.replace(urlPattern, (url: string) => {
        // Electron'da güvenli açma
        const safeUrl = escapeHtml(url);
        if (window.electronAPI?.openExternal) {
            return `<a href="#" class="chat-link" onclick="event.preventDefault(); window.electronAPI.openExternal('${safeUrl}')" title="${safeUrl}">${safeUrl}</a>`;
        }
        return `<a href="${safeUrl}" target="_blank" rel="noopener noreferrer" class="chat-link" title="${safeUrl}">${safeUrl}</a>`;
    });
}

// ── Tarih Formatlama ──

/**
 * Discord tarzı tarih formatlama (ör: "Bugün 14:32", "Dün 09:15", "03.06.2026 18:00")
 */
export function formatDiscordDate(dateStr: string): string {
    const date = new Date(dateStr);
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const yesterday = new Date(today.getTime() - 86400000);
    const msgDay = new Date(date.getFullYear(), date.getMonth(), date.getDate());

    const time = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

    if (msgDay.getTime() === today.getTime()) {
        return `${window.i18n ? window.i18n.t('today') : 'Bugün'} ${time}`;
    }
    if (msgDay.getTime() === yesterday.getTime()) {
        return `${window.i18n ? window.i18n.t('yesterday') : 'Dün'} ${time}`;
    }
    return date.toLocaleDateString([], { day: '2-digit', month: '2-digit', year: 'numeric' }) + ' ' + time;
}

/**
 * Tarih ayırıcı metni üretir (ör: "3 Haziran 2026")
 */
export function formatDateSeparator(dateStr: string): string {
    const date = new Date(dateStr);
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const yesterday = new Date(today.getTime() - 86400000);
    const msgDay = new Date(date.getFullYear(), date.getMonth(), date.getDate());

    if (msgDay.getTime() === today.getTime()) {
        return window.i18n ? window.i18n.t('today') : 'Bugün';
    }
    if (msgDay.getTime() === yesterday.getTime()) {
        return window.i18n ? window.i18n.t('yesterday') : 'Dün';
    }
    return date.toLocaleDateString([], { day: 'numeric', month: 'long', year: 'numeric' });
}

// ── YouTube ──

/**
 * YouTube video ID'sini URL'den çıkarır.
 */
export function extractYouTubeId(url: string): string | null {
    const regExp = /(?:youtube\.com\/(?:watch\?v=|embed\/|shorts\/)|youtu\.be\/)([a-zA-Z0-9_-]{11})/;
    const match = url.match(regExp);
    return match ? match[1] : null;
}

// ── Dosya boyutu formatlama ──

/**
 * Byte sayısını okunabilir formata çevirir (KB, MB, GB).
 */
export function formatFileSize(bytes: number): string {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    if (bytes < 1024 * 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
    return (bytes / (1024 * 1024 * 1024)).toFixed(2) + ' GB';
}
