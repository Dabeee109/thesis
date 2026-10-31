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

// Default to gemini-3.7-flash (replaces deprecated gemini-2.5-flash), with multi-tier failover
const PRIMARY_MODEL = 'gemini-3.7-flash';
const FALLBACK_MODEL = 'gemini-3.5-flash-lite';
const TERTIARY_MODEL = 'gemini-3.1-flash-lite';
const LEGACY_MODEL_PATTERN = /^gemini-(?:1\.5|2\.0|2\.5)/i;

// Structured JSON Schema enforced by Gemini Interactions API response_format
const BARISTA_RESPONSE_SCHEMA = {
  type: 'object',
  properties: {
    replyText: {
      type: 'string',
      description: 'Friendly conversational response to the customer (under 180 words, plain text, no $ signs).'
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
        required: ['menuItemId', 'name', 'quantity']
      }
    },
    suggestedReplies: {
      type: 'array',
      items: { type: 'string' }
    }
  },
  required: ['replyText', 'intent', 'extractedItems', 'suggestedReplies']
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
 * Normalize model string, upgrading deprecated legacy models (e.g. gemini-2.5-flash) to gemini-3.7-flash
 */
function resolveModelChain(preferredModel) {
  const raw = String(preferredModel || process.env.GEMINI_MODEL || config.geminiModel || PRIMARY_MODEL).trim();
  const normalized = (!raw || LEGACY_MODEL_PATTERN.test(raw)) ? PRIMARY_MODEL : raw;
  const candidates = Array.from(new Set([normalized, PRIMARY_MODEL, FALLBACK_MODEL, TERTIARY_MODEL]));
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

  const fewShotBlock = buildFewShotPromptBlock(userMessage, 18);

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
- Current Cart: ${currentCartString}
- Active Order Number: ${session.activeOrderNumber || 'None'}
- Conversation State: ${session.state || 'IDLE'}

ORDER EXTRACTION RULES:
- Only set intent to "ADD_TO_CART" and populate "extractedItems" when the customer is explicitly asking to order/add available items from CURRENT LIVE MENU CATALOG.
- If the customer asks a question, greeting, customization query, ambiance query, complaint, or recommendation without an explicit order command, DO NOT add items prematurely—leave "extractedItems" empty ([]).

FEW-SHOT TRAINING EXAMPLES (Follow this exact tone, language mirroring, natural Taglish flow, "po"/"opo" warmth, and brevity):
${fewShotBlock}`;
}

/**
 * Append turn to bounded local rolling history (fallback when server-side interaction ID expires)
 */
function appendRollingHistory(session, userText, modelText) {
  if (!session) return;
  if (!Array.isArray(session.chatHistory)) {
    session.chatHistory = [];
  }
  session.chatHistory.push(
    { role: 'user', text: String(userText || '').slice(0, 400) },
    { role: 'model', text: String(modelText || '').slice(0, 500) }
  );
  if (session.chatHistory.length > 10) {
    session.chatHistory = session.chatHistory.slice(-10);
  }
}

/**
 * Format input with local history context when starting a fresh server interaction
 */
function buildContextualInput(userMessage, history = []) {
  if (!Array.isArray(history) || history.length === 0) {
    return userMessage;
  }
  const transcript = history
    .slice(-8)
    .map(turn => `${turn.role === 'model' ? 'Assistant' : 'Customer'}: ${turn.text}`)
    .join('\n');
  return `Recent conversation context:\n${transcript}\n\nCurrent customer message: ${userMessage}`;
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

    // Sanitize currency symbols for Messenger consistency
    parsed.replyText = parsed.replyText.replace(/\$/g, 'PHP ').trim();
    parsed.suggestedReplies = Array.isArray(parsed.suggestedReplies)
      ? parsed.suggestedReplies.map(r => String(r).replace(/\$/g, 'PHP ').trim().slice(0, 20)).filter(Boolean).slice(0, 4)
      : [];
    parsed.extractedItems = Array.isArray(parsed.extractedItems) ? parsed.extractedItems : [];

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
      replyText: result.outputText,
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
  generateGeminiResponse,
  generateContextualReply
};
