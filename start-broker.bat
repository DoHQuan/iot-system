@echo off
REM ==== Chay MQTT Broker (Mosquitto) cho du an iot-system, cong 8888, user quan/123 ====
title IoT - MQTT Broker 8888
echo [MQTT] Dang khoi dong Mosquitto o cong 8888 ...
echo [MQTT] De dong broker: dong cua so nay hoac nhan Ctrl+C
echo.
"C:\Program Files\mosquitto\mosquitto.exe" -c "D:\iot-system\mqtt\mosquitto.conf" -v
echo.
echo [MQTT] Broker da dung. Nhan phim bat ky de thoat.
pause >nul
