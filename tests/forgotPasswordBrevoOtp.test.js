const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fs = require('fs');

const testDbPath = path.join(__dirname, 'test_forgot_password_otp.sqlite');
if (fs.existsSync(testDbPath)) {
  try { fs.unlinkSync(testDbPath); } catch (_) {}
}

process.env.DB_FORCE_SQLITE = '1';
process.env.SQLITE_PATH = testDbPath;
process.env.NODE_ENV = 'test';

const db = require('../database/db');
const authController = require('../src/controllers/authController');

function createMockRes() {
  return {
    statusCode: 200,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    }
  };
}

test('Forgot Password + Brevo Email OTP Suite', async (t) => {
  await db.initDatabase();

  const capturedEmails = [];
  authController._setEmailTransportForTest(async (payload) => {
    capturedEmails.push(payload);
    return { messageId: `<test.${Date.now()}@brevo.com>` };
  });

  await t.test('1. Legitimate Admin account (dinerscafe109@gmail.com) is seeded and can log in', async () => {
    const res = createMockRes();
    await authController.login(
      { body: { email: 'dinerscafe109@gmail.com', password: 'password123' } },
      res
    );
    assert.strictEqual(res.statusCode, 200);
    assert.strictEqual(res.body.success, true);
    assert.strictEqual(res.body.user.email, 'dinerscafe109@gmail.com');
    assert.strictEqual(res.body.user.role, 'admin');
  });

  await t.test('2. Send OTP generates 6-digit code and dispatches email to dinerscafe109@gmail.com', async () => {
    capturedEmails.length = 0;
    const res = createMockRes();
    await authController.requestPasswordResetOtp(
      { body: { email: 'dinerscafe109@gmail.com' } },
      res
    );

    assert.strictEqual(res.statusCode, 200);
    assert.strictEqual(res.body.success, true);
    assert.strictEqual(res.body.deliveredTo, 'dinerscafe109@gmail.com');
    assert.strictEqual(capturedEmails.length, 1);
    assert.strictEqual(capturedEmails[0].toEmail, 'dinerscafe109@gmail.com');
    assert.match(capturedEmails[0].otpCode, /^\d{6}$/);
  });

  await t.test('3. Reset Password with valid 6-digit OTP updates password and allows login with new password', async () => {
    const otpCode = capturedEmails[0].otpCode;

    // Wrong OTP should fail
    const wrongRes = createMockRes();
    await authController.resetPasswordWithOtp(
      {
        body: {
          email: 'dinerscafe109@gmail.com',
          otp: '000000',
          newPassword: 'newpassword456',
          confirmPassword: 'newpassword456'
        }
      },
      wrongRes
    );
    assert.strictEqual(wrongRes.statusCode, 400);
    assert.strictEqual(wrongRes.body.success, false);

    // Valid OTP should succeed
    const okRes = createMockRes();
    await authController.resetPasswordWithOtp(
      {
        body: {
          email: 'dinerscafe109@gmail.com',
          otp: otpCode,
          newPassword: 'newpassword456',
          confirmPassword: 'newpassword456'
        }
      },
      okRes
    );
    assert.strictEqual(okRes.statusCode, 200);
    assert.strictEqual(okRes.body.success, true);

    // Login with new password succeeds
    const loginRes = createMockRes();
    await authController.login(
      { body: { email: 'dinerscafe109@gmail.com', password: 'newpassword456' } },
      loginRes
    );
    assert.strictEqual(loginRes.statusCode, 200);
    assert.strictEqual(loginRes.body.success, true);
  });

  await t.test('4. Login page UI contains Forgot Password link, 2-step OTP modal, and dinerscafe109@gmail.com', () => {
    const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'login.html'), 'utf8');
    assert.ok(html.includes('openForgotPasswordModal()'));
    assert.ok(html.includes('forgot-password-modal'));
    assert.ok(html.includes('/auth/forgot-password/send-otp'));
    assert.ok(html.includes('/auth/forgot-password/reset'));
    assert.ok(html.includes('dinerscafe109@gmail.com'));
  });
});
