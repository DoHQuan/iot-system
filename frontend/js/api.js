const Api = (() => {
  function getToken() {
    return localStorage.getItem('iot_token');
  }

  function getUser() {
    try {
      return JSON.parse(localStorage.getItem('iot_user') || 'null');
    } catch {
      return null;
    }
  }

  function setSession(token, user) {
    localStorage.setItem('iot_token', token);
    localStorage.setItem('iot_user', JSON.stringify(user));
  }

  function clearSession() {
    localStorage.removeItem('iot_token');
    localStorage.removeItem('iot_user');
  }

  function requireAuthOrRedirect() {
    if (!getToken()) {
      window.location.href = '/login.html';
    }
  }

  async function request(path, options = {}) {
    const headers = { 'Content-Type': 'application/json', ...(options.headers || {}) };
    const token = getToken();
    if (token) headers.Authorization = `Bearer ${token}`;

    // Khong co backend -> dung du lieu gia lap trong js/mock.js
    let res;
    try {
      res = await fetch(path, { ...options, headers });
    } catch (networkErr) {
      if (window.MockApi) return MockApi.handle(path, options); // server khong chay
      throw networkErr;
    }
    const isJson = (res.headers.get('content-type') || '').includes('application/json');
    if (window.MockApi && path.startsWith('/api/') && !isJson) {
      return MockApi.handle(path, options); // chay bang Live Server: /api/... tra ve trang 404 HTML
    }

    if (res.status === 401) {
      clearSession();
      window.location.href = '/login.html';
      throw new Error('Chưa đăng nhập');
    }

    let body = null;
    try {
      body = await res.json();
    } catch {
      // no body
    }

    if (!res.ok) {
      const message = (body && body.message) || `Lỗi ${res.status}`;
      const err = new Error(message);
      err.status = res.status;
      err.body = body;
      throw err;
    }
    return body;
  }

  return {
    get: (path) => request(path),
    post: (path, data) => request(path, { method: 'POST', body: JSON.stringify(data) }),
    login: (username, password) => request('/api/auth/login', { method: 'POST', body: JSON.stringify({ username, password }) }),
    getToken,
    getUser,
    setSession,
    clearSession,
    requireAuthOrRedirect,
  };
})();
