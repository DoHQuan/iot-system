// POST /api/control (muc 4.3.3)
// Body: { "device_id": 1, "target": "led1", "action": "ON" }
//   device_id: id thiet bi hoac device_key ("esp8266-01"); chap nhan ca truong "device" (Frontend gui)
//   target   : led1 | led2 | led3 | all
//   action   : ON | OFF
// Luong: INSERT device_actions (pending) -> publish devicecontrol -> cho ACK deviceresponse
//        -> UPDATE result = ok | fail | timeout (+ note), hoac giu pending neu mat ket noi
// Ket qua: 200 { cmd_id, result: "ok" }
//          502 { cmd_id, result: "fail", message }    thiet bi tu choi / khong gui duoc lenh
//          504 { cmd_id, result: "timeout", message } thiet bi van hoat dong nhung khong phan hoi
//          202 { cmd_id, result: "pending", message } thiet bi mat ket noi -> giu pending,
//              chuyen thanh fail khi thiet bi ket noi lai
const express = require('express');
const db = require('../db');
const mqttBridge = require('../mqtt');
const deviceState = require('../services/deviceState');

const router = express.Router();

const TARGETS = { led1: 'LED1', led2: 'LED2', led3: 'LED3', all: 'ALL' };
const ACTIONS = ['ON', 'OFF'];
const TIMEOUT_MS = Number(process.env.COMMAND_TIMEOUT_SEC || 10) * 1000;

router.post('/', async (req, res, next) => {
  try {
    const body = req.body || {};
    const deviceRef = body.device_id ?? body.device;
    const target = String(body.target || '').trim().toLowerCase();
    const action = String(body.action || '').trim().toUpperCase();

    if (deviceRef === undefined || deviceRef === null || deviceRef === '') {
      return res.status(400).json({ message: 'Thiếu device_id' });
    }
    if (!TARGETS[target]) {
      return res.status(400).json({ message: 'target phải là led1, led2, led3 hoặc all' });
    }
    if (!ACTIONS.includes(action)) {
      return res.status(400).json({ message: 'action phải là ON hoặc OFF' });
    }

    const device = await db.queryOne('SELECT id, device_key, device_name FROM devices WHERE id = ? OR device_key = ? LIMIT 1', [
      Number(deviceRef) || 0,
      String(deviceRef),
    ]);
    if (!device) return res.status(404).json({ message: `Không tìm thấy thiết bị: ${deviceRef}` });

    // 1. Ghi lenh voi result = pending
    const inserted = await db.query(
      "INSERT INTO device_actions (device_id, target, action, issued_by, result, `timestamp`) VALUES (?, ?, ?, ?, 'pending', ?)",
      [device.id, target, action, req.user.id, new Date()]
    );
    const cmdId = inserted.insertId;

    // 2. Publish lenh MQTT va cho ACK
    const command = `${TARGETS[target]}_${action}`;
    const { result, note } = await mqttBridge.sendCommand(device.id, command, TIMEOUT_MS);

    // 3. Cap nhat ket qua
    if (result === 'pending') {
      await db.query("UPDATE device_actions SET note = ? WHERE id = ? AND result = 'pending'", [note, cmdId]);
      deviceState.expectReturn(device.id);
    } else {
      await db.query('UPDATE device_actions SET result = ?, note = ? WHERE id = ?', [result, note || null, cmdId]);
    }

    const payload = {
      cmd_id: cmdId,
      result,
      device_id: device.id,
      device_key: device.device_key,
      target,
      action,
      command,
      leds: await deviceState.getLedStates(device.id),
    };
    if (result === 'ok') return res.json(payload);
    if (result === 'pending') return res.status(202).json({ ...payload, message: note });
    return res.status(result === 'timeout' ? 504 : 502).json({ ...payload, message: note });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
