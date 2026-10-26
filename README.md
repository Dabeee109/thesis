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
| `POST` | `/api/delivery/quote` | Request signed delivery quote for pin or address (Rate-limited: 20 req/min) |
| `GET` | `/api/delivery/service-area` | Public cafe entrance coordinates & max delivery radius |

---

## 🗺️ Delivery Location and Routing

### 1. Required Environment Variables
| Variable | Description | Default / Example |
| :--- | :--- | :--- |
| `STORE_LAT` | Latitude of the cafe entrance (required at boot) | `14.6042` |
| `STORE_LNG` | Longitude of the cafe entrance (required at boot) | `120.9822` |
| `TZ_NAME` | Timezone for business operations & heat surcharge | `Asia/Manila` |
| `MAPS_PROVIDER` | Maps provider engine (`google` or `mock`) | `mock` (in dev) |
| `GOOGLE_MAPS_API_KEY` | Google Maps API key (required in production) | `AIzaSy...` |
| `MAPS_TIMEOUT_MS` | Timeout for external geocoding and routing calls | `5000` |
| `QUOTE_TTL_SEC` | Lifetime of signed delivery quote tokens in seconds | `600` |
| `BICYCLE_MAX_KM` | Maximum distance for bicycle eco-courier | `1.5` |
| `ROUTE_CACHE_TTL_SEC` | In-memory road routing cache TTL in seconds | `600` |
| `OPENWEATHER_API_KEY` | Optional OpenWeatherMap API key for live weather | (empty = sunny) |
| `HEAVY_RAIN_MM_H` | Hourly rain threshold (mm/h) triggering heavy rain | `7.5` |

### 2. How to Find the Shop Coordinates
Open Google Maps in your desktop browser, navigate to your cafe location, zoom into the physical entrance doorway of the shop, right-click directly on the entrance, and copy the latitude and longitude coordinates. Set these values in `STORE_LAT` and `STORE_LNG`.

### 3. Mock versus Google Provider
- **Mock Provider (`MAPS_PROVIDER=mock`)**: Built for deterministic local development and testing without network latency, API keys, or external bills. Accurately simulates geocoding (`nowhere` triggers not found, `vague` triggers low precision, `toofar` triggers ~6 km out-of-radius, and standard addresses return ~1.1 km) and computes road distance via haversine distance scaled by 1.25. It strictly refuses to run in production (`NODE_ENV=production`).
- **Google Provider (`MAPS_PROVIDER=google`)**: Production-ready implementation integrating Google Geocoding API (`components=country:PH`) and Google Routes API v2 (`computeRoutes` using `TWO_WHEELER` mode). Never logs API keys or full request URLs.

### 4. Quote Flow
1. The client submits a location coordinate pin or a typed text address to `POST /api/delivery/quote`.
2. The server verifies coordinates, runs a cheap straight-line haversine prefilter against the cafe's maximum service radius, and fetches the actual two-wheeler road distance.
3. The server chooses the courier vehicle type based on distance and evaluates the current real-time weather and extreme-heat conditions to compute the fare through the smart fare calculator.
4. The server returns the fare breakdown alongside a cryptographically signed, short-lived JWT quote token that locks in the fee for order checkout.

### 5. Error Codes & HTTP Status Contract
All API errors return `{ "success": false, "code": "...", "message": "...", "details": {} }`:
- `VALIDATION_ERROR` (`400`): Malformed inputs, bad data types, or empty request body.
- `GEO_INVALID_COORDS` (`422`): Non-finite coordinates, out-of-range bounds, or `0,0`.
- `GEO_OUT_OF_COUNTRY` (`422`): Location is outside the Philippine territorial bounding box.
- `GEO_NOT_FOUND` (`422`): Address cannot be located or no drivable road route found.
- `GEO_LOW_PRECISION` (`422`): Address precision is too approximate (`APPROXIMATE` or `GEOMETRIC_CENTER`); pin required.
- `GEO_TOO_FAR` (`422`): Location exceeds the maximum delivery radius (includes `details.roadKm` and `details.maxKm`).
- `GEO_PROVIDER_ERROR` (`502`): External mapping provider outage or timeout.
- `QUOTE_EXPIRED` (`410`): Quote token has expired; customer must be re-quoted.
- `QUOTE_INVALID` (`400`): Tampered quote token, invalid signature, or wrong audience.
- `RATE_LIMITED` (`429`): Exceeded 20 quote requests per minute per IP.
- `QUOTE_FAILED` (`500`): Unexpected server error (logged privately server-side).

### 6. Timezone (TZ) Behavior
`process.env.TZ` is configured to `config.timezone` (`Asia/Manila`) at the very top of `src/server.js` before any other module imports. This guarantees that `Date#getHours()` and time calculations consistently follow Philippine Standard Time (PST), ensuring the 11:00 AM – 3:00 PM extreme heat surcharge window evaluates accurately even on UTC cloud servers.

### 7. Security: Why the Client is Never Trusted with Price Inputs
If clients could supply vehicle type, weather condition, distance, or fee, malicious users could tamper with payloads to underpay or bypass delivery charges.

### 8. Reverse Proxy Configuration
If running behind reverse proxies (Nginx, Cloudflare, AWS ALB, Heroku), configure `app.set('trust proxy', 1)` in Express so that `express-rate-limit` identifies client IP addresses accurately from the `X-Forwarded-For` header.

---

## 🤖 Conversational Flow v2

The Diner's Cafe conversational AI provides an end-to-end ordering and support experience via Facebook Messenger and the built-in browser simulator (`/simulator.html`).

### 1. Conversation States & Macro States
The bot state machine manages 16 granular states and maps them into 5 derived `macroState` categories (`idle | ordering | awaiting_checkout | order_placed | awaiting_feedback`) for logging and metrics:
- `IDLE`: No active operation; accepts any command or intent.
- `BROWSING`: Full menu displayed; user is selecting items or issuing orders.
- `ADDING_ITEM`: Awaiting quantity selection for a pending menu item.
- `AWAITING_CHECKOUT_CONFIRM`: Open yes/no question: "Check out?".
- `AWAITING_CLEAR_CONFIRM`: Open yes/no question: "Clear your whole cart?".
- `AWAITING_ORDER_TYPE`: Selecting delivery (`🛵 Delivery`) or pickup (`🛍️ Pickup`).
- `AWAITING_DETAILS_REUSE`: Prompting returning customer to reuse saved address/phone.
- `AWAITING_NAME`: Collecting recipient customer full name.
- `AWAITING_ADDRESS`: Collecting street address with landmark (delivery only).
- `AWAITING_PHONE`: Collecting Philippine mobile contact number (`09XXXXXXXXX` / `+639XXXXXXXXX`).
- `AWAITING_DETAILS_CONFIRM`: Reviewing order breakdown (items, subtotal, delivery fee, total).
- `AWAITING_EDIT_FIELD`: Selecting which customer field to update from the summary.
- `AWAITING_PAYMENT`: Choosing cash on delivery/counter or GCash.
- `AWAITING_GCASH_AMOUNT`: Customer sending amount sent via GCash.
- `AWAITING_REMOVE_ITEM`: Selecting which item to decrement or delete from cart.
- `AWAITING_FEEDBACK_COMMENT`: Optional comment input after a 1–3 star rating.

### 2. Button Payloads
All payloads carry IDs rather than names and execute idempotently:
- `MENU_HOME`: Immediate whole-menu carousel.
- `VIEW_CART`: Show formatted cart contents and subtotal.
- `CONFIRM_CHECKOUT`: Transition from browsing/cart to order type selection.
- `KEEP_SHOPPING`: Retain cart and return to browsing.
- `CHECKOUT_DELIVERY` / `CHECKOUT_PICKUP`: Set order fulfillment type.
- `USE_SAVED_DETAILS` / `CHANGE_DETAILS`: Accept or re-enter customer details.
- `CONFIRM_DETAILS`: Validate pricing and move to payment selection.
- `EDIT_DETAILS`, `EDIT_NAME`, `EDIT_ADDRESS`, `EDIT_PHONE`: Field-level inline edits.
- `BACK_TO_SUMMARY`: Return directly to order breakdown.
- `BACK_TO_CART`: Return directly to cart summary.
- `PAY_CASH` / `PAY_GCASH`: Choose payment method.
- `REMOVE_ITEM`: Prompt for item to remove with quick-reply buttons.
- `REMOVE_ITEM_<id>`: Remove whole line or decrement selected item.
- `CLEAR_CART` / `CLEAR_CART_YES`: Confirmation and execution of cart reset.
- `RESET_SESSION`: Complete hard-reset of customer session state and cart.
- `ADD_ITEM_<id>` / `QTY_<n>`: Item addition and quantity selection.
- `FEEDBACK_RATE_<1-5>_<orderNumber>`: Post-delivery star rating.
- `FEEDBACK_SKIP_<orderNumber>`: Skip optional comment on low rating.
- `TRACK_LATEST_ORDER`: Track latest active order status.
- `STORE_INFO`: Return cafe hours, location, and contact numbers.

### 3. Priority Routing Order (Code-First)
Incoming messages are routed strictly in this order before invoking external NLU:
1. **Session Expiry**: Stale states older than 30 minutes (`NLP_STATE_TTL_MIN`) reset to `IDLE`.
2. **Button Payloads**: Validated postbacks and quick-reply action triggers.
3. **Open State Text Handlers**: Free text expected for name, address, phone, quantity, GCash amount, or feedback comments.
4. **Yes/No Lexicon**: Affirmative/negative answers evaluated via `classifyShort` only when a yes/no state is open. Non-answers replace the open question and route normally.
5. **Shortcut Keywords**: Exact or normalized single words (`menu`, `cart`, `track`, `hi`, `hours`, `help`, `cancel`).
6. **Wit.ai NLU / Local Fallback**: Unstructured queries parsed for intents and entities.

### 4. Matching Thresholds & Tuning
Configured in `src/services/textMatch.js` and `src/services/nlpEngine.js`:
- **Intent Act Threshold**: Confidence $\ge 0.80$ acts immediately.
- **Intent Confirm Threshold**: Confidence $0.55 - 0.79$ prompts with `Yes` / `No` confirmation.
- **Intent Fallback Threshold**: Confidence $< 0.55$ sends polite fallback quick replies.
- **Menu Item Similarity**:
  - `fuzzyAccept`: $0.78$ (clear single match adds directly).
  - `fuzzyConfirm`: $0.55$ (prompts "Did you mean X?").
  - `ambiguityGap`: $0.08$ (candidates within gap trigger quick-reply selection buttons).

### 5. Retraining Wit.ai
See [`docs/wit-training.md`](file:///c:/Users/USER/Desktop/Thesis/docs/wit-training.md) for full instructions:
- Test dry-run: `node scripts/uploadWitData.js --dry-run`
- Upload dataset: `WIT_AI_SERVER_ACCESS_TOKEN="YOUR_TOKEN" node scripts/uploadWitData.js`

### 6. Automatic Feedback Architecture
1. When staff or rider advances an order to `delivered` via `PATCH /api/orders/:id/status`, `orderService.updateOrderStatus` calls `feedbackService.requestFeedback(orderId)`.
2. `orders.feedback_requested_at` is claimed atomically in the database to guarantee exactly one prompt per order.
3. The prompt is sent via `sendFeedbackPrompt` using `messaging_type: 'UPDATE'`.
4. When customer taps a star rating (`FEEDBACK_RATE_<n>_<orderNumber>`), `handleFeedbackRating` verifies sender ownership (`c.psid === psid`) and inserts a row into `feedback`.
5. An SSE event `NEW_FEEDBACK` is broadcast to connected dashboard clients, instantly updating the **Feedback & Ratings** table without page refresh.
6. If 1–3 stars are submitted in `IDLE`, the bot prompts for an optional comment; submitting a comment updates `feedback.comments` and re-emits `NEW_FEEDBACK` so the card displays the comment in real time.
7. HTML escaping (`escapeHtml`) prevents stored XSS across all customer-supplied fields.

### 7. Customizing Message Wording
All bot text and quick-reply copy are centralized in `src/services/botMessages.js`. Edit strings or functions in that file to adjust phrasing, button titles, or formatting across the entire chatbot without touching the state machine.


