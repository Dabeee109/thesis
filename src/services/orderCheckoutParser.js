/**
 * Diner's Cafe Tondo - Order Checkout Form Message Parser
 * Coordinates: 14.6143686, 120.9642334 (Tondo, Manila)
 * 
 * Extracts and validates structured order details from customer checkout text:
 * ----------------------------------------------------
 * 🛒 Diner's Cafe — Order Checkout Form
 * Full Name: [Customer Name]
 * Contact Number: [Phone Number]
 * Delivery Address: [House #, Street, Barangay, Landmark]
 * Google Maps / Pin Location Link: [URL or Empty]
 * Order Summary / Items: [Item 1 x 2, Item 2 x 1]
 * Special Instructions / Notes: [Any notes]
 * Payment Method: GCash
 * ----------------------------------------------------
 */

const STORE_COORDINATES = {
  lat: 14.6143686,
  lng: 120.9642334,
  name: "Diner's Cafe Tondo",
  address: "Tondo, Manila"
};

/**
 * Clean and normalize a string value
 */
function cleanValue(str) {
  if (!str) return '';
  return str
    .replace(/^\[|\]$/g, '') // remove brackets if customer kept template brackets
    .trim();
}

/**
 * Validate and format Philippine mobile contact number
 * Valid formats: 09171234567, +639171234567, 639171234567, 0917-123-4567
 */
function parsePhoneNumber(raw) {
  if (!raw) return null;
  const cleaned = raw.replace(/[^0-9+]/g, '');

  // 09XXXXXXXXX (11 digits)
  if (/^09\d{9}$/.test(cleaned)) {
    return {
      raw,
      canonical: `+63${cleaned.substring(1)}`,
      national: cleaned,
      isValid: true
    };
  }

  // +639XXXXXXXXX (13 chars)
  if (/^\+639\d{9}$/.test(cleaned)) {
    return {
      raw,
      canonical: cleaned,
      national: `0${cleaned.substring(3)}`,
      isValid: true
    };
  }

  // 639XXXXXXXXX (12 digits)
  if (/^639\d{9}$/.test(cleaned)) {
    return {
      raw,
      canonical: `+${cleaned}`,
      national: `0${cleaned.substring(2)}`,
      isValid: true
    };
  }

  return {
    raw,
    isValid: false,
    error: 'Invalid Philippine mobile number format. Expected format: 09XXXXXXXXX or +639XXXXXXXXX.'
  };
}

/**
 * Extract coordinates from standard Google Maps URLs if present
 * Supports @lat,lng, ?q=lat,lng, ll=lat,lng
 */
function parseGoogleMapsLink(url) {
  if (!url || /^(empty|none|n\/a|na|-)$/i.test(url.trim())) {
    return { url: null, coords: null };
  }

  const trimmedUrl = url.trim();
  let coords = null;

  // Pattern 1: @14.6143,120.9642
  const atMatch = trimmedUrl.match(/@(-?\d+\.\d+),(-?\d+\.\d+)/);
  if (atMatch) {
    coords = { lat: parseFloat(atMatch[1]), lng: parseFloat(atMatch[2]) };
  }

  // Pattern 2: ?q=14.6143,120.9642 or ll=14.6143,120.9642 or destination=14.6143,120.9642
  if (!coords) {
    const qMatch = trimmedUrl.match(/[?&](?:q|ll|destination)=(-?\d+\.\d+),(-?\d+\.\d+)/);
    if (qMatch) {
      coords = { lat: parseFloat(qMatch[1]), lng: parseFloat(qMatch[2]) };
    }
  }

  return {
    url: trimmedUrl,
    coords
  };
}

/**
 * Parse order item summary string into structured items array
 * Examples supported:
 * - "Signature Spanish Latte x 2, Classic Beef Tapa Rice Bowl x 1"
 * - "2x Caramel Macchiato, 1x Croissant"
 * - Multi-line item lists
 */
function parseOrderItems(rawItems) {
  if (!rawItems) return [];

  // Split on commas, semicolons, or newlines
  const lines = rawItems.split(/[,;\n]+/).map(s => s.trim()).filter(Boolean);
  const items = [];

  for (const line of lines) {
    // Pattern A: "Item Name x 2" or "Item Name - 2" or "Item Name: 2"
    let match = line.match(/^(.+?)\s*(?:[xX*×\-:]|\bqty:?)\s*(\d+)\s*$/);
    if (match) {
      const name = match[1].replace(/^[•\-\*]\s*/, '').trim();
      const quantity = parseInt(match[2], 10);
      if (name && quantity > 0) {
        items.push({ name, quantity, raw: line });
        continue;
      }
    }

    // Pattern B: "2x Item Name" or "2 Item Name"
    match = line.match(/^(\d+)\s*(?:[xX*×\-])?\s+(.+)$/);
    if (match) {
      const quantity = parseInt(match[1], 10);
      const name = match[2].trim();
      if (name && quantity > 0) {
        items.push({ name, quantity, raw: line });
        continue;
      }
    }

    // Fallback: Just item name with 1 quantity
    const fallbackName = line.replace(/^[•\-\*]\s*/, '').trim();
    if (fallbackName) {
      items.push({ name: fallbackName, quantity: 1, raw: line });
    }
  }

  return items;
}

/**
 * Great-circle distance between two coordinates in kilometers (Haversine formula)
 */
function calculateHaversineKm(lat1, lon1, lat2, lon2) {
  const R = 6371; // Earth's mean radius in km
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = 
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * 
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return Math.round(R * c * 100) / 100;
}

/**
 * Check if the text matches the Checkout Form template
 * @param {string} text 
 * @returns {boolean}
 */
function isCheckoutForm(text) {
  if (!text || typeof text !== 'string') return false;
  const normalized = text.toLowerCase();
  
  // Must contain checkout indicator and at least 2 key form labels
  const hasFormTitle = normalized.includes('order checkout form') || normalized.includes('diner') && normalized.includes('checkout');
  const labelMatches = [
    /full\s*name\s*:/i,
    /contact\s*number\s*:/i,
    /delivery\s*address\s*:/i,
    /order\s*summary|items?\s*:/i
  ].filter(rx => rx.test(text)).length;

  return hasFormTitle || labelMatches >= 3;
}

/**
 * Main Message Parser
 * Parses customer plain text checkout submission and returns structured data + validation
 * 
 * @param {string} text - Raw message text sent by user
 * @returns {Object} Result object { isForm, isValid, data, errors }
 */
function parseCheckoutForm(text) {
  if (!text || typeof text !== 'string') {
    return {
      isForm: false,
      isValid: false,
      errors: ['Empty or invalid message content']
    };
  }

  if (!isCheckoutForm(text)) {
    return {
      isForm: false,
      isValid: false,
      errors: ['Message does not match the Diner\'s Cafe checkout form template.']
    };
  }

  // Strictly multiline regex extractors anchored per line
  const extractField = (labelPattern) => {
    const regex = new RegExp(`^[ \\t]*(?:${labelPattern})[ \\t]*:[ \\t]*(.*)$`, 'im');
    const match = text.match(regex);
    return match ? cleanValue(match[1]) : '';
  };

  const fullNameRaw = extractField('full[ \\t]*name|name');
  const contactRaw = extractField('contact[ \\t]*number|phone[ \\t]*number|mobile|phone');
  const deliveryAddressRaw = extractField('delivery[ \\t]*address|address');
  const mapsLinkRaw = extractField('google[ \\t]*maps?(?:[ \\t]*/[ \\t]*pin[ \\t]*location)?[ \\t]*link|maps?[ \\t]*link|pin[ \\t]*link|location[ \\t]*link');
  const orderSummaryRaw = extractField('order[ \\t]*summary(?:[ \\t]*/[ \\t]*items)?|items?|orders?');
  const specialInstructionsRaw = extractField('special[ \\t]*instructions?(?:[ \\t]*/[ \\t]*notes)?|instructions?|notes?');
  const paymentMethodRaw = extractField('payment[ \\t]*method|payment') || 'GCash';

  const errors = [];

  // 1. Full Name Validation
  if (!fullNameRaw || fullNameRaw.length < 2) {
    errors.push('Full Name is required and must be at least 2 characters.');
  }

  // 2. Phone Number Validation
  const phoneResult = parsePhoneNumber(contactRaw);
  if (!phoneResult || !phoneResult.isValid) {
    errors.push(phoneResult?.error || 'A valid Philippine mobile number (e.g. 09XXXXXXXXX) is required.');
  }

  // 3. Delivery Address Validation
  if (!deliveryAddressRaw || deliveryAddressRaw.length < 5) {
    errors.push('Delivery Address is required (include House #, Street, Barangay, or landmark).');
  }

  // 4. Order Items Validation
  const parsedItems = parseOrderItems(orderSummaryRaw);
  if (!parsedItems || parsedItems.length === 0) {
    errors.push('Order Summary / Items list is required (e.g. Spanish Latte x 2, Beef Tapa x 1).');
  }

  // 5. Payment Method Normalization (Check GCash first to prevent "cash" substring collision)
  let normalizedPayment = 'GCash';
  if (/gcash/i.test(paymentMethodRaw)) {
    normalizedPayment = 'GCash';
  } else if (/\b(cash|cod|cash\s*on\s*delivery)\b/i.test(paymentMethodRaw)) {
    normalizedPayment = 'Cash on Delivery (COD)';
  }

  // 6. Google Maps Link & Location Coordinates
  const mapsData = parseGoogleMapsLink(mapsLinkRaw);
  let distanceKm = null;
  if (mapsData.coords) {
    distanceKm = calculateHaversineKm(
      STORE_COORDINATES.lat,
      STORE_COORDINATES.lng,
      mapsData.coords.lat,
      mapsData.coords.lng
    );
  }

  const isValid = errors.length === 0;

  return {
    isForm: true,
    isValid,
    errors,
    data: isValid ? {
      customer: {
        fullName: fullNameRaw,
        phone: phoneResult.canonical,
        phoneNational: phoneResult.national
      },
      delivery: {
        address: deliveryAddressRaw,
        mapsUrl: mapsData.url,
        extractedCoords: mapsData.coords,
        distanceFromStoreKm: distanceKm,
        store: STORE_COORDINATES
      },
      items: parsedItems,
      specialInstructions: specialInstructionsRaw || 'None',
      paymentMethod: normalizedPayment,
      rawSubmission: text.trim()
    } : null
  };
}

module.exports = {
  STORE_COORDINATES,
  isCheckoutForm,
  parseCheckoutForm,
  parsePhoneNumber,
  parseOrderItems,
  parseGoogleMapsLink,
  calculateHaversineKm
};
