
function setupEventListeners() {
    // Mesaj Gönderme
    el.btnSend.addEventListener('click', sendMessage);
    el.messageInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            sendMessage();
            // Mesaj gönderilince typing durumu kapat
            if (state.socket) state.socket.emit('typing', { isTyping: false });
            clearTimeout(state._typingTimeout);
            state._isTyping = false;
        }
    });

    // Yazıyor göstergesi gönder - her 1.5 saniyede tekrar sinyal gönder
    el.messageInput.addEventListener('input', () => {
        if (!state.socket) return;
        const now = Date.now();
        // Her 1.5 saniyede bir typing:true gönder (sürekli yazdığı sürece)
        if (!state._lastTypingEmit || now - state._lastTypingEmit > 1500) {
            state._lastTypingEmit = now;
            state.socket.emit('typing', { isTyping: true });
        }
        // 1 saniye yazmazsa typing:false gönder
        clearTimeout(state._typingTimeout);
        state._typingTimeout = setTimeout(() => {
            state._lastTypingEmit = 0;
            state.socket.emit('typing', { isTyping: false });
        }, 1000);
    });

    // Dosya Ekleme
    el.btnAttachFile?.addEventListener('click', () => {
        el.fileInput?.click();
    });

    el.fileInput?.addEventListener('change', async (e) => {
        const file = e.target.files[0];
        if (file) {
            // Eğer görsel ise WhatsApp tarzı önizlemeye yolla
            if (file.type.startsWith('image/')) {
                window.addPendingImage(file);
            } else {
                // Diğer dosyalar için direkt P2P baslat
                await window.sendP2PFile(file);
            }
            e.target.value = '';
        }
    });

    window.sendP2PFile = async (file) => {
        if (!file) return;

        window.pendingP2PFiles = window.pendingP2PFiles || {};
        const fileId = 'file_' + Date.now() + '_' + Math.floor(Math.random() * 10000);
        window.pendingP2PFiles[fileId] = file;

        const fileMsgContent = JSON.stringify({
            fileId,
            filename: file.name || (file.type.startsWith('image/') ? `image_${Date.now()}.${file.type.split('/')[1]}` : 'clipboard_file'),
            mimetype: file.type || 'application/octet-stream',
            size: file.size,
            senderId: state.socket.id
        });

        // Nesne datasını E2EE ile şifrele
        const encryptedContent = await encryptMessage(fileMsgContent);

        state.socket.emit('send-message', {
            content: encryptedContent,
            type: 'p2p-announce',
            replyTo: state.replyingTo ? state.replyingTo.id : null
        });
        window.cancelReply();
    };


    // Yapıştırma (Ctrl+V) Desteği - Görsel ve URL için
    el.messageInput.addEventListener('paste', async (e) => {
        const clipboardData = (e.clipboardData || window.clipboardData);
        if (!clipboardData) return;

        let handled = false;

        // 1. Dosya/Blob kontrolü (Ekran görüntüsü, kopyalanmış dosya vb.)
        const items = clipboardData.items;
        for (let i = 0; i < items.length; i++) {
            const item = items[i];
            if (item.kind === 'file' && item.type.startsWith('image/')) {
                const blob = item.getAsFile();
                if (blob) {
                    e.preventDefault();
                    handled = true;
                    window.addPendingImage(blob);
                }
            }
        }

        // 2. URL kontrolü (Web'den direkt link kopyalanmışsa)
        if (!handled) {
            const text = clipboardData.getData('text');
            if (text && (text.match(/\.(jpeg|jpg|gif|png|webp|svg)$/i) || text.startsWith('data:image/'))) {
                try {
                    const res = await fetch(text);
                    const blob = await res.blob();
                    if (blob && blob.type.startsWith('image/')) {
                        e.preventDefault();
                        handled = true;
                        window.addPendingImage(blob);
                    }
                } catch (err) {
                    console.log('Paste URL image fetch bypass.');
                }
            }
        }
    });

    // --- WHATSAPP TARZI GÖRSEL ÖNİZLEME MANTIĞI ---
    window.addPendingImage = (blob) => {
        state.pendingImages.push(blob);
        state.currentPreviewIndex = state.pendingImages.length - 1;
        state.viewOnceEnabled = false; // Reset view-once on new images
        openImagePreviewModal();
    };

    window.removePendingImage = (index) => {
        state.pendingImages.splice(index, 1);
        if (state.pendingImages.length === 0) {
            closeImagePreviewModal();
            return;
        }
        if (state.currentPreviewIndex >= state.pendingImages.length) {
            state.currentPreviewIndex = state.pendingImages.length - 1;
        }
        renderImageSendPreview();
    };

    function openImagePreviewModal() {
        const modal = document.getElementById('modal-image-send-preview');
        if (modal) {
            modal.style.display = 'flex';
            renderImageSendPreview();
        }
    }

    function closeImagePreviewModal() {
        const modal = document.getElementById('modal-image-send-preview');
        if (modal) {
            modal.style.display = 'none';
            state.pendingImages = [];
            const captionInput = document.getElementById('preview-caption-input');
            if (captionInput) captionInput.value = '';
        }
    }

    function renderImageSendPreview() {
        const fullImg = document.getElementById('preview-full-image');
        const thumbContainer = document.getElementById('preview-thumbnails');
        const viewOnceBtn = document.getElementById('btn-toggle-view-once');

        if (!fullImg || !thumbContainer) return;

        // Ana Görsel
        const currentBlob = state.pendingImages[state.currentPreviewIndex];
        const url = URL.createObjectURL(currentBlob);
        fullImg.src = url;
        fullImg.onload = () => URL.revokeObjectURL(url);

        // View Once Durumu (UI)
        if (viewOnceBtn) {
            viewOnceBtn.classList.toggle('active', state.viewOnceEnabled);
        }

        // Thumbnails
        const addMoreBtn = document.getElementById('btn-preview-add-more');
        thumbContainer.innerHTML = '';
        state.pendingImages.forEach((blob, idx) => {
            const tUrl = URL.createObjectURL(blob);
            const thumb = document.createElement('div');
            thumb.className = `thumb-item ${idx === state.currentPreviewIndex ? 'active' : ''}`;
            thumb.innerHTML = `<img src="${tUrl}" onload="URL.revokeObjectURL('${tUrl}')">`;
            thumb.onclick = () => {
                state.currentPreviewIndex = idx;
                renderImageSendPreview();
            };
            thumbContainer.appendChild(thumb);
        });
        thumbContainer.appendChild(addMoreBtn); // + butonu sona gelsin

        const captionInput = document.getElementById('preview-caption-input');
        if (captionInput) captionInput.focus();
    }

    // Modal Event Listeners
    document.getElementById('btn-close-image-preview')?.addEventListener('click', closeImagePreviewModal);
    document.getElementById('btn-toggle-view-once')?.addEventListener('click', () => {
        state.viewOnceEnabled = !state.viewOnceEnabled;
        document.getElementById('btn-toggle-view-once')?.classList.toggle('active', state.viewOnceEnabled);
    });

    document.getElementById('btn-preview-add-more')?.addEventListener('click', () => {
        el.fileInput?.click();
    });

    document.getElementById('btn-send-from-preview')?.addEventListener('click', () => {
        sendMessageFromPreview();
    });

    // Preview modalında Enter basınca gönder
    document.getElementById('preview-caption-input')?.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            sendMessageFromPreview();
        }
    });

    async function sendMessageFromPreview() {
        const captionInput = document.getElementById('preview-caption-input');
        const caption = captionInput?.value.trim();
        const hasImages = state.pendingImages.length > 0;

        if (hasImages) {
            // Görselleri artık P2P yerine SUNUCUYA yüklüyoruz (Sayfa yenileyince kaybolmaması için)
            for (const blob of state.pendingImages) {
                try {
                    // Dosya adı yoksa blob türüne göre oluştur (FIX: PNG blob'u .jpg uzantısıyla gönderilmemeli)
                    let filename;
                    if (blob.name && blob.name !== 'image.png') {
                        filename = blob.name;
                    } else {
                        const extMap = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/webp': 'webp' };
                        const ext = extMap[blob.type] || 'png';
                        filename = `image_${Date.now()}.${ext}`;
                    }
                    const file = new File([blob], filename, { type: blob.type });

                    await window.uploadFileToChat(file);
                } catch (err) {
                    console.error("Görsel yükleme hatası:", err);
                    showToast(window.i18n ? window.i18n.t('image_send_fail') : "Görsel gönderilemedi!", "error");
                }
            }
        }

        if (caption) {
            const encryptedContent = await encryptMessage(caption);
            state.socket.emit('send-message', {
                content: encryptedContent,
                type: 'message',
                replyTo: state.replyingTo ? state.replyingTo.id : null
            });
        }

        closeImagePreviewModal();
    }

    // --- SUNUCUYA DOSYA YÜKLEME MANTIĞI ---
    window.uploadFileToChat = async (file) => {
        if (!file) return;

        const formData = new FormData();
        formData.append('file', file);

        // İlerleme çubuğunu göster
        const progressContainer = document.getElementById('upload-progress-container');
        const progressBar = document.getElementById('upload-progress-bar');
        const filenameLabel = document.getElementById('upload-filename');
        const percentageLabel = document.getElementById('upload-percentage');

        if (progressContainer) {
            progressContainer.style.display = 'block';
            filenameLabel.textContent = file.name;
            progressBar.style.width = '0%';
            percentageLabel.textContent = '0%';
        }

        return new Promise((resolve, reject) => {
            const xhr = new XMLHttpRequest();
            const uploadUrl = state.serverUrl.endsWith('/') ? `${state.serverUrl}api/upload` : `${state.serverUrl}/api/upload`;

            xhr.open('POST', uploadUrl, true);
            if (state.uploadToken) {
                xhr.setRequestHeader('x-upload-token', state.uploadToken);
            }

            xhr.upload.onprogress = (e) => {
                if (e.lengthComputable) {
                    const percent = Math.round((e.loaded / e.total) * 100);
                    if (progressBar) progressBar.style.width = percent + '%';
                    if (percentageLabel) percentageLabel.textContent = percent + '%';
                }
            };

            xhr.onload = async () => {
                if (progressContainer) progressContainer.style.display = 'none';

                if (xhr.status === 200) {
                    const res = JSON.parse(xhr.responseText);
                    if (res.success) {
                        // Dosya bilgilerini E2EE ile şifrele (İçerik sunucuda açık ama mesaj şifreli)
                        const fileData = JSON.stringify({
                            url: res.url,
                            filename: res.filename,
                            mimetype: res.mimetype,
                            size: file.size
                        });

                        const encryptedContent = await encryptMessage(fileData);

                        state.socket.emit('send-message', {
                            content: encryptedContent,
                            type: 'file',
                            replyTo: state.replyingTo ? state.replyingTo.id : null
                        });
                        resolve(res);
                    } else {
                        showToast(res.message || (window.i18n ? window.i18n.t('upload_fail') : 'Yükleme başarısız!'), 'error');
                        reject(new Error(res.message));
                    }
                } else {
                    // Sunucu hata mesajını göstermeye çalış
                    let errMsg = window.i18n ? window.i18n.t('server_error') : 'Sunucu hatası!';
                    try {
                        const errRes = JSON.parse(xhr.responseText);
                        if (errRes.message) errMsg = errRes.message;
                    } catch (_) {}
                    showToast(errMsg, 'error');
                    reject(new Error(errMsg));
                }
            };

            xhr.onerror = () => {
                if (progressContainer) progressContainer.style.display = 'none';
                showToast(window.i18n ? window.i18n.t('conn_failed') : 'Bağlantı hatası!', 'error');
                reject(new Error('Network error'));
            };

            xhr.send(formData);
        });
    };

    // Özel Onay Modalı Gösterme Fonksiyonu
    window.showConfirmModal = function (message, onConfirm) {
        const modal = document.getElementById('custom-confirm-modal');
        const msgEl = document.getElementById('custom-confirm-message');
        const btnCancel = document.getElementById('btn-custom-confirm-cancel');
        const btnOk = document.getElementById('btn-custom-confirm-ok');

        if (!modal || !btnCancel || !btnOk) {
            if (confirm(message)) onConfirm();
            return;
        }

        msgEl.innerHTML = message;
        modal.style.display = 'flex';
        setTimeout(() => modal.style.opacity = '1', 10);

        const closeHandler = () => {
            modal.style.opacity = '0';
            setTimeout(() => modal.style.display = 'none', 200);
            btnCancel.removeEventListener('click', closeHandler);
            btnOk.removeEventListener('click', okHandler);
        };

        const okHandler = () => {
            closeHandler();
            onConfirm();
        };

        btnCancel.addEventListener('click', closeHandler);
        btnOk.addEventListener('click', okHandler);
    };

    // Oturum Kapatma (Login ekranına dön)
    el.btnLogout.addEventListener('click', () => {
        window.showConfirmModal(window.i18n ? window.i18n.t('msg_leave_room') : 'Gizli odadan çıkmak istediğinize emin misiniz?', () => {
            localStorage.removeItem('haven_nickname');
            localStorage.removeItem('haven_room');
            localStorage.removeItem('haven_auth_key');
            // FIX #4: haven_room_password artık localStorage'da yok; sessionStorage da temizleniyor.
            sessionStorage.removeItem('haven_session_password');
            if (window.electronAPI && window.electronAPI.navigateToLogin) {
                window.electronAPI.navigateToLogin();
            } else {
                window.location.href = 'login.html';
            }
        });
    });

    const mobileBtnLogout = document.getElementById('mobile-btn-logout');
    if (mobileBtnLogout) {
        mobileBtnLogout.addEventListener('click', () => {
            document.getElementById('mobile-dropdown-menu').style.display = 'none';
            el.btnLogout.click();
        });
    }

    // Kişiler Modalı Açma
    el.headerUserCount.addEventListener('click', () => {
        el.modalUsers.classList.add('visible');
    });

    // Kişiler Modalı Kapatma
    el.btnCloseUsersModal.addEventListener('click', () => {
        el.modalUsers.classList.remove('visible');
    });

    // Chat Ayarları Modalı
    if (el.btnChatSettings && el.chatSettingsModal) {
        // Renk paleti oluşturma
        const colors = ['#6366f1', '#ef4444', '#10b981', '#f59e0b', '#0ea5e9', '#ec4899', '#8b5cf6', '#14b8a6', '#000000'];
        colors.forEach(color => {
            const btn = document.createElement('div');
            btn.dataset.color = color;
            btn.style.width = '24px';
            btn.style.height = '24px';
            btn.style.borderRadius = '50%';
            btn.style.backgroundColor = color;
            btn.style.cursor = 'pointer';
            btn.style.border = color === state.avatarColor ? '2px solid white' : '2px solid transparent';
            btn.style.boxShadow = color === state.avatarColor ? `0 0 10px ${color}80` : 'none';
            btn.style.transition = '0.2s';

            btn.onclick = () => {
                Array.from(el.chatColorPickerContainer.children).forEach(c => {
                    c.style.border = '2px solid transparent';
                    c.style.boxShadow = 'none';
                });
                btn.style.border = '2px solid white';
                btn.style.boxShadow = `0 0 10px ${color}80`;
                el.chatAvatarColorInput.value = color;
                if (el.chatColorPreviewText) {
                    el.chatColorPreviewText.style.color = color;
                }
            };
            el.chatColorPickerContainer.appendChild(btn);
        });

        // ===== SEKME GEÇİŞ MANTIĞI =====
        let micTestStream = null;
        let micTestAnimFrame = null;

        const settingsTabs = document.querySelectorAll('.settings-tab');
        const settingsPanels = document.querySelectorAll('.settings-panel');

        settingsTabs.forEach(tab => {
            tab.addEventListener('click', () => {
                // Aktif sekmeyi güncelle
                settingsTabs.forEach(t => {
                    t.classList.remove('active');
                    t.style.removeProperty('background');
                    t.style.removeProperty('color');
                });
                tab.classList.add('active');

                // İlgili paneli göster
                const tabName = tab.dataset.tab;
                settingsPanels.forEach(p => p.style.display = 'none');
                const panel = document.getElementById(`panel-${tabName}`);
                if (panel) panel.style.display = 'block';

                // Ses sekmesine geçince cihazları yükle
                if (tabName === 'ses') {
                    loadAudioDevices();
                }

                // Admin sekmesine geçildiğinde odaları yükle
                if (tabName === 'admin') {
                    loadAdminRooms();
                }

                // Ses sekmesinden çıkınca mikrofon testini durdur
                if (tabName !== 'ses') {
                    stopMicTest();
                }
            });
        });

        // ===== SES AYGITI LİSTELEME =====
        async function loadAudioDevices() {
            try {
                let devices = await navigator.mediaDevices.enumerateDevices();
                const needsPermission = devices.some(d => d.kind === 'audioinput' && d.label === '');

                if (needsPermission) {
                    const tempStream = await navigator.mediaDevices.getUserMedia({ audio: true });
                    tempStream.getTracks().forEach(t => t.stop());
                    devices = await navigator.mediaDevices.enumerateDevices();
                }

                const micSelect = document.getElementById('settings-mic-select');
                const speakerSelect = document.getElementById('settings-speaker-select');

                if (micSelect) {
                    micSelect.innerHTML = '';
                    const audioInputs = devices.filter(d => d.kind === 'audioinput');
                    if (audioInputs.length === 0) {
                        micSelect.innerHTML = '<option value="">Mikrofon bulunamadı</option>';
                    } else {
                        audioInputs.forEach((device, i) => {
                            const opt = document.createElement('option');
                            opt.value = device.deviceId;
                            opt.textContent = device.label || `Mikrofon ${i + 1} `;
                            micSelect.appendChild(opt);
                        });
                    }
                    // Kayıtlı cihazı seç
                    const savedMic = localStorage.getItem('haven_mic_device');
                    if (savedMic) micSelect.value = savedMic;
                }

                if (speakerSelect) {
                    speakerSelect.innerHTML = '';
                    const audioOutputs = devices.filter(d => d.kind === 'audiooutput');
                    if (audioOutputs.length === 0) {
                        speakerSelect.innerHTML = '<option value="">Hoparlör bulunamadı</option>';
                    } else {
                        audioOutputs.forEach((device, i) => {
                            const opt = document.createElement('option');
                            opt.value = device.deviceId;
                            opt.textContent = device.label || `Hoparlör ${i + 1} `;
                            speakerSelect.appendChild(opt);
                        });
                    }
                    const savedSpeaker = localStorage.getItem('haven_speaker_device');
                    if (savedSpeaker) speakerSelect.value = savedSpeaker;
                }
            } catch (err) {
                console.error('Ses cihazları yüklenemedi:', err);
                const micSelect = document.getElementById('settings-mic-select');
                if (micSelect) micSelect.innerHTML = '<option value="">Erişim reddedildi</option>';
            }
        }

        // ===== MİKROFON TESTİ =====
        function stopMicTest() {
            if (micTestStream) {
                micTestStream.getTracks().forEach(t => t.stop());
                micTestStream = null;
            }
            if (micTestAnimFrame) {
                cancelAnimationFrame(micTestAnimFrame);
                micTestAnimFrame = null;
            }
            const container = document.getElementById('mic-level-container');
            const bar = document.getElementById('mic-level-bar');
            if (container) container.style.display = 'none';
            if (bar) bar.style.width = '0%';

            const btn = document.getElementById('btn-test-mic');
            if (btn) btn.textContent = window.i18n ? window.i18n.t('btn_test_mic') : '🎙️ Mikrofonu Test Et';
        }

        const btnTestMic = document.getElementById('btn-test-mic');
        if (btnTestMic) {
            btnTestMic.addEventListener('click', async () => {
                // Zaten test ediyorsak durdur
                if (micTestStream) {
                    stopMicTest();
                    return;
                }

                const micSelect = document.getElementById('settings-mic-select');
                const deviceId = micSelect?.value || undefined;

                try {
                    const constraints = { audio: deviceId ? { deviceId: { exact: deviceId } } : true };
                    micTestStream = await navigator.mediaDevices.getUserMedia(constraints);

                    btnTestMic.textContent = window.i18n ? window.i18n.t('btn_stop_test') : '⏹️ Testi Durdur';
                    const container = document.getElementById('mic-level-container');
                    const bar = document.getElementById('mic-level-bar');
                    if (container) container.style.display = 'block';

                    const testCtx = new (window.AudioContext || window.webkitAudioContext)();
                    const source = testCtx.createMediaStreamSource(micTestStream);
                    const analyser = testCtx.createAnalyser();
                    analyser.fftSize = 256;
                    analyser.smoothingTimeConstant = 0.5;
                    source.connect(analyser);
                    const dataArray = new Uint8Array(analyser.frequencyBinCount);

                    function updateBar() {
                        analyser.getByteFrequencyData(dataArray);
                        let sum = 0;
                        for (let i = 0; i < dataArray.length; i++) sum += dataArray[i];
                        const avg = sum / dataArray.length;
                        const percent = Math.min(100, (avg / 50) * 100);
                        if (bar) bar.style.width = percent + '%';
                        micTestAnimFrame = requestAnimationFrame(updateBar);
                    }
                    updateBar();
                } catch (err) {
                    showToast((window.i18n ? window.i18n.t('mic_access_fail') : 'Mikrofon erişilemedi') + ': ' + err.message, 'error');
                }
            });
        }

        // ===== HOPARLÖR TESTİ =====
        const btnTestSpeaker = document.getElementById('btn-test-speaker');
        if (btnTestSpeaker) {
            btnTestSpeaker.addEventListener('click', () => {
                const speakerSelect = document.getElementById('settings-speaker-select');
                const testAudio = new Audio('assets/notification.mp3');

                if (speakerSelect?.value && typeof testAudio.setSinkId === 'function') {
                    testAudio.setSinkId(speakerSelect.value).then(() => {
                        testAudio.play();
                    }).catch(e => {
                        console.warn('setSinkId hatası:', e);
                        testAudio.play();
                    });
                } else {
                    testAudio.play();
                }
                showToast(window.i18n ? window.i18n.t('test_sound') : 'Test sesi çalınıyor...', 'info');
            });
        }

        // ===== AYARLAR MODALINI AÇMA =====
        el.btnChatSettings.addEventListener('click', () => {
            // Mevcut ayarları forma doldur
            el.chatUsernameInput.value = state.nickname || '';
            el.chatAvatarColorInput.value = state.avatarColor || '#6366f1';
            el.chatColorPreviewText.textContent = state.nickname || (window.i18n ? window.i18n.t('sample_user') : 'Örnek Kullanıcı');
            el.chatColorPreviewText.style.color = state.avatarColor || '#6366f1';

            if (el.chatColorPickerContainer) {
                const currentColor = state.avatarColor || '#6366f1';
                Array.from(el.chatColorPickerContainer.children).forEach(c => {
                    if (c.dataset.color === currentColor) {
                        c.style.border = '2px solid white';
                        c.style.boxShadow = `0 0 10px ${c.dataset.color}80`;
                    } else {
                        c.style.border = '2px solid transparent';
                        c.style.boxShadow = 'none';
                    }
                });
            }

            if (el.chatThemeSelector) {
                el.chatThemeSelector.value = localStorage.getItem('haven_login_theme') || 'space';
            }

            if (el.chatLangSelect) {
                el.chatLangSelect.value = localStorage.getItem('haven_app_lang') || 'tr';
            }

            if (state.profilePic) {
                el.chatAvatarPreviewImg.src = state.profilePic;
                el.chatAvatarPreviewImg.style.display = 'block';
                el.chatAvatarUploadIcon.style.display = 'none';
            } else {
                el.chatAvatarPreviewImg.style.display = 'none';
                el.chatAvatarUploadIcon.style.display = 'block';
            }

            // İlk sekmeyi aktif yap
            settingsTabs.forEach(t => {
                t.classList.remove('active');
                t.style.removeProperty('background');
                t.style.removeProperty('color');
            });
            settingsPanels.forEach(p => p.style.display = 'none');
            const firstTab = document.querySelector('.settings-tab[data-tab="profil"]');
            const firstPanel = document.getElementById('panel-profil');
            if (firstTab) { firstTab.classList.add('active'); }
            if (firstPanel) firstPanel.style.display = 'block';

            el.chatSettingsModal.style.display = 'flex';
            setTimeout(() => el.chatSettingsModal.style.opacity = '1', 10);
        });

        // Takma ad değiştiğinde preview yazısını güncelle
        el.chatUsernameInput.addEventListener('input', (e) => {
            el.chatColorPreviewText.textContent = e.target.value.trim() || (window.i18n ? window.i18n.t('sample_user') : 'Örnek Kullanıcı');
        });

        el.chatAvatarUpload.addEventListener('change', (e) => {
            const file = e.target.files[0];
            if (!file) return;

            const reader = new FileReader();
            reader.onload = function (evt) {
                const img = new Image();
                img.onload = function () {
                    const canvas = document.createElement('canvas');
                    const MAX_WIDTH = 128;
                    const MAX_HEIGHT = 128;
                    let width = img.width;
                    let height = img.height;

                    if (width > height) {
                        if (width > MAX_WIDTH) { height *= MAX_WIDTH / width; width = MAX_WIDTH; }
                    } else {
                        if (height > MAX_HEIGHT) { width *= MAX_HEIGHT / height; height = MAX_HEIGHT; }
                    }
                    canvas.width = width; canvas.height = height;
                    const ctx = canvas.getContext('2d');
                    ctx.drawImage(img, 0, 0, width, height);

                    const dataUrl = canvas.toDataURL('image/jpeg', 0.8);
                    state.profilePic = dataUrl;

                    el.chatAvatarPreviewImg.src = dataUrl;
                    el.chatAvatarPreviewImg.style.display = 'block';
                    el.chatAvatarUploadIcon.style.display = 'none';
                };
                img.src = evt.target.result;
            };
            reader.readAsDataURL(file);
        });

        if (el.chatThemeSelector) {
            el.chatThemeSelector.addEventListener('change', (e) => {
                const selectedTheme = e.target.value;
                document.documentElement.setAttribute('data-theme', selectedTheme);
            });
        }

        if (el.chatLangSelect && window.i18n) {
            el.chatLangSelect.addEventListener('change', (e) => {
                window.i18n.setLanguage(e.target.value);
            });
        }

        const closeChatSettings = () => {
            stopMicTest();
            // Eğer iptal edildiyse veya kapatılırsa, temayı eski haline (kayıtlı olana) döndür
            const savedTheme = localStorage.getItem('haven_login_theme') || 'space';
            document.documentElement.setAttribute('data-theme', savedTheme);
            if (el.chatThemeSelector) el.chatThemeSelector.value = savedTheme;

            // Dili de kayitli olandan dondur eger iptal edildiyse
            const savedLang = localStorage.getItem('haven_app_lang') || 'tr';
            if (window.i18n) window.i18n.setLanguage(savedLang);
            if (el.chatLangSelect) el.chatLangSelect.value = savedLang;

            el.chatSettingsModal.style.opacity = '0';
            setTimeout(() => el.chatSettingsModal.style.display = 'none', 300);
        };

        el.btnCloseChatSettings.addEventListener('click', closeChatSettings);

        el.btnSaveChatSettings.addEventListener('click', () => {
            const oldNickname = state.nickname;
            state.nickname = el.chatUsernameInput.value.trim() || 'Kullanıcı';
            state.avatarColor = el.chatAvatarColorInput.value;

            localStorage.setItem('haven_nickname', state.nickname);
            localStorage.setItem('haven_avatar', state.avatarColor);

            if (state.profilePic) {
                localStorage.setItem('haven_profile_pic', state.profilePic);
            } else {
                localStorage.removeItem('haven_profile_pic');
            }

            if (el.chatThemeSelector) {
                const selectedTheme = el.chatThemeSelector.value;
                document.documentElement.setAttribute('data-theme', selectedTheme);
                localStorage.setItem('haven_login_theme', selectedTheme);
            }

            if (el.chatLangSelect && window.i18n) {
                window.i18n.setLanguage(el.chatLangSelect.value);
            }

            // Ses cihaz tercihlerini kaydet
            const micSelect = document.getElementById('settings-mic-select');
            const speakerSelect = document.getElementById('settings-speaker-select');
            if (micSelect?.value) localStorage.setItem('haven_mic_device', micSelect.value);
            if (speakerSelect?.value) localStorage.setItem('haven_speaker_device', speakerSelect.value);

            // Gürültü Engelleme tercihini kaydet
            const noiseCheckbox = document.getElementById('settings-noise-suppression');
            if (noiseCheckbox) {
                localStorage.setItem('haven_noise_suppression', noiseCheckbox.checked);
            }

            // Ekrandaki eski mesajlardaki kullanıcı adlarını ve renklerini anında güncelle
            const nicknameToCheck = oldNickname || state.nickname;
            document.querySelectorAll('.message-group').forEach(groupEl => {
                const usernameEl = groupEl.querySelector('.message-username');
                if (usernameEl && (usernameEl.textContent === nicknameToCheck || usernameEl.textContent === state.nickname)) {
                    usernameEl.textContent = state.nickname;
                    usernameEl.style.color = state.avatarColor;

                    const avatarEl = groupEl.querySelector('.message-avatar');
                    if (avatarEl) {
                        if (state.profilePic) {
                            avatarEl.style.backgroundImage = `url('${state.profilePic}')`;
                            avatarEl.style.backgroundColor = 'transparent';
                            avatarEl.style.color = 'transparent';
                            avatarEl.textContent = '';
                        } else {
                            avatarEl.style.backgroundImage = 'none';
                            avatarEl.style.backgroundColor = state.avatarColor;
                            avatarEl.style.color = 'white';
                            avatarEl.textContent = state.nickname.charAt(0).toUpperCase();
                        }
                    }
                }
            });

            // Sesli sohbetteysek kendi kartımızı güncelle
            const myCard = document.getElementById(`voice-card-${state.userId}`);
            if (myCard) {
                const nameSpan = myCard.querySelector('span');
                if (nameSpan) nameSpan.textContent = state.nickname + (window.i18n ? ` (${window.i18n.t('you')})` : ' (Sen)');
                
                const avatarDiv = document.getElementById(`avatar-${state.userId}`);
                if (avatarDiv) {
                    if (state.profilePic) {
                        avatarDiv.style.backgroundImage = `url('${state.profilePic}')`;
                        avatarDiv.style.backgroundColor = 'transparent';
                        avatarDiv.style.color = 'transparent';
                        avatarDiv.textContent = '';
                    } else {
                        avatarDiv.style.backgroundImage = 'none';
                        avatarDiv.style.backgroundColor = state.avatarColor || '#6366f1';
                        avatarDiv.style.color = 'white';
                        avatarDiv.textContent = state.nickname.charAt(0).toUpperCase();
                    }
                }
            }

            if (state.socket) {
                state.socket.emit('update-profile', {
                    oldNickname: oldNickname,
                    nickname: state.nickname,
                    avatarColor: state.avatarColor,
                    profilePic: state.profilePic
                });
            }

            closeChatSettings();
            showToast(window.i18n ? window.i18n.t('settings_saved') : 'Ayarları kaydettiniz!', 'success');
        });

        el.chatSettingsModal.addEventListener('click', (e) => {
            if (e.target === el.chatSettingsModal) {
                closeChatSettings();
            }
        });
    }

    // Ses İletişimi Butonları
    el.btnJoinVoice?.addEventListener('click', () => {
        initiateVoiceCall(false);
    });
    el.btnJoinVideo?.addEventListener('click', () => {
        initiateVoiceCall(true);
    });
    el.btnLeaveVoice?.addEventListener('click', leaveVoiceRoom);
    el.btnToggleMic?.addEventListener('click', toggleMic);
    el.btnToggleVideo?.addEventListener('click', toggleVideo);
    el.btnToggleScreen?.addEventListener('click', toggleScreen);

    // Sağ Tık Menü Kapatma (Herhangi bir yere tıklandığında)
    document.addEventListener('click', (e) => {
        const userMenu = document.getElementById('user-context-menu');
        const triggerArea = e.target.closest('[oncontextmenu]');
        if (userMenu && !userMenu.contains(e.target) && !triggerArea) {
            userMenu.style.display = 'none';
        }
    });

    // Gelen Arama Modalı Tuşları
    el.btnDeclineCall?.addEventListener('click', () => {
        el.modalIncomingCall.classList.remove('visible');
        stopRingtone();
        if (state.socket) {
            state.socket.emit('voice-call-declined', { username: state.nickname });
        }
    });
    el.btnAcceptCall?.addEventListener('click', () => {
        el.modalIncomingCall.classList.remove('visible');
        stopRingtone();
        joinVoiceRoom(false); // Çağrıya cevap ver, sese gir
        if (el.activeCallBanner) el.activeCallBanner.style.display = 'none';
    });

    // Aktif Arama Banner'ından Katıl butonu
    el.activeCallJoinBtn?.addEventListener('click', () => {
        stopRingtone();
        el.modalIncomingCall.classList.remove('visible');
        joinVoiceRoom(false); // Sese katıl (çaldırmadan)
        if (el.activeCallBanner) el.activeCallBanner.style.display = 'none';
    });

    // Sayfa kapatılırken veya yenilenirken sesi otomatik terk et (Bug fix)
    window.addEventListener('beforeunload', () => {
        if (voiceState.isInVoice) leaveVoiceRoom();
    });
}

async function sendMessage() {
    const rawContent = el.messageInput.value.trim();
    const hasImages = state.pendingImages && state.pendingImages.length > 0;

    if (!rawContent && !hasImages) return;
    if (!state.socket) return;

    const doSend = async () => {
        // Önce görselleri gönder
        if (hasImages) {
            for (const blob of state.pendingImages) {
                // FIX: Blob türüne göre doğru uzantı seç (PNG blob'u .jpg olarak gönderilmemeli)
                let filename;
                if (blob.name && blob.name !== 'image.png') {
                    filename = blob.name;
                } else {
                    const extMap = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/webp': 'webp' };
                    const ext = extMap[blob.type] || 'png';
                    filename = `image_${Date.now()}.${ext}`;
                }
                const file = new File([blob], filename, { type: blob.type });
                await window.uploadFileToChat(file);
            }
            state.pendingImages = [];
            const container = document.getElementById('image-preview-container');
            if (container) {
                container.style.display = 'none';
                container.innerHTML = '';
            }
        }

        // Varsa metni gönder veya düzenle
        if (rawContent) {
            const currentEditId = state.editingMessageId;
            console.log("sendMessage triggered. currentEditId:", currentEditId);
            const encryptedContent = await encryptMessage(rawContent);
            if (currentEditId) {
                console.log("Emitting edit-message for id:", currentEditId);
                state.socket.emit('edit-message', {
                    messageId: currentEditId,
                    newContent: encryptedContent
                });
            } else {
                console.log("Emitting send-message");
                state.socket.emit('send-message', {
                    content: encryptedContent,
                    type: 'message',
                    replyTo: state.replyingTo ? state.replyingTo.id : null
                });
            }
        }

        el.messageInput.value = '';
        el.messageInput.style.height = 'auto';
        window.cancelReply();
        if (window.cancelEdit) window.cancelEdit();
        setTimeout(() => el.messageInput.focus(), 10);
    };

    if (hasImages) {
        const msgMulti = window.i18n
            ? window.i18n.t('msg_send_multiple_images').replace('{count}', state.pendingImages.length)
            : `${state.pendingImages.length} adet görseli göndermek istediğinize emin misiniz?`;
        window.showConfirmModal(msgMulti, doSend);
    } else {
        await doSend();
    }
}

window.initiateEdit = (messageId, rawContent) => {
    console.log("initiateEdit called with id:", messageId);
    state.editingMessageId = messageId;
    // Replace <br> with newlines if editing HTML content
    const unescapedContent = rawContent.replace(/<br>/g, '\n').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
    el.messageInput.value = unescapedContent;
    el.messageInput.focus();
    
    // Düzenleme UI (Cancel butonu göster vs)
    const container = document.querySelector('.chat-input-container');
    let editBar = document.getElementById('edit-bar');
    if (!editBar) {
        editBar = document.createElement('div');
        editBar.id = 'edit-bar';
        editBar.style.cssText = 'background:var(--bg-light); border-top:1px solid var(--border-medium); padding:6px 12px; font-size:12px; color:var(--text-muted); display:flex; justify-content:space-between; align-items:center;';
        if (container) {
            container.insertBefore(editBar, container.firstChild);
        }
    }
    editBar.style.display = 'flex';
    editBar.innerHTML = `<span>Mesaj düzenleniyor...</span><button onclick="window.cancelEdit()" style="background:none;border:none;color:var(--accent-primary);cursor:pointer;">İptal</button>`;
    
    // Send butonu iconunu değiştir (Kaydet)
    if (el.btnSend) {
        const sendIcon = el.btnSend.querySelector('i') || el.btnSend;
        if (sendIcon && sendIcon.classList) {
            sendIcon.className = 'fas fa-check';
        }
    }
};

window.cancelEdit = () => {
    console.log("cancelEdit called");
    state.editingMessageId = null;
    el.messageInput.value = '';
    const editBar = document.getElementById('edit-bar');
    if (editBar) editBar.style.display = 'none';
    
    // Send butonu iconunu geri al
    if (el.btnSend) {
        const sendIcon = el.btnSend.querySelector('i') || el.btnSend;
        if (sendIcon && sendIcon.classList) {
            sendIcon.className = 'fas fa-paper-plane';
        }
    }
};

// Global Yanıt (Reply) Metodları
window.initiateReply = (msgId, username, content) => {
    state.replyingTo = { id: msgId, username, content };
    let previewEl = document.getElementById('reply-preview-box');

    // Eğer preview kutusu DOM'da yoksa chat.html üzerinde oluşturalım
    if (!previewEl) {
        previewEl = document.createElement('div');
        previewEl.id = 'reply-preview-box';
        previewEl.style.display = 'none';
        previewEl.style.alignItems = 'center';
        previewEl.style.justifyContent = 'space-between';
        previewEl.style.background = 'rgba(255, 255, 255, 0.05)';
        previewEl.style.padding = '8px 12px';
        previewEl.style.borderLeft = '3px solid var(--accent-primary)';
        previewEl.style.margin = '0 16px 8px 16px';
        previewEl.style.borderRadius = 'var(--radius-sm)';
        previewEl.style.fontSize = '12px';
        previewEl.style.color = 'var(--text-muted)';

        // input container'ın hemen üstüne ekleyelim
        const inputContainer = document.querySelector('.chat-input-container');
        if (inputContainer && inputContainer.parentNode) {
            inputContainer.parentNode.insertBefore(previewEl, inputContainer);
        }
    }

    const maxContent = content.length > 60 ? content.slice(0, 60) + '...' : content;
    previewEl.innerHTML = `
        <div>
            <strong style="color:var(--text-primary); margin-right:6px;">${escapeHtml(username)}</strong> 
            <span>${escapeHtml(maxContent)} ${window.i18n ? window.i18n.t('msg_replying') : 'yanıtlanıyor'}</span>
        </div>
        <button onclick="window.cancelReply()" style="background:none; border:none; color:var(--text-muted); cursor:pointer; font-size:16px;">✕</button>
    `;
    previewEl.style.display = 'flex';

    el.messageInput.focus();
};

window.cancelReply = () => {
    state.replyingTo = null;
    const previewEl = document.getElementById('reply-preview-box');
    if (previewEl) {
        previewEl.style.display = 'none';
    }
};

// Başlat
initialize();
