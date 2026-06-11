/**
 * updater.js - Otomatik güncelleme arayüz yönetimi
 */

window.addEventListener('DOMContentLoaded', () => {
    if (window.electronAPI && window.electronAPI.onUpdateStatus) {
        window.electronAPI.onUpdateStatus((status) => {
            if (status.type === 'available') {
                console.log("[AutoUpdater] Yeni sürüm bulundu, indiriliyor...", status.info.version);
            } else if (status.type === 'progress') {
                console.log(`[AutoUpdater] İndirme yüzdesi: ${Math.round(status.progress.percent)}%`);
            } else if (status.type === 'downloaded') {
                console.log("[AutoUpdater] Güncelleme hazır.");
                
                const title = "Yeni Sürüm Hazır";
                const msg = `Haven'ın yeni bir sürümü (${status.info.version}) indirildi. Yeniden başlatarak kurmak ister misiniz?`;
                
                const confirmModal = document.getElementById('custom-confirm-modal');
                if (confirmModal) {
                    const titleEl = document.getElementById('custom-confirm-title');
                    const msgEl = document.getElementById('custom-confirm-message');
                    const btnOk = document.getElementById('btn-custom-confirm-ok');
                    const btnCancel = document.getElementById('btn-custom-confirm-cancel');
                    
                    if(titleEl) titleEl.innerText = title;
                    if(msgEl) msgEl.innerText = msg;
                    
                    // Önceki dinleyicileri temizlemek için clone yöntemi veya removeEventListener kullanılabilir
                    // Basitlik açısından override ediyoruz:
                    const newBtnOk = btnOk.cloneNode(true);
                    const newBtnCancel = btnCancel.cloneNode(true);
                    btnOk.parentNode.replaceChild(newBtnOk, btnOk);
                    btnCancel.parentNode.replaceChild(newBtnCancel, btnCancel);
                    
                    newBtnOk.addEventListener('click', () => {
                        window.electronAPI.installUpdate();
                        confirmModal.style.display = 'none';
                    });
                    
                    newBtnCancel.addEventListener('click', () => {
                        confirmModal.style.display = 'none';
                    });
                    
                    confirmModal.style.display = 'flex';
                } else {
                    // Fallback
                    if (confirm(title + "\n\n" + msg)) {
                        window.electronAPI.installUpdate();
                    }
                }
            } else if (status.type === 'error') {
                console.error("[AutoUpdater] Hata:", status.error);
            }
        });
    }
});
