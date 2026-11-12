const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

process.env.DB_FORCE_SQLITE = 'true';

const { initDatabase, query } = require('../database/db');
const settingsController = require('../src/controllers/settingsController');
const systemSettingsService = require('../src/services/systemSettingsService');

function mockRes() {
  return {
    statusCode: 200,
    body: null,
    status(c) {
      this.statusCode = c;
      return this;
    },
    json(data) {
      this.body = data;
      return this;
    }
  };
}

test('Store Operational Status & Operating Hours Settings', async (t) => {
  await initDatabase();

  await t.test('1. updateStoreStatus toggles to CLOSED and OPEN and persists to system_settings', async () => {
    const reqClose = { body: { store_status: 'CLOSED' }, user: { name: 'Admin' } };
    const resClose = mockRes();
    await settingsController.updateStoreStatus(reqClose, resClose);

    assert.strictEqual(resClose.statusCode, 200);
    assert.strictEqual(resClose.body.success, true);
    assert.strictEqual(resClose.body.store_status, 'CLOSED');
    assert.strictEqual(resClose.body.isOpen, false);
    assert.strictEqual(resClose.body.is_manual_override, true);

    const [rows] = await query('SELECT store_status, is_manual_override FROM system_settings WHERE id = 1');
    assert.strictEqual(rows[0].store_status, 'CLOSED');
    assert.strictEqual(rows[0].is_manual_override, 1);

    const reqOpen = { body: { store_status: 'OPEN' }, user: { name: 'Admin' } };
    const resOpen = mockRes();
    await settingsController.updateStoreStatus(reqOpen, resOpen);

    assert.strictEqual(resOpen.statusCode, 200);
    assert.strictEqual(resOpen.body.success, true);
    assert.strictEqual(resOpen.body.store_status, 'OPEN');
    assert.strictEqual(resOpen.body.isOpen, true);
  });

  await t.test('2. updateOperatingHoursSettings updates opening and closing times cleanly', async () => {
    await systemSettingsService.updateSystemSettings({ is_manual_override: 0, override_at: null, override_by: null });

    const req = {
      body: { store_open_time: '08:30', store_close_time: '22:00' },
      user: { name: 'Admin' }
    };
    const res = mockRes();
    await settingsController.updateOperatingHoursSettings(req, res);

    assert.strictEqual(res.statusCode, 200);
    assert.strictEqual(res.body.success, true);
    assert.strictEqual(res.body.store_open_time, '08:30:00');
    assert.strictEqual(res.body.store_close_time, '22:00:00');

    const [rows] = await query('SELECT store_open_time, store_close_time FROM system_settings WHERE id = 1');
    assert.strictEqual(rows[0].store_open_time, '08:30:00');
    assert.strictEqual(rows[0].store_close_time, '22:00:00');

    // Restore default 09:00 - 21:00
    await settingsController.updateOperatingHoursSettings(
      { body: { store_open_time: '09:00', store_close_time: '21:00' }, user: { name: 'Admin' } },
      mockRes()
    );
  });

  await t.test('3. getStoreStatus syncs store_status with schedule.isOpen when manual override is off', async () => {
    await systemSettingsService.updateSystemSettings({
      store_status: 'OPEN',
      store_open_time: '09:00:00',
      store_close_time: '21:00:00',
      is_manual_override: 0
    });

    const res = mockRes();
    await settingsController.getStoreStatus({}, res);
    assert.strictEqual(res.statusCode, 200);
    assert.strictEqual(res.body.store_status, res.body.isOpen ? 'OPEN' : 'CLOSED');
  });

  await t.test('4. database/db.js MySQL migration block defines system_settings and store_status column', () => {
    const dbJs = fs.readFileSync(path.join(__dirname, '../database/db.js'), 'utf8');
    assert.ok(dbJs.includes('CREATE TABLE IF NOT EXISTS system_settings'));
    assert.ok(dbJs.includes("column: 'store_status'"));
    assert.ok(dbJs.includes("column: 'store_open_time'"));
    assert.ok(dbJs.includes("column: 'store_close_time'"));
  });
});

