@echo off
title Haven Private Chat - Windows Starter
echo.
echo      /$$   /$$                                     
echo     ^| $$  ^| $$                                     
echo     ^| $$  ^| $$  /$$$$$$  /$$    /$$ /$$$$$$  /$$$$$$$
echo     ^| $$$$$$$$ ^|____  $$^|  $$  /$$//$$__  $$^| $$__  $$
echo     ^| $$__  $$  /$$$$$$$ \  $$/$$/^| $$$$$$$$^| $$  \ $$
echo     ^| $$  ^| $$ /$$__  $$  \  $$$/ ^| $$_____/^| $$  ^| $$
echo     ^| $$  ^| $$^|  $$$$$$$   \  $/  ^|  $$$$$$$^| $$  ^| $$
echo     ^|__/  ^|__/ \_______/    \_/    \_______/^|__/  ^|__/
echo.
echo [INFO] Haven Private Chat Baslatiliyor...
echo.

:: Temizlik
echo [WAIT] Eski islemler temizleniyor...
taskkill /F /IM cloudflared.exe /T >nul 2>&1
taskkill /F /IM node.exe /FI "WINDOWTITLE eq HavenServer" >nul 2>&1
timeout /t 2 /nobreak >nul

:: Veri klasoru kontrolu
if not exist data mkdir data

:: Sunucuyu baslat
echo [SERVER] Sunucu arka planda baslatiliyor...
start "HavenServer" /B npm run server

:: Cloudflare Tünelini baslat
echo [TUNNEL] Cloudflare Tunnel baslatiliyor...
:: npx cloudflared kullanıyoruz çünkü node_modules içinde hazır
start "HavenTunnel" /B cmd /c npx cloudflared tunnel --edge-ip-version 4 --region us --url http://127.0.0.1:3847 > data\tunnel.log 2>&1

echo [WAIT] Cloudflare tunel adresi bekleniyor...
echo.

set retry=0
:search_url
timeout /t 2 /nobreak >nul
set "TUNNEL_URL="
for /f "tokens=*" %%a in ('powershell -Command "Select-String -Path 'data\tunnel.log' -Pattern 'https://[a-zA-Z0-9-]+\.trycloudflare\.com' | Select-Object -ExpandProperty Matches | Select-Object -ExpandProperty Value -First 1"') do set TUNNEL_URL=%%a

if not "%TUNNEL_URL%"=="" goto tunnel_success
set /a retry+=1
if %retry% gtr 15 (
    echo [ERROR] Tunel adresi algilanamadi! Manuel giris gerekebilir.
    goto open_app
)
goto search_url
:tunnel_success

echo [OK] Tunel URL belirlendi: %TUNNEL_URL%
echo %TUNNEL_URL% > data\tunnel-url.txt
echo [OK] Login ekraninda otomatik doldurulacak.

:open_app
echo.
echo [APP] Haven Masaustu uygulamasi aciliyor...
npm start

:: Kapanıs
echo.
echo [EXIT] Uygulama kapatildi. Servisler durduruluyor...
taskkill /F /IM cloudflared.exe /T >nul 2>&1
:: Node sunucusunu isminden bulup kapatıyoruz
taskkill /F /FI "WINDOWTITLE eq HavenServer" >nul 2>&1
echo [INFO] Gorusmek uzere!
pause
