# Hệ thống IoT giám sát & điều khiển thiết bị (ESP8266)

Triển khai theo đúng thiết kế trong báo cáo BTL IOT (Đỗ Hà Quân): ESP8266 đo nhiệt độ/độ ẩm/ánh sáng, gửi qua MQTT (Mosquitto) tới Backend, Backend lưu vào Database và cung cấp REST API cho Web UI; Web UI có thể gửi lệnh ON/OFF quay lại thiết bị qua Backend/MQTT.

```
ESP8266 (DHT11 + LDR + LED/Relay)
   │  MQTT publish/subscribe
   ▼
Mosquitto Broker (192.168.1.100:8888 — đổi trong backend/.env nếu đổi mạng)
   │
   ▼
Backend (Node.js + Express + MySQL)  ──── REST API ───▶  Frontend (HTML/CSS/JS + Chart.js)
```

## Cấu trúc thư mục

- `backend/` — API server (Express) + cầu nối MQTT + MySQL.
  - `backend/database/iot_system.sql` — script tạo CSDL (5 bảng theo mục 4.2.2 báo cáo) + dữ liệu mẫu.
  - `backend/scripts/fake-esp.js` — giả lập ESP8266 để test khi chưa có mạch.
- `frontend/` — Web UI tĩnh (được chính backend serve luôn, không cần server riêng).
- `arduino/esp8266_iot/esp8266_iot.ino` — Firmware ESP8266 (đã cập nhật để gửi JSON qua MQTT).

## 1. Cài đặt Backend

Yêu cầu: **Node.js 18+** và **MySQL/MariaDB** (dùng MySQL của XAMPP: mở XAMPP Control Panel → MySQL → Start).

```powershell
cd "backend"
npm install
copy .env.example .env      # chỉnh DB_* (MySQL) và MQTT_* nếu cần
npm start
```

Lần chạy đầu, nếu chưa có database `iot_system`, Backend **tự chạy** `database/iot_system.sql` để tạo bảng và seed:
- Tài khoản đăng nhập: **admin / admin123**
- 1 thiết bị `esp8266-01` với 3 cảm biến: Nhiệt độ, Độ ẩm, Ánh sáng.

Cũng có thể tạo DB thủ công: import `backend/database/iot_system.sql` bằng phpMyAdmin, hoặc chạy `npm run db:init` (**xóa và tạo lại** toàn bộ dữ liệu).

Server chạy tại `http://localhost:4000` (Web UI được phục vụ ngay tại địa chỉ này).

Test không cần mạch thật: bật broker (`start-broker.bat`), chạy Backend, rồi ở cửa sổ khác chạy `node scripts/fake-esp.js` — script gửi dữ liệu cảm biến mỗi 5 giây và trả ACK cho lệnh bật/tắt.

## 2. Cấu hình MQTT Broker

Backend đọc cấu hình broker từ `backend/.env`:

```
MQTT_HOST=192.168.1.100
MQTT_PORT=8888
MQTT_USERNAME=iot_device
MQTT_PASSWORD=YOUR_MQTT_PASSWORD
```

Create the broker password file for a new install using `mosquitto_passwd -c mqtt/passwd iot_device` from the project root. Set the same MQTT username and password in `backend/.env` and the firmware configuration. Use the LAN IP of the broker host for the ESP8266 and update `password_file` in `mqtt/mosquitto.conf` if the project folder has moved.

Nếu Backend không kết nối được broker, nó vẫn chạy bình thường (Dashboard/lịch sử vẫn xem được), chỉ có tính năng nhận telemetry mới và gửi lệnh điều khiển sẽ báo lỗi cho tới khi broker truy cập được.

## 3. Nạp firmware cho ESP8266

Mở `arduino/esp8266_iot/esp8266_iot.ino` bằng Arduino IDE.

Cần thư viện: `ESP8266WiFi` (có sẵn trong ESP8266 board package), `PubSubClient`, `DHT sensor library` (Adafruit).

Kiểm tra lại trước khi nạp:
Copy `local_config.h.example` to `local_config.h` in the sketch folder.
- `WIFI_SSID` / `WIFI_PASSWORD` — mạng mà máy chạy Backend/Broker cũng phải kết nối được.
- `MQTT_HOST` / `MQTT_PORT` — phải khớp với `backend/.env`.
- `DEVICE_ID = "esp8266-01"` — phải khớp với `device_key` trong bảng `devices`. Muốn thêm thiết bị mới, đổi `DEVICE_ID` trong firmware và thêm dòng tương ứng vào DB (xem `backend/src/db.js`, hàm `seed()`).

So với bản gốc, firmware đã được chỉnh:
- `publishSensorData()` gửi **JSON** (`device_id, temperature, humidity, light, timestamp`) thay vì chuỗi text, để Backend parse được.
- Thêm **LWT (Last Will and Testament)**: khi ESP8266 mất kết nối đột ngột, Broker tự động publish `{"status":"offline"}` lên topic `devicestatus` để Backend cập nhật trạng thái thiết bị ngay lập tức. Khi kết nối lại, ESP8266 tự publish `{"status":"online"}`.
- Mọi logic đọc cảm biến, điều khiển LED/Relay qua topic `devicecontrol`, gửi ACK qua `deviceresponse`, WiFi/MQTT auto-reconnect... giữ nguyên như bản gốc.

## 4. Sử dụng Web UI

Giao diện được dựng theo đúng bản thiết kế Figma trong `figma_iot.docx` (thanh điều hướng dạng pill, thẻ chỉ số có cao/thấp nhất, biểu đồ gộp 3 đường, bảng có badge màu, phân trang dạng số).

1. Mở `http://localhost:4000` → tự chuyển tới trang đăng nhập.
2. Đăng nhập bằng `admin` / `admin123`.
3. **Trang chủ (Dashboard)**: 3 thẻ Nhiệt độ/Ánh sáng/Độ ẩm (giá trị hiện tại + cao nhất/thấp nhất), 1 biểu đồ tổng quan 24 giờ gộp cả 3 chỉ số (2 trục trái, 1 trục phải), khối "Điều khiển thiết bị" với công tắc bật/tắt — công tắc tự khôi phục nếu lệnh gửi thất bại.
4. **Cảm biến**: tra cứu `data_sensor`, lọc theo loại cảm biến, lọc theo giá trị (gõ số hoặc toán tử so sánh như `>30`, `<=20`), lọc theo khoảng ngày, phân trang dạng số.
5. **Lịch sử hoạt động**: toàn bộ lệnh ON/OFF, lọc theo thiết bị / lệnh / trạng thái (`PENDING/SUCCESS/FAILED/TIMEOUT`) / khoảng ngày.
6. **Hồ sơ**: thông tin tài khoản đang đăng nhập.

Chuông thông báo trên thanh điều hướng hiển thị số lệnh `FAILED`/`TIMEOUT` trong 24 giờ gần nhất.

Khi bấm Bật/Tắt, Backend ghi lệnh vào `device_actions` (result=`pending`), publish lệnh MQTT, rồi **chờ tối đa 10 giây** (cấu hình qua `COMMAND_TIMEOUT_SEC`) để nhận ACK thực tế từ ESP8266 trước khi trả kết quả cho Web UI — đúng theo nguyên tắc trong báo cáo: "lệnh chỉ được coi là thành công khi nhận ACK".

Nếu thiết bị mất kết nối (VD rút ESP8266), lệnh được giữ ở `pending` và Dashboard hiện `PENDING`. Khi thiết bị kết nối lại, lệnh chuyển thành `fail` và Dashboard hiện `FAILED`, vì ESP8266 không nhận lại lệnh cũ. `timeout` chỉ dùng khi thiết bị vẫn gửi dữ liệu nhưng không phản hồi lệnh.

## Tab Cảnh báo

ESP8266 sinh 3 giá trị ngẫu nhiên: `random(0, 11)`, `random(0, 101)`, `random(0, 1001)`, gửi cùng bản tin `datasensors` (trường `random_10`, `random_100`, `random_1000`). Backend lưu vào `data_sensor`, tách khỏi Dashboard.

Khi giá trị vượt 50% thang đo (> 5, > 50, > 500), LED tương ứng nhấp nháy: LED thật nối chân **D1, D2, D0** trên ESP8266, và LED ảo trong tab **Cảnh báo**.

## 5. Database (MySQL)

5 bảng đúng ERD mục 4.2.2 báo cáo: `users`, `devices`, `sensors`, `data_sensor`, `device_actions` (xem `backend/database/iot_system.sql`).
- `data_sensor` lưu **mỗi giá trị đo một dòng** theo `sensor_id`; Backend JOIN `sensors`/`devices` khi trả API.
- `device_actions.result`: `pending` → `ok` / `fail` / `timeout`; `issued_by` là `users.id`.
- Cột bổ sung `devices.device_key` (vd `esp8266-01`) để ánh xạ `device_id` dạng chuỗi mà ESP8266 gửi qua MQTT sang khóa chính số.
- Mọi cột thời gian lưu theo **UTC**; API trả `YYYY-MM-DD HH:MM:SS` (UTC), Frontend tự đổi sang giờ Việt Nam.

## 6. API tóm tắt

Tất cả API (trừ đăng nhập, health) yêu cầu header `Authorization: Bearer <token>`.

| Method | Endpoint | Mô tả |
|---|---|---|
| POST | `/api/auth/login` | Đăng nhập `{username, password}`, trả `{token, user}` |
| GET | `/api/auth/me` | Thông tin tài khoản hiện tại |
| GET | `/api/dashboard` | `latestSensors`, `chartSeries`, `deviceStatus`, `updatedAt` (tham số: `from`, `to`, `interval`, `limit`, `device_id`) |
| GET | `/api/sensor-data` | `page, size, search, sort (time_desc/time_asc/value_desc/value_asc), type, value (>30, <=20...), from, to, time` |
| GET | `/api/random-sensors` | 3 cảm biến ngẫu nhiên, trạng thái cảnh báo (> 50% thang đo) và lịch sử có `page`, `size` |
| POST | `/api/control` | `{device_id, target: led1/led2/led3/all, action: ON/OFF}` → 200 `ok` / 202 `pending` / 502 `fail` / 504 `timeout` |
| GET | `/api/device-actions` | `page, size, search, device, action, result, from, to, time, sort` |
| GET | `/api/devices` | Danh sách thiết bị + cảm biến + trạng thái đèn |
| GET | `/api/health` | Trạng thái kết nối MySQL và MQTT |

## 7. Khắc phục sự cố nhanh

- **Backend báo `Khong ket noi duoc MySQL`**: bật MySQL trong XAMPP Control Panel, kiểm tra `DB_HOST/DB_PORT/DB_USER/DB_PASSWORD` trong `backend/.env`.
- **Dashboard không có dữ liệu**: kiểm tra ESP8266 đã kết nối WiFi + MQTT chưa (xem Serial Monitor), và Backend có kết nối được broker không (xem log Backend `[MQTT] Da ket noi...`).
- **Nút Bật/Tắt luôn "fail" với thông báo "chưa kết nối được tới MQTT Broker"**: máy chạy Backend không truy cập được `MQTT_HOST:MQTT_PORT` — kiểm tra cùng mạng WiFi/hotspot với broker.
- **Thiết bị hiện Offline dù đang chạy**: do quá `DEVICE_OFFLINE_TIMEOUT_SEC` (mặc định 15s) chưa nhận telemetry mới, hoặc ESP8266 mất kết nối WiFi.
