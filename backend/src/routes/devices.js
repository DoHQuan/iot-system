const express = require('express');
const db = require('../db');
const deviceState = require('../services/deviceState');

const router = express.Router();

// GET /api/devices  -> danh sach thiet bi + cam bien + trang thai den
router.get('/', async (req, res, next) => {
  try {
    const devices = await db.query(
      `SELECT id, device_key, device_name, device_type, status, description, created_at, updated_at
       FROM devices ORDER BY id`
    );
    const sensors = await db.query('SELECT id, device_id, sensor_name, sensor_type, unit FROM sensors ORDER BY id');
    const items = await Promise.all(
      devices.map(async (d) => ({
        ...d,
        sensors: sensors.filter((s) => s.device_id === d.id),
        leds: await deviceState.getLedStates(d.id),
      }))
    );
    res.json({ items, total: items.length });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
