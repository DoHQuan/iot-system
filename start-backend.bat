@echo off
REM ==== Chay Backend + Web UI (bat buoc dung Node v24 o C:\Program Files\nodejs) ====
title IoT - Backend 4000
set "PATH=C:\Program Files\nodejs;%PATH%"
cd /d "D:\iot-system\backend"
echo [BE] Node version:
node -v
echo [BE] Dang khoi dong Backend tai http://localhost:4000 ...
echo.
node src\server.js
echo.
echo [BE] Backend da dung. Nhan phim bat ky de thoat.
pause >nul
