/**
 * Diner's Cafe Operations Dashboard Controller
 */

let allOrders = [];
let allMenuCategories = [];
let allInventory = [];
let allRiders = [];
let activeCategoryFilter = 'all';

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

document.addEventListener('DOMContentLoaded', async () => {
  // 0. Strict Authentication Guard (Requirement 4)
  if (!API.requireAuth()) return;

  // Restore desktop sidebar collapsed preference (Module 4)
  try {
    if (window.innerWidth > 1024 && localStorage.getItem('sidebar_collapsed') === 'true') {
      document.body.classList.add('sidebar-collapsed');
    }
  } catch (e) {}

  // 1. Verify User Authentication & Role Isolation
  const user = API.getUser();
  if (user) {
    const roleLower = (user.role || '').toLowerCase();
    if (roleLower === 'rider' || roleLower === 'delivery_rider') {
      window.location.replace('/rider-portal.html');
      return;
    }
    document.getElementById('user-display-name').innerText = user.name || 'Staff User';
    document.getElementById('user-display-role').innerText = user.role || 'Staff';
    const initials = (user.name || 'AD').split(' ').map(n => n[0]).join('').substring(0, 2).toUpperCase();
    document.getElementById('user-avatar-initials').innerText = initials;
  }

  // 2. Setup Navigation Tabs & Responsive Sidebar Toggle
  setupNavigation();
  initSidebarToggle();

  // 3. Initial Data Load
  await refreshAllData();

  // 4. Connect to Real-time SSE Broadcast Stream
  API.connectSSE((eventType, eventData) => {
    handleRealtimeEvent(eventType, eventData);
  });

  // 5. Setup Menu Image Dropzone and File Picker
  setupMenuImagePicker();
});

function setupMenuImagePicker() {
  const fileInput = document.getElementById('menu-img-file');
  if (fileInput) {
    fileInput.addEventListener('change', (e) => {
      handleMenuImageSelect(e);
    });
  }

  const dropzone = document.getElementById('menu-img-dropzone');
  if (dropzone) {
    dropzone.addEventListener('dragover', (e) => {
      e.preventDefault();
      dropzone.style.borderColor = 'var(--brand-primary, #d4a373)';
      dropzone.style.background = 'rgba(212, 163, 115, 0.15)';
    });
    dropzone.addEventListener('dragleave', (e) => {
      e.preventDefault();
      dropzone.style.borderColor = 'var(--border-subtle, rgba(212, 163, 115, 0.35))';
      dropzone.style.background = 'var(--bg-surface-elevated, #241a12)';
    });
    dropzone.addEventListener('drop', (e) => {
      e.preventDefault();
      dropzone.style.borderColor = 'var(--border-subtle, rgba(212, 163, 115, 0.35))';
      dropzone.style.background = 'var(--bg-surface-elevated, #241a12)';
      if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files.length > 0) {
        handleMenuImageSelect({ target: { files: e.dataTransfer.files } });
      }
    });
  }
}

// Setup sidebar tab switching
function setupNavigation() {
  const navItems = document.querySelectorAll('.nav-item');
  navItems.forEach(item => {
    item.addEventListener('click', () => {
      const tabId = item.getAttribute('data-tab');
      switchTab(tabId);
    });
  });
}

// Sidebar Collapsible & Mobile/Tablet Drawer Controller (Requirement 1)
function initSidebarToggle() {
  const toggleBtn = document.getElementById('sidebarToggle');
  const backdrop = document.getElementById('sidebarBackdrop');

  if (toggleBtn) {
    let lastTime = 0;
    const handleToggle = (e) => {
      const now = Date.now();
      if (now - lastTime < 280) {
        if (e) {
          e.preventDefault();
          e.stopPropagation();
        }
        return;
      }
      lastTime = now;
      if (e) {
        e.preventDefault();
        e.stopPropagation();
      }
      toggleSidebar();
    };

    toggleBtn.addEventListener('click', handleToggle);
    toggleBtn.addEventListener('touchend', handleToggle, { passive: false });
  }

  if (backdrop) {
    const handleClose = (e) => {
      if (e) {
        e.preventDefault();
        e.stopPropagation();
      }
      toggleSidebar(false);
    };
    backdrop.addEventListener('click', handleClose);
    backdrop.addEventListener('touchend', handleClose, { passive: false });
  }

  // Automatically close mobile/tablet drawer when any navigation tab is clicked
  document.querySelectorAll('.nav-item').forEach(item => {
    const closeOnNav = () => {
      if (window.innerWidth <= 1024) {
        toggleSidebar(false);
      }
    };
    item.addEventListener('click', closeOnNav);
    item.addEventListener('touchend', closeOnNav, { passive: true });
  });
}

function toggleSidebar(forceState) {
  const isMobileOrTablet = window.innerWidth <= 1024;
  if (isMobileOrTablet) {
    if (typeof forceState === 'boolean') {
      document.body.classList.toggle('sidebar-mobile-open', forceState);
    } else {
      document.body.classList.toggle('sidebar-mobile-open');
    }
  } else {
    const isCurrentlyCollapsed = document.body.classList.contains('sidebar-collapsed');
    const newState = (typeof forceState === 'boolean') ? forceState : !isCurrentlyCollapsed;
    document.body.classList.toggle('sidebar-collapsed', newState);
    try {
      localStorage.setItem('sidebar_collapsed', newState ? 'true' : 'false');
    } catch (e) {}
  }
}
window.toggleSidebar = toggleSidebar;

// Web Audio API Order Chime Alert (Module 2.B)
function playOrderChime() {
  try {
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (!AudioContext) return;
    const ctx = new AudioContext();
    if (ctx.state === 'suspended') {
      ctx.resume().catch(() => {});
    }
    const osc1 = ctx.createOscillator();
    const osc2 = ctx.createOscillator();
    const gain = ctx.createGain();

    osc1.type = 'sine';
    osc1.frequency.setValueAtTime(587.33, ctx.currentTime); // D5
    osc1.frequency.exponentialRampToValueAtTime(880, ctx.currentTime + 0.15); // A5

    osc2.type = 'triangle';
    osc2.frequency.setValueAtTime(880, ctx.currentTime + 0.15); // A5
    osc2.frequency.exponentialRampToValueAtTime(1174.66, ctx.currentTime + 0.35); // D6

    gain.gain.setValueAtTime(0.2, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.55);

    osc1.connect(gain);
    osc2.connect(gain);
    gain.connect(ctx.destination);

    osc1.start(ctx.currentTime);
    osc1.stop(ctx.currentTime + 0.2);
    osc2.start(ctx.currentTime + 0.15);
    osc2.stop(ctx.currentTime + 0.55);
  } catch (e) {
    console.debug('Audio chime unable to play:', e);
  }
}

function switchTab(tabId) {
  if (window.innerWidth <= 1024) {
    toggleSidebar(false);
  }

  document.querySelectorAll('.nav-item').forEach(el => el.classList.remove('active'));
  document.querySelectorAll('.tab-pane').forEach(el => el.classList.remove('active'));

  const activeNavItem = document.querySelector(`.nav-item[data-tab="${tabId}"]`);
  const activePane = document.getElementById(`tab-${tabId}`);

  if (activeNavItem) activeNavItem.classList.add('active');
  if (activePane) activePane.classList.add('active');

  const titles = {
    overview: 'Operational Overview',
    orders: 'Order Operations',
    menu: 'Menu Management',
    promotions: 'Promotions, Events & Seasonal Deals',
    inventory: 'Promotions, Events & Seasonal Deals',
    delivery: 'Smart Delivery Management (FR6)',
    feedback: 'Customer Feedback & Ratings (FR11)',
    reports: 'Reports & Business Analytics (FR10)',
    chatbot: 'AI Chatbot & Webhook Logs',
    settings: 'System Settings & Account Management'
  };
  document.getElementById('page-title').innerText = titles[tabId] || 'Dashboard';

  // Load specific tab data on switch
  if (tabId === 'overview') loadStoreStatus();
  if (tabId === 'orders') loadOrders();
  if (tabId === 'menu') loadMenu();
  if (tabId === 'promotions') loadPromotions();
  if (tabId === 'inventory') switchTab('promotions');
  if (tabId === 'delivery') {
    loadDeliveries();
    loadFareSettings();
    testFareCalculation();
  }
  if (tabId === 'feedback') loadFeedback();
  if (tabId === 'reports') loadReports();
  if (tabId === 'chatbot') loadChatbotLogs();
  if (tabId === 'settings') {
    loadUsers();
    loadFacebookSettings();
    loadStoreLocationSettings();
    loadGcashSettings();
    loadOperatingHoursSettings();
  }
}

async function refreshAllData() {
  await Promise.all([
    loadKPIs(),
    loadOrders(),
    loadMenu(),
    loadPromotions(),
    loadDeliveries(),
    loadFeedback(),
    loadReports(),
    loadChatbotStatus(),
    loadUsers(),
    loadFacebookSettings(),
    loadStoreLocationSettings(),
    loadGcashSettings(),
    loadStoreStatus(),
    loadOperatingHoursSettings()
  ]);
}

function handleRealtimeEvent(eventType, data) {
  loadKPIs();
  if (eventType === 'NEW_ORDER') {
    playOrderChime();
    API.toast(`🔔 Bagong Order! #${data.orderNumber} (${data.customerName || 'Customer'})`, 'info');
    loadOrders();
    loadDeliveries();
  } else if (eventType === 'ORDER_STATUS_CHANGED' || eventType === 'PAYMENT_UPDATE') {
    loadOrders();
    loadDeliveries();
  }
  if (eventType === 'VOID_REQUEST_CREATED') {
    const user = API.getUser();
    if (user && user.role === 'admin') {
      API.toast(`🔔 Owner Alert: ${data.requestedBy || 'Barista'} requested to void Order #${data.orderNumber}!`, 'warning');
    }
    loadOrders();
  }
  if (eventType === 'VOID_REQUEST_RESOLVED') {
    API.toast(`📢 Order #${data.orderNumber} void was ${data.status} by ${data.resolvedBy}.`, data.status === 'approved' ? 'success' : 'info');
    loadOrders();
  }
  if (eventType === 'PROMOTIONS_UPDATED') {
    loadPromotions();
  }
  if (eventType === 'PROMOTION_BROADCAST_PROGRESS') {
    updateBroadcastProgress(data);
  }
  if (eventType === 'PROMOTION_BROADCAST_COMPLETED') {
    handleBroadcastCompleted(data);
  }
  if (eventType === 'NEW_FEEDBACK') {
    loadFeedback();
  }
  if (eventType === 'MENU_UPDATED') {
    loadMenu();
  }
  if (eventType === 'CHATBOT_STATUS_CHANGED') {
    updateChatbotUI(data);
  }
  if (eventType === 'STORE_STATUS_CHANGED') {
    if (data && data.trigger_type === 'AUTO_SCHEDULE_RESUME') {
      API.toast(`⏰ Scheduled milestone reached. Manual override auto-reset: Store is now ${data.store_status}!`, 'info');
    }
    loadStoreStatus();
  }
  if (eventType === 'OPERATING_HOURS_UPDATED') {
    loadOperatingHoursSettings();
    loadStoreStatus();
  }
}

// ----------------------------------------------------------------------------
// 1. KPI Stats Loader
// ----------------------------------------------------------------------------
async function loadKPIs() {
  try {
    const res = await API.get('/orders/summary/kpis');
    if (res && (res.kpi || res.data)) {
      const kpi = res.kpi || res.data;
      const grossSales = (kpi.todays_gross_sales !== undefined)
        ? parseFloat(kpi.todays_gross_sales)
        : (kpi.totalRevenueToday !== undefined ? parseFloat(kpi.totalRevenueToday) : 0);
      document.getElementById('kpi-sales-today').innerText = `₱${grossSales.toFixed(2)}`;
      document.getElementById('kpi-pending-orders').innerText = kpi.pendingOrders;
      document.getElementById('kpi-active-deliveries').innerText = kpi.activeDeliveries;
      document.getElementById('kpi-payment-mismatches').innerText = kpi.paymentMismatches;
      document.getElementById('kpi-avg-rating').innerText = `${kpi.averageRating} / 5.0`;
      document.getElementById('nav-pending-count').innerText = kpi.pendingOrders;
    }
  } catch (err) {
    console.error('KPI error:', err);
  }
}

// ----------------------------------------------------------------------------
// 2. Orders & Kanban Management
// ----------------------------------------------------------------------------
async function loadOrders() {
  try {
    const orderTypeFilter = document.getElementById('order-filter-type')?.value || '';
    const res = await API.get(`/orders?orderType=${orderTypeFilter}`);
    if (res && res.orders) {
      allOrders = res.orders;
      renderOwnerVoidAlertBanner(allOrders);
      renderKanban(allOrders);
      renderOrdersTable(allOrders);
      renderOverviewOrders(allOrders.slice(0, 5));
    }
  } catch (err) {
    console.error('Load orders error:', err);
  }
}

function renderOwnerVoidAlertBanner(orders) {
  const container = document.getElementById('owner-void-alert-container');
  if (!container) return;

  const user = API.getUser();
  const isAdmin = user && user.role === 'admin';
  const isStaff = user && user.role === 'staff';
  const pendingVoids = (orders || []).filter(o => o.void_status === 'pending_approval' && o.status !== 'cancelled');

  if (pendingVoids.length === 0) {
    container.style.display = 'none';
    container.innerHTML = '';
    return;
  }

  container.style.display = 'block';

  if (isAdmin) {
    container.innerHTML = `
      <div class="card" style="background: linear-gradient(135deg, rgba(239, 68, 68, 0.18), rgba(185, 28, 28, 0.28)); border: 2px solid #ef4444; padding: 16px 20px; border-radius: 12px; box-shadow: 0 4px 16px rgba(239, 68, 68, 0.25);">
        <div style="display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 12px;">
          <div style="display: flex; align-items: center; gap: 14px;">
            <div style="font-size: 2.2rem; animation: pulse 1.2s infinite alternate;">🚨</div>
            <div>
              <div style="font-weight: 800; font-size: 1.05rem; color: #fca5a5;">
                Owner Permission Required: ${pendingVoids.length} Pending Void Request${pendingVoids.length > 1 ? 's' : ''}
              </div>
              <div style="font-size: 0.86rem; color: var(--text-secondary); margin-top: 2px;">
                ${pendingVoids.map(pv => `Order <strong>#${pv.order_number}</strong> requested by <em>${pv.void_requested_by || 'Barista'}</em> (Reason: ${pv.void_reason || 'Customer request'})`).join(' • ')}
              </div>
            </div>
          </div>
          <div style="display: flex; gap: 8px; flex-wrap: wrap;">
            ${pendingVoids.map(pv => `
              <div style="display: inline-flex; gap: 6px; align-items: center; background: rgba(0,0,0,0.35); padding: 6px 12px; border-radius: 8px; border: 1px solid rgba(239, 68, 68, 0.4);">
                <span style="font-weight: 800; font-size: 0.84rem; color: #fff;">#${pv.order_number}</span>
                <button class="btn btn-success btn-sm" onclick="ownerQuickApproveVoid(${pv.id}, '${pv.order_number}')" style="padding: 4px 10px; font-size: 0.78rem; font-weight: 700;">✅ Approve Void</button>
                <button class="btn btn-secondary btn-sm" onclick="ownerQuickRejectVoid(${pv.id}, '${pv.order_number}')" style="padding: 4px 10px; font-size: 0.78rem;">Reject</button>
              </div>
            `).join('')}
          </div>
        </div>
      </div>
    `;
  } else if (isStaff) {
    container.innerHTML = `
      <div class="card" style="background: rgba(234, 179, 8, 0.12); border: 1px solid var(--status-warning); padding: 12px 18px; border-radius: 8px;">
        <div style="display: flex; align-items: center; gap: 10px;">
          <span style="font-size: 1.4rem;">⏳</span>
          <div style="font-size: 0.88rem; color: #facc15;">
            <strong>Void Request Submitted:</strong> ${pendingVoids.length} order(s) (${pendingVoids.map(pv => '#' + pv.order_number).join(', ')}) are currently awaiting Owner authorization.
          </div>
        </div>
      </div>
    `;
  }
}

function toggleOrderView(view) {
  const kanban = document.getElementById('order-kanban-view');
  const table = document.getElementById('order-table-view');
  const kanbanBtn = document.getElementById('view-kanban-btn');
  const tableBtn = document.getElementById('view-table-btn');

  if (view === 'kanban') {
    kanban.style.display = 'grid';
    table.style.display = 'none';
    kanbanBtn.className = 'btn btn-primary btn-sm';
    tableBtn.className = 'btn btn-secondary btn-sm';
  } else {
    kanban.style.display = 'none';
    table.style.display = 'block';
    kanbanBtn.className = 'btn btn-secondary btn-sm';
    tableBtn.className = 'btn btn-primary btn-sm';
  }
}

function renderKanban(orders) {
  const columns = {
    pending: document.getElementById('kanban-pending'),
    preparing: document.getElementById('kanban-preparing'),
    dispatched: document.getElementById('kanban-dispatched'),
    delivered: document.getElementById('kanban-delivered'),
    cancelled: document.getElementById('kanban-cancelled')
  };

  const counts = { pending: 0, preparing: 0, dispatched: 0, delivered: 0, cancelled: 0 };
  Object.values(columns).forEach(col => { if (col) col.innerHTML = ''; });

  orders.forEach(order => {
    let status = (order.status || 'pending').toLowerCase();
    if (status === 'paid' || status === 'new' || status === 'unpaid') status = 'pending';
    if (counts[status] !== undefined) counts[status]++;
    if (!columns[status]) return;

    const itemsSummary = (order.items || []).map(i => `${i.quantity}x ${i.item_name}`).join(', ');

    let paymentBadge = '';
    const pMethodLower = (order.payment_method || '').toLowerCase();
    if (pMethodLower === 'xendit') {
      if (order.payment_mismatch) {
        paymentBadge = `<span class="badge badge-mismatch">⚠️ Xendit Mismatch</span>`;
      } else if (order.payment_status === 'Paid') {
        paymentBadge = `<span class="badge badge-gcash">💳 Xendit Paid</span>`;
      } else {
        paymentBadge = `<span class="badge badge-pending">💳 Xendit Pending</span>`;
      }
    } else if (pMethodLower === 'gcash') {
      if (order.payment_mismatch) {
        paymentBadge = `<span class="badge badge-mismatch">⚠️ GCash Mismatch</span>`;
      } else if (order.payment_status === 'Pending Verification') {
        paymentBadge = `<span class="badge badge-preparing" style="background: rgba(245, 158, 11, 0.2); color: #fbbf24; border: 1px solid #f59e0b;">⏳ Proof Sent</span>`;
      } else if (order.payment_status === 'Paid') {
        paymentBadge = `<span class="badge badge-gcash">📱 GCash Paid</span>`;
      } else if (order.payment_status === 'Failed' || order.payment_status === 'INVALID' || order.payment_status === 'Invalid') {
        paymentBadge = `<span class="badge badge-mismatch" style="background: rgba(239, 68, 68, 0.2); color: #f87171;">❌ Proof Invalid</span>`;
      } else {
        paymentBadge = `<span class="badge badge-pending">📱 GCash Pending</span>`;
      }
    } else {
      paymentBadge = `<span class="badge badge-cash">💵 Cash</span>`;
    }

    let actionBtn = '';
    if (status === 'pending') {
      actionBtn = `
        <div style="display: flex; gap: 6px; align-items: center;">
          <button class="btn btn-primary btn-sm" onclick="event.stopPropagation(); advanceOrderStatus(${order.id}, 'preparing')">🍳 Prep</button>
          <button class="btn btn-danger btn-sm" onclick="event.stopPropagation(); openCancelOrderModal(${order.id}, '${order.order_number}')" title="Cancel / Void Order" style="background: #ef4444; border: none; padding: 4px 8px; font-size: 0.75rem;">❌ Void</button>
        </div>
      `;
    } else if (status === 'preparing') {
      actionBtn = `
        <div style="display: flex; gap: 6px; align-items: center;">
          <button class="btn btn-secondary btn-sm" onclick="event.stopPropagation(); advanceOrderStatus(${order.id}, 'dispatched')">🛵 Dispatch</button>
          <button class="btn btn-danger btn-sm" onclick="event.stopPropagation(); openCancelOrderModal(${order.id}, '${order.order_number}')" title="Cancel / Void Order" style="background: #ef4444; border: none; padding: 4px 8px; font-size: 0.75rem;">❌ Void</button>
        </div>
      `;
    } else if (status === 'dispatched') {
      actionBtn = `
        <div style="display: flex; gap: 6px; align-items: center;">
          <button class="btn btn-success btn-sm" onclick="event.stopPropagation(); advanceOrderStatus(${order.id}, 'delivered')">✅ Delivered</button>
          <button class="btn btn-danger btn-sm" onclick="event.stopPropagation(); openCancelOrderModal(${order.id}, '${order.order_number}')" title="Cancel / Void Order" style="background: #ef4444; border: none; padding: 4px 8px; font-size: 0.75rem;">❌ Void</button>
        </div>
      `;
    } else if (status === 'cancelled') {
      actionBtn = `<span style="font-size: 0.76rem; color: var(--status-danger); font-weight: 700;">❌ Voided</span>`;
    }

    let voidNotice = '';
    if (order.void_status === 'pending_approval' && status !== 'cancelled') {
      const user = API.getUser();
      const isAdmin = user && user.role === 'admin';
      voidNotice = `
        <div style="margin: 6px 0; padding: 6px 8px; background: rgba(234, 179, 8, 0.16); border: 1px dashed #facc15; border-radius: 4px;">
          <div style="color: #facc15; font-size: 0.76rem; font-weight: 700;">⏳ Owner Void Approval Pending</div>
          <div style="font-size: 0.72rem; color: var(--text-secondary); margin-top: 2px;">By: ${order.void_requested_by || 'Barista'} (${order.void_reason || 'N/A'})</div>
          ${isAdmin ? `
            <div style="display: flex; gap: 4px; margin-top: 6px;">
              <button class="btn btn-success btn-sm" onclick="event.stopPropagation(); ownerQuickApproveVoid(${order.id}, '${order.order_number}')" style="padding: 2px 8px; font-size: 0.72rem; font-weight: 700;">✅ Approve</button>
              <button class="btn btn-secondary btn-sm" onclick="event.stopPropagation(); ownerQuickRejectVoid(${order.id}, '${order.order_number}')" style="padding: 2px 8px; font-size: 0.72rem;">Reject</button>
            </div>
          ` : ''}
        </div>
      `;
    }

    const card = document.createElement('div');
    card.className = `order-card ${status === 'cancelled' ? 'order-card-cancelled' : ''}`;
    card.onclick = () => viewOrderDetails(order.id);
    card.innerHTML = `
      <div class="order-card-header">
        <span class="order-number">#${order.order_number}</span>
        ${paymentBadge}
      </div>
      <div style="font-weight: 700; font-size: 0.92rem; margin-bottom: 4px;">${escapeHtml(order.customer_name || 'Customer')}</div>
      <div class="order-items-preview">${itemsSummary || '1x Order item'}</div>
      ${voidNotice}
      ${order.cancellation_reason ? `<div style="font-size: 0.76rem; color: var(--status-danger); margin-top: 4px;">Reason: ${order.cancellation_reason}</div>` : ''}
      <div class="order-card-footer">
        <div>
          <span class="badge ${order.order_type === 'delivery' ? 'badge-dispatched' : 'badge-preparing'}">${order.order_type}</span>
          <span class="order-total" style="margin-left: 8px;">₱${parseFloat(order.total_amount).toFixed(2)}</span>
        </div>
        <div>${actionBtn}</div>
      </div>
    `;

    columns[status].appendChild(card);
  });

  if (document.getElementById('kanban-count-pending')) document.getElementById('kanban-count-pending').innerText = counts.pending;
  if (document.getElementById('kanban-count-preparing')) document.getElementById('kanban-count-preparing').innerText = counts.preparing;
  if (document.getElementById('kanban-count-dispatched')) document.getElementById('kanban-count-dispatched').innerText = counts.dispatched;
  if (document.getElementById('kanban-count-delivered')) document.getElementById('kanban-count-delivered').innerText = counts.delivered;
  if (document.getElementById('kanban-count-cancelled')) document.getElementById('kanban-count-cancelled').innerText = counts.cancelled;
}

function renderOrdersTable(orders) {
  const tbody = document.getElementById('orders-table-tbody');
  tbody.innerHTML = '';

  orders.forEach(order => {
    const tr = document.createElement('tr');
    const itemsCount = (order.items || []).reduce((sum, i) => sum + i.quantity, 0);

    tr.innerHTML = `
      <td><strong>#${order.order_number}</strong></td>
      <td>${new Date(order.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</td>
      <td>${escapeHtml(order.customer_name || 'Customer')}</td>
      <td><span class="badge ${order.order_type === 'delivery' ? 'badge-dispatched' : 'badge-preparing'}">${order.order_type}</span></td>
      <td>${itemsCount} items</td>
      <td><strong>₱${parseFloat(order.total_amount).toFixed(2)}</strong></td>
      <td>
        <span class="badge ${order.payment_mismatch ? 'badge-mismatch' : (order.payment_method === 'gcash' || order.payment_method === 'xendit') ? 'badge-gcash' : 'badge-cash'}">
          ${order.payment_mismatch ? '⚠️ Mismatch' : order.payment_method}
        </span>
      </td>
      <td><span class="badge badge-${order.status}">${order.status}</span></td>
      <td>
        <button class="btn btn-secondary btn-sm" onclick="viewOrderDetails(${order.id})">Details</button>
      </td>
    `;
    tbody.appendChild(tr);
  });
}

function renderOverviewOrders(orders) {
  const tbody = document.getElementById('overview-orders-tbody');
  tbody.innerHTML = '';

  orders.forEach(order => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td><strong>#${order.order_number}</strong></td>
      <td>${escapeHtml(order.customer_name || 'Customer')}</td>
      <td><span class="badge badge-info">${order.order_type}</span></td>
      <td><strong>₱${parseFloat(order.total_amount).toFixed(2)}</strong></td>
      <td><span class="badge ${order.payment_mismatch ? 'badge-mismatch' : (order.payment_method === 'gcash' || order.payment_method === 'xendit') ? 'badge-gcash' : 'badge-cash'}">${order.payment_method}</span></td>
      <td><span class="badge badge-${order.status}">${order.status}</span></td>
      <td><button class="btn btn-secondary btn-sm" onclick="viewOrderDetails(${order.id})">View</button></td>
    `;
    tbody.appendChild(tr);
  });
}

async function advanceOrderStatus(orderId, newStatus) {
  try {
    const res = await API.patch(`/orders/${orderId}/status`, { status: newStatus });
    if (res && res.success) {
      API.toast(`Order marked as ${newStatus}!`, 'success');
      loadOrders();
      loadKPIs();
    }
  } catch (err) {
    console.error('Order status advance error:', err);
  }
}

let currentOpenedOrder = null;

async function viewOrderDetails(orderId) {
  try {
    const res = await API.get(`/orders/${orderId}`);
    if (res && res.order) {
      const o = res.order;
      currentOpenedOrder = o;
      document.getElementById('modal-order-number').innerText = `Order #${o.order_number}`;

      const diningModeNorm = (o.dining_mode || (o.order_type === 'pickup' ? 'PICK_UP' : 'DELIVERY')).toUpperCase().replace(/[-\s]/g, '_');
      const isPickupOrDineIn = diningModeNorm.includes('PICK') || diningModeNorm.includes('DINE');
      const diningModeLabel = diningModeNorm.includes('DINE') ? 'Dine-In' : (diningModeNorm.includes('PICK') ? 'Store Pick-Up' : 'Delivery');
      const customerNote = (o.note || o.customer_note || o.customer_notes || '').trim() || '-';

      const orderStatusNorm = String(o.status || o.order_status || '').toLowerCase().trim();
      const isPendingApprovalStatus = (orderStatusNorm === 'pending' || orderStatusNorm === 'pending_approval' || orderStatusNorm === 'awaiting_confirmation');
      const showPaymentActionButtons = isPendingApprovalStatus && (
        ['gcash', 'xendit'].includes((o.payment_method || '').toLowerCase()) ||
        o.payment_status === 'Pending Verification' ||
        Boolean(o.payment_ref_number || o.reference_no || o.gcash_ref) ||
        Boolean(o.payment_proof_image || o.receipt_url)
      );

      const itemsHtml = (o.items || []).map(i => `
        <div style="display: flex; justify-content: space-between; padding: 6px 0; border-bottom: 1px dashed var(--border-subtle);">
          <div>
            <strong>${i.quantity}x ${i.item_name}</strong>
            ${i.special_instructions ? `<div style="font-size: 0.78rem; color: var(--brand-primary);">${escapeHtml(i.special_instructions)}</div>` : ''}
          </div>
          <div>₱${parseFloat(i.subtotal).toFixed(2)}</div>
        </div>
      `).join('');

      document.getElementById('modal-order-body').innerHTML = `
        <div style="margin-bottom: 16px;">
          <div style="display: flex; justify-content: space-between; margin-bottom: 8px;">
            <span>Customer: <strong>${escapeHtml((o.first_name || '') + ' ' + (o.last_name || ''))}</strong></span>
            <span>Status: <span class="badge badge-${o.status}">${o.status}</span></span>
          </div>
          <div style="font-size: 0.88rem; color: var(--text-secondary); margin-bottom: 3px;">Phone: <strong>${escapeHtml(o.customer_phone || 'N/A')}</strong></div>
          <div style="font-size: 0.88rem; color: var(--text-secondary); margin-bottom: 3px;">Dining Mode: <strong>${escapeHtml(diningModeLabel)}</strong></div>

          ${isPickupOrDineIn ? `
            <div style="font-size: 0.88rem; color: var(--brand-gold); margin-bottom: 3px;">
              ⏰ <strong>Arriving Time:</strong> ${escapeHtml(o.arriving_time || '-')}
            </div>
            <div style="font-size: 0.88rem; color: var(--text-secondary); margin-bottom: 3px;">
              📍 Fulfillment: <em>${escapeHtml(diningModeLabel)} (In-Store)</em>
            </div>
          ` : `
            <div style="font-size: 0.88rem; color: var(--text-secondary); margin-bottom: 3px;">
              📍 Address: <strong>${escapeHtml(o.delivery_address || 'N/A')}</strong>
            </div>
            ${o.landmark ? `
              <div style="font-size: 0.88rem; color: var(--text-secondary); margin-bottom: 3px;">
                🚩 Landmark: <strong>${escapeHtml(o.landmark)}</strong>
              </div>
            ` : ''}
          `}

          <!-- Customer Note Field (Requirement 2) -->
          <div style="font-size: 0.88rem; color: var(--text-secondary); margin-top: 6px; padding: 6px 10px; background: rgba(255,255,255,0.03); border-left: 3px solid var(--brand-primary); border-radius: 4px;">
            <strong>Note:</strong> <span style="color: var(--text-primary);">${escapeHtml(customerNote)}</span>
          </div>
        </div>

        <h4 style="font-size: 0.95rem; margin: 16px 0 8px 0; color: var(--brand-crema);">Ordered Items:</h4>
        <div style="margin-bottom: 16px;">${itemsHtml}</div>

        <div style="padding-top: 8px;">
          <div style="display: flex; justify-content: space-between; font-size: 0.88rem;">
            <span>Subtotal:</span>
            <span>₱${parseFloat(o.subtotal).toFixed(2)}</span>
          </div>
          ${!isPickupOrDineIn ? `
            <div style="display: flex; justify-content: space-between; font-size: 0.88rem;">
              <span>Delivery Fee:</span>
              <span>₱${parseFloat(o.delivery_fee || 0).toFixed(2)}</span>
            </div>
          ` : ''}
          <div style="display: flex; justify-content: space-between; font-size: 1.15rem; font-weight: 800; color: var(--brand-gold); margin-top: 6px;">
            <span>Total Amount:</span>
            <span>₱${parseFloat(o.total_amount).toFixed(2)}</span>
          </div>
        </div>

        <!-- Payment & Proof of Payment Section (Requirement 4) -->
        <div style="margin-top: 16px; padding: 14px; background: var(--bg-surface-elevated); border-radius: var(--radius-sm); border: 1px solid var(--border-subtle);">
          <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
            <div style="font-size: 0.88rem; font-weight: 700; color: var(--brand-crema);">
              💳 Payment Method: <span style="text-transform: uppercase; color: var(--brand-primary);">${escapeHtml(o.payment_method || 'CASH')}</span>
            </div>
            <div>
              <span class="badge ${o.payment_status === 'Paid' ? 'badge-delivered' : (o.payment_status === 'Pending Verification' ? 'badge-preparing' : ((o.payment_status === 'Failed' || o.payment_status === 'INVALID' || o.payment_status === 'Invalid') ? 'badge-mismatch' : 'badge-pending'))}" style="font-size: 0.75rem; text-transform: uppercase; font-weight: 700;">
                ${escapeHtml(o.payment_status || 'Pending')}
              </span>
            </div>
          </div>

          ${(o.payment_mismatch || o.mismatch_notes) ? `<div style="color: var(--status-danger); font-size: 0.82rem; margin: 4px 0;">⚠️ ${escapeHtml(o.mismatch_notes || 'Payment proof flagged as invalid')}</div>` : ''}

          <!-- Show Reference Number if present -->
          ${(o.payment_ref_number || o.reference_no || o.gcash_ref) ? `
            <div style="font-size: 0.86rem; color: var(--text-primary); margin: 6px 0; display: flex; align-items: center; gap: 6px;">
              <span>🔢 Reference Number:</span>
              <strong style="color: var(--brand-primary); font-family: monospace; font-size: 0.95rem; letter-spacing: 0.5px;">
                ${escapeHtml(o.payment_ref_number || o.reference_no || o.gcash_ref)}
              </strong>
            </div>
          ` : ''}

          <!-- Clickable thumbnail preview for payment_proof_image OR Xendit Invoice Link -->
          ${(o.payment_proof_image || o.receipt_url) ? (
            ((o.payment_method || '').toLowerCase() === 'xendit' || /xendit\.co/i.test(o.payment_proof_image || o.receipt_url)) ? `
              <div style="margin-top: 10px; padding-top: 10px; border-top: 1px dashed var(--border-subtle);">
                <div style="font-size: 0.82rem; color: var(--text-secondary); margin-bottom: 6px;">
                  💳 Xendit Checkout Invoice:
                </div>
                <a href="${escapeHtml(o.payment_proof_image || o.receipt_url)}" target="_blank" rel="noopener noreferrer" class="btn btn-secondary btn-sm" style="display: inline-flex; align-items: center; gap: 6px; text-decoration: none;">
                  🔗 Open Xendit Invoice Page
                </a>
              </div>
            ` : `
              <div style="margin-top: 10px; padding-top: 10px; border-top: 1px dashed var(--border-subtle);">
                <div style="font-size: 0.82rem; color: var(--text-secondary); margin-bottom: 6px;">
                  📸 Proof of Payment (Click to view full image):
                </div>
                <a href="${escapeHtml(o.payment_proof_image || o.receipt_url)}" target="_blank" rel="noopener noreferrer" title="View Full Payment Proof in new tab">
                  <img src="${escapeHtml(o.payment_proof_image || o.receipt_url)}" alt="GCash Receipt" 
                       style="max-height: 125px; max-width: 220px; object-fit: contain; border-radius: 6px; border: 1px solid var(--border-subtle); background: #111; box-shadow: 0 2px 8px rgba(0,0,0,0.4); cursor: pointer; transition: transform 0.2s;" 
                       onmouseover="this.style.transform='scale(1.02)'" onmouseout="this.style.transform='scale(1)'" />
                </a>
              </div>
            `
          ) : `
            ${((o.payment_method || '').toLowerCase() === 'gcash' && o.payment_status !== 'Paid') ? `
              <div style="font-size: 0.8rem; color: var(--text-muted); margin-top: 6px; font-style: italic;">
                ℹ️ Customer has not uploaded an image receipt yet.
              </div>
            ` : ''}
          `}

          <!-- Staff Verification Action Buttons: Strictly SHOW for PENDING / PENDING_APPROVAL only; HIDE/REMOVE for IN_PREPARATION, DISPATCHED, DELIVERED, CANCELLED -->
          ${showPaymentActionButtons ? `
            <div style="margin-top: 14px; padding-top: 12px; border-top: 1px solid var(--border-subtle); display: flex; gap: 10px; flex-wrap: wrap;">
              <button type="button" class="btn btn-success btn-sm" onclick="markPaymentVerified(${o.id}, '${o.order_number}')" 
                      style="font-weight: 700; background: #10b981; color: #fff; border: none; padding: 7px 14px; border-radius: 6px; cursor: pointer; display: inline-flex; align-items: center; gap: 5px;"
                      ${o.payment_status === 'Paid' ? 'disabled style="opacity: 0.55; cursor: not-allowed;"' : ''}>
                <span>✅ Mark Payment Verified / Paid</span>
              </button>
              <button type="button" class="btn btn-danger btn-sm" onclick="markPaymentInvalid(${o.id}, '${o.order_number}')" 
                      style="font-weight: 700; background: #ef4444; color: #fff; border: none; padding: 7px 14px; border-radius: 6px; cursor: pointer; display: inline-flex; align-items: center; gap: 5px;">
                <span>⚠️ Invalid Payment Proof</span>
              </button>
            </div>
          ` : ''}
        </div>

        ${o.void_status === 'pending_approval' && o.status !== 'cancelled' ? `
          <div style="margin-top: 16px; padding: 14px; background: rgba(234, 179, 8, 0.15); border-left: 4px solid var(--status-warning); border-radius: var(--radius-sm);">
            <div style="font-weight: 700; color: #facc15; font-size: 0.92rem;">⏳ Owner Void Permission Pending</div>
            <div style="font-size: 0.84rem; margin-top: 4px; color: var(--text-secondary);">
              Requested by: <strong>${o.void_requested_by || 'Barista'}</strong>
              <br>Reason: ${o.void_reason || 'Customer request'}
            </div>
            ${(API.getUser() && API.getUser().role === 'admin') ? `
              <div style="margin-top: 10px; display: flex; gap: 8px;">
                <button class="btn btn-success btn-sm" onclick="ownerQuickApproveVoid(${o.id}, '${o.order_number}')" style="font-weight: 700;">✅ Approve Void</button>
                <button class="btn btn-secondary btn-sm" onclick="ownerQuickRejectVoid(${o.id}, '${o.order_number}')">Reject</button>
              </div>
            ` : ''}
          </div>
        ` : ''}

        ${o.status === 'cancelled' ? `
          <div style="margin-top: 16px; padding: 14px; background: rgba(239, 68, 68, 0.12); border-left: 4px solid var(--status-danger); border-radius: var(--radius-sm); color: #fca5a5;">
            <div style="font-weight: 700; font-size: 0.92rem;">❌ Order Cancelled / Voided</div>
            <div style="font-size: 0.84rem; margin-top: 4px;">Reason: ${o.cancellation_reason || 'Cancelled by cafe operations'}</div>
          </div>
        ` : ''}
      `;

      // Update Cancel Button in Modal Footer
      const cancelBtn = document.getElementById('btn-cancel-order-modal');
      if (cancelBtn) {
        cancelBtn.style.display = (o.status === 'cancelled') ? 'none' : 'inline-flex';
      }

      const actionsLeft = document.getElementById('modal-order-actions-left');
      if (actionsLeft && o.status === 'cancelled') {
        actionsLeft.innerHTML = `
          <span class="badge badge-danger" style="padding: 8px 14px; font-size: 0.85rem;">❌ Voided Order</span>
        `;
      }

      openModal('modal-order-details');
    }
  } catch (err) {
    console.error('View order details error:', err);
  }
}

function triggerCancelCurrentOrder() {
  if (currentOpenedOrder) {
    openCancelOrderModal(currentOpenedOrder.id, currentOpenedOrder.order_number);
  }
}

function openCancelOrderModal(orderId, orderNumber) {
  const user = API.getUser();
  const isBarista = user && user.role === 'staff';

  document.getElementById('cancel-order-id').value = orderId;
  document.getElementById('cancel-order-number').value = orderNumber;
  document.getElementById('cancel-reason-select').value = 'Customer requested cancellation';
  document.getElementById('cancel-custom-reason-group').style.display = 'none';
  document.getElementById('cancel-custom-reason-input').value = '';
  
  const managerPassInput = document.getElementById('cancel-manager-password-input');
  if (managerPassInput) managerPassInput.value = '';

  const notice = document.getElementById('barista-void-notice');
  const authGroup = document.getElementById('barista-manager-auth-group');
  const modalTitle = document.getElementById('cancel-order-modal-title');
  const submitBtn = document.getElementById('btn-submit-cancel-order');
  const desc = document.getElementById('cancel-order-desc');

  if (isBarista) {
    if (notice) notice.style.display = 'block';
    if (authGroup) authGroup.style.display = 'block';
    if (modalTitle) modalTitle.innerText = `🛡️ Request Void Permission #${orderNumber}`;
    if (desc) desc.innerText = `As a Barista, voiding requires Owner permission. Select a reason to send a request, or enter the Manager password for on-site override:`;
    if (submitBtn) {
      submitBtn.innerText = `📩 Send Void Request to Owner`;
      submitBtn.style.background = '#d97706';
      submitBtn.style.color = '#ffffff';
    }
  } else {
    if (notice) notice.style.display = 'none';
    if (authGroup) authGroup.style.display = 'none';
    if (modalTitle) modalTitle.innerText = `❌ Cancel / Void Order #${orderNumber}`;
    if (desc) desc.innerText = `Are you sure you want to cancel and void this order? Stock will be restored to inventory.`;
    if (submitBtn) {
      submitBtn.innerText = `Confirm Cancel / Void (Owner Authorization)`;
      submitBtn.style.background = '#ef4444';
      submitBtn.style.color = '#ffffff';
    }
  }

  if (managerPassInput) {
    managerPassInput.oninput = () => {
      if (isBarista && submitBtn) {
        if (managerPassInput.value.trim().length > 0) {
          submitBtn.innerText = `🔓 Authorize & Void Immediately`;
          submitBtn.style.background = '#ef4444';
        } else {
          submitBtn.innerText = `📩 Send Void Request to Owner`;
          submitBtn.style.background = '#d97706';
        }
      }
    };
  }

  openModal('modal-cancel-order');
}

function handleCancelReasonChange(val) {
  const customGroup = document.getElementById('cancel-custom-reason-group');
  if (customGroup) {
    customGroup.style.display = (val === 'Other') ? 'block' : 'none';
  }
}

async function handleCancelOrderSubmit(event) {
  event.preventDefault();
  const orderId = document.getElementById('cancel-order-id').value;
  const orderNumber = document.getElementById('cancel-order-number').value;
  const reasonSelect = document.getElementById('cancel-reason-select').value;
  const customInput = document.getElementById('cancel-custom-reason-input').value.trim();
  const managerPassword = document.getElementById('cancel-manager-password-input')?.value.trim() || '';
  
  const finalReason = (reasonSelect === 'Other' && customInput) ? customInput : reasonSelect;
  const user = API.getUser();
  const isBarista = user && user.role === 'staff';

  try {
    if (isBarista && !managerPassword) {
      // Send request to Owner
      const res = await API.post(`/orders/${orderId}/request-void`, { reason: finalReason });
      if (res && res.success) {
        closeModal('modal-cancel-order');
        closeModal('modal-order-details');
        API.toast(`📩 Void request for Order #${orderNumber} sent to Owner for approval.`, 'info');
        await Promise.all([loadOrders(), loadKPIs()]);
      } else {
        API.toast(res.message || 'Failed to send void request.', 'error');
      }
    } else {
      // Authorize with Owner role OR Manager Password
      const res = await API.post(`/orders/${orderId}/authorize-void`, {
        reason: finalReason,
        managerPassword: managerPassword || undefined
      });

      if (res && res.success) {
        closeModal('modal-cancel-order');
        closeModal('modal-order-details');
        API.toast(`✅ Order #${orderNumber} cancelled and stock restored to inventory.`, 'success');
        await Promise.all([loadOrders(), loadKPIs(), loadInventory(), loadDeliveries()]);
      } else {
        API.toast(res.message || 'Failed to void order.', 'error');
      }
    }
  } catch (err) {
    API.toast(err.message || 'Error processing void.', 'error');
  }
}

async function ownerQuickApproveVoid(orderId, orderNumber) {
  if (!confirm(`Owner Approval: Are you sure you want to approve voiding Order #${orderNumber}? All deducted stock will be restored to inventory.`)) {
    return;
  }
  try {
    const res = await API.post(`/orders/${orderId}/authorize-void`, {
      reason: 'Void request approved by Owner'
    });
    if (res && res.success) {
      closeModal('modal-order-details');
      API.toast(`✅ Order #${orderNumber} void approved and inventory restocked.`, 'success');
      await Promise.all([loadOrders(), loadKPIs(), loadInventory(), loadDeliveries()]);
    } else {
      API.toast(res.message || 'Failed to approve void.', 'error');
    }
  } catch (err) {
    API.toast(err.message || 'Error approving void.', 'error');
  }
}

async function ownerQuickRejectVoid(orderId, orderNumber) {
  const reason = prompt(`Reject Void Request for Order #${orderNumber}. Rejection reason (optional):`, 'Void request rejected by Owner');
  if (reason === null) return;
  try {
    const res = await API.post(`/orders/${orderId}/reject-void`, {
      rejectionNote: reason || 'Void request rejected by Owner'
    });
    if (res && res.success) {
      closeModal('modal-order-details');
      API.toast(`🚫 Void request for Order #${orderNumber} was rejected.`, 'info');
      await Promise.all([loadOrders(), loadKPIs()]);
    } else {
      API.toast(res.message || 'Failed to reject void.', 'error');
    }
  } catch (err) {
    API.toast(err.message || 'Error rejecting void.', 'error');
  }
}

function printReceipt() {
  window.print();
}

/**
 * Staff Marks Payment as Verified / Paid
 * Updates payment to Paid, moves status from Pending to In Kitchen Preparation,
 * notifies customer on Messenger, and refreshes Kanban immediately.
 */
async function markPaymentVerified(orderId, orderNumber) {
  if (!confirm(`Mark payment as VERIFIED / PAID for Order #${orderNumber}?\n\n• Order will move to 'In Kitchen Preparation'.\n• Customer will receive an automated confirmation on Facebook Messenger.`)) {
    return;
  }

  try {
    const res = await API.post(`/orders/${orderId}/verify-payment`, {});
    if (res && res.success) {
      API.toast(`✅ Payment for Order #${orderNumber} marked as Paid! Moved to In Kitchen.`, 'success');
      await Promise.all([loadOrders(), loadKPIs()]);
      // Refresh the modal view if open
      viewOrderDetails(orderId);
    } else {
      API.toast(res.message || 'Failed to verify payment.', 'error');
    }
  } catch (err) {
    API.toast(err.message || 'Error verifying payment.', 'error');
  }
}

/**
 * Opens the Invalid Payment Proof modal with selectable reasons
 */
function openInvalidPaymentModal(orderId, orderNumber) {
  const modal = document.getElementById('modal-invalid-payment');
  if (!modal) return;

  const idInput = document.getElementById('invalid-payment-order-id');
  const numInput = document.getElementById('invalid-payment-order-number');
  const labelEl = document.getElementById('invalid-payment-order-label');
  if (idInput) idInput.value = orderId;
  if (numInput) numInput.value = orderNumber;
  if (labelEl) labelEl.textContent = `Order #${orderNumber}`;

  // Reset radio to default "Malabo ang picture"
  const defaultRadio = document.querySelector('input[name="invalid-payment-reason-radio"][value="Malabo ang picture"]');
  if (defaultRadio) defaultRadio.checked = true;

  // Reset custom reason field
  const customGroup = document.getElementById('invalid-payment-custom-group');
  const customInput = document.getElementById('invalid-payment-custom-reason');
  if (customGroup) customGroup.style.display = 'none';
  if (customInput) customInput.value = '';

  const submitBtn = document.getElementById('btn-submit-invalid-payment');
  if (submitBtn) {
    submitBtn.disabled = false;
    submitBtn.innerHTML = '<span>⚠️ Confirm Rejection & Notify Customer</span>';
  }

  openModal('modal-invalid-payment');
}

/**
 * Toggles the visibility of the custom reason textarea when "Etc" is selected
 */
function toggleCustomReasonField(selectedValue) {
  const customGroup = document.getElementById('invalid-payment-custom-group');
  const customInput = document.getElementById('invalid-payment-custom-reason');
  if (!customGroup) return;

  if (selectedValue === 'Etc') {
    customGroup.style.display = 'block';
    if (customInput) {
      customInput.focus();
    }
  } else {
    customGroup.style.display = 'none';
  }
}

/**
 * Handles submission of Invalid Payment Proof form
 */
async function handleInvalidPaymentSubmit(event) {
  if (event) event.preventDefault();

  const orderId = document.getElementById('invalid-payment-order-id').value;
  const orderNumber = document.getElementById('invalid-payment-order-number').value;

  const selectedRadio = document.querySelector('input[name="invalid-payment-reason-radio"]:checked');
  const radioValue = selectedRadio ? selectedRadio.value : 'Malabo ang picture';

  let finalReason = radioValue;
  if (radioValue === 'Etc') {
    const customText = (document.getElementById('invalid-payment-custom-reason').value || '').trim();
    if (!customText) {
      API.toast('Paki-lagay po ang custom na dahilan bago mag-confirm.', 'warning');
      document.getElementById('invalid-payment-custom-reason').focus();
      return;
    }
    finalReason = customText;
  }

  const submitBtn = document.getElementById('btn-submit-invalid-payment');
  if (submitBtn) {
    submitBtn.disabled = true;
    submitBtn.innerHTML = '<span>⏳ Sending Notification...</span>';
  }

  try {
    const res = await API.post(`/orders/${orderId}/invalid-payment`, {
      reason: finalReason,
      reasonCode: radioValue
    });

    if (res && res.success) {
      API.toast(`⚠️ Payment proof for Order #${orderNumber} marked as invalid. Customer notified on Messenger!`, 'info');
      closeModal('modal-invalid-payment');
      await Promise.all([loadOrders(), loadKPIs()]);
      // Refresh the order details modal if currently open
      if (typeof viewOrderDetails === 'function') {
        viewOrderDetails(orderId);
      }
    } else {
      API.toast(res.message || 'Failed to update payment status.', 'error');
    }
  } catch (err) {
    API.toast(err.message || 'Error updating payment status.', 'error');
  } finally {
    if (submitBtn) {
      submitBtn.disabled = false;
      submitBtn.innerHTML = '<span>⚠️ Confirm Rejection & Notify Customer</span>';
    }
  }
}

/**
 * Staff Marks Payment Proof as Invalid (triggers the modal)
 */
function markPaymentInvalid(orderId, orderNumber) {
  openInvalidPaymentModal(orderId, orderNumber);
}

window.markPaymentVerified = markPaymentVerified;
window.markPaymentInvalid = markPaymentInvalid;
window.openInvalidPaymentModal = openInvalidPaymentModal;
window.toggleCustomReasonField = toggleCustomReasonField;
window.handleInvalidPaymentSubmit = handleInvalidPaymentSubmit;

// ----------------------------------------------------------------------------
// 3. Menu Management
// ----------------------------------------------------------------------------
async function loadMenu() {
  try {
    const res = await API.get('/menu');
    if (res && res.categories) {
      allMenuCategories = res.categories;
      renderCategoryPills(allMenuCategories);
      renderMenuItems(allMenuCategories);
    }
  } catch (err) {
    console.error('Load menu error:', err);
  }
}

function renderCategoryPills(categories) {
  const pillsContainer = document.getElementById('menu-category-pills');
  pillsContainer.innerHTML = `
    <button class="btn ${activeCategoryFilter === 'all' ? 'btn-primary' : 'btn-secondary'} btn-sm" onclick="filterMenuCategory('all')">
      All Items
    </button>
  `;

  categories.forEach(cat => {
    const btn = document.createElement('button');
    btn.className = `btn ${activeCategoryFilter === cat.slug ? 'btn-primary' : 'btn-secondary'} btn-sm`;
    btn.innerText = cat.name;
    btn.onclick = () => filterMenuCategory(cat.slug);
    pillsContainer.appendChild(btn);
  });
}

function filterMenuCategory(slug) {
  activeCategoryFilter = slug;
  renderCategoryPills(allMenuCategories);
  renderMenuItems(allMenuCategories);
}

/**
 * Dynamic 3-Tier Numerical Stock Status Badge
 * - >10: IN STOCK (Green)
 * - 1-10: LOW STOCK (Yellow / Amber)
 * - <=0: SOLD OUT (Red)
 */
function renderStockBadge(quantity, status) {
  const q = Number(quantity) || 0;
  if (status === 'OUT_OF_STOCK' || q <= 0) {
    return `<span class="badge badge-soldout badge-danger" style="background-color: rgba(239, 68, 68, 0.2); color: #ef4444; border: 1px solid #ef4444; font-weight: 700;">SOLD OUT</span>`;
  } else if (q <= 10) {
    return `<span class="badge badge-lowstock badge-warning" style="background-color: rgba(234, 179, 8, 0.2); color: #eab308; border: 1px solid #eab308; font-weight: 700;">LOW STOCK (${q} left)</span>`;
  } else {
    return `<span class="badge badge-instock badge-success" style="background-color: rgba(34, 197, 94, 0.2); color: #22c55e; border: 1px solid #22c55e; font-weight: 700;">IN STOCK (${q})</span>`;
  }
}
const renderStockPill = renderStockBadge;

async function quickAdjustStock(itemId, delta) {
  try {
    const res = await API.patch(`/menu/${itemId}/stock`, { delta });
    if (res && res.success) {
      API.toast(res.message, 'success');
      loadMenu();
    }
  } catch (err) {
    console.error('Quick adjust stock error:', err);
    API.toast(err.message || 'Failed to update stock.', 'danger');
  }
}

function renderMenuItems(categories) {
  const grid = document.getElementById('menu-grid-container');
  grid.innerHTML = '';

  categories.forEach(cat => {
    if (activeCategoryFilter !== 'all' && activeCategoryFilter !== cat.slug) return;

    (cat.items || []).forEach(item => {
      const card = document.createElement('div');
      card.className = 'menu-card';
      card.innerHTML = `
        <img class="menu-card-img" src="${item.image_url || 'https://images.unsplash.com/photo-1541167760496-1628856ab772?w=500'}" alt="${item.name}">
        <div class="menu-card-body">
          <div class="menu-card-title">
            <span>${item.name}</span>
            <span class="menu-card-price">₱${parseFloat(item.price).toFixed(2)}</span>
          </div>
          <div class="menu-card-desc">${item.description || ''}</div>
          <div style="display: flex; gap: 8px; margin-bottom: 10px; align-items: center; flex-wrap: wrap;">
            ${renderStockBadge(item.stock_quantity, item.status)}
            <span class="badge ${item.is_available ? 'badge-delivered' : 'badge-mismatch'}">
              ${item.is_available ? 'In Menu' : 'Unavailable'}
            </span>
          </div>

          <!-- Quick Restock Stepper Controls -->
          <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 12px; padding: 6px 10px; background: var(--bg-surface-elevated, #241a12); border-radius: 8px; border: 1px solid var(--border-subtle);">
            <span style="font-size: 0.76rem; color: var(--text-muted); font-weight: 600;">QUICK RESTOCK:</span>
            <div style="display: inline-flex; align-items: center; gap: 4px;">
              <button type="button" class="btn btn-secondary btn-sm" style="padding: 2px 7px; font-weight: 800; font-size: 0.8rem; line-height: 1;" onclick="quickAdjustStock(${item.id}, -1)" title="Decrease 1">-1</button>
              <span style="font-weight: 800; font-size: 0.88rem; min-width: 26px; text-align: center; color: var(--brand-primary);">${item.stock_quantity || 0}</span>
              <button type="button" class="btn btn-secondary btn-sm" style="padding: 2px 7px; font-weight: 800; font-size: 0.8rem; line-height: 1;" onclick="quickAdjustStock(${item.id}, 1)" title="Increase 1">+1</button>
              <button type="button" class="btn btn-primary btn-sm" style="padding: 2px 8px; font-weight: 700; font-size: 0.72rem; line-height: 1;" onclick="quickAdjustStock(${item.id}, 10)" title="Quick Restock +10">+10</button>
            </div>
          </div>

          <div class="menu-card-actions">
            <button class="btn ${item.is_available ? 'btn-outline' : 'btn-success'} btn-sm" onclick="toggleMenuItemAvailability(${item.id})">
              ${item.is_available ? 'Hide' : 'Enable'}
            </button>
            <div style="display: flex; gap: 6px;">
              <button class="btn btn-secondary btn-sm" onclick="openEditMenuItemModal(${item.id})">✏️ Edit</button>
              <button class="btn btn-danger btn-sm" onclick="deleteMenuItem(${item.id})">🗑️</button>
            </div>
          </div>
        </div>
      `;
      grid.appendChild(card);
    });
  });
}

async function toggleMenuItemAvailability(itemId) {
  try {
    const res = await API.patch(`/menu/${itemId}/toggle-availability`, {});
    if (res && res.success) {
      API.toast(res.message, 'success');
      loadMenu();
    }
  } catch (err) {
    console.error('Toggle availability error:', err);
  }
}

async function deleteMenuItem(itemId) {
  if (!confirm('Are you sure you want to remove this menu item?')) return;
  try {
    const res = await API.delete(`/menu/${itemId}`);
    if (res && res.success) {
      API.toast('Menu item removed.', 'success');
      loadMenu();
    }
  } catch (err) {
    console.error('Delete item error:', err);
  }
}

let stagedMenuImageBase64 = null;
let stagedMenuImageChanged = false;

function triggerMenuImagePick() {
  const fileInput = document.getElementById('menu-img-file');
  if (fileInput) {
    fileInput.value = ''; // Always clear previous value so re-selecting same file triggers change
    fileInput.click();
  }
}

function handleMenuImageSelect(event) {
  const fileInput = document.getElementById('menu-img-file');
  const file = (event && event.target && event.target.files && event.target.files[0]) ||
               (fileInput && fileInput.files && fileInput.files[0]);
  if (!file) {
    return;
  }

  // Validate image by MIME type or file extension
  const isImageMime = file.type && file.type.startsWith('image/');
  const isImageExt = file.name && /\.(jpe?g|png|webp|gif|bmp|svg|jfif|avif)$/i.test(file.name);
  if (!isImageMime && !isImageExt) {
    API.toast('Please select an image file (JPG, PNG, WEBP, etc.).', 'warning');
    return;
  }

  // Max 10MB
  if (file.size > 10 * 1024 * 1024) {
    API.toast('Image exceeds the 10MB limit. Please choose a smaller file.', 'danger');
    return;
  }

  const preview = document.getElementById('menu-img-preview');
  const emptyState = document.getElementById('menu-img-empty-state');
  const removeBtn = document.getElementById('menu-img-remove-btn');
  const status = document.getElementById('menu-img-status');
  const urlInput = document.getElementById('menu-img-input');

  if (emptyState) emptyState.style.display = 'none';
  if (status) {
    status.innerHTML = `<span style="color: var(--brand-gold, #f4a261);">⏳ Reading ${escapeHtml(file.name)}...</span>`;
  }

  const reader = new FileReader();
  reader.onerror = function(err) {
    console.error('[FileReader Error]', err);
    if (status) status.innerHTML = `<span style="color: var(--status-danger);">Failed to read file from device.</span>`;
    API.toast('Failed to read image from device.', 'danger');
  };

  reader.onload = function(e) {
    stagedMenuImageBase64 = e.target.result;
    stagedMenuImageChanged = true;

    if (preview) {
      preview.src = stagedMenuImageBase64;
      preview.style.display = 'block';
    }
    if (emptyState) emptyState.style.display = 'none';
    if (removeBtn) removeBtn.style.display = 'inline-flex';
    if (urlInput) urlInput.value = '';

    if (status) {
      status.innerHTML = `<span style="color: var(--brand-gold, #f4a261);">⏳ Uploading picture from device...</span>`;
    }

    // Immediately upload to server in background so it's ready when saving
    API.post('/menu/upload-image', { imageBase64: stagedMenuImageBase64 })
      .then(res => {
        if (res && res.imageUrl) {
          if (urlInput) urlInput.value = res.imageUrl;
          if (status) {
            status.innerHTML = `<span style="color: var(--status-success, #2a9d8f); font-weight: 600;">✓ Picture ready: ${escapeHtml(file.name)} (${(file.size / 1024).toFixed(1)} KB)</span>`;
          }
          API.toast('Picture chosen! Click "Save Item" to confirm.', 'success');
        }
      })
      .catch(err => {
        console.warn('[Direct Image Upload Warning, will retry on submit]', err);
        if (status) {
          status.innerHTML = `<span style="color: var(--brand-primary, #d4a373);">✓ Picture selected: ${escapeHtml(file.name)}</span>`;
        }
      });
  };

  reader.readAsDataURL(file);
}

function clearMenuImageSelection() {
  stagedMenuImageBase64 = null;
  stagedMenuImageChanged = true;

  const fileInput = document.getElementById('menu-img-file');
  if (fileInput) fileInput.value = '';

  const preview = document.getElementById('menu-img-preview');
  const emptyState = document.getElementById('menu-img-empty-state');
  const removeBtn = document.getElementById('menu-img-remove-btn');
  const status = document.getElementById('menu-img-status');
  const urlInput = document.getElementById('menu-img-input');

  if (preview) {
    preview.src = '';
    preview.style.display = 'none';
  }
  if (emptyState) emptyState.style.display = 'flex';
  if (removeBtn) removeBtn.style.display = 'none';
  if (status) status.innerHTML = '';
  if (urlInput) urlInput.value = '';
}

function handleManualImageUrl(url) {
  stagedMenuImageBase64 = null;
  stagedMenuImageChanged = true;
  const fileInput = document.getElementById('menu-img-file');
  if (fileInput) fileInput.value = '';

  const preview = document.getElementById('menu-img-preview');
  const emptyState = document.getElementById('menu-img-empty-state');
  const removeBtn = document.getElementById('menu-img-remove-btn');
  const status = document.getElementById('menu-img-status');

  if (url && url.trim()) {
    if (preview) {
      preview.src = url.trim();
      preview.style.display = 'block';
    }
    if (emptyState) emptyState.style.display = 'none';
    if (removeBtn) removeBtn.style.display = 'inline-flex';
    if (status) status.innerHTML = 'External image URL loaded';
  } else {
    clearMenuImageSelection();
  }
}

function toggleImageUrlInput() {
  const container = document.getElementById('menu-url-container');
  if (container) {
    container.style.display = container.style.display === 'none' ? 'block' : 'none';
  }
}

// Attach functions to window scope for inline HTML event attributes
window.triggerMenuImagePick = triggerMenuImagePick;
window.handleMenuImageSelect = handleMenuImageSelect;
window.clearMenuImageSelection = clearMenuImageSelection;
window.handleManualImageUrl = handleManualImageUrl;
window.toggleImageUrlInput = toggleImageUrlInput;

function handleStockQuantityChange(val) {
  const stock = parseInt(val, 10);
  const availSelect = document.getElementById('menu-availability-input');
  if (!availSelect) return;

  if (isNaN(stock) || stock <= 0) {
    availSelect.value = '0';
  } else if (availSelect.dataset.userOverridden !== 'true') {
    availSelect.value = '1';
  }
}

function handleAvailabilityStatusChange(val) {
  const availSelect = document.getElementById('menu-availability-input');
  if (availSelect) {
    availSelect.dataset.userOverridden = 'true';
  }
}

window.handleStockQuantityChange = handleStockQuantityChange;
window.handleAvailabilityStatusChange = handleAvailabilityStatusChange;

function openAddMenuItemModal() {
  document.getElementById('menu-item-id').value = '';
  document.getElementById('modal-menu-title').innerText = 'Add New Menu Item';
  document.getElementById('menu-name-input').value = '';
  document.getElementById('menu-desc-input').value = '';
  document.getElementById('menu-price-input').value = '';
  document.getElementById('menu-prep-input').value = '10';
  document.getElementById('menu-stock-input').value = '25';
  const availSelect = document.getElementById('menu-availability-input');
  if (availSelect) {
    availSelect.value = '1';
    delete availSelect.dataset.userOverridden;
  }

  // Reset image picker
  stagedMenuImageBase64 = null;
  stagedMenuImageChanged = false;
  const fileInput = document.getElementById('menu-img-file');
  if (fileInput) fileInput.value = '';
  const urlInput = document.getElementById('menu-img-input');
  if (urlInput) urlInput.value = '';
  const preview = document.getElementById('menu-img-preview');
  if (preview) { preview.src = ''; preview.style.display = 'none'; }
  const emptyState = document.getElementById('menu-img-empty-state');
  if (emptyState) emptyState.style.display = 'flex';
  const removeBtn = document.getElementById('menu-img-remove-btn');
  if (removeBtn) removeBtn.style.display = 'none';
  const status = document.getElementById('menu-img-status');
  if (status) status.innerText = '';
  const urlContainer = document.getElementById('menu-url-container');
  if (urlContainer) urlContainer.style.display = 'none';

  const select = document.getElementById('menu-cat-select');
  select.innerHTML = allMenuCategories.map(c => `<option value="${c.id}">${c.name}</option>`).join('');

  openModal('modal-menu-item');
}

function openEditMenuItemModal(itemId) {
  let targetItem = null;
  allMenuCategories.forEach(cat => {
    const match = (cat.items || []).find(i => i.id === itemId);
    if (match) targetItem = match;
  });

  if (!targetItem) return;

  document.getElementById('menu-item-id').value = targetItem.id;
  document.getElementById('modal-menu-title').innerText = 'Edit Menu Item';
  document.getElementById('menu-name-input').value = targetItem.name;
  document.getElementById('menu-desc-input').value = targetItem.description || '';
  document.getElementById('menu-price-input').value = targetItem.price;
  document.getElementById('menu-prep-input').value = targetItem.preparation_time_min || 10;
  
  // Populate Stock Quantity & Availability (Requirement 1)
  const stockQty = targetItem.stock_quantity !== undefined ? targetItem.stock_quantity : 0;
  document.getElementById('menu-stock-input').value = stockQty;
  const availSelect = document.getElementById('menu-availability-input');
  if (availSelect) {
    availSelect.value = (targetItem.is_available && stockQty > 0) ? '1' : '0';
    delete availSelect.dataset.userOverridden;
  }

  // Populate image picker with current item image
  stagedMenuImageBase64 = null;
  stagedMenuImageChanged = false;
  const fileInput = document.getElementById('menu-img-file');
  if (fileInput) fileInput.value = '';
  const urlInput = document.getElementById('menu-img-input');
  if (urlInput) urlInput.value = targetItem.image_url || '';
  const preview = document.getElementById('menu-img-preview');
  const emptyState = document.getElementById('menu-img-empty-state');
  const removeBtn = document.getElementById('menu-img-remove-btn');
  const status = document.getElementById('menu-img-status');
  const urlContainer = document.getElementById('menu-url-container');
  if (urlContainer) urlContainer.style.display = 'none';

  if (targetItem.image_url) {
    if (preview) {
      preview.src = targetItem.image_url;
      preview.style.display = 'block';
    }
    if (emptyState) emptyState.style.display = 'none';
    if (removeBtn) removeBtn.style.display = 'inline-flex';
    if (status) status.innerText = 'Current picture loaded';
  } else {
    if (preview) {
      preview.src = '';
      preview.style.display = 'none';
    }
    if (emptyState) emptyState.style.display = 'flex';
    if (removeBtn) removeBtn.style.display = 'none';
    if (status) status.innerText = '';
  }

  const select = document.getElementById('menu-cat-select');
  select.innerHTML = allMenuCategories.map(c => `
    <option value="${c.id}" ${Number(c.id) === Number(targetItem.category_id) ? 'selected' : ''}>${c.name}</option>
  `).join('');

  openModal('modal-menu-item');
}

async function handleMenuItemSubmit(e) {
  if (e) {
    if (e.preventDefault) e.preventDefault();
    if (e.stopPropagation) e.stopPropagation();
  }

  const idEl = document.getElementById('menu-item-id');
  const id = idEl ? idEl.value.trim() : '';
  const catSelect = document.getElementById('menu-cat-select');
  let categoryId = catSelect ? catSelect.value : '';
  const nameInput = document.getElementById('menu-name-input');
  const name = nameInput ? nameInput.value.trim() : '';
  const descInput = document.getElementById('menu-desc-input');
  const description = descInput ? descInput.value.trim() : '';
  const priceEl = document.getElementById('menu-price-input');
  const priceInput = priceEl ? priceEl.value : '';
  const price = parseFloat(priceInput);
  const prepEl = document.getElementById('menu-prep-input');
  const prepTimeMin = parseInt(prepEl ? prepEl.value : 10, 10) || 10;
  const urlEl = document.getElementById('menu-img-input');
  let imageUrl = (urlEl && urlEl.value ? urlEl.value.trim() : '');

  // Validate required fields
  if (!name) {
    API.toast('Please enter the item name.', 'warning');
    if (nameInput) nameInput.focus();
    return false;
  }

  if (isNaN(price) || price < 0) {
    API.toast('Please enter a valid price.', 'warning');
    if (priceEl) priceEl.focus();
    return false;
  }

  // Ensure categoryId is valid
  if (!categoryId && catSelect && catSelect.options && catSelect.options.length > 0) {
    categoryId = catSelect.options[0].value;
  }
  if (!categoryId && allMenuCategories.length > 0) {
    categoryId = allMenuCategories[0].id;
  }

  // Stock and Availability values
  const stockEl = document.getElementById('menu-stock-input');
  const stockQuantity = parseInt(stockEl ? stockEl.value : 0, 10) || 0;
  const availSelect = document.getElementById('menu-availability-input');
  const isAvailable = (availSelect && availSelect.value === '1' && stockQuantity > 0) ? 1 : 0;
  const unitEl = document.getElementById('menu-unit-input');
  const unit = (unitEl && unitEl.value) || 'servings';

  const saveBtn = document.getElementById('menu-save-btn');
  const origBtnText = saveBtn ? saveBtn.innerText : 'Save Item';
  if (saveBtn) {
    saveBtn.disabled = true;
    saveBtn.innerText = 'Saving...';
  }

  try {
    // If a new image file was chosen from device and not yet uploaded, upload it now
    if (stagedMenuImageBase64 && (!imageUrl || !imageUrl.startsWith('/uploads/'))) {
      if (saveBtn) saveBtn.innerText = 'Uploading pic...';
      const uploadRes = await API.post('/menu/upload-image', {
        imageBase64: stagedMenuImageBase64
      });
      if (uploadRes && uploadRes.imageUrl) {
        imageUrl = uploadRes.imageUrl;
        if (urlEl) urlEl.value = imageUrl;
      }
    } else if (stagedMenuImageChanged && !imageUrl) {
      // User explicitly cleared the picture
      imageUrl = '';
    }

    if (id) {
      await API.put(`/menu/${id}`, { 
        categoryId, 
        name, 
        description, 
        price, 
        prepTimeMin, 
        imageUrl,
        stock_quantity: stockQuantity,
        is_available: isAvailable
      });
      API.toast('Menu item updated successfully!', 'success');
    } else {
      await API.post('/menu', { 
        categoryId, 
        name, 
        description, 
        price, 
        prepTimeMin, 
        imageUrl, 
        initialStock: stockQuantity,
        stock_quantity: stockQuantity,
        is_available: isAvailable,
        unit 
      });
      API.toast('Menu item created successfully!', 'success');
    }

    closeModal('modal-menu-item');
    await loadMenu();
  } catch (err) {
    console.error('Menu submit error:', err);
    API.toast(err.message || 'Failed to save menu item. Please try again.', 'danger');
  } finally {
    if (saveBtn) {
      saveBtn.disabled = false;
      saveBtn.innerText = origBtnText;
    }
  }

  return false;
}

// Attach menu modal handlers to window scope for inline HTML event attributes
window.handleMenuItemSubmit = handleMenuItemSubmit;
window.openAddMenuItemModal = openAddMenuItemModal;
window.openEditMenuItemModal = openEditMenuItemModal;
window.deleteMenuItem = deleteMenuItem;
window.toggleMenuItemAvailability = toggleMenuItemAvailability;
window.quickAdjustStock = quickAdjustStock;
window.filterMenuCategory = filterMenuCategory;

// ----------------------------------------------------------------------------
// 4. Promotions & Events Management (Replaces Inventory & Stock Module)
// ----------------------------------------------------------------------------
let allPromotions = [];
let currentBroadcastPromoId = null;

async function loadPromotions() {
  try {
    const res = await API.get('/promotions');
    if (res && res.promotions) {
      allPromotions = res.promotions;
      renderPromotionsTable(allPromotions);
    }
  } catch (err) {
    console.error('Load promotions error:', err);
  }
}

// Background compatibility helper for legacy void routines
async function loadInventory() {
  try {
    const res = await API.get('/inventory');
    if (res && res.inventory) allInventory = res.inventory;
  } catch (e) {}
}

function renderPromotionsTable(promotions) {
  const tbody = document.getElementById('promotions-tbody');
  if (!tbody) return;
  tbody.innerHTML = '';

  if (!promotions || promotions.length === 0) {
    tbody.innerHTML = `<tr><td colspan="8" style="text-align: center; color: var(--text-muted); padding: 32px;">No promotions or events created yet. Click "+ Create Promo / Event" to start!</td></tr>`;
    return;
  }

  promotions.forEach(p => {
    const tr = document.createElement('tr');

    // Type Badge class
    let typeBadgeClass = 'badge-type-discount';
    if (p.promo_type === 'Bundle / BOGO') typeBadgeClass = 'badge-type-bundle';
    else if (p.promo_type === 'Cafe Event') typeBadgeClass = 'badge-type-event';

    // Status Badge class
    let statusBadgeClass = 'badge-active';
    if (p.status === 'UPCOMING') statusBadgeClass = 'badge-upcoming';
    else if (p.status === 'EXPIRED') statusBadgeClass = 'badge-expired';
    else if (p.status === 'INACTIVE') statusBadgeClass = 'badge-mismatch';

    // Poster thumbnail
    const posterHtml = p.banner_image_url
      ? `<img src="${escapeHtml(p.banner_image_url)}" class="promo-poster-thumb" alt="Poster" onerror="this.onerror=null; this.src='/favicon.ico';">`
      : `<div class="promo-poster-thumb" style="display: flex; align-items: center; justify-content: center; font-size: 1.3rem;">🖼️</div>`;

    tr.innerHTML = `
      <td>
        <div style="font-weight: 700; color: var(--brand-crema); font-size: 0.95rem;">${escapeHtml(p.title)}</div>
        ${p.description ? `<div style="font-size: 0.8rem; color: var(--text-muted); margin-top: 4px; max-width: 220px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${escapeHtml(p.description)}</div>` : ''}
      </td>
      <td>
        <span class="badge ${typeBadgeClass}">${escapeHtml(p.promo_type || 'Product Discount')}</span>
      </td>
      <td>${posterHtml}</td>
      <td>
        <strong style="color: var(--brand-gold);">${escapeHtml(p.perk_description)}</strong>
      </td>
      <td>
        <span style="font-size: 0.85rem; color: var(--text-secondary);">${escapeHtml(p.applicable_scope || 'All Menu Items')}</span>
      </td>
      <td>
        <span style="font-size: 0.85rem;">${escapeHtml(p.date_range_display || 'Always Valid')}</span>
      </td>
      <td>
        <span class="badge ${statusBadgeClass}">${escapeHtml(p.status)}</span>
      </td>
      <td>
        <div style="display: flex; align-items: center; gap: 8px;">
          <!-- Toggle Active / Inactive Switch -->
          <label class="switch" title="${p.is_active ? 'Click to deactivate' : 'Click to activate'}">
            <input type="checkbox" ${p.is_active ? 'checked' : ''} onchange="togglePromotion(${p.id})">
            <span class="slider"></span>
          </label>
          <button class="btn btn-secondary btn-sm" onclick="editPromotion(${p.id})" title="Edit Promo">✏️</button>
          <button class="btn btn-danger btn-sm" onclick="deletePromotion(${p.id}, '${escapeHtml(p.title).replace(/'/g, "\\'")}')" title="Delete Promo">🗑️</button>
          <button class="btn btn-primary btn-sm" onclick="openBroadcastModal(${p.id})" style="padding: 5px 9px;" title="Broadcast announcement via Messenger">📢 Broadcast</button>
        </div>
      </td>
    `;
    tbody.appendChild(tr);
  });
}

function openPromoModal(promoId = null) {
  const form = document.getElementById('promo-form');
  if (form) form.reset();
  
  document.getElementById('promo-id').value = '';
  document.getElementById('promo-banner-url').value = '';
  document.getElementById('promo-preview-wrapper').style.display = 'none';
  document.getElementById('promo-upload-placeholder').style.display = 'block';
  document.getElementById('promo-modal-title').innerText = 'Create Promo / Event';
  document.getElementById('promo-active-toggle').checked = true;

  if (promoId) {
    const p = allPromotions.find(item => item.id === promoId);
    if (p) {
      document.getElementById('promo-id').value = p.id;
      document.getElementById('promo-title').value = p.title || '';
      document.getElementById('promo-type').value = p.promo_type || 'Product Discount';
      document.getElementById('promo-perk').value = p.perk_description || '';
      document.getElementById('promo-scope').value = p.applicable_scope || 'All Menu Items';
      document.getElementById('promo-start-date').value = p.start_date || '';
      document.getElementById('promo-end-date').value = p.end_date || '';
      document.getElementById('promo-description').value = p.description || '';
      document.getElementById('promo-active-toggle').checked = !!p.is_active;
      document.getElementById('promo-modal-title').innerText = 'Edit Promo / Event';

      if (p.banner_image_url) {
        document.getElementById('promo-banner-url').value = p.banner_image_url;
        document.getElementById('promo-preview-img').src = p.banner_image_url;
        document.getElementById('promo-preview-wrapper').style.display = 'inline-block';
        document.getElementById('promo-upload-placeholder').style.display = 'none';
      }
    }
  }

  openModal('modal-promo');
}

function handlePromoFileSelect(event) {
  const file = event.target.files && event.target.files[0];
  if (!file) return;

  if (file.size > 5 * 1024 * 1024) {
    API.toast('File size exceeds maximum 5MB limit.', 'error');
    return;
  }

  const reader = new FileReader();
  reader.onload = async function(e) {
    const base64Data = e.target.result;
    // Live preview inside modal before saving
    document.getElementById('promo-preview-img').src = base64Data;
    document.getElementById('promo-preview-wrapper').style.display = 'inline-block';
    document.getElementById('promo-upload-placeholder').style.display = 'none';

    try {
      // Upload to server
      const res = await API.post('/promotions/upload-poster', { imageBase64: base64Data });
      if (res && res.success && res.imageUrl) {
        document.getElementById('promo-banner-url').value = res.imageUrl;
        API.toast('Poster uploaded successfully!', 'success');
      }
    } catch (err) {
      console.warn('Upload error, using local base64 fallback:', err.message);
      document.getElementById('promo-banner-url').value = base64Data;
    }
  };
  reader.readAsDataURL(file);
}

function removePromoImage(event) {
  event.stopPropagation();
  document.getElementById('promo-file-input').value = '';
  document.getElementById('promo-banner-url').value = '';
  document.getElementById('promo-preview-img').src = '';
  document.getElementById('promo-preview-wrapper').style.display = 'none';
  document.getElementById('promo-upload-placeholder').style.display = 'block';
}

async function handlePromoSubmit(e) {
  e.preventDefault();
  const id = document.getElementById('promo-id').value;
  const payload = {
    title: document.getElementById('promo-title').value.trim(),
    promo_type: document.getElementById('promo-type').value,
    perk_description: document.getElementById('promo-perk').value.trim(),
    applicable_scope: document.getElementById('promo-scope').value.trim(),
    start_date: document.getElementById('promo-start-date').value || null,
    end_date: document.getElementById('promo-end-date').value || null,
    banner_image_url: document.getElementById('promo-banner-url').value || null,
    description: document.getElementById('promo-description').value.trim() || null,
    is_active: document.getElementById('promo-active-toggle').checked ? 1 : 0
  };

  const saveBtn = document.getElementById('promo-save-btn');
  const origText = saveBtn.innerText;
  saveBtn.disabled = true;
  saveBtn.innerText = 'Saving...';

  try {
    let res;
    if (id) {
      res = await API.put(`/promotions/${id}`, payload);
    } else {
      res = await API.post('/promotions', payload);
    }

    if (res && res.success) {
      API.toast(res.message || 'Promotion saved successfully!', 'success');
      closeModal('modal-promo');
      loadPromotions();
    } else {
      API.toast(res.message || 'Failed to save promotion.', 'error');
    }
  } catch (err) {
    API.toast(err.message || 'Error saving promotion.', 'error');
  } finally {
    saveBtn.disabled = false;
    saveBtn.innerText = origText;
  }
}

async function togglePromotion(id) {
  try {
    const res = await API.patch(`/promotions/${id}/toggle`, {});
    if (res && res.success) {
      API.toast(res.message, 'success');
      loadPromotions();
    }
  } catch (err) {
    API.toast('Failed to toggle promotion status.', 'error');
  }
}

function editPromotion(id) {
  openPromoModal(id);
}

async function deletePromotion(id, title) {
  if (!confirm(`Are you sure you want to delete "${title}"?`)) return;
  try {
    const res = await API.delete(`/promotions/${id}`);
    if (res && res.success) {
      API.toast('Promotion deleted successfully.', 'success');
      loadPromotions();
    }
  } catch (err) {
    API.toast('Failed to delete promotion.', 'error');
  }
}

// ----------------------------------------------------------------------------
// Messenger Mass Broadcast Engine (Requirement 4)
// ----------------------------------------------------------------------------
async function openBroadcastModal(promoId) {
  currentBroadcastPromoId = promoId;
  const promo = allPromotions.find(p => p.id === promoId);
  if (!promo) return;

  document.getElementById('broadcast-promo-id').value = promo.id;
  document.getElementById('broadcast-title').innerText = promo.title;
  document.getElementById('broadcast-perk').innerText = `Perk: ${promo.perk_description}`;
  document.getElementById('broadcast-dates').innerText = `Schedule: ${promo.date_range_display || 'Always Valid'}`;
  document.getElementById('broadcast-thumb').src = promo.banner_image_url || '/favicon.ico';

  // Reset progress UI
  document.getElementById('broadcast-progress-container').style.display = 'none';
  document.getElementById('broadcast-progress-bar').style.width = '0%';
  document.getElementById('broadcast-progress-percent').innerText = '0%';
  document.getElementById('broadcast-status-label').innerText = 'Dispatching announcements...';
  document.getElementById('broadcast-progress-text').innerText = 'Sent 0 of 0...';

  const sendBtn = document.getElementById('btn-start-broadcast');
  const cancelBtn = document.getElementById('btn-cancel-broadcast');
  sendBtn.disabled = false;
  sendBtn.style.display = 'inline-block';
  cancelBtn.disabled = false;

  try {
    const res = await API.get('/admin/promotions/recipients-count');
    const count = (res && res.count) || 0;
    document.getElementById('broadcast-recipient-badge').innerText = `${count} unique customers`;
  } catch (e) {
    document.getElementById('broadcast-recipient-badge').innerText = 'Eligible customers';
  }

  openModal('modal-broadcast');
}

async function executeBroadcast() {
  if (!currentBroadcastPromoId) return;

  const sendBtn = document.getElementById('btn-start-broadcast');
  const cancelBtn = document.getElementById('btn-cancel-broadcast');
  sendBtn.disabled = true;
  cancelBtn.disabled = true;

  document.getElementById('broadcast-progress-container').style.display = 'block';
  document.getElementById('broadcast-progress-bar').style.width = '10%';
  document.getElementById('broadcast-progress-percent').innerText = '10%';
  document.getElementById('broadcast-progress-text').innerText = 'Queuing mass messages...';

  try {
    const res = await API.post(`/admin/promotions/${currentBroadcastPromoId}/broadcast`, {});
    if (res && res.success) {
      document.getElementById('broadcast-progress-bar').style.width = '100%';
      document.getElementById('broadcast-progress-percent').innerText = '100%';
      document.getElementById('broadcast-status-label').innerText = '✅ Broadcast Completed!';
      document.getElementById('broadcast-progress-text').innerText = `Successfully delivered to ${res.sentCount} customer(s)!`;
      API.toast(res.message || 'Mass broadcast completed successfully!', 'success');
      loadPromotions();
      setTimeout(() => {
        closeModal('modal-broadcast');
      }, 1800);
    } else {
      API.toast(res.message || 'Failed to dispatch broadcast.', 'error');
      document.getElementById('broadcast-status-label').innerText = '❌ Broadcast Failed';
      document.getElementById('broadcast-progress-text').innerText = res.message || 'No recipients found.';
      sendBtn.disabled = false;
      cancelBtn.disabled = false;
    }
  } catch (err) {
    API.toast(err.message || 'Broadcast error occurred.', 'error');
    sendBtn.disabled = false;
    cancelBtn.disabled = false;
  }
}

function updateBroadcastProgress(data) {
  if (!data) return;
  const container = document.getElementById('broadcast-progress-container');
  if (container) container.style.display = 'block';

  const bar = document.getElementById('broadcast-progress-bar');
  if (bar) bar.style.width = `${data.percentage}%`;

  const percentLabel = document.getElementById('broadcast-progress-percent');
  if (percentLabel) percentLabel.innerText = `${data.percentage}%`;

  const textLabel = document.getElementById('broadcast-progress-text');
  if (textLabel) textLabel.innerText = `Sent ${data.current} of ${data.total} (${data.percentage}%)...`;
}

function handleBroadcastCompleted(data) {
  const bar = document.getElementById('broadcast-progress-bar');
  if (bar) bar.style.width = '100%';

  const percentLabel = document.getElementById('broadcast-progress-percent');
  if (percentLabel) percentLabel.innerText = '100%';

  const statusLabel = document.getElementById('broadcast-status-label');
  if (statusLabel) statusLabel.innerText = '✅ Broadcast Completed!';

  const textLabel = document.getElementById('broadcast-progress-text');
  if (textLabel) textLabel.innerText = `Finished! ${data.sentCount} sent, ${data.failedCount} failed.`;
}

// Setup drag and drop for photo uploads
document.addEventListener('DOMContentLoaded', () => {
  const dropZone = document.getElementById('promo-drop-zone');
  if (dropZone) {
    ['dragenter', 'dragover'].forEach(name => {
      dropZone.addEventListener(name, (e) => {
        e.preventDefault();
        dropZone.classList.add('dragover');
      });
    });
    ['dragleave', 'drop'].forEach(name => {
      dropZone.addEventListener(name, (e) => {
        e.preventDefault();
        dropZone.classList.remove('dragover');
      });
    });
    dropZone.addEventListener('drop', (e) => {
      const dt = e.dataTransfer;
      const files = dt.files;
      if (files && files.length > 0) {
        handlePromoFileSelect({ target: { files: [files[0]] } });
      }
    });
  }
});

// ----------------------------------------------------------------------------
// 5. Smart Delivery & Fare Engine
// ----------------------------------------------------------------------------
async function loadDeliveries() {
  try {
    const [delRes, riderRes] = await Promise.all([
      API.get('/deliveries'),
      API.get('/riders')
    ]);

    if (delRes && delRes.deliveries) {
      renderDeliveriesTable(delRes.deliveries);
    }
    if (riderRes && riderRes.riders) {
      allRiders = riderRes.riders;
    }
  } catch (err) {
    console.error('Load deliveries error:', err);
  }
}

function renderDeliveriesTable(deliveries) {
  const tbody = document.getElementById('deliveries-tbody');
  tbody.innerHTML = '';

  deliveries.forEach(del => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td><strong>#${del.order_number}</strong></td>
      <td>${escapeHtml(del.customer_name || 'Customer')}</td>
      <td>${del.rider_name || '<em style="color: var(--text-muted);">Unassigned</em>'}</td>
      <td>${parseFloat(del.distance_km).toFixed(1)} km</td>
      <td><strong>₱${parseFloat(del.final_fare).toFixed(2)}</strong></td>
      <td><span class="badge badge-${del.status}">${del.status}</span></td>
      <td>
        <button class="btn btn-secondary btn-sm" onclick="openAssignRiderModal(${del.order_id}, ${del.id})">
          Dispatch
        </button>
      </td>
    `;
    tbody.appendChild(tr);
  });
}

let currentFareSettings = {
  fare_base: 49.00,
  fare_per_05km: 12.00,
  fare_fuel_cost: 2.83,
  fare_maintenance: 7.50
};

/**
 * Loads current active delivery fare matrix settings
 */
async function loadFareSettings() {
  try {
    const res = await API.get('/admin/fare-settings');
    if (res && res.fare_settings) {
      currentFareSettings = res.fare_settings;
    }
  } catch (err) {
    console.warn('[Dashboard] Could not load fare settings:', err.message);
  }
}

/**
 * Opens the Edit Delivery Fare Matrix modal pre-filled with current values (Requirement 3)
 */
async function openFareMatrixModal() {
  const modal = document.getElementById('modal-fare-matrix');
  if (!modal) return;

  const baseInput = document.getElementById('fare-input-base');
  const per05Input = document.getElementById('fare-input-per-05km');
  const fuelInput = document.getElementById('fare-input-fuel-cost');
  const maintInput = document.getElementById('fare-input-maintenance');

  // Pre-fill immediately with cached settings
  if (baseInput) baseInput.value = parseFloat(currentFareSettings.fare_base ?? 49.00).toFixed(2);
  if (per05Input) per05Input.value = parseFloat(currentFareSettings.fare_per_05km ?? 12.00).toFixed(2);
  if (fuelInput) fuelInput.value = parseFloat(currentFareSettings.fare_fuel_cost ?? 2.83).toFixed(2);
  if (maintInput) maintInput.value = parseFloat(currentFareSettings.fare_maintenance ?? 7.50).toFixed(2);

  // Fetch freshest from server
  try {
    const res = await API.get('/admin/fare-settings');
    if (res && res.fare_settings) {
      currentFareSettings = res.fare_settings;
      if (baseInput) baseInput.value = parseFloat(currentFareSettings.fare_base ?? 49.00).toFixed(2);
      if (per05Input) per05Input.value = parseFloat(currentFareSettings.fare_per_05km ?? 12.00).toFixed(2);
      if (fuelInput) fuelInput.value = parseFloat(currentFareSettings.fare_fuel_cost ?? 2.83).toFixed(2);
      if (maintInput) maintInput.value = parseFloat(currentFareSettings.fare_maintenance ?? 7.50).toFixed(2);
    }
  } catch (e) {
    // Keep cached
  }

  const submitBtn = document.getElementById('btn-save-fare-matrix');
  if (submitBtn) {
    submitBtn.disabled = false;
    submitBtn.innerHTML = '<span>💾 Save Fare Matrix</span>';
  }

  openModal('modal-fare-matrix');
}

/**
 * Handles saving the Delivery Fare Matrix (Requirement 3)
 */
async function handleSaveFareMatrix(event) {
  if (event) event.preventDefault();

  const fare_base = parseFloat(document.getElementById('fare-input-base').value);
  const fare_per_05km = parseFloat(document.getElementById('fare-input-per-05km').value);
  const fare_fuel_cost = parseFloat(document.getElementById('fare-input-fuel-cost').value);
  const fare_maintenance = parseFloat(document.getElementById('fare-input-maintenance').value);

  if (isNaN(fare_base) || isNaN(fare_per_05km) || isNaN(fare_fuel_cost) || isNaN(fare_maintenance)) {
    API.toast('Please enter valid numeric rates for all fare variables.', 'warning');
    return;
  }

  if (fare_base < 0 || fare_per_05km < 0 || fare_fuel_cost < 0 || fare_maintenance < 0) {
    API.toast('Fare variables cannot be negative numbers.', 'warning');
    return;
  }

  const submitBtn = document.getElementById('btn-save-fare-matrix');
  if (submitBtn) {
    submitBtn.disabled = true;
    submitBtn.innerHTML = '<span>⏳ Saving Rates...</span>';
  }

  try {
    const res = await API.put('/admin/fare-settings', {
      fare_base,
      fare_per_05km,
      fare_fuel_cost,
      fare_maintenance
    });

    if (res && res.success) {
      if (res.fare_settings) {
        currentFareSettings = res.fare_settings;
      }
      API.toast('✅ Delivery Fare Matrix updated successfully!', 'success');
      closeModal('modal-fare-matrix');

      // Trigger instant recalculation test preview (Requirement 3)
      await testFareCalculation();
    } else {
      API.toast(res.message || 'Failed to update fare matrix.', 'error');
    }
  } catch (err) {
    API.toast(err.message || 'Error updating fare matrix.', 'error');
  } finally {
    if (submitBtn) {
      submitBtn.disabled = false;
      submitBtn.innerHTML = '<span>💾 Save Fare Matrix</span>';
    }
  }
}

async function testFareCalculation() {
  const distEl = document.getElementById('fare-dist-input');
  const vehicleEl = document.getElementById('fare-vehicle-input');
  const weatherEl = document.getElementById('fare-weather-input');

  const distanceKm = distEl ? distEl.value : 1.5;
  const vehicleType = vehicleEl ? vehicleEl.value : 'motorcycle';
  const weatherCondition = weatherEl ? weatherEl.value : 'sunny';

  try {
    const res = await API.post('/deliveries/compute-fare', { distanceKm, vehicleType, weatherCondition });
    if (res && res.fare) {
      const f = res.fare;
      if (res.fareSettings) {
        currentFareSettings = res.fareSettings;
      }
      const baseEl = document.getElementById('out-base-fare');
      const distEl = document.getElementById('out-dist-charge');
      const fuelEl = document.getElementById('out-fuel-cost');
      const maintEl = document.getElementById('out-maint-cost');
      const subEl = document.getElementById('out-subtotal');
      const surEl = document.getElementById('out-surcharge');
      const finEl = document.getElementById('out-final-fare');

      if (baseEl) baseEl.innerText = `₱${f.baseFare.toFixed(2)}`;
      if (distEl) distEl.innerText = `₱${f.distanceCharge.toFixed(2)} (${f.additionalHalfKmSteps} steps)`;
      if (fuelEl) fuelEl.innerText = `₱${f.fuelCost.toFixed(2)}`;
      if (maintEl) maintEl.innerText = `₱${f.maintenanceCost.toFixed(2)}`;
      if (subEl) subEl.innerText = `₱${f.subtotal.toFixed(2)}`;
      if (surEl) surEl.innerText = `${Math.round(f.surchargeRate * 100)}% (+₱${f.surchargeAmount.toFixed(2)})`;
      if (finEl) finEl.innerText = `₱${f.finalFare.toFixed(2)}`;
    }
  } catch (err) {
    console.error('Compute fare error:', err);
  }
}

function openAssignRiderModal(orderId, deliveryId) {
  document.getElementById('assign-del-id').value = deliveryId || '';
  const select = document.getElementById('assign-rider-select');
  select.innerHTML = allRiders.map(r => `
    <option value="${r.id}">${r.full_name} (${r.vehicle_type.toUpperCase()} - ${r.status})</option>
  `).join('');

  openModal('modal-assign-rider');
}

async function handleAssignRiderSubmit(e) {
  e.preventDefault();
  const deliveryId = document.getElementById('assign-del-id').value;
  const riderId = document.getElementById('assign-rider-select').value;
  const vehicleType = document.getElementById('assign-vehicle-select').value;
  const weatherCondition = document.getElementById('assign-weather-select').value;
  const overrideFare = document.getElementById('assign-override-fare').value;
  const overrideReason = document.getElementById('assign-override-reason').value;

  try {
    const res = await API.post('/deliveries/assign-rider', {
      deliveryId,
      riderId,
      vehicleType,
      weatherCondition,
      overrideFare: overrideFare ? parseFloat(overrideFare) : undefined,
      overrideReason
    });

    if (res && res.success) {
      API.toast('Rider successfully assigned and dispatched!', 'success');
      closeModal('modal-assign-rider');
      loadDeliveries();
      loadOrders();
    }
  } catch (err) {
    console.error('Assign rider error:', err);
  }
}

window.openFareMatrixModal = openFareMatrixModal;
window.handleSaveFareMatrix = handleSaveFareMatrix;
window.testFareCalculation = testFareCalculation;
window.loadFareSettings = loadFareSettings;

// ----------------------------------------------------------------------------
// 6. Feedback & Ratings (FR11)
// ----------------------------------------------------------------------------
async function loadFeedback() {
  try {
    const res = await API.get('/feedback');
    if (res && res.metrics) {
      const m = res.metrics;
      document.getElementById('feedback-avg-display').innerText = m.averageRating.toFixed(1);
      document.getElementById('feedback-total-count').innerText = m.totalFeedback;
      document.getElementById('feedback-nps-display').innerText = `${m.satisfactionRate}% Satisfaction Rate`;

      // Rating bars
      const total = m.totalFeedback || 1;
      for (let s = 1; s <= 5; s++) {
        const count = m.breakdown[s] || 0;
        const pct = Math.round((count / total) * 100);
        document.getElementById(`count-star-${s}`).innerText = count;
        document.getElementById(`bar-star-${s}`).style.width = `${pct}%`;
      }

      // Review cards
      const container = document.getElementById('feedback-cards-container');
      container.innerHTML = '';

      (res.feedback || []).forEach(f => {
        const stars = '⭐'.repeat(f.rating);
        const card = document.createElement('div');
        card.className = 'card';
        card.style.padding = '18px';
        const safeCustName = escapeHtml(f.customer_name || 'Customer');
        const safeOrderNum = escapeHtml(f.order_number || '');
        const safeComment = f.comments ? escapeHtml(f.comments) : '<em>No written comment provided.</em>';
        const safeRider = f.rider_name ? `&bull; Delivered by ${escapeHtml(f.rider_name)}` : '';
        const safeSentiment = escapeHtml(f.sentiment || '');

        card.innerHTML = `
          <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
            <div>
              <strong>${safeCustName}</strong>
              <span style="font-size: 0.8rem; color: var(--text-muted); margin-left: 8px;">Order #${safeOrderNum}</span>
            </div>
            <div>
              <span class="badge ${f.sentiment === 'positive' ? 'badge-delivered' : f.sentiment === 'neutral' ? 'badge-pending' : 'badge-mismatch'}">
                ${safeSentiment}
              </span>
            </div>
          </div>
          <div style="color: var(--brand-gold); margin-bottom: 6px;">${stars}</div>
          <div style="font-size: 0.92rem; color: var(--text-primary);">${safeComment}</div>
          <div style="font-size: 0.78rem; color: var(--text-muted); margin-top: 8px;">
            ${new Date(f.created_at).toLocaleString()} ${safeRider}
          </div>
        `;
        container.appendChild(card);
      });
    }
  } catch (err) {
    console.error('Load feedback error:', err);
  }
}

// ----------------------------------------------------------------------------
// 7. Reports & Business Analytics (FR10)
// ----------------------------------------------------------------------------
async function loadReports() {
  try {
    const res = await API.get('/reports/sales');
    if (res && res.success) {
      // Payment Breakdown Table
      const payTbody = document.getElementById('report-payments-tbody');
      payTbody.innerHTML = '';
      (res.paymentBreakdown || []).forEach(p => {
        const tr = document.createElement('tr');
        tr.innerHTML = `
          <td><strong>${p.payment_method.toUpperCase()}</strong></td>
          <td>${p.transaction_count}</td>
          <td><strong>₱${parseFloat(p.total_revenue).toFixed(2)}</strong></td>
          <td>${p.mismatch_count > 0 ? `<span class="badge badge-mismatch">${p.mismatch_count}</span>` : '0'}</td>
        `;
        payTbody.appendChild(tr);
      });

      // Top Items Table
      const topTbody = document.getElementById('report-top-items-tbody');
      topTbody.innerHTML = '';
      (res.topItems || []).forEach(item => {
        const catName = item.category_name || item.category || 'Uncategorized';
        const units = item.total_units_sold !== undefined ? item.total_units_sold : (item.units_sold !== undefined ? item.units_sold : 0);
        const rev = parseFloat(item.total_revenue !== undefined ? item.total_revenue : (item.revenue !== undefined ? item.revenue : 0));
        const tr = document.createElement('tr');
        tr.innerHTML = `
          <td><strong>${escapeHtml(item.item_name || 'Item')}</strong></td>
          <td>${escapeHtml(catName)}</td>
          <td>${units} units</td>
          <td><strong>₱${rev.toFixed(2)}</strong></td>
        `;
        topTbody.appendChild(tr);
      });
    }
  } catch (err) {
    console.error('Load reports error:', err);
  }
}

// ----------------------------------------------------------------------------
// 8. Chatbot & AI Logs
// ----------------------------------------------------------------------------
async function loadChatbotLogs() {
  try {
    const res = await API.get('/chatbot/logs');
    const container = document.getElementById('chatbot-logs-container');
    container.innerHTML = '';

    if (res && res.logs) {
      res.logs.forEach(log => {
        const div = document.createElement('div');
        div.className = 'chat-log-entry';
        div.innerHTML = `
          <div style="display: flex; justify-content: space-between; font-size: 0.82rem; color: var(--text-muted); margin-bottom: 6px;">
            <span>PSID: <code>${log.psid}</code> (${log.customer_name || 'Customer'})</span>
            <span>${new Date(log.created_at).toLocaleTimeString()}</span>
          </div>
          <div style="margin-bottom: 4px;">
            <strong style="color: var(--brand-crema);">Incoming:</strong> "${log.incoming_message || ''}"
          </div>
          <div style="display: flex; gap: 10px; font-size: 0.85rem; margin-top: 6px;">
            <span class="badge badge-cash">Intent: ${log.detected_intent}</span>
            <span class="badge badge-info">Confidence: ${(parseFloat(log.confidence || 1) * 100).toFixed(0)}%</span>
          </div>
        `;
        container.appendChild(div);
      });
    }
  } catch (err) {
    console.error('Load chatbot logs error:', err);
  }
}

// ----------------------------------------------------------------------------
// 9. AI Chatbot Status & Toggle Management
// ----------------------------------------------------------------------------
let isChatbotActiveState = true;

async function loadChatbotStatus() {
  try {
    const res = await API.get('/chatbot/status');
    if (res && res.success) {
      updateChatbotUI(res);
    }
  } catch (err) {
    console.error('Load chatbot status error:', err);
  }
}

function updateChatbotUI(status) {
  isChatbotActiveState = Boolean(status.isEnabled);
  const isEnabled = isChatbotActiveState;

  // 1. Update Topbar Button
  const topbarBtn = document.getElementById('btn-chatbot-toggle');
  if (topbarBtn) {
    if (isEnabled) {
      topbarBtn.className = 'btn btn-success btn-sm';
      topbarBtn.innerHTML = '🟢 AI Chatbot: Active (ON)';
      topbarBtn.title = 'Click to turn off AI Chatbot';
    } else {
      topbarBtn.className = 'btn btn-danger btn-sm';
      topbarBtn.innerHTML = '🔴 AI Chatbot: Disabled (OFF)';
      topbarBtn.title = 'Click to turn on AI Chatbot';
    }
  }

  // 2. Update Tab 8 Card (if present)
  const statusCard = document.getElementById('chatbot-status-card');
  const statusBadge = document.getElementById('chatbot-status-badge');
  const statusDesc = document.getElementById('chatbot-status-desc');
  const statusTime = document.getElementById('chatbot-status-time');
  const tabToggleBtn = document.getElementById('btn-tab-chatbot-toggle');

  if (statusCard && statusBadge) {
    if (isEnabled) {
      statusCard.style.borderLeft = '4px solid var(--status-success)';
      statusBadge.className = 'badge badge-success';
      statusBadge.innerText = 'ACTIVE (ON)';
      if (statusDesc) {
        statusDesc.innerText = 'The AI Chatbot is actively processing customer orders, food menus, payments, and natural language requests via Facebook Messenger.';
      }
      if (tabToggleBtn) {
        tabToggleBtn.className = 'btn btn-danger btn-sm';
        tabToggleBtn.innerHTML = '⏸️ Turn Off AI Chatbot';
      }
    } else {
      statusCard.style.borderLeft = '4px solid var(--status-danger)';
      statusBadge.className = 'badge badge-danger';
      statusBadge.innerText = 'DISABLED (OFF)';
      if (statusDesc) {
        statusDesc.innerText = 'The AI Chatbot is currently turned OFF. Automated ordering is paused, and customers will receive an offline message.';
      }
      if (tabToggleBtn) {
        tabToggleBtn.className = 'btn btn-success btn-sm';
        tabToggleBtn.innerHTML = '▶️ Turn On AI Chatbot';
      }
    }

    if (statusTime) {
      const timeStr = status.lastToggledAt ? new Date(status.lastToggledAt).toLocaleTimeString() : 'Recently';
      const userStr = status.lastToggledBy || 'Admin';
      statusTime.innerText = `Last toggled by ${userStr} at ${timeStr}`;
    }
  }

  // 3. Update Overview Tab Banner (if present)
  const overviewBadge = document.getElementById('overview-chatbot-badge');
  const overviewDesc = document.getElementById('overview-chatbot-desc');
  const overviewBtn = document.getElementById('btn-overview-chatbot-toggle');

  if (overviewBadge) {
    if (isEnabled) {
      overviewBadge.className = 'badge badge-success';
      overviewBadge.innerHTML = '🟢 ACTIVE (ON)';
      if (overviewDesc) {
        overviewDesc.innerHTML = 'Auto-replying to customer messages, menus, GCash verification &amp; order taking on Facebook Messenger.';
      }
      if (overviewBtn) {
        overviewBtn.className = 'btn btn-danger';
        overviewBtn.innerHTML = '⏸️ Turn Off AI Chatbot';
      }
    } else {
      overviewBadge.className = 'badge badge-danger';
      overviewBadge.innerHTML = '🔴 DISABLED (OFF)';
      if (overviewDesc) {
        overviewDesc.innerHTML = 'Automated ordering is currently paused. Customers receive a temporary offline message with store contact info.';
      }
      if (overviewBtn) {
        overviewBtn.className = 'btn btn-success';
        overviewBtn.innerHTML = '▶️ Turn On AI Chatbot';
      }
    }
  }
}

function handleChatbotToggleClick() {
  if (isChatbotActiveState) {
    // If currently ON, open confirmation modal before turning OFF
    openModal('modal-chatbot-confirm');
  } else {
    // If currently OFF, turn back ON directly
    executeChatbotToggle(true);
  }
}

async function executeChatbotToggle(targetState) {
  closeModal('modal-chatbot-confirm');
  try {
    const res = await API.post('/chatbot/toggle', { isEnabled: targetState });
    if (res && res.success) {
      updateChatbotUI(res);
      API.toast(res.message || (targetState ? 'AI Chatbot turned ON' : 'AI Chatbot turned OFF'), targetState ? 'success' : 'warning');
    } else {
      API.toast(res.message || 'Failed to toggle chatbot status.', 'error');
    }
  } catch (err) {
    API.toast(err.message || 'Network error toggling chatbot status.', 'error');
  }
}

// ----------------------------------------------------------------------------
// 8. Settings & Account Management
// ----------------------------------------------------------------------------
let allStaffUsers = [];

async function loadUsers() {
  try {
    const res = await API.get('/auth/users');
    if (res && res.users) {
      allStaffUsers = res.users;
      renderUsersTable(allStaffUsers);
    }
  } catch (err) {
    console.error('Load users error:', err);
  }
}

function renderUsersTable(users) {
  const tbody = document.getElementById('users-table-tbody');
  if (!tbody) return;

  if (!users || users.length === 0) {
    tbody.innerHTML = `<tr><td colspan="7" style="text-align: center; color: var(--text-muted); padding: 24px;">No user accounts found.</td></tr>`;
    return;
  }

  tbody.innerHTML = users.map(u => {
    const initials = (u.full_name || 'US').split(' ').map(n => n[0]).join('').substring(0, 2).toUpperCase();
    
    let roleBadge = '';
    if (u.role === 'admin') {
      roleBadge = `<span class="badge" style="background: rgba(212, 163, 115, 0.2); color: var(--brand-gold); border: 1px solid var(--brand-gold);">👑 Administrator</span>`;
    } else if (u.role === 'staff') {
      roleBadge = `<span class="badge" style="background: rgba(59, 130, 246, 0.15); color: #93c5fd; border: 1px solid #3b82f6;">☕ Barista / Staff</span>`;
    } else if (u.role === 'rider') {
      roleBadge = `<span class="badge" style="background: rgba(34, 197, 94, 0.15); color: #86efac; border: 1px solid #22c55e;">🛵 Delivery Rider</span>`;
    } else {
      roleBadge = `<span class="badge badge-secondary">${u.role}</span>`;
    }

    const statusBadge = u.is_active
      ? `<span class="badge badge-success">Active</span>`
      : `<span class="badge badge-danger">Inactive</span>`;

    const updatedDate = u.updated_at ? new Date(u.updated_at).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : 'Never';

    return `
      <tr>
        <td>
          <div style="display: flex; align-items: center; gap: 10px;">
            <div style="width: 34px; height: 34px; border-radius: 50%; background: var(--brand-primary); color: #fff; display: flex; align-items: center; justify-content: center; font-weight: 700; font-size: 0.82rem;">
              ${initials}
            </div>
            <div>
              <strong style="color: #fff;">${u.full_name}</strong>
              ${u.role === 'admin' ? `<span style="font-size: 0.72rem; color: var(--brand-gold); margin-left: 4px;">(Owner)</span>` : ''}
            </div>
          </div>
        </td>
        <td><code>${u.email}</code></td>
        <td>${roleBadge}</td>
        <td>${u.phone_number || 'N/A'}</td>
        <td>${statusBadge}</td>
        <td style="font-size: 0.82rem; color: var(--text-secondary);">${updatedDate}</td>
        <td>
          <div style="display: flex; gap: 6px; flex-wrap: wrap;">
            <button class="btn btn-primary btn-sm" onclick="openResetPasswordModal(${u.id}, '${u.full_name.replace(/'/g, "\\'")}', '${u.email}')" style="font-size: 0.78rem; padding: 4px 10px; font-weight: 700;">
              🔑 Reset Password
            </button>
            <button class="btn btn-secondary btn-sm" onclick="openUserModal(${u.id})" style="font-size: 0.78rem; padding: 4px 8px;">
              ✏️ Edit
            </button>
            <button class="btn btn-secondary btn-sm" onclick="toggleUserStatus(${u.id})" title="Toggle Active Status" style="font-size: 0.78rem; padding: 4px 8px;">
              ${u.is_active ? '⏸️' : '▶️'}
            </button>
          </div>
        </td>
      </tr>
    `;
  }).join('');
}

// ----------------------------------------------------------------------------
// Password Reset Modal Handlers
// ----------------------------------------------------------------------------
function openResetPasswordModal(userId, userName, userEmail) {
  document.getElementById('reset-password-user-id').value = userId;
  document.getElementById('reset-user-display-name').innerText = userName;
  document.getElementById('reset-user-display-email').innerText = userEmail;
  document.getElementById('reset-new-password').value = '';
  document.getElementById('reset-confirm-password').value = '';
  
  const feedback = document.getElementById('password-match-feedback');
  if (feedback) {
    feedback.style.display = 'none';
    feedback.innerText = '';
  }

  openModal('modal-reset-password');
}

function togglePasswordVisibility(inputId, btn) {
  const input = document.getElementById(inputId);
  if (!input) return;
  if (input.type === 'password') {
    input.type = 'text';
    btn.innerText = '🙈';
  } else {
    input.type = 'password';
    btn.innerText = '👁️';
  }
}

function validatePasswordInputs() {
  const p1 = document.getElementById('reset-new-password').value;
  const p2 = document.getElementById('reset-confirm-password').value;
  const feedback = document.getElementById('password-match-feedback');
  const submitBtn = document.getElementById('btn-submit-reset-password');

  if (!feedback) return;

  if (p2.length === 0) {
    feedback.style.display = 'none';
    return;
  }

  feedback.style.display = 'block';
  if (p1 === p2) {
    feedback.style.color = '#86efac';
    feedback.innerText = '✓ Passwords match';
    if (submitBtn) submitBtn.disabled = false;
  } else {
    feedback.style.color = '#fca5a5';
    feedback.innerText = '✗ Passwords do not match';
    if (submitBtn) submitBtn.disabled = true;
  }
}

async function handleResetPasswordSubmit(event) {
  event.preventDefault();
  const userId = document.getElementById('reset-password-user-id').value;
  const newPassword = document.getElementById('reset-new-password').value.trim();
  const confirmPassword = document.getElementById('reset-confirm-password').value.trim();

  if (newPassword.length < 6) {
    API.toast('Password must be at least 6 characters long.', 'warning');
    return;
  }

  if (newPassword !== confirmPassword) {
    API.toast('New password and confirmation password do not match.', 'error');
    return;
  }

  try {
    const res = await API.put(`/auth/users/${userId}/password`, {
      newPassword,
      confirmPassword
    });

    if (res && res.success) {
      closeModal('modal-reset-password');
      API.toast(res.message || 'Password successfully updated!', 'success');
      await loadUsers();
    } else {
      API.toast(res.message || 'Failed to update password.', 'error');
    }
  } catch (err) {
    API.toast(err.message || 'Error updating password.', 'error');
  }
}

// ----------------------------------------------------------------------------
// Create / Edit Staff User Handlers
// ----------------------------------------------------------------------------
function openUserModal(userId = null) {
  const form = document.getElementById('user-account-form');
  if (!form) return;
  form.reset();

  const modalTitle = document.getElementById('user-form-modal-title');
  const passGroup = document.getElementById('user-form-password-group');
  const passInput = document.getElementById('user-form-password');

  if (userId) {
    const user = allStaffUsers.find(u => u.id === userId);
    if (!user) return;
    document.getElementById('user-form-id').value = user.id;
    document.getElementById('user-form-name').value = user.full_name;
    document.getElementById('user-form-email').value = user.email;
    document.getElementById('user-form-role').value = user.role;
    document.getElementById('user-form-phone').value = user.phone_number || '';
    if (modalTitle) modalTitle.innerText = `✏️ Edit Account: ${user.full_name}`;
    if (passGroup) passGroup.style.display = 'none';
    if (passInput) passInput.required = false;
  } else {
    document.getElementById('user-form-id').value = '';
    if (modalTitle) modalTitle.innerText = '➕ Add New Staff Account';
    if (passGroup) passGroup.style.display = 'block';
    if (passInput) passInput.required = true;
  }

  openModal('modal-user-form');
}

async function handleUserFormSubmit(event) {
  event.preventDefault();
  const userId = document.getElementById('user-form-id').value;
  const fullName = document.getElementById('user-form-name').value.trim();
  const email = document.getElementById('user-form-email').value.trim();
  const role = document.getElementById('user-form-role').value;
  const phoneNumber = document.getElementById('user-form-phone').value.trim();
  const password = document.getElementById('user-form-password')?.value.trim();

  try {
    if (userId) {
      // Edit User
      const res = await API.put(`/auth/users/${userId}`, {
        fullName,
        email,
        role,
        phoneNumber
      });
      if (res && res.success) {
        closeModal('modal-user-form');
        API.toast(res.message || 'Account updated successfully.', 'success');
        await loadUsers();
      } else {
        API.toast(res.message || 'Failed to update account.', 'error');
      }
    } else {
      // Create User
      const res = await API.post('/auth/users', {
        fullName,
        email,
        role,
        phoneNumber,
        password
      });
      if (res && res.success) {
        closeModal('modal-user-form');
        API.toast(res.message || 'New staff account created successfully.', 'success');
        await loadUsers();
      } else {
        API.toast(res.message || 'Failed to create account.', 'error');
      }
    }
  } catch (err) {
    API.toast(err.message || 'Error saving user account.', 'error');
  }
}

async function toggleUserStatus(userId) {
  try {
    const res = await API.patch(`/auth/users/${userId}/toggle-status`);
    if (res && res.success) {
      API.toast(res.message, 'info');
      await loadUsers();
    } else {
      API.toast(res.message || 'Failed to toggle status.', 'error');
    }
  } catch (err) {
    API.toast(err.message || 'Error toggling account status.', 'error');
  }
}

// ----------------------------------------------------------------------------
// Modal Utilities
// ----------------------------------------------------------------------------
function openModal(id) {
  const el = document.getElementById(id);
  if (el) el.classList.add('active');
}

function closeModal(id) {
  const el = document.getElementById(id);
  if (el) el.classList.remove('active');
}

window.openModal = openModal;
window.closeModal = closeModal;
window.openNewOrderModal = openNewOrderModal;

function openNewOrderModal() {
  API.toast('Open the Messenger Simulator to experience placing full conversational orders!', 'info');
  switchTab('orders');
}

// ----------------------------------------------------------------------------
// 9. Facebook Page Access Token Settings
// ----------------------------------------------------------------------------
let currentFbTokenData = null;
let isFbTokenRevealed = false;

async function loadFacebookSettings() {
  const badge = document.getElementById('fb-token-status-badge');
  const preview = document.getElementById('fb-token-preview');
  const feedback = document.getElementById('fb-token-feedback');

  if (feedback) feedback.style.display = 'none';

  try {
    const res = await API.get('/settings/facebook');
    if (res && res.success) {
      currentFbTokenData = res;
      updateFbTokenDisplay();
    } else {
      if (preview) preview.innerText = 'Unable to load configuration.';
      if (badge) {
        badge.innerText = 'Error';
        badge.className = 'badge badge-danger';
      }
    }
  } catch (err) {
    console.error('Failed to load FB settings:', err);
    if (preview) preview.innerText = 'Not accessible or unauthorized.';
    if (badge) {
      badge.innerText = 'Offline';
      badge.className = 'badge badge-danger';
    }
  }
}

function updateFbTokenDisplay() {
  const badge = document.getElementById('fb-token-status-badge');
  const preview = document.getElementById('fb-token-preview');
  const lengthIndicator = document.getElementById('fb-token-length-indicator');
  const toggleBtn = document.getElementById('btn-toggle-reveal-fb-token');

  if (!currentFbTokenData) return;

  const isConfigured = currentFbTokenData.isConfigured;
  const token = currentFbTokenData.fullToken || '';

  if (badge) {
    if (isConfigured) {
      badge.innerText = 'Active & Configured';
      badge.style.background = 'rgba(34, 197, 94, 0.15)';
      badge.style.color = '#86efac';
      badge.style.border = '1px solid #22c55e';
    } else {
      badge.innerText = 'Missing / Incomplete';
      badge.style.background = 'rgba(239, 68, 68, 0.15)';
      badge.style.color = '#fca5a5';
      badge.style.border = '1px solid #ef4444';
    }
  }

  if (lengthIndicator) {
    lengthIndicator.innerText = token ? `${token.length} chars` : '0 chars';
  }

  if (preview) {
    if (!token) {
      preview.innerText = 'No Page Access Token configured yet.';
      preview.style.color = 'var(--text-muted)';
    } else if (isFbTokenRevealed) {
      preview.innerText = token;
      preview.style.color = '#faedcd';
    } else {
      preview.innerText = currentFbTokenData.tokenPreview || '••••••••••••••••';
      preview.style.color = '#faedcd';
    }
  }

  if (toggleBtn) {
    toggleBtn.innerText = isFbTokenRevealed ? '🙈 Hide' : '👁️ Reveal';
  }
}

function toggleRevealFbToken() {
  isFbTokenRevealed = !isFbTokenRevealed;
  updateFbTokenDisplay();
}

async function copyCurrentFbToken() {
  if (!currentFbTokenData || !currentFbTokenData.fullToken) {
    API.toast('No token available to copy.', 'warning');
    return;
  }
  try {
    await navigator.clipboard.writeText(currentFbTokenData.fullToken);
    API.toast('📋 Page Access Token copied to clipboard!', 'success');
  } catch (e) {
    API.toast('Failed to copy token: please select and copy manually.', 'error');
  }
}

async function pasteFbTokenFromClipboard() {
  try {
    const text = await navigator.clipboard.readText();
    if (text) {
      const input = document.getElementById('fb-page-access-token-input');
      if (input) {
        input.value = text.trim();
        API.toast('Pasted token from clipboard.', 'info');
      }
    }
  } catch (e) {
    API.toast('Could not access clipboard. Please paste manually.', 'warning');
  }
}

async function saveFbPageAccessToken() {
  const input = document.getElementById('fb-page-access-token-input');
  const btn = document.getElementById('btn-save-fb-token');
  const feedback = document.getElementById('fb-token-feedback');

  if (!input) return;
  const newToken = input.value.trim();

  if (!newToken) {
    API.toast('Please enter or paste a valid Facebook Page Access Token.', 'warning');
    input.focus();
    return;
  }

  if (!newToken.startsWith('EAA')) {
    const confirmNonStandard = confirm(
      'Warning: Standard Facebook Page Access Tokens start with "EAA". Are you sure you want to save this token?'
    );
    if (!confirmNonStandard) return;
  }

  const origBtnText = btn ? btn.innerHTML : '';
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = '<span>⏳ Saving Token...</span>';
  }

  try {
    const res = await API.put('/settings/facebook', { pageAccessToken: newToken });
    if (res && res.success) {
      API.toast('✅ Facebook Page Access Token updated successfully!', 'success');
      currentFbTokenData = res;
      input.value = '';
      updateFbTokenDisplay();

      if (feedback) {
        feedback.style.display = 'block';
        feedback.style.background = 'rgba(34, 197, 94, 0.12)';
        feedback.style.borderLeft = '4px solid var(--status-success)';
        feedback.style.color = '#86efac';
        feedback.innerHTML = `<strong>✅ Token Saved & Active:</strong> System memory and <code>.env</code> file were updated. Outbound Messenger replies are now using this token.`;
      }
    } else {
      API.toast(res.message || 'Failed to update token.', 'error');
      if (feedback) {
        feedback.style.display = 'block';
        feedback.style.background = 'rgba(239, 68, 68, 0.12)';
        feedback.style.borderLeft = '4px solid var(--status-danger)';
        feedback.style.color = '#fca5a5';
        feedback.innerHTML = `<strong>❌ Error:</strong> ${res.message || 'Failed to save token.'}`;
      }
    }
  } catch (err) {
    console.error('Error saving FB token:', err);
    API.toast(err.message || 'Failed to save token.', 'error');
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = origBtnText;
    }
  }
}

async function testFbPageAccessToken() {
  const input = document.getElementById('fb-page-access-token-input');
  const btn = document.getElementById('btn-test-fb-token');
  const feedback = document.getElementById('fb-token-feedback');

  const tokenToTest = input && input.value.trim() ? input.value.trim() : (currentFbTokenData?.fullToken || '');

  if (!tokenToTest) {
    API.toast('No token entered or saved to test.', 'warning');
    return;
  }

  const origBtnText = btn ? btn.innerHTML : '';
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = '<span>⏳ Testing with Meta...</span>';
  }

  if (feedback) {
    feedback.style.display = 'block';
    feedback.style.background = 'rgba(59, 130, 246, 0.12)';
    feedback.style.borderLeft = '4px solid #3b82f6';
    feedback.style.color = '#93c5fd';
    feedback.innerHTML = `<span>Connecting to Meta Graph API <code>/me</code>...</span>`;
  }

  try {
    const res = await API.post('/settings/facebook/test', { pageAccessToken: tokenToTest });
    if (res && res.verified) {
      API.toast(`✅ Verified! Connected to Page: ${res.page.name}`, 'success');
      if (feedback) {
        feedback.style.display = 'block';
        feedback.style.background = 'rgba(34, 197, 94, 0.12)';
        feedback.style.borderLeft = '4px solid var(--status-success)';
        feedback.style.color = '#86efac';
        feedback.innerHTML = `<strong>✅ Verification Successful:</strong> Connected to Facebook Page <strong>"${res.page.name}"</strong> (Page ID: <code>${res.page.id}</code>, Category: ${res.page.category || 'N/A'}).`;
      }
    } else {
      API.toast(res.message || 'Meta API verification failed.', 'error');
      if (feedback) {
        feedback.style.display = 'block';
        feedback.style.background = 'rgba(239, 68, 68, 0.12)';
        feedback.style.borderLeft = '4px solid var(--status-danger)';
        feedback.style.color = '#fca5a5';
        feedback.innerHTML = `<strong>❌ Verification Failed:</strong> ${res.message || 'Token rejected by Meta.'}`;
      }
    }
  } catch (err) {
    console.error('Error testing FB token:', err);
    API.toast(err.message || 'Failed to verify token with Meta.', 'error');
    if (feedback) {
      feedback.style.display = 'block';
      feedback.style.background = 'rgba(239, 68, 68, 0.12)';
      feedback.style.borderLeft = '4px solid var(--status-danger)';
      feedback.style.color = '#fca5a5';
      feedback.innerHTML = `<strong>❌ Connection Error:</strong> ${err.message || 'Network error reaching Meta API.'}`;
    }
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = origBtnText;
    }
  }
}

// ----------------------------------------------------------------------------
// 10. Store Branch & Delivery Location Settings
// ----------------------------------------------------------------------------

async function loadStoreLocationSettings() {
  try {
    const res = await API.get('/admin/settings/location');
    if (res && res.success) {
      const s = res.settings || res;
      const nameInput = document.getElementById('store-name-input');
      const addrInput = document.getElementById('store-address-input');
      const latInput = document.getElementById('store-lat-input');
      const lngInput = document.getElementById('store-lng-input');
      const radInput = document.getElementById('store-radius-input');
      const radDisplay = document.getElementById('store-radius-display');
      const updatedEl = document.getElementById('store-location-last-updated');

      if (nameInput) nameInput.value = s.store_name || "Diner's Cafe - Main Branch";
      if (addrInput) addrInput.value = s.store_address || "Diner's Cafe - Store Main Branch, Mandaluyong City";
      if (latInput) latInput.value = (s.store_latitude !== undefined && s.store_latitude !== null) ? s.store_latitude : 14.6042;
      if (lngInput) lngInput.value = (s.store_longitude !== undefined && s.store_longitude !== null) ? s.store_longitude : 120.9822;
      if (radInput) radInput.value = (s.max_delivery_radius_km !== undefined && s.max_delivery_radius_km !== null) ? s.max_delivery_radius_km : 3.0;
      if (radDisplay) radDisplay.innerText = ((parseFloat(radInput?.value) || 3.0)).toFixed(2) + ' km';
      if (updatedEl && s.updated_at) {
        try {
          updatedEl.innerText = `Last updated: ${new Date(s.updated_at).toLocaleString()}`;
        } catch (e) {
          updatedEl.innerText = `Last updated: ${s.updated_at}`;
        }
      }
    }
  } catch (err) {
    console.error('Failed to load store location settings:', err);
  }
}

async function saveStoreLocationSettings() {
  const nameInput = document.getElementById('store-name-input');
  const addrInput = document.getElementById('store-address-input');
  const latInput = document.getElementById('store-lat-input');
  const lngInput = document.getElementById('store-lng-input');
  const radInput = document.getElementById('store-radius-input');
  const btn = document.getElementById('btn-save-store-location');

  const payload = {
    store_name: nameInput?.value?.trim() || '',
    store_address: addrInput?.value?.trim() || '',
    store_latitude: parseFloat(latInput?.value),
    store_longitude: parseFloat(lngInput?.value),
    max_delivery_radius_km: parseFloat(radInput?.value)
  };

  if (!payload.store_name) {
    API.toast('Please enter the store branch name.', 'warning');
    return;
  }
  if (!payload.store_address) {
    API.toast('Please enter the store physical address.', 'warning');
    return;
  }
  if (isNaN(payload.store_latitude) || payload.store_latitude < -90 || payload.store_latitude > 90) {
    API.toast('Please provide a valid latitude coordinate (-90 to 90).', 'warning');
    return;
  }
  if (isNaN(payload.store_longitude) || payload.store_longitude < -180 || payload.store_longitude > 180) {
    API.toast('Please provide a valid longitude coordinate (-180 to 180).', 'warning');
    return;
  }
  if (isNaN(payload.max_delivery_radius_km) || payload.max_delivery_radius_km <= 0) {
    API.toast('Please enter a valid positive delivery radius.', 'warning');
    return;
  }

  const origBtnText = btn ? btn.innerHTML : '';
  try {
    if (btn) {
      btn.disabled = true;
      btn.innerHTML = '<span>⏳ Saving...</span>';
    }

    const res = await API.put('/admin/settings/location', payload);

    if (res && res.success) {
      API.toast('Settings updated successfully', 'success');
      const updatedEl = document.getElementById('store-location-last-updated');
      if (updatedEl) {
        updatedEl.innerText = `Last updated: ${new Date().toLocaleString()}`;
      }
    } else {
      API.toast(res.message || 'Failed to update store location settings.', 'error');
    }
  } catch (err) {
    console.error('Failed to save store location settings:', err);
    API.toast(err.message || 'Error updating store location settings.', 'error');
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = origBtnText;
    }
  }
}

function fetchCurrentGeoLocation() {
  const statusEl = document.getElementById('geo-fetch-status');
  const btn = document.getElementById('btn-fetch-location');

  if (!navigator.geolocation) {
    API.toast('Geolocation is not supported by your browser.', 'warning');
    return;
  }

  const origText = btn ? btn.innerHTML : '';
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = '<span>⏳ Fetching GPS...</span>';
  }
  if (statusEl) {
    statusEl.style.display = 'block';
    statusEl.style.color = 'var(--text-muted)';
    statusEl.innerText = 'Acquiring GPS fix via browser Geolocation API...';
  }

  navigator.geolocation.getCurrentPosition(
    (position) => {
      const lat = position.coords.latitude;
      const lng = position.coords.longitude;
      const accuracy = Math.round(position.coords.accuracy || 0);

      const latInput = document.getElementById('store-lat-input');
      const lngInput = document.getElementById('store-lng-input');
      if (latInput) latInput.value = lat.toFixed(8);
      if (lngInput) lngInput.value = lng.toFixed(8);

      if (statusEl) {
        statusEl.style.display = 'block';
        statusEl.style.color = '#86efac';
        statusEl.innerText = `✅ GPS coordinates acquired (accuracy: ±${accuracy}m)! Click "Save Location Settings" to apply.`;
      }
      if (btn) {
        btn.disabled = false;
        btn.innerHTML = origText;
      }
      API.toast('Location fetched successfully from browser!', 'info');
    },
    (err) => {
      console.warn('Geolocation error:', err);
      if (statusEl) {
        statusEl.style.display = 'block';
        statusEl.style.color = '#fca5a5';
        statusEl.innerText = `⚠️ Unable to retrieve GPS location (${err.message}).`;
      }
      if (btn) {
        btn.disabled = false;
        btn.innerHTML = origText;
      }
      API.toast('Could not fetch location: ' + err.message, 'warning');
    },
    { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
  );
}

// ----------------------------------------------------------------------------
// 11. GCash Payment Gateway Configuration
// ----------------------------------------------------------------------------

let currentGcashSettings = {
  gcash_account_name: "Diner's Cafe",
  gcash_account_number: "09XXXXXXXXX",
  gcash_qr_image_url: "/uploads/qr/gcash_qr_CHECKOUT.png"
};
let selectedGcashQrFile = null;

async function loadGcashSettings() {
  try {
    const res = await API.get('/admin/settings/general');
    if (res && res.success) {
      const g = res.gcash || res.settings || res;
      currentGcashSettings = {
        gcash_account_name: g.gcash_account_name || "Diner's Cafe",
        gcash_account_number: g.gcash_account_number || "09XXXXXXXXX",
        gcash_qr_image_url: g.gcash_qr_image_url || "/uploads/qr/gcash_qr_CHECKOUT.png"
      };

      const nameInput = document.getElementById('gcash-account-name-input');
      const numInput = document.getElementById('gcash-account-number-input');
      const previewImg = document.getElementById('gcash-qr-preview');
      const fileNameEl = document.getElementById('gcash-qr-file-name');

      if (nameInput) nameInput.value = currentGcashSettings.gcash_account_name;
      if (numInput) numInput.value = currentGcashSettings.gcash_account_number;
      if (previewImg && currentGcashSettings.gcash_qr_image_url) {
        previewImg.src = currentGcashSettings.gcash_qr_image_url;
      }
      if (fileNameEl) {
        fileNameEl.innerText = 'JPG, PNG, or WebP (max 5MB)';
      }
      selectedGcashQrFile = null;
    }
  } catch (err) {
    console.error('Failed to load GCash settings:', err);
  }
}

function previewGcashQrCode(input) {
  if (!input || !input.files || !input.files[0]) return;
  const file = input.files[0];

  if (!file.type.match(/^image\/(jpeg|png|webp)/i)) {
    API.toast('Please select a valid image file (JPG, PNG, or WebP).', 'warning');
    input.value = '';
    return;
  }

  if (file.size > 5 * 1024 * 1024) {
    API.toast('File size exceeds the 5MB limit. Please choose a smaller file.', 'warning');
    input.value = '';
    return;
  }

  selectedGcashQrFile = file;

  const fileNameEl = document.getElementById('gcash-qr-file-name');
  if (fileNameEl) {
    fileNameEl.innerHTML = `Selected: <strong>${escapeHtml(file.name)}</strong> (${(file.size / 1024).toFixed(1)} KB)`;
    fileNameEl.style.color = '#86efac';
  }

  const previewImg = document.getElementById('gcash-qr-preview');
  if (previewImg) {
    previewImg.src = URL.createObjectURL(file);
  }
  API.toast('QR code selected! Click "Save GCash Settings" to apply.', 'info');
}

async function saveGcashSettings() {
  const nameInput = document.getElementById('gcash-account-name-input');
  const numInput = document.getElementById('gcash-account-number-input');
  const btn = document.getElementById('btn-save-gcash-settings');

  const accountName = nameInput?.value?.trim() || '';
  const accountNumber = numInput?.value?.trim() || '';

  if (!accountName) {
    API.toast('Please enter the GCash account name.', 'warning');
    return;
  }
  if (!accountNumber) {
    API.toast('Please enter the GCash mobile number.', 'warning');
    return;
  }

  const origBtnText = btn ? btn.innerHTML : '';
  try {
    if (btn) {
      btn.disabled = true;
      btn.innerHTML = '<span>⏳ Saving Payment Settings...</span>';
    }

    let res;
    if (selectedGcashQrFile) {
      const formData = new FormData();
      formData.append('gcash_account_name', accountName);
      formData.append('gcash_account_number', accountNumber);
      formData.append('gcash_qr_image', selectedGcashQrFile);

      res = await API.upload('/admin/settings/gcash', formData, 'PUT');
    } else {
      res = await API.put('/admin/settings/gcash', {
        gcash_account_name: accountName,
        gcash_account_number: accountNumber
      });
    }

    if (res && res.success) {
      API.toast('Payment settings updated successfully!', 'success');
      selectedGcashQrFile = null;
      await loadGcashSettings();
    } else {
      API.toast(res.message || 'Failed to update GCash settings.', 'error');
    }
  } catch (err) {
    console.error('Failed to save GCash settings:', err);
    API.toast(err.message || 'Error updating GCash settings.', 'error');
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = origBtnText;
    }
  }
}

function testGcashBotOutput() {
  const nameInput = document.getElementById('gcash-account-name-input');
  const numInput = document.getElementById('gcash-account-number-input');
  const previewImg = document.getElementById('gcash-qr-preview');

  const gName = nameInput?.value?.trim() || currentGcashSettings.gcash_account_name || "Diner's Cafe";
  const gNum = numInput?.value?.trim() || currentGcashSettings.gcash_account_number || "09XXXXXXXXX";
  const qrSrc = previewImg?.src || currentGcashSettings.gcash_qr_image_url || "/uploads/qr/gcash_qr_CHECKOUT.png";

  const previewModalId = 'modal-gcash-bot-preview';
  let modalEl = document.getElementById(previewModalId);
  if (!modalEl) {
    modalEl = document.createElement('div');
    modalEl.id = previewModalId;
    modalEl.className = 'modal-backdrop';
    document.body.appendChild(modalEl);
  }

  modalEl.innerHTML = `
    <div class="modal-card" style="max-width: 420px; border-radius: 14px; background: #1a1714; border: 1px solid var(--border-subtle); padding: 20px; box-shadow: 0 16px 40px rgba(0,0,0,0.6);">
      <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 14px; border-bottom: 1px solid var(--border-subtle); padding-bottom: 8px;">
        <h4 style="margin: 0; font-size: 0.95rem; color: var(--text-primary); display: flex; align-items: center; gap: 6px;">
          <span>🤖</span> <span>Messenger Bot Output Preview</span>
        </h4>
        <button type="button" class="btn btn-secondary btn-sm" onclick="closeModal('${previewModalId}')" style="padding: 2px 8px; font-size: 0.8rem;">✕</button>
      </div>

      <div style="background: #24201c; border-radius: 12px; padding: 14px; border: 1px solid rgba(212, 163, 115, 0.2); margin-bottom: 14px;">
        <div style="text-align: center; margin-bottom: 10px;">
          <img src="${escapeHtml(qrSrc)}" style="width: 140px; height: 140px; object-fit: contain; border-radius: 8px; background: #fff; padding: 6px; box-shadow: 0 4px 10px rgba(0,0,0,0.3);" />
          <div style="font-size: 0.72rem; color: var(--text-muted); margin-top: 6px;">[Image Attachment Sent First]</div>
        </div>

        <div style="background: #14110e; border-radius: 8px; padding: 12px; font-size: 0.82rem; line-height: 1.6; color: #faedcd; border-left: 3px solid var(--brand-primary); margin-bottom: 10px; white-space: pre-wrap; font-family: monospace;">💳 GCASH PAYMENT DETAILS:
Account Name: ${escapeHtml(gName)}
Account Number: ${escapeHtml(gNum)}
Total Amount to Pay: ₱195.00

📌 Paalala:
I-save o i-scan ang QR code sa itaas gamit ang inyong GCash app.
Pagkatapos magbayad, paki-send po rito ang SCREENSHOT ng resibo o i-type ang 13-digit Reference Number upang maihanda na ang inyong order.</div>
      </div>

      <div style="text-align: right;">
        <button type="button" class="btn btn-primary btn-sm" onclick="closeModal('${previewModalId}')" style="padding: 6px 16px;">
          OK, Close Preview
        </button>
      </div>
    </div>
  `;

  openModal(previewModalId);
}

// ----------------------------------------------------------------------------
// 12. Store Operational Status & Operating Hours Management
// ----------------------------------------------------------------------------

let currentStoreStatus = 'OPEN';

async function loadStoreStatus() {
  try {
    const res = await API.get('/settings/store-status');
    if (res && res.success) {
      currentStoreStatus = (res.store_status || 'OPEN').toUpperCase();
      const hours = res.operating_hours || (res.schedule ? { open: res.schedule.store_open_time, close: res.schedule.store_close_time } : null);
      renderStoreStatusUI(currentStoreStatus, res.isOpen, hours, res.is_manual_override, res.next_milestone);
    }
  } catch (err) {
    console.error('Failed to load store status:', err);
  }
}

function renderStoreStatusUI(status, isOpen, hours, isOverride = false, nextMilestone = null) {
  const btn = document.getElementById('btn-store-status-toggle');
  const icon = document.getElementById('store-status-icon');
  const text = document.getElementById('store-status-text');
  const banner = document.getElementById('store-status-banner');
  const headline = document.getElementById('store-status-headline');
  const desc = document.getElementById('store-status-desc');
  const hoursEl = document.getElementById('overview-operating-hours');
  const overrideBadge = document.getElementById('store-override-badge');
  const overrideDetail = document.getElementById('store-override-detail');

  const isStoreOpen = (status === 'OPEN');

  if (btn) {
    if (isStoreOpen) {
      btn.className = 'btn btn-success btn-sm';
      btn.style.background = '#16a34a';
      btn.style.borderColor = '#22c55e';
      btn.style.color = '#ffffff';
    } else {
      btn.className = 'btn btn-danger btn-sm';
      btn.style.background = '#dc2626';
      btn.style.borderColor = '#ef4444';
      btn.style.color = '#ffffff';
    }
  }

  if (icon) icon.innerText = isStoreOpen ? '🟢' : '🔴';
  if (text) text.innerText = isStoreOpen ? 'Store OPEN' : 'Store CLOSED';

  if (banner) {
    banner.style.background = isStoreOpen ? 'rgba(34, 197, 94, 0.12)' : 'rgba(239, 68, 68, 0.12)';
    banner.style.borderLeft = isStoreOpen ? '4px solid var(--status-success)' : '4px solid #ef4444';
  }

  if (headline) {
    headline.innerText = isStoreOpen ? 'Live Ordering Active' : 'Store Currently Closed';
    headline.style.color = isStoreOpen ? '#86efac' : '#fca5a5';
  }

  if (desc) {
    desc.innerText = isStoreOpen
      ? 'Messenger bot is actively accepting orders and routing kitchen preparation.'
      : 'Messenger bot will notify customers that the store is closed and handle advance pre-orders.';
  }

  if (hoursEl && hours) {
    hoursEl.innerText = `${formatTime12Hour(hours.open)} - ${formatTime12Hour(hours.close)} (PHT)`;
  }

  // Requirement 3: Manual override badge indicator with auto-reset info
  if (overrideBadge) {
    if (isOverride) {
      overrideBadge.style.display = 'block';
      let resetInfo = 'next schedule milestone';
      if (nextMilestone && nextMilestone.formatted) {
        resetInfo = `${nextMilestone.formatted} (${nextMilestone.type === 'CLOSE' ? 'closing time' : 'opening time'})`;
      } else if (hours) {
        resetInfo = formatTime12Hour(isStoreOpen ? hours.close : hours.open);
      }
      if (overrideDetail) {
        overrideDetail.innerText = `Will auto-reset on next schedule at ${resetInfo}`;
      }
    } else {
      overrideBadge.style.display = 'none';
    }
  }
}

function formatTime12Hour(timeStr) {
  if (!timeStr) return '';
  const parts = timeStr.split(':');
  let h = parseInt(parts[0], 10);
  const m = parts[1] || '00';
  const ampm = h >= 12 ? 'PM' : 'AM';
  h = h % 12 || 12;
  return `${h.toString().padStart(2, '0')}:${m} ${ampm}`;
}

async function toggleStoreOperationalStatus() {
  const newStatus = (currentStoreStatus === 'OPEN') ? 'CLOSED' : 'OPEN';
  const confirmMsg = newStatus === 'CLOSED'
    ? 'Are you sure you want to mark the store as CLOSED? Manual override will take effect immediately and will auto-reset when the next scheduled milestone is reached.'
    : 'Are you sure you want to OPEN the store? Manual override will take effect immediately and will auto-reset when the next scheduled milestone is reached.';
  
  if (!confirm(confirmMsg)) {
    return;
  }

  const btn = document.getElementById('btn-store-status-toggle');
  if (btn) btn.disabled = true;

  try {
    const res = await API.put('/settings/store-status', { store_status: newStatus });
    if (res && res.success) {
      currentStoreStatus = res.store_status;
      const hours = res.operating_hours || (res.schedule ? { open: res.schedule.store_open_time, close: res.schedule.store_close_time } : null);
      renderStoreStatusUI(currentStoreStatus, res.isOpen, hours, res.is_manual_override, res.next_milestone);
      API.toast(
        currentStoreStatus === 'OPEN' 
          ? '🟢 Store manually set to OPEN (Will auto-reset on next schedule).' 
          : '🔴 Store manually set to CLOSED (Will auto-reset on next schedule).',
        currentStoreStatus === 'OPEN' ? 'success' : 'warning'
      );
    } else {
      API.toast(res.message || 'Failed to update store status.', 'error');
    }
  } catch (err) {
    console.error('Error toggling store status:', err);
    API.toast(err.message || 'Failed to update store status.', 'error');
  } finally {
    if (btn) btn.disabled = false;
  }
}

async function loadOperatingHoursSettings() {
  try {
    const res = await API.get('/settings/operating-hours');
    if (res && res.success) {
      const openInput = document.getElementById('store-open-time-input');
      const closeInput = document.getElementById('store-close-time-input');
      const badge = document.getElementById('operating-hours-badge');
      const hoursEl = document.getElementById('overview-operating-hours');

      const openVal = (res.store_open_time || '09:00:00').substring(0, 5);
      const closeVal = (res.store_close_time || '21:00:00').substring(0, 5);

      if (openInput) openInput.value = openVal;
      if (closeInput) closeInput.value = closeVal;

      if (hoursEl) {
        hoursEl.innerText = `${formatTime12Hour(openVal)} - ${formatTime12Hour(closeVal)} (PHT)`;
      }

      if (badge) {
        badge.innerText = `${formatTime12Hour(openVal)} - ${formatTime12Hour(closeVal)}`;
      }
    }
  } catch (err) {
    console.error('Failed to load operating hours settings:', err);
  }
}

async function saveOperatingHoursSettings() {
  const openInput = document.getElementById('store-open-time-input');
  const closeInput = document.getElementById('store-close-time-input');
  const btn = document.getElementById('btn-save-operating-hours');

  const store_open_time = openInput ? openInput.value : '';
  const store_close_time = closeInput ? closeInput.value : '';

  if (!store_open_time || !store_close_time) {
    API.toast('Please select both opening and closing times.', 'warning');
    return;
  }

  const origBtnText = btn ? btn.innerHTML : '';
  try {
    if (btn) {
      btn.disabled = true;
      btn.innerHTML = '<span>⏳ Saving...</span>';
    }

    const res = await API.put('/settings/operating-hours', {
      store_open_time,
      store_close_time
    });

    if (res && res.success) {
      API.toast('Operating hours updated successfully!', 'success');
      await loadOperatingHoursSettings();
      await loadStoreStatus();
    } else {
      API.toast(res.message || 'Failed to update operating hours.', 'error');
    }
  } catch (err) {
    console.error('Failed to save operating hours:', err);
    API.toast(err.message || 'Error updating operating hours.', 'error');
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = origBtnText;
    }
  }
}

