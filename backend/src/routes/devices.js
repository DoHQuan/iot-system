const express = require('express');
const db = require('../db');

const router = express.Router();

const getDevices = db.prepare('SELECT device_key, device_name, device_type, status, last_seen FROM devices ORDER BY device_name');

router.get('/', (req, res) => {
  res.json({ items: getDevices.all() });
});

module.exports = router;
