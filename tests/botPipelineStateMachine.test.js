/**
 * End-to-End Conversational State Machine & Order Processing Pipeline Test Suite
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fs = require('fs');

const testDbPath = path.join(__dirname, 'test_pipeline_state_machine.sqlite');
if (fs.existsSync(testDbPath)) {
  try { fs.unlinkSync(testDbPath); } catch (e) {}
}

process.env.DB_FORCE_SQLITE = '1';
process.env.SQLITE_PATH = testDbPath;
process.env.NODE_ENV = 'test';
process.env.APP_BASE_URL = 'https://diners-cafe-test.onrender.com';
process.env.GEMINI_API_KEY = 'test_gemini_key_pipeline';

const db = require('../database/db');
const messageHandler = require('../bot/messageHandler');
const aiService = require('../src/services/aiService');
const messengerService = require('../src/services/messengerService');
const sessionManager = require('../src/services/sessionManager');

const sentMessages = [];
messengerService.sendTextMessage = async (psid, text) => {
  sentMessages.push({ psid: String(psid), text });
  return { recipient_id: String(psid), message_id: `mid_${Date.now()}` };
};
messengerService.callSendAPI = async (psid, messagePayload, options) => {
  sentMessages.push({ psid: String(psid), messagePayload, options });
  return { recipient_id: String(psid), message_id: `mid_${Date.now()}` };
};

function clearSent() {
  sentMessages.length = 0;
}
function getSent(psid) {
  return sentMessages.filter(m => m.psid === String(psid));
}

test('Conversational State Machine and Order Processing Pipeline Suite', async (t) => {
  await db.initDatabase();

  await t.test('1. resetCustomerSession wipes in-memory buffer, cart_items, and resets state to IDLE', async () => {
    const psid = `PSID_RESET_TEST_${Date.now()}`;
    const session = await sessionManager.getSession(psid);
    session.state = 'COLLECTING_CUSTOMER_INFO';
    session.cart = [{ menuItemId: 1, name: 'Burger', price: 149, quantity: 1 }];
    session.delivery_address = '123 Test St';
    session.phone_number = '09171234567';
    await sessionManager.saveSession(session);

    // Seed cart_items row
    await db.query(
      `INSERT INTO cart_items (sender_psid, menu_id, quantity) VALUES (?, 1, 1)`,
      [psid]
    ).catch(() => {});

    // Seed conversation turn
    aiService.appendConversationTurn(psid, 'Hello', 'Hi po!', session);
    assert.strictEqual(aiService.getConversationHistory(psid).length, 2);

    // Execute atomic reset
    const resetRes = await messageHandler.resetCustomerSession(psid);
    assert.strictEqual(resetRes.state, 'IDLE');
    assert.strictEqual(resetRes.cart.length, 0);
    assert.strictEqual(resetRes.delivery_address, null);
    assert.strictEqual(aiService.getConversationHistory(psid).length, 0, 'In-memory Gemini buffer cleared');

    // Verify DB cart_items deleted
    const [cartRows] = await db.query(`SELECT * FROM cart_items WHERE sender_psid = ?`, [psid]);
    assert.strictEqual(cartRows.length, 0, 'TiDB cart_items deleted');
  });

  await t.test('2. Condition D: Exact single-word "reset" command bypasses LLM and instantly replies', async () => {
    clearSent();
    const psid = `PSID_CMD_RESET_${Date.now()}`;
    const session = await sessionManager.getSession(psid);
    session.state = 'BUILDING_CART';
    session.cart = [{ menuItemId: 1, name: 'Burger', price: 149, quantity: 1 }];
    await sessionManager.saveSession(session);

    const event = {
      sender: { id: psid },
      message: { text: 'reset' }
    };

    const res = await messageHandler.handleMessage(event);
    assert.strictEqual(res.intent, 'SESSION_RESET_COMMAND');
    assert.ok(res.replyLog.includes('Na-reset na po ang ating chat session'));

    const sent = getSent(psid);
    assert.ok(sent.some(m => (m.text || '').includes('Na-reset na po ang ating chat session')));

    const freshSession = await sessionManager.getSession(psid);
    assert.strictEqual(freshSession.state, 'IDLE');
    assert.strictEqual(freshSession.cart.length, 0);
  });

  await t.test('2b. Condition D Guard: Multi-word sentences containing "reset" do NOT trigger instant reset', async () => {
    const res1 = await messageHandler.processPreLlmLifecycle('PSID_GUARD_1', 'Pa-reset po ng password ko');
    assert.strictEqual(res1.shouldBypassLlm, false, 'Does not bypass for multi-word sentence');

    const res2 = await messageHandler.processPreLlmLifecycle('PSID_GUARD_2', 'Na-reset wifi namin kahapon');
    assert.strictEqual(res2.shouldBypassLlm, false, 'Does not bypass for multi-word sentence');

    const res3 = await messageHandler.processPreLlmLifecycle('PSID_GUARD_3', ' RESET ');
    assert.strictEqual(res3.shouldBypassLlm, true, 'Bypasses for trimmed single word RESET');
  });

  await t.test('3. verifyDiscountIdImage validates Senior Citizen (OSCA) & PWD IDs with 3-layer anti-abuse check', async () => {
    // Test valid Senior Citizen ID
    const validSenior = await aiService.verifyDiscountIdImage('data:image/jpeg;base64,mock', 'Juan Dela Cruz', {
      mockResult: {
        is_valid: true,
        id_type: 'SENIOR_CITIZEN',
        extracted_name: 'Juan Dela Cruz',
        id_number: 'SC-12345-2026',
        is_expired: false,
        rejection_reason: null,
        name_matches_customer: true,
        discount_rate: 0.20
      }
    });
    assert.strictEqual(validSenior.is_valid, true);
    assert.strictEqual(validSenior.id_type, 'SENIOR_CITIZEN');
    assert.strictEqual(validSenior.discount_rate, 0.20);

    // Test valid PWD ID
    const validPwd = await aiService.verifyDiscountIdImage('data:image/jpeg;base64,mock', 'Maria Santos', {
      mockResult: {
        is_valid: true,
        id_type: 'PWD',
        extracted_name: 'Maria Santos',
        id_number: 'PWD-998877',
        is_expired: false,
        rejection_reason: null,
        name_matches_customer: true,
        discount_rate: 0.20
      }
    });
    assert.strictEqual(validPwd.is_valid, true);
    assert.strictEqual(validPwd.id_type, 'PWD');

    // Test Invalid / Expired ID
    const invalidId = await aiService.verifyDiscountIdImage('data:image/jpeg;base64,mock', 'Test Person', {
      mockResult: {
        is_valid: false,
        id_type: 'INVALID',
        extracted_name: 'Unknown',
        id_number: null,
        is_expired: true,
        rejection_reason: 'Non-qualifying ID provided',
        name_matches_customer: false,
        discount_rate: 0.00
      }
    });
    assert.strictEqual(invalidId.is_valid, false);
    assert.strictEqual(invalidId.discount_rate, 0.00);

    // Test TiDB anti-abuse: if same ID was already used >=2 times today, reject
    const abusedIdNumber = `ABUSED-ID-${Date.now()}`;
    await db.query(
      `INSERT INTO orders (customer_id, order_number, status, total_amount, customer_notes, created_at)
       VALUES (1, 'ORD-ABUSE-1', 'delivered', 100, ?, CURRENT_TIMESTAMP)`,
      [`Discount ID: ${abusedIdNumber}`]
    );
    await db.query(
      `INSERT INTO orders (customer_id, order_number, status, total_amount, customer_notes, created_at)
       VALUES (1, 'ORD-ABUSE-2', 'delivered', 100, ?, CURRENT_TIMESTAMP)`,
      [`Discount ID: ${abusedIdNumber}`]
    );

    const abusedCheck = await aiService.verifyDiscountIdImage('data:image/jpeg;base64,mock', 'Juan', {
      mockResult: {
        is_valid: true,
        id_type: 'SENIOR_CITIZEN',
        extracted_name: 'Juan',
        id_number: abusedIdNumber,
        is_expired: false,
        rejection_reason: null,
        name_matches_customer: true,
        discount_rate: 0.20
      }
    });
    assert.strictEqual(abusedCheck.is_valid, false, 'Abuse detected: rejected after 2 uses today');
    assert.ok(abusedCheck.rejection_reason.includes('exceeded'));
  });

  await t.test('4. generateConversationalResponse delegates cleanly with structured JSON', async () => {
    const mockClient = {
      interactions: {
        create: async () => ({
          output_text: JSON.stringify({
            reply_message: 'Magandang araw po! Heto po ang ating masarap na kape.',
            detected_action: 'VIEW_MENU',
            extracted_data: {}
          })
        })
      }
    };

    const res = await aiService.generateConversationalResponse('PSID_CONV_TEST', 'Patingin ng kape niyo', null, {
      client: mockClient
    });
    assert.ok(res);
    assert.strictEqual(res.detected_action, 'VIEW_MENU');
    assert.ok(res.reply_message.includes('Magandang araw po'));
  });
});
