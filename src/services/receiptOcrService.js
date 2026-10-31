/**
 * Receipt OCR & Parser Service
 * Extracts GCash Reference Number (13 digits) and payment amount from receipt screenshots.
 */

const Tesseract = require('tesseract.js');

const UNREADABLE_REPLY = 'Malabo o hindi mabasa ang resibo. Pakisend po ng mas malinaw na screenshot o i-type ang 13-digit Reference Number.';

/**
 * Parse raw text to extract GCash reference number and amount
 * @param {string} rawText 
 * @returns {{ referenceNumber: string|null, amount: number|null, rawText: string }}
 */
function parseReceiptText(rawText = '') {
  if (!rawText || typeof rawText !== 'string') {
    return { referenceNumber: null, amount: null, rawText: '' };
  }

  const text = rawText.trim();

  // 1. Extract 13-digit GCash Reference Number
  // Primary regex: /\b\d{4}\s?\d{3}\s?\d{6}\b/ (removes spaces to get 13 digits)
  let referenceNumber = null;
  const primaryMatch = text.match(/\b\d{4}\s?\d{3}\s?\d{6}\b/);
  if (primaryMatch) {
    referenceNumber = primaryMatch[0].replace(/\s+/g, '');
  } else {
    // Fallback: 13 contiguous digits
    const contiguousMatch = text.match(/\b\d{13}\b/);
    if (contiguousMatch) {
      referenceNumber = contiguousMatch[0];
    } else {
      // Fallback: labeled reference number e.g. "Ref No. 1009 876 543210" or "Reference No: 1009876543210"
      const labeledMatch = text.match(/(?:ref(?:erence)?(?:\s*no\.?)?)\s*[:#]?\s*([0-9\s]{13,16})/i);
      if (labeledMatch) {
        const cleaned = labeledMatch[1].replace(/\s+/g, '');
        if (cleaned.length === 13) {
          referenceNumber = cleaned;
        }
      }
    }
  }

  // 2. Extract Amount
  // Prioritize labeled or currency-prefixed amount
  let amount = null;
  const labeledAmountMatch = text.match(/(?:total\s+amount|amount\s+sent|amount|paid)\s*[:#]?\s*(?:PHP|Php|₱)?\s*([\d,]+(?:\.\d{2})?)/i);
  if (labeledAmountMatch) {
    const rawVal = labeledAmountMatch[1].replace(/,/g, '');
    const num = parseFloat(rawVal);
    if (!isNaN(num) && num > 0) {
      amount = num;
    }
  }

  if (amount === null) {
    const currencyMatch = text.match(/(?:PHP|Php|₱)\s*([\d,]+(?:\.\d{2})?)/i);
    if (currencyMatch) {
      const rawVal = currencyMatch[1].replace(/,/g, '');
      const num = parseFloat(rawVal);
      if (!isNaN(num) && num > 0) {
        amount = num;
      }
    }
  }

  if (amount === null) {
    // Fallback pattern from prompt: /(?:PHP|Php|₱)?\s?(\d+(?:\.\d{2})?)/
    const fallbackMatch = text.match(/(?:PHP|Php|₱)?\s?(\d+(?:\.\d{2})?)/);
    if (fallbackMatch && fallbackMatch[1]) {
      const num = parseFloat(fallbackMatch[1].replace(/,/g, ''));
      if (!isNaN(num) && num > 0) {
        amount = num;
      }
    }
  }

  return {
    referenceNumber,
    amount,
    rawText: text
  };
}

/**
 * Recognize receipt image and extract structured data
 * Accepts URL, file path, Buffer, or mock object { text: '...' }
 * @param {string|Buffer|Object} imageInput 
 * @returns {Promise<{ success: boolean, referenceNumber?: string, amount?: number, rawText?: string, error?: string, botReply?: string }>}
 */
async function recognizeReceipt(imageInput) {
  try {
    let ocrText = '';

    if (!imageInput) {
      return {
        success: false,
        error: 'UNREADABLE_RECEIPT',
        botReply: UNREADABLE_REPLY
      };
    }

    // Direct mock/text input support for tests and offline execution
    if (typeof imageInput === 'object' && imageInput.text) {
      ocrText = imageInput.text;
    } else if (typeof imageInput === 'string' && (imageInput.startsWith('text:') || imageInput.includes('\n'))) {
      ocrText = imageInput.replace(/^text:/, '');
    } else {
      // Run Tesseract OCR on image URL or local path
      const result = await Tesseract.recognize(imageInput, 'eng', {
        logger: () => {} // silent logger
      });
      ocrText = result?.data?.text || '';
    }

    const parsed = parseReceiptText(ocrText);

    if (!parsed.referenceNumber) {
      return {
        success: false,
        error: 'UNREADABLE_RECEIPT',
        botReply: UNREADABLE_REPLY,
        rawText: ocrText
      };
    }

    return {
      success: true,
      referenceNumber: parsed.referenceNumber,
      amount: parsed.amount,
      rawText: ocrText
    };
  } catch (err) {
    console.error('[ReceiptOCR] Recognition error:', err.message);
    return {
      success: false,
      error: 'UNREADABLE_RECEIPT',
      botReply: UNREADABLE_REPLY
    };
  }
}

module.exports = {
  parseReceiptText,
  recognizeReceipt,
  UNREADABLE_REPLY
};
