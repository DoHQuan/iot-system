// GET /api/random-sensors - 3 cam bien ngau nhien va canh bao > 50% thang do
// Tham so: page, size (phan trang lich su), device_id (id hoac device_key, mac dinh: thiet bi dau tien)
// Tra ve: { device_status, sensors: [{ type, name, max, threshold, value, warning, time }], items[], total, page, size }
const express = require('express');
const db = require('../db');
const { RANDOM_SENSORS, isWarning } = require('../services/randomSensors');
const { pagination } = require('../utils/params');

const router = express.Router();

router.get('/', async (req, res, next) => {
  try {
    const { page, size, offset } = pagination(req.query);
    const ref = req.query.device_id;
    const device = ref
      ? await db.queryOne('SELECT id, status FROM devices WHERE id = ? OR device_key = ? LIMIT 1', [Number(ref) || 0, String(ref)])
      : await db.queryOne('SELECT id, status FROM devices ORDER BY id LIMIT 1');
    if (!device) return res.json({ device_status: 'offline', sensors: [], items: [], total: 0, page, size });

    const rows = await db.query('SELECT id, sensor_type FROM sensors WHERE device_id = ? AND sensor_type IN (?)', [
      device.id,
      RANDOM_SENSORS.map((s) => s.type),
    ]);
    const idByType = Object.fromEntries(rows.map((r) => [r.sensor_type, r.id]));
    const byType = Object.fromEntries(RANDOM_SENSORS.map((s) => [s.type, s]));

    const sensors = [];
    for (const s of RANDOM_SENSORS) {
      const latest = await db.queryOne(
        'SELECT value, `timestamp` AS time FROM data_sensor WHERE sensor_id = ? ORDER BY `timestamp` DESC, id DESC LIMIT 1',
        [idByType[s.type] || 0]
      );
      const value = latest ? latest.value : null;
      sensors.push({
        type: s.type,
        name: s.name,
        max: s.max,
        threshold: s.max / 2,
        value,
        warning: isWarning(s, value),
        time: latest ? latest.time : null,
      });
    }

    const ids = rows.map((r) => r.id);
    if (!ids.length) return res.json({ device_status: device.status, sensors, items: [], total: 0, page, size });
    const [{ total }] = await db.query('SELECT COUNT(*) AS total FROM data_sensor WHERE sensor_id IN (?)', [ids]);
    const items = await db.query(
      `SELECT ds.id, s.sensor_name, s.sensor_type, ds.value, ds.\`timestamp\` AS time
       FROM data_sensor ds JOIN sensors s ON s.id = ds.sensor_id
       WHERE ds.sensor_id IN (?)
       ORDER BY ds.\`timestamp\` DESC, ds.id DESC
       LIMIT ? OFFSET ?`,
      [ids, size, offset]
    );

    res.json({
      device_status: device.status,
      sensors,
      items: items.map((it) => ({ ...it, warning: isWarning(byType[it.sensor_type], it.value) })),
      total: Number(total),
      page,
      size,
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
