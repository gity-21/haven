/**
 * login.js - Giriş Ekranı ve Karşılama Arayüzü Yönetimi
 *
 * Neler Var:
 * - Uygulama açıldığında kullanıcıyı karşılayan giriş ekranının kontrolcüsüdür.
 * - "Ağ Kur" (Host Mode) ve "Bağlan" (Client Mode) sekmeleri arasındaki geçişleri yönetir.
 * - Kullanıcı adı, avatar fotoğrafı (Base64) ve renk seçimlerini alır, localStorage'da saklar.
 * - Ses ve mikrofon testi için ayarlar menüsünü idare eder. (Kamera/Mikrofon donanımlarını listeler ve test ettirir).
 * - Oda şifreisni SHA-256 ile hash'leyerek sunucuya girebilmek için doğrulama anahtarı (authKey) oluşturur.
 * 
 * Ayarlar / Depolanan Veriler:
 * - dc_profile_pic, dc_server_url, dc_nickname, dc_room, dc_avatar, dc_login_theme, dc_room_password
 */

window.showAlertModal = function (message, title = 'Uyarı') {
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

        titleEl.textContent = title;
        messageEl.textContent = message;
        modal.style.display = 'flex';

        const cleanup = () => {
            modal.style.display = 'none';
            btnOk.removeEventListener('click', handleOk);
        };
        const handleOk = () => { cleanup(); resolve(); };
        btnOk.addEventListener('click', handleOk);
    });
};

document.addEventListener('DOMContentLoaded', () => {

    const form = document.getElementById('form-login');
    const inputServer = document.getElementById('login-server');
    const inputUsername = document.getElementById('login-username');
    const inputRoom = document.getElementById('login-room');
    const inputPassword = document.getElementById('login-password');
    const inputColor = document.getElementById('login-avatar-color');
    const colorPickerContainer = document.getElementById('color-picker');
    const colorPreviewText = document.getElementById('color-preview-text');
    const errorMsg = document.getElementById('login-error');

    const avatarUpload = document.getElementById('login-avatar-upload');
    const avatarPreviewImg = document.getElementById('avatar-preview-img');
    const avatarUploadIcon = document.getElementById('avatar-upload-icon');

    // UI Elements
    const btnSettings = document.getElementById('btn-settings');
    const settingsModal = document.getElementById('settings-modal');
    const btnCloseSettings = document.getElementById('btn-close-settings');
    const btnSaveSettings = document.getElementById('btn-save-settings');
    const tabCreate = document.getElementById('tab-create');
    const tabJoin = document.getElementById('tab-join');

    // Kayıtlı verileri yükle
    let savedProfilePic = localStorage.getItem('dc_profile_pic') || null;
    let savedServer = localStorage.getItem('dc_server_url') || 'http://localhost:3847';
    let savedUsername = localStorage.getItem('dc_nickname') || '';
    let savedRoom = localStorage.getItem('dc_room') || '';
    let savedColor = localStorage.getItem('dc_avatar') || '#6366f1';

    // Tek tıkla davet linkinden parametreleri al (Sihirli Link özelliği)
    const urlParams = new URLSearchParams(window.location.search);
    let invitePass = '';
    if (urlParams.has('room')) savedRoom = urlParams.get('room');
    if (urlParams.has('pass')) invitePass = urlParams.get('pass');
    if (urlParams.has('name')) savedUsername = urlParams.get('name');

    // Tema verisini yükle
    const savedTheme = localStorage.getItem('dc_login_theme') || 'space';
    const loginThemeSelect = document.getElementById('login-theme-select');
    if (loginThemeSelect) {
        loginThemeSelect.value = savedTheme;
    }
    document.documentElement.setAttribute('data-theme', savedTheme);

    // Eski Cloudflare tünel URL'si temizle (artık geçersizdir, her oturumda değişir)
    if (savedServer.includes('trycloudflare.com') || savedServer.includes('ngrok') || savedServer.includes('loca.lt')) {
        savedServer = 'http://localhost:3847';
        localStorage.setItem('dc_server_url', savedServer);
    }

    // Nickname kalıcı olsun: ilk açılışta bir kez random üret ve sakla
    let defaultName = localStorage.getItem('dc_nickname');
    if (!defaultName) {
        defaultName = `Kullanıcı_${Math.floor(1000 + Math.random() * 9000)}`;
        localStorage.setItem('dc_nickname', defaultName);
    }

    const loginError = localStorage.getItem('dc_login_error');
    if (loginError) {
        localStorage.removeItem('dc_login_error');
        setTimeout(() => {
            window.showAlertModal(loginError, 'Bölgeye Erişim Reddedildi');
        }, 150);
    }

    inputServer.value = savedServer;
    inputUsername.value = savedUsername || defaultName;
    inputRoom.value = savedRoom;
    if (invitePass) inputPassword.value = invitePass;
    inputColor.value = savedColor;

    if (urlParams.has('room') && tabJoin) {
        // Parametreleri temizle (Sayfa veya electron yenilemelerinde eski parametrede takılı kalmaması için)
        window.history.replaceState({}, document.title, window.location.pathname);
        setTimeout(() => tabJoin.click(), 50);
    }

    if (savedProfilePic) {
        avatarPreviewImg.src = savedProfilePic;
        avatarPreviewImg.style.display = 'block';
        avatarUploadIcon.style.display = 'none';
    }

    if (colorPreviewText) {
        colorPreviewText.textContent = savedUsername || 'Örnek Kullanıcı';
        colorPreviewText.style.color = savedColor;
    }

    inputUsername.addEventListener('input', (e) => {
        if (colorPreviewText) {
            colorPreviewText.textContent = e.target.value.trim() || 'Örnek Kullanıcı';
        }
    });

    // Renkleri oluştur
    const colors = ['#6366f1', '#ef4444', '#10b981', '#f59e0b', '#0ea5e9', '#ec4899', '#8b5cf6', '#14b8a6'];
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
            // Seçili rengi güncelle
            Array.from(colorPickerContainer.children).forEach(c => {
                c.style.border = '2px solid transparent';
                c.style.boxShadow = 'none';
            });
            btn.style.border = '2px solid white';
            btn.style.boxShadow = `0 0 10px ${color}80`;
            inputColor.value = color;
            if (colorPreviewText) {
                colorPreviewText.style.color = color;
            }
        };

        colorPickerContainer.appendChild(btn);
    });

    if (avatarUpload) {
        avatarUpload.addEventListener('change', (e) => {
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
                        if (width > MAX_WIDTH) {
                            height *= MAX_WIDTH / width;
                            width = MAX_WIDTH;
                        }
                    } else {
                        if (height > MAX_HEIGHT) {
                            width *= MAX_HEIGHT / height;
                            height = MAX_HEIGHT;
                        }
                    }
                    canvas.width = width;
                    canvas.height = height;
                    const ctx = canvas.getContext('2d');
                    ctx.drawImage(img, 0, 0, width, height);

                    const dataUrl = canvas.toDataURL('image/jpeg', 0.8);
                    savedProfilePic = dataUrl;

                    avatarPreviewImg.src = dataUrl;
                    avatarPreviewImg.style.display = 'block';
                    if (avatarUploadIcon) avatarUploadIcon.style.display = 'none';
                };
                img.src = evt.target.result;
            };
            reader.readAsDataURL(file);
        });
    }

    // Electron'da lokal sunucu URL'sini otomatik al ve güncelle
    if (window.electronAPI && window.electronAPI.getLocalServerUrl) {
        window.electronAPI.getLocalServerUrl().then((localUrl) => {
            if (localUrl) {
                inputServer.value = localUrl;
                // localStorage'ı da güncelle
                localStorage.setItem('dc_server_url', localUrl);
                console.log('[Login] Lokal sunucu URL güncellendi:', localUrl);
            }
        }).catch(err => console.error('Lokal sunucu URL alınamadı:', err));
    }

    // Electron'da Cloudflare Tunnel URL'sini otomatik doldur (eski, artık kullanılmıyor ama yedek)
    if (window.electronAPI && window.electronAPI.getTunnelUrl) {
        window.electronAPI.getTunnelUrl().then((tunnelUrl) => {
            if (tunnelUrl) {
                inputServer.value = tunnelUrl;
                console.log('[Login] Cloudflare Tunnel URL otomatik dolduruldu:', tunnelUrl);
            }
        }).catch(err => console.error('Tunnel URL okuma hatası:', err));
    }

    // Window controls (Electron)
    if (window.electronAPI) {
        document.getElementById('btn-minimize')?.addEventListener('click', () => window.electronAPI.minimizeWindow());
        document.getElementById('btn-maximize')?.addEventListener('click', () => window.electronAPI.maximizeWindow());
        document.getElementById('btn-close')?.addEventListener('click', () => window.electronAPI.closeWindow());
    } else {
        const titlebar = document.querySelector('.titlebar');
        if (titlebar) {
            titlebar.style.display = 'none'; // Web ise gizle
        }
    }

    // Settings Modal
    if (btnSettings && settingsModal) {
        // ===== SEKME GEÇİŞ MANTIĞI =====
        let loginMicTestStream = null;
        let loginMicTestAnimFrame = null;

        const loginSettingsTabs = document.querySelectorAll('.login-settings-tab');
        const loginSettingsPanels = document.querySelectorAll('.login-settings-panel');

        loginSettingsTabs.forEach(tab => {
            tab.addEventListener('click', () => {
                // Hızlı geçiş için stil güncellemelerini CSS'e devrettik
                loginSettingsTabs.forEach(t => {
                    t.classList.remove('active');
                    t.style.removeProperty('background');
                    t.style.removeProperty('color');
                });
                tab.classList.add('active');

                const tabName = tab.dataset.tab;

                // Panele geçiş yapılması
                loginSettingsPanels.forEach(p => {
                    p.style.display = 'none';
                });

                const panel = document.getElementById(`login-panel-${tabName}`);
                if (panel) {
                    panel.style.display = 'block';
                }

                if (tabName === 'ses') loginLoadAudioDevices();
                if (tabName !== 'ses') loginStopMicTest();
            });
        });

        // ===== SES AYGITI LİSTELEME =====
        async function loginLoadAudioDevices() {
            try {
                let devices = await navigator.mediaDevices.enumerateDevices();
                const needsPermission = devices.some(d => d.kind === 'audioinput' && d.label === '');

                if (needsPermission) {
                    const tempStream = await navigator.mediaDevices.getUserMedia({ audio: true });
                    tempStream.getTracks().forEach(t => t.stop());
                    devices = await navigator.mediaDevices.enumerateDevices();
                }

                const micSelect = document.getElementById('login-mic-select');
                const speakerSelect = document.getElementById('login-speaker-select');

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
                    const savedMic = localStorage.getItem('dc_mic_device');
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
                    const savedSpeaker = localStorage.getItem('dc_speaker_device');
                    if (savedSpeaker) speakerSelect.value = savedSpeaker;
                }
            } catch (err) {
                console.error('Ses cihazları yüklenemedi:', err);
                const micSelect = document.getElementById('login-mic-select');
                if (micSelect) micSelect.innerHTML = '<option value="">Erişim reddedildi</option>';
            }
        }

        // ===== MİKROFON TESTİ =====
        function loginStopMicTest() {
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
            if (bar) bar.style.width = '0%';
            const btn = document.getElementById('login-btn-test-mic');
            if (btn) btn.textContent = '🎙️ Mikrofonu Test Et';
        }

        const loginBtnTestMic = document.getElementById('login-btn-test-mic');
        if (loginBtnTestMic) {
            loginBtnTestMic.addEventListener('click', async () => {
                if (loginMicTestStream) { loginStopMicTest(); return; }

                const micSelect = document.getElementById('login-mic-select');
                const deviceId = micSelect?.value || undefined;

                try {
                    const constraints = { audio: deviceId ? { deviceId: { exact: deviceId } } : true };
                    loginMicTestStream = await navigator.mediaDevices.getUserMedia(constraints);

                    loginBtnTestMic.textContent = '⏹️ Testi Durdur';
                    const container = document.getElementById('login-mic-level-container');
                    const bar = document.getElementById('login-mic-level-bar');
                    if (container) container.style.display = 'block';

                    const testCtx = new (window.AudioContext || window.webkitAudioContext)();
                    const source = testCtx.createMediaStreamSource(loginMicTestStream);
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
                        loginMicTestAnimFrame = requestAnimationFrame(updateBar);
                    }
                    updateBar();
                } catch (err) {
                    await window.showAlertModal('Mikrofon erişilemedi: ' + err.message);
                }
            });
        }

        // ===== HOPARLÖR TESTİ =====
        const loginBtnTestSpeaker = document.getElementById('login-btn-test-speaker');
        if (loginBtnTestSpeaker) {
            loginBtnTestSpeaker.addEventListener('click', () => {
                const speakerSelect = document.getElementById('login-speaker-select');
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
            });
        }

        // ===== AYARLAR MODALINI AÇMA =====
        btnSettings.addEventListener('click', () => {
            // İlk sekmeyi aktif yap
            loginSettingsTabs.forEach(t => {
                t.classList.remove('active');
                t.style.removeProperty('background');
                t.style.removeProperty('color');
            });
            loginSettingsPanels.forEach(p => p.style.display = 'none');
            const firstTab = document.querySelector('.login-settings-tab[data-tab="profil"]');
            const firstPanel = document.getElementById('login-panel-profil');
            if (firstTab) { firstTab.classList.add('active'); }
            if (firstPanel) firstPanel.style.display = 'block';

            settingsModal.style.display = 'flex';
            setTimeout(() => settingsModal.style.opacity = '1', 10);
        });

        const closeSettings = () => {
            loginStopMicTest();
            settingsModal.style.opacity = '0';
            setTimeout(() => settingsModal.style.display = 'none', 300);
        };

        btnCloseSettings.addEventListener('click', closeSettings);
        btnSaveSettings.addEventListener('click', () => {
            // Tema
            if (loginThemeSelect) {
                const selectedTheme = loginThemeSelect.value;
                document.documentElement.setAttribute('data-theme', selectedTheme);
                localStorage.setItem('dc_login_theme', selectedTheme);
            }

            // Ses cihaz tercihlerini kaydet
            const micSelect = document.getElementById('login-mic-select');
            const speakerSelect = document.getElementById('login-speaker-select');
            if (micSelect?.value) localStorage.setItem('dc_mic_device', micSelect.value);
            if (speakerSelect?.value) localStorage.setItem('dc_speaker_device', speakerSelect.value);

            closeSettings();
        });

        settingsModal.addEventListener('click', (e) => {
            if (e.target === settingsModal) {
                closeSettings();
            }
        });
    }

    if (loginThemeSelect) {
        loginThemeSelect.addEventListener('change', (e) => {
            document.documentElement.setAttribute('data-theme', e.target.value);
        });
    }

    const serverGroup = document.getElementById('server-group');

    // Tabs
    if (tabCreate && tabJoin) {
        tabCreate.addEventListener('click', () => {
            tabCreate.classList.add('active');
            tabJoin.classList.remove('active');
            document.getElementById('login-submit').textContent = 'Ağ Kur';
            inputRoom.placeholder = 'Yeni uçtan uca şifreli ağ bağlamı oluşturun';
            if (serverGroup) serverGroup.style.display = 'none';
        });
        tabJoin.addEventListener('click', () => {
            tabJoin.classList.add('active');
            tabCreate.classList.remove('active');
            document.getElementById('login-submit').textContent = 'Bağlan';
            inputRoom.placeholder = 'Kriptografik erişim odası anahtarı';
            if (serverGroup) serverGroup.style.display = 'block';
        });
    }

    form.addEventListener('submit', async (e) => {
        e.preventDefault();

        const isWeb = window.location.protocol === 'http:' || window.location.protocol === 'https:';
        let serverUrl = isWeb ? window.location.origin : (inputServer.value.trim() || 'http://localhost:3847');
        const nickname = inputUsername.value.trim() || `Kullanıcı_${Math.floor(1000 + Math.random() * 9000)}`;
        const room = inputRoom.value.trim().toLowerCase(); // Odalar k.harf
        const passwordMatch = inputPassword.value.trim();

        if (!room || !passwordMatch) {
            showError("Lütfen oda anahtarı ve şifreyi girin.");
            return;
        }

        // Parolayı (sunucu için) SHA-256 ile Hashle (Sunucu düz parolayı asla bilmeyecek)
        const encoder = new TextEncoder();
        const data = encoder.encode(passwordMatch);
        const hashBuffer = await crypto.subtle.digest('SHA-256', data);
        const hashArray = Array.from(new Uint8Array(hashBuffer));
        const authKey = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');

        // Host Mode Execution
        if (tabCreate && tabCreate.classList.contains('active')) {
            if (window.electronAPI && window.electronAPI.startHost) {
                try {
                    document.getElementById('login-submit').textContent = 'Bağlantı Kuruluyor...';
                    const tunnelUrl = await window.electronAPI.startHost();
                    serverUrl = await window.electronAPI.getLocalServerUrl(); // Host, kendi sunucusuna localhost üzerinden bağlanır

                    // Bilgileri sakla
                    localStorage.setItem('dc_server_url', serverUrl);
                    localStorage.setItem('dc_nickname', nickname);
                    localStorage.setItem('dc_room', room);
                    localStorage.setItem('dc_avatar', inputColor.value);
                    localStorage.setItem('dc_room_password', passwordMatch); // E2EE için bellek
                    localStorage.setItem('dc_auth_key', authKey); // Sunucuya girebilmek için
                    localStorage.setItem('dc_join_mode', 'create'); // Oda oluşturma modu

                    if (savedProfilePic) {
                        localStorage.setItem('dc_profile_pic', savedProfilePic);
                    } else {
                        localStorage.removeItem('dc_profile_pic');
                    }

                    // Modal üzerinden bilgileri göster
                    document.getElementById('invite-server').value = tunnelUrl;
                    document.getElementById('invite-room').value = room;
                    document.getElementById('invite-password').value = passwordMatch;

                    const inviteModal = document.getElementById('invite-modal');
                    inviteModal.style.display = 'flex';
                    setTimeout(() => inviteModal.style.opacity = '1', 10);

                    // Sohbet geçişini bekletmek için bir promise oluştur
                    await new Promise(resolve => {
                        document.getElementById('btn-start-chat').onclick = () => {
                            inviteModal.style.opacity = '0';
                            setTimeout(() => {
                                inviteModal.style.display = 'none';
                                resolve();
                            }, 300);
                        };
                    });

                    document.getElementById('login-submit').textContent = 'Oda Kur';

                    // Promise çözüldüğünde (Sohbete Geç tıklandığında) yönlendir
                    if (window.electronAPI && window.electronAPI.navigateToChat) {
                        window.electronAPI.navigateToChat();
                    } else {
                        window.location.href = 'chat.html';
                    }
                    return; // "Odaya Katıl" sekmesinin geri kalan kodunu atla
                } catch (err) {
                    showError("Sunucu başlatılamadı: " + err.message);
                    document.getElementById('login-submit').textContent = 'Oda Kur';
                    return;
                }
            } else {
                showError("Oda kurma özelliği sadece masaüstü uygulamasında etkindir.");
                return;
            }
        }

        // Bilgileri sakla
        localStorage.setItem('dc_server_url', serverUrl);
        localStorage.setItem('dc_nickname', nickname);
        localStorage.setItem('dc_room', room);
        localStorage.setItem('dc_avatar', inputColor.value);
        localStorage.setItem('dc_room_password', passwordMatch); // E2EE için bellek
        localStorage.setItem('dc_auth_key', authKey); // Sunucuya girebilmek için
        localStorage.setItem('dc_join_mode', 'join'); // Mevcut odaya katılma modu

        if (savedProfilePic) {
            localStorage.setItem('dc_profile_pic', savedProfilePic);
        } else {
            localStorage.removeItem('dc_profile_pic');
        }

        const submitBtn = document.getElementById('login-submit');
        if (submitBtn) {
            submitBtn.disabled = true;
            submitBtn.textContent = 'Yükleniyor...';
        }

        // Sohbet ekranına yönlendir (Electron IPC veya tarayıcı)
        if (window.electronAPI && window.electronAPI.navigateToChat) {
            window.electronAPI.navigateToChat();
        } else {
            window.location.href = 'chat.html';
        }
    });

    const copyToClipboard = (text, btn) => {
        navigator.clipboard.writeText(text).then(() => {
            const originalText = btn.textContent;
            btn.textContent = 'Kopyalandı!';
            setTimeout(() => btn.textContent = originalText, 2000);
        });
    };

    const btnCopyServer = document.getElementById('btn-copy-server');
    if (btnCopyServer) {
        btnCopyServer.addEventListener('click', () => copyToClipboard(document.getElementById('invite-server').value, btnCopyServer));
        document.getElementById('btn-copy-room').addEventListener('click', () => copyToClipboard(document.getElementById('invite-room').value, document.getElementById('btn-copy-room')));
        document.getElementById('btn-copy-password').addEventListener('click', () => copyToClipboard(document.getElementById('invite-password').value, document.getElementById('btn-copy-password')));

        const btnCopyAll = document.getElementById('btn-copy-all');
        btnCopyAll.addEventListener('click', () => {
            const serverVal = document.getElementById('invite-server').value;
            const roomVal = document.getElementById('invite-room').value;
            const passVal = document.getElementById('invite-password').value;

            const cleanUrl = serverVal.endsWith('/') ? serverVal.slice(0, -1) : serverVal;
            const inviteLink = `${cleanUrl}/?room=${encodeURIComponent(roomVal)}&pass=${encodeURIComponent(passVal)}`;

            const inviteText = `Haven Gizli Oda Daveti!\n\n🚀 Tek tıkla katılmak için linke tıkla:\n${inviteLink}\n\nManuel Katılım:\nOda Anahtarı: ${roomVal}\nŞifre: ${passVal}`;
            copyToClipboard(inviteText, btnCopyAll);
        });
    }

    function showError(message) {
        errorMsg.textContent = message;
        errorMsg.style.display = 'block';
        setTimeout(() => {
            errorMsg.style.display = 'none';
        }, 5000);
    }

    // Kareli arkaplan animasyonu (İmlecin etrafında parlama efekti)
    const bgLines = document.querySelector('.soft-bg-lines');
    if (bgLines) {
        let targetX = window.innerWidth / 2;
        let targetY = window.innerHeight / 2;
        let currentX = targetX;
        let currentY = targetY;

        // Parlaklığı biraz artır
        bgLines.style.opacity = '0.4';

        document.addEventListener('mousemove', (e) => {
            targetX = e.clientX;
            targetY = e.clientY;
        });

        function animateBg() {
            if (Math.abs(targetX - currentX) > 0.5 || Math.abs(targetY - currentY) > 0.5) {
                // Yumuşak geçiş (easing)
                currentX += (targetX - currentX) * 0.1;
                currentY += (targetY - currentY) * 0.1;

                // Maskeyi güncelleyerek kareleri sadece imleç etrafında görünür yap (Yarıçapı büyüttük)
                const maskStr = `radial-gradient(circle 800px at ${currentX}px ${currentY}px, black 0%, transparent 80%)`;
                bgLines.style.maskImage = maskStr;
                bgLines.style.webkitMaskImage = maskStr;
            }
            requestAnimationFrame(animateBg);
        }
        animateBg();
    }
});
