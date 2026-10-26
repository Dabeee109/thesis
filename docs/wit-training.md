# Wit.ai Training and Evaluation Guide

This guide details the procedure for training, updating, and evaluating the Diner's Cafe Natural Language Understanding (NLU) model on Wit.ai.

---

## 1. Overview

The Diner's Cafe Ordering System uses Wit.ai to parse unstructured customer inputs on Facebook Messenger that are not resolved by immediate deterministic rules (such as button payloads, open state text inputs, shortcut words, and yes/no lexicons).

The model consists of:
- **13 Intents**: `place_order`, `remove_item`, `checkout`, `confirm_yes`, `confirm_no`, `view_cart`, `clear_cart`, `browse_menu`, `track_order`, `store_info`, `greet`, `request_agent`, `out_of_scope`.
- **Entities**:
  - `menu_item` (`keywords` lookup with cafe menu items and synonyms)
  - `quantity` (built-in `wit/number`)
  - `payment_method` (`keywords` lookup: `gcash`, `cash`)
  - `order_type` (`keywords` lookup: `delivery`, `pickup`)

---

## 2. Dataset Structure

The canonical training dataset is located at:
```
data/wit-training.json
```
Utterances are annotated with `intent` and entity keywords:
```json
{
  "text": "i want 2 spanish latte",
  "intent": "place_order",
  "entities": {
    "quantity": "2",
    "menu_item": "spanish latte"
  }
}
```

---

## 3. Uploading and Retraining

### Dry Run (Simulated Validation)
Validate character offsets, entity mappings, and intent distribution without sending requests to the Wit.ai API:
```bash
node scripts/uploadWitData.js --dry-run
```

### Live Upload
Obtain the Server Access Token from the Wit.ai App Settings (**Settings > Server Access Token**).
Run the upload script:
```bash
WIT_AI_SERVER_ACCESS_TOKEN="YOUR_SERVER_ACCESS_TOKEN" node scripts/uploadWitData.js
```
The script will:
1. Create all 13 intents idempotently.
2. Register custom entities and keywords with synonyms.
3. Automatically calculate character offset indices (`start` and `end`).
4. Upload utterances in batches of 50.

---

## 4. Measuring Model Accuracy (Evaluation Procedure)

To evaluate model accuracy systematically:

1. **Split Dataset (Holdout Validation)**:
   - Randomly sample **15%** of utterances per intent from `data/wit-training.json` as the validation/test set.
   - Train Wit.ai on the remaining 85%.

2. **Run Validation Evaluation**:
   - Send each test utterance to the Wit.ai `/message` endpoint:
     ```http
     GET https://api.wit.ai/message?v=20240304&q=ENCODED_UTTERANCE
     Authorization: Bearer YOUR_SERVER_ACCESS_TOKEN
     ```
   - Compare the predicted top intent against the true labeled intent.

3. **Metrics & Target**:
   - Calculate precision, recall, and accuracy per intent:
     $$\text{Accuracy} = \frac{\text{Correct Predictions}}{\text{Total Test Utterances}}$$
   - **Target**: Overall and per-intent accuracy **$\ge 90\%$**.
   - If an intent falls below 90%, inspect the misclassified queries and augment synonyms or sample phrasing in `data/wit-training.json`.
