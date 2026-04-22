@echo off
chcp 65001 >nul
title Haven - Windows Ilk Kurulum
echo.
echo ====================================================
echo   Haven - Windows Ilk Kurulum ve Onarim Araci
echo ====================================================
echo.

:: Node.js kontrolu
where node >nul 2>&1
if %errorlevel% neq 0 (
    echo [HATA] Node.js bulunamadi!
    echo [HATA] Lutfen https://nodejs.org adresinden Node.js kurun.
    echo.
    pause
    exit /b 1
)

echo [OK] Node.js bulundu:
node -v
echo.

:: npm install
echo [1/2] Bagimliliklar kuruluyor (npm install)...
echo       Bu islem birkaç dakika surebilir...
call npm install
if %errorlevel% neq 0 (
    echo [HATA] npm install basarisiz oldu!
    pause
    exit /b 1
)
echo [OK] Bagimliliklar kuruldu.
echo.

:: Electron icin native moduller yeniden derleniyor
echo [2/2] Native moduller Electron icin yeniden derleniyor...
echo       (better-sqlite3 gibi moduller Electron'un Node.js surumune uyumlu olmalidir)
call npx @electron/rebuild
if %errorlevel% neq 0 (
    echo [UYARI] Electron rebuild basarisiz oldu. Uygulama veritabani hata verebilir.
    echo         Detay icin yukaridaki hata mesajina bakin.
) else (
    echo [OK] Native moduller Electron icin basariyla derlendi.
)
echo.

echo ====================================================
echo   Kurulum tamamlandi!
echo   Artik start_windows.bat dosyasini calistirabilirsiniz.
echo ====================================================
echo.
pause
