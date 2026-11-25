// GET /api/sensor-data (muc 4.3.2) - chi doc: SELECT data_sensor JOIN sensors JOIN devices
// Tham so: page, size, sort (time_desc|time_asc|value_desc|value_asc|id_desc|id_asc),
//          search (ten cam bien/thiet bi), type (temperature|humidity|light|random_10|random_100|random_1000), sensor_id, device_id,
//          value (25.5, >30, <=20...), from, to (UTC), time (chuoi thoi gian hien thi, vd "26/08/2026 22:52")
const express = require('express');
const db = require('../db');
const { RANDOM_SENSORS } = require('../services/randomSensors');
const { BadRequest, pagination, pickSort, parseDateParam, timeTextFilter, valueFilter } = require('../utils/params');

const router = express.Router();

const SORTS = {
  time_desc: 'ds.`timestamp` DESC, ds.id DESC',
  time_asc: 'ds.`timestamp` ASC, ds.id ASC',
  value_desc: 'ds.value DESC, ds.id DESC',
  value_asc: 'ds.value ASC, ds.id ASC',
  id_desc: 'ds.id DESC',
  id_asc: 'ds.id ASC',
};
const TYPES = ['temperature', 'humidity', 'light', ...RANDOM_SENSORS.map((s) => s.type)];

router.get('/', async (req, res, next) => {
  try {
    const q = req.query;
    const { page, size, offset } = pagination(q);
    const orderBy = pickSort(q.sort, SORTS, 'time_desc');

    const where = [];
    const params = [];
    const add = (cond) => {
      if (!cond) return;
      where.push(cond[0]);
      params.push(...cond[1]);
    };

    if (q.type) {
      if (!TYPES.includes(q.type)) throw new BadRequest('Tham số type không hợp lệ');
      add(['s.sensor_type = ?', [q.type]]);
    }
    if (q.sensor_id) add(['s.id = ?', [Number(q.sensor_id) || 0]]);
    if (q.device_id) add(['(d.id = ? OR d.device_key = ?)', [Number(q.device_id) || 0, String(q.device_id)]]);
    if (q.search) {
      const like = `%${String(q.search).trim()}%`;
      add(['(s.sensor_name LIKE ? OR s.sensor_type LIKE ? OR d.device_name LIKE ?)', [like, like, like]]);
    }
    add(valueFilter('ds.value', q.value));
    const from = parseDateParam(q.from, 'from');
    const to = parseDateParam(q.to, 'to');
    if (from) add(['ds.`timestamp` >= ?', [from]]);
    if (to) add(['ds.`timestamp` <= ?', [to]]);
    add(timeTextFilter('ds.`timestamp`', q.time));

    const fromSql = `FROM data_sensor ds
      JOIN sensors s ON s.id = ds.sensor_id
      JOIN devices d ON d.id = s.device_id
      ${where.length ? 'WHERE ' + where.join(' AND ') : ''}`;

    const [{ total }] = await db.query(`SELECT COUNT(*) AS total ${fromSql}`, params);
    const items = await db.query(
      `SELECT ds.id, ds.sensor_id, s.sensor_name, s.sensor_type, ds.value, s.unit,
              ds.\`timestamp\` AS time, d.id AS device_id, d.device_key, d.device_name
       ${fromSql}
       ORDER BY ${orderBy}
       LIMIT ? OFFSET ?`,
      [...params, size, offset]
    );

    res.json({
      items: items.map((r) => ({ ...r, unit: r.unit || '' })),
      total: Number(total),
      page,
      size,
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
