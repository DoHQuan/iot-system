const express = require('express');
const db = require('../db');
const { requireAuth } = require('../middleware/auth');
const { publishCommand } = require('../mqtt');

const router = express.Router();

const getDeviceByKey = db.prepare('SELECT * FROM devices WHERE device_key = ?');
const insertAction = db.prepare(
  `INSERT INTO device_actions (device_id, target, action, issued_by, result, timestamp)
   VALUES (?, ?, ?, ?, 'pending', CURRENT_TIMESTAMP)`
);
const getAction = db.prepare('SELECT * FROM device_actions WHERE id = ?');
const setTimeoutResult = db.prepare(
  `UPDATE device_actions SET result = 'timeout' WHERE id = ? AND result = 'pending'`
);
const setFailResult = db.prepare(
  `UPDATE device_actions SET result = 'fail', note = ? WHERE id = ? AND result = 'pending'`
);

const COMMAND_TIMEOUT_MS = Number(process.env.COMMAND_TIMEOUT_SEC || 10) * 1000;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Dich target (den) sang tien to lenh ma firmware hieu.
const TARGET_PREFIX = { led1: 'LED1', led2: 'LED2', led3: 'LED3', all: 'ALL' };

router.post('/', requireAuth, async (req, res) => {
  const { device_id: deviceKey, target, action } = req.body || {};
  const normalizedTarget = String(target || '').toLowerCase();
  const normalizedAction = String(action || '').toUpperCase();

  if (!deviceKey || !TARGET_PREFIX[normalizedTarget] || !['ON', 'OFF'].includes(normalizedAction)) {
    return res.status(400).json({
      message: 'Thiếu device_id, target phải là led1/led2/led3/all và action phải là ON/OFF',
    });
  }

  const device = getDeviceByKey.get(deviceKey);
  if (!device) {
    return res.status(404).json({ message: `Không tìm thấy thiết bị ${deviceKey}` });
  }

  // Lenh gui xuong ESP8266: vd "LED1_ON", "LED2_OFF", "ALL_ON".
  const command = `${TARGET_PREFIX[normalizedTarget]}_${normalizedAction}`;

  const info = insertAction.run(device.id, normalizedTarget, normalizedAction, req.user.id);
  const actionId = info.lastInsertRowid;

  try {
    await publishCommand(command);
  } catch (e) {
    const message = `Không gửi được lệnh tới MQTT Broker: ${e.message}`;
    setFailResult.run(message, actionId);
    return res.status(502).json({
      cmd_id: actionId,
      result: 'fail',
      message,
    });
  }

  // Cho ACK tu ESP8266 (qua topic deviceresponse) trong thoi gian gioi han
  const deadline = Date.now() + COMMAND_TIMEOUT_MS;
  let current = getAction.get(actionId);
  while (current.result === 'pending' && Date.now() < deadline) {
    await sleep(200);
    current = getAction.get(actionId);
  }

  if (current.result === 'pending') {
    setTimeoutResult.run(actionId);
    current = getAction.get(actionId);
  }

  const httpStatus = current.result === 'ok' ? 200 : current.result === 'timeout' ? 504 : 502;
  res.status(httpStatus).json({
    cmd_id: current.id,
    device_id: deviceKey,
    target: normalizedTarget,
    action: normalizedAction,
    result: current.result,
    message: current.note || undefined,
  });
});

module.exports = router;
