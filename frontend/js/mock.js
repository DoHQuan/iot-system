// =====================================================================
// DU LIEU GIA LAP (MOCK) - dung khi chay frontend mot minh, khong co backend.
// api.js se tu goi MockApi.handle() khi khong ket noi duoc server.
// Khi co backend that thi file nay khong duoc dung toi.
// =====================================================================
window.MockApi = (() => {
  // ---- Ham tien ich ----
  function rng(seed) { // sinh so ngau nhien co dinh (lan nao chay cung ra giong nhau)
    return () => {
      seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  const pad = (n) => String(n).padStart(2, '0');
  const sqlTime = (ms) => new Date(ms).toISOString().slice(0, 19).replace('T', ' '); // UTC giong SQLite
  const localText = (sql) => {
    const d = new Date(sql.replace(' ', 'T') + 'Z');
    return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  };
  function paginate(list, params) {
    const page = Math.max(1, Number(params.get('page')) || 1);
    const size = Math.max(1, Number(params.get('size')) || 8);
    return { items: list.slice((page - 1) * size, page * size), page, size, total: list.length };
  }
  function fail(message, status = 400) {
    const err = new Error(message);
    err.status = status;
    throw err;
  }

  // Luu lai giua cac trang: moi trang tai lai file nay nhu mot module moi,
  // nen trang thai den + lich su moi ghi phai dua vao localStorage moi "song sot".
  const LED_STATE_KEY = 'mockLedState';
  const ACTION_LOG_KEY = 'mockActionLog';
  function loadJson(key, fallback) {
    try { const v = JSON.parse(localStorage.getItem(key)); return v == null ? fallback : v; } catch { return fallback; }
  }
  function saveJson(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch {}
  }

  // ---- Cam bien ----
  const DEVICE = { key: 'esp8266', name: 'ESP8266' };
  const SENSORS = [
    { type: 'temperature', name: 'Nhiệt độ', unit: '°C', base: 29, amp: 5, digits: 1 },
    { type: 'humidity', name: 'Độ ẩm', unit: '%', base: 65, amp: 12, digits: 1 },
    { type: 'light', name: 'Ánh sáng', unit: 'lux', base: 420, amp: 280, digits: 0 },
  ];
  function valueAt(sensor, ms, idx) {
    // Song chinh (chu ky dai) + song phu (chu ky ngan hon nhung van cham hon buoc lay mau)
    // de duong bieu do khong bi gay khuc lien tuc khi noi bang doan thang.
    const wave = Math.sin(ms / 1800000 + idx * 2) + 0.3 * Math.sin(ms / 3600000 + idx);
    const noise = (rng(Math.floor(ms / 60000) + idx * 7919)() - 0.5) * sensor.amp * 0.05;
    return Number((sensor.base + sensor.amp * wave * 0.8 + noise).toFixed(sensor.digits));
  }

  // Lich su cam bien: 1 phut 1 lan, 24 gio gan nhat (tao 1 lan khi mo trang)
  const START = Math.floor(Date.now() / 60000) * 60000;
  const sensorRows = [];
  for (let m = 24 * 60 - 1, id = 1; m >= 0; m--) {
    const ms = START - m * 60000;
    SENSORS.forEach((s, i) => {
      sensorRows.push({
        id: id++, sensor_name: s.name, sensor_type: s.type, device_name: DEVICE.name,
        value: valueAt(s, ms, i), unit: s.unit, time: sqlTime(ms),
      });
    });
  }

  // ---- Lich su bat tat ----
  const actionRows = [];
  (() => {
    const r = rng(2026);
    let ms = START - 48 * 3600 * 1000; // ~2 ngay gan nhat
    for (let id = 1; id <= 80; id++) {
      ms += Math.floor(r() * 50 + 10) * 60000;
      const x = r();
      const result = x < 0.75 ? 'ok' : x < 0.87 ? 'fail' : 'timeout';
      actionRows.push({
        id, device_key: DEVICE.key, device_name: DEVICE.name,
        target: 'led' + (1 + Math.floor(r() * 3)),
        action: r() < 0.5 ? 'ON' : 'OFF',
        result, issued_by: 'admin', time: sqlTime(Math.min(ms, START)),
        note: result === 'fail' ? 'Thiết bị báo lỗi khi thực thi lệnh'
          : result === 'timeout' ? 'Không nhận được phản hồi từ thiết bị' : '',
      });
    }
  })();
  actionRows.unshift(...loadJson(ACTION_LOG_KEY, [])); // cac lenh bat/tat da thuc hien tu truoc
  let nextActionId = actionRows.length ? Math.max(...actionRows.map((r) => r.id)) + 1 : 1;

  // ---- Trang thai bat/tat den hien tai (dung chung cho dashboard + lich su) ----
  const ledState = loadJson(LED_STATE_KEY, {}); // vd: { 'esp8266:led1': 'ON' }
  function deviceStatusList() {
    return [{
      device_id: DEVICE.key, name: DEVICE.name,
      led1_state: ledState[DEVICE.key + ':led1'] || 'OFF',
      led2_state: ledState[DEVICE.key + ':led2'] || 'OFF',
      led3_state: ledState[DEVICE.key + ':led3'] || 'OFF',
    }];
  }

  // ---- Cac API gia lap ----
  function login(body) {
    if (body.username === 'admin' && body.password === 'admin123') {
      return { token: 'mock-token', user: { username: 'admin', full_name: 'Quản trị viên', role: 'admin' } };
    }
    fail('Sai tên đăng nhập hoặc mật khẩu', 401);
  }

  // Bieu do dashboard: tao 1 lan khi mo trang, giu nguyen (khong "chay" moi lan tai lai)
  const CHART_POINTS = 30;
  const CHART_STEP_MS = 5 * 60000; // 5 phut/diem
  const dashboardChartSeries = SENSORS.map((s, i) => {
    const fixedValue = valueAt(s, START, i); // 1 gia tri duy nhat -> duong bieu do thang
    return {
      type: s.type, name: s.name, unit: s.unit,
      points: Array.from({ length: CHART_POINTS }, (_, k) => {
        const ms = START - (CHART_POINTS - 1 - k) * CHART_STEP_MS;
        return { timestamp: sqlTime(ms), value: fixedValue };
      }),
    };
  });

  function dashboard() {
    const latestSensors = dashboardChartSeries.map((c) => {
      const vals = c.points.map((p) => p.value);
      return { type: c.type, name: c.name, unit: c.unit, value: vals[vals.length - 1], min: Math.min(...vals), max: Math.max(...vals) };
    });
    return {
      latestSensors, chartSeries: dashboardChartSeries,
      deviceStatus: deviceStatusList(),
      updatedAt: sqlTime(Date.now()),
    };
  }

  // ---- Dieu khien thiet bi: luu trang thai + ghi vao lich su hoat dong ----
  function control(body) {
    const { device, target, action, issued_by } = body || {};
    if (!device || !target || (action !== 'ON' && action !== 'OFF')) fail('Thiếu thông tin điều khiển', 400);
    (target === 'all' ? ['led1', 'led2', 'led3'] : [target]).forEach((t) => { ledState[device + ':' + t] = action; });
    saveJson(LED_STATE_KEY, ledState);

    const row = {
      id: nextActionId++, device_key: device, device_name: DEVICE.name,
      target, action, result: 'ok', issued_by: issued_by || 'admin', time: sqlTime(Date.now()), note: '',
    };
    actionRows.unshift(row);
    const log = loadJson(ACTION_LOG_KEY, []);
    log.unshift(row);
    saveJson(ACTION_LOG_KEY, log.slice(0, 200)); // gioi han de khong phinh to localStorage
    return { ok: true };
  }

  function sensorData(params) {
    let list = sensorRows.slice();
    const type = params.get('type');
    const search = (params.get('search') || '').toLowerCase();
    const value = params.get('value');
    if (type) list = list.filter((r) => r.sensor_type === type);
    if (search) list = list.filter((r) => (r.sensor_name + ' ' + r.device_name).toLowerCase().includes(search));
    const time = (params.get('time') || '').trim();
    if (time) list = list.filter((r) => localText(r.time).includes(time));
    if (value) {
      const m = value.match(/^(>=|<=|>|<|=)?(-?\d+(?:\.\d+)?)$/);
      if (m) {
        const op = m[1] || '=', x = Number(m[2]);
        const cmp = { '>': (v) => v > x, '<': (v) => v < x, '>=': (v) => v >= x, '<=': (v) => v <= x, '=': (v) => v === x }[op];
        list = list.filter((r) => cmp(r.value));
      }
    }
    const sort = params.get('sort') || 'time_desc';
    const dir = sort.endsWith('_asc') ? 1 : -1;
    list.sort(sort.startsWith('value') ? (a, b) => (a.value - b.value) * dir : (a, b) => (a.id - b.id) * dir);
    return paginate(list, params);
  }

  function deviceActions(params) {
    let list = actionRows.slice();
    for (const key of ['device', 'action', 'result']) {
      const v = params.get(key);
      const field = key === 'device' ? 'device_key' : key;
      if (v) list = list.filter((r) => r[field] === v);
    }
    const from = params.get('from');
    if (from) list = list.filter((r) => r.time >= from);
    const time = (params.get('time') || '').trim();
    if (time) list = list.filter((r) => localText(r.time).includes(time));
    const dir = params.get('sort') === 'time_asc' ? 1 : -1;
    list.sort((a, b) => (a.id - b.id) * dir);
    return paginate(list, params);
  }

  // Nhan nho "Dang dung du lieu mau" o goc man hinh
  function showBadge() {
    if (document.getElementById('mockBadge') || !document.body) return;
    const b = document.createElement('div');
    b.id = 'mockBadge';
    b.textContent = 'Chế độ dữ liệu mẫu (không có backend)';
    b.style.cssText = 'position:fixed;left:12px;bottom:12px;z-index:9999;padding:6px 10px;border-radius:8px;'
      + 'background:#fef3c7;color:#92400e;font:600 12px/1.2 system-ui,sans-serif;box-shadow:0 1px 4px rgba(0,0,0,.15)';
    document.body.appendChild(b);
  }

  async function handle(path, options = {}) {
    showBadge();
    const url = new URL(path, window.location.origin);
    const params = url.searchParams;
    const body = options.body ? JSON.parse(options.body) : {};
    switch (url.pathname) {
      case '/api/auth/login': return login(body);
      case '/api/dashboard': return dashboard();
      case '/api/sensor-data': return sensorData(params);
      case '/api/device-actions': return deviceActions(params);
      case '/api/devices': return { items: [{ device_key: DEVICE.key, device_name: DEVICE.name }] };
      case '/api/control': return control(body);
      default: fail('API giả lập chưa hỗ trợ: ' + url.pathname, 404);
    }
  }

  return { handle };
})();
