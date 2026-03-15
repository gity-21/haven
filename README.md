# Haven: Private P2P Voice & Text Chat

Haven, Electron.js tabanlı, tamamen oda anahtarı ve uçtan uca şifreleme mantığıyla çalışan, Discord benzeri ama üyelik gerektirmeyen özel bir sohbet uygulamasıdır. Her oda izole bir evrendir; kullanıcı verisi veya mesajlar merkezi bir hesapta toplanmaz.

## 🚀 Öne Çıkan Özellikler

- **🔐 Oda Tabanlı Anonimlik**: Hesap açma yok. Oda anahtarı (Room Key) ve şifre ile anında katılın.
- **🎙️ P2P Sesli İletişim**: WebRTC protokolü ile gecikmesiz, kaliteli sesli görüşme.
- **🖼️ Medya Paylaşımı**: Resim, video ve ses dosyaları gönderebilme.
- **🌙 Premium Tasarım**: Glassmorphism, hareketli arka planlar ve neon efektlerle modern arayüz.
- **🌐 Dahili Tünel**: Cloudflare Tunnel (TryCloudflare) entegrasyonu ile port açmadan internete çıkış.
- **📱 Sesli Mesajlar**: Walkie-talkie tarzı sesli mesaj gönderme ve dalga formu tasarımı.

## 📁 Dosya Yapısı

```
dc/
├── package.json          # Proje yapılandırması ve paketler
├── app/
│   ├── main.js           # Electron Ana İşlem (Tünel ve Pencere Yönetimi)
│   ├── preload.js        # Güvenli IPC Köprüsü
│   └── renderer/         # İstemci tarafı (HTML/CSS/JS)
├── server/
│   ├── index.js          # Socket.IO + Express Sunucusu
│   ├── database.js       # SQLite Mesaj Kaydı (v2)
│   └── upload.js         # Dosya Yükleme Yönetimi
├── start_windows.bat     # Windows için Otomatik Başlatıcı
└── start.sh              # Linux için Otomatik Başlatıcı
```

## 🔧 Kurulum ve Çalıştırma

### Gereksinimler
- **Node.js**: [https://nodejs.org](https://nodejs.org) (v18+)
- **Bağımlılıklar**: Proje klasöründe `npm install` komutunu çalıştırın.

### Çalıştırma (Windows)
En kolay yol projedeki `start_windows.bat` dosyasına çift tıklamaktır. Bu script:
1. Arka planda sunucuyu başlatır.
2. Cloudflare tünelini açar ve link oluşturur.
3. Masaüstü uygulamasını otomatik olarak başlatır.

### Çalıştırma (Linux)
```bash
bash start.sh
```

## 📦 Paketleme (Build)

Uygulamayı tek bir dosya haline getirmek için:

### Windows (EXE / Portable)
```bash
npm run build:win
```
Çıktı `dist/` klasöründe oluşur.

## 🔒 Güvenlik Notu

- Tüm mesajlar veritabanında SQLite ile saklanır.
- Sunucu şifreleri `bcrypt` ile hashlenir.
- Oda şifreleri, odaya ilk giren kişi tarafından belirlenir ve odayı kilitler.
- ASAR paketleme ile uygulama kodları korunur.

## 🛠️ Teknolojiler
- **Framework**: Electron.js
- **Backend**: Node.js & Socket.io
- **DB**: SQLite (sql.js)
- **Networking**: Cloudflare Tunnel
- **UI**: Vanilla CSS (Premium Glassmorphism)

---
**DC Team** tarafından geliştirilmiştir.
