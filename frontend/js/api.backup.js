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

    const res = await fetch(path, { ...options, headers });

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
