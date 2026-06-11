/**
 * toast.ts — Toast Bildirimi Sistemi
 *
 * Ekranın sağ üst köşesinde geçici bildirimler gösterir.
 */

import { el } from '../elements';

export type ToastType = 'info' | 'success' | 'error' | 'warning';

/**
 * Toast bildirimi gösterir.
 * @param message Gösterilecek mesaj
 * @param type Bildirim türü (info, success, error, warning)
 * @param duration Görünme süresi (ms), varsayılan 3000
 */
export function showToast(message: string, type: ToastType = 'info', duration = 3000): void {
    if (!el.toastContainer) return;

    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.textContent = message;
    toast.style.cssText = `
        padding: 12px 20px;
        background: ${type === 'error' ? 'rgba(239, 68, 68, 0.95)' : type === 'success' ? 'rgba(16, 185, 129, 0.95)' : type === 'warning' ? 'rgba(245, 158, 11, 0.95)' : 'rgba(99, 102, 241, 0.95)'};
        color: white;
        border-radius: 8px;
        font-size: 13px;
        box-shadow: 0 4px 12px rgba(0,0,0,0.3);
        animation: slideIn 0.3s ease;
        max-width: 400px;
        word-break: break-word;
    `;

    el.toastContainer.appendChild(toast);

    setTimeout(() => {
        toast.style.animation = 'slideOut 0.3s ease';
        setTimeout(() => toast.remove(), 300);
    }, duration);
}
