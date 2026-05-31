#!/bin/bash

# Eğer yarım kalan bir GitHub birleştirmesi (Merge) varsa önce onu tamamla.
if [ -f .git/MERGE_HEAD ]; then
    echo "📌 Yarım kalan kod birleştirmesi otomatik tamamlanıyor..."
    git commit -m "Merge remote-tracking branch 'origin/main'"
fi

# Kullanıcıdan mesaj al
echo "🚀 GitHub Hızlı Gönderim Asistanı"
read -p "Lütfen commit (değişiklik) mesajını gir: " commit_msg

# Eğer boş bırakırsa uyar
if [ -z "$commit_msg" ]; then
    echo "❌ Mesaj boş bırakılamaz! İşlem iptal edildi."
    exit 1
fi

# Değişiklikleri ekle ve commit yap
git add .
git commit -m "$commit_msg"

# Github'a yükle
echo "⏳ Değişiklikler GitHub'a yükleniyor..."
git push origin main

if [ $? -eq 0 ]; then
    echo "✅ Tüm dosyalar başarıyla GitHub'a yüklendi!"
else
    echo "❌ Gönderme sırasında bir hata oluştu. (Süresi dolmuş token veya yetki hatası olabilir)"
fi
