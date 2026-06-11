/**
 * media-preview.ts — Medya Önizleme Overlay
 *
 * Görsel ve video dosyalarını tam ekran overlay ile önizler.
 * Zoom (scroll), sürükleme (drag) ve kapatma işlevleri içerir.
 */

/**
 * Medya önizleme overlay'ini açar.
 */
export function previewMedia(url: string, type: 'image' | 'video'): void {
    // Varsa eski div'i sil
    const oldOverlay = document.getElementById('media-preview-overlay');
    if (oldOverlay) oldOverlay.remove();

    const overlay = document.createElement('div');
    overlay.id = 'media-preview-overlay';
    overlay.style.cssText = 'position:fixed; top:0; left:0; width:100vw; height:100vh; background:rgba(0,0,0,0.85); backdrop-filter:blur(10px); z-index:999999; display:flex; align-items:center; justify-content:center; cursor:zoom-out; flex-direction:column; padding: 24px;-webkit-app-region: no-drag; overflow:hidden;';

    let scale = 1;
    let isDragging = false;
    let startX: number, startY: number, translateX = 0, translateY = 0;

    if (type === 'image') {
        const imgContainer = document.createElement('div');
        imgContainer.style.cssText = 'width:100%; height:100%; display:flex; align-items:center; justify-content:center; cursor:zoom-in; transition: transform 0.1s ease-out;';

        const mediaEl = document.createElement('img');
        mediaEl.src = url;
        mediaEl.style.cssText = 'max-width:90vw; max-height:90vh; object-fit:contain; border-radius:12px; box-shadow:0 12px 48px rgba(0,0,0,0.8); pointer-events:none; transition: transform 0.1s;';

        imgContainer.appendChild(mediaEl);
        overlay.appendChild(imgContainer);

        // Zoom
        overlay.addEventListener('wheel', (e: WheelEvent) => {
            e.preventDefault();
            const zoomAmount = 0.1;
            if (e.deltaY < 0) {
                scale += zoomAmount;
            } else {
                scale -= zoomAmount;
            }
            scale = Math.max(0.2, Math.min(scale, 5));
            imgContainer.style.transform = `translate(${translateX}px, ${translateY}px) scale(${scale})`;
            if (scale > 1) {
                imgContainer.style.cursor = 'grab';
                overlay.style.cursor = 'default';
            } else {
                imgContainer.style.cursor = 'zoom-in';
                overlay.style.cursor = 'zoom-out';
                translateX = 0;
                translateY = 0;
                imgContainer.style.transform = `translate(0px, 0px) scale(${scale})`;
            }
        });

        // Sürükleme (Pan)
        overlay.addEventListener('mousedown', (e: MouseEvent) => {
            if (scale > 1) {
                isDragging = true;
                startX = e.clientX - translateX;
                startY = e.clientY - translateY;
                imgContainer.style.cursor = 'grabbing';
            }
        });

        overlay.addEventListener('mousemove', (e: MouseEvent) => {
            if (!isDragging) return;
            e.preventDefault();
            translateX = e.clientX - startX;
            translateY = e.clientY - startY;
            imgContainer.style.transform = `translate(${translateX}px, ${translateY}px) scale(${scale})`;
        });

        overlay.addEventListener('mouseup', () => {
            isDragging = false;
            if (scale > 1) imgContainer.style.cursor = 'grab';
        });
        overlay.addEventListener('mouseleave', () => {
            isDragging = false;
        });

    } else if (type === 'video') {
        const mediaEl = document.createElement('video');
        mediaEl.src = url;
        mediaEl.controls = true;
        mediaEl.autoplay = true;
        mediaEl.style.cssText = 'max-width:90vw; max-height:90vh; border-radius:12px; box-shadow:0 12px 48px rgba(0,0,0,0.8);';
        mediaEl.onclick = (e: MouseEvent) => e.stopPropagation();
        overlay.appendChild(mediaEl);
    }

    // Kapatma butonu
    const closeBtn = document.createElement('div');
    closeBtn.innerHTML = '✕';
    closeBtn.className = 'media-preview-close';
    closeBtn.onclick = (e: MouseEvent) => {
        e.stopPropagation();
        overlay.remove();
    };

    // Tıklayınca kapansın (video dışında ve sürükleme değilse)
    let clickStartX: number, clickStartY: number;
    overlay.addEventListener('mousedown', (e: MouseEvent) => {
        clickStartX = e.clientX;
        clickStartY = e.clientY;
    });
    overlay.addEventListener('click', (e: MouseEvent) => {
        const deltaX = Math.abs(e.clientX - clickStartX);
        const deltaY = Math.abs(e.clientY - clickStartY);
        if (deltaX < 5 && deltaY < 5 && e.target !== closeBtn && type !== 'video') {
            overlay.remove();
        }
    });

    overlay.appendChild(closeBtn);

    // Zoom talimatı (Sadece görsel için)
    if (type === 'image') {
        const helpText = document.createElement('div');
        helpText.textContent = window.i18n ? window.i18n.t('zoom_help') : 'Büyütmek için fare tekerleğini kullanın • Sürükleyerek gezinin • Kapatmak için tıklayın';
        helpText.className = 'media-preview-help';
        overlay.appendChild(helpText);
    }

    document.body.appendChild(overlay);
}

// Global referans
window.previewMedia = previewMedia;
