function renderLayout(activePage) {
  Api.requireAuthOrRedirect();
  const user = Api.getUser();

  const links = [
    { href: '/index.html', key: 'dashboard', label: 'Trang chủ', icon: Icons.home },
    { href: '/sensor-data.html', key: 'sensor-data', label: 'Cảm biến', icon: Icons.sensor },
    { href: '/history.html', key: 'history', label: 'Lịch sử hoạt động', icon: Icons.history },
    { href: '/profile.html', key: 'profile', label: 'Hồ sơ', icon: Icons.user },
  ];

  const topbar = document.getElementById('topbar');
  const initials = (user && (user.full_name || user.username) || '?')
    .trim()
    .split(/\s+/)
    .slice(-2)
    .map((s) => s[0])
    .join('')
    .toUpperCase();

  topbar.innerHTML = `
    <nav class="topbar-nav">
      ${links
        .map(
          (l) => `<a class="nav-pill${l.key === activePage ? ' active' : ''}" href="${l.href}">${l.icon}<span>${l.label}</span></a>`
        )
        .join('')}
    </nav>
    <div class="topbar-right">
      <button class="bell-btn" id="bellBtn" title="Cảnh báo lệnh lỗi/timeout gần đây">
        ${Icons.bell}
        <span class="bell-badge" id="bellBadge" hidden>0</span>
      </button>
      <div class="user-chip" onclick="window.location.href='/profile.html'">
        <div class="user-avatar">${escapeHtml(initials || 'U')}</div>
        <div class="user-meta">
          <div class="user-name">${user ? escapeHtml(user.full_name || user.username) : ''}</div>
          <div class="user-role">${user ? escapeHtml(user.role === 'admin' ? 'Admin' : 'User') : ''}</div>
        </div>
      </div>
      <button class="logout-btn" id="logoutBtn" title="Đăng xuất">${Icons.logout}</button>
    </div>
  `;

  document.getElementById('logoutBtn').addEventListener('click', () => {
    Api.clearSession();
    window.location.href = '/login.html';
  });

  loadAlertBadge();
}

async function loadAlertBadge() {
  const badge = document.getElementById('bellBadge');
  if (!badge) return;
  try {
    const since = new Date(Date.now() - 24 * 3600 * 1000).toISOString().slice(0, 19).replace('T', ' ');
    const [fail, timeout] = await Promise.all([
      Api.get(`/api/device-actions?result=fail&from=${encodeURIComponent(since)}&size=1`),
      Api.get(`/api/device-actions?result=timeout&from=${encodeURIComponent(since)}&size=1`),
    ]);
    const count = (fail.total || 0) + (timeout.total || 0);
    if (count > 0) {
      badge.hidden = false;
      badge.textContent = count > 99 ? '99+' : String(count);
    } else {
      badge.hidden = true;
    }
  } catch {
    badge.hidden = true;
  }
}

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  })[c]);
}

function formatTime(isoOrSqlite) {
  if (!isoOrSqlite) return '—';
  const d = new Date(isoOrSqlite.replace(' ', 'T') + (isoOrSqlite.includes('Z') ? '' : 'Z'));
  if (Number.isNaN(d.getTime())) return isoOrSqlite;
  return d.toLocaleString('vi-VN', { hour12: false });
}

function formatClock(isoOrSqlite) {
  if (!isoOrSqlite) return '';
  const d = new Date(isoOrSqlite.replace(' ', 'T') + (isoOrSqlite.includes('Z') ? '' : 'Z'));
  if (Number.isNaN(d.getTime())) return '';
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function formatId(id) {
  return '#' + String(id).padStart(3, '0');
}

function setConnection(ok) {
  const el = document.getElementById('connBadge');
  if (!el) return;
  el.className = `conn-badge ${ok ? 'online' : 'offline'}`;
  el.innerHTML = `<span class="conn-dot"></span>${ok ? 'Đã kết nối' : 'Mất kết nối'}`;
}

function resultBadgeLabel(result) {
  return { ok: 'SUCCESS', fail: 'FAIL', timeout: 'TIMEOUT', pending: 'PENDING' }[result] || result;
}

function todayLabel() {
  const days = ['Chủ Nhật', 'Thứ Hai', 'Thứ Ba', 'Thứ Tư', 'Thứ Năm', 'Thứ Sáu', 'Thứ Bảy'];
  const now = new Date();
  return `${days[now.getDay()]}, ${now.getDate()} tháng ${now.getMonth() + 1}, ${now.getFullYear()}`;
}

// Sinh danh sach so trang de hien thi (co dau "..." khi qua nhieu trang)
function pageNumbers(page, totalPages) {
  const pages = [];
  const push = (p) => pages.push(p);
  const windowSize = 1;
  push(1);
  if (page - windowSize > 2) push('...');
  for (let p = Math.max(2, page - windowSize); p <= Math.min(totalPages - 1, page + windowSize); p++) push(p);
  if (page + windowSize < totalPages - 1) push('...');
  if (totalPages > 1) push(totalPages);
  return pages;
}

function renderPager(container, { page, size, total }, onGoTo) {
  const totalPages = Math.max(1, Math.ceil(total / size));
  const from = total === 0 ? 0 : (page - 1) * size + 1;
  const to = Math.min(total, page * size);

  const numbers = pageNumbers(page, totalPages)
    .map((p) =>
      p === '...'
        ? `<span class="page-ellipsis">…</span>`
        : `<button class="page-btn${p === page ? ' active' : ''}" data-page="${p}">${p}</button>`
    )
    .join('');

  container.innerHTML = `
    <div>Hiển thị ${from}-${to} / ${total} bản ghi</div>
    <div class="pager-btns">
      <button class="page-btn" id="pagerPrev" ${page <= 1 ? 'disabled' : ''}>${Icons.chevronLeft}</button>
      ${numbers}
      <button class="page-btn" id="pagerNext" ${page >= totalPages ? 'disabled' : ''}>${Icons.chevronRight}</button>
    </div>
  `;

  container.querySelectorAll('.page-btn[data-page]').forEach((btn) => {
    btn.addEventListener('click', () => onGoTo(Number(btn.dataset.page)));
  });
  const prev = document.getElementById('pagerPrev');
  const next = document.getElementById('pagerNext');
  if (prev) prev.addEventListener('click', () => page > 1 && onGoTo(page - 1));
  if (next) next.addEventListener('click', () => page < totalPages && onGoTo(page + 1));
}
