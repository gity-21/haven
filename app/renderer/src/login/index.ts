/**
 * login/index.ts — Giriş Ekranı Kontrolcüsü
 *
 * Ağ Kur / Bağlan sekmeleri, profil ayarları, ses cihazı yönetimi,
 * SHA-256 ile authKey oluşturma ve Electron/web yönlendirmeleri.
 */

// ── CSS imports (Vite bundle'a dahil eder) ──
import '../../css/style.css';
import '../../css/soft-login.css';
import '../../css/antigravity.css';

// ── Side-effect imports ──
import '../i18n';
import '../matrix';
import '../antigravity';

// ── Alert Modal (login.html'de chat modals yok, kendi versiyonunu kullanıyoruz) ──

window.showAlertModal = function (message: string, title = 'Uyarı'): Promise<void> {
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
        const handleOk = (): void => { cleanup(); resolve(); };
        btnOk?.addEventListener('click', handleOk);
    });
};

// ── DOMContentLoaded ──

document.addEventListener('DOMContentLoaded', () => {
    const form = document.getElementById('form-login') as HTMLFormElement | null;
    const inputServer = document.getElementById('login-server') as HTMLInputElement | null;
    const inputUsername = document.getElementById('login-username') as HTMLInputElement | null;
    const inputRoom = document.getElementById('login-room') as HTMLInputElement | null;
    const inputPassword = document.getElementById('login-password') as HTMLInputElement | null;
    const inputColor = document.getElementById('login-avatar-color') as HTMLInputElement | null;
    const colorPickerContainer = document.getElementById('color-picker') as HTMLElement | null;
    const colorPreviewText = document.getElementById('color-preview-text') as HTMLElement | null;
    const errorMsg = document.getElementById('login-error') as HTMLElement | null;

    const avatarUpload = document.getElementById('login-avatar-upload') as HTMLInputElement | null;
    const avatarPreviewImg = document.getElementById('avatar-preview-img') as HTMLImageElement | null;
    const avatarUploadIcon = document.getElementById('avatar-upload-icon') as HTMLElement | null;

    const btnSettings = document.getElementById('btn-settings');
    const settingsModal = document.getElementById('settings-modal');
    const btnCloseSettings = document.getElementById('btn-close-settings');
    const btnSaveSettings = document.getElementById('btn-save-settings');
    const tabCreate = document.getElementById('tab-create');
    const tabJoin = document.getElementById('tab-join');

    if (!form || !inputServer || !inputUsername || !inputRoom || !inputPassword || !inputColor) return;

    // ── Kayıtlı verileri yükle ──

    let savedProfilePic: string | null = localStorage.getItem('haven_profile_pic') || null;
    let savedServer = localStorage.getItem('haven_server_url') || 'http://localhost:3847';
    let savedUsername = localStorage.getItem('haven_nickname') || '';
    let savedRoom = localStorage.getItem('haven_room') || '';
    const savedColor = localStorage.getItem('haven_avatar') || '#6366f1';

    // Sihirli link parametreleri
    const urlParams = new URLSearchParams(window.location.search);
    const invitePass = '';
    if (urlParams.has('room')) savedRoom = urlParams.get('room') || '';
    if (urlParams.has('name')) savedUsername = urlParams.get('name') || '';

    // Tema
    const savedTheme = localStorage.getItem('haven_login_theme') || 'space';
    const loginThemeSelect = document.getElementById('login-theme-select') as HTMLSelectElement | null;
    if (loginThemeSelect) loginThemeSelect.value = savedTheme;
    document.documentElement.setAttribute('data-theme', savedTheme);

    // Dil
    const savedLang = localStorage.getItem('haven_app_lang') || 'tr';
    const loginLangSelect = document.getElementById('login-lang-select') as HTMLSelectElement | null;
    if (loginLangSelect) loginLangSelect.value = savedLang;

    // Gürültü Engelleme
    const savedNoiseSetting = localStorage.getItem('haven_noise_suppression');
    const noiseCheckbox = document.getElementById('login-noise-suppression') as HTMLInputElement | null;
    if (noiseCheckbox && savedNoiseSetting === 'false') noiseCheckbox.checked = false;

    // Cloudflare/ngrok temizliği
    if (savedServer.includes('trycloudflare.com') || savedServer.includes('ngrok') || savedServer.includes('loca.lt')) {
        savedServer = 'http://localhost:3847';
        localStorage.setItem('haven_server_url', savedServer);
    }

    // İlk açılışta random nickname
    let defaultName = localStorage.getItem('haven_nickname');
    if (!defaultName) {
        defaultName = `Kullanıcı_${Math.floor(1000 + Math.random() * 9000)}`;
        localStorage.setItem('haven_nickname', defaultName);
    }

    // Login hatası gösterme
    const loginError = localStorage.getItem('haven_login_error');
    if (loginError) {
        localStorage.removeItem('haven_login_error');
        setTimeout(() => {
            window.showAlertModal!(loginError, 'Bölgeye Erişim Reddedildi');
        }, 150);
    }

    // Form alanlarını doldur
    inputServer.value = savedServer;
    inputUsername.value = savedUsername || defaultName;
    inputRoom.value = savedRoom;
    if (invitePass) inputPassword.value = invitePass;
    inputColor.value = savedColor;

    if (urlParams.has('room') && tabJoin) {
        window.history.replaceState({}, document.title, window.location.pathname);
        setTimeout(() => tabJoin.click(), 50);
    }

    if (savedProfilePic && avatarPreviewImg && avatarUploadIcon) {
        avatarPreviewImg.src = savedProfilePic;
        avatarPreviewImg.style.display = 'block';
        avatarUploadIcon.style.display = 'none';
    }

    if (colorPreviewText) {
        colorPreviewText.textContent = savedUsername || 'Örnek Kullanıcı';
        colorPreviewText.style.color = savedColor;
    }

    inputUsername.addEventListener('input', (e: Event) => {
        if (colorPreviewText) {
            colorPreviewText.textContent = (e.target as HTMLInputElement).value.trim() || 'Örnek Kullanıcı';
        }
    });

    // ── Renk Seçici ──

    const colors = ['#6366f1', '#ef4444', '#10b981', '#f59e0b', '#0ea5e9', '#ec4899', '#8b5cf6', '#14b8a6'];
    if (colorPickerContainer) {
        colors.forEach(color => {
            const btn = document.createElement('div');
            btn.style.width = '24px';
            btn.style.height = '24px';
            btn.style.borderRadius = '50%';
            btn.style.backgroundColor = color;
            btn.style.cursor = 'pointer';
            btn.style.border = color === savedColor ? '2px solid white' : '2px solid transparent';
            btn.style.boxShadow = color === savedColor ? `0 0 10px ${color}80` : 'none';
            btn.style.transition = '0.2s';

            btn.onclick = () => {
                Array.from(colorPickerContainer.children).forEach((c: Element) => {
                    (c as HTMLElement).style.border = '2px solid transparent';
                    (c as HTMLElement).style.boxShadow = 'none';
                });
                btn.style.border = '2px solid white';
                btn.style.boxShadow = `0 0 10px ${color}80`;
                inputColor.value = color;
                if (colorPreviewText) colorPreviewText.style.color = color;
            };

            colorPickerContainer.appendChild(btn);
        });
    }

    // ── Avatar Upload ──

    if (avatarUpload) {
        avatarUpload.addEventListener('change', (e: Event) => {
            const file = (e.target as HTMLInputElement).files?.[0];
            if (!file) return;

            const reader = new FileReader();
            reader.onload = (evt: ProgressEvent<FileReader>) => {
                const img = new Image();
                img.onload = () => {
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
                    canvas.width = width;
                    canvas.height = height;
                    canvas.getContext('2d')!.drawImage(img, 0, 0, width, height);

                    const dataUrl = canvas.toDataURL('image/jpeg', 0.8);
                    savedProfilePic = dataUrl;

                    if (avatarPreviewImg) {
                        avatarPreviewImg.src = dataUrl;
                        avatarPreviewImg.style.display = 'block';
                    }
                    if (avatarUploadIcon) avatarUploadIcon.style.display = 'none';
                };
                img.src = evt.target!.result as string;
            };
            reader.readAsDataURL(file);
        });
    }

    // ── Electron lokal sunucu URL ──

    if (window.electronAPI?.getLocalServerUrl) {
        window.electronAPI.getLocalServerUrl().then((localUrl: string) => {
            if (localUrl) {
                inputServer.value = localUrl;
                localStorage.setItem('haven_server_url', localUrl);
            }
        }).catch((err: Error) => console.error('Lokal sunucu URL alınamadı:', err));
    }

    if (window.electronAPI?.getTunnelUrl) {
        window.electronAPI.getTunnelUrl().then((tunnelUrl: string | null) => {
            if (tunnelUrl) inputServer.value = tunnelUrl;
        }).catch((err: Error) => console.error('Tunnel URL okuma hatası:', err));
    }

    // ── Window Controls (Electron) ──

    if (window.electronAPI) {
        document.getElementById('btn-minimize')?.addEventListener('click', () => window.electronAPI!.minimizeWindow());
        document.getElementById('btn-maximize')?.addEventListener('click', () => window.electronAPI!.maximizeWindow());
        document.getElementById('btn-close')?.addEventListener('click', () => window.electronAPI!.closeWindow());
    } else {
        const titlebar = document.querySelector('.titlebar') as HTMLElement | null;
        if (titlebar) titlebar.style.display = 'none';
    }

    // ── Settings Modal ──

    if (btnSettings && settingsModal) {
        let loginMicTestStream: MediaStream | null = null;
        let loginMicTestAnimFrame: number | null = null;

        const loginSettingsTabs = document.querySelectorAll('.login-settings-tab');
        const loginSettingsPanels = document.querySelectorAll('.login-settings-panel');

        loginSettingsTabs.forEach((tab: Element) => {
            tab.addEventListener('click', () => {
                loginSettingsTabs.forEach((t: Element) => {
                    t.classList.remove('active');
                    (t as HTMLElement).style.removeProperty('background');
                    (t as HTMLElement).style.removeProperty('color');
                });
                tab.classList.add('active');

                const tabName = (tab as HTMLElement).dataset.tab;
                loginSettingsPanels.forEach((p: Element) => {
                    (p as HTMLElement).style.display = 'none';
                });

                const panel = document.getElementById(`login-panel-${tabName}`);
                if (panel) panel.style.display = 'block';

                if (tabName === 'ses') loginLoadAudioDevices();
                if (tabName !== 'ses') loginStopMicTest();
            });
        });

        // ── Ses Aygıtı Listeleme ──

        async function loginLoadAudioDevices(): Promise<void> {
            try {
                let devices = await navigator.mediaDevices.enumerateDevices();
                const needsPermission = devices.some(d => d.kind === 'audioinput' && d.label === '');

                if (needsPermission) {
                    const tempStream = await navigator.mediaDevices.getUserMedia({ audio: true });
                    tempStream.getTracks().forEach(t => t.stop());
                    devices = await navigator.mediaDevices.enumerateDevices();
                }

                const micSelect = document.getElementById('login-mic-select') as HTMLSelectElement | null;
                const speakerSelect = document.getElementById('login-speaker-select') as HTMLSelectElement | null;

                if (micSelect) {
                    micSelect.innerHTML = '';
                    const audioInputs = devices.filter(d => d.kind === 'audioinput');
                    if (audioInputs.length === 0) {
                        micSelect.innerHTML = '<option value="">Mikrofon bulunamadı</option>';
                    } else {
                        audioInputs.forEach((device, i) => {
                            const opt = document.createElement('option');
                            opt.value = device.deviceId;
                            opt.textContent = device.label || `Mikrofon ${i + 1}`;
                            micSelect.appendChild(opt);
                        });
                    }
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
                            opt.textContent = device.label || `Hoparlör ${i + 1}`;
                            speakerSelect.appendChild(opt);
                        });
                    }
                    const savedSpeaker = localStorage.getItem('haven_speaker_device');
                    if (savedSpeaker) speakerSelect.value = savedSpeaker;
                }
            } catch (err) {
                console.error('Ses cihazları yüklenemedi:', err);
                const micSelect = document.getElementById('login-mic-select') as HTMLSelectElement | null;
                if (micSelect) micSelect.innerHTML = '<option value="">Erişim reddedildi</option>';
            }
        }

        // ── Mikrofon Testi ──

        function loginStopMicTest(): void {
            if (loginMicTestStream) {
                loginMicTestStream.getTracks().forEach(t => t.stop());
                loginMicTestStream = null;
            }
            if (loginMicTestAnimFrame) {
                cancelAnimationFrame(loginMicTestAnimFrame);
                loginMicTestAnimFrame = null;
            }
            const container = document.getElementById('login-mic-level-container');
            const bar = document.getElementById('login-mic-level-bar');
            if (container) container.style.display = 'none';
            if (bar) (bar as HTMLElement).style.width = '0%';
            const btn = document.getElementById('login-btn-test-mic');
            if (btn) btn.textContent = '🎙️ Mikrofonu Test Et';
        }

        const loginBtnTestMic = document.getElementById('login-btn-test-mic');
        if (loginBtnTestMic) {
            loginBtnTestMic.addEventListener('click', async () => {
                if (loginMicTestStream) { loginStopMicTest(); return; }

                const micSelect = document.getElementById('login-mic-select') as HTMLSelectElement | null;
                const deviceId = micSelect?.value || undefined;

                try {
                    const constraints: MediaStreamConstraints = { audio: deviceId ? { deviceId: { exact: deviceId } } : true };
                    loginMicTestStream = await navigator.mediaDevices.getUserMedia(constraints);

                    loginBtnTestMic.textContent = '⏹️ Testi Durdur';
                    const container = document.getElementById('login-mic-level-container');
                    const bar = document.getElementById('login-mic-level-bar') as HTMLElement | null;
                    if (container) container.style.display = 'block';

                    const testCtx = new AudioContext();
                    const source = testCtx.createMediaStreamSource(loginMicTestStream);
                    const analyser = testCtx.createAnalyser();
                    analyser.fftSize = 256;
                    analyser.smoothingTimeConstant = 0.5;
                    source.connect(analyser);
                    const dataArray = new Uint8Array(analyser.frequencyBinCount);

                    function updateBar(): void {
                        analyser.getByteFrequencyData(dataArray);
                        let sum = 0;
                        for (let i = 0; i < dataArray.length; i++) sum += dataArray[i];
                        const avg = sum / dataArray.length;
                        const percent = Math.min(100, (avg / 50) * 100);
                        if (bar) bar.style.width = percent + '%';
                        loginMicTestAnimFrame = requestAnimationFrame(updateBar);
                    }
                    updateBar();
                } catch (err) {
                    const error = err as DOMException;
                    await window.showAlertModal!('Mikrofon erişilemedi: ' + error.message);
                }
            });
        }

        // ── Hoparlör Testi ──

        const loginBtnTestSpeaker = document.getElementById('login-btn-test-speaker');
        if (loginBtnTestSpeaker) {
            loginBtnTestSpeaker.addEventListener('click', () => {
                const speakerSelect = document.getElementById('login-speaker-select') as HTMLSelectElement | null;
                const testAudio = new Audio('assets/notification.mp3');

                if (speakerSelect?.value && typeof (testAudio as any).setSinkId === 'function') {
                    (testAudio as any).setSinkId(speakerSelect.value).then(() => {
                        testAudio.play();
                    }).catch((e: Error) => {
                        console.warn('setSinkId hatası:', e);
                        testAudio.play();
                    });
                } else {
                    testAudio.play();
                }
            });
        }

        // ── Ayarları Aç ──

        btnSettings.addEventListener('click', () => {
            loginSettingsTabs.forEach((t: Element) => {
                t.classList.remove('active');
                (t as HTMLElement).style.removeProperty('background');
                (t as HTMLElement).style.removeProperty('color');
            });
            loginSettingsPanels.forEach((p: Element) => (p as HTMLElement).style.display = 'none');
            const firstTab = document.querySelector('.login-settings-tab[data-tab="profil"]');
            const firstPanel = document.getElementById('login-panel-profil');
            if (firstTab) firstTab.classList.add('active');
            if (firstPanel) firstPanel.style.display = 'block';

            (settingsModal as HTMLElement).style.display = 'flex';
            setTimeout(() => (settingsModal as HTMLElement).style.opacity = '1', 10);
        });

        const closeSettings = (): void => {
            loginStopMicTest();
            (settingsModal as HTMLElement).style.opacity = '0';
            setTimeout(() => (settingsModal as HTMLElement).style.display = 'none', 300);
        };

        btnCloseSettings?.addEventListener('click', closeSettings);
        btnSaveSettings?.addEventListener('click', () => {
            // Tema
            if (loginThemeSelect) {
                document.documentElement.setAttribute('data-theme', loginThemeSelect.value);
                localStorage.setItem('haven_login_theme', loginThemeSelect.value);
            }

            // Dil
            const langSelect = document.getElementById('login-lang-select') as HTMLSelectElement | null;
            if (langSelect && window.i18n) window.i18n.setLanguage(langSelect.value);

            // Ses cihazları
            const micSelect = document.getElementById('login-mic-select') as HTMLSelectElement | null;
            const speakerSelect = document.getElementById('login-speaker-select') as HTMLSelectElement | null;
            if (micSelect?.value) localStorage.setItem('haven_mic_device', micSelect.value);
            if (speakerSelect?.value) localStorage.setItem('haven_speaker_device', speakerSelect.value);

            // Gürültü Engelleme
            const noiseChk = document.getElementById('login-noise-suppression') as HTMLInputElement | null;
            if (noiseChk) localStorage.setItem('haven_noise_suppression', String(noiseChk.checked));

            closeSettings();
        });

        settingsModal.addEventListener('click', (e: MouseEvent) => {
            if (e.target === settingsModal) closeSettings();
        });
    }

    // ── Tema Değişikliği ──

    if (loginThemeSelect) {
        loginThemeSelect.addEventListener('change', (e: Event) => {
            document.documentElement.setAttribute('data-theme', (e.target as HTMLSelectElement).value);
        });
    }

    const loginLangSelectEl = document.getElementById('login-lang-select') as HTMLSelectElement | null;
    if (loginLangSelectEl && window.i18n) {
        loginLangSelectEl.addEventListener('change', (e: Event) => {
            window.i18n!.setLanguage((e.target as HTMLSelectElement).value);
        });
    }

    // ── Tabs ──

    const serverGroup = document.getElementById('server-group');

    if (tabCreate && tabJoin) {
        tabCreate.addEventListener('click', () => {
            tabCreate.classList.add('active');
            tabJoin.classList.remove('active');

            const submitBtn = document.getElementById('login-submit');
            if (submitBtn) {
                submitBtn.setAttribute('data-lang-key', 'btn_create');
                submitBtn.textContent = window.i18n ? window.i18n.t('btn_create') : 'Ağ Kur';
            }

            if (inputRoom) {
                inputRoom.setAttribute('data-lang-key', 'room_placeholder_create');
                inputRoom.placeholder = window.i18n ? window.i18n.t('room_placeholder_create') : 'Yeni uçtan uca şifreli ağ bağlamı oluşturun';
            }

            if (serverGroup) serverGroup.style.display = 'none';
        });

        tabJoin.addEventListener('click', () => {
            tabJoin.classList.add('active');
            tabCreate.classList.remove('active');

            const submitBtn = document.getElementById('login-submit');
            if (submitBtn) {
                submitBtn.setAttribute('data-lang-key', 'btn_connect');
                submitBtn.textContent = window.i18n ? window.i18n.t('btn_connect') : 'Bağlan';
            }

            if (inputRoom) {
                inputRoom.setAttribute('data-lang-key', 'room_placeholder_join');
                inputRoom.placeholder = window.i18n ? window.i18n.t('room_placeholder_join') : 'Kriptografik erişim odası anahtarı';
            }

            if (serverGroup) serverGroup.style.display = 'block';
        });
    }

    // ── Form Submit ──

    form.addEventListener('submit', async (e: Event) => {
        e.preventDefault();

        const isWeb = window.location.protocol === 'http:' || window.location.protocol === 'https:';
        let serverUrl = isWeb ? window.location.origin : (inputServer.value.trim() || 'http://localhost:3847');
        const nickname = inputUsername.value.trim() || `Kullanıcı_${Math.floor(1000 + Math.random() * 9000)}`;
        const room = inputRoom.value.trim().toLowerCase();
        const passwordMatch = inputPassword.value.trim();

        if (!room || !passwordMatch) {
            showError("Lütfen oda anahtarı ve şifreyi girin.");
            return;
        }

        // SHA-256 ile hash
        const encoder = new TextEncoder();
        const data = encoder.encode(passwordMatch);
        const hashBuffer = await crypto.subtle.digest('SHA-256', data);
        const hashArray = Array.from(new Uint8Array(hashBuffer));
        const authKey = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');

        // Host Mode
        if (tabCreate && tabCreate.classList.contains('active')) {
            if (window.electronAPI?.startHost) {
                try {
                    const submitBtn = document.getElementById('login-submit');
                    if (submitBtn) submitBtn.textContent = window.i18n ? window.i18n.t('connecting') : 'Bağlantı Kuruluyor...';
                    const tunnelUrl = await window.electronAPI.startHost();
                    serverUrl = await window.electronAPI.getLocalServerUrl();

                    localStorage.setItem('haven_server_url', serverUrl);
                    localStorage.setItem('haven_nickname', nickname);
                    localStorage.setItem('haven_room', room);
                    localStorage.setItem('haven_avatar', inputColor.value);
                    sessionStorage.setItem('haven_session_password', passwordMatch);
                    localStorage.setItem('haven_auth_key', authKey);
                    localStorage.setItem('haven_join_mode', 'create');

                    if (savedProfilePic) localStorage.setItem('haven_profile_pic', savedProfilePic);
                    else localStorage.removeItem('haven_profile_pic');

                    // Davet modalını göster
                    const inviteServerEl = document.getElementById('invite-server') as HTMLInputElement | null;
                    const inviteRoomEl = document.getElementById('invite-room') as HTMLInputElement | null;
                    const invitePasswordEl = document.getElementById('invite-password') as HTMLInputElement | null;
                    if (inviteServerEl) inviteServerEl.value = tunnelUrl;
                    if (inviteRoomEl) inviteRoomEl.value = room;
                    if (invitePasswordEl) invitePasswordEl.value = passwordMatch;

                    const inviteModal = document.getElementById('invite-modal') as HTMLElement | null;
                    if (inviteModal) {
                        inviteModal.style.display = 'flex';
                        setTimeout(() => inviteModal.style.opacity = '1', 10);

                        await new Promise<void>(resolve => {
                            document.getElementById('btn-start-chat')!.onclick = () => {
                                inviteModal.style.opacity = '0';
                                setTimeout(() => { inviteModal.style.display = 'none'; resolve(); }, 300);
                            };
                        });
                    }

                    if (submitBtn) submitBtn.textContent = 'Oda Kur';

                    if (window.electronAPI?.navigateToChat) window.electronAPI.navigateToChat();
                    else window.location.href = 'chat.html';
                    return;
                } catch (err) {
                    const error = err as Error;
                    showError("Sunucu başlatılamadı: " + error.message);
                    const submitBtn = document.getElementById('login-submit');
                    if (submitBtn) submitBtn.textContent = 'Oda Kur';
                    return;
                }
            } else {
                showError("Oda kurma özelliği sadece masaüstü uygulamasında etkindir.");
                return;
            }
        }

        // Client Mode — bilgileri sakla
        localStorage.setItem('haven_server_url', serverUrl);
        localStorage.setItem('haven_nickname', nickname);
        localStorage.setItem('haven_room', room);
        localStorage.setItem('haven_avatar', inputColor.value);
        sessionStorage.setItem('haven_session_password', passwordMatch);
        localStorage.setItem('haven_auth_key', authKey);
        localStorage.setItem('haven_join_mode', 'join');

        if (savedProfilePic) localStorage.setItem('haven_profile_pic', savedProfilePic);
        else localStorage.removeItem('haven_profile_pic');

        const submitBtn = document.getElementById('login-submit') as HTMLButtonElement | null;
        if (submitBtn) {
            submitBtn.disabled = true;
            submitBtn.textContent = window.i18n ? window.i18n.t('loading') : 'Yükleniyor...';
        }

        if (window.electronAPI?.navigateToChat) window.electronAPI.navigateToChat();
        else window.location.href = 'chat.html';
    });

    // ── Clipboard Copy ──

    const copyToClipboard = async (text: string, btn: HTMLElement): Promise<void> => {
        try {
            if (window.electronAPI?.writeToClipboard) {
                await window.electronAPI.writeToClipboard(text);
            } else {
                await navigator.clipboard.writeText(text);
            }

            const hasLangKey = btn.hasAttribute('data-lang-key');
            const originalLangKey = btn.getAttribute('data-lang-key');
            if (hasLangKey) btn.removeAttribute('data-lang-key');

            const originalText = btn.textContent;
            btn.textContent = window.i18n
                ? window.i18n.t('toast_copied') || window.i18n.t('btn_copied') || 'Kopyalandı!'
                : 'Kopyalandı!';

            setTimeout(() => {
                btn.textContent = originalText;
                if (hasLangKey && originalLangKey) btn.setAttribute('data-lang-key', originalLangKey);
            }, 2000);
        } catch (err) {
            console.error('Panoya kopyalanamadı:', err);
        }
    };

    const btnCopyServer = document.getElementById('btn-copy-server');
    if (btnCopyServer) {
        btnCopyServer.addEventListener('click', () => {
            const el = document.getElementById('invite-server') as HTMLInputElement | null;
            if (el) copyToClipboard(el.value, btnCopyServer);
        });
        document.getElementById('btn-copy-room')?.addEventListener('click', () => {
            const el = document.getElementById('invite-room') as HTMLInputElement | null;
            const btn = document.getElementById('btn-copy-room');
            if (el && btn) copyToClipboard(el.value, btn);
        });
        document.getElementById('btn-copy-password')?.addEventListener('click', () => {
            const el = document.getElementById('invite-password') as HTMLInputElement | null;
            const btn = document.getElementById('btn-copy-password');
            if (el && btn) copyToClipboard(el.value, btn);
        });

        const btnCopyAll = document.getElementById('btn-copy-all');
        btnCopyAll?.addEventListener('click', () => {
            const serverVal = (document.getElementById('invite-server') as HTMLInputElement | null)?.value || '';
            const roomVal = (document.getElementById('invite-room') as HTMLInputElement | null)?.value || '';

            const cleanUrl = serverVal.endsWith('/') ? serverVal.slice(0, -1) : serverVal;
            const inviteLink = `${cleanUrl}/?room=${encodeURIComponent(roomVal)}`;

            const inviteText = `Haven Gizli Oda Daveti!\n\n🚀 Oda bağlantısı:\n${inviteLink}\n\nOda Anahtarı: ${roomVal}\n\n⚠️ Şifreyi bu mesajla birlikte göndermeyin.\nŞifreyi ayrı bir kanaldan (SMS vb.) paylaşın.`;
            copyToClipboard(inviteText, btnCopyAll!);
        });
    }

    // ── Hata Göster ──

    function showError(message: string): void {
        if (!errorMsg) return;
        errorMsg.textContent = message;
        errorMsg.style.display = 'block';
        setTimeout(() => { errorMsg.style.display = 'none'; }, 5000);
    }

    // ── Arka plan animasyonu ──

    const bgLines = document.querySelector('.soft-bg-lines') as HTMLElement | null;
    if (bgLines) {
        let targetX = window.innerWidth / 2;
        let targetY = window.innerHeight / 2;
        let currentX = targetX;
        let currentY = targetY;

        bgLines.style.opacity = '0.4';

        document.addEventListener('mousemove', (e: MouseEvent) => {
            targetX = e.clientX;
            targetY = e.clientY;
        });

        function animateBg(): void {
            if (Math.abs(targetX - currentX) > 0.5 || Math.abs(targetY - currentY) > 0.5) {
                currentX += (targetX - currentX) * 0.1;
                currentY += (targetY - currentY) * 0.1;

                const maskStr = `radial-gradient(circle 800px at ${currentX}px ${currentY}px, black 0%, transparent 80%)`;
                bgLines!.style.maskImage = maskStr;
                (bgLines as any).style.webkitMaskImage = maskStr;
            }
            requestAnimationFrame(animateBg);
        }
        animateBg();
    }
});
