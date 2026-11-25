// Tao lai database tu dau bang file database/iot_system.sql (XOA du lieu cu neu co).
// Chay: npm run db:init
require('dotenv').config({ path: require('path').resolve(__dirname, '..', '.env') });
const mysql = require('mysql2/promise');
const { DB_CONFIG, DB_NAME, runSqlFile } = require('../src/db');

(async () => {
  const conn = await mysql.createConnection({ ...DB_CONFIG, multipleStatements: true });
  try {
    await runSqlFile(conn);
    console.log(`[DB] Da khoi tao database "${DB_NAME}" (tai khoan mau: admin / admin123)`);
  } finally {
    await conn.end();
  }
  process.exit(0);
})().catch((err) => {
  console.error('[DB] Khoi tao that bai:', err.message);
  process.exit(1);
});
