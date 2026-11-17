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
  // Supports "7047 160 660300", multi-space OCR output, hyphens, or contiguous 13 digits
  let referenceNumber = null;
  const primaryMatch = text.match(/\b\d{4}[\s-]*\d{3}[\s-]*\d{6}\b/);
  if (primaryMatch) {
    referenceNumber = primaryMatch[0].replace(/[\s-]+/g, '');
  } else {
    // Fallback: 13 contiguous digits
    const contiguousMatch = text.match(/\b\d{13}\b/);
    if (contiguousMatch) {
      referenceNumber = contiguousMatch[0];
    } else {
      // Fallback: labeled reference number e.g. "Ref No. 1009 876 543210" or "Reference No: 1009876543210"
      const labeledMatch = text.match(/(?:ref(?:erence)?(?:\s*no\.?)?)\s*[:#.]?\s*([0-9\s-]{9,22})/i);
      if (labeledMatch) {
        const cleaned = labeledMatch[1].replace(/[\s-]+/g, '');
        if (cleaned.length >= 9 && cleaned.length <= 13) {
          referenceNumber = cleaned;
        }
      }
    }
  }

  // 2. Extract Amount
  // Prioritize labeled or currency-prefixed amount
  let amount = null;
  const labeledAmountMatch = text.match(/(?:total\s+amount(?:\s+sent)?|amount\s+sent|amount|paid)\s*[:#]?\s*(?:PHP|Php|₱|£)?\s*([\d,]+(?:\.\d{2})?)/i);
  if (labeledAmountMatch) {
    const rawVal = labeledAmountMatch[1].replace(/,/g, '');
    const num = parseFloat(rawVal);
    if (!isNaN(num) && num > 0) {
      amount = num;
    }
  }

  if (amount === null) {
    const transferMatch = text.match(/(?:PHP|Php|₱|£)?\s*([\d,]+(?:\.\d{2})?)\s*(?:transfer\s+completed|completed|sent)/i);
    if (transferMatch) {
      const num = parseFloat(transferMatch[1].replace(/,/g, ''));
      if (!isNaN(num) && num > 0) amount = num;
    }
  }

  if (amount === null) {
    const currencyMatch = text.match(/(?:PHP|Php|₱|£)\s*([\d,]+(?:\.\d{2})?)/i);
    if (currencyMatch) {
      const rawVal = currencyMatch[1].replace(/,/g, '');
      const num = parseFloat(rawVal);
      if (!isNaN(num) && num > 0) {
        amount = num;
      }
    }
  }

  if (amount === null) {
    // Look for explicit decimal currency amount (e.g. 20.00, 169.00, 338.00)
    const decimalMatch = text.match(/\b(\d+[\d,]*\.\d{2})\b/);
    if (decimalMatch && decimalMatch[1]) {
      const num = parseFloat(decimalMatch[1].replace(/,/g, ''));
      if (!isNaN(num) && num > 0) {
        amount = num;
      }
    }
  }

  if (amount === null) {
    // Fallback pattern with currency prefix: /(?:PHP|Php|₱|£)\s*(\d+(?:\.\d{2})?)/
    const currencyPrefixMatch = text.match(/(?:PHP|Php|₱|£)\s*(\d+(?:\.\d{2})?)/i);
    if (currencyPrefixMatch && currencyPrefixMatch[1]) {
      const num = parseFloat(currencyPrefixMatch[1].replace(/,/g, ''));
      if (!isNaN(num) && num > 0) {
        amount = num;
      }
    }
  }

  // 3. Anti-Fraud: Extract Transaction Date & Time if present in receipt screenshot
  let transactionDate = null;
  const dateMatch = text.match(/(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\s+\d{1,2},?\s+\d{4}/i) ||
    text.match(/\d{1,2}\s+(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+\d{4}/i) ||
    text.match(/\b\d{4}-\d{2}-\d{2}\b/) ||
    text.match(/\b\d{1,2}\/\d{1,2}\/\d{2,4}\b/);
  if (dateMatch) {
    transactionDate = dateMatch[0];
  }

  return {
    referenceNumber,
    amount,
    transactionDate,
    rawText: text
  };
}

/**
 * Fallback to Gemini Vision multimodal analysis when Tesseract OCR fails or yields partial data
 * @param {Buffer} imageBuffer 
 * @returns {Promise<{ referenceNumber: string|null, amount: number|null, rawText: string }|null>}
 */
async function recognizeReceiptWithGeminiVision(imageBuffer) {
  try {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) return null;
    const { GoogleGenAI } = require('@google/genai');
    const ai = new GoogleGenAI({ apiKey });
    const base64Data = Buffer.isBuffer(imageBuffer) ? imageBuffer.toString('base64') : null;
    if (!base64Data) return null;

    const response = await Promise.race([
      ai.models.generateContent({
        model: 'gemini-flash-lite-latest',
        contents: [
          {
            role: 'user',
            parts: [
              { inlineData: { mimeType: 'image/jpeg', data: base64Data } },
              {
                text: 'You are an OCR receipt parser for a Philippine cafe. Analyze this GCash receipt or screenshot. Extract the 13-digit Reference Number (or 9 to 13 digits), payment amount, and transaction date. Return ONLY valid JSON: {"referenceNumber": string or null, "amount": number or null, "transactionDate": string or null, "rawText": string}'
              }
            ]
          }
        ]
      }),
      new Promise((_, reject) => setTimeout(() => reject(new Error('Vision timeout')), 10000))
    ]);

    const text = response?.text || '';
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      if (parsed.referenceNumber || parsed.amount) {
        return {
          referenceNumber: parsed.referenceNumber ? String(parsed.referenceNumber).replace(/\D+/g, '') : null,
          amount: typeof parsed.amount === 'number' ? parsed.amount : (parseFloat(parsed.amount) || null),
          rawText: parsed.rawText || text
        };
      }
    }
    return null;
  } catch (err) {
    // Silent fail in tests or offline sandbox
    return null;
  }
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
    let bufferData = null;
    let effectiveInput = imageInput;

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
      // If imageInput is a remote URL (e.g. Facebook CDN), download as Buffer with User-Agent to avoid blocking
      if (Buffer.isBuffer(imageInput)) {
        bufferData = imageInput;
      } else if (typeof imageInput === 'string' && (imageInput.startsWith('http://') || imageInput.startsWith('https://'))) {
        try {
          const controller = new AbortController();
          const timer = setTimeout(() => controller.abort(), 12000);
          try {
            const res = await fetch(imageInput, {
              headers: { 'User-Agent': 'DinersCafeBot/1.0' },
              signal: controller.signal
            });
            if (res.ok) {
              bufferData = Buffer.from(await res.arrayBuffer());
              effectiveInput = bufferData;
            }
          } finally {
            clearTimeout(timer);
          }
        } catch (dlErr) {
          console.warn('[ReceiptOCR] Fetch error:', dlErr.message);
        }
      }

      // Run Tesseract OCR on image URL, Buffer, or local path with 15s timeout guard
      try {
        const result = await Promise.race([
          Tesseract.recognize(effectiveInput, 'eng', {
            logger: () => {} // silent logger
          }),
          new Promise((_, reject) => setTimeout(() => reject(new Error('OCR timeout')), 15000))
        ]);
        ocrText = result?.data?.text || '';
      } catch (tessErr) {
        console.warn('[ReceiptOCR] Tesseract error/timeout:', tessErr.message);
      }
    }

    let parsed = parseReceiptText(ocrText);

    // If Tesseract failed to extract referenceNumber, try Gemini Vision fallback
    if (!parsed.referenceNumber && bufferData) {
      const visionResult = await recognizeReceiptWithGeminiVision(bufferData);
      if (visionResult && (visionResult.referenceNumber || visionResult.amount)) {
        parsed = {
          referenceNumber: visionResult.referenceNumber || parsed.referenceNumber,
          amount: visionResult.amount !== null ? visionResult.amount : parsed.amount,
          rawText: visionResult.rawText || ocrText
        };
      }
    }

    if (!parsed.referenceNumber) {
      return {
        success: false,
        error: 'UNREADABLE_RECEIPT',
        botReply: UNREADABLE_REPLY,
        amount: parsed.amount,
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
