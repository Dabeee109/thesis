/**
 * Diner's Cafe Frontend API Client & Utilities
 */

const API = {
  baseUrl: '/api',

  getToken() {
    return localStorage.getItem('diners_token');
  },

  setToken(token) {
    localStorage.setItem('diners_token', token);
  },

  getUser() {
    try {
      return JSON.parse(localStorage.getItem('diners_user'));
    } catch (e) {
      return null;
    }
  },

  setUser(user) {
    localStorage.setItem('diners_user', JSON.stringify(user));
  },

  isAuthenticated() {
    const token = this.getToken();
    const user = this.getUser();
    if (!token || !user) return false;
    try {
      const parts = token.split('.');
      if (parts.length !== 3) return false;
      const payload = JSON.parse(atob(parts[1]));
      if (payload.exp && Date.now() >= payload.exp * 1000) {
        this.logout();
        return false;
      }
      return true;
    } catch (e) {
      return false;
    }
  },

  requireAuth(options = {}) {
    if (!this.isAuthenticated()) {
      const currentPath = window.location.pathname;
      window.location.replace('/login.html?redirect=' + encodeURIComponent(currentPath));
      return false;
    }
    const user = this.getUser();
    if (options.role && user && user.role !== options.role) {
      if (user.role === 'rider') {
        window.location.replace('/rider-portal.html');
      } else {
        window.location.replace('/dashboard.html');
      }
      return false;
    }
    return true;
  },

  logout() {
    localStorage.removeItem('diners_token');
    localStorage.removeItem('diners_user');
    sessionStorage.removeItem('diners_token');
    sessionStorage.removeItem('diners_user');
    window.location.href = '/login.html';
  },

  // Initialize Mobile Service Worker
  initServiceWorker() {
    if ('serviceWorker' in navigator && window.location.protocol.startsWith('http')) {
      navigator.serviceWorker.register('/sw.js').then(() => {
        console.log('[PWA] Service Worker active');
      }).catch(err => {
        console.log('[PWA] Service Worker registration skipped:', err.message);
      });
    }
  },

  async request(endpoint, options = {}) {
    const isFormData = typeof FormData !== 'undefined' && options.body instanceof FormData;
    const headers = {
      ...options.headers
    };
    if (!isFormData && !headers['Content-Type']) {
      headers['Content-Type'] = 'application/json';
    }

    const token = this.getToken();
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }

    try {
      const res = await fetch(`${this.baseUrl}${endpoint}`, {
        ...options,
        headers
      });

      if (res.status === 401 && !endpoint.includes('/auth/login')) {
        this.logout();
        return null;
      }

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.message || `HTTP Error ${res.status}`);
      }
      return data;
    } catch (err) {
      API.toast(err.message, 'danger');
      throw err;
    }
  },

  get(endpoint) {
    return this.request(endpoint, { method: 'GET' });
  },

  post(endpoint, body) {
    return this.request(endpoint, {
      method: 'POST',
      body: JSON.stringify(body)
    });
  },

  put(endpoint, body) {
    return this.request(endpoint, {
      method: 'PUT',
      body: JSON.stringify(body)
    });
  },

  patch(endpoint, body) {
    return this.request(endpoint, {
      method: 'PATCH',
      body: JSON.stringify(body)
    });
  },

  delete(endpoint) {
    return this.request(endpoint, { method: 'DELETE' });
  },

  upload(endpoint, formData, method = 'POST') {
    return this.request(endpoint, {
      method,
      body: formData
    });
  },

  // Toast Notification System
  toast(message, type = 'info') {
    let container = document.getElementById('toast-container');
    if (!container) {
      container = document.createElement('div');
      container.id = 'toast-container';
      document.body.appendChild(container);
    }

    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    const icon = type === 'success' ? '✅' : type === 'danger' ? '⚠️' : type === 'warning' ? '🔔' : 'ℹ️';
    toast.innerHTML = `<span>${icon}</span> <div>${message}</div>`;

    container.appendChild(toast);

    setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transform = 'translateY(10px)';
      toast.style.transition = 'all 0.3s ease';
      setTimeout(() => toast.remove(), 300);
    }, 4000);
  },

  // Connect to Real-time SSE Stream
  connectSSE(onEventCallback) {
    const eventSource = new EventSource('/api/events');

    eventSource.addEventListener('CONNECTED', (e) => {
      console.log('[SSE Stream] Connected:', JSON.parse(e.data));
    });

    eventSource.addEventListener('NEW_ORDER', (e) => {
      const data = JSON.parse(e.data);
      API.toast(`🔔 New Order #${data.orderNumber} received (₱${data.totalAmount})`, 'warning');
      if (onEventCallback) onEventCallback('NEW_ORDER', data);
    });

    eventSource.addEventListener('ORDER_STATUS_CHANGED', (e) => {
      const data = JSON.parse(e.data);
      API.toast(`📋 Order #${data.orderNumber} updated to ${data.newStatus}`, 'info');
      if (onEventCallback) onEventCallback('ORDER_STATUS_CHANGED', data);
    });

    eventSource.addEventListener('STOCK_ALERT', (e) => {
      const data = JSON.parse(e.data);
      API.toast(`⚠️ Inventory Alert: Item stock is ${data.alertType}`, 'danger');
      if (onEventCallback) onEventCallback('STOCK_ALERT', data);
    });

    eventSource.addEventListener('INGREDIENT_STOCK_ALERT', (e) => {
      const data = JSON.parse(e.data);
      API.toast(`⚠️ Low Ingredient: ${data.name} (${data.stock_quantity} ${data.unit})`, 'warning');
      if (onEventCallback) onEventCallback('INGREDIENT_STOCK_ALERT', data);
    });

    eventSource.addEventListener('INGREDIENTS_UPDATED', (e) => {
      const data = JSON.parse(e.data);
      if (onEventCallback) onEventCallback('INGREDIENTS_UPDATED', data);
    });

    eventSource.addEventListener('NEW_FEEDBACK', (e) => {
      const data = JSON.parse(e.data);
      API.toast(`🌟 New ${data.rating}-star review received!`, 'success');
      if (onEventCallback) onEventCallback('NEW_FEEDBACK', data);
    });

    eventSource.addEventListener('PAYMENT_UPDATE', (e) => {
      const data = JSON.parse(e.data);
      if (data.isMismatch) {
        API.toast(`🚨 GCash Payment Mismatch on Order #${data.orderNumber}!`, 'danger');
      }
      if (onEventCallback) onEventCallback('PAYMENT_UPDATE', data);
    });

    eventSource.addEventListener('SIMULATOR_MESSAGE', (e) => {
      const data = JSON.parse(e.data);
      if (onEventCallback) onEventCallback('SIMULATOR_MESSAGE', data);
    });

    return eventSource;
  }
};

// Initialize service worker on page load
API.initServiceWorker();
