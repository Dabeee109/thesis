/**
 * Categorized Plain-Text Menu Formatter & Unicode Strikethrough Service
 *
 * Replaces image-heavy Messenger Generic Template carousels with fast-loading
 * categorized plain-text menu blocks, showing Out-of-Stock items using Unicode
 * combining strikethrough characters (\u0336) and splitting cleanly under 2,000 chars.
 */

const MAX_MESSENGER_TEXT_LENGTH = 1900; // Safe margin below Facebook Messenger's 2,000-char limit

const MENU_FOOTER_GUIDANCE =
  '💡 Para mag-order, i-type lamang po ang pangalan ng item at dami (halimbawa: "1 Meaty Dog, 1 Lychee Fruit Tea").';

/**
 * Convert plain text into Unicode combining strikethrough characters (\u0336).
 * @param {string} text
 * @returns {string}
 */
function applyStrikethrough(text) {
  return String(text || '')
    .split('')
    .map(char => char + '\u0336')
    .join('');
}

/**
 * Determine whether a category belongs to Drinks/Beverages vs Food.
 * @param {string} categoryName
 * @param {string} [categorySlug]
 * @returns {boolean}
 */
function isDrinkCategory(categoryName, categorySlug = '') {
  const combined = `${categoryName || ''} ${categorySlug || ''}`;
  return /drink|milktea|milk\s*tea|coffee|espresso|tea|frappe|beverage|latte|yakult|chocolate|refresh/i.test(combined);
}

/**
 * Format a single menu item bullet line with stock availability and strikethrough.
 * @param {Object} item
 * @returns {string}
 */
function formatMenuItemLine(item) {
  const name = String(item.name || 'Item').trim();
  const priceStr = `₱${Number(item.price || 0).toFixed(2)}`;
  const stockQty = Number(item.stock ?? item.stock_quantity ?? 0);
  const isAvailable = Number(item.is_available) === 1 && stockQty > 0;
  const label = `${name} - ${priceStr}`;

  if (isAvailable) {
    return `• ${label}`;
  }
  return `• ${applyStrikethrough(label)} (Out of Stock)`;
}

/**
 * Filter items by view mode ('all' | 'drinks' | 'food').
 * @param {Array<Object>} items
 * @param {string} [view='all']
 * @returns {Array<Object>}
 */
function filterMenuItemsByView(items = [], view = 'all') {
  const normalizedView = String(view || 'all').toLowerCase().trim();
  if (normalizedView === 'drinks') {
    return items.filter(it => isDrinkCategory(it.category_name, it.category_slug));
  }
  if (normalizedView === 'food') {
    return items.filter(it => !isDrinkCategory(it.category_name, it.category_slug));
  }
  return items;
}

/**
 * Group ordered menu items into category sections while preserving sort order.
 * @param {Array<Object>} items
 * @returns {Array<{ categoryName: string, lines: string[] }>}
 */
function groupItemsByCategory(items = []) {
  const groups = [];
  const groupMap = new Map();

  for (const item of items) {
    const categoryName = String(item.category_name || 'Other Items').trim();
    if (!groupMap.has(categoryName)) {
      const entry = { categoryName, lines: [] };
      groupMap.set(categoryName, entry);
      groups.push(entry);
    }
    groupMap.get(categoryName).lines.push(formatMenuItemLine(item));
  }

  return groups;
}

/**
 * Build category text blocks, automatically splitting oversized single categories
 * if a single category ever exceeds maxLen.
 */
function buildCategoryBlocks(groups, maxLen = MAX_MESSENGER_TEXT_LENGTH) {
  const blocks = [];

  for (const group of groups) {
    const header = `--- ${group.categoryName.toUpperCase()} ---`;
    const fullBlock = `${header}\n${group.lines.join('\n')}`;

    if (fullBlock.length <= maxLen) {
      blocks.push(fullBlock);
      continue;
    }

    // Split a very large single category cleanly across consecutive blocks
    let currentLines = [header];
    let currentLen = header.length;

    for (const line of group.lines) {
      if (currentLen + 1 + line.length > maxLen && currentLines.length > 1) {
        blocks.push(currentLines.join('\n'));
        const contHeader = `--- ${group.categoryName.toUpperCase()} (cont.) ---`;
        currentLines = [contHeader, line];
        currentLen = contHeader.length + 1 + line.length;
      } else {
        currentLines.push(line);
        currentLen += 1 + line.length;
      }
    }

    if (currentLines.length > 0) {
      blocks.push(currentLines.join('\n'));
    }
  }

  return blocks;
}

/**
 * Build paginated text messages (each <= maxLen characters) + Quick Replies for Messenger.
 *
 * @param {Array<Object>} items
 * @param {Object} [options]
 * @param {string} [options.view='all'] - 'all' | 'drinks' | 'food'
 * @param {boolean} [options.hasCart=false]
 * @param {number} [options.maxLength=1900]
 * @returns {{ messages: string[], quickReplies: Array<{ title: string, payload: string }> }}
 */
function buildTextMenuPayload(items = [], options = {}) {
  const view = String(options.view || 'all').toLowerCase().trim();
  const hasCart = Boolean(options.hasCart);
  const maxLen = options.maxLength || MAX_MESSENGER_TEXT_LENGTH;

  const filtered = filterMenuItemsByView(items, view);
  const groups = groupItemsByCategory(filtered);

  const menuTitle = view === 'drinks'
    ? "🥤 DINER'S CAFE DRINKS MENU 🥤"
    : view === 'food'
      ? "🍽️ DINER'S CAFE FOOD MENU 🍽️"
      : "📋 DINER'S CAFE MENU 📋";

  const blocks = buildCategoryBlocks(groups, maxLen - menuTitle.length - 4);
  const messages = [];

  if (blocks.length === 0) {
    messages.push(`${menuTitle}\n\nWala pang available items sa kategoryang ito sa ngayon.`);
  } else {
    let currentBuffer = menuTitle;

    for (const block of blocks) {
      const candidate = `${currentBuffer}\n\n${block}`;
      if (candidate.length <= maxLen) {
        currentBuffer = candidate;
      } else {
        if (currentBuffer.trim()) {
          messages.push(currentBuffer);
        }
        currentBuffer = block;
      }
    }

    if (currentBuffer.trim()) {
      messages.push(currentBuffer);
    }

    // Attach guidance footer to the final message if it fits cleanly; otherwise append as last bubble
    const lastIdx = messages.length - 1;
    const withFooter = `${messages[lastIdx]}\n\n${MENU_FOOTER_GUIDANCE}`;
    if (withFooter.length <= maxLen) {
      messages[lastIdx] = withFooter;
    } else {
      messages.push(MENU_FOOTER_GUIDANCE);
    }
  }

  const quickReplies = [];
  if (view !== 'drinks') {
    quickReplies.push({ title: '🥤 View Drinks', payload: 'VIEW_DRINKS' });
  }
  if (view !== 'food') {
    quickReplies.push({ title: '🍔 View Food', payload: 'VIEW_FOOD' });
  }
  if (view !== 'all') {
    quickReplies.push({ title: '📋 Full Menu', payload: 'MENU_HOME' });
  }
  quickReplies.push({ title: '🛒 My Cart', payload: 'VIEW_CART' });
  if (hasCart) {
    quickReplies.push({ title: 'Checkout', payload: 'CONFIRM_CHECKOUT' });
  }

  return {
    messages,
    quickReplies
  };
}

module.exports = {
  applyStrikethrough,
  isDrinkCategory,
  formatMenuItemLine,
  filterMenuItemsByView,
  groupItemsByCategory,
  buildTextMenuPayload,
  MAX_MESSENGER_TEXT_LENGTH,
  MENU_FOOTER_GUIDANCE
};

