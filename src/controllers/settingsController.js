/**
 * Settings & Integrations Controller
 * Allows Administrators to view and update system configurations like Facebook Page Access Token.
 */

const fs = require('fs');
const path = require('path');
const config = require('../config/config');

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

module.exports = {
  getFacebookSettings,
  updateFacebookSettings,
  testFacebookToken
};
