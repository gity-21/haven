/**
 * modals.ts — Modal Yönetimi
 *
 * Onay modalı (showConfirmModal), uyarı modalı (showAlertModal)
 * ve ayarlar modalı mantığı.
 */

/**
 * Onay modalı gösterir (iki butonlu: Onayla / İptal).
 */
export function showConfirmModal(message: string, onConfirm: () => void, singleButton = false, isHtml = false): void {
    const modal = document.getElementById('custom-confirm-modal');
    const messageEl = document.getElementById('custom-confirm-message');
    const btnConfirm = document.getElementById('btn-custom-confirm-ok');
    const btnCancel = document.getElementById('btn-custom-confirm-cancel');

    if (!modal || !messageEl || !btnConfirm || !btnCancel) {
        if (confirm(message)) onConfirm();
        return;
    }

    if (isHtml) {
        messageEl.innerHTML = message;
    } else {
        messageEl.textContent = message;
    }
    modal.style.display = 'flex';

    if (singleButton) {
        btnCancel.style.display = 'none';
    } else {
        btnCancel.style.display = '';
    }

    const cleanup = (): void => {
        modal.style.display = 'none';
        btnConfirm.removeEventListener('click', handleConfirm);
        btnCancel.removeEventListener('click', handleCancel);
    };

    const handleConfirm = (): void => {
        cleanup();
        onConfirm();
    };

    const handleCancel = (): void => {
        cleanup();
    };

    btnConfirm.addEventListener('click', handleConfirm);
    btnCancel.addEventListener('click', handleCancel);
}

/**
 * Uyarı modalı gösterir (tek butonlu: Tamam).
 */
export function showAlertModal(message: string, title = 'Uyarı'): Promise<void> {
    return new Promise(resolve => {
        const modal = document.getElementById('custom-alert-modal');
        const titleEl = document.getElementById('custom-alert-title');
        const messageEl = document.getElementById('custom-alert-message');
        const btnOk = document.getElementById('btn-custom-alert-ok');

        if (!modal) {
            alert(message);
            resolve();
            return;
        }

        if (titleEl) titleEl.textContent = title;
        if (messageEl) messageEl.textContent = message;
        modal.style.display = 'flex';

        const cleanup = (): void => {
            modal.style.display = 'none';
            btnOk?.removeEventListener('click', handleOk);
        };

        const handleOk = (): void => {
            cleanup();
            resolve();
        };

        btnOk?.addEventListener('click', handleOk);
    });
}

// Global referanslar (chat.js window fonksiyonları)
window.showConfirmModal = showConfirmModal;
window.showAlertModal = showAlertModal;
