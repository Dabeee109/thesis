#!/usr/bin/env node

/**
 * Wit.ai Training Data Upload Script (Task 10)
 * Reads WIT_AI_SERVER_ACCESS_TOKEN from environment.
 * Supports --dry-run for offline verification.
 * Idempotently creates intents, entities, keyword values, and uploads utterances in batches of 50.
 */

const fs = require('fs');
const path = require('path');

const WIT_API_VERSION = '20240304';
const WIT_API_BASE = 'https://api.wit.ai';

const dataPath = path.join(__dirname, '../data/wit-training.json');
if (!fs.existsSync(dataPath)) {
  console.error(`[Error] Training data file not found at ${dataPath}`);
  process.exit(1);
}

const trainingData = JSON.parse(fs.readFileSync(dataPath, 'utf8'));
const isDryRun = process.argv.includes('--dry-run');
const token = process.env.WIT_AI_SERVER_ACCESS_TOKEN;

if (!isDryRun && !token) {
  console.error('[Error] WIT_AI_SERVER_ACCESS_TOKEN environment variable is required (unless running with --dry-run).');
  console.error('Usage: WIT_AI_SERVER_ACCESS_TOKEN=your_token node scripts/uploadWitData.js [--dry-run]');
  process.exit(1);
}

/**
 * Locate entity values inside text and compute start/end character offsets.
 */
function computeUtterancePayload(item) {
  const text = item.text;
  const entities = [];

  if (item.entities) {
    for (const [entityName, entityVal] of Object.entries(item.entities)) {
      if (!entityVal) continue;
      const valStr = String(entityVal);
      const startIdx = text.toLowerCase().indexOf(valStr.toLowerCase());

      if (startIdx !== -1) {
        const endIdx = startIdx + valStr.length;
        const role = entityName === 'quantity' ? 'quantity' : entityName;
        const witEntityName = entityName === 'quantity' ? 'wit$number' : entityName;

        entities.push({
          entity: `${witEntityName}:${role}`,
          start: startIdx,
          end: endIdx,
          body: text.substring(startIdx, endIdx),
          entities: []
        });
      }
    }
  }

  return {
    text: item.text,
    intent: item.intent,
    entities,
    traits: []
  };
}

async function apiRequest(endpoint, method = 'GET', body = null) {
  const url = `${WIT_API_BASE}${endpoint}${endpoint.includes('?') ? '&' : '?'}v=${WIT_API_VERSION}`;
  const headers = {
    'Authorization': `Bearer ${token}`,
    'Content-Type': 'application/json'
  };

  const response = await fetch(url, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined
  });

  const text = await response.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch (e) {
    json = { raw: text };
  }

  if (!response.ok) {
    const errorMsg = json.error || json.message || response.statusText;
    const isAlreadyExists = /already exists/i.test(errorMsg) || response.status === 409 || response.status === 400;
    if (isAlreadyExists) {
      return { skipped: true, error: errorMsg };
    }
    const err = new Error(`Wit.ai API error (${response.status}): ${errorMsg}`);
    err.status = response.status;
    err.response = json;
    throw err;
  }

  return json;
}

async function run() {
  console.log('==========================================');
  console.log(' Wit.ai Training Data Uploader');
  console.log(` Mode: ${isDryRun ? 'DRY-RUN (Simulated)' : 'LIVE UPLOAD'}`);
  console.log('==========================================\n');

  const { intents, entities, utterances } = trainingData;
  console.log(`Loaded dataset:`);
  console.log(` - Intents: ${intents.length}`);
  console.log(` - Entities: ${entities.length}`);
  console.log(` - Utterances: ${utterances.length}\n`);

  // Build processed utterances
  const formattedUtterances = utterances.map(computeUtterancePayload);

  if (isDryRun) {
    console.log('[Dry Run] Sample First 5 Formatted Payloads:');
    console.log(JSON.stringify(formattedUtterances.slice(0, 5), null, 2));

    console.log('\n[Dry Run] Utterances summary by intent:');
    const counts = {};
    for (const u of formattedUtterances) {
      counts[u.intent] = (counts[u.intent] || 0) + 1;
    }
    console.table(counts);

    console.log('\n[Dry Run] Completed successfully. No network requests made.');
    return;
  }

  // 1. Create Intents
  console.log('1. Creating Intents...');
  for (const intentName of intents) {
    try {
      const res = await apiRequest('/intents', 'POST', { name: intentName });
      if (res.skipped) {
        console.log(`   [Intent] '${intentName}' already exists. (Skipped)`);
      } else {
        console.log(`   [Intent] Created '${intentName}'`);
      }
    } catch (err) {
      console.warn(`   [Intent Warning] Error creating '${intentName}':`, err.message);
    }
  }

  // 2. Create Entities and Keywords
  console.log('\n2. Creating Entities & Keywords...');
  for (const ent of entities) {
    try {
      const res = await apiRequest('/entities', 'POST', {
        name: ent.name,
        roles: ent.roles || [ent.name],
        lookups: ent.lookups || ['keywords']
      });
      if (res.skipped) {
        console.log(`   [Entity] '${ent.name}' already exists. (Skipped)`);
      } else {
        console.log(`   [Entity] Created '${ent.name}'`);
      }
    } catch (err) {
      console.warn(`   [Entity Warning] Error creating '${ent.name}':`, err.message);
    }

    if (ent.values && ent.values.length > 0) {
      for (const val of ent.values) {
        try {
          const res = await apiRequest(`/entities/${ent.name}/keywords`, 'POST', {
            keyword: val.keyword,
            synonyms: val.synonyms || []
          });
          if (res.skipped) {
            console.log(`     [Keyword] '${val.keyword}' already exists. (Skipped)`);
          } else {
            console.log(`     [Keyword] Added '${val.keyword}' with ${val.synonyms.length} synonyms.`);
          }
        } catch (valErr) {
          console.warn(`     [Keyword Warning] Could not add '${val.keyword}':`, valErr.message);
        }
      }
    }
  }

  // 3. Upload Utterances in Batches of 50
  console.log('\n3. Uploading Utterances in Batches of 50...');
  const BATCH_SIZE = 50;
  let successCount = 0;

  for (let i = 0; i < formattedUtterances.length; i += BATCH_SIZE) {
    const batch = formattedUtterances.slice(i, i + BATCH_SIZE);
    const batchNum = Math.floor(i / BATCH_SIZE) + 1;
    const totalBatches = Math.ceil(formattedUtterances.length / BATCH_SIZE);

    try {
      console.log(`   Uploading batch ${batchNum}/${totalBatches} (${batch.length} utterances)...`);
      const res = await apiRequest('/utterances', 'POST', batch);
      successCount += batch.length;
      console.log(`   Batch ${batchNum} completed.`);
    } catch (batchErr) {
      console.error(`   [Batch ${batchNum} Failed]:`, batchErr.message);
    }
  }

  console.log('\n==========================================');
  console.log(` Upload Complete! ${successCount}/${formattedUtterances.length} utterances uploaded.`);
  console.log('==========================================');
}

run().catch(err => {
  console.error('[Fatal Error]:', err);
  process.exit(1);
});
