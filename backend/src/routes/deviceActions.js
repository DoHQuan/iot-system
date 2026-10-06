const express = require('express');
const db = require('../db');

const router = express.Router();

const SORT_MAP = {
  time_desc: 'da.timestamp DESC',
  time_asc: 'da.timestamp ASC',
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

  if (req.query.search) {
    where.push('(d.device_name LIKE @search OR da.target LIKE @search OR u.full_name LIKE @search)');
    params.search = `%${req.query.search}%`;
  }
  if (req.query.device) {
    where.push('d.device_key = @device');
    params.device = req.query.device;
  }
  if (req.query.action) {
    where.push('da.action = @action');
    params.action = req.query.action;
  }
  if (req.query.result) {
    where.push('da.result = @result');
    params.result = req.query.result;
  }
  if (req.query.from) {
    where.push('da.timestamp >= @from');
    params.from = req.query.from;
  }
  if (req.query.to) {
    where.push('da.timestamp <= @to');
    params.to = req.query.to;
  }

  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

  const baseFrom = `
    FROM device_actions da
    JOIN devices d ON d.id = da.device_id
    LEFT JOIN users u ON u.id = da.issued_by
    ${whereSql}
  `;

  const total = db.prepare(`SELECT COUNT(*) AS c ${baseFrom}`).get(params).c;

  const items = db
    .prepare(
      `SELECT
         da.id AS id,
         d.device_key AS device_id,
         d.device_name AS device_name,
         da.target AS target,
         da.action AS action,
         da.result AS result,
         u.full_name AS issued_by,
         da.note AS note,
         da.timestamp AS time
       ${baseFrom}
       ORDER BY ${orderBy}
       LIMIT @limit OFFSET @offset`
    )
    .all({ ...params, limit: size, offset: (page - 1) * size });

  res.json({ items, total, page, size });
});

module.exports = router;
