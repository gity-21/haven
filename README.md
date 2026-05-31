# Haven: Private P2P Voice & Text Chat

Haven, tam gizlilik odaklı, sıfır kayıt mantığıyla çalışan premium bir masaüstü sohbet uygulamasıdır. Klasik mesajlaşma uygulamalarından farklı olarak hesap açmanız, telefon numaranızı veya e-postanızı paylaşmanız gerekmez. Sadece oda adınızı yazın, kilit şifresini belirleyin ve güvenli izolasyon odanızda sohbete başlayın.

---

## 👥 Takım

| GitHub | Rol |
|--------|------|
| [@mehmetsolves](https://github.com/mehmetsolves) | Geliştirici |
| [@Taruk21](https://github.com/Taruk21) | Geliştirici |
| [@emresosuke](https://github.com/emresosuke) | Geliştirici |

---

## 🚀 Öne Çıkan Özellikler

- **🔐 Oda Tabanlı Anonimlik & Uçtan Uca Şifreleme (E2EE)**: Hesap açma yoktur. Kullanıcıların mesajları, görselleri ve P2P transfer anonsları AES-GCM ile odanın şifresi kullanılarak cihazda (istemcide) şifrelenir. Sunucu hiçbir zaman mesajların açık halini göremez veya okuyamaz.
- **🎙️ P2P Sesli ve Görüntülü İletişim**: WebRTC protokolü ile sunucuyu yormayan, gecikmesiz ve yüksek kaliteli P2P sesli ve görüntülü görüşmeler yapın.
- **🖥️ P2P Ekran Paylaşımı**: Toplantılarınızı veya kod incelemelerinizi WebRTC tabanlı düşük gecikmeli ekran paylaşımı (pencere veya tüm ekran seçimi) ile gerçekleştirin.
- **⚡ Şifreli P2P Büyük Dosya Transferi**: Dosyalarınız sunucuya yüklenmeden, doğrudan gönderici ile alıcı arasında (P2P), WebRTC veri kanalları (DataChannels) kullanılarak şifreli ve limitsiz boyutta aktarılır.
- **🔊 Sesli Mesajlar ve Görseller**: Normal mesajların yanı sıra ses kayıtları, görseller ve diğer dokümanları paylaşabilirsiniz.
- **🌙 Premium & Dinamik Arayüz**: Klasik "Space", yeşil terminal "Hacker" veya modern "Antigravity" (Beyaz) temalarından birini seçebilirsiniz. Gelişmiş CSS ile akıcı animasyonlar barındırır.
- **🌍 Çoklu Dil Desteği (i18n)**: Türkçe, İngilizce (English) ve Kürtçe (Kurdî) dillerini destekler. Dil anında değiştirilebilir.
- **🌐 Dahili Cloudflare Tunnel**: Uygulama başlatıldığında `start.sh` veya `start_windows.bat` betikleri otomatik olarak Cloudflare Tunnel açar. Modemden port açmanıza gerek kalmadan uygulamanıza internet üzerinden güvenle erişilebilir.
- **🎨 Kişiselleştirme**: Takma ad, avatar rengi ve profil fotoğrafı desteklenir.

## 🔧 Kurulum ve Çalıştırma

### Gereksinimler
- **Node.js**: [https://nodejs.org](https://nodejs.org) (v18+)
- Proje klasörüne gidin ve şu komutu çalıştırarak bağımlılıkları kurun:
  ```bash
  npm install
  ```

### Geliştirici Modunda (Local) Çalıştırma
```bash
npm run dev
```

### Normal Çalıştırma (Tünel ile Birlikte)
Birlikte gelen betikler (scriptler), Node.js sunucusunu çalıştırır, Cloudflare Tunnel ile internete çıkartır ve ardından Electron uygulamasını tünel adresiyle başlatır.

**Windows için:**
Projeyi klasöründe bulunan `start_windows.bat` dosyasına çift tıklayın.

**Linux / macOS için:**
```bash
bash start.sh
```

### 📦 Bağımsız Kurulum Dosyası (Exe) Oluşturma
Projeyi arkadaşlarınızla paylaşmak için tek tıklamayla kurulabilen (NSIS Builder) `.exe` veya Linux paketlerini derleyebilirsiniz.

Windows için (.exe) çıktı almak:
```bash
npm run build:win
```
*(Sonuç dosyası `dist/` klasörü içerisinde `Haven Setup 1.0.0.exe` olarak belirecektir.)*

## 🔒 Güvenlik Notu

- Tüm mesajlar AES-GCM ile şifrelendiğinden, veritabanını (SQLite) biri ele geçirse bile odaya ait Private Key (Oda Şifresi) olmadan mesajları çözemez.
- Odaya ilk giren kişi odanın yöneticisi sayılır ve odaya bir şifre atar. Sonradan gelenler şifreyi bilmeden odaya bağlanamaz ve anahtarları olmadığı için gönderilen mesajları okuyamaz.
- Tüm `Electron` istemci tarafı kodları Release alındığında (Build) `ASAR` arşivi içine gizlenir.
- SQLite sunucu tabanlı mesaj yedekleri uçtan uca şifreli halde tutulur.

## 🛠️ Teknolojiler
- **İstemci (Desktop)**: Electron.js, Vanilla JS, HTML, CSS (Glassmorphism)
- **Sunucu (Backend)**: Node.js, Express.js, Socket.IO
- **Gerçek Zamanlı İletişim**: WebRTC (Ses, Video, Ekran Paylaşımı, Dosya Transferi)
- **Ağ / Tünelleme**: Cloudflare Tunnel (TryCloudflare)
- **Kriptografi**: İstemci tarafında Web Crypto API (AES-GCM), Sunucuda Bcrypt

## 🗺️ Yol Haritası (Gelecek Planları)
- **Gelişmiş Sohbet Deneyimi:** Mesaj yanıtlama, emoji tepkileri (reactions) ve Markdown desteği.
- **Sürükle & Bırak:** Dosyaları doğrudan sohbet penceresine sürükleyerek P2P transferi başlatma.
- **Güvenlik Artırımı:** Görüldükten sonra kendini imha eden mesajlar ve MITM saldırılarına karşı anahtar (fingerprint) doğrulama.
- **Kişiselleştirme:** Arama ekranlarında mikrofon/kamera cihaz seçimi ve arka plan bulanıklaştırma.
- **DevOps:** Electron otomatik güncelleme (auto-updater) entegrasyonu.

---
**GITY Team** tarafından <3 ile geliştirilmiştir.
