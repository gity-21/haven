# Haven — Gizlilik Odaklı P2P Sesli & Yazılı Sohbet

Haven, kayıt tutmayan, hesap gerektirmeyen bir masaüstü sohbet uygulaması. Klasik mesajlaşma uygulamalarının aksine telefon numarası ya da e-posta istemiyoruz: bir oda adı seçip şifresini belirliyorsunuz, o kadar.

## Takım

| GitHub | Rol |
|--------|------|
| [@mehmetsolves](https://github.com/mehmetsolves) | Geliştirici |
| [@Taruk21](https://github.com/Taruk21) | Geliştirici |
| [@emresosuke](https://github.com/emresosuke) | Geliştirici |

## Özellikler

**Oda tabanlı anonimlik ve uçtan uca şifreleme.** Hesap yok. Mesajlar, görseller ve P2P transfer bildirimleri odanın şifresiyle istemci tarafında AES-GCM ile şifrelenir; sunucu hiçbir zaman açık metni görmez.

**P2P sesli/görüntülü görüşme.** WebRTC üzerinden, sunucuyu yormadan düşük gecikmeli görüşme. Ses tarafı 384 kbps stereo'ya çıkarıldı ve gürültü engelleme (noise gate) eklendi.

**P2P ekran paylaşımı.** Pencere veya tüm ekran seçimiyle, WebRTC tabanlı düşük gecikmeli paylaşım — kod incelemesi ya da toplantı için kullanışlı.

**Şifreli P2P dosya transferi.** Dosyalar sunucuya hiç uğramadan, WebRTC veri kanalları üzerinden doğrudan gönderenden alıcıya, boyut sınırı olmadan aktarılır.

**Sesli mesaj ve görsel paylaşımı**, normal metin mesajlarına ek olarak.

**Otomatik güncelleme.** Uygulama açılışta arka planda GitHub Releases üzerinden yeni sürüm kontrolü yapar, varsa indirir ve onay ister.

**Tema desteği:** Space, yeşil terminal görünümlü Hacker, ve Antigravity (beyaz).

**Çoklu dil:** Türkçe, İngilizce, Kürtçe — anında değiştirilebilir.

**Dahili Cloudflare Tunnel.** `start.sh` / `start_windows.bat` çalıştırıldığında tünel otomatik açılır; modemde port yönlendirmesi yapmadan internetten erişim sağlanır.

Ayrıca: takma ad/avatar rengi/profil fotoğrafı ile kişiselleştirme, anket oluşturma, mesaj sabitleme, `@isim` ile etiketleme, ve bir sonraki giriş için takma adı yerelde hatırlama.

## Kurulum ve Çalıştırma

### Gereksinimler
- Node.js v18+ ([nodejs.org](https://nodejs.org))

Proje klasöründe:
```bash
npm install
```

### Geliştirici modu (local)
```bash
npm run dev
```

### Normal çalıştırma (tünelle birlikte)
Bu betikler Node.js sunucusunu başlatır, Cloudflare Tunnel açar, ardından Electron uygulamasını tünel adresiyle başlatır.

**Windows:** `start_windows.bat` dosyasına çift tıklayın.

**Linux / macOS:**
```bash
bash start.sh
```

### Kurulum dosyası (exe) oluşturma
Tek tıkla kurulabilir paket için (NSIS Builder):
```bash
npm run build:win
```
Çıktı `dist/` klasöründe `Haven Setup 1.0.0.exe` olarak oluşur.

## Güvenlik Notları

- Mesajlar AES-GCM ile şifrelendiği için, SQLite veritabanı ele geçirilse bile odanın şifresi olmadan içerik okunamaz.
- Odaya ilk giren kişi oda yöneticisi sayılır ve şifreyi belirler. Şifreyi bilmeyen bağlanamaz, anahtarı olmayan gönderilen mesajları çözemez.
- Electron istemci kodu build alındığında ASAR arşivine paketlenir.
- Sunucu tarafındaki SQLite mesaj yedekleri de uçtan uca şifreli halde tutulur.

## Teknolojiler

- **İstemci:** Electron.js, TypeScript, HTML/CSS (Glassmorphism)
- **Sunucu:** Node.js, Express.js, Socket.IO
- **Gerçek zamanlı iletişim:** WebRTC (ses, video, ekran paylaşımı, dosya transferi)
- **Tünelleme:** Cloudflare Tunnel (TryCloudflare)
- **Kriptografi:** İstemcide Web Crypto API (AES-GCM), sunucuda Bcrypt

## Yol Haritası

- Mesaj yanıtlama, emoji tepkileri, Markdown desteği
- Sürükle-bırak ile dosya transferi başlatma
- Görüldükten sonra silinen mesajlar, MITM'e karşı anahtar (fingerprint) doğrulama
- Arama ekranında mikrofon/kamera seçimi, arka plan bulanıklaştırma

---
GITY Team tarafından geliştirilmiştir.
