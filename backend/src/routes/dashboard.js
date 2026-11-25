// GET /api/dashboard (muc 4.3.1) - chi doc: SELECT data_sensor JOIN sensors, JOIN devices
// Tham so (tuy chon):
//   device_id : id hoac device_key cua thiet bi (mac dinh: thiet bi dau tien)
//   from, to  : khoang thoi gian cho bieu do + cao/thap nhat (mac dinh 24 gio gan nhat)
//   interval  : so giay gop diem bieu do (lay trung binh); bo trong = moi lan do la 1 diem
//   limit     : so diem toi da cua bieu do (mac dinh 30, toi da 500)
const express = require('express');
const db = require('../db');
const deviceState = require('../services/deviceState');
const { NOT_RANDOM_SQL } = require('../services/randomSensors');
const { parseDateParam, toSqlUtc, BadRequest } = require('../utils/params');

const router = express.Router();

async function findDevice(ref) {
  if (ref === undefined || ref === '') {
    return db.queryOne('SELECT * FROM devices ORDER BY id LIMIT 1');
  }
  return db.queryOne('SELECT * FROM devices WHERE id = ? OR device_key = ? LIMIT 1', [Number(ref) || 0, String(ref)]);
}

router.get('/', async (req, res, next) => {
  try {
    const limit = Math.min(Math.max(Number.parseInt(req.query.limit, 10) || 30, 1), 500);
    const interval = req.query.interval ? Number.parseInt(req.query.interval, 10) : 0;
    if (req.query.interval && !(interval > 0)) throw new BadRequest('Tham số interval phải là số giây > 0');
    const to = parseDateParam(req.query.to, 'to') || toSqlUtc(new Date(Date.now() + 60 * 1000));
    const from = parseDateParam(req.query.from, 'from') || toSqlUtc(new Date(Date.now() - 24 * 3600 * 1000));

    const device = await findDevice(req.query.device_id);
    if (!device) {
      return res.json({ latestSensors: [], chartSeries: [], deviceStatus: [], updatedAt: null });
    }

    const sensors = await db.query(
      `SELECT id, sensor_name, sensor_type, unit FROM sensors WHERE device_id = ? AND ${NOT_RANDOM_SQL} ORDER BY id`,
      [device.id]
    );

    const latestSensors = [];
    const chartSeries = [];
    let updatedAt = null;

    for (const s of sensors) {
      const latest = await db.queryOne(
        'SELECT value, `timestamp` FROM data_sensor WHERE sensor_id = ? ORDER BY `timestamp` DESC, id DESC LIMIT 1',
        [s.id]
      );
      const range = await db.queryOne(
        'SELECT MIN(value) AS min, MAX(value) AS max FROM data_sensor WHERE sensor_id = ? AND `timestamp` BETWEEN ? AND ?',
        [s.id, from, to]
      );

      let points;
      if (interval > 0) {
        points = await db.query(
          `SELECT FROM_UNIXTIME(bucket * ?) AS \`timestamp\`, value FROM (
             SELECT FLOOR(UNIX_TIMESTAMP(\`timestamp\`) / ?) AS bucket, ROUND(AVG(value), 2) AS value
             FROM data_sensor
             WHERE sensor_id = ? AND \`timestamp\` BETWEEN ? AND ?
             GROUP BY bucket
             ORDER BY bucket DESC LIMIT ?
           ) t ORDER BY bucket ASC`,
          [interval, interval, s.id, from, to, limit]
        );
      } else {
        points = await db.query(
          `SELECT * FROM (
             SELECT id, \`timestamp\`, value FROM data_sensor
             WHERE sensor_id = ? AND \`timestamp\` BETWEEN ? AND ?
             ORDER BY \`timestamp\` DESC, id DESC LIMIT ?
           ) t ORDER BY \`timestamp\` ASC, id ASC`,
          [s.id, from, to, limit]
        );
      }

      latestSensors.push({
        sensor_id: s.id,
        type: s.sensor_type,
        name: s.sensor_name,
        unit: s.unit || '',
        value: latest ? latest.value : null,
        min: range && range.min !== null ? range.min : null,
        max: range && range.max !== null ? range.max : null,
        timestamp: latest ? latest.timestamp : null,
      });
      chartSeries.push({
        sensor_id: s.id,
        type: s.sensor_type,
        name: s.sensor_name,
        unit: s.unit || '',
        points: points.map((p) => ({ timestamp: p.timestamp, value: Number(p.value) })),
      });
      if (latest && (!updatedAt || latest.timestamp > updatedAt)) updatedAt = latest.timestamp;
    }

    const devices = await db.query('SELECT id, device_key, device_name, status FROM devices ORDER BY id');
    const deviceStatus = await Promise.all(
      devices.map(async (d) => {
        const leds = await deviceState.getLedStates(d.id);
        return {
          id: d.id,
          device_id: d.device_key,
          name: d.device_name,
          status: d.status,
          led1_state: leds.led1,
          led2_state: leds.led2,
          led3_state: leds.led3,
          last_actions: await deviceState.getLastActions(d.id),
        };
      })
    );

    res.json({ latestSensors, chartSeries, deviceStatus, updatedAt });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
