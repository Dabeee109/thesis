/**
 * Google Gemini AI Conversational Barista Service
 * Provides Generative AI dialogue, intent parsing, multi-item extraction,
 * and contextual food/drink recommendations for Diner's Cafe.
 */

const config = require('../config/config');

/**
 * Generate a conversational response and action plan from Google Gemini AI
 * 
 * @param {string} userMessage - Customer message
 * @param {Object} session - Customer conversation session (cart, history, etc.)
 * @param {Array} menuItems - Available menu items list from DB
 * @returns {Promise<Object|null>} - Formatted conversational response or null if unavailable
 */
async function generateGeminiResponse(userMessage, session, menuItems = []) {
  const apiKey = config.geminiApiKey;
  if (!apiKey || apiKey === 'your_gemini_api_key_here') {
    return null;
  }

  const menuCatalogString = menuItems.map(m => 
    `- [ID: ${m.id}] ${m.name} (₱${parseFloat(m.price).toFixed(2)}) | Category: ${m.category_name || 'Cafe'} | Description: ${m.description || 'Delicious handcrafted cafe specialty'}`
  ).join('\n');

  const currentCartString = session.cart && session.cart.length > 0
    ? session.cart.map(c => `${c.quantity}x ${c.name} (₱${(c.price * c.quantity).toFixed(2)})`).join(', ')
    : 'Empty';

  const systemInstruction = `You are "Barista Dan", the friendly, witty, and helpful AI barista of "Diner's Cafe".
Your goal is to assist customers with ordering, recommending menu items, answering questions about the cafe, and making their experience delightful.

STORE INFORMATION:
- Store Name: ${config.store.name}
- Hours: ${config.store.hours}
- Phone: ${config.store.phone}
- Location: ${config.store.address}
- Delivery Range: 0.0 km to 3.0 km radius from the cafe (Motorcycle & Eco-Bicycle couriers).
- Payment Options: Cash on Delivery (COD) and GCash (Account: ${config.store.gcashNumber}, ${config.store.gcashName}).

CURRENT MENU CATALOG:
${menuCatalogString}

CUSTOMER CONTEXT:
- Customer Name: ${session.name || 'Valued Customer'}
- Current Cart: ${currentCartString}
- State: ${session.state}

PERSONALITY & GUIDELINES:
1. Tone: Warm, welcoming, respectful, energetic. Do NOT include any emojis or decorative icons in your replyText or suggestedReplies (keep all text clean and readable).
2. Languages: Speak fluently in English, Tagalog, or Taglish depending on how the customer speaks to you.
3. Recommendations: If the customer asks for bestsellers or recommendations, suggest our top items (e.g. Signature Spanish Latte ₱145, Creamy Truffle Bacon Carbonara ₱220, Classic Beef Tapa Rice Bowl ₱195, Iced Americano ₱110, Almond Butter Croissant ₱95).
4. Answering Food/Drink Questions: Explain taste profiles, ingredients, and suggest pairings (e.g. pastries with espresso).
5. If the customer is ordering items (e.g., "2 spanish latte and 1 carbonara", "pabili ng iced coffee"):
   - Identify the exact menu item names and quantities.
   - Populate the "extractedItems" array in your JSON output.

YOU MUST ALWAYS RESPOND ONLY WITH A VALID JSON OBJECT matching this exact schema:
{
  "replyText": "Your friendly conversational response to the customer (keep under 200 words for Messenger readability)",
  "intent": "GREETING" | "RECOMMENDATION" | "MENU_INQUIRY" | "ADD_TO_CART" | "VIEW_CART" | "CHECKOUT" | "STORE_INFO" | "GENERAL_CHAT",
  "extractedItems": [
    {
      "menuItemId": 1,
      "name": "Signature Spanish Latte",
      "quantity": 2,
      "specialInstructions": ""
    }
  ],
  "suggestedReplies": ["Quick reply 1", "Quick reply 2", "Quick reply 3"]
}`;

  try {
    // Try Gemini 3.7 Flash first, then fallback to Gemini 3.5 Flash / Gemini 3.8 Flash
    const modelsToTry = ['gemini-3.7-flash', 'gemini-3.5-flash', 'gemini-3.8-flash'];
    let candidateText = null;

    for (const model of modelsToTry) {
      try {
        const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(apiKey)}`;
        const requestBody = {
          system_instruction: {
            parts: [{ text: systemInstruction }]
          },
          contents: [
            {
              role: 'user',
              parts: [{ text: `Customer says: "${userMessage}"` }]
            }
          ],
          generationConfig: {
            temperature: 0.7,
            responseMimeType: 'application/json'
          }
        };

        const response = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(requestBody)
        });

        if (response.ok) {
          const data = await response.json();
          candidateText = data.candidates?.[0]?.content?.parts?.[0]?.text;
          if (candidateText) break;
        } else {
          const errText = await response.text();
          console.warn(`[Gemini AI] Model ${model} returned ${response.status}:`, errText);
        }
      } catch (subErr) {
        console.warn(`[Gemini AI] Error attempting ${model}:`, subErr.message);
      }
    }

    if (!candidateText) {
      return null;
    }

    const parsed = JSON.parse(candidateText.trim());
    return parsed;
  } catch (err) {
    console.error('[Gemini AI Service Error]', err.message);
    return null;
  }
}

module.exports = {
  generateGeminiResponse
};
