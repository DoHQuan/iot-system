// Trang thai thoi gian thuc cua thiet bi:
// - online/offline: luu o devices.status, tu chuyen offline khi qua DEVICE_OFFLINE_TIMEOUT_SEC khong nhan ban tin
// - trang thai den led1..led3: lay tu ACK (deviceresponse) gan nhat; khi chua co ACK
//   thi suy ra tu lenh 'ok' gan nhat trong device_actions.
const db = require('../db');

const OFFLINE_TIMEOUT_MS = Number(process.env.DEVICE_OFFLINE_TIMEOUT_SEC || 15) * 1000;
const LEDS = ['led1', 'led2', 'led3'];

const lastSeen = new Map();  // device.id -> ms
const ledCache = new Map();  // device.id -> { led1, led2, led3 }
const statusCache = new Map(); // device.id -> 'online' | 'offline'
const lostCommands = new Set(); // device.id dang co lenh pending cho thiet bi quay lai

async function setStatus(deviceId, status) {
  if (statusCache.get(deviceId) === status) return;
  statusCache.set(deviceId, status);
  await db.query('UPDATE devices SET status = ? WHERE id = ?', [status, deviceId]);
}

async function markSeen(deviceId) {
  lastSeen.set(deviceId, Date.now());
  await setStatus(deviceId, 'online');
  if (lostCommands.has(deviceId)) await failLostCommands(deviceId);
}

// Thiet bi quay lai ma lenh van pending -> lenh da mat (ESP ket noi moi, Broker khong giu lenh) -> fail
async function failLostCommands(deviceId) {
  lostCommands.delete(deviceId);
  await db.query(
    "UPDATE device_actions SET result = 'fail', note = ? WHERE device_id = ? AND result = 'pending'",
    ['Thiết bị mất kết nối, lệnh không được thực hiện', deviceId]
  );
}

function expectReturn(deviceId) {
  lostCommands.add(deviceId);
}

function isOnline(deviceId) {
  return statusCache.get(deviceId) === 'online';
}

function seenSince(deviceId, ms) {
  return (lastSeen.get(deviceId) || 0) >= ms;
}

async function markOffline(deviceId) {
  lastSeen.delete(deviceId);
  await setStatus(deviceId, 'offline');
}

function setLedStates(deviceId, states) {
  const current = { ...(ledCache.get(deviceId) || {}) };
  for (const led of LEDS) {
    const v = String(states[led] || '').toUpperCase();
    if (v === 'ON' || v === 'OFF') current[led] = v;
  }
  ledCache.set(deviceId, current);
}

async function getLedStates(deviceId) {
  if (!ledCache.has(deviceId)) {
    const rows = await db.query(
      `SELECT target, action FROM device_actions
       WHERE device_id = ? AND result = 'ok'
       ORDER BY \`timestamp\` DESC, id DESC LIMIT 50`,
      [deviceId]
    );
    const states = {};
    for (const r of rows) {
      const targets = r.target === 'all' ? LEDS : [r.target];
      for (const t of targets) if (LEDS.includes(t) && !states[t]) states[t] = r.action;
    }
    if (!ledCache.has(deviceId)) ledCache.set(deviceId, states);
  }
  const s = ledCache.get(deviceId);
  return { led1: s.led1 || 'OFF', led2: s.led2 || 'OFF', led3: s.led3 || 'OFF' };
}

// Lenh gan nhat cua tung den (lenh 'all' tinh cho ca 3 den) -> Web UI hien PENDING/FAILED
async function getLastActions(deviceId) {
  const rows = await db.query(
    'SELECT target, action, result, note FROM device_actions WHERE device_id = ? ORDER BY id DESC LIMIT 50',
    [deviceId]
  );
  const actions = {};
  for (const r of rows) {
    const targets = r.target === 'all' ? LEDS : [r.target];
    for (const t of targets) if (LEDS.includes(t) && !actions[t]) actions[t] = r;
  }
  return actions;
}

// Khi server khoi dong: chua biet thiet bi nao dang song -> coi la offline cho toi khi nhan ban tin;
// cac lenh con 'pending' tu lan chay truoc se khong bao gio co ACK -> fail khi thiet bi quay lai.
async function init() {
  await db.query("UPDATE devices SET status = 'offline'");
  const rows = await db.query('SELECT id FROM devices');
  rows.forEach((r) => statusCache.set(r.id, 'offline'));
  const pending = await db.query("SELECT DISTINCT device_id FROM device_actions WHERE result = 'pending'");
  pending.forEach((r) => expectReturn(r.device_id));

  setInterval(async () => {
    const now = Date.now();
    for (const [deviceId, ms] of lastSeen) {
      if (now - ms > OFFLINE_TIMEOUT_MS) {
        try {
          await markOffline(deviceId);
          console.log(`[DEVICE] Thiet bi #${deviceId} offline (qua ${OFFLINE_TIMEOUT_MS / 1000}s khong nhan du lieu)`);
        } catch (e) {
          console.error('[DB] Loi cap nhat trang thai offline:', e.message);
        }
      }
    }
  }, 5000).unref();
}

module.exports = {
  init, markSeen, markOffline, isOnline, seenSince, expectReturn, setLedStates, getLedStates, getLastActions, LEDS,
};
