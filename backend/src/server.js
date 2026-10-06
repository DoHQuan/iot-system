require('dotenv').config();
const path = require('path');
const express = require('express');
const cors = require('cors');

require('./db');
require('./mqtt'); // khoi tao ket noi MQTT ngay khi server start

const authRoutes = require('./routes/auth');
const dashboardRoutes = require('./routes/dashboard');
const sensorDataRoutes = require('./routes/sensorData');
const controlRoutes = require('./routes/control');
const deviceActionsRoutes = require('./routes/deviceActions');
const devicesRoutes = require('./routes/devices');

const app = express();
app.use(cors());
app.use(express.json());

app.use('/api/auth', authRoutes);
app.use('/api/dashboard', dashboardRoutes);
app.use('/api/sensor-data', sensorDataRoutes);
app.use('/api/control', controlRoutes);
app.use('/api/device-actions', deviceActionsRoutes);
app.use('/api/devices', devicesRoutes);

const frontendDir = path.resolve(__dirname, '..', '..', 'frontend');
app.use(express.static(frontendDir));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`[HTTP] Backend + Web UI dang chay tai http://localhost:${PORT}`);
});
