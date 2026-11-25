// GET /api/device-actions (muc 4.3.4) - chi doc device_actions JOIN devices, users
// Tham so: page, size, sort (time_desc|time_asc), search, device (id hoac device_key), target,
//          action (ON|OFF), result (pending|ok|fail|timeout), from, to (UTC), time (chuoi thoi gian hien thi)
const express = require('express');
const db = require('../db');
const { BadRequest, pagination, pickSort, parseDateParam, timeTextFilter } = require('../utils/params');

const router = express.Router();

const SORTS = {
  time_desc: 'a.`timestamp` DESC, a.id DESC',
  time_asc: 'a.`timestamp` ASC, a.id ASC',
};
const ACTIONS = ['ON', 'OFF'];
const RESULTS = ['pending', 'ok', 'fail', 'timeout'];

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

    const deviceRef = q.device || q.device_id;
    if (deviceRef) add(['(d.id = ? OR d.device_key = ?)', [Number(deviceRef) || 0, String(deviceRef)]]);
    if (q.target) add(['a.target = ?', [String(q.target).toLowerCase()]]);
    if (q.action) {
      const action = String(q.action).toUpperCase();
      if (!ACTIONS.includes(action)) throw new BadRequest('Tham số action phải là ON hoặc OFF');
      add(['a.action = ?', [action]]);
    }
    if (q.result) {
      const result = String(q.result).toLowerCase();
      if (!RESULTS.includes(result)) throw new BadRequest('Tham số result phải là pending, ok, fail hoặc timeout');
      add(['a.result = ?', [result]]);
    }
    if (q.search) {
      const like = `%${String(q.search).trim()}%`;
      add([
        '(d.device_name LIKE ? OR a.target LIKE ? OR a.action LIKE ? OR a.result LIKE ? OR u.full_name LIKE ? OR u.username LIKE ? OR a.note LIKE ?)',
        [like, like, like, like, like, like, like],
      ]);
    }
    const from = parseDateParam(q.from, 'from');
    const to = parseDateParam(q.to, 'to');
    if (from) add(['a.`timestamp` >= ?', [from]]);
    if (to) add(['a.`timestamp` <= ?', [to]]);
    add(timeTextFilter('a.`timestamp`', q.time));

    const fromSql = `FROM device_actions a
      JOIN devices d ON d.id = a.device_id
      LEFT JOIN users u ON u.id = a.issued_by
      ${where.length ? 'WHERE ' + where.join(' AND ') : ''}`;

    const [{ total }] = await db.query(`SELECT COUNT(*) AS total ${fromSql}`, params);
    const items = await db.query(
      `SELECT a.id, a.device_id, d.device_key, d.device_name, a.target, a.action, a.result,
              COALESCE(u.full_name, u.username) AS issued_by, a.issued_by AS issued_by_id,
              a.\`timestamp\` AS time, a.note
       ${fromSql}
       ORDER BY ${orderBy}
       LIMIT ? OFFSET ?`,
      [...params, size, offset]
    );

    res.json({ items, total: Number(total), page, size });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
