#!/bin/bash

# Renk kodları
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

echo -e "${BLUE}🚀 DC Private Chat Başlatılıyor...${NC}"

echo -e "${YELLOW}🧹 Eski işlemler temizleniyor...${NC}"
killall -9 cloudflared 2>/dev/null
pkill -f "node server/index.js" 2>/dev/null
sleep 1

# Önceki kayıt dosyalarını temizle
rm -f server.log tunnel.log

echo -e "${YELLOW}📦 Sunucu arka planda başlatılıyor...${NC}"
npm run server > server.log 2>&1 &
SERVER_PID=$!

echo -e "${YELLOW}🌐 Cloudflare Tunnel arka planda başlatılıyor...${NC}"
cloudflared tunnel --edge-ip-version 4 --region us --url http://localhost:3847 > tunnel.log 2>&1 &
TUNNEL_PID=$!

echo -e "${BLUE}⏳ Cloudflare tünel adresi bekleniyor (Birkaç saniye sürebilir)...${NC}"

# Tunnel URL'sini otomatik algıla ve data/tunnel-url.txt'e kaydet
TUNNEL_URL=""
WAIT_COUNT=0
MAX_WAIT=30

while [ -z "$TUNNEL_URL" ] && [ $WAIT_COUNT -lt $MAX_WAIT ]; do
    sleep 1
    WAIT_COUNT=$((WAIT_COUNT + 1))
    TUNNEL_URL=$(grep -oP 'https://[\w-]+.trycloudflare.com' tunnel.log 2>/dev/null | head -1)
done

echo ""
echo -e "${GREEN}========== CLOUDFLARE ÇIKTISI ==========${NC}"
cat tunnel.log
echo -e "${GREEN}==========================================${NC}"
echo ""

# Tunnel URL'sini dosyaya kaydet (Electron uygulaması otomatik okuyacak)
mkdir -p data
if [ -n "$TUNNEL_URL" ]; then
    echo "$TUNNEL_URL" > data/tunnel-url.txt
    echo -e "${GREEN}✅ Tunnel URL otomatik algılandı: ${TUNNEL_URL}${NC}"
    echo -e "${GREEN}✅ Login ekranındaki sunucu alanı otomatik doldurulacak!${NC}"
else
    echo -e "${RED}⚠️ Tunnel URL algılanamadı. Manuel giriş gerekebilir.${NC}"
    rm -f data/tunnel-url.txt
fi

echo -e "${BLUE}💻 Masaüstü (Electron) uygulaması açılıyor...${NC}"
# Masaüstü uygulamasını başlat ve uygulamanın kapanmasını bekle
npm start

# Electron kapandığında arka plandaki node ve cloudflared'i kapat
echo -e "${YELLOW}🛑 Uygulama kapatıldı. Arka plan servisleri durduruluyor...${NC}"
kill $SERVER_PID 2>/dev/null
kill $TUNNEL_PID 2>/dev/null

echo -e "${GREEN}👋 Görüşmek üzere! Tüm işlemler temizlendi.${NC}"
