import { escapeHtml } from '../utils';
import type { ChatMessage } from '../messages';

// Pinned messages array to keep state
let pinnedMessages: ChatMessage[] = [];

export function initPinnedMessages(): void {
    const btnOpen = document.getElementById('btn-pinned-messages');
    const btnClose = document.getElementById('btn-close-pinned-panel');
    const panel = document.getElementById('pinned-messages-panel');

    if (btnOpen && panel) {
        btnOpen.addEventListener('click', () => {
            panel.style.display = 'flex';
            // Trigger reflow to apply transition
            void panel.offsetWidth;
            panel.style.transform = 'translateX(0)';
        });
    }

    if (btnClose && panel) {
        btnClose.addEventListener('click', () => {
            panel.style.transform = 'translateX(100%)';
            setTimeout(() => {
                panel.style.display = 'none';
            }, 300); // match transition duration
        });
    }
}

function renderPinnedMessages(): void {
    const listEl = document.getElementById('pinned-messages-list');
    if (!listEl) return;

    if (pinnedMessages.length === 0) {
        listEl.innerHTML = `
            <div id="pinned-empty-state" style="display:flex; flex-direction:column; align-items:center; justify-content:center; height:100%; color:var(--text-muted); opacity:0.6; padding:20px; text-align:center;">
                <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="margin-bottom:12px;"><line x1="12" y1="17" x2="12" y2="22"></line><path d="M5 17h14v-1.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V6h1a2 2 0 0 0 0-4H8a2 2 0 0 0 0 4h1v4.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24Z"></path></svg>
                <p style="font-size:14px; margin:0;" data-lang-key="pinned_empty">${window.i18n ? window.i18n.t('pinned_empty') : 'Henüz sabitlenmiş bir mesaj yok.'}</p>
            </div>
        `;
        return;
    }

    listEl.innerHTML = '';
    pinnedMessages.sort((a, b) => new Date(a.created_at || 0).getTime() - new Date(b.created_at || 0).getTime());

    pinnedMessages.forEach(msg => {
        const itemHtml = `
            <div class="pinned-message-item" onclick="document.querySelector('[data-message-id=\\'${msg.id}\\']')?.scrollIntoView({behavior: 'smooth'})" style="background:rgba(255,255,255,0.03); border:1px solid rgba(255,255,255,0.05); border-radius:8px; padding:12px; cursor:pointer; transition:0.2s;">
                <div style="display:flex; align-items:center; gap:8px; margin-bottom:6px;">
                    <div style="width:20px; height:20px; border-radius:50%; background-color:${msg.avatarColor || '#6366f1'}; ${msg.profile_pic ? `background-image:url('${msg.profile_pic}'); background-size:cover;` : ''} display:flex; align-items:center; justify-content:center; color:white; font-size:10px; font-weight:bold;">
                        ${!msg.profile_pic ? msg.username[0].toUpperCase() : ''}
                    </div>
                    <span style="font-size:12px; font-weight:600; color:${msg.avatarColor || '#6366f1'};">${escapeHtml(msg.username)}</span>
                    <span style="font-size:10px; color:var(--text-muted); margin-left:auto;">${msg.created_at ? new Date(msg.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : ''}</span>
                </div>
                <div style="font-size:13px; color:var(--text-primary); word-break:break-word; max-height:80px; overflow:hidden; display:-webkit-box; -webkit-line-clamp:4; -webkit-box-orient:vertical;">
                    ${msg.content}
                </div>
            </div>
        `;
        listEl.insertAdjacentHTML('beforeend', itemHtml);
    });
}

export function setPinnedMessages(messages: ChatMessage[]): void {
    pinnedMessages = messages.filter(m => m.is_pinned);
    renderPinnedMessages();
}

export function updatePinnedMessage(msg: ChatMessage, isPinned: boolean): void {
    const existingIndex = pinnedMessages.findIndex(m => m.id === msg.id);
    
    if (isPinned) {
        if (existingIndex === -1) {
            pinnedMessages.push(msg);
        } else {
            pinnedMessages[existingIndex] = msg;
        }
    } else {
        if (existingIndex !== -1) {
            pinnedMessages.splice(existingIndex, 1);
        }
    }
    
    renderPinnedMessages();
}

export function deletePinnedMessage(messageId: number | string): void {
    const existingIndex = pinnedMessages.findIndex(m => String(m.id) === String(messageId));
    if (existingIndex !== -1) {
        pinnedMessages.splice(existingIndex, 1);
        renderPinnedMessages();
    }
}

export function updatePinnedMessageContent(messageId: number | string, newHtmlContent: string): void {
    const existingIndex = pinnedMessages.findIndex(m => String(m.id) === String(messageId));
    if (existingIndex !== -1) {
        pinnedMessages[existingIndex].content = newHtmlContent;
        renderPinnedMessages();
    }
}
