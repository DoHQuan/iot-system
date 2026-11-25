// 3 cam bien ngau nhien do ESP8266 sinh ra (tab "Cảnh báo").
// Luu chung bang sensors/data_sensor, tach khoi Dashboard bang tien to sensor_type.
const db = require('../db');

const RANDOM_SENSORS = [
  { type: 'random_10', name: 'Cảm biến 1', max: 10, pin: 'D1' },
  { type: 'random_100', name: 'Cảm biến 2', max: 100, pin: 'D2' },
  { type: 'random_1000', name: 'Cảm biến 3', max: 1000, pin: 'D0' },
];
const WARNING_RATIO = 0.5;
const NOT_RANDOM_SQL = "sensor_type NOT LIKE 'random\\_%'";

// Database da tao tu truoc chua co 3 cam bien nay -> tu them khi Backend khoi dong
async function ensureSensors() {
  for (const s of RANDOM_SENSORS) {
    await db.query(
      'INSERT IGNORE INTO sensors (device_id, sensor_name, sensor_type, unit, description) SELECT id, ?, ?, ?, ? FROM devices',
      [s.name, s.type, '', `Ngẫu nhiên 0-${s.max}, LED cảnh báo ${s.pin}`]
    );
  }
}

function isWarning(sensor, value) {
  return value !== null && value > sensor.max * WARNING_RATIO;
}

module.exports = { RANDOM_SENSORS, NOT_RANDOM_SQL, ensureSensors, isWarning };
