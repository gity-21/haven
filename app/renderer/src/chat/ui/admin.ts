/**
 * admin.ts — Admin Panel Mantığı
 *
 * Admin durumu kontrolü, oda listeleme ve oda silme işlevleri.
 */

import { state } from '../state';

/**
 * Admin durumunu kontrol eder ve admin tab'ını görünür yapar.
 */
export async function checkAdminStatus(): Promise<void> {
    const adminTabBtn = document.getElementById('admin-tab-btn');
    const adminTabSep = document.getElementById('admin-tab-separator');
    const adminTabLbl = document.getElementById('admin-tab-label');

    const isLocalhostHost = state.serverUrl.includes('localhost') || state.serverUrl.includes('127.0.0.1');

    if (isLocalhostHost) {
        // Electron'daysa admin token'ı her zaman tazele
        if (window.electronAPI?.getAdminToken) {
            try {
                const token = await window.electronAPI.getAdminToken();
                if (token && token !== state.adminToken) {
                    state.adminToken = token;
                    localStorage.setItem('haven_admin_token', token);
                    console.log('[ADMIN] Admin token otomatik olarak alındı/güncellendi.');
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

/**
 * Admin panelindeki oda listesini yükler.
 */
export async function loadAdminRooms(): Promise<void> {
    const listContainer = document.getElementById('admin-rooms-list');
    if (!listContainer) return;

    listContainer.innerHTML = `<div style="color:var(--text-muted); font-size:12px; text-align:center; padding:20px;">${window.i18n ? window.i18n.t('rooms_loading') : 'Odalar yükleniyor...'}</div>`;

    try {
        const adminHeaders: Record<string, string> = state.adminToken
            ? { 'Authorization': `Bearer ${state.adminToken}` }
            : {};
        const res = await fetch(`${state.serverUrl}/api/admin/rooms`, { headers: adminHeaders, cache: 'no-store' });
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
        data.rooms.forEach((room: { room_key: string; created_at: string; message_count: number; online_count: number }) => {
            const item = document.createElement('div');
            item.style.cssText = 'display:flex; align-items:center; justify-content:space-between; background:rgba(255,255,255,0.03); border:1px solid rgba(255,255,255,0.05); padding:12px 16px; border-radius:8px;';

            const dateStr = new Date(room.created_at + 'Z').toLocaleString([], { dateStyle: 'short', timeStyle: 'short' });

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
            btn.addEventListener('click', async (e: Event) => {
                const target = e.currentTarget as HTMLElement;
                const roomKey = target.dataset.key!;
                if (confirm(window.i18n ? window.i18n.t('admin_confirm_del').replace('{key}', roomKey) : `'${roomKey}' odasını ve tüm mesajlarını silmek istediğine emin misin?`)) {
                    await fetch(`${state.serverUrl}/api/admin/rooms/${roomKey}`, {
                        method: 'DELETE',
                        headers: state.adminToken ? { 'Authorization': `Bearer ${state.adminToken}` } : {}
                    });
                    loadAdminRooms();
                }
            });
        });

    } catch (_err) {
        listContainer.innerHTML = `<div style="color:var(--text-muted); font-size:12px; text-align:center; padding:20px;">${window.i18n ? window.i18n.t('admin_server_error') : 'Sunucuya bağlanılamadı.'}</div>`;
    }
}

/**
 * Admin DOM event'lerini kurar (tüm odaları sil butonu vb.)
 */
export function setupAdminEvents(): void {
    const btnDeleteAll = document.getElementById('btn-admin-delete-all');
    if (btnDeleteAll) {
        btnDeleteAll.addEventListener('click', async () => {
            if (confirm(window.i18n ? window.i18n.t('admin_confirm_del_all') : "DİKKAT! Sunucudaki TÜM odalar ve mesajlar silinecek. Emin misiniz?")) {
                try {
                    await fetch(`${state.serverUrl}/api/admin/rooms`, {
                        method: 'DELETE',
                        headers: state.adminToken ? { 'Authorization': `Bearer ${state.adminToken}` } : {}
                    });
                    loadAdminRooms();
                } catch (_e) {
                    alert(window.i18n ? window.i18n.t('admin_error') : "Bir hata oluştu.");
                }
            }
        });
    }

    // Admin durumunu kontrol et
    setTimeout(checkAdminStatus, 500);
}
