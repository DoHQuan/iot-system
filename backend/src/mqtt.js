const mqtt = require('mqtt');
const db = require('./db');

const HOST = process.env.MQTT_HOST || 'localhost';
const PORT = process.env.MQTT_PORT || 1883;
const USERNAME = process.env.MQTT_USERNAME || undefined;
const PASSWORD = process.env.MQTT_PASSWORD || undefined;
const CLIENT_ID = process.env.MQTT_CLIENT_ID || 'iot-backend';

const TOPIC_TELEMETRY = process.env.MQTT_TOPIC_TELEMETRY || 'datasensors';
const TOPIC_CONTROL = process.env.MQTT_TOPIC_CONTROL || 'devicecontrol';
const TOPIC_RESPONSE = process.env.MQTT_TOPIC_RESPONSE || 'deviceresponse';
const TOPIC_STATUS = process.env.MQTT_TOPIC_STATUS || 'devicestatus';

const url = `mqtt://${HOST}:${PORT}`;
const client = mqtt.connect(url, {
  clientId: CLIENT_ID,
  username: USERNAME,
  password: PASSWORD,
  reconnectPeriod: 3000,
  connectTimeout: 10000,
});

const getDeviceByKey = db.prepare('SELECT * FROM devices WHERE device_key = ?');
const getSensor = db.prepare('SELECT * FROM sensors WHERE device_id = ? AND sensor_type = ?');
const insertSensorValue = db.prepare(
  'INSERT INTO data_sensor (sensor_id, value, timestamp) VALUES (?, ?, CURRENT_TIMESTAMP)'
);
const touchDeviceOnline = db.prepare(
  `UPDATE devices SET status = 'online', last_seen = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id = ?`
);
const setDeviceStatus = db.prepare(
  `UPDATE devices SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`
);
const findPendingAction = db.prepare(
  `SELECT * FROM device_actions
   WHERE device_id = ? AND target = ? AND action = ? AND result = 'pending'
   ORDER BY timestamp DESC LIMIT 1`
);
const updateActionResult = db.prepare(
  `UPDATE device_actions SET result = ?, note = ? WHERE id = ?`
);
const setLed1State = db.prepare(
  `UPDATE devices SET led1_state = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`
);
const setLed2State = db.prepare(
  `UPDATE devices SET led2_state = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`
);
const setLed3State = db.prepare(
  `UPDATE devices SET led3_state = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`
);

const SENSOR_FIELDS = ['temperature', 'humidity', 'light'];

client.on('connect', () => {
  console.log(`[MQTT] Da ket noi toi broker ${url}`);
  client.subscribe([TOPIC_TELEMETRY, TOPIC_RESPONSE, TOPIC_STATUS], (err) => {
    if (err) {
      console.error('[MQTT] Loi subscribe:', err.message);
    } else {
      console.log(`[MQTT] Da subscribe: ${TOPIC_TELEMETRY}, ${TOPIC_RESPONSE}, ${TOPIC_STATUS}`);
    }
  });
});

client.on('reconnect', () => console.log('[MQTT] Dang thu ket noi lai...'));
client.on('error', (err) => console.error('[MQTT] Loi:', err.message));

client.on('message', (topic, payloadBuf) => {
  const raw = payloadBuf.toString();
  let data;
  try {
    data = JSON.parse(raw);
  } catch (e) {
    // Legacy telemetry has no device ID; enable only for the configured device.
    const legacyDeviceKey = process.env.MQTT_LEGACY_DEVICE_ID;
    const match = topic === TOPIC_TELEMETRY && legacyDeviceKey && raw.trim().match(
      /^Nhiet do:\s*(-?\d+(?:\.\d+)?)\s*C\s*\|\s*Do am:\s*(\d+(?:\.\d+)?)\s*%\s*\|\s*Anh sang:\s*(\d+(?:\.\d+)?)\s*\|\s*Thoi gian:\s*\d{2}\/\d{2}\/\d{4}\s+\d{2}:\d{2}:\d{2}$/
    );
    if (!match) {
      console.warn(`[MQTT] Bo qua payload khong phai JSON tren topic ${topic}: ${raw}`);
      return;
    }
    data = {
      device_id: legacyDeviceKey,
      temperature: Number(match[1]),
      humidity: Number(match[2]),
      light: Number(match[3]),
    };
  }
  if (!data || typeof data !== 'object' || Array.isArray(data)) return;

  if (topic === TOPIC_TELEMETRY) handleTelemetry(data);
  else if (topic === TOPIC_RESPONSE) handleResponse(data);
  else if (topic === TOPIC_STATUS) handleStatus(data);
});

function handleTelemetry(data) {
  const deviceKey = data.device_id;
  if (!deviceKey) return;
  const device = getDeviceByKey.get(deviceKey);
  if (!device) {
    console.warn(`[MQTT] Nhan telemetry tu thiet bi chua dang ky: ${deviceKey}`);
    return;
  }

  for (const field of SENSOR_FIELDS) {
    if (data[field] === undefined || data[field] === null) continue;
    const value = Number(data[field]);
    if (Number.isNaN(value)) continue;
    const sensor = getSensor.get(device.id, field);
    if (!sensor) continue;
    insertSensorValue.run(sensor.id, value);
  }

  touchDeviceOnline.run(device.id);
}

// Chuyen chuoi action tu firmware (vd "LED1_ON", "ALL_OFF", "ON") thanh
// { target: 'led1' | 'led2' | 'all', state: 'ON' | 'OFF' } de khop voi
// ban ghi da luu trong device_actions (target + action).
function parseAction(action) {
  const state = action.endsWith('OFF') ? 'OFF' : action.endsWith('ON') ? 'ON' : null;
  if (!state) return null;
  let target = 'all';
  if (action.startsWith('LED1')) target = 'led1';
  else if (action.startsWith('LED2')) target = 'led2';
  else if (action.startsWith('LED3')) target = 'led3';
  return { target, state };
}

function normState(value) {
  const s = String(value || '').toUpperCase();
  return s === 'ON' || s === 'OFF' ? s : null;
}

function handleResponse(data) {
  // Payload tu firmware: { device_id, action, led1, led2, result, time }
  const deviceKey = data.device_id;
  const action = (data.action || '').toUpperCase();
  if (!deviceKey || !action) return;
  const device = getDeviceByKey.get(deviceKey);
  if (!device) return;

  // Firmware luon bao ca 2 den trong moi ACK -> dong bo trang thai ngay.
  const led1 = normState(data.led1);
  const led2 = normState(data.led2);
  const led3 = normState(data.led3);
  if (led1) setLed1State.run(led1, device.id);
  if (led2) setLed2State.run(led2, device.id);
  if (led3) setLed3State.run(led3, device.id);

  // "SYNC" chi de dong bo trang thai khi ESP vua ket noi, khong gan voi lenh nao.
  const parsed = parseAction(action);
  if (parsed) {
    const ok = String(data.result).toUpperCase() === 'SUCCESS';
    // Khop ACK voi lenh dang cho (theo dung den va ON/OFF).
    if (parsed.target === 'all') {
      for (const t of ['all', 'led1', 'led2', 'led3']) {
        const pending = findPendingAction.get(device.id, t, parsed.state);
        if (pending) {
          updateActionResult.run(ok ? 'ok' : 'fail', ok ? null : `ESP8266 result=${data.result}`, pending.id);
        }
      }
    } else {
      const pending = findPendingAction.get(device.id, parsed.target, parsed.state);
      if (pending) {
        updateActionResult.run(ok ? 'ok' : 'fail', ok ? null : `ESP8266 result=${data.result}`, pending.id);
      }
    }
  }

  touchDeviceOnline.run(device.id);
}

function handleStatus(data) {
  const deviceKey = data.device_id;
  if (!deviceKey) return;
  const device = getDeviceByKey.get(deviceKey);
  if (!device) return;
  const status = String(data.status || '').toLowerCase() === 'online' ? 'online' : 'offline';
  setDeviceStatus.run(status, device.id);
}

// Neu khong nhan telemetry qua lau thi tu dong danh dau thiet bi offline
// (bu cho truong hop firmware chua gui LWT hoac mat ket noi dot ngot).
const OFFLINE_TIMEOUT_SEC = Number(process.env.DEVICE_OFFLINE_TIMEOUT_SEC || 15);
const markStaleOffline = db.prepare(`
  UPDATE devices SET status = 'offline'
  WHERE status = 'online'
    AND (last_seen IS NULL OR (strftime('%s','now') - strftime('%s', last_seen)) > ?)
`);
setInterval(() => {
  try {
    markStaleOffline.run(OFFLINE_TIMEOUT_SEC);
  } catch (e) {
    console.error('[DB] Loi kiem tra thiet bi offline:', e.message);
  }
}, 5000);

function publishCommand(action) {
  return new Promise((resolve, reject) => {
    if (!client.connected) {
      reject(new Error('Backend chưa kết nối được tới MQTT Broker'));
      return;
    }
    client.publish(TOPIC_CONTROL, action, { qos: 1 }, (err) => {
      if (err) reject(err);
      else resolve();
    });
  });
}

module.exports = { client, publishCommand };
