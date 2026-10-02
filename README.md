# Diner's Cafe Ordering & Delivery System

An AI-powered conversational cafe operations and smart internal delivery management system integrating with Facebook Messenger.

---

## 🌟 Key Architecture & Highlights

1. **AI Chatbot Conversational Layer (Facebook Messenger)**
   - Webhook verification (`GET /webhook`) and event handler (`POST /webhook`).
   - NLP Intent Parser supporting: Menu browsing, categories, item search, quantity selection, special instructions, cart summary, delivery checkout, GCash amount verification, live order tracking, and post-delivery ratings (FR11).
   - Built-in **Messenger Webview Simulator** (`/simulator.html`) allowing full conversational testing in the browser.

2. **Smart Delivery Fare Calculation Engine (FR6)**
   - Internal delivery only: **0.0 to 3.0 km range**.
   - **Motorcycle**: Base ₱49.00 (first 1.0 km) + ₱12.00 per additional 0.5 km + Fuel (`[dist / 45] * ₱85`) + Maintenance (`₱5.00 * dist`).
   - **Bicycle**: Base ₱35.00 (first 1.0 km) + ₱10.00 per additional 0.5 km + Maintenance (`₱3.00 * dist`).
   - **Weather Surcharges**: 0% (Sunny), 15% (Light Rain), 35% (Heavy Rain), 15% (Extreme Heat 11:00 AM–3:00 PM).
   - **Rounding**: All final fares are rounded to the nearest ₱5.00.

3. **Centralized MySQL Relational Database**
   - Standard MySQL schemas (`database/schema.sql`) and sample dataset (`database/seed.sql`).
   - Tables: `customers`, `admins_staff`, `categories`, `menu_items`, `inventory`, `inventory_logs`, `orders`, `order_items`, `payments`, `delivery_personnel`, `deliveries`, `feedback`, `notifications`, `chatbot_logs`.

4. **Real-Time Admin & Operations Dashboard**
   - Live KPI overview (Sales today, Revenue, Pending orders, Active couriers, GCash mismatches, Low stock alerts).
   - Interactive Kanban Order Board + Table view with state transitions (`pending` &rarr; `preparing` &rarr; `dispatched` &rarr; `delivered`).
   - Inventory tracking with automatic stock deduction on orders and audit logs.
   - Smart Delivery Dispatcher with distance & vehicle selection, weather surcharges, and fare override.
   - Customer Feedback (FR11) rating breakdown, satisfaction rate, and sentiment tracking.
   - Reports (FR10) with CSV export and printable receipt formats.

5. **Dedicated Rider Portal**
   - Mobile-first interface for cafe couriers to inspect trips and mark deliveries completed.

---

## 🚀 Quick Start & Running Locally

### 1. Install Dependencies
```bash
npm install
```

### 2. Run the Unit Tests (Fare Engine)
```bash
npm test
```

### 3. Start the Server
```bash
npm start
```
Open your browser at:
- **Landing Portal**: [http://localhost:3000](http://localhost:3000)
- **Admin Dashboard**: [http://localhost:3000/dashboard.html](http://localhost:3000/dashboard.html)
- **Messenger Bot Simulator**: [http://localhost:3000/simulator.html](http://localhost:3000/simulator.html)
- **Rider Mobile Portal**: [http://localhost:3000/rider.html](http://localhost:3000/rider.html)

---

## 🔐 Default Demo Accounts

All default accounts have password: `password123`

| Role | Email | Purpose |
| :--- | :--- | :--- |
| **Admin** | `admin@dinerscafe.ph` | Full dashboard access, menu CRUD, reports, fare overrides |
| **Barista / Staff** | `staff@dinerscafe.ph` | Order Kanban, kitchen preparation, inventory control |
| **Motorcycle Rider** | `rider1@dinerscafe.ph` | Courier dispatch portal, trip status updates |
| **Bicycle Eco-Rider** | `rider2@dinerscafe.ph` | Eco-friendly short distance courier portal |

---

## 📡 REST API Reference

| Method | Endpoint | Description |
| :--- | :--- | :--- |
| `GET` | `/webhook` | Facebook Messenger webhook verification handshake |
| `POST` | `/webhook` | Facebook Messenger incoming message processor |
| `POST` | `/api/auth/login` | Staff / Admin authentication |
| `GET` | `/api/menu` | Public menu categories and items |
| `GET` | `/api/orders` | Orders list with line items and payments |
| `PATCH` | `/api/orders/:id/status` | Update order state |
| `POST` | `/api/deliveries/compute-fare` | Calculate smart delivery fare (FR6) |
| `POST` | `/api/deliveries/assign-rider` | Assign courier and dispatch delivery |
| `GET` | `/api/inventory` | Inventory items stock levels and alerts |
| `POST` | `/api/inventory/restock` | Restock item inventory |
| `GET` | `/api/feedback` | Customer 1-5 star ratings & comments (FR11) |
| `GET` | `/api/reports/sales` | Sales and revenue reports (FR10) |
| `GET` | `/api/reports/export-csv` | Download complete orders CSV |
| `GET` | `/api/events` | Server-Sent Events (SSE) live push stream |
