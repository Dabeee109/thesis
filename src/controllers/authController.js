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
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ success: false, message: 'Authentication required. Missing Bearer token.' });
  }

  const token = authHeader.split(' ')[1];
  try {
    const decoded = jwt.verify(token, config.jwtSecret);
    req.user = decoded;
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

module.exports = {
  login,
  register,
  getProfile,
  authMiddleware,
  requireAdmin,
  getAllUsers,
  updateUserPassword,
  updateUser,
  toggleUserStatus
};
