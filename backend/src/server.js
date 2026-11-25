require('dotenv').config({ path: require('path').resolve(__dirname, '..', '.env') });
const path = require('path');
const express = require('express');
const cors = require('cors');

const db = require('./db');
const mqttBridge = require('./mqtt');
const deviceState = require('./services/deviceState');
const randomSensors = require('./services/randomSensors');
const { requireAuth } = require('./middleware/auth');

const app = express();
app.use(cors());
app.use(express.json());

// Public
app.use('/api/auth', require('./routes/auth'));
app.get('/api/health', async (req, res) => {
  let dbOk = true;
  try {
    await db.query('SELECT 1');
  } catch {
    dbOk = false;
  }
  res.status(dbOk ? 200 : 503).json({ database: dbOk, mqtt: mqttBridge.isConnected(), time: new Date().toISOString() });
});

// Can JWT (muc 4.6: Backend kiem tra JWT truoc khi xu ly)
app.use('/api/dashboard', requireAuth, require('./routes/dashboard'));
app.use('/api/sensor-data', requireAuth, require('./routes/sensorData'));
app.use('/api/control', requireAuth, require('./routes/control'));
app.use('/api/device-actions', requireAuth, require('./routes/deviceActions'));
app.use('/api/devices', requireAuth, require('./routes/devices'));
app.use('/api/random-sensors', requireAuth, require('./routes/randomSensors'));

app.use('/api', (req, res) => res.status(404).json({ message: `Không tồn tại API: ${req.method} ${req.originalUrl}` }));

// Web UI tinh
const frontendDir = path.resolve(__dirname, '..', '..', 'frontend');
app.use(express.static(frontendDir));

// Loi chung: 400 cho tham so sai, 500 cho loi Database/he thong
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  if (err.type === 'entity.parse.failed') return res.status(400).json({ message: 'Body JSON không hợp lệ' });
  if (err.status && err.status < 500) return res.status(err.status).json({ message: err.message });
  console.error('[HTTP] Loi:', err);
  res.status(500).json({ message: 'Lỗi máy chủ, vui lòng thử lại sau' });
});

async function main() {
  try {
    await db.ensureDatabase();
    await db.query('SELECT 1');
    await randomSensors.ensureSensors();
  } catch (err) {
    console.error(`[DB] Khong ket noi duoc MySQL (${db.DB_CONFIG.host}:${db.DB_CONFIG.port}): ${err.message}`);
    console.error('[DB] Hay bat MySQL (XAMPP Control Panel -> MySQL -> Start) va kiem tra DB_* trong backend/.env');
    process.exit(1);
  }
  console.log(`[DB] Da ket noi MySQL, database "${db.DB_NAME}"`);

  await deviceState.init();
  mqttBridge.start();

  const PORT = Number(process.env.PORT || 4000);
  app.listen(PORT, () => {
    console.log(`[HTTP] Backend + Web UI dang chay tai http://localhost:${PORT}`);
  });
}

main();
