const express = require('express');
const db = require('../db');

const router = express.Router();

const getDevices = db.prepare('SELECT * FROM devices ORDER BY device_name');
const getSensorsForDevice = db.prepare('SELECT * FROM sensors WHERE device_id = ?');
const getLatestValue = db.prepare(
  'SELECT value, timestamp FROM data_sensor WHERE sensor_id = ? ORDER BY timestamp DESC LIMIT 1'
);
const getSeries = db.prepare(
  'SELECT value, timestamp FROM data_sensor WHERE sensor_id = ? ORDER BY timestamp DESC LIMIT ?'
);
const getMinMax = db.prepare(
  'SELECT MIN(value) AS min, MAX(value) AS max FROM data_sensor WHERE sensor_id = ?'
);

router.get('/', (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 30, 200);
  const devices = getDevices.all();

  const latestSensors = [];
  const chartSeries = [];
  const deviceStatus = [];

  for (const device of devices) {
    deviceStatus.push({
      device_id: device.device_key,
      name: device.device_name,
      status: device.status,
      last_seen: device.last_seen,
      led1_state: device.led1_state || 'OFF',
      led2_state: device.led2_state || 'OFF',
      led3_state: device.led3_state || 'OFF',
      // Giu lai cho tuong thich nguoc (code cu doc led_state)
      led_state: device.led1_state || 'OFF',
    });

    const sensors = getSensorsForDevice.all(device.id);
    for (const sensor of sensors) {
      const latest = getLatestValue.get(sensor.id);
      const minMax = getMinMax.get(sensor.id);
      latestSensors.push({
        device_id: device.device_key,
        device_name: device.device_name,
        sensor_id: sensor.id,
        name: sensor.sensor_name,
        type: sensor.sensor_type,
        unit: sensor.unit,
        value: latest ? latest.value : null,
        timestamp: latest ? latest.timestamp : null,
        min: minMax ? minMax.min : null,
        max: minMax ? minMax.max : null,
      });

      const series = getSeries.all(sensor.id, limit).reverse();
      chartSeries.push({
        sensor_id: sensor.id,
        name: sensor.sensor_name,
        type: sensor.sensor_type,
        unit: sensor.unit,
        points: series.map((p) => ({ timestamp: p.timestamp, value: p.value })),
      });
    }
  }

  res.json({
    latestSensors,
    chartSeries,
    deviceStatus,
    updatedAt: new Date().toISOString(),
  });
});

module.exports = router;
