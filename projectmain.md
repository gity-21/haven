# Haven - Proje Dokümantasyonu

Haven, güvenlik ve gizliliğin ön planda tutulduğu, anonim odalar ve uçtan uca şifreleme (E2EE) tabanlı iletişim sağlayan modern bir masaüstü (Electron) uygulamasıdır.

Bu belge, uygulamanın genel mimarisini, Frontend katmanının yapısını ve şifreleme mekanizmalarının nasıl çalıştığını açıklamaktadır.

---

## 1. Frontend Mimarisi ve Yetenekleri

Uygulamanın arayüzü, modern web teknolojileri (HTML5, CSS3, Vanilla JavaScript) ile inşa edilmiş olup, Electron altyapısıyla çalışmaktadır. Herhangi bir ağır framework (React/Vue) kullanılmamıştır, bu sayede sistem son derece hafif ve hızlıdır.

### Temel Özellikler
* **Çoklu Dil Desteği (i18n):** Uygulama içerisinde Türkçe, İngilizce ve Kürtçe dil desteği tam entegre çalışır. Menülerden placeholder metinlerine kadar her şey anında değişebilir.
* **Dinamik Temalandırma:** Kullanıcı giriş ekranında ve uygulama içerisinde "Space (Klasik)", "Hacker (Yeşil Terminal)" ve "White (Açık)" temaları arasında geçiş yapabilir.
* **Gelişmiş WebRTC Özellikleri:** 
  - **Sesli ve Görüntülü Görüşme:** Odadaki kişilerle anlık şifreli görüşme yapılabilir.
  - **Ekran Paylaşımı:** Sadece bir tıkla ekran veya belirli bir uygulama penceresi odaya aktarılabilir.
  - **P2P Dosya Gönderimi:** Kullanıcılar sunucuyu yormadan, doğrudan birbirleri (peer-to-peer) arasında dosya paylaşabilirler.
* **Bağlam (Oda) Mantığı:** Uygulamada kalıcı arkadaşlıklardan ziyade, "Ağ Anahtarı" (Oda Adı) ile anlık ve izole bağlamlar (context) oluşturulur. Sunucu kapandığında veya oda silindiğinde tüm bağlam yok olur.
* **Sunucu Yönetim Paneli:** Localhost'ta veya sunucu sahibi olan kişi, uygulama içerisinden "Yönetici" sekmesine erişerek sunucudaki aktif odaları görebilir ve silebilir.

---

## 2. Uçtan Uca Şifreleme (E2EE) Mantığı

Uygulamanın **en kritik bileşeni** uçtan uca şifrelemedir. Haven mimarisinde sunucu (backend), gönderilen mesajların içeriğini **ASLA** okuyamaz, göremez ve değiştiremez. Sunucu sadece şifrelenmiş anlamsız metinleri (ciphertext) taşımakla görevli kör bir kuryedir.

Peki bu nasıl gerçekleşiyor?

### Adım Adım E2EE Mekanizması

1. **Anahtar Türetme (Key Derivation):**
   - Kullanıcı bir odaya girmek istediğinde "Ağ Anahtarı" ve "Erişim Şifresi (E2EE)" girer.
   - Bu şifre **kesinlikle sunucuya gönderilmez.**
   - Sunucudan, o odaya ait rastgele oluşturulmuş bir "Salt" değeri istenir.
   - Tarayıcının güvenli `Web Crypto API`'si kullanılarak, kullanıcının girdiği şifre ve sunucudan gelen Salt değeri **PBKDF2 / SHA-256** algoritmasından 100.000 döngü ile geçirilir.
   - Bu işlemin sonucunda ortaya 256-bitlik kırılması imkansız bir **AES-GCM Şifreleme Anahtarı (Key)** çıkar.

2. **Mesaj Gönderme (Şifreleme - Encryption):**
   - Kullanıcı mesajı yazıp "Gönder" butonuna bastığında, mesaj metni önce rastgele üretilen bir Initialization Vector (IV) ile birleştirilir.
   - `AES-GCM` algoritması ve oluşturulan E2EE Anahtarı ile mesaj şifrelenir.
   - Çıkan anlamsız `ciphertext` ve `IV`, Base64 formatına çevrilerek sunucuya iletilir.
   - Sunucu tarafında veritabanına kaydedilen şey sadece şudur: `uX1pQ!kf...` (Anlamsız veri dizisi).

3. **Mesaj Alma (Şifre Çözme - Decryption):**
   - Sunucu bu şifreli metni odadaki diğer kullanıcılara yollar.
   - Mesajı alan karşı bilgisayar, odaya girerken aynı şifreyi girdiği için zaten kendi cihazında aynı **AES-GCM Anahtarını** oluşturmuştur.
   - Gelen Base64 formatındaki veri çözümlenir, `IV` ayrıştırılır ve eldeki anahtar kullanılarak mesajın şifresi çözülür (Decryption).
   - Mesaj sadece o bilgisayarın ekranında okunabilir hale gelir. (Eğer odaya sonradan giren biri yanlış E2EE şifresi girerse, mesajların şifresini çözemez ve ekranda sadece bozuk veriler görür).

### Fotoğraf ve Dosya Şifreleme
Aynı algoritma (AES-GCM) sadece metin mesajlarına değil, kullanıcının gönderdiği fotoğraflara veya ses kayıtlarına da uygulanır. 
Fotoğraf önce bilgisayarda ArrayBuffer (ikili veri) formatına dönüştürülür, E2EE anahtarı ile tamamen şifrelenir ve sunucuya şifreli haliyle (sadece byte yığını olarak) yüklenir. Sunucu diskinde barındırdığı görselin içeriğini göremez. Karşı taraf bu görseli indirince, bellekte (RAM) kendi şifresiyle çözüp `<canvas>` veya `Blob` olarak ekrana yansıtır.

---

## 3. Güvenlik ve İzolasyon Felsefesi

* **Session İzole Edilmiştir:** Tarayıcı tarafında E2EE anahtarları kalıcı hafızaya (localStorage) düz metin olarak kaydedilmez. Sadece çalışma zamanında (RAM'de) varlık gösterir (veya sadece o oturum için sessionStorage'da şifreli tutulur).
* **Zorla Giriş Koruması:** Sunucu veritabanı çalınsa bile, odaların şifreleri sunucuda `bcrypt` algoritmasıyla "hash"lenmiş olarak saklanır. Hem bcrypt hash'ini kırmak, hem de içindeki E2EE mesajları deşifre etmek için gerekli olan PBKDF2 key'ini bulmak pratikte imkansızdır.
* **Sunucu Körlüğü:** Bu mimaride sunucu uygulamanın çalışması için gereklidir ancak "kötü niyetli" bir sunucu yöneticisi dahi (veya MITM saldırısı yapan bir hacker) mesajları okuyamaz.

## Sonuç
Haven, "Trust No One" (Kimseye Güvenme) mantığına dayanır. Arayüzün sunduğu gelişmiş tüm özellikler (Chat, Medya, Arama), aslında bu devasa şifreleme zırhının altında gizlice çalışmaktadır.
