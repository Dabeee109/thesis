/**
 * Diner's Cafe Operations Dashboard Controller
 */

let allOrders = [];
let allMenuCategories = [];
let allInventory = [];
let allRiders = [];
let activeCategoryFilter = 'all';

document.addEventListener('DOMContentLoaded', async () => {
  // 1. Verify User Authentication
  const user = API.getUser();
  if (user) {
    document.getElementById('user-display-name').innerText = user.name || 'Staff User';
    document.getElementById('user-display-role').innerText = user.role || 'Staff';
    const initials = (user.name || 'AD').split(' ').map(n => n[0]).join('').substring(0, 2).toUpperCase();
    document.getElementById('user-avatar-initials').innerText = initials;
  }

  // 2. Setup Navigation Tabs
  setupNavigation();

  // 3. Initial Data Load
  await refreshAllData();

  // 4. Connect to Real-time SSE Broadcast Stream
  API.connectSSE((eventType, eventData) => {
    handleRealtimeEvent(eventType, eventData);
  });
});

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

function switchTab(tabId) {
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
    inventory: 'Inventory & Stock Control',
    delivery: 'Smart Delivery Management (FR6)',
    feedback: 'Customer Feedback & Ratings (FR11)',
    reports: 'Reports & Business Analytics (FR10)',
    chatbot: 'AI Chatbot & Webhook Logs',
    settings: 'System Settings & Account Management'
  };
  document.getElementById('page-title').innerText = titles[tabId] || 'Dashboard';

  // Load specific tab data on switch
  if (tabId === 'orders') loadOrders();
  if (tabId === 'menu') loadMenu();
  if (tabId === 'inventory') loadInventory();
  if (tabId === 'delivery') loadDeliveries();
  if (tabId === 'feedback') loadFeedback();
  if (tabId === 'reports') loadReports();
  if (tabId === 'chatbot') loadChatbotLogs();
  if (tabId === 'settings') loadUsers();
}

async function refreshAllData() {
  await Promise.all([
    loadKPIs(),
    loadOrders(),
    loadMenu(),
    loadInventory(),
    loadDeliveries(),
    loadFeedback(),
    loadReports(),
    loadChatbotStatus(),
    loadUsers()
  ]);
}

function handleRealtimeEvent(eventType, data) {
  loadKPIs();
  if (eventType === 'NEW_ORDER' || eventType === 'ORDER_STATUS_CHANGED' || eventType === 'PAYMENT_UPDATE') {
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
    loadInventory();
  }
  if (eventType === 'STOCK_ALERT' || eventType === 'INVENTORY_UPDATED') {
    loadInventory();
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
}

// ----------------------------------------------------------------------------
// 1. KPI Stats Loader
// ----------------------------------------------------------------------------
async function loadKPIs() {
  try {
    const res = await API.get('/orders/summary/kpis');
    if (res && res.kpi) {
      const kpi = res.kpi;
      document.getElementById('kpi-sales-today').innerText = `₱${kpi.totalRevenueToday.toFixed(2)}`;
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
    const status = order.status;
    if (counts[status] !== undefined) counts[status]++;
    if (!columns[status]) return;

    const itemsSummary = (order.items || []).map(i => `${i.quantity}x ${i.item_name}`).join(', ');

    let paymentBadge = '';
    if (order.payment_method === 'gcash') {
      if (order.payment_mismatch) {
        paymentBadge = `<span class="badge badge-mismatch">⚠️ GCash Mismatch</span>`;
      } else {
        paymentBadge = `<span class="badge badge-gcash">📱 GCash Verified</span>`;
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
          <button class="btn btn-secondary btn-sm" onclick="event.stopPropagation(); openAssignRiderModal(${order.id}, ${order.delivery_id || 'null'})">🛵 Dispatch</button>
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
      <div style="font-weight: 700; font-size: 0.92rem; margin-bottom: 4px;">${order.customer_name || 'Customer'}</div>
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
      <td>${order.customer_name || 'Customer'}</td>
      <td><span class="badge ${order.order_type === 'delivery' ? 'badge-dispatched' : 'badge-preparing'}">${order.order_type}</span></td>
      <td>${itemsCount} items</td>
      <td><strong>₱${parseFloat(order.total_amount).toFixed(2)}</strong></td>
      <td>
        <span class="badge ${order.payment_mismatch ? 'badge-mismatch' : order.payment_method === 'gcash' ? 'badge-gcash' : 'badge-cash'}">
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
      <td>${order.customer_name || 'Customer'}</td>
      <td><span class="badge badge-info">${order.order_type}</span></td>
      <td><strong>₱${parseFloat(order.total_amount).toFixed(2)}</strong></td>
      <td><span class="badge ${order.payment_mismatch ? 'badge-mismatch' : 'badge-cash'}">${order.payment_method}</span></td>
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

      const itemsHtml = (o.items || []).map(i => `
        <div style="display: flex; justify-content: space-between; padding: 6px 0; border-bottom: 1px dashed var(--border-subtle);">
          <div>
            <strong>${i.quantity}x ${i.item_name}</strong>
            ${i.special_instructions ? `<div style="font-size: 0.78rem; color: var(--brand-primary);">${i.special_instructions}</div>` : ''}
          </div>
          <div>₱${parseFloat(i.subtotal).toFixed(2)}</div>
        </div>
      `).join('');

      document.getElementById('modal-order-body').innerHTML = `
        <div style="margin-bottom: 16px;">
          <div style="display: flex; justify-content: space-between; margin-bottom: 8px;">
            <span>Customer: <strong>${o.first_name || ''} ${o.last_name || ''}</strong></span>
            <span>Status: <span class="badge badge-${o.status}">${o.status}</span></span>
          </div>
          <div style="font-size: 0.88rem; color: var(--text-secondary);">Phone: ${o.customer_phone || 'N/A'}</div>
          <div style="font-size: 0.88rem; color: var(--text-secondary);">Address: ${o.delivery_address || 'Store Pickup'}</div>
        </div>

        <h4 style="font-size: 0.95rem; margin: 16px 0 8px 0; color: var(--brand-crema);">Ordered Items:</h4>
        <div style="margin-bottom: 16px;">${itemsHtml}</div>

        <div style="padding-top: 8px;">
          <div style="display: flex; justify-content: space-between; font-size: 0.88rem;">
            <span>Subtotal:</span>
            <span>₱${parseFloat(o.subtotal).toFixed(2)}</span>
          </div>
          <div style="display: flex; justify-content: space-between; font-size: 0.88rem;">
            <span>Delivery Fee:</span>
            <span>₱${parseFloat(o.delivery_fee).toFixed(2)}</span>
          </div>
          <div style="display: flex; justify-content: space-between; font-size: 1.15rem; font-weight: 800; color: var(--brand-gold); margin-top: 6px;">
            <span>Total Amount:</span>
            <span>₱${parseFloat(o.total_amount).toFixed(2)}</span>
          </div>
        </div>

        <div style="margin-top: 16px; padding: 12px; background: var(--bg-surface-elevated); border-radius: var(--radius-sm);">
          <div style="font-size: 0.85rem; font-weight: 700;">Payment: ${o.payment_method.toUpperCase()} (${o.payment_status})</div>
          ${o.payment_mismatch ? `<div style="color: var(--status-danger); font-size: 0.82rem; margin-top: 4px;">⚠️ ${o.mismatch_notes}</div>` : ''}
          ${o.reference_no ? `<div style="font-size: 0.82rem; color: var(--text-muted);">Ref: ${o.reference_no}</div>` : ''}
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
          <div style="display: flex; gap: 8px; margin-bottom: 12px;">
            <span class="badge ${item.is_available ? 'badge-delivered' : 'badge-mismatch'}">
              ${item.is_available ? 'In Menu' : 'Unavailable'}
            </span>
            <span class="badge badge-cash">Stock: ${item.stock_quantity || 0}</span>
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

function openAddMenuItemModal() {
  document.getElementById('menu-item-id').value = '';
  document.getElementById('modal-menu-title').innerText = 'Add New Menu Item';
  document.getElementById('menu-name-input').value = '';
  document.getElementById('menu-desc-input').value = '';
  document.getElementById('menu-price-input').value = '';
  document.getElementById('menu-prep-input').value = '10';
  document.getElementById('menu-img-input').value = '';
  document.getElementById('initial-stock-group').style.display = 'grid';

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
  document.getElementById('menu-img-input').value = targetItem.image_url || '';
  document.getElementById('initial-stock-group').style.display = 'none';

  const select = document.getElementById('menu-cat-select');
  select.innerHTML = allMenuCategories.map(c => `
    <option value="${c.id}" ${c.id === targetItem.category_id ? 'selected' : ''}>${c.name}</option>
  `).join('');

  openModal('modal-menu-item');
}

async function handleMenuItemSubmit(e) {
  e.preventDefault();
  const id = document.getElementById('menu-item-id').value;
  const categoryId = document.getElementById('menu-cat-select').value;
  const name = document.getElementById('menu-name-input').value;
  const description = document.getElementById('menu-desc-input').value;
  const price = document.getElementById('menu-price-input').value;
  const prepTimeMin = document.getElementById('menu-prep-input').value;
  const imageUrl = document.getElementById('menu-img-input').value;
  const initialStock = document.getElementById('menu-stock-input').value;
  const unit = document.getElementById('menu-unit-input').value;

  try {
    if (id) {
      await API.put(`/menu/${id}`, { categoryId, name, description, price, prepTimeMin, imageUrl });
      API.toast('Menu item updated!', 'success');
    } else {
      await API.post('/menu', { categoryId, name, description, price, prepTimeMin, imageUrl, initialStock, unit });
      API.toast('Menu item created!', 'success');
    }
    closeModal('modal-menu-item');
    loadMenu();
  } catch (err) {
    console.error('Menu submit error:', err);
  }
}

// ----------------------------------------------------------------------------
// 4. Inventory Management
// ----------------------------------------------------------------------------
async function loadInventory() {
  try {
    const res = await API.get('/inventory');
    if (res && res.inventory) {
      allInventory = res.inventory;
      renderInventoryTable(allInventory);
    }
    const logsRes = await API.get('/inventory/logs');
    if (logsRes && logsRes.logs) {
      renderInventoryLogs(logsRes.logs);
    }
  } catch (err) {
    console.error('Load inventory error:', err);
  }
}

function renderInventoryTable(items) {
  const tbody = document.getElementById('inventory-tbody');
  tbody.innerHTML = '';

  items.forEach(item => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td><strong>${item.item_name}</strong></td>
      <td>${item.category_name}</td>
      <td><span style="font-size: 1.05rem; font-weight: 800;">${item.stock_quantity}</span> ${item.unit}</td>
      <td>${item.low_stock_threshold} ${item.unit}</td>
      <td>
        <span class="badge ${item.stock_status === 'in_stock' ? 'badge-delivered' : item.stock_status === 'low_stock' ? 'badge-pending' : 'badge-mismatch'}">
          ${item.stock_status.replace('_', ' ')}
        </span>
      </td>
      <td>${item.last_restocked_at ? new Date(item.last_restocked_at).toLocaleDateString() : 'N/A'}</td>
      <td>
        <button class="btn btn-secondary btn-sm" onclick="openRestockModal(${item.id}, '${item.item_name.replace(/'/g, "\\'")}')">
          📦 Restock
        </button>
      </td>
    `;
    tbody.appendChild(tr);
  });
}

function renderInventoryLogs(logs) {
  const tbody = document.getElementById('inventory-logs-tbody');
  tbody.innerHTML = '';

  logs.forEach(log => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${new Date(log.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</td>
      <td><strong>${log.item_name}</strong></td>
      <td style="color: ${log.change_amount > 0 ? 'var(--status-success)' : 'var(--status-danger)'}; font-weight: 700;">
        ${log.change_amount > 0 ? `+${log.change_amount}` : log.change_amount}
      </td>
      <td>${log.reason.replace('_', ' ')}</td>
      <td>${log.reference_id || '-'}</td>
      <td>${log.logged_by || 'System'}</td>
    `;
    tbody.appendChild(tr);
  });
}

function openRestockModal(invId, itemName) {
  document.getElementById('restock-inv-id').value = invId;
  document.getElementById('restock-item-name').value = itemName;
  document.getElementById('restock-qty-input').value = '20';
  document.getElementById('restock-notes-input').value = '';
  openModal('modal-restock');
}

async function handleRestockSubmit(e) {
  e.preventDefault();
  const inventoryId = document.getElementById('restock-inv-id').value;
  const quantityToAdd = document.getElementById('restock-qty-input').value;
  const notes = document.getElementById('restock-notes-input').value;

  try {
    const res = await API.post('/inventory/restock', { inventoryId, quantityToAdd, notes });
    if (res && res.success) {
      API.toast(res.message, 'success');
      closeModal('modal-restock');
      loadInventory();
    }
  } catch (err) {
    console.error('Restock error:', err);
  }
}

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
      <td>${del.customer_name || 'Customer'}</td>
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

async function testFareCalculation() {
  const distanceKm = document.getElementById('fare-dist-input').value;
  const vehicleType = document.getElementById('fare-vehicle-input').value;
  const weatherCondition = document.getElementById('fare-weather-input').value;

  try {
    const res = await API.post('/deliveries/compute-fare', { distanceKm, vehicleType, weatherCondition });
    if (res && res.fare) {
      const f = res.fare;
      document.getElementById('out-base-fare').innerText = `₱${f.baseFare.toFixed(2)}`;
      document.getElementById('out-dist-charge').innerText = `₱${f.distanceCharge.toFixed(2)} (${f.additionalHalfKmSteps} steps)`;
      document.getElementById('out-fuel-cost').innerText = `₱${f.fuelCost.toFixed(2)}`;
      document.getElementById('out-maint-cost').innerText = `₱${f.maintenanceCost.toFixed(2)}`;
      document.getElementById('out-subtotal').innerText = `₱${f.subtotal.toFixed(2)}`;
      document.getElementById('out-surcharge').innerText = `${Math.round(f.surchargeRate * 100)}% (+₱${f.surchargeAmount.toFixed(2)})`;
      document.getElementById('out-final-fare').innerText = `₱${f.finalFare.toFixed(2)}`;
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
        card.innerHTML = `
          <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
            <div>
              <strong>${f.customer_name || 'Customer'}</strong>
              <span style="font-size: 0.8rem; color: var(--text-muted); margin-left: 8px;">Order #${f.order_number}</span>
            </div>
            <div>
              <span class="badge ${f.sentiment === 'positive' ? 'badge-delivered' : f.sentiment === 'neutral' ? 'badge-pending' : 'badge-mismatch'}">
                ${f.sentiment}
              </span>
            </div>
          </div>
          <div style="color: var(--brand-gold); margin-bottom: 6px;">${stars}</div>
          <div style="font-size: 0.92rem; color: var(--text-primary);">${f.comments || '<em>No written comment provided.</em>'}</div>
          <div style="font-size: 0.78rem; color: var(--text-muted); margin-top: 8px;">
            ${new Date(f.created_at).toLocaleString()} ${f.rider_name ? `&bull; Delivered by ${f.rider_name}` : ''}
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
        const tr = document.createElement('tr');
        tr.innerHTML = `
          <td><strong>${item.item_name}</strong></td>
          <td>${item.category_name}</td>
          <td>${item.total_units_sold} units</td>
          <td><strong>₱${parseFloat(item.total_revenue).toFixed(2)}</strong></td>
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

function openNewOrderModal() {
  API.toast('Open the Messenger Simulator to experience placing full conversational orders!', 'info');
  switchTab('orders');
}
