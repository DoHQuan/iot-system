const express = require('express');
const db = require('../db');

const router = express.Router();

const SORT_MAP = {
  time_desc: 'ds.timestamp DESC',
  time_asc: 'ds.timestamp ASC',
  value_desc: 'ds.value DESC',
  value_asc: 'ds.value ASC',
};

router.get('/', (req, res) => {
  let page = parseInt(req.query.page, 10);
  let size = parseInt(req.query.size, 10);
  if (!Number.isInteger(page) || page < 1) page = 1;
  if (!Number.isInteger(size) || size < 1 || size > 200) size = 20;

  const sortKey = SORT_MAP[req.query.sort] ? req.query.sort : 'time_desc';
  const orderBy = SORT_MAP[sortKey];

  const where = [];
  const params = {};

  if (req.query.type) {
    where.push('s.sensor_type = @type');
    params.type = req.query.type;
  }
  if (req.query.search) {
    where.push('(s.sensor_name LIKE @search OR d.device_name LIKE @search OR s.sensor_type LIKE @search)');
    params.search = `%${req.query.search}%`;
  }
  // Loc theo gia tri do: ho tro nhap so thuan (bang chinh xac) hoac
  // toan tu so sanh nhu ">30", "<=20.5" giong placeholder tren giao dien.
  if (req.query.value) {
    const OPS = { '>=': '>=', '<=': '<=', '>': '>', '<': '<', '=': '=' };
    const match = String(req.query.value).trim().match(/^(>=|<=|>|<|=)?\s*(-?\d+(?:\.\d+)?)$/);
    if (match) {
      const op = OPS[match[1] || '='];
      where.push(`ds.value ${op} @value`);
      params.value = Number(match[2]);
    }
  }
  if (req.query.from) {
    where.push('ds.timestamp >= @from');
    params.from = req.query.from;
  }
  if (req.query.to) {
    where.push('ds.timestamp <= @to');
    params.to = req.query.to;
  }

  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

  const baseFrom = `
    FROM data_sensor ds
    JOIN sensors s ON s.id = ds.sensor_id
    JOIN devices d ON d.id = s.device_id
    ${whereSql}
  `;

  const total = db.prepare(`SELECT COUNT(*) AS c ${baseFrom}`).get(params).c;

  const items = db
    .prepare(
      `SELECT
         ds.id AS id,
         d.device_key AS device_id,
         d.device_name AS device_name,
         s.sensor_name AS sensor_name,
         s.sensor_type AS sensor_type,
         s.unit AS unit,
         ds.value AS value,
         ds.timestamp AS time
       ${baseFrom}
       ORDER BY ${orderBy}
       LIMIT @limit OFFSET @offset`
    )
    .all({ ...params, limit: size, offset: (page - 1) * size });

  res.json({ items, total, page, size });
});

module.exports = router;
