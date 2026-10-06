#include <ESP8266WiFi.h>
#include <PubSubClient.h>
#include <DHT.h>
#include <time.h>

// ======================================================
// 1. CAU HINH PHAN CUNG
// ======================================================
#define DHTPIN    D4
#define DHTTYPE   DHT11
#define LDRPIN    A0
#define LED1PIN   D5   // Den 1 noi vao D5
#define LED2PIN   D6   // Den 2 noi vao D6
#define LED3PIN   D7   // Den 3 noi vao D7

DHT dht(DHTPIN, DHTTYPE);

// ======================================================
// 2. CAU HINH WIFI
// ======================================================
const char* WIFI_SSID     = "YOUR_WIFI_SSID";
const char* WIFI_PASSWORD = "YOUR_WIFI_PASSWORD";

// ======================================================
// 3. CAU HINH MQTT
// ======================================================
// IP cua may tinh/hotspot dang chay Mosquitto Broker
const char* MQTT_HOST = "192.168.1.184";
const uint16_t MQTT_PORT = 8888;

// Tai khoan MQTT
const char* MQTT_USER     = "quan";
const char* MQTT_PASSWORD = "YOUR_MQTT_PASSWORD";

// ID cua thiet bi - PHAI KHOP voi devices.device_key trong Database
const char* DEVICE_ID = "esp8266-01";

// ======================================================
// 4. MQTT TOPIC (phai khop voi cau hinh Backend trong .env)
// ======================================================
const char* TOPIC_DATASENSORS    = "datasensors";    // ESP -> Broker -> Backend (telemetry)
const char* TOPIC_DEVICECONTROL  = "devicecontrol";  // Backend -> Broker -> ESP (lenh ON/OFF)
const char* TOPIC_DEVICERESPONSE = "deviceresponse"; // ESP -> Broker -> Backend (ACK lenh)
const char* TOPIC_DEVICESTATUS   = "devicestatus";   // ESP -> Broker -> Backend (online/offline, LWT)

// ======================================================
// 5. THOI GIAN
// ======================================================
const long GMT_OFFSET_SEC = 7 * 3600; // Viet Nam = UTC+7
const int DAYLIGHT_OFFSET_SEC = 0;

// ======================================================
// 6. CHU KY HOAT DONG
// ======================================================
const unsigned long SENSOR_INTERVAL_MS = 2000;  // Gui du lieu cam bien moi 2 giay
const unsigned long WIFI_RETRY_MS      = 10000; // Thu lai WiFi moi 10 giay
const unsigned long MQTT_RETRY_MS      = 3000;  // Thu lai MQTT moi 3 giay

// ======================================================
// 7. DOI TUONG WIFI / MQTT
// ======================================================
WiFiClient wifiClient;
PubSubClient mqttClient(wifiClient);

// ======================================================
// 8. BIEN TRANG THAI
// ======================================================
bool led1On = false;
bool led2On = false;
bool led3On = false;
unsigned long lastSensorPublish = 0;
unsigned long lastWiFiAttempt = 0;
unsigned long lastMQTTAttempt = 0;

// ======================================================
// 9. DOC QUANG TRO (LDR) CO LOC NHIEU
// ======================================================
int readLdrFiltered(uint8_t samples = 10) {
  long total = 0;
  for (uint8_t i = 0; i < samples; i++) {
    total += analogRead(LDRPIN);
    delay(10);
  }
  return (int)(total / samples);
}

// ======================================================
// 10. LAY THOI GIAN (da dong bo NTP)
// ======================================================
String getTimeString() {
  time_t now = time(nullptr);
  if (now < 1700000000) {
    return "dang dong bo...";
  }
  struct tm timeInfo;
  localtime_r(&now, &timeInfo);
  char buffer[25];
  strftime(buffer, sizeof(buffer), "%d/%m/%Y %H:%M:%S", &timeInfo);
  return String(buffer);
}

// ======================================================
// 11. DIEU KHIEN LED/RELAY
// led = 1 -> den 1, led = 2 -> den 2, led = 3 -> den 3
// ======================================================
void applyLed(uint8_t led, bool state) {
  if (led == 1) {
    led1On = state;
    digitalWrite(LED1PIN, state ? HIGH : LOW);
  } else if (led == 2) {
    led2On = state;
    digitalWrite(LED2PIN, state ? HIGH : LOW);
  } else if (led == 3) {
    led3On = state;
    digitalWrite(LED3PIN, state ? HIGH : LOW);
  }
}

// ======================================================
// 12. GUI PHAN HOI (ACK) LEN MQTT - dang JSON
// Luon bao ca trang thai led1, led2, led3 de Backend dong bo.
// ======================================================
void publishResponse(const String& action, const char* result) {
  if (!mqttClient.connected()) return;

  String payload;
  payload.reserve(250);
  payload  = "{\"device_id\":\"" + String(DEVICE_ID) + "\",";
  payload += "\"action\":\""     + action + "\",";
  payload += "\"led1\":\""       + String(led1On ? "ON" : "OFF") + "\",";
  payload += "\"led2\":\""       + String(led2On ? "ON" : "OFF") + "\",";
  payload += "\"led3\":\""       + String(led3On ? "ON" : "OFF") + "\",";
  payload += "\"result\":\""     + String(result) + "\",";
  payload += "\"time\":\""       + getTimeString() + "\"}";

  bool success = mqttClient.publish(TOPIC_DEVICERESPONSE, payload.c_str());

  Serial.print("[MQTT RESPONSE] ");
  Serial.println(payload);
  Serial.print("[MQTT RESPONSE] Publish: ");
  Serial.println(success ? "SUCCESS" : "FAILED");
}

// ======================================================
// 13. XU LY LENH
// Lenh hop le:
//   LED1_ON, LED1_OFF  -> bat/tat den 1
//   LED2_ON, LED2_OFF  -> bat/tat den 2
//   LED3_ON, LED3_OFF  -> bat/tat den 3
//   ALL_ON,  ALL_OFF   -> bat/tat ca 3 den
//   ON, OFF            -> giong ALL_ON / ALL_OFF (giu tuong thich lenh cu)
// Go "LED1 ON" (co dau cach) cung duoc.
// ======================================================
void handleCommand(String command, bool fromMqtt) {
  command.trim();
  command.toUpperCase();
  command.replace(" ", "_");
  if (command.length() == 0) return;

  bool valid = true;

  if      (command == "LED1_ON")                       applyLed(1, true);
  else if (command == "LED1_OFF")                      applyLed(1, false);
  else if (command == "LED2_ON")                       applyLed(2, true);
  else if (command == "LED2_OFF")                      applyLed(2, false);
  else if (command == "LED3_ON")                       applyLed(3, true);
  else if (command == "LED3_OFF")                      applyLed(3, false);
  else if (command == "ALL_ON"  || command == "ON")  { applyLed(1, true);  applyLed(2, true);  applyLed(3, true);  }
  else if (command == "ALL_OFF" || command == "OFF") { applyLed(1, false); applyLed(2, false); applyLed(3, false); }
  else valid = false;

  if (valid) {
    Serial.print("[LED] Thuc hien: ");
    Serial.print(command);
    Serial.print(" | LED1 = ");
    Serial.print(led1On ? "ON" : "OFF");
    Serial.print(" | LED2 = ");
    Serial.print(led2On ? "ON" : "OFF");
    Serial.print(" | LED3 = ");
    Serial.println(led3On ? "ON" : "OFF");
    if (fromMqtt) publishResponse(command, "SUCCESS");
  } else {
    Serial.print("[LED] Lenh khong hop le: ");
    Serial.println(command);
    if (fromMqtt) publishResponse(command, "REJECTED");
  }
}

// ======================================================
// 14. DIEU KHIEN LED QUA SERIAL MONITOR (de test tay)
// ======================================================
void handleSerialCommand() {
  while (Serial.available() > 0) {
    String command = Serial.readStringUntil('\n');
    handleCommand(command, false);
  }
}

// ======================================================
// 15. CALLBACK MQTT
// ======================================================
void mqttCallback(char* topic, byte* payload, unsigned int length) {
  String message = "";
  message.reserve(length);
  for (unsigned int i = 0; i < length; i++) {
    message += (char)payload[i];
  }

  Serial.println();
  Serial.print("[MQTT RX] Topic: ");
  Serial.println(topic);
  Serial.print("[MQTT RX] Payload: ");
  Serial.println(message);

  if (String(topic) == TOPIC_DEVICECONTROL) {
    handleCommand(message, true);
  }
}

// ======================================================
// 16. BAT DAU KET NOI WIFI
// ======================================================
void startWiFi() {
  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  lastWiFiAttempt = millis();
  Serial.println();
  Serial.print("[WiFi] Dang ket noi: ");
  Serial.println(WIFI_SSID);
}

// ======================================================
// 17. DUY TRI WIFI
// ======================================================
void maintainWiFi() {
  static wl_status_t previousStatus = WL_IDLE_STATUS;
  wl_status_t status = WiFi.status();

  if (status != previousStatus) {
    previousStatus = status;
    if (status == WL_CONNECTED) {
      Serial.println();
      Serial.println("[WiFi] KET NOI THANH CONG");
      Serial.print("[WiFi] IP ESP8266: ");
      Serial.println(WiFi.localIP());
      Serial.print("[WiFi] Gateway: ");
      Serial.println(WiFi.gatewayIP());
      Serial.print("[WiFi] RSSI: ");
      Serial.println(WiFi.RSSI());
    } else {
      Serial.print("[WiFi] Chua ket noi, status = ");
      Serial.println(status);
    }
  }

  if (status != WL_CONNECTED && millis() - lastWiFiAttempt >= WIFI_RETRY_MS) {
    lastWiFiAttempt = millis();
    Serial.println("[WiFi] Dang thu ket noi lai...");
    WiFi.disconnect();
    WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  }
}

// ======================================================
// 18. KET NOI MQTT (co Last Will and Testament - LWT)
// ======================================================
void maintainMQTT() {
  if (WiFi.status() != WL_CONNECTED) return;
  if (mqttClient.connected()) return;
  if (millis() - lastMQTTAttempt < MQTT_RETRY_MS) return;

  lastMQTTAttempt = millis();
  String clientId = "ESP8266-" + String(ESP.getChipId(), HEX);

  // Payload LWT: Broker se tu dong publish ban tin nay (retained) neu ESP mat ket noi bat thuong
  String willPayload = "{\"device_id\":\"" + String(DEVICE_ID) + "\",\"status\":\"offline\"}";

  Serial.print("[MQTT] Connecting to ");
  Serial.print(MQTT_HOST);
  Serial.print(":");
  Serial.print(MQTT_PORT);
  Serial.print(" ... ");

  bool connected = mqttClient.connect(
    clientId.c_str(),
    MQTT_USER,
    MQTT_PASSWORD,
    TOPIC_DEVICESTATUS,   // willTopic
    1,                     // willQos
    true,                  // willRetain
    willPayload.c_str()    // willMessage
  );

  if (connected) {
    Serial.println("SUCCESS");

    bool subscribed = mqttClient.subscribe(TOPIC_DEVICECONTROL);
    Serial.print("[MQTT] Subscribe ");
    Serial.print(TOPIC_DEVICECONTROL);
    Serial.print(": ");
    Serial.println(subscribed ? "SUCCESS" : "FAILED");

    // Bao trang thai online ngay khi ket noi thanh cong (retained)
    String onlinePayload = "{\"device_id\":\"" + String(DEVICE_ID) + "\",\"status\":\"online\"}";
    mqttClient.publish(TOPIC_DEVICESTATUS, onlinePayload.c_str(), true);

    // Bao ngay trang thai hien tai cua 3 den de Backend/Web UI dong bo
    publishResponse("SYNC", "SUCCESS");
  } else {
    Serial.print("FAILED, state = ");
    Serial.println(mqttClient.state());
  }
}

// ======================================================
// 19. DOC VA GUI DU LIEU CAM BIEN (JSON) LEN MQTT
// ======================================================
void publishSensorData() {
  float temperature = dht.readTemperature();
  float humidity = dht.readHumidity();
  int lightValue = readLdrFiltered(10);

  if (isnan(temperature) || isnan(humidity)) {
    Serial.println("Khong doc duoc du lieu DHT11");
    return;
  }

  // Payload JSON de Backend parse va ghi vao bang data_sensor
  // (moi truong temperature/humidity/light se duoc tach thanh 1 ban ghi rieng theo sensor_id)
  String payload = "{";
  payload += "\"device_id\":\""  + String(DEVICE_ID) + "\",";
  payload += "\"temperature\":"  + String(temperature, 1) + ",";
  payload += "\"humidity\":"     + String(humidity, 1) + ",";
  payload += "\"light\":"        + String(lightValue) + ",";
  payload += "\"timestamp\":\""  + getTimeString() + "\"";
  payload += "}";

  bool success = mqttClient.publish(TOPIC_DATASENSORS, payload.c_str());

  Serial.println(payload);
  Serial.println(success ? "Publish: SUCCESS" : "Publish: FAILED");
}

// ======================================================
// 20. SETUP
// ======================================================
void setup() {
  Serial.begin(115200);
  delay(500);
  Serial.println();
  Serial.println("================================");
  Serial.println("     ESP8266 IOT SYSTEM");
  Serial.println("================================");

  pinMode(LED1PIN, OUTPUT);   // Den 1
  pinMode(LED2PIN, OUTPUT);   // Den 2
  pinMode(LED3PIN, OUTPUT);   // Den 3
  applyLed(1, false);
  applyLed(2, false);
  applyLed(3, false);

  dht.begin();

  startWiFi();

  configTime(GMT_OFFSET_SEC, DAYLIGHT_OFFSET_SEC, "pool.ntp.org", "time.nist.gov");

  mqttClient.setServer(MQTT_HOST, MQTT_PORT);
  mqttClient.setCallback(mqttCallback);

  Serial.println("[SYSTEM] Khoi dong hoan tat");
  Serial.println("[SYSTEM] Lenh: LED1_ON, LED1_OFF, LED2_ON, LED2_OFF, LED3_ON, LED3_OFF, ALL_ON, ALL_OFF");
  Serial.println("[SYSTEM] Go lenh tren Serial Monitor hoac gui MQTT vao topic devicecontrol");
}

// ======================================================
// 21. LOOP
// ======================================================
void loop() {
  maintainWiFi();
  maintainMQTT();

  if (mqttClient.connected()) {
    mqttClient.loop();
  }

  handleSerialCommand();

  unsigned long now = millis();
  if (mqttClient.connected() && now - lastSensorPublish >= SENSOR_INTERVAL_MS) {
    lastSensorPublish = now;
    publishSensorData();
  }
}
