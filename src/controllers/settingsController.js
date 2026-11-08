/**
 * Settings & Integrations Controller
 * Allows Administrators to view and update system configurations like Facebook Page Access Token.
 */

const fs = require('fs');
const path = require('path');
const multer = require('multer');
const config = require('../config/config');
const storeSettingsService = require('../services/storeSettingsService');

const QR_UPLOADS_DIR = path.resolve(process.cwd(), 'public/uploads/qr');
if (!fs.existsSync(QR_UPLOADS_DIR)) {
  fs.mkdirSync(QR_UPLOADS_DIR, { recursive: true });
}

const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, QR_UPLOADS_DIR);
  },
  filename: function (req, file, cb) {
    const ext = path.extname(file.originalname).toLowerCase() || '.png';
    const safeExt = ['.png', '.jpg', '.jpeg', '.webp'].includes(ext) ? ext : '.png';
    cb(null, `gcash_qr_${Date.now()}_${Math.random().toString(36).substring(2, 8)}${safeExt}`);
  }
});

const qrUpload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB limit
  fileFilter: function (req, file, cb) {
    if (/image\/(jpeg|jpg|png|webp)/i.test(file.mimetype) || !file.mimetype) {
      cb(null, true);
    } else {
      cb(new Error('Invalid image format. Only JPG, PNG, and WebP are allowed.'));
    }
  }
});

function saveBase64Qr(dataUriOrBase64) {
  if (!dataUriOrBase64 || typeof dataUriOrBase64 !== 'string') return null;
  if (!dataUriOrBase64.startsWith('data:image/')) return dataUriOrBase64;

  try {
    const matches = dataUriOrBase64.match(/^data:image\/([a-zA-Z0-9+]+);base64,(.+)$/);
    if (!matches) return null;

    const ext = matches[1].includes('png') ? 'png' : (matches[1].includes('webp') ? 'webp' : 'jpg');
    const filename = `gcash_qr_${Date.now()}_${Math.random().toString(36).substring(2, 8)}.${ext}`;
    const filePath = path.join(QR_UPLOADS_DIR, filename);
    fs.writeFileSync(filePath, Buffer.from(matches[2], 'base64'));
    return `/uploads/qr/${filename}`;
  } catch (err) {
    console.error('[Save Base64 QR Error]', err);
    return null;
  }
}

/**
 * Helper to mask sensitive access tokens for safe UI display
 */
function maskToken(token) {
  if (!token || typeof token !== 'string') return '';
  const trimmed = token.trim();
  if (trimmed.length <= 14) return '••••••••••••••••';
  const prefix = trimmed.substring(0, 8);
  const suffix = trimmed.substring(trimmed.length - 6);
  return `${prefix}${'•'.repeat(20)}${suffix}`;
}

/**
 * Locate root .env file path
 */
function getEnvPath() {
  return path.resolve(process.cwd(), '.env');
}

/**
 * Safely update or add an environment variable key-value in .env file
 */
function updateEnvFile(key, value) {
  const envPath = getEnvPath();
  let content = '';
  if (fs.existsSync(envPath)) {
    content = fs.readFileSync(envPath, 'utf8');
  }
  const regex = new RegExp(`^${key}=.*$`, 'm');
  if (regex.test(content)) {
    content = content.replace(regex, `${key}=${value}`);
  } else {
    content = content.trimEnd() + (content ? '\n' : '') + `${key}=${value}\n`;
  }
  fs.writeFileSync(envPath, content, 'utf8');
}

/**
 * GET /api/settings/facebook
 * Retrieve current Facebook Messenger Page Access Token status & preview
 */
async function getFacebookSettings(req, res) {
  try {
    const token = (config.facebook.pageAccessToken || process.env.FB_PAGE_ACCESS_TOKEN || '').trim();
    const isConfigured = Boolean(token && token.length > 20);

    return res.json({
      success: true,
      isConfigured,
      tokenPreview: maskToken(token),
      tokenLength: token.length,
      fullToken: token, // Admin-only authorized
      verifyToken: config.facebook.verifyToken,
      appUrl: config.appUrl
    });
  } catch (err) {
    console.error('[Get FB Settings Error]', err);
    return res.status(500).json({ success: false, message: 'Failed to retrieve Facebook settings.' });
  }
}

/**
 * PUT /api/settings/facebook
 * Update Facebook Page Access Token in memory and in .env
 */
async function updateFacebookSettings(req, res) {
  try {
    const { pageAccessToken } = req.body;

    if (pageAccessToken === undefined || pageAccessToken === null) {
      return res.status(400).json({ success: false, message: 'pageAccessToken parameter is required.' });
    }

    const trimmed = String(pageAccessToken).trim();

    // Update in-memory configurations so active Messenger service immediately uses new token
    config.facebook.pageAccessToken = trimmed;
    process.env.FB_PAGE_ACCESS_TOKEN = trimmed;

    // Persist to .env file for future server restarts
    try {
      updateEnvFile('FB_PAGE_ACCESS_TOKEN', trimmed);
    } catch (fsErr) {
      console.warn('[Settings Warning] Could not persist to .env file:', fsErr.message);
    }

    return res.json({
      success: true,
      message: 'Facebook Page Access Token updated successfully.',
      isConfigured: Boolean(trimmed && trimmed.length > 20),
      tokenPreview: maskToken(trimmed),
      tokenLength: trimmed.length,
      fullToken: trimmed
    });
  } catch (err) {
    console.error('[Update FB Settings Error]', err);
    return res.status(500).json({ success: false, message: 'Failed to update Facebook Page Access Token.' });
  }
}

/**
 * POST /api/settings/facebook/test
 * Test the Page Access Token against Meta Graph API
 */
async function testFacebookToken(req, res) {
  try {
    const tokenToTest = (req.body.pageAccessToken || config.facebook.pageAccessToken || process.env.FB_PAGE_ACCESS_TOKEN || '').trim();

    if (!tokenToTest) {
      return res.status(400).json({
        success: false,
        verified: false,
        message: 'No Page Access Token provided or configured to test.'
      });
    }

    if (!tokenToTest.startsWith('EAA')) {
      return res.status(400).json({
        success: false,
        verified: false,
        message: 'Invalid token format. Facebook Page Access Tokens standardly begin with "EAA".'
      });
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 7000);

    try {
      const response = await fetch(
        `https://graph.facebook.com/v19.0/me?fields=id,name,category&access_token=${encodeURIComponent(tokenToTest)}`,
        { signal: controller.signal }
      );
      clearTimeout(timeout);

      const data = await response.json();

      if (response.ok && data.id) {
        return res.json({
          success: true,
          verified: true,
          page: {
            id: data.id,
            name: data.name,
            category: data.category || 'Facebook Page'
          },
          message: `Successfully connected to Facebook Page: "${data.name}" (Page ID: ${data.id})`
        });
      } else {
        const errorMsg = data.error?.message || 'Meta rejected the token as invalid or expired.';
        return res.status(400).json({
          success: false,
          verified: false,
          message: errorMsg
        });
      }
    } catch (networkErr) {
      clearTimeout(timeout);
      return res.status(502).json({
        success: false,
        verified: false,
        message: `Could not reach Meta Graph API (${networkErr.message}). Check your internet connection.`
      });
    }
  } catch (err) {
    console.error('[Test FB Token Error]', err);
    return res.status(500).json({ success: false, message: 'Failed to verify Facebook token.' });
  }
}

/**
 * GET /api/admin/settings/location
 * Returns current store profile, GPS coordinates, and delivery radius threshold.
 */
async function getStoreLocationSettings(req, res) {
  try {
    const settings = await storeSettingsService.getStoreSettings();
    return res.json({
      success: true,
      ...settings,
      settings
    });
  } catch (err) {
    console.error('[Get Store Location Error]', err);
    return res.status(500).json({ success: false, message: 'Failed to retrieve store location settings.' });
  }
}

/**
 * PUT /api/admin/settings/location
 * Validates and saves updated store address and GPS coordinates.
 */
async function updateStoreLocationSettings(req, res) {
  try {
    const { store_name, store_address, store_latitude, store_longitude, max_delivery_radius_km } = req.body;
    const updated = await storeSettingsService.updateStoreSettings({
      store_name,
      store_address,
      store_latitude,
      store_longitude,
      max_delivery_radius_km
    });

    return res.json({
      success: true,
      message: 'Settings updated successfully',
      ...updated,
      settings: updated
    });
  } catch (err) {
    console.error('[Update Store Location Error]', err);
    return res.status(400).json({
      success: false,
      message: err.message || 'Failed to update store location settings.'
    });
  }
}

/**
 * GET /api/store/location/public
 * Lightweight public endpoint consumed by Messenger bot and distance calculation workers.
 */
async function getPublicStoreLocation(req, res) {
  try {
    const settings = storeSettingsService.getCachedStoreSettings();
    return res.json({
      success: true,
      store_name: settings.store_name,
      store_address: settings.store_address,
      store_latitude: settings.store_latitude,
      store_longitude: settings.store_longitude,
      max_delivery_radius_km: settings.max_delivery_radius_km
    });
  } catch (err) {
    console.error('[Public Store Location Error]', err);
    return res.status(500).json({ success: false, message: 'Failed to retrieve public store location.' });
  }
}

/**
 * GET /api/admin/settings/general
 * Returns both GCash Payment credentials and Store Branch Location / Delivery data
 */
async function getGeneralSettings(req, res) {
  try {
    const settings = await storeSettingsService.getStoreSettings();
    return res.json({
      success: true,
      ...settings,
      settings,
      gcash: {
        gcash_account_name: settings.gcash_account_name || "Diner's Cafe",
        gcash_account_number: settings.gcash_account_number || "09XXXXXXXXX",
        gcash_qr_image_url: settings.gcash_qr_image_url || "/uploads/qr/gcash_qr_CHECKOUT.png"
      },
      location: {
        store_name: settings.store_name,
        store_address: settings.store_address,
        store_latitude: settings.store_latitude,
        store_longitude: settings.store_longitude,
        max_delivery_radius_km: settings.max_delivery_radius_km
      }
    });
  } catch (err) {
    console.error('[Get General Settings Error]', err);
    return res.status(500).json({ success: false, message: 'Failed to retrieve general settings.' });
  }
}

/**
 * PUT /api/admin/settings/gcash
 * Accepts multipart/form-data or JSON, handles QR code file upload,
 * and updates GCash account credentials & QR URL.
 */
async function updateGcashSettings(req, res) {
  try {
    const body = req.body || {};
    const gName = body.gcash_account_name || body.account_name || body.name;
    const gNum = body.gcash_account_number || body.account_number || body.number;
    let qrUrl = body.gcash_qr_image_url || body.qr_code_url || undefined;

    // Check if file was uploaded via multer
    if (req.file) {
      qrUrl = `/uploads/qr/${req.file.filename}`;
    } else if (req.files && req.files.length > 0) {
      qrUrl = `/uploads/qr/${req.files[0].filename}`;
    } else if (body.qr_image_base64 || (typeof qrUrl === 'string' && qrUrl.startsWith('data:image/'))) {
      const saved = saveBase64Qr(body.qr_image_base64 || qrUrl);
      if (saved) qrUrl = saved;
    }

    const payload = {
      gcash_account_name: gName,
      gcash_account_number: gNum
    };
    if (qrUrl !== undefined) {
      payload.gcash_qr_image_url = qrUrl;
    }

    const updated = await storeSettingsService.updateGcashSettings(payload);

    return res.json({
      success: true,
      message: 'GCash payment settings updated successfully',
      ...updated,
      settings: updated
    });
  } catch (err) {
    console.error('[Update GCash Settings Error]', err);
    return res.status(400).json({
      success: false,
      message: err.message || 'Failed to update GCash payment settings.'
    });
  }
}

module.exports = {
  getFacebookSettings,
  updateFacebookSettings,
  testFacebookToken,
  getStoreLocationSettings,
  updateStoreLocationSettings,
  getGeneralSettings,
  updateGcashSettings,
  getPublicStoreLocation,
  qrUpload
};
