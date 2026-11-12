const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fs = require('fs');

const testDbPath = path.join(__dirname, 'test_ai_assistant.sqlite');
if (fs.existsSync(testDbPath)) {
  try { fs.unlinkSync(testDbPath); } catch (e) {}
}

process.env.DB_FORCE_SQLITE = '1';
process.env.SQLITE_PATH = testDbPath;
process.env.NODE_ENV = 'test';
process.env.APP_BASE_URL = 'https://diners-cafe-test.onrender.com';
process.env.GEMINI_API_KEY = 'test_gemini_key_valid_shape';
process.env.GEMINI_MODEL = 'gemini-3.8-flash';

const db = require('../database/db');
const aiService = require('../src/services/aiService');
const nlpEngine = require('../src/services/nlpEngine');
const messengerService = require('../src/services/messengerService');
const sessionManager = require('../src/services/sessionManager');
const orderService = require('../src/services/orderService');

const sentMessages = [];
messengerService.callSendAPI = async (psid, messagePayload, options) => {
  sentMessages.push({ psid: String(psid), messagePayload, options });
  return { recipient_id: String(psid), message_id: `mid.ai.${Date.now()}` };
};

function clearSent(psid) {
  for (let i = sentMessages.length - 1; i >= 0; i--) {
    if (!psid || sentMessages[i].psid === String(psid)) {
      sentMessages.splice(i, 1);
    }
  }
}

function getSent(psid) {
  return sentMessages.filter(m => m.psid === String(psid));
}

test('Gemini Conversational AI Service & Structured Action Routing Suite', async (t) => {
  await db.initDatabase();

  const [drinkRows] = await db.query(
    `SELECT m.id, m.name, m.price, c.name AS category_name
     FROM menu_items m
     JOIN categories c ON c.id = m.category_id
     WHERE LOWER(c.name) LIKE '%drink%' AND m.is_available = 1
     LIMIT 1`
  );
  assert.ok(drinkRows && drinkRows.length > 0, 'Seeded drink item required');
  const drinkItem = drinkRows[0];

  const [foodRows] = await db.query(
    `SELECT m.id, m.name, m.price, c.name AS category_name
     FROM menu_items m
     JOIN categories c ON c.id = m.category_id
     WHERE LOWER(c.name) NOT LIKE '%drink%' AND LOWER(c.name) NOT LIKE '%milktea%' AND m.is_available = 1
     LIMIT 1`
  );
  assert.ok(foodRows && foodRows.length > 0, 'Seeded non-drink item required');
  const foodItem = foodRows[0];

  // Mark 1 separate item as out of stock for grounding test
  const [allMenu] = await db.query(
    `SELECT id, name FROM menu_items WHERE id NOT IN (?, ?) LIMIT 1`,
    [drinkItem.id, foodItem.id]
  );
  const oosItem = allMenu[0];
  await db.query(`UPDATE menu_items SET is_available = 0, stock_quantity = 0 WHERE id = ?`, [oosItem.id]);
  await db.query(`UPDATE inventory SET stock_quantity = 0 WHERE menu_item_id = ?`, [oosItem.id]);

  await t.test('1. Model normalization upgrades deprecated gemini-2.5-flash to gemini-3.8-flash', () => {
    assert.strictEqual(aiService.normalizeModelName('gemini-2.5-flash'), 'gemini-3.8-flash');
    assert.strictEqual(aiService.normalizeModelName('gemini-2.0-flash'), 'gemini-3.8-flash');
    assert.strictEqual(aiService.normalizeModelName('gemini-3.8-flash'), 'gemini-3.8-flash');
  });

  await t.test('2. loadOperationalContext & buildAssistantSystemInstruction inject live DB store settings, OOS flags, cart, and order', async () => {
    const psid = `PSID_AI_CTX_${Date.now()}`;
    const order = await orderService.createOrder(psid, {
      customerName: 'AI Context Tester',
      customerPhone: '09171234567',
      deliveryAddress: 'Store Pickup',
      orderType: 'pickup',
      paymentMethod: 'cash',
      items: [{ menuItemId: foodItem.id, quantity: 1 }],
      deliveryFee: 0,
      totalAmount: Number(foodItem.price)
    });

    const session = await nlpEngine.getSession(psid);
    session.dining_mode = 'Delivery';
    session.cart = [{ menuItemId: drinkItem.id, name: drinkItem.name, price: Number(drinkItem.price), quantity: 2 }];

    const ctx = await aiService.loadOperationalContext(psid, session);
    assert.ok(ctx.store.name, 'Store name loaded');
    assert.ok(ctx.menuItems.length > 10, 'Active menu items loaded');
    assert.strictEqual(ctx.diningMode, 'Delivery');
    assert.strictEqual(ctx.latestOrder.order_number, order.orderNumber);

    const sysPrompt = aiService.buildAssistantSystemInstruction(ctx);
    assert.ok(sysPrompt.includes(drinkItem.name), 'Prompt must contain grounded in-stock drink');
    assert.ok(sysPrompt.includes(`${oosItem.name} |`), 'Prompt must contain OOS item');
    assert.ok(sysPrompt.includes('[OUT OF STOCK - DO NOT SELL]'), 'Prompt must explicitly flag OOS items');
    assert.ok(sysPrompt.includes(order.orderNumber), 'Prompt must include active order number');
  });

  await t.test('3. Rolling conversation memory buffer preserves last 8 messages and clears on resetUserSession', async () => {
    const psid = `PSID_AI_MEM_${Date.now()}`;
    const session = await nlpEngine.getSession(psid);

    for (let i = 1; i <= 6; i++) {
      aiService.appendConversationTurn(psid, `Customer msg ${i}`, `Bot reply ${i}`, session);
    }

    const hist = aiService.getConversationHistory(psid, session);
    assert.strictEqual(hist.length, 8, 'Rolling memory buffer must trim to max 8 messages');
    assert.strictEqual(hist[0].text, 'Customer msg 3');
    assert.strictEqual(hist[7].text, 'Bot reply 6');

    await sessionManager.resetUserSession(psid);
    const afterReset = aiService.getConversationHistory(psid, await nlpEngine.getSession(psid));
    assert.strictEqual(afterReset.length, 0, 'Session reset must purge rolling AI memory');
  });

  await t.test('4. generateAssistantResponse enforces structured JSON via mock @google/genai client and fails over on 429', async () => {
    const psid = `PSID_AI_GEN_${Date.now()}`;
    const session = await nlpEngine.getSession(psid);
    const calls = [];

    const mockClient = {
      interactions: {
        create: async (params) => {
          calls.push(params);
          if (calls.length === 1) {
            const err = new Error('Quota limit reached');
            err.status = 429;
            throw err;
          }
          return {
            id: 'int_mock_001',
            output_text: JSON.stringify({
              reply_message: `Naku, pahinga po muna kayo! Available po ang aming ${drinkItem.name} kung gusto ninyo ng malamig na pampalamig.`,
              detected_action: 'NONE',
              action_payload: {
                item_name: null,
                quantity: null,
                addon: null,
                dining_mode: null
              }
            })
          };
        }
      }
    };

    const res = await aiService.generateAssistantResponse(psid, 'Pagod na pagod ako sa trabaho huhu', session, {
      client: mockClient
    });

    assert.strictEqual(calls.length, 2, 'Must fail over to fallback model when primary hits 429');
    assert.strictEqual(calls[0].model, 'gemini-3.8-flash');
    assert.strictEqual(calls[0].response_format.mime_type, 'application/json');
    assert.strictEqual(res.detected_action, 'NONE');
    assert.ok(res.reply_message.includes(drinkItem.name));
  });

  await t.test('5. Structured Action Routing: ADD_ITEM triggers drink upsell when addon missing, respects OOS, and handles food directly', async () => {
    const psid = `PSID_AI_ADD_${Date.now()}`;
    clearSent(psid);
    const session = await nlpEngine.getSession(psid);

    // 5a. Drink without add-on triggers AWAITING_DRINK_ADDON
    const upsellRes = await nlpEngine.executeAiAssistantTurn(psid, session, `pabili 2 ${drinkItem.name}`, {
      aiResponse: {
        reply_message: `Sige po! 2x ${drinkItem.name} po iyon.`,
        detected_action: 'ADD_ITEM',
        action_payload: { item_name: drinkItem.name, quantity: 2, addon: null, dining_mode: 'Delivery' }
      }
    });
    assert.strictEqual(upsellRes.intent, 'AI_ADD_ITEM_UPSELL');
    assert.strictEqual(session.state, 'AWAITING_DRINK_ADDON');
    assert.strictEqual(session.dining_mode, 'Delivery');

    // 5b. Food item adds directly to cart
    const psidFood = `PSID_AI_FOOD_${Date.now()}`;
    clearSent(psidFood);
    const sessionFood = await nlpEngine.getSession(psidFood);
    const foodRes = await nlpEngine.executeAiAssistantTurn(psidFood, sessionFood, `1 ${foodItem.name}`, {
      aiResponse: {
        reply_message: `Noted po! Idinagdag ko na sa cart ang 1x ${foodItem.name}.`,
        detected_action: 'ADD_ITEM',
        action_payload: { item_name: foodItem.name, quantity: 1, addon: null, dining_mode: 'Pick-up' }
      }
    });
    assert.strictEqual(foodRes.intent, 'AI_ADD_ITEM');
    assert.strictEqual(sessionFood.cart.length, 1);
    assert.strictEqual(sessionFood.dining_mode, 'Pick-up');

    // 5c. Out-of-stock item must NOT be added to cart
    const psidOos = `PSID_AI_OOS_${Date.now()}`;
    clearSent(psidOos);
    const sessionOos = await nlpEngine.getSession(psidOos);
    const oosRes = await nlpEngine.executeAiAssistantTurn(psidOos, sessionOos, `pabili ${oosItem.name}`, {
      aiResponse: {
        reply_message: `Testing OOS guard for ${oosItem.name}`,
        detected_action: 'ADD_ITEM',
        action_payload: { item_name: oosItem.name, quantity: 1, addon: null, dining_mode: null }
      }
    });
    assert.strictEqual(oosRes.intent, 'AI_ADD_ITEM_OUT_OF_STOCK');
    assert.strictEqual(sessionOos.cart?.length || 0, 0, 'Must never add out-of-stock item to cart');
  });

  await t.test('6. Structured Action Routing: VIEW_MENU, SEND_PICTURE, CHECK_STATUS, CANCEL_ORDER, and PROCEED_CHECKOUT execute deterministically', async () => {
    const psid = `PSID_AI_ACTIONS_${Date.now()}`;
    await db.query(`UPDATE menu_items SET image_url = ? WHERE id = ?`, ['https://example.com/menu/drink.jpg', drinkItem.id]);

    // VIEW_MENU
    clearSent(psid);
    const session = await nlpEngine.getSession(psid);
    const menuRes = await nlpEngine.executeAiAssistantTurn(psid, session, 'anong food nyo', {
      aiResponse: {
        reply_message: 'Heto na po ang ating menu!',
        detected_action: 'VIEW_MENU',
        action_payload: { item_name: null, quantity: null, addon: null, dining_mode: null }
      }
    });
    assert.strictEqual(menuRes.aiAction, 'VIEW_MENU');
    const sentMenu = getSent(psid);
    assert.ok(sentMenu.some(m => (m.messagePayload?.text || '').includes("DINER'S CAFE MENU")), 'Must dispatch categorized text menu');

    // SEND_PICTURE
    clearSent(psid);
    const picRes = await nlpEngine.executeAiAssistantTurn(psid, session, `patingin nga mukha ng ${drinkItem.name}`, {
      aiResponse: {
        reply_message: 'Ito po ang picture!',
        detected_action: 'SEND_PICTURE',
        action_payload: { item_name: drinkItem.name, quantity: null, addon: null, dining_mode: null }
      }
    });
    assert.strictEqual(picRes.aiAction, 'SEND_PICTURE');
    assert.ok(getSent(psid).some(m => m.messagePayload?.attachment?.type === 'image'), 'Must send Messenger image attachment');

    // Place pending order -> CHECK_STATUS & CANCEL_ORDER
    const ord = await orderService.createOrder(psid, {
      customerName: 'Action Tester',
      customerPhone: '09175556666',
      deliveryAddress: 'Store Pickup',
      orderType: 'pickup',
      paymentMethod: 'cash',
      items: [{ menuItemId: foodItem.id, quantity: 1 }],
      deliveryFee: 0,
      totalAmount: Number(foodItem.price)
    });

    clearSent(psid);
    const statusRes = await nlpEngine.executeAiAssistantTurn(psid, session, 'asan na pagkain ko', {
      aiResponse: {
        reply_message: 'Sandali lang po, chine-check ko na.',
        detected_action: 'CHECK_STATUS',
        action_payload: { item_name: null, quantity: null, addon: null, dining_mode: null }
      }
    });
    assert.strictEqual(statusRes.aiAction, 'CHECK_STATUS');
    assert.ok(getSent(psid).some(m => (m.messagePayload?.text || '').includes(ord.orderNumber)), 'Must report real DB order status');

    clearSent(psid);
    const cancelRes = await nlpEngine.executeAiAssistantTurn(psid, session, 'ayoko na ituloy order ko', {
      aiResponse: {
        reply_message: 'Cge po cancel ko na.',
        detected_action: 'CANCEL_ORDER',
        action_payload: { item_name: null, quantity: null, addon: null, dining_mode: null }
      }
    });
    assert.strictEqual(cancelRes.intent, 'ORDER_CANCELLED_PENDING');
    const [cancelledRows] = await db.query('SELECT status FROM orders WHERE id = ?', [ord.orderId]);
    assert.strictEqual(cancelledRows[0].status, 'cancelled');

    // PROCEED_CHECKOUT with non-empty cart transitions to checkout details
    clearSent(psid);
    const freshSession = await nlpEngine.getSession(psid);
    freshSession.cart = [{ menuItemId: foodItem.id, name: foodItem.name, price: Number(foodItem.price), quantity: 1 }];
    freshSession.order_subtotal = Number(foodItem.price);
    const checkoutRes = await nlpEngine.executeAiAssistantTurn(psid, freshSession, 'pde ba mgpa-dlvr na', {
      aiResponse: {
        reply_message: 'Opo, pwedeng-pwede po magpa-deliver! Kunin ko lang po ang details ninyo.',
        detected_action: 'PROCEED_CHECKOUT',
        action_payload: { item_name: null, quantity: null, addon: null, dining_mode: 'Delivery' }
      }
    });
    assert.strictEqual(checkoutRes.aiAction, 'PROCEED_CHECKOUT');
    assert.strictEqual(freshSession.state, 'COLLECTING_CUSTOMER_INFO');
  });
});
