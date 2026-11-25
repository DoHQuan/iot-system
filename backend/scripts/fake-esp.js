// Gia lap ESP8266 de test Backend khi chua co mach that.
// Chay: node scripts/fake-esp.js   (Ctrl+C de dung)
// - Gui du lieu cam bien len "datasensors" moi 5 giay (xen ke dang JSON va dang chuoi text trong bao cao)
// - Nhan lenh tren "devicecontrol", bat/tat den ao, tra ACK len "deviceresponse"
// - Publish trang thai online/offline (LWT) len "devicestatus"
require('dotenv').config({ path: require('path').resolve(__dirname, '..', '.env') });
const mqtt = require('mqtt');

const DEVICE_ID = process.env.FAKE_DEVICE_ID || 'esp8266-01';
const T = {
  data: process.env.MQTT_TOPIC_TELEMETRY || 'datasensors',
  control: process.env.MQTT_TOPIC_CONTROL || 'devicecontrol',
  response: process.env.MQTT_TOPIC_RESPONSE || 'deviceresponse',
  status: process.env.MQTT_TOPIC_STATUS || 'devicestatus',
};
const leds = { 1: false, 2: false, 3: false };
const randomInt = (limit) => Math.floor(Math.random() * limit);

const pad = (n) => String(n).padStart(2, '0');
function timeString() {
  const d = new Date();
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

const client = mqtt.connect(`mqtt://${process.env.MQTT_HOST || 'localhost'}:${process.env.MQTT_PORT || 1883}`, {
  clientId: `fake-${DEVICE_ID}`,
  username: process.env.MQTT_USERNAME || undefined,
  password: process.env.MQTT_PASSWORD || undefined,
  will: { topic: T.status, payload: JSON.stringify({ device_id: DEVICE_ID, status: 'offline' }), qos: 1, retain: true },
});

client.on('connect', () => {
  console.log('[FAKE-ESP] Da ket noi broker');
  client.subscribe(T.control);
  client.publish(T.status, JSON.stringify({ device_id: DEVICE_ID, status: 'online' }), { retain: true });
});

let n = 0;
setInterval(() => {
  if (!client.connected) return;
  const temperature = (27 + Math.random() * 4).toFixed(1);
  const humidity = (60 + Math.random() * 10).toFixed(1);
  const light = Math.round(400 + Math.random() * 300);
  const payload = n++ % 2 === 0
    ? JSON.stringify({ device_id: DEVICE_ID, temperature: Number(temperature), humidity: Number(humidity), light, random_10: randomInt(11), random_100: randomInt(101), random_1000: randomInt(1001), timestamp: timeString() })
    : `Nhiet do: ${temperature} C | Do am: ${humidity} % | Anh sang: ${light} | Thoi gian: ${timeString()}`;
  client.publish(T.data, payload);
  console.log('[FAKE-ESP] ->', payload);
}, 5000);

client.on('message', (topic, buf) => {
  const command = buf.toString().trim().toUpperCase().replace(/\s+/g, '_');
  console.log('[FAKE-ESP] <- lenh', command);
  let valid = true;
  const m = command.match(/^LED([123])_(ON|OFF)$/);
  if (m) leds[m[1]] = m[2] === 'ON';
  else if (['ALL_ON', 'ON'].includes(command)) leds[1] = leds[2] = leds[3] = true;
  else if (['ALL_OFF', 'OFF'].includes(command)) leds[1] = leds[2] = leds[3] = false;
  else valid = false;
  client.publish(T.response, JSON.stringify({
    device_id: DEVICE_ID,
    action: command,
    led1: leds[1] ? 'ON' : 'OFF',
    led2: leds[2] ? 'ON' : 'OFF',
    led3: leds[3] ? 'ON' : 'OFF',
    result: valid ? 'SUCCESS' : 'REJECTED',
    time: timeString(),
  }));
});
