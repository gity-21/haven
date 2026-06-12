import { state } from '../state';
import { el } from '../elements';
import { escapeHtml } from '../utils';

let popupActive = false;
let selectedIndex = 0;
let matchStart = -1;
let matchEnd = -1;

export function initMentions(): void {
    const input = el.messageInput as HTMLTextAreaElement | null;
    const popup = document.getElementById('mention-popup');
    
    if (!input || !popup) return;

    // Handle input to detect @username
    input.addEventListener('input', () => {
        const val = input.value;
        const cursorPos = input.selectionStart;
        
        // Ara: Cursor'dan geriye doğru ilk boşluğa veya başa kadar bak, @ var mı?
        const textBeforeCursor = val.substring(0, cursorPos);
        const match = textBeforeCursor.match(/(?:^|\s)@([a-zA-Z0-9_]*)$/);

        if (match) {
            const query = match[1].toLowerCase();
            matchStart = match.index! + (match[0].startsWith(' ') ? 1 : 0);
            matchEnd = cursorPos;
            
            // Kullanıcıları filtrele (kendimizi de etiketleyebiliriz ya da hariç tutabiliriz, şimdilik herkesi dahil edelim)
            const matchedUsers = state.users.filter(u => u.username.toLowerCase().includes(query));
            
            if (matchedUsers.length > 0) {
                showPopup(matchedUsers, popup, input);
            } else {
                hidePopup(popup);
            }
        } else {
            hidePopup(popup);
        }
    });

    // Handle keydown for navigation
    input.addEventListener('keydown', (e) => {
        if (!popupActive) return;

        const items = popup.querySelectorAll('.mention-item');
        if (items.length === 0) return;

        if (e.key === 'ArrowDown') {
            e.preventDefault();
            selectedIndex = (selectedIndex + 1) % items.length;
            updateSelection(items);
        } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            selectedIndex = (selectedIndex - 1 + items.length) % items.length;
            updateSelection(items);
        } else if (e.key === 'Enter' || e.key === 'Tab') {
            e.preventDefault();
            const selectedUsername = items[selectedIndex].getAttribute('data-username');
            if (selectedUsername) {
                insertMention(input, selectedUsername, popup);
            }
        } else if (e.key === 'Escape') {
            e.preventDefault();
            hidePopup(popup);
        }
    });

    // Close popup on outside click
    document.addEventListener('click', (e) => {
        if (popupActive && !popup.contains(e.target as Node) && e.target !== input) {
            hidePopup(popup);
        }
    });
}

function showPopup(users: any[], popup: HTMLElement, input: HTMLTextAreaElement) {
    popup.innerHTML = '';
    selectedIndex = 0;

    users.forEach((user, index) => {
        const initial = user.username[0].toUpperCase();
        let avatarHtml = '';
        if (user.profilePic) {
            avatarHtml = `<div style="width:24px; height:24px; border-radius:50%; background-image:url('${user.profilePic}'); background-size:cover; background-position:center; flex-shrink:0;"></div>`;
        } else {
            avatarHtml = `<div style="width:24px; height:24px; border-radius:50%; background-color:${user.avatarColor || '#6366f1'}; color:white; display:flex; align-items:center; justify-content:center; font-weight:bold; font-size:12px; flex-shrink:0;">${initial}</div>`;
        }

        const div = document.createElement('div');
        div.className = `mention-item ${index === 0 ? 'selected' : ''}`;
        div.setAttribute('data-username', user.username);
        div.innerHTML = `
            ${avatarHtml}
            <span style="font-size:13px; font-weight:600; color:${user.avatarColor || '#6366f1'};">${escapeHtml(user.username)}</span>
        `;
        
        div.addEventListener('click', () => {
            insertMention(input, user.username, popup);
            input.focus();
        });

        div.addEventListener('mouseenter', () => {
            selectedIndex = index;
            updateSelection(popup.querySelectorAll('.mention-item'));
        });

        popup.appendChild(div);
    });

    popup.style.display = 'flex';
    popupActive = true;
}

function hidePopup(popup: HTMLElement) {
    popup.style.display = 'none';
    popupActive = false;
    matchStart = -1;
    matchEnd = -1;
}

function updateSelection(items: NodeListOf<Element>) {
    items.forEach((item, index) => {
        if (index === selectedIndex) {
            item.classList.add('selected');
            (item as HTMLElement).scrollIntoView({ block: 'nearest' });
        } else {
            item.classList.remove('selected');
        }
    });
}

function insertMention(input: HTMLTextAreaElement, username: string, popup: HTMLElement) {
    const val = input.value;
    if (matchStart !== -1 && matchEnd !== -1) {
        const before = val.substring(0, matchStart);
        const after = val.substring(matchEnd);
        input.value = before + '@' + username + ' ' + after;
        
        // Set cursor position after the inserted mention
        const newPos = matchStart + username.length + 2; // +1 for @, +1 for space
        input.setSelectionRange(newPos, newPos);
    }
    
    hidePopup(popup);
    
    // Trigger input event to auto-resize textarea
    input.dispatchEvent(new Event('input', { bubbles: true }));
}
