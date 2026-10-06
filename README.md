# Hệ thống IoT giám sát & điều khiển thiết bị (ESP8266)

Triển khai theo đúng thiết kế trong báo cáo BTL IOT (Đỗ Hà Quân): ESP8266 đo nhiệt độ/độ ẩm/ánh sáng, gửi qua MQTT (Mosquitto) tới Backend, Backend lưu vào Database và cung cấp REST API cho Web UI; Web UI có thể gửi lệnh ON/OFF quay lại thiết bị qua Backend/MQTT.

```
ESP8266 (DHT11 + LDR + LED/Relay)
   │  MQTT publish/subscribe
   ▼
Mosquitto Broker (172.20.10.3:8888 — đổi trong backend/.env nếu đổi mạng)
   │
   ▼
Backend (Node.js + Express + SQLite)  ──── REST API ───▶  Frontend (HTML/CSS/JS + Chart.js)
```

## Cấu trúc thư mục

- `backend/` — API server (Express) + cầu nối MQTT + SQLite database.
- `frontend/` — Web UI tĩnh (được chính backend serve luôn, không cần server riêng).
- `arduino/esp8266_iot/esp8266_iot.ino` — Firmware ESP8266 (đã cập nhật để gửi JSON qua MQTT).

## 1. Cài đặt Backend

Yêu cầu: **Node.js 22.5+** (đã có sẵn Node v24 trên máy này). Không cần cài MySQL/XAMPP vì dùng SQLite (module `node:sqlite` tích hợp sẵn trong Node, không cần biên dịch native module).

```powershell
cd "backend"
npm install
copy .env.example .env      # chỉnh lại IP/port MQTT nếu mạng thay đổi
npm start
```

Server chạy tại `http://localhost:4000` (Web UI được phục vụ ngay tại địa chỉ này, không cần chạy frontend riêng).

> Lưu ý: PORT mặc định là 4000 vì cổng 3000 trên máy này đang được một ứng dụng Node khác sử dụng. Đổi `PORT` trong `.env` nếu cần.

Lần chạy đầu tiên, hệ thống tự tạo file `backend/data/iot.db` và seed sẵn:
- Tài khoản đăng nhập: **admin / admin123**
- 1 thiết bị mẫu `esp8266-01` với 3 cảm biến: nhiệt độ, độ ẩm, ánh sáng.

## 2. Cấu hình MQTT Broker

Backend đọc cấu hình broker từ `backend/.env`:

```
MQTT_HOST=172.20.10.3
MQTT_PORT=8888
MQTT_USERNAME=quan
MQTT_PASSWORD=your_mqtt_password
```

Đây là địa chỉ Mosquitto đang chạy trên hotspot điện thoại theo cấu hình firmware hiện có. Nếu đổi mạng/đổi máy chạy broker, **chỉ cần sửa các giá trị này**, không cần sửa code Backend. Nhớ sửa `MQTT_HOST`/`MQTT_PORT` **tương ứng** trong file `.ino` nếu đổi broker (2 nơi phải khớp nhau).

Nếu Backend không kết nối được broker, nó vẫn chạy bình thường (Dashboard/lịch sử vẫn xem được), chỉ có tính năng nhận telemetry mới và gửi lệnh điều khiển sẽ báo lỗi cho tới khi broker truy cập được.

## 3. Nạp firmware cho ESP8266

Mở `arduino/esp8266_iot/esp8266_iot.ino` bằng Arduino IDE.

Cần thư viện: `ESP8266WiFi` (có sẵn trong ESP8266 board package), `PubSubClient`, `DHT sensor library` (Adafruit).

Kiểm tra lại trước khi nạp:
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
5. **Lịch sử hoạt động**: toàn bộ lệnh ON/OFF, lọc theo thiết bị / lệnh / trạng thái (`PENDING/SUCCESS/FAIL/TIMEOUT`) / khoảng ngày.
6. **Hồ sơ**: thông tin tài khoản đang đăng nhập.

Chuông thông báo trên thanh điều hướng hiển thị số lệnh `FAIL`/`TIMEOUT` trong 24 giờ gần nhất.

Khi bấm Bật/Tắt, Backend ghi lệnh vào `device_actions` (result=`pending`), publish lệnh MQTT, rồi **chờ tối đa 10 giây** (cấu hình qua `COMMAND_TIMEOUT_SEC`) để nhận ACK thực tế từ ESP8266 trước khi trả kết quả cho Web UI — đúng theo nguyên tắc trong báo cáo: "lệnh chỉ được coi là thành công khi nhận ACK".

## 5. Database (SQLite)

Bảng theo đúng ERD trong báo cáo (`users`, `devices`, `sensors`, `data_sensor`, `device_actions`), có thêm cột `devices.device_key` (chuỗi, vd. `esp8266-01`) để map với `device_id` mà ESP8266 gửi qua MQTT tới khóa chính dạng số nội bộ. Xem chi tiết schema tại `backend/src/db.js`.

File dữ liệu: `backend/data/iot.db`. Muốn làm lại từ đầu, dừng server và xóa các file `iot.db*` trong thư mục `data/`, khởi động lại server sẽ tự tạo và seed lại.

## 6. API tóm tắt

| Method | Endpoint | Mô tả | Auth |
|---|---|---|---|
| POST | `/api/auth/login` | Đăng nhập, trả JWT | — |
| GET | `/api/dashboard` | Dữ liệu tổng quan + biểu đồ + trạng thái thiết bị | — |
| GET | `/api/sensor-data` | Tra cứu `data_sensor` (page, size, search, sort, from, to) | — |
| GET | `/api/device-actions` | Lịch sử điều khiển (page, size, search, result, from, to, sort) | — |
| GET | `/api/devices` | Danh sách thiết bị | — |
| POST | `/api/control` | Gửi lệnh ON/OFF `{device_id, target, action}` | Bearer token |

## 7. Khắc phục sự cố nhanh

- **Dashboard không có dữ liệu**: kiểm tra ESP8266 đã kết nối WiFi + MQTT chưa (xem Serial Monitor), và Backend có kết nối được broker không (xem log Backend `[MQTT] Da ket noi...`).
- **Nút Bật/Tắt luôn "fail" với thông báo "chưa kết nối được tới MQTT Broker"**: máy chạy Backend không truy cập được `MQTT_HOST:MQTT_PORT` — kiểm tra cùng mạng WiFi/hotspot với broker.
- **Thiết bị hiện Offline dù đang chạy**: do quá `DEVICE_OFFLINE_TIMEOUT_SEC` (mặc định 15s) chưa nhận telemetry mới, hoặc ESP8266 mất kết nối WiFi.
