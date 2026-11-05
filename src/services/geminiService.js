/**
 * Google Gemini AI Conversational Barista Service (@google/genai)
 * Provides multi-turn stateful dialogue via the Gemini Interactions API,
 * contextual prompt completion, systemInstruction grounding, intent parsing,
 * multi-item extraction, and resilient rate-limit / demand-spike failover.
 */

const { GoogleGenAI } = require('@google/genai');
const config = require('../config/config');
const {
  ROLE_AND_LINGUISTIC_GUIDELINES,
  CAFE_DINER_KNOWLEDGE,
  buildFewShotPromptBlock
} = require('./baristaTrainingData');

// Default to gemini-2.5-flash for fast sub-2-second inference latency (Feature 3)
const PRIMARY_MODEL = 'gemini-2.5-flash';
const FALLBACK_MODEL = 'gemini-2.5-flash-lite';
const TERTIARY_MODEL = 'gemini-2.0-flash';

// Structured JSON Schema enforced by Gemini API response_format (Feature 4 Multi-Item Array)
const BARISTA_RESPONSE_SCHEMA = {
  type: 'object',
  properties: {
    replyText: {
      type: 'string',
      description: 'Friendly conversational response or Stage 5 summary receipt to the customer (plain text, no $ signs, use ₱ or PHP). In Stage 5, format the summary receipt with every field on its own new line using explicit \\n line breaks.'
    },
    intent: {
      type: 'string',
      enum: [
        'GREETING',
        'RECOMMENDATION',
        'MENU_INQUIRY',
        'ADD_TO_CART',
        'VIEW_CART',
        'CHECKOUT',
        'STORE_INFO',
        'GENERAL_CHAT'
      ]
    },
    items: {
      type: 'array',
      description: 'Extracted array of order items with quantities and customizations (Feature 4)',
      items: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          qty: { type: 'integer' },
          size: { type: 'string' },
          menuItemId: { type: 'integer' },
          customizations: {
            type: 'object',
            properties: {
              milk: { type: 'string' },
              sugar_level: { type: 'string' },
              temperature: { type: 'string' },
              egg: { type: 'string' },
              specialInstructions: { type: 'string' }
            }
          }
        },
        required: ['name', 'qty']
      }
    },
    extractedItems: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          menuItemId: { type: 'integer' },
          name: { type: 'string' },
          quantity: { type: 'integer' },
          specialInstructions: { type: 'string' }
        },
        required: ['name', 'quantity']
      }
    },
    suggestedReplies: {
      type: 'array',
      items: { type: 'string' }
    }
  },
  required: ['replyText', 'intent', 'items', 'suggestedReplies']
};

// Cached SDK client instance keyed by API key so hot key updates work seamlessly
let cachedClient = null;
let cachedApiKey = null;

// Lightweight in-memory interaction tracker for standalone /api/webhook callers without DB sessions
const standaloneInteractions = new Map();

// Circuit-breaker cooldown map (model -> timestamp) so demand spikes on primary skip straight to fallback
const modelCooldownUntil = new Map();
const MODEL_COOLDOWN_MS = 2 * 60 * 1000;

/**
 * Resolve active API key from environment or config without hardcoding secrets
 */
function resolveApiKey() {
  const key = (process.env.GEMINI_API_KEY || config.geminiApiKey || '').trim();
  if (!key || key === 'your_gemini_api_key_here') {
    return '';
  }
  return key;
}

/**
 * Resolve model chain with automatic circuit breaker and failover (Feature 3)
 */
function resolveModelChain(preferredModel) {
  const raw = String(preferredModel || process.env.GEMINI_MODEL || config.geminiModel || PRIMARY_MODEL).trim();
  const normalized = raw || PRIMARY_MODEL;
  const candidates = Array.from(new Set([normalized, PRIMARY_MODEL, FALLBACK_MODEL, TERTIARY_MODEL, 'gemini-3.7-flash']));
  const now = Date.now();
  const healthy = candidates.filter(m => (modelCooldownUntil.get(m) || 0) <= now);
  return healthy.length > 0 ? healthy : candidates;
}

/**
 * Get or initialize singleton GoogleGenAI client
 * @returns {GoogleGenAI|null}
 */
function getGenAIClient() {
  const apiKey = resolveApiKey();
  if (!apiKey) return null;

  if (!cachedClient || cachedApiKey !== apiKey) {
    cachedClient = new GoogleGenAI({ apiKey });
    cachedApiKey = apiKey;
  }
  return cachedClient;
}

/**
 * Build operational systemInstruction grounding for Diner's Cafe
 */
function buildBaristaSystemInstruction(session = {}, menuItems = [], userMessage = '') {
  const menuCatalogString = menuItems.length > 0
    ? menuItems.map(m =>
        `- [ID: ${m.id}] ${m.name} (₱${parseFloat(m.price).toFixed(2)}) | Category: ${m.category_name || 'Cafe'} | ${m.description || 'Handcrafted cafe specialty'}`
      ).join('\n')
    : '- Menu catalog is loaded dynamically; invite the customer to tap Menu if they want the full list.';

  const currentCartString = Array.isArray(session.cart) && session.cart.length > 0
    ? session.cart.map(c => `${c.quantity}x ${c.name} (₱${(parseFloat(c.price || 0) * c.quantity).toFixed(2)})`).join(', ')
    : 'Empty';

  // Token-trimmed few-shot block (Feature 3: 4 high-relevance examples instead of 18)
  const fewShotBlock = buildFewShotPromptBlock(userMessage, 4);

  return `${ROLE_AND_LINGUISTIC_GUIDELINES}

STORE OPERATIONAL CONTEXT (${config.store.name}):
- Store Name: ${config.store.name}
- Operating Hours: ${config.store.hours} (Automated AI chat support is 24/7)
- Contact Number: ${config.store.phone}
- Store Location: ${config.store.address}
- Delivery Coverage & Rates: Base fee ₱50 up to 2 km (+₱10 per additional km) within ${config.store.maxDeliveryKm || 3.0} km cafe radius via Motorcycle and Eco-Bicycle couriers; Free delivery on orders ₱1,000+. Store Pickup is also available.
- Payment Methods: Cash on Delivery (COD) / Cash on Pickup, and GCash (${config.store.gcashNumber} - ${config.store.gcashName}; customer can pay via checkout portal or attach receipt screenshot here in chat).
- Currency & Formatting: Always use ₱ or PHP (never use the dollar sign). Keep suggestedReplies short (under 20 characters, no emojis).

${CAFE_DINER_KNOWLEDGE}

CURRENT LIVE MENU CATALOG (Use exact prices when quoting live menu items):
${menuCatalogString}

CUSTOMER SESSION CONTEXT:
- Customer Name: ${session.customer_name || session.details?.name || session.name || 'Valued Guest'}
- Selected Dining Mode: ${session.dining_mode || session.orderType || session.order_type || 'Pending Stage 1 Selection'}
- Current Cart: ${currentCartString}
- Active Order Number: ${session.activeOrderNumber || 'None'}
- Conversation State: ${session.state || 'IDLE'}
- Applied Discount: ${session.discount_info || 'None'}

STAGE PIPELINE DISCIPLINE:
- Stage 1 (Dining Mode Slot Locking): If Selected Dining Mode is already established (Dine In, Take Out, or Delivery), this slot is PERMANENTLY LOCKED for this session. DO NOT ask Stage 1 again! NEVER loop back or re-inquire about dining mode. Proceed directly to Stage 2 (customizations), Stage 3 (discounts), or Stage 4/5. Only ask Stage 1 if Selected Dining Mode is 'Pending Stage 1 Selection'.
- Stage 2: When items are named, check all mandatory customizations (size, sweetness/sugar level, milk type, hot/iced for drinks; egg style/sides for food) before moving to checkout.
- Stage 3: Inquire for Senior Citizen or PWD discount. Check verification rules (in-store counter presentation for Cash vs remote clear photo requirement for GCash).
- Stage 4: Collect Name, Payment Method (GCash or Cash), and Location based on Dining Mode.
- Stage 5: Output the EXACT summary receipt format with every field on its own line separated by \n:
Eto po ang summary ng inyong order:
Name: [Customer Name]
Location: [Address or Pickup / Seating]
Payment option: [GCash or Cash]
Dining mode: [Dine In, Take Out, or Delivery]
Discount: [Discount breakdown]
Order: - [Items with quantity and price]
Total: [Total breakdown]
Tama po ba lahat ng details? Reply **YES** to confirm and proceed, o sabihin lang po kung may gustong palitan!
NOTE: Never squash these onto a single line. Separate each field with a newline (\n).

MULTI-ITEM BATCH EXTRACTION RULES (Feature 4):
- When the customer specifies multiple items (separated by commas, bullets, line breaks, 'tsaka', 'tapos', 'and', 'plus', 'pati', 'at'), extract ALL items into the "items" array.
- For each item, capture:
  - "name": Clean item name matching menu catalog
  - "qty": Integer quantity (e.g. 1, 2)
  - "size": Cup size if specified (e.g. "16oz", "22oz")
  - "customizations": {
      "milk": string (e.g. "Oat Milk", "Regular dairy"),
      "sugar_level": string (e.g. "100%", "50%", "0%", "Regular"),
      "temperature": string (e.g. "Hot", "Iced"),
      "egg": string (e.g. "Sunny-side up", "Scrambled"),
      "specialInstructions": string
    }
- Populate both "items" and "extractedItems" with all extracted items. Set intent to "ADD_TO_CART" whenever items are requested.
- If the customer asks a question, greeting, or complaint without ordering items, leave "items" and "extractedItems" empty ([]).

FEW-SHOT TRAINING EXAMPLES (Follow this exact tone, language mirroring, natural Taglish flow, "po"/"opo" warmth, and brevity):
${fewShotBlock}`;
}

/**
 * Append turn to bounded local rolling history (Feature 3: sliding window of last 6 to 8 turns)
 */
function appendRollingHistory(session, userText, modelText) {
  if (!session) return;
  if (!Array.isArray(session.chatHistory)) {
    session.chatHistory = [];
  }
  session.chatHistory.push(
    { role: 'user', text: String(userText || '').slice(0, 300) },
    { role: 'model', text: String(modelText || '').slice(0, 400) }
  );
  // Feature 3: Strict sliding window (last 6 to 8 conversation turns)
  if (session.chatHistory.length > 8) {
    session.chatHistory = session.chatHistory.slice(-8);
  }
}

/**
 * Format input with local history context (Feature 3: sliding window of 6 turns)
 */
function buildContextualInput(userMessage, history = []) {
  if (!Array.isArray(history) || history.length === 0) {
    return userMessage;
  }
  const transcript = history
    .slice(-6)
    .map(turn => `${turn.role === 'model' ? 'Assistant' : 'Customer'}: ${turn.text}`)
    .join('\n');
  return `Recent context (last ${Math.min(6, history.length)} turns):\n${transcript}\n\nCustomer: ${userMessage}`;
}

/**
 * Execute an Interactions API call with automatic model failover and expired-interaction recovery
 */
async function executeResilientInteraction({
  input,
  systemInstruction,
  previousInteractionId = null,
  historyFallback = [],
  responseSchema = null,
  preferredModel = null
}) {
  const client = getGenAIClient();
  if (!client) {
    return null;
  }

  const timeoutMs = config.geminiTimeoutMs || 45000;
  const models = resolveModelChain(preferredModel);
  let activePrevId = previousInteractionId || null;

  for (let mIdx = 0; mIdx < models.length; mIdx++) {
    const model = models[mIdx];
    const isLastModel = mIdx === models.length - 1;
    const perAttemptTimeoutMs = isLastModel ? timeoutMs : Math.min(timeoutMs, 15000);

    for (let attempt = 0; attempt < 2; attempt++) {
      const effectiveInput = activePrevId
        ? input
        : buildContextualInput(input, historyFallback);

      const requestParams = {
        model,
        input: effectiveInput,
        system_instruction: systemInstruction
      };

      if (activePrevId) {
        requestParams.previous_interaction_id = activePrevId;
      }

      if (responseSchema) {
        requestParams.response_format = {
          type: 'text',
          mime_type: 'application/json',
          schema: responseSchema
        };
      }

      try {
        const interaction = await client.interactions.create(requestParams, {
          timeout_ms: perAttemptTimeoutMs,
          retries: { strategy: 'none' }
        });

        const outputText = interaction?.output_text ||
          interaction?.steps
            ?.filter(s => s.type === 'model_output')
            ?.flatMap(s => s.content || [])
            ?.filter(c => c.type === 'text' && c.text)
            ?.map(c => c.text)
            ?.join('') ||
          '';

        if (outputText) {
          modelCooldownUntil.delete(model);
          return {
            id: interaction.id || null,
            model,
            outputText: outputText.trim()
          };
        }
        break; // Empty output -> try next model in fallback chain
      } catch (err) {
        const status = err?.status || err?.statusCode || err?.code || 'UNKNOWN';
        const message = String(err?.message || '');

        // If previous_interaction_id expired or is invalid (400/404), drop it and retry once with rolling history
        if (activePrevId && attempt === 0 && (status === 400 || status === 404 || /previous_interaction_id|interaction.*not found/i.test(message))) {
          console.warn(`[Gemini AI] Stale previous_interaction_id (${activePrevId}); retrying with local rolling history.`);
          activePrevId = null;
          continue;
        }

        // Non-retryable auth / bad API key error -> abort immediately without hammering fallback models
        if (status === 401 || status === 403 || /API_KEY_INVALID|permission_denied/i.test(message)) {
          console.error(`[Gemini AI] Authentication error (${status}): Check GEMINI_API_KEY in .env.`);
          return null;
        }

        // Rate limit (429), demand spike (503), or timeout -> place model on brief cooldown & failover
        modelCooldownUntil.set(model, Date.now() + MODEL_COOLDOWN_MS);
        console.warn(`[Gemini AI] Model ${model} unavailable (${status}); cooling down 2m & failing over: ${message.slice(0, 140)}`);
        break;
      }
    }
  }

  return null;
}

/**
 * Ensure Stage 5 Order Summary Receipt lines are strictly formatted with explicit newlines
 */
function formatOrderSummaryReceipt(text) {
  if (!text || typeof text !== 'string') return text;

  if (
    /summary\s+ng\s+(?:inyong\s+)?order/i.test(text) ||
    (/\bName\s*:/i.test(text) && /\bLocation\s*:/i.test(text) && /\bTotal\s*:/i.test(text))
  ) {
    let formatted = text.trim();

    // 1. Separate introductory sentence
    formatted = formatted.replace(
      /(Eto po ang summary ng inyong order:?)\s*/i,
      '$1\n'
    );

    // 2. Separate each key field
    formatted = formatted.replace(/\s*(Name\s*:)/i, '\n$1');
    formatted = formatted.replace(/\s*(Location\s*:)/i, '\n$1');
    formatted = formatted.replace(/\s*(Payment option\s*:)/i, '\n$1');
    formatted = formatted.replace(/\s*(Dining mode\s*:)/i, '\n$1');
    formatted = formatted.replace(/\s*(Discount\s*:)/i, '\n$1');
    formatted = formatted.replace(/((?:Discount|Dining mode):[^\n]*?)\s+(Order\s*:)/i, '$1\n$2');

    // In case items are squashed onto a single line like: Order: - 1x item1 - 2x item2
    formatted = formatted.replace(/(\nOrder:\s*(?:-\s*)?[^\n]+?)\s+([-\u2022*]\s*\d+x\s+)/gi, '$1\n$2');

    formatted = formatted.replace(/\s+(Total\s*:)/i, '\n$1');
    formatted = formatted.replace(/\s*(Tama po ba (?:lahat ng )?details\?)/i, '\n$1');

    // 3. Normalize newlines
    formatted = formatted
      .split('\n')
      .map(line => line.trim())
      .filter(line => line.length > 0)
      .join('\n');

    return formatted;
  }

  return text;
}

/**
 * Generate a structured conversational Barista response and action plan for Messenger / Simulator
 *
 * @param {string} userMessage - Customer message
 * @param {Object} session - Customer conversation session (cart, geminiInteractionId, chatHistory, etc.)
 * @param {Array} menuItems - Available menu items list from DB
 * @returns {Promise<Object|null>} - Parsed structured response or null if unavailable
 */
async function generateGeminiResponse(userMessage, session = {}, menuItems = []) {
  const cleanMessage = String(userMessage || '').trim();
  if (!cleanMessage) return null;

  try {
    const systemInstruction = buildBaristaSystemInstruction(session, menuItems, cleanMessage);
    const result = await executeResilientInteraction({
      input: cleanMessage,
      systemInstruction,
      previousInteractionId: session?.geminiInteractionId || null,
      historyFallback: session?.chatHistory || [],
      responseSchema: BARISTA_RESPONSE_SCHEMA
    });

    if (!result || !result.outputText) {
      return null;
    }

    const parsed = JSON.parse(result.outputText);
    if (!parsed || typeof parsed.replyText !== 'string' || !parsed.replyText.trim()) {
      return null;
    }

    // Sanitize currency symbols and ensure summary receipts are cleanly structured
    parsed.replyText = formatOrderSummaryReceipt(parsed.replyText.replace(/\$/g, 'PHP ').trim());
    parsed.suggestedReplies = Array.isArray(parsed.suggestedReplies)
      ? parsed.suggestedReplies.map(r => String(r).replace(/\$/g, 'PHP ').trim().slice(0, 20)).filter(Boolean).slice(0, 4)
      : [];
    
    // Feature 4: Synchronize Multi-Item Batch Arrays (items & extractedItems)
    parsed.items = Array.isArray(parsed.items) ? parsed.items : [];
    parsed.extractedItems = Array.isArray(parsed.extractedItems) ? parsed.extractedItems : [];

    if (parsed.items.length > 0 && parsed.extractedItems.length === 0) {
      parsed.extractedItems = parsed.items.map(it => {
        const customParts = [];
        if (it.size) customParts.push(`Size: ${it.size}`);
        if (it.customizations?.milk) customParts.push(`Milk: ${it.customizations.milk}`);
        if (it.customizations?.sugar_level) customParts.push(`Sugar: ${it.customizations.sugar_level}`);
        if (it.customizations?.temperature) customParts.push(`Temp: ${it.customizations.temperature}`);
        if (it.customizations?.egg) customParts.push(`Egg: ${it.customizations.egg}`);
        if (it.customizations?.specialInstructions) customParts.push(it.customizations.specialInstructions);

        return {
          menuItemId: it.menuItemId,
          name: it.name,
          quantity: Math.max(1, parseInt(it.qty || it.quantity, 10) || 1),
          specialInstructions: customParts.join(', ')
        };
      });
    } else if (parsed.extractedItems.length > 0 && parsed.items.length === 0) {
      parsed.items = parsed.extractedItems.map(it => ({
        name: it.name,
        qty: Math.max(1, parseInt(it.quantity || it.qty, 10) || 1),
        menuItemId: it.menuItemId,
        customizations: {
          specialInstructions: it.specialInstructions || ''
        }
      }));
    }

    // Persist stateful multi-turn interaction ID & rolling history on customer session
    if (session && typeof session === 'object') {
      if (result.id) {
        session.geminiInteractionId = result.id;
      }
      appendRollingHistory(session, cleanMessage, parsed.replyText);
    }

    return {
      ...parsed,
      interactionId: result.id,
      modelUsed: result.model
    };
  } catch (err) {
    console.error('[Gemini AI Service Error]', err.message);
    return null;
  }
}

/**
 * Modular multi-turn chat completion helper for generic webhook / API integrations
 *
 * @param {Object} params
 * @param {string} params.senderId - Unique caller / conversation identifier
 * @param {string} params.message - User prompt text
 * @param {string} [params.systemInstruction] - Optional custom system instruction override
 * @param {Array}  [params.history] - Optional prior turns [{ role: 'user'|'model', text: string }]
 * @returns {Promise<{ replyText: string, interactionId: string|null, model: string }|null>}
 */
async function generateContextualReply({ senderId = 'default', message, systemInstruction, history = [] }) {
  const cleanMessage = String(message || '').trim();
  if (!cleanMessage) return null;

  try {
    const tracker = standaloneInteractions.get(String(senderId)) || { interactionId: null, history: [] };
    const effectiveInstruction = systemInstruction || buildBaristaSystemInstruction({ name: senderId }, [], cleanMessage);

    const result = await executeResilientInteraction({
      input: cleanMessage,
      systemInstruction: effectiveInstruction,
      previousInteractionId: tracker.interactionId,
      historyFallback: history.length > 0 ? history : tracker.history
    });

    if (!result || !result.outputText) {
      return null;
    }

    tracker.interactionId = result.id || tracker.interactionId;
    tracker.history.push(
      { role: 'user', text: cleanMessage.slice(0, 400) },
      { role: 'model', text: result.outputText.slice(0, 500) }
    );
    if (tracker.history.length > 10) {
      tracker.history = tracker.history.slice(-10);
    }
    standaloneInteractions.set(String(senderId), tracker);

    return {
      replyText: formatOrderSummaryReceipt(result.outputText),
      interactionId: result.id,
      model: result.model
    };
  } catch (err) {
    console.error('[Gemini Contextual Reply Error]', err.message);
    return null;
  }
}

module.exports = {
  PRIMARY_MODEL,
  FALLBACK_MODEL,
  getGenAIClient,
  resolveModelChain,
  buildBaristaSystemInstruction,
  formatOrderSummaryReceipt,
  generateGeminiResponse,
  generateContextualReply
};
