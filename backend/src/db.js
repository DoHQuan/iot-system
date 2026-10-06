const path = require('path');
const fs = require('fs');
const { DatabaseSync } = require('node:sqlite');
const bcrypt = require('bcryptjs');

const DB_FILE = process.env.DB_FILE || './data/iot.db';
const dbPath = path.resolve(__dirname, '..', DB_FILE);
fs.mkdirSync(path.dirname(dbPath), { recursive: true });

// Dung module SQLite tich hop san trong Node.js (node:sqlite) de tranh
// phai bien dich native module (better-sqlite3) tren may khong co build tools.
const db = new DatabaseSync(dbPath);
db.exec('PRAGMA journal_mode = WAL');
db.exec('PRAGMA foreign_keys = ON');

// Cau truc bang bam sat ERD trong bao cao (Chuong 2.6), them device_key
// de anh xa device_id dang chuoi ma ESP8266 gui qua MQTT toi khoa chinh so.
db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username VARCHAR(64) NOT NULL UNIQUE,
  email VARCHAR(64),
  password VARCHAR(255) NOT NULL,
  full_name VARCHAR(128),
  role VARCHAR(16) NOT NULL DEFAULT 'user',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS devices (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  device_key VARCHAR(64) NOT NULL UNIQUE,
  user_id INTEGER REFERENCES users(id),
  device_name VARCHAR(64) NOT NULL,
  device_type VARCHAR(32) NOT NULL DEFAULT 'ESP8266',
  status VARCHAR(16) NOT NULL DEFAULT 'offline',
  last_seen DATETIME,
  last_state VARCHAR(8),
  description VARCHAR(255),
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS sensors (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  device_id INTEGER NOT NULL REFERENCES devices(id),
  sensor_name VARCHAR(64) NOT NULL,
  sensor_type VARCHAR(16) NOT NULL,
  unit VARCHAR(8),
  description VARCHAR(255),
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(device_id, sensor_type)
);

CREATE TABLE IF NOT EXISTS data_sensor (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  sensor_id INTEGER NOT NULL REFERENCES sensors(id),
  value REAL NOT NULL,
  timestamp DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_data_sensor_sensor_time ON data_sensor(sensor_id, timestamp);

CREATE TABLE IF NOT EXISTS device_actions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  device_id INTEGER NOT NULL REFERENCES devices(id),
  target VARCHAR(32) NOT NULL,
  action VARCHAR(16) NOT NULL,
  issued_by INTEGER REFERENCES users(id),
  result VARCHAR(16) NOT NULL DEFAULT 'pending',
  note VARCHAR(255),
  timestamp DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_device_actions_time ON device_actions(timestamp);
`);

// Migration nho cho DB da tao truoc khi co cac cot trang thai LED
for (const col of ['last_state', 'led1_state', 'led2_state', 'led3_state']) {
  try {
    db.exec(`ALTER TABLE devices ADD COLUMN ${col} VARCHAR(8)`);
  } catch (e) {
    if (!/duplicate column/i.test(e.message)) throw e;
  }
}

function seed() {
  const userCount = db.prepare('SELECT COUNT(*) AS c FROM users').get().c;
  if (userCount === 0) {
    const passwordHash = bcrypt.hashSync('admin123', 10);
    db.prepare(
      `INSERT INTO users (username, email, password, full_name, role) VALUES (?, ?, ?, ?, ?)`
    ).run('admin', 'admin@example.com', passwordHash, 'Quản trị viên', 'admin');
    console.log('[DB] Da tao tai khoan mac dinh: admin / admin123 (doi mat khau sau khi dang nhap)');
  }

  const adminId = db.prepare('SELECT id FROM users WHERE username = ?').get('admin').id;

  const deviceKey = 'esp8266-01';
  let device = db.prepare('SELECT * FROM devices WHERE device_key = ?').get(deviceKey);
  if (!device) {
    const info = db
      .prepare(
        `INSERT INTO devices (device_key, user_id, device_name, device_type, status, description)
         VALUES (?, ?, ?, ?, 'offline', ?)`
      )
      .run(deviceKey, adminId, 'ESP8266 Kit demo', 'ESP8266', 'Thiet bi demo: DHT11 + LDR + LED/Relay');
    device = { id: info.lastInsertRowid };
    console.log(`[DB] Da tao thiet bi mac dinh "${deviceKey}"`);
  }

  const sensorDefs = [
    { type: 'temperature', name: 'Nhiệt độ', unit: '°C' },
    { type: 'humidity', name: 'Độ ẩm', unit: '%' },
    { type: 'light', name: 'Ánh sáng', unit: 'lux' },
  ];
  const insertSensor = db.prepare(
    `INSERT OR IGNORE INTO sensors (device_id, sensor_name, sensor_type, unit) VALUES (?, ?, ?, ?)`
  );
  for (const s of sensorDefs) {
    insertSensor.run(device.id, s.name, s.type, s.unit);
  }
}

seed();

module.exports = db;
