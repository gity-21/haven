/**
 * poll.ts — Anket (Poll) Özelliği UI Kontrolcüsü
 *
 * Anket oluşturma modalı, seçenek ekleme/çıkarma,
 * verileri toplayıp şifreleyerek gönderme işlemleri.
 */

import { state } from '../state';
import { sendDataMessage } from '../messages';

export function initPollUI(): void {
    const btnCreatePoll = document.getElementById('btn-create-poll');
    const modalPoll = document.getElementById('modal-create-poll');
    const btnClosePoll = document.getElementById('btn-close-poll-modal');
    const btnAddOption = document.getElementById('btn-add-poll-option');
    const btnSubmitPoll = document.getElementById('btn-submit-poll');
    const optionsContainer = document.getElementById('poll-options-container');

    if (!btnCreatePoll || !modalPoll || !btnClosePoll || !btnAddOption || !btnSubmitPoll || !optionsContainer) {
        return;
    }

    let optionCount = 0;

    function addOption(value = '') {
        if (optionCount >= 10) {
            window.showToast?.('En fazla 10 seçenek ekleyebilirsiniz.', 'warning');
            return;
        }

        const optDiv = document.createElement('div');
        optDiv.style.cssText = 'display:flex; align-items:center; gap:8px;';

        const input = document.createElement('input');
        input.type = 'text';
        input.className = 'poll-option-input';
        input.placeholder = `Seçenek ${optionCount + 1}`;
        input.value = value;
        input.style.cssText = 'flex:1; padding:8px 12px; border-radius:8px; border:1px solid var(--border-medium); background:var(--bg-medium); color:white; font-size:14px; outline:none;';

        const btnRemove = document.createElement('button');
        btnRemove.innerHTML = '✕';
        btnRemove.style.cssText = 'background:rgba(239, 68, 68, 0.1); border:none; color:var(--accent-danger); border-radius:8px; width:36px; height:36px; cursor:pointer; display:flex; align-items:center; justify-content:center; flex-shrink:0;';
        btnRemove.onclick = () => {
            if (optionsContainer!.children.length <= 2) {
                window.showToast?.('En az 2 seçenek olmalıdır.', 'warning');
                return;
            }
            optDiv.remove();
            optionCount--;
        };

        optDiv.appendChild(input);
        optDiv.appendChild(btnRemove);
        optionsContainer!.appendChild(optDiv);
        optionCount++;
    }

    function resetModal() {
        (document.getElementById('poll-question') as HTMLInputElement).value = '';
        (document.getElementById('poll-multiple-choice') as HTMLInputElement).checked = false;
        optionsContainer!.innerHTML = '';
        optionCount = 0;
        addOption('');
        addOption('');
    }

    btnCreatePoll.addEventListener('click', () => {
        resetModal();
        modalPoll.style.display = 'flex';
    });

    btnClosePoll.addEventListener('click', () => {
        modalPoll.style.display = 'none';
    });

    modalPoll.addEventListener('click', (e) => {
        if (e.target === modalPoll) modalPoll.style.display = 'none';
    });

    btnAddOption.addEventListener('click', () => {
        addOption('');
    });

    btnSubmitPoll.addEventListener('click', async () => {
        const question = (document.getElementById('poll-question') as HTMLInputElement).value.trim();
        if (!question) {
            window.showToast?.('Lütfen bir soru girin.', 'warning');
            return;
        }

        const optionInputs = document.querySelectorAll('.poll-option-input') as NodeListOf<HTMLInputElement>;
        const options: string[] = [];
        
        optionInputs.forEach(input => {
            const val = input.value.trim();
            if (val) options.push(val);
        });

        if (options.length < 2) {
            window.showToast?.('En az 2 geçerli seçenek girmelisiniz.', 'warning');
            return;
        }

        const multiple = (document.getElementById('poll-multiple-choice') as HTMLInputElement).checked;

        const pollData = {
            question,
            options,
            multiple
        };

        const jsonStr = JSON.stringify(pollData);

        // Send the poll
        btnSubmitPoll.style.opacity = '0.5';
        btnSubmitPoll.style.pointerEvents = 'none';
        
        try {
            await sendDataMessage(jsonStr, 'poll', null);
            modalPoll.style.display = 'none';
        } catch (err) {
            window.showToast?.('Anket gönderilemedi.', 'error');
            console.error(err);
        } finally {
            btnSubmitPoll.style.opacity = '1';
            btnSubmitPoll.style.pointerEvents = 'auto';
        }
    });
}
