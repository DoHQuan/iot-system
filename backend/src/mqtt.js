// Cau noi MQTT (muc 4.2.3 bao cao):
//   datasensors    ESP8266 -> Backend : du lieu cam bien  -> INSERT data_sensor theo sensor_id
//   devicecontrol  Backend -> ESP8266 : lenh LED1_ON, ALL_OFF...
//   deviceresponse ESP8266 -> Backend : ACK {device_id, action, led1..led3, result, time}
//   devicestatus   ESP8266/LWT -> Backend : {device_id, status: online|offline}
const mqtt = require('mqtt');
const db = require('./db');
const deviceState = require('./services/deviceState');
const { RANDOM_SENSORS } = require('./services/randomSensors');

const HOST = process.env.MQTT_HOST || 'localhost';
const PORT = process.env.MQTT_PORT || 1883;
const TOPIC_TELEMETRY = process.env.MQTT_TOPIC_TELEMETRY || 'datasensors';
const TOPIC_CONTROL = process.env.MQTT_TOPIC_CONTROL || 'devicecontrol';
const TOPIC_RESPONSE = process.env.MQTT_TOPIC_RESPONSE || 'deviceresponse';
const TOPIC_STATUS = process.env.MQTT_TOPIC_STATUS || 'devicestatus';
// Payload dang chuoi "Nhiet do: .. | Do am: .. | Anh sang: .. | Thoi gian: .." khong co ma thiet bi
// -> gan cho thiet bi nay
const TEXT_PAYLOAD_DEVICE = process.env.MQTT_LEGACY_DEVICE_ID || 'esp8266-01';

const url = `mqtt://${HOST}:${PORT}`;
let client = null;

const SENSOR_FIELDS = ['temperature', 'humidity', 'light', ...RANDOM_SENSORS.map((s) => s.type)];

// ---- Tra cuu thiet bi / cam bien (cache vi duoc goi moi 2 giay) ----
const deviceCache = new Map(); // device_key -> device row
const sensorCache = new Map(); // `${device.id}:${type}` -> sensor.id

async function getDeviceByKey(key) {
  if (!deviceCache.has(key)) {
    const row = await db.queryOne('SELECT id, device_key, device_name FROM devices WHERE device_key = ?', [key]);
    if (!row) return null;
    deviceCache.set(key, row);
  }
  return deviceCache.get(key);
}

async function getSensorId(deviceId, type) {
  const k = `${deviceId}:${type}`;
  if (!sensorCache.has(k)) {
    const row = await db.queryOne('SELECT id FROM sensors WHERE device_id = ? AND sensor_type = ?', [deviceId, type]);
    if (!row) return null;
    sensorCache.set(k, row.id);
  }
  return sensorCache.get(k);
}

// ---- Phan tich payload ----
function parseTelemetry(raw) {
  try {
    const data = JSON.parse(raw);
    if (data && typeof data === 'object' && !Array.isArray(data)) return data;
  } catch {
    // khong phai JSON -> thu dang chuoi text trong bao cao
  }
  const num = (re) => {
    const m = raw.match(re);
    return m ? Number(m[1].replace(',', '.')) : undefined;
  };
  const data = {
    device_id: TEXT_PAYLOAD_DEVICE,
    temperature: num(/Nhiet\s*do:\s*(-?\d+(?:[.,]\d+)?)/i),
    humidity: num(/Do\s*am:\s*(-?\d+(?:[.,]\d+)?)/i),
    light: num(/Anh\s*sang:\s*(-?\d+(?:[.,]\d+)?)/i),
  };
  return SENSOR_FIELDS.some((f) => data[f] !== undefined) ? data : null;
}

function parseJson(raw) {
  try {
    const data = JSON.parse(raw);
    return data && typeof data === 'object' && !Array.isArray(data) ? data : null;
  } catch {
    return null;
  }
}

// ---- Xu ly tung topic ----
async function handleTelemetry(raw) {
  const data = parseTelemetry(raw);
  if (!data) {
    console.warn(`[MQTT] Bo qua payload khong hop le tren ${TOPIC_TELEMETRY}: ${raw}`);
    return;
  }
  const device = await getDeviceByKey(String(data.device_id || TEXT_PAYLOAD_DEVICE));
  if (!device) {
    console.warn(`[MQTT] Nhan du lieu tu thiet bi chua dang ky: ${data.device_id}`);
    return;
  }

  const rows = [];
  for (const type of SENSOR_FIELDS) {
    if (data[type] === undefined || data[type] === null || data[type] === '') continue;
    const value = Number(data[type]);
    if (!Number.isFinite(value)) continue;
    const sensorId = await getSensorId(device.id, type);
    if (sensorId) rows.push([sensorId, value]);
  }
  if (rows.length) {
    // Cung mot thoi diem cho ca 3 gia tri cua mot lan do
    await db.query('INSERT INTO data_sensor (sensor_id, value, `timestamp`) VALUES ?', [
      rows.map(([sensorId, value]) => [sensorId, value, new Date()]),
    ]);
  }
  await deviceState.markSeen(device.id);
}

// Cac lenh dang cho ACK: { deviceId, command, resolve }
const waiters = [];
const LOST_NOTE = 'Thiết bị mất kết nối, lệnh không được thực hiện';
const PENDING_NOTE = 'Thiết bị mất kết nối, đang chờ thiết bị quay lại';

async function handleResponse(raw) {
  const data = parseJson(raw);
  if (!data || !data.device_id) return;
  const device = await getDeviceByKey(String(data.device_id));
  if (!device) return;

  deviceState.setLedStates(device.id, data);
  await deviceState.markSeen(device.id);

  // ESP8266 tra ve action da chuan hoa (vd "LED1_ON") -> khop voi lenh dang cho som nhat
  const command = String(data.action || '').trim().toUpperCase().replace(/\s+/g, '_');
  const idx = waiters.findIndex((w) => w.deviceId === device.id && w.command === command);
  if (idx === -1) return;
  const [waiter] = waiters.splice(idx, 1);
  const ok = String(data.result || '').toUpperCase() === 'SUCCESS';
  waiter.resolve({
    result: ok ? 'ok' : 'fail',
    note: ok ? null : `Thiết bị từ chối lệnh (result=${data.result || 'không rõ'})`,
  });
}

async function handleStatus(raw, retained) {
  const data = parseJson(raw);
  if (!data || !data.device_id) return;
  const device = await getDeviceByKey(String(data.device_id));
  if (!device) return;
  if (String(data.status).toLowerCase() !== 'online') {
    await deviceState.markOffline(device.id);
    return;
  }
  await deviceState.markSeen(device.id);
  if (retained) return;
  // ESP vua ket noi lai -> lenh dang cho ACK da mat (khong doi het timeoutMs)
  for (let i = waiters.length - 1; i >= 0; i--) {
    if (waiters[i].deviceId !== device.id) continue;
    const [waiter] = waiters.splice(i, 1);
    waiter.resolve({ result: 'fail', note: LOST_NOTE });
  }
}

function start() {
  client = mqtt.connect(url, {
    clientId: `${process.env.MQTT_CLIENT_ID || 'iot-backend'}-${Math.random().toString(16).slice(2, 8)}`,
    username: process.env.MQTT_USERNAME || undefined,
    password: process.env.MQTT_PASSWORD || undefined,
    reconnectPeriod: 3000,
    connectTimeout: 10000,
  });

  client.on('connect', () => {
    console.log(`[MQTT] Da ket noi toi broker ${url}`);
    client.subscribe([TOPIC_TELEMETRY, TOPIC_RESPONSE, TOPIC_STATUS], { qos: 0 }, (err) => {
      if (err) console.error('[MQTT] Loi subscribe:', err.message);
      else console.log(`[MQTT] Da subscribe: ${TOPIC_TELEMETRY}, ${TOPIC_RESPONSE}, ${TOPIC_STATUS}`);
    });
  });
  client.on('reconnect', () => console.log(`[MQTT] Dang thu ket noi lai ${url} ...`));
  client.on('error', (err) => console.error('[MQTT] Loi:', err.message));

  client.on('message', (topic, payload, packet) => {
    const raw = payload.toString().trim();
    let task;
    if (topic === TOPIC_TELEMETRY) task = handleTelemetry(raw);
    else if (topic === TOPIC_RESPONSE) task = handleResponse(raw);
    else if (topic === TOPIC_STATUS) task = handleStatus(raw, packet.retain);
    if (task) task.catch((e) => console.error(`[MQTT] Loi xu ly ban tin ${topic}:`, e.message));
  });
}

function isConnected() {
  return Boolean(client && client.connected);
}

// Publish lenh va cho ACK toi da timeoutMs.
// Thiet bi offline, hoac im lang suot thoi gian cho -> 'pending' (ket thuc khi thiet bi quay lai).
// Thiet bi van gui du lieu ma khong ACK -> 'timeout'.
// Tra ve { result: 'ok' | 'fail' | 'timeout' | 'pending', note }
async function sendCommand(deviceId, command, timeoutMs) {
  if (!isConnected()) {
    return { result: 'fail', note: 'Backend chưa kết nối được tới MQTT Broker' };
  }
  if (!deviceState.isOnline(deviceId)) return { result: 'pending', note: PENDING_NOTE };

  let waiter;
  const ack = new Promise((resolve) => {
    waiter = { deviceId, command, resolve };
    waiters.push(waiter);
  });
  try {
    await new Promise((resolve, reject) => {
      client.publish(TOPIC_CONTROL, command, { qos: 1 }, (err) => (err ? reject(err) : resolve()));
    });
  } catch (err) {
    waiters.splice(waiters.indexOf(waiter), 1);
    return { result: 'fail', note: `Không gửi được lệnh lên MQTT Broker: ${err.message}` };
  }

  const sentAt = Date.now();
  let timer;
  const timeout = new Promise((resolve) => {
    timer = setTimeout(() => {
      const i = waiters.indexOf(waiter);
      if (i !== -1) waiters.splice(i, 1);
      if (deviceState.seenSince(deviceId, sentAt)) resolve({ result: 'timeout', note: 'Không nhận được phản hồi từ thiết bị' });
      else resolve({ result: 'pending', note: PENDING_NOTE });
    }, timeoutMs);
  });
  const outcome = await Promise.race([ack, timeout]);
  clearTimeout(timer);
  return outcome;
}

module.exports = { start, isConnected, sendCommand };
