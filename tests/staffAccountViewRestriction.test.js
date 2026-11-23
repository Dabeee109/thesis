const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const jwt = require('jsonwebtoken');
const config = require('../src/config/config');
const authController = require('../src/controllers/authController');

test('Staff Account View Restrictions (Settings & Accounts)', async (t) => {
  await t.test('1. HTML markup has btn-add-staff-container and users-table-thead with role toggles', () => {
    const html = fs.readFileSync(path.join(__dirname, '../public/dashboard.html'), 'utf8');
    assert.ok(html.includes('id="btn-add-staff-container"'), 'Should have btn-add-staff-container');
    assert.ok(html.includes('id="btn-add-staff"'), 'Should have btn-add-staff');
    assert.ok(html.includes('id="users-table-thead"'), 'Should have users-table-thead');
  });

  await t.test('2. dashboard.js enforces role-based column rendering and button hiding for staff', () => {
    const js = fs.readFileSync(path.join(__dirname, '../public/js/dashboard.js'), 'utf8');
    assert.ok(js.includes("addBtnContainer.style.display = isAdmin ? 'block' : 'none'"));
    assert.ok(js.includes('/auth/directory'), 'Staff should fetch safe directory endpoint');
    assert.ok(js.includes('User / Staff'));
    assert.ok(js.includes('Role'));
    assert.ok(js.includes('Status'));
  });

  await t.test('3. GET /api/auth/directory returns safe non-sensitive fields (id, full_name, role, is_active)', async () => {
    const req = {
      user: { id: 2, role: 'staff', email: 'staff@dinerscafe.ph' }
    };
    let jsonResult = null;
    let statusCode = 200;
    const res = {
      status(code) { statusCode = code; return this; },
      json(data) { jsonResult = data; return this; }
    };

    await authController.getStaffDirectory(req, res);
    assert.strictEqual(statusCode, 200);
    assert.strictEqual(jsonResult.success, true);
    assert.ok(Array.isArray(jsonResult.users));
    assert.ok(jsonResult.users.length > 0);

    const first = jsonResult.users[0];
    assert.ok(first.full_name !== undefined, 'full_name must exist');
    assert.ok(first.role !== undefined, 'role must exist');
    assert.ok(first.is_active !== undefined, 'is_active must exist');
    assert.strictEqual(first.email, undefined, 'email must NOT be exposed in staff directory');
    assert.strictEqual(first.phone_number, undefined, 'phone_number must NOT be exposed in staff directory');
    assert.strictEqual(first.password_hash, undefined, 'password_hash must NOT be exposed in staff directory');
  });
});
