/**
 * users.ts — Online Kullanıcı Listesi Render
 *
 * Kullanıcı listesi modalını render eder ve pencere kontrollerini kurar.
 */

import { state } from '../state';
import { el } from '../elements';
import { escapeHtml } from '../utils';
import type { OnlineUser } from '../../types/socket-events';

/**
 * Online kullanıcı listesi modalını render eder.
 */
export function renderUsersModal(): void {
    if (!el.usersModalList) return;

    if (state.users.length === 0) {
        el.usersModalList.innerHTML = `<div style="text-align:center; color:var(--text-muted); padding:20px; font-size:13px;">${window.i18n ? window.i18n.t('no_users') : 'Henüz kimse yok.'}</div>`;
        return;
    }

    el.usersModalList.innerHTML = state.users.map((user: OnlineUser) => {
        const isMe = state.socket && user.id === state.socket.id;
        const initial = user.username[0].toUpperCase();

        let avatarHtml: string;
        if (user.profilePic) {
            avatarHtml = `<div style="width:32px; height:32px; border-radius:50%; background-image:url('${user.profilePic}'); background-size:cover; background-position:center; flex-shrink:0;"></div>`;
        } else {
            avatarHtml = `<div style="width:32px; height:32px; border-radius:50%; background-color:${user.avatarColor}; color:white; display:flex; align-items:center; justify-content:center; font-weight:bold; font-size:14px; flex-shrink:0;">${initial}</div>`;
        }

        return `
            <div style="display:flex; align-items:center; gap:10px; padding:8px 12px; border-radius:8px; background:rgba(255,255,255,0.03);">
                ${avatarHtml}
                <span style="font-size:13px; color:${user.avatarColor}; font-weight:600;">${escapeHtml(user.username)} ${isMe ? `<span style="color:var(--text-muted); font-weight:400;">(${window.i18n ? window.i18n.t('you') : 'Sen'})</span>` : ''}</span>
            </div>
        `;
    }).join('');
}

/**
 * Electron pencere kontrol butonlarını (minimize, maximize, close) kurar.
 */
export function setupWindowControls(): void {
    if (window.electronAPI) {
        document.getElementById('btn-minimize')?.addEventListener('click', () => window.electronAPI!.minimizeWindow());
        document.getElementById('btn-maximize')?.addEventListener('click', () => window.electronAPI!.maximizeWindow());
        document.getElementById('btn-close')?.addEventListener('click', () => window.electronAPI!.closeWindow());
    } else {
        const titlebar = document.querySelector('.titlebar') as HTMLElement | null;
        if (titlebar) {
            titlebar.style.display = 'none';
        }
    }
}
