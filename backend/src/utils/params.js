// Ham tien ich doc/kiem tra tham so query (phan trang, thoi gian, so sanh gia tri).

// Mui gio nguoi dung nhap o o tim kiem thoi gian (dang +HH:MM)
const APP_TZ = /^[+-]\d{2}:\d{2}$/.test(process.env.APP_TZ || '') ? process.env.APP_TZ : '+07:00';

class BadRequest extends Error {
  constructor(message) {
    super(message);
    this.status = 400;
  }
}

// page/size khong hop le -> dung gia tri mac dinh (theo muc 4.3.2 bao cao)
function pagination(q, defaultSize = 10, maxSize = 100) {
  const page = Number.parseInt(q.page, 10);
  const size = Number.parseInt(q.size, 10);
  const p = Number.isFinite(page) && page > 0 ? page : 1;
  const s = Number.isFinite(size) && size > 0 ? Math.min(size, maxSize) : defaultSize;
  return { page: p, size: s, offset: (p - 1) * s };
}

function pickSort(value, allowed, fallback) {
  return Object.prototype.hasOwnProperty.call(allowed, value) ? allowed[value] : allowed[fallback];
}

const pad2 = (n) => String(n).padStart(2, '0');

function toSqlUtc(d) {
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())} `
    + `${pad2(d.getUTCHours())}:${pad2(d.getUTCMinutes())}:${pad2(d.getUTCSeconds())}`;
}

// from/to: "YYYY-MM-DD[ HH:MM[:SS]]" (hieu la UTC, giong du lieu API tra ve) hoac chuoi ISO co mui gio
function parseDateParam(value, name) {
  if (value === undefined || value === null || value === '') return null;
  const s = String(value).trim();
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?$/);
  const d = m
    ? new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +(m[4] || 0), +(m[5] || 0), +(m[6] || 0)))
    : new Date(s);
  if (Number.isNaN(d.getTime())) throw new BadRequest(`Tham số ${name} không hợp lệ`);
  return toSqlUtc(d);
}

// Tim theo thoi gian dang hien thi tren giao dien (gio dia phuong), vd "26/08/2026 22:52", "22:52", "26/8/2026"
// -> tra ve [dieu kien SQL, tham so]
function timeTextFilter(column, value) {
  // "26/08/2026 - 22:52" -> "26/08/2026 22:52"
  const text = String(value || '').trim().replace(/\s*-\s*(?=\d{1,2}:)/, ' ').replace(/\s+/g, ' ');
  if (!text) return null;
  const normalized = text.replace(/(^|\D)(\d)(?=\D|$)/g, (_, pre, d) => `${pre}0${d}`); // 26/8/2026 9:05 -> 26/08/2026 09:05
  const local = `CONVERT_TZ(${column}, '+00:00', '${APP_TZ}')`;
  return [
    `(DATE_FORMAT(${local}, '%d/%m/%Y %H:%i:%s') LIKE ? OR DATE_FORMAT(${local}, '%Y-%m-%d %H:%i:%s') LIKE ?)`,
    [`%${normalized}%`, `%${normalized}%`],
  ];
}

// value: "25.5", ">30", "<=20" ... -> [dieu kien SQL, tham so]
function valueFilter(column, value) {
  const text = String(value || '').replace(/\s+/g, '').replace(',', '.');
  if (!text) return null;
  const m = text.match(/^(>=|<=|>|<|=)?(-?\d+(?:\.\d+)?)$/);
  if (!m) throw new BadRequest('Tham số value không hợp lệ (VD: 25.5, >30, <=20)');
  const op = m[1] || '=';
  const x = Number(m[2]);
  if (op === '=') return [`ABS(${column} - ?) < 0.0001`, [x]];
  return [`${column} ${op} ?`, [x]];
}

module.exports = { BadRequest, pagination, pickSort, parseDateParam, timeTextFilter, valueFilter, toSqlUtc };
