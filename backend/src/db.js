const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');

const DB_CONFIG = {
  host: process.env.DB_HOST || '127.0.0.1',
  port: Number(process.env.DB_PORT || 3306),
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
};
const DB_NAME = process.env.DB_NAME || 'iot_system';
const SQL_FILE = path.resolve(__dirname, '..', 'database', 'iot_system.sql');

// Moi cot thoi gian luu/doc theo UTC; dateStrings de tra ve chuoi "YYYY-MM-DD HH:MM:SS"
// (Frontend tu them 'Z' va doi sang gio dia phuong khi hien thi).
const pool = mysql.createPool({
  ...DB_CONFIG,
  database: DB_NAME,
  timezone: '+00:00',
  dateStrings: true,
  charset: 'utf8mb4',
  waitForConnections: true,
  connectionLimit: 10,
});

pool.on('connection', (conn) => {
  conn.query("SET time_zone = '+00:00'");
});

async function query(sql, params = []) {
  const [rows] = await pool.query(sql, params);
  return rows;
}

async function queryOne(sql, params = []) {
  const rows = await query(sql, params);
  return rows[0] || null;
}

// Neu chua co database thi tu chay file database/iot_system.sql (tao bang + du lieu mau).
// Khong dong vao database da ton tai de tranh mat du lieu.
async function ensureDatabase() {
  const conn = await mysql.createConnection({ ...DB_CONFIG, multipleStatements: true });
  try {
    const [rows] = await conn.query('SELECT SCHEMA_NAME FROM information_schema.SCHEMATA WHERE SCHEMA_NAME = ?', [DB_NAME]);
    if (rows.length) return false;
    console.log(`[DB] Chua co database "${DB_NAME}", dang khoi tao tu ${path.basename(SQL_FILE)} ...`);
    await runSqlFile(conn);
    return true;
  } finally {
    await conn.end();
  }
}

async function runSqlFile(conn) {
  let sql = fs.readFileSync(SQL_FILE, 'utf8');
  if (DB_NAME !== 'iot_system') sql = sql.replace(/\biot_system\b/g, DB_NAME);
  await conn.query(sql);
}

module.exports = { pool, query, queryOne, ensureDatabase, runSqlFile, DB_CONFIG, DB_NAME };
