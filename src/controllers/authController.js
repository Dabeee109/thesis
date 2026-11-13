/**
 * Authentication & Staff User Controller (FR1)
 * Manages admin, barista, and rider login, registration, and JWT token protection.
 */

const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const db = require('../../database/db');
const config = require('../config/config');

/**
 * Generate JWT Token
 */
function generateToken(user) {
  return jwt.sign(
    {
      id: user.id,
      email: user.email,
      name: user.full_name,
      role: user.role
    },
    config.jwtSecret,
    { expiresIn: '7d' }
  );
}

/**
 * Login Handler (POST /api/auth/login)
 */
async function login(req, res) {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ success: false, message: 'Email and password are required.' });
    }

    const [users] = await db.query(
      `SELECT * FROM admins_staff WHERE email = ? AND is_active = 1`,
      [email.trim().toLowerCase()]
    );

    if (users.length === 0) {
      return res.status(401).json({ success: false, message: 'Invalid email or password credentials.' });
    }

    const user = users[0];
    const isMatch = await bcrypt.compare(password, user.password_hash);

    if (!isMatch) {
      return res.status(401).json({ success: false, message: 'Invalid email or password credentials.' });
    }

    const token = generateToken(user);

    return res.json({
      success: true,
      message: 'Login successful.',
      token,
      user: {
        id: user.id,
        name: user.full_name,
        email: user.email,
        role: user.role,
        phone: user.phone_number
      }
    });
  } catch (err) {
    console.error('[Auth Login Error]', err);
    return res.status(500).json({ success: false, message: 'Internal server error during login.' });
  }
}

/**
 * Register New Staff/Rider Account (POST /api/auth/register)
 */
async function register(req, res) {
  try {
    const { fullName, email, password, role = 'staff', phoneNumber = '' } = req.body;

    if (!fullName || !email || !password) {
      return res.status(400).json({ success: false, message: 'Full name, email, and password are required.' });
    }

    // Check if email already exists
    const [existing] = await db.query(
      `SELECT id FROM admins_staff WHERE email = ?`,
      [email.trim().toLowerCase()]
    );

    if (existing.length > 0) {
      return res.status(409).json({ success: false, message: 'An account with this email already exists.' });
    }

    const salt = await bcrypt.genSalt(10);
    const passwordHash = await bcrypt.hash(password, salt);

    const [result] = await db.query(
      `INSERT INTO admins_staff (full_name, email, password_hash, role, phone_number, is_active)
       VALUES (?, ?, ?, ?, ?, 1)`,
      [fullName.trim(), email.trim().toLowerCase(), passwordHash, role, phoneNumber.trim()]
    );

    // If registered as rider, also create in delivery_personnel
    if (role === 'rider') {
      await db.query(
        `INSERT INTO delivery_personnel (user_id, full_name, phone_number, vehicle_type, status, is_active)
         VALUES (?, ?, ?, 'motorcycle', 'available', 1)`,
        [result.insertId, fullName.trim(), phoneNumber.trim()]
      );
    }

    return res.status(201).json({
      success: true,
      message: 'Account created successfully.',
      userId: result.insertId
    });
  } catch (err) {
    console.error('[Auth Register Error]', err);
    return res.status(500).json({ success: false, message: 'Failed to create account.' });
  }
}

/**
 * Current User Profile (GET /api/auth/me)
 */
async function getProfile(req, res) {
  try {
    const [users] = await db.query(
      `SELECT id, full_name, email, role, phone_number, is_active, created_at 
       FROM admins_staff WHERE id = ?`,
      [req.user.id]
    );

    if (users.length === 0) {
      return res.status(404).json({ success: false, message: 'User not found.' });
    }

    return res.json({ success: true, user: users[0] });
  } catch (err) {
    return res.status(500).json({ success: false, message: 'Server error retrieving profile.' });
  }
}

/**
 * JWT Authentication Middleware
 */
function authMiddleware(req, res, next) {
  const authHeader = req.headers.authorization;
  let token = null;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    token = authHeader.split(' ')[1];
  } else if (req.query && req.query.token) {
    token = req.query.token;
  }

  if (!token) {
    return res.status(401).json({ success: false, message: 'Authentication required. Missing Bearer token.' });
  }

  try {
    const decoded = jwt.verify(token, config.jwtSecret);
    req.user = decoded;

    // Strict Role-Based Isolation: Reject riders attempting to access admin views or reports
    const role = (decoded.role || '').toLowerCase();
    if (role === 'rider' || role === 'delivery_rider') {
      const fullPath = (req.baseUrl + req.path).toLowerCase();
      if (fullPath.includes('/admin') || fullPath.includes('/reports')) {
        return res.status(403).json({
          success: false,
          message: 'Forbidden: Delivery rider accounts cannot access administrative views or reports.'
        });
      }
    }

    next();
  } catch (err) {
    return res.status(401).json({ success: false, message: 'Invalid or expired authentication token.' });
  }
}

/**
 * Admin Role Authorization Middleware
 */
function requireAdmin(req, res, next) {
  if (!req.user || req.user.role !== 'admin') {
    return res.status(403).json({ success: false, message: 'Access denied. Administrator privileges required.' });
  }
  next();
}

/**
 * List all staff/user accounts (GET /api/auth/users) - Admin only
 */
async function getAllUsers(req, res) {
  try {
    const [users] = await db.query(
      `SELECT id, full_name, email, role, phone_number, is_active, created_at, updated_at 
       FROM admins_staff 
       ORDER BY (role = 'admin') DESC, full_name ASC`
    );

    return res.json({ success: true, count: users.length, users });
  } catch (err) {
    console.error('[Get All Users Error]', err);
    return res.status(500).json({ success: false, message: 'Failed to retrieve user accounts.' });
  }
}

/**
 * Update / Reset User Password (PUT /api/auth/users/:id/password) - Admin only
 */
async function updateUserPassword(req, res) {
  try {
    const { id } = req.params;
    const { newPassword, confirmPassword } = req.body;

    // 1. Form Validation
    if (!newPassword || typeof newPassword !== 'string') {
      return res.status(400).json({ success: false, message: 'New password is required.' });
    }

    const trimmedPassword = newPassword.trim();
    if (trimmedPassword.length < 6) {
      return res.status(400).json({ success: false, message: 'Password must be at least 6 characters long.' });
    }

    if (confirmPassword !== undefined && trimmedPassword !== confirmPassword.trim()) {
      return res.status(400).json({ success: false, message: 'New password and confirmation password do not match.' });
    }

    // 2. Verify User Exists
    const [userRows] = await db.query(
      `SELECT id, full_name, email FROM admins_staff WHERE id = ?`,
      [id]
    );

    if (userRows.length === 0) {
      return res.status(404).json({ success: false, message: `User account #${id} not found.` });
    }

    const targetUser = userRows[0];

    // 3. Password Hashing (Bcrypt)
    const salt = await bcrypt.genSalt(10);
    const passwordHash = await bcrypt.hash(trimmedPassword, salt);

    // 4. SQL UPDATE Query
    await db.query(
      `UPDATE admins_staff 
       SET password_hash = ?, updated_at = CURRENT_TIMESTAMP 
       WHERE id = ?`,
      [passwordHash, id]
    );

    return res.json({
      success: true,
      message: `Password for ${targetUser.full_name} (${targetUser.email}) was successfully updated.`,
      user: { id: targetUser.id, name: targetUser.full_name, email: targetUser.email }
    });
  } catch (err) {
    console.error('[Update Password Error]', err);
    return res.status(500).json({ success: false, message: err.message || 'Failed to update password.' });
  }
}

/**
 * Update Staff Account Details (PUT /api/auth/users/:id) - Admin only
 */
async function updateUser(req, res) {
  try {
    const { id } = req.params;
    const { fullName, email, role, phoneNumber, isActive } = req.body;

    if (!fullName || !email || !role) {
      return res.status(400).json({ success: false, message: 'Full name, email, and role are required.' });
    }

    const validRoles = ['admin', 'staff', 'rider'];
    if (!validRoles.includes(role)) {
      return res.status(400).json({ success: false, message: `Invalid role. Must be one of: ${validRoles.join(', ')}` });
    }

    // Check email uniqueness among other users
    const [existing] = await db.query(
      `SELECT id FROM admins_staff WHERE email = ? AND id != ?`,
      [email.trim().toLowerCase(), id]
    );

    if (existing.length > 0) {
      return res.status(409).json({ success: false, message: 'Another account with this email already exists.' });
    }

    await db.query(
      `UPDATE admins_staff 
       SET full_name = ?, email = ?, role = ?, phone_number = ?, is_active = ?, updated_at = CURRENT_TIMESTAMP 
       WHERE id = ?`,
      [fullName.trim(), email.trim().toLowerCase(), role, (phoneNumber || '').trim(), isActive !== undefined ? (isActive ? 1 : 0) : 1, id]
    );

    return res.json({
      success: true,
      message: `Account details for ${fullName} updated successfully.`
    });
  } catch (err) {
    console.error('[Update User Error]', err);
    return res.status(500).json({ success: false, message: 'Failed to update user details.' });
  }
}

/**
 * Toggle User Active Status (PATCH /api/auth/users/:id/toggle-status) - Admin only
 */
async function toggleUserStatus(req, res) {
  try {
    const { id } = req.params;
    const [rows] = await db.query(`SELECT id, full_name, is_active FROM admins_staff WHERE id = ?`, [id]);
    if (rows.length === 0) return res.status(404).json({ success: false, message: 'User not found.' });

    const user = rows[0];
    const newStatus = user.is_active ? 0 : 1;

    await db.query(`UPDATE admins_staff SET is_active = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`, [newStatus, id]);

    return res.json({
      success: true,
      message: `${user.full_name} is now ${newStatus ? 'Active' : 'Inactive'}.`,
      isActive: newStatus === 1
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: 'Failed to toggle account status.' });
  }
}

const crypto = require('crypto');
const axios = require('axios');

let customEmailTransport = null;
function _setEmailTransportForTest(fn) {
  customEmailTransport = fn;
}

/**
 * Send 6-Digit OTP Email via Brevo Transactional Email API (HTTPS port 443)
 */
async function sendBrevoOtpEmail({ toEmail, toName, otpCode, requestedEmail }) {
  if (typeof customEmailTransport === 'function') {
    return await customEmailTransport({ toEmail, toName, otpCode, requestedEmail });
  }

  const apiKey = (process.env.BREVO_API_KEY || config.brevo?.apiKey || '').trim();
  const senderEmail = (process.env.BREVO_SENDER_EMAIL || config.brevo?.senderEmail || 'dinerscafe109@gmail.com').trim();
  const senderName = (process.env.BREVO_SENDER_NAME || config.brevo?.senderName || "Diner's Cafe Portal").trim();

  if (!apiKey) {
    throw new Error('Brevo API key is not configured.');
  }

  const htmlContent = `
    <div style="font-family: 'Segoe UI', Arial, sans-serif; max-width: 520px; margin: 0 auto; background: #140e0a; color: #f5ebe0; border: 1px solid #3a281c; border-radius: 14px; overflow: hidden;">
      <div style="background: linear-gradient(135deg, #d4a373, #b5835a); padding: 22px 24px; text-align: center; color: #140e0a;">
        <div style="font-size: 28px; margin-bottom: 4px;">☕</div>
        <h2 style="margin: 0; font-size: 20px; font-weight: 800;">Diner's Cafe Staff Portal</h2>
        <p style="margin: 4px 0 0 0; font-size: 13px; font-weight: 600;">Password Reset Verification (OTP)</p>
      </div>
      <div style="padding: 28px 24px;">
        <p style="margin: 0 0 14px 0; font-size: 15px; color: #e6ccb2;">Hello <strong>${toName || 'Staff Member'}</strong>,</p>
        <p style="margin: 0 0 18px 0; font-size: 14px; line-height: 1.6; color: #cbb59d;">
          A password reset was requested for account <strong style="color: #f5ebe0;">${requestedEmail}</strong>. Use the 6-digit verification code below to set your new password:
        </p>
        <div style="background: #1f1610; border: 2px dashed #d4a373; border-radius: 10px; padding: 18px; text-align: center; margin: 20px 0;">
          <div style="font-size: 11px; text-transform: uppercase; letter-spacing: 1.5px; color: #b09880; margin-bottom: 6px;">Your 6-Digit OTP Code</div>
          <div style="font-size: 32px; font-weight: 800; letter-spacing: 8px; color: #d4a373; font-family: monospace;">${otpCode}</div>
        </div>
        <p style="margin: 0 0 10px 0; font-size: 13px; color: #b09880;">
          ⏳ This code is valid for <strong>10 minutes</strong>. Do not share this OTP with anyone.
        </p>
        <p style="margin: 0; font-size: 12px; color: #8c735b;">
          If you did not request a password reset, you can safely ignore this email.
        </p>
      </div>
    </div>
  `;

  const response = await axios.post(
    'https://api.brevo.com/v3/smtp/email',
    {
      sender: { name: senderName, email: senderEmail },
      to: [{ email: toEmail, name: toName || 'Diner Staff' }],
      subject: `[Diner's Cafe] Password Reset OTP: ${otpCode}`,
      htmlContent
    },
    {
      headers: {
        'accept': 'application/json',
        'api-key': apiKey,
        'content-type': 'application/json'
      },
      timeout: 15000
    }
  );

  return response.data;
}

/**
 * Request Password Reset OTP via Brevo (POST /api/auth/forgot-password/send-otp)
 */
async function requestPasswordResetOtp(req, res) {
  try {
    const rawEmail = String(req.body?.email || '').trim().toLowerCase();
    if (!rawEmail || !rawEmail.includes('@')) {
      return res.status(400).json({ success: false, message: 'Please enter a valid email address.' });
    }

    const [users] = await db.query(
      `SELECT id, full_name, email, role, is_active FROM admins_staff WHERE email = ?`,
      [rawEmail]
    );

    if (!users || users.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'No registered staff or admin account found with that email address.'
      });
    }

    const user = users[0];
    if (!user.is_active) {
      return res.status(403).json({
        success: false,
        message: 'This account is currently inactive. Please contact the administrator.'
      });
    }

    const otpCode = String(crypto.randomInt(100000, 1000000));
    const expiresAt = Date.now() + 10 * 60 * 1000; // 10 minutes

    // Mark any prior unused OTPs for this email as used
    await db.query(
      `UPDATE password_reset_otps SET used = 1 WHERE email = ? AND used = 0`,
      [rawEmail]
    ).catch(() => {});

    await db.query(
      `INSERT INTO password_reset_otps (user_id, email, otp_code, expires_at, used)
       VALUES (?, ?, ?, ?, 0)`,
      [user.id, rawEmail, otpCode, expiresAt]
    );

    // If the account uses a local demo domain (@dinerscafe.ph), deliver the OTP to the verified Brevo inbox (dinerscafe109@gmail.com)
    const fallbackInbox = (process.env.BREVO_SENDER_EMAIL || config.brevo?.senderEmail || 'dinerscafe109@gmail.com').trim().toLowerCase();
    const deliveryEmail = rawEmail.endsWith('@dinerscafe.ph') ? fallbackInbox : rawEmail;

    await sendBrevoOtpEmail({
      toEmail: deliveryEmail,
      toName: user.full_name,
      otpCode,
      requestedEmail: rawEmail
    });

    return res.json({
      success: true,
      message: `A 6-digit OTP code has been sent to ${deliveryEmail}. It is valid for 10 minutes.`,
      deliveredTo: deliveryEmail
    });
  } catch (err) {
    console.error('[Forgot Password Send OTP Error]', err?.response?.data || err.message);
    const apiErrMsg = err?.response?.data?.message || err.message || 'Failed to send OTP email via Brevo.';
    return res.status(500).json({
      success: false,
      message: `Failed to send OTP email: ${apiErrMsg}`
    });
  }
}

/**
 * Verify OTP & Reset Password (POST /api/auth/forgot-password/reset)
 */
async function resetPasswordWithOtp(req, res) {
  try {
    const rawEmail = String(req.body?.email || '').trim().toLowerCase();
    const rawOtp = String(req.body?.otp || '').trim();
    const newPassword = String(req.body?.newPassword || '').trim();
    const confirmPassword = req.body?.confirmPassword !== undefined ? String(req.body.confirmPassword).trim() : newPassword;

    if (!rawEmail || !rawOtp || !newPassword) {
      return res.status(400).json({
        success: false,
        message: 'Email, 6-digit OTP code, and new password are required.'
      });
    }

    if (!/^\d{6}$/.test(rawOtp)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid OTP format. Please enter the 6-digit numeric code.'
      });
    }

    if (newPassword.length < 6) {
      return res.status(400).json({
        success: false,
        message: 'New password must be at least 6 characters long.'
      });
    }

    if (newPassword !== confirmPassword) {
      return res.status(400).json({
        success: false,
        message: 'New password and confirmation password do not match.'
      });
    }

    const [otpRows] = await db.query(
      `SELECT * FROM password_reset_otps WHERE email = ? AND used = 0 ORDER BY id DESC LIMIT 1`,
      [rawEmail]
    );

    if (!otpRows || otpRows.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'No active OTP found for this email. Please request a new OTP code.'
      });
    }

    const latestOtp = otpRows[0];
    if (String(latestOtp.otp_code).trim() !== rawOtp) {
      return res.status(400).json({
        success: false,
        message: 'Incorrect OTP code. Please check your email and try again.'
      });
    }

    if (Number(latestOtp.expires_at) < Date.now()) {
      await db.query(`UPDATE password_reset_otps SET used = 1 WHERE id = ?`, [latestOtp.id]).catch(() => {});
      return res.status(400).json({
        success: false,
        message: 'This OTP code has expired. Please request a new OTP code.'
      });
    }

    const salt = await bcrypt.genSalt(10);
    const passwordHash = await bcrypt.hash(newPassword, salt);

    await db.query(
      `UPDATE admins_staff SET password_hash = ?, updated_at = CURRENT_TIMESTAMP WHERE email = ?`,
      [passwordHash, rawEmail]
    );

    await db.query(
      `UPDATE password_reset_otps SET used = 1 WHERE id = ?`,
      [latestOtp.id]
    );

    return res.json({
      success: true,
      message: 'Your password has been reset successfully! You may now sign in.'
    });
  } catch (err) {
    console.error('[Reset Password With OTP Error]', err);
    return res.status(500).json({
      success: false,
      message: err.message || 'Failed to reset password.'
    });
  }
}

module.exports = {
  login,
  register,
  getProfile,
  authMiddleware,
  requireAdmin,
  getAllUsers,
  updateUserPassword,
  updateUser,
  toggleUserStatus,
  requestPasswordResetOtp,
  resetPasswordWithOtp,
  _setEmailTransportForTest
};
