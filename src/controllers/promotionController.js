/**
 * Promotions & Events Controller
 * Handles Promotion / Event CRUD, poster photo uploads, and throttled Messenger mass broadcasts.
 */

const fs = require('fs');
const path = require('path');
const db = require('../../database/db');
const config = require('../config/config');
const messengerService = require('../services/messengerService');
const { broadcastSSE } = require('../services/notificationService');

const PROMO_UPLOADS_DIR = path.join(__dirname, '../../public/uploads/promotions');
if (!fs.existsSync(PROMO_UPLOADS_DIR)) {
  fs.mkdirSync(PROMO_UPLOADS_DIR, { recursive: true });
}

/**
 * Safely extract and save base64 poster data to disk, returning clean relative URL
 */
function saveBase64Poster(dataUriOrBase64, promoId = 'new') {
  if (!dataUriOrBase64 || typeof dataUriOrBase64 !== 'string') return null;
  if (!dataUriOrBase64.startsWith('data:image/')) return dataUriOrBase64;

  try {
    const matches = dataUriOrBase64.match(/^data:image\/([a-zA-Z0-9+]+);base64,(.+)$/);
    if (!matches) return null;

    const ext = matches[1].includes('png') ? 'png' : (matches[1].includes('webp') ? 'webp' : 'jpg');
    const filename = `promo_${promoId}_${Date.now()}_${Math.random().toString(36).substring(2, 6)}.${ext}`;
    const filePath = path.join(PROMO_UPLOADS_DIR, filename);
    fs.writeFileSync(filePath, Buffer.from(matches[2], 'base64'));
    return `/uploads/promotions/${filename}`;
  } catch (err) {
    console.error('[Save Base64 Poster Error]', err);
    return null;
  }
}

/**
 * Get all promotions and events with computed status (ACTIVE, UPCOMING, EXPIRED, INACTIVE)
 */
async function getPromotions(req, res) {
  try {
    const [promotions] = await db.query(`
      SELECT * FROM promotions 
      ORDER BY is_active DESC, created_at DESC
    `);

    const now = new Date();
    const todayStr = now.toISOString().split('T')[0];

    const enriched = (promotions || []).map(p => {
      let status = 'ACTIVE';
      if (!p.is_active || p.is_active === 0) {
        status = 'INACTIVE';
      } else if (p.start_date && p.start_date > todayStr) {
        status = 'UPCOMING';
      } else if (p.end_date && p.end_date < todayStr) {
        status = 'EXPIRED';
      } else {
        status = 'ACTIVE';
      }

      return {
        ...p,
        status,
        date_range_display: p.start_date && p.end_date 
          ? `${p.start_date} to ${p.end_date}` 
          : (p.start_date || p.end_date || 'Always Valid')
      };
    });

    return res.json({
      success: true,
      count: enriched.length,
      promotions: enriched
    });
  } catch (err) {
    console.error('[Get Promotions Error]', err);
    return res.status(500).json({ success: false, message: 'Failed to retrieve promotions.' });
  }
}

/**
 * Get single promotion by ID
 */
async function getPromotionById(req, res) {
  try {
    const { id } = req.params;
    const [rows] = await db.query('SELECT * FROM promotions WHERE id = ?', [id]);
    if (!rows || rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Promotion not found.' });
    }
    return res.json({ success: true, promotion: rows[0] });
  } catch (err) {
    console.error('[Get Promotion Error]', err);
    return res.status(500).json({ success: false, message: 'Failed to fetch promotion.' });
  }
}

/**
 * Create a new Promotion or Event
 */
async function createPromotion(req, res) {
  try {
    const {
      title,
      promo_type,
      banner_image_url,
      perk_description,
      applicable_scope,
      start_date,
      end_date,
      description,
      is_active
    } = req.body;

    if (!title || !title.trim()) {
      return res.status(400).json({ success: false, message: 'Promotion title is required.' });
    }
    if (!perk_description || !perk_description.trim()) {
      return res.status(400).json({ success: false, message: 'Mechanics / Perk description is required.' });
    }

    const type = promo_type || 'Product Discount';
    const scope = applicable_scope && applicable_scope.trim() ? applicable_scope.trim() : 'All Menu Items';
    const active = (is_active === 0 || is_active === false || is_active === '0') ? 0 : 1;
    const cleanBannerUrl = saveBase64Poster(banner_image_url, 'new');

    const [result] = await db.query(`
      INSERT INTO promotions (
        title, promo_type, banner_image_url, perk_description,
        applicable_scope, start_date, end_date, description, is_active
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      title.trim(),
      type,
      cleanBannerUrl || null,
      perk_description.trim(),
      scope,
      start_date || null,
      end_date || null,
      description || null,
      active
    ]);

    broadcastSSE('PROMOTIONS_UPDATED', { action: 'create', promoId: result.insertId });

    return res.status(201).json({
      success: true,
      message: 'Promotion / Event successfully created.',
      promotionId: result.insertId
    });
  } catch (err) {
    console.error('[Create Promotion Error]', err);
    return res.status(500).json({ success: false, message: err.message || 'Failed to create promotion.' });
  }
}

/**
 * Update existing Promotion or Event
 */
async function updatePromotion(req, res) {
  try {
    const { id } = req.params;
    const {
      title,
      promo_type,
      banner_image_url,
      perk_description,
      applicable_scope,
      start_date,
      end_date,
      description,
      is_active
    } = req.body;

    const [existing] = await db.query('SELECT * FROM promotions WHERE id = ?', [id]);
    if (!existing || existing.length === 0) {
      return res.status(404).json({ success: false, message: 'Promotion not found.' });
    }

    const cur = existing[0];
    const newTitle = title !== undefined ? title.trim() : cur.title;
    const newType = promo_type !== undefined ? promo_type : cur.promo_type;
    const rawBanner = banner_image_url !== undefined ? banner_image_url : cur.banner_image_url;
    const newBanner = saveBase64Poster(rawBanner, id);
    const newPerk = perk_description !== undefined ? perk_description.trim() : cur.perk_description;
    const newScope = applicable_scope !== undefined ? applicable_scope.trim() : cur.applicable_scope;
    const newStart = start_date !== undefined ? start_date : cur.start_date;
    const newEnd = end_date !== undefined ? end_date : cur.end_date;
    const newDesc = description !== undefined ? description : cur.description;
    const newActive = is_active !== undefined ? (is_active ? 1 : 0) : cur.is_active;

    await db.query(`
      UPDATE promotions SET 
        title = ?,
        promo_type = ?,
        banner_image_url = ?,
        perk_description = ?,
        applicable_scope = ?,
        start_date = ?,
        end_date = ?,
        description = ?,
        is_active = ?,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `, [
      newTitle, newType, newBanner, newPerk, newScope,
      newStart, newEnd, newDesc, newActive, id
    ]);

    broadcastSSE('PROMOTIONS_UPDATED', { action: 'update', promoId: id });

    return res.json({
      success: true,
      message: 'Promotion updated successfully.'
    });
  } catch (err) {
    console.error('[Update Promotion Error]', err);
    return res.status(500).json({ success: false, message: 'Failed to update promotion.' });
  }
}

/**
 * Toggle Active / Inactive Status
 */
async function togglePromotionStatus(req, res) {
  try {
    const { id } = req.params;
    const [rows] = await db.query('SELECT id, is_active FROM promotions WHERE id = ?', [id]);
    if (!rows || rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Promotion not found.' });
    }

    const newStatus = rows[0].is_active ? 0 : 1;
    await db.query('UPDATE promotions SET is_active = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?', [newStatus, id]);

    broadcastSSE('PROMOTIONS_UPDATED', { action: 'toggle', promoId: id, is_active: newStatus });

    return res.json({
      success: true,
      message: `Promotion marked as ${newStatus ? 'Active' : 'Inactive'}.`,
      is_active: newStatus
    });
  } catch (err) {
    console.error('[Toggle Promotion Status Error]', err);
    return res.status(500).json({ success: false, message: 'Failed to toggle status.' });
  }
}

/**
 * Delete Promotion
 */
async function deletePromotion(req, res) {
  try {
    const { id } = req.params;
    await db.query('DELETE FROM promotions WHERE id = ?', [id]);
    broadcastSSE('PROMOTIONS_UPDATED', { action: 'delete', promoId: id });
    return res.json({ success: true, message: 'Promotion deleted successfully.' });
  } catch (err) {
    console.error('[Delete Promotion Error]', err);
    return res.status(500).json({ success: false, message: 'Failed to delete promotion.' });
  }
}

/**
 * Upload Poster / Banner Image (Requirement 2)
 * Supports JPG, PNG, and WebP up to 5MB
 */
async function uploadPromotionPoster(req, res) {
  try {
    const { imageBase64 } = req.body;
    if (!imageBase64) {
      return res.status(400).json({ success: false, message: 'Image data is required.' });
    }

    const matches = imageBase64.match(/^data:([A-Za-z-+\/]+);base64,(.+)$/);
    let ext = 'jpg';
    let buffer;

    if (matches && matches.length === 3) {
      const mime = matches[1].toLowerCase();
      if (!mime.includes('jpeg') && !mime.includes('jpg') && !mime.includes('png') && !mime.includes('webp')) {
        return res.status(400).json({
          success: false,
          message: 'Invalid file format. Please upload JPG, PNG, or WebP only.'
        });
      }

      if (mime.includes('png')) ext = 'png';
      else if (mime.includes('webp')) ext = 'webp';
      else ext = 'jpg';

      buffer = Buffer.from(matches[2], 'base64');
    } else {
      buffer = Buffer.from(imageBase64, 'base64');
    }

    // 5MB limit check (5 * 1024 * 1024 bytes)
    if (buffer.length > 5 * 1024 * 1024) {
      return res.status(400).json({
        success: false,
        message: 'File size exceeds maximum 5MB limit.'
      });
    }

    const filename = `promo_${Date.now()}_${Math.random().toString(36).substring(2, 8)}.${ext}`;
    const filePath = path.join(PROMO_UPLOADS_DIR, filename);
    fs.writeFileSync(filePath, buffer);

    const imageUrl = `/uploads/promotions/${filename}`;
    return res.json({
      success: true,
      imageUrl,
      message: 'Poster uploaded successfully.'
    });
  } catch (err) {
    console.error('[Upload Promotion Poster Error]', err);
    return res.status(500).json({ success: false, message: 'Failed to upload event poster.' });
  }
}

/**
 * Get Count of Unique Customer Messenger PSIDs
 */
async function getBroadcastRecipientsCount(req, res) {
  try {
    const [rows] = await db.query(`
      SELECT COUNT(DISTINCT psid) AS total_recipients
      FROM customers
      WHERE psid IS NOT NULL 
        AND psid != '' 
        AND psid NOT LIKE 'POS_MANUAL_%'
    `);
    const count = (rows && rows[0] && rows[0].total_recipients) || 0;
    return res.json({ success: true, count });
  } catch (err) {
    console.error('[Recipients Count Error]', err);
    return res.status(500).json({ success: false, message: 'Failed to count broadcast recipients.' });
  }
}

/**
 * Messenger Mass Broadcast Engine (Requirement 4)
 * Rate-limited sequential throttled queue (50ms–100ms delay per user)
 */
async function broadcastPromotion(req, res) {
  try {
    const { id } = req.params;
    const [promoRows] = await db.query('SELECT * FROM promotions WHERE id = ?', [id]);
    if (!promoRows || promoRows.length === 0) {
      return res.status(404).json({ success: false, message: 'Promotion not found.' });
    }

    const promo = promoRows[0];

    // 1. Fetch unique customer PSIDs
    const [customers] = await db.query(`
      SELECT DISTINCT psid, first_name 
      FROM customers 
      WHERE psid IS NOT NULL 
        AND psid != '' 
        AND psid NOT LIKE 'POS_MANUAL_%'
    `);

    const recipients = (customers || []).map(c => c.psid).filter(Boolean);

    if (recipients.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'No active Facebook Messenger customer recipients found in database.'
      });
    }

    // Schedule / Date formatting
    const scheduleText = promo.start_date && promo.end_date
      ? `${promo.start_date} to ${promo.end_date}`
      : (promo.start_date || promo.end_date || 'Ongoing Promo');

    // Message 2: Exact text format specified in Requirement 4
    const announcementText = `📢 SPECIAL EVENT ANNOUNCEMENT!

${promo.title}
📅 Petsa: ${scheduleText}

${promo.description || promo.perk_description}

Bisitahin kami sa Diner's Cafe o mag-reply lang dito para mag-order!`;

    // 1. Prepare poster attachment (pre-upload to Meta once for reliable, instant delivery)
    let posterAttachmentId = null;
    let fallbackPosterUrl = null;

    if (promo.banner_image_url) {
      // If it's a data URI, ensure it is persisted to disk and updated in the DB
      if (promo.banner_image_url.startsWith('data:image/')) {
        const cleanedUrl = saveBase64Poster(promo.banner_image_url, promo.id);
        if (cleanedUrl) {
          promo.banner_image_url = cleanedUrl;
          await db.query('UPDATE promotions SET banner_image_url = ? WHERE id = ?', [cleanedUrl, promo.id]);
        }
      }

      // Pre-upload attachment to Meta Attachment Upload API once
      try {
        posterAttachmentId = await messengerService.uploadAttachment(promo.banner_image_url, 'image');
        if (posterAttachmentId) {
          console.log(`[Broadcast] Poster uploaded to Meta CDN successfully. Attachment ID: ${posterAttachmentId}`);
        }
      } catch (uploadErr) {
        console.warn('[Broadcast] Meta attachment pre-upload error:', uploadErr.message);
      }

      // If upload didn't return an attachment_id, prepare public fallback URL
      if (!posterAttachmentId) {
        if (promo.banner_image_url.startsWith('http://') || promo.banner_image_url.startsWith('https://')) {
          fallbackPosterUrl = promo.banner_image_url;
        } else {
          const headers = req.headers || {};
          const host = headers['x-forwarded-host'] || (typeof req.get === 'function' ? req.get('host') : headers['host']);
          const proto = headers['x-forwarded-proto'] || req.protocol || 'https';
          const baseUrl = host ? `${proto}://${host}` : (config.appUrl || 'http://localhost:3000').replace(/\/+$/, '');
          const cleanPath = promo.banner_image_url.startsWith('/') ? promo.banner_image_url : `/${promo.banner_image_url}`;
          fallbackPosterUrl = `${baseUrl}${cleanPath}`;
        }
      }
    }

    // 2. Sequential Throttled Queue (75ms delay between users)
    let sentCount = 0;
    let failedCount = 0;

    for (let i = 0; i < recipients.length; i++) {
      const psid = recipients[i];

      try {
        // Message 1: Image attachment (if poster exists)
        if (posterAttachmentId) {
          await messengerService.sendImageAttachment(psid, { attachment_id: posterAttachmentId }, { throwOnError: false }).catch(err => {
            console.warn(`[Broadcast] Poster attachment dispatch failed for PSID ${psid}:`, err.message);
          });
        } else if (fallbackPosterUrl) {
          await messengerService.sendImageAttachment(psid, fallbackPosterUrl, { throwOnError: false }).catch(err => {
            console.warn(`[Broadcast] Poster URL dispatch failed for PSID ${psid}:`, err.message);
          });
        }

        // Message 2: Text Announcement
        await messengerService.sendTextMessage(psid, announcementText);
        sentCount++;
      } catch (sendErr) {
        console.warn(`[Broadcast] Text dispatch failed for PSID ${psid}:`, sendErr.message);
        failedCount++;
      }

      // Real-time progress broadcast via SSE
      broadcastSSE('PROMOTION_BROADCAST_PROGRESS', {
        promoId: id,
        current: i + 1,
        total: recipients.length,
        percentage: Math.round(((i + 1) / recipients.length) * 100)
      });

      // Throttling delay: 75ms (within 50ms - 100ms window)
      if (i < recipients.length - 1) {
        await new Promise(resolve => setTimeout(resolve, 75));
      }
    }

    // 3. Update broadcast statistics
    await db.query(`
      UPDATE promotions 
      SET broadcast_count = COALESCE(broadcast_count, 0) + 1,
          last_broadcast_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `, [id]);

    broadcastSSE('PROMOTION_BROADCAST_COMPLETED', {
      promoId: id,
      totalRecipients: recipients.length,
      sentCount,
      failedCount
    });

    return res.json({
      success: true,
      message: `Broadcast successfully dispatched to ${sentCount} customer(s).`,
      totalRecipients: recipients.length,
      sentCount,
      failedCount
    });
  } catch (err) {
    console.error('[Broadcast Promotion Error]', err);
    return res.status(500).json({ success: false, message: 'Failed to broadcast promotion.' });
  }
}

/**
 * Query active promotions for today
 */
async function getActivePromotionsList() {
  const now = new Date();
  const todayStr = now.toISOString().split('T')[0];
  const [rows] = await db.query(`
    SELECT * FROM promotions 
    WHERE is_active = 1 
      AND (start_date IS NULL OR start_date <= ?)
      AND (end_date IS NULL OR end_date >= ?)
    ORDER BY created_at DESC
  `, [todayStr, todayStr]);
  return rows || [];
}

/**
 * Get active promotions endpoint
 * GET /api/promotions/active
 */
async function getActivePromotions(req, res) {
  try {
    const active = await getActivePromotionsList();
    return res.json({ success: true, count: active.length, promotions: active });
  } catch (err) {
    console.error('[Get Active Promotions Error]', err);
    return res.status(500).json({ success: false, message: 'Failed to retrieve active promotions.' });
  }
}

module.exports = {
  getPromotions,
  getActivePromotions,
  getActivePromotionsList,
  getPromotionById,
  createPromotion,
  updatePromotion,
  togglePromotionStatus,
  deletePromotion,
  uploadPromotionPoster,
  getBroadcastRecipientsCount,
  broadcastPromotion
};

