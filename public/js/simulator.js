/**
 * Diner's Cafe Facebook Messenger Chatbot Web Simulator Controller
 */

const SIMULATOR_PSID = 'PSID_SIMULATOR_USER';
let currentSession = null;

document.addEventListener('DOMContentLoaded', async () => {
  // Check initial chatbot status
  checkBotStatus();
  initPersonaSelector();

  // Connect to SSE for real-time bot responses & delivery notifications
  API.connectSSE((eventType, data) => {
    if (eventType === 'SIMULATOR_MESSAGE' && data.psid === SIMULATOR_PSID) {
      renderBotPayload(data.payload.message);
    }
    if (eventType === 'FEEDBACK_PROMPT_TRIGGERED' && data.psid === SIMULATOR_PSID) {
      // Automatic feedback prompt arrives as normal SIMULATOR_MESSAGE; no duplicate rendering
    }
    if (eventType === 'CHATBOT_STATUS_CHANGED') {
      updateBotStatusIndicator(data.isEnabled);
    }
  });

  // Start initial conversation
  await sendSimulatedPayload('GET_STARTED');
});

async function checkBotStatus() {
  try {
    const res = await API.get('/chatbot/status');
    if (res && res.success) {
      updateBotStatusIndicator(res.isEnabled);
    }
  } catch (e) { }
}

function updateBotStatusIndicator(isEnabled) {
  const el = document.getElementById('sim-bot-status');
  if (el) {
    if (isEnabled) {
      el.innerHTML = '🟢 Active now &bull; AI Barista Bot';
      el.style.color = 'var(--brand-crema)';
    } else {
      el.innerHTML = '🔴 Bot Paused &bull; Offline Mode';
      el.style.color = '#ef4444';
    }
  }
}

async function handleChatSubmit(e) {
  e.preventDefault();
  const input = document.getElementById('chat-input-text');
  const text = input.value.trim();
  if (!text) return;

  // Append user message bubble
  appendUserMessage(text);
  input.value = '';
  hideQuickReplies();

  try {
    const res = await API.post('/chatbot/simulate', {
      psid: SIMULATOR_PSID,
      text
    });
    if (res && res.session) {
      currentSession = res.session;
    }
  } catch (err) {
    console.error('Simulator submit error:', err);
  }
}

async function sendSimulatedPayload(payload) {
  hideQuickReplies();
  try {
    const res = await API.post('/chatbot/simulate', {
      psid: SIMULATOR_PSID,
      payload
    });
    if (res && res.session) {
      currentSession = res.session;
    }
  } catch (err) {
    console.error('Simulator payload error:', err);
  }
}

function appendUserMessage(text, label = null) {
  const container = document.getElementById('chat-messages');
  const div = document.createElement('div');
  div.className = 'chat-msg user';
  const labelHtml = label ? `<div style="font-size: 0.72rem; opacity: 0.9; margin-bottom: 4px; font-weight: 700; color: #120904;">${escapeHtml(label)}</div>` : '';
  div.innerHTML = `<div class="bubble">${labelHtml}${escapeHtml(text)}</div>`;
  container.appendChild(div);
  scrollToBottom();
}

function showTypingIndicator(speaker, text) {
  const container = document.getElementById('chat-messages');
  removeTypingIndicator();
  const ind = document.createElement('div');
  ind.id = 'typing-indicator-msg';
  ind.className = speaker === 'user' ? 'chat-msg user' : 'chat-msg bot';
  ind.innerHTML = `<div class="bubble" style="opacity: 0.8; font-size: 0.78rem; font-style: italic; background: rgba(212,163,115,0.25); border: 1px dashed rgba(212,163,115,0.4);">${escapeHtml(text)}</div>`;
  container.appendChild(ind);
  scrollToBottom();
}

function removeTypingIndicator() {
  const ind = document.getElementById('typing-indicator-msg');
  if (ind) ind.remove();
}

function renderBotPayload(message) {
  removeTypingIndicator();
  const container = document.getElementById('chat-messages');

  // 1. Text Message
  if (message.text) {
    const div = document.createElement('div');
    div.className = 'chat-msg bot';
    div.innerHTML = `<div class="bubble">${escapeHtml(message.text)}</div>`;
    container.appendChild(div);
  }

  // 1b. Image Attachment
  if (message.attachment && message.attachment.type === 'image') {
    const imgUrl = message.attachment.payload?.url || message.attachment.payload;
    const div = document.createElement('div');
    div.className = 'chat-msg bot';
    div.innerHTML = `<div class="bubble bubble-img" style="padding: 4px; background: transparent;"><img src="${escapeHtml(imgUrl)}" alt="GCash QR Code" style="max-width: 220px; border-radius: 8px; display: block; box-shadow: 0 4px 12px rgba(0,0,0,0.15);" /></div>`;
    container.appendChild(div);
  }

  // 2. Generic Template Carousel
  if (message.attachment && message.attachment.type === 'template') {
    const payload = message.attachment.payload;
    if (payload.template_type === 'generic' && payload.elements) {
      const carouselWrap = document.createElement('div');
      carouselWrap.className = 'chat-msg bot';

      const carouselContainer = document.createElement('div');
      carouselContainer.className = 'carousel-container';

      const isSquare = payload.image_aspect_ratio === 'square';
      payload.elements.forEach(el => {
        const card = document.createElement('div');
        card.className = 'carousel-card';
        const imgStyle = isSquare ? 'style="height: 220px; object-fit: contain; background: #0066f6;"' : '';
        card.innerHTML = `
          <img src="${el.image_url || 'https://images.unsplash.com/photo-1541167760496-1628856ab772?w=500'}" alt="${escapeHtml(el.title)}" onerror="this.onerror=null; this.src='https://images.unsplash.com/photo-1541167760496-1628856ab772?w=500';" ${imgStyle}>
          <div class="carousel-card-body">
            <div class="carousel-title">${el.title}</div>
            <div class="carousel-subtitle">${el.subtitle || ''}</div>
          </div>
          ${(el.buttons || []).map(btn => {
          if (btn.type === 'web_url') {
            return `<a href="${escapeHtml(btn.url)}" target="_blank" class="carousel-btn" style="text-align:center; text-decoration:none; display:block;">${escapeHtml(btn.title)}</a>`;
          }
          return `<button class="carousel-btn" onclick="sendSimulatedPayload('${btn.payload}')">${escapeHtml(btn.title)}</button>`;
        }).join('')}
        `;
        carouselContainer.appendChild(card);
      });

      carouselWrap.appendChild(carouselContainer);
      container.appendChild(carouselWrap);
    }
  }

  // 3. Quick Replies
  if (message.quick_replies && message.quick_replies.length > 0) {
    renderQuickReplies(message.quick_replies);
  } else {
    hideQuickReplies();
  }

  scrollToBottom();
}

function renderQuickReplies(replies) {
  const wrap = document.getElementById('quick-replies-container');
  wrap.innerHTML = '';
  wrap.style.display = 'flex';

  replies.forEach(qr => {
    const btn = document.createElement('button');
    btn.className = 'quick-reply-chip';

    if (qr.content_type === 'location') {
      btn.innerText = '📍 Share location';
      btn.onclick = async () => {
        try {
          const area = await API.get('/delivery/service-area');
          const storeLat = area && Number.isFinite(area.storeLat) ? area.storeLat : 14.6042;
          const storeLng = area && Number.isFinite(area.storeLng) ? area.storeLng : 120.9822;
          const defaultPromptVal = `${(storeLat + 0.005).toFixed(4)}, ${(storeLng + 0.005).toFixed(4)}`;
          const input = window.prompt('Latitude, longitude', defaultPromptVal);
          if (!input) return;

          const parts = input.split(',').map(s => parseFloat(s.trim()));
          if (parts.length !== 2 || isNaN(parts[0]) || isNaN(parts[1])) {
            alert('Invalid latitude, longitude format. Please enter as "lat, lng".');
            return;
          }

          const [lat, lng] = parts;
          appendUserMessage('📍 Location shared');
          hideQuickReplies();

          const res = await API.post('/chatbot/simulate', {
            psid: SIMULATOR_PSID,
            location: { lat, lng }
          });
          if (res && res.session) {
            currentSession = res.session;
          }
        } catch (err) {
          console.error('Error sharing location:', err);
        }
      };
    } else {
      btn.innerText = qr.title;
      btn.onclick = () => {
        appendUserMessage(qr.title);
        sendSimulatedPayload(qr.payload);
      };
    }
    wrap.appendChild(btn);
  });
}

function hideQuickReplies() {
  const wrap = document.getElementById('quick-replies-container');
  wrap.style.display = 'none';
  wrap.innerHTML = '';
}

function scrollToBottom() {
  const container = document.getElementById('chat-messages');
  setTimeout(() => {
    container.scrollTop = container.scrollHeight;
  }, 50);
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.innerText = text;
  return div.innerHTML;
}

// ----------------------------------------------------------------------------
// Simulator Helpers
// ----------------------------------------------------------------------------

async function quickPayGCash(isExact) {
  if (!currentSession || !currentSession.computedTotal) {
    appendUserMessage(isExact ? '415.00' : '300.00');
    await handleChatText(isExact ? '415.00 ref 987654321' : '300.00 ref 987654321');
    return;
  }

  const total = currentSession.computedTotal;
  const amount = isExact ? total.toFixed(2) : Math.max(10, total - 100).toFixed(2);
  const text = `${amount} ref 9876543210`;
  appendUserMessage(text);
  await handleChatText(text);
}

async function handleChatText(text) {
  hideQuickReplies();
  try {
    const res = await API.post('/chatbot/simulate', {
      psid: SIMULATOR_PSID,
      text
    });
    if (res && res.session) {
      currentSession = res.session;
    }
  } catch (err) {
    console.error('Simulator text error:', err);
  }
}

function triggerDeliveryCompletedPrompt() {
  const orderNum = (currentSession && currentSession.activeOrderNumber) || 'DNR-20260901-001';
  renderFeedbackPrompt(orderNum);
}

function renderFeedbackPrompt(orderNumber) {
  renderBotPayload({
    text: 'Your order has been delivered! How was your experience today?',
    quick_replies: [
      { title: '5 ⭐', payload: `FEEDBACK_RATE_5_${orderNumber}` },
      { title: '4 ⭐', payload: `FEEDBACK_RATE_4_${orderNumber}` },
      { title: '3 ⭐', payload: `FEEDBACK_RATE_3_${orderNumber}` },
      { title: '2 ⭐', payload: `FEEDBACK_RATE_2_${orderNumber}` },
      { title: '1 ⭐', payload: `FEEDBACK_RATE_1_${orderNumber}` }
    ]
  });
}

async function resetChat() {
  document.getElementById('chat-messages').innerHTML = '';
  await sendSimulatedPayload('RESET_SESSION');
}

async function testInactivity(minutes) {
  try {
    API.toast(`Simulating ${minutes} minutes of customer inactivity...`, 'info');
    const res = await API.post('/chatbot/fast-forward-inactivity', {
      psid: SIMULATOR_PSID,
      minutes
    });
    if (res && res.success) {
      API.toast(`Fast-forwarded to ${minutes} mins! Bot message should arrive shortly.`, 'success');
    }
  } catch (err) {
    API.toast('Inactivity test error: ' + (err.message || 'Failed'), 'danger');
  }
}

// =============================================================================
// 🎭 13 Customer Personas AI-to-AI Simulation Harness
// =============================================================================

const PERSONAS_CONFIG = [
  {
    id: 1,
    name: "Persona 1: Ang Nagmamadali / One-Shot Orderer",
    desc: "Lahat ng detalye (pagkain, address, GCash, pangalan, phone) sa isang chat.",
    initial: "Padeliver po ng 2 Bacon Burger sa 123 Juan Luna St Tondo tapat ng Puregold, bayad ako via GCash Marco Santos 09171234567",
    followUps: ["Oo, tama"]
  },
  {
    id: 2,
    name: "Persona 2: Ang Gutom na Conyo / Slang & Taglish",
    desc: "Gumagamit ng conyo Taglish at colloquial aliases (classic burger at classic milktea).",
    initial: "Hey bro pabili naman ng 1 classic burger and 1 classic milktea with pearls please",
    followUps: ["Pick-up po", "Pangalan ko si Carlo 09181234567, Cash bayad", "Oo, tama"]
  },
  {
    id: 3,
    name: "Persona 3: Ang Discount Seeker (PhilHealth vs Senior ID)",
    desc: "Nagtatanong muna kung pwede PhilHealth ID, bago magbigay ng Senior ID.",
    initial: "Magandang araw po, pwede ba ang PhilHealth ID para sa 20% discount ng lola ko?",
    followUps: ["Senior Citizen ID na lang po: OSCA-998811"]
  },
  {
    id: 4,
    name: "Persona 4: Ang Palit-Isip / Cart Modifier",
    desc: "Mag-o-order muna ng Bacon Burger, tapos papalitan ng 2 Hungarian Pizza.",
    initial: "Pa-order po ng isang Bacon Burger",
    followUps: ["Ay tanggalin mo muna yung bacon burger kanina tapos palitan mo na lang ng 2 Hungarian Pizza"]
  },
  {
    id: 5,
    name: "Persona 5: Ang Puro Tanong / Menu Inquirer",
    desc: "Nagtatanong muna ng Wi-Fi at best sellers bago pumili ng dining mode.",
    initial: "Hello! May high-speed Wi-Fi ba kayo sa store tsaka ano pinakamasarap na kape niyo?",
    followUps: ["Dine-in po ako"]
  },
  {
    id: 6,
    name: "Persona 6: Ang Tipid / Budget Conscious",
    desc: "Naghahanap ng pinakamurang pagkain sa ilalim ng ₱100 pesos.",
    initial: "Ano po ang pinakamurang pagkain o burger ninyo na babagay sa student budget under 100 pesos?",
    followUps: ["Sige pabili niyan 1 piece"]
  },
  {
    id: 7,
    name: "Persona 7: Ang Strict Customizer (Allergy/Oatmilk)",
    desc: "May strict instruction na allergic sa dairy at kailangan ng oatmilk.",
    initial: "Pabili po ng 1 Spanish Latte for Dine-in pero paki-note na allergic ako sa dairy, oatmilk only please",
    followUps: ["Oo, tama"]
  },
  {
    id: 8,
    name: "Persona 8: Ang Out of Delivery Range (>3km)",
    desc: "Sinusubukang magpa-deliver sa malayong lokasyon (Quezon City Circle).",
    initial: "Pa-deliver po ng 2 Hungarian Pizza sa Quezon City Circle tapat ng City Hall",
    followUps: ["Sige pick up na lang dadaan ako mamaya"]
  },
  {
    id: 9,
    name: "Persona 9: Ang Galit / Frustrated (Inip sa Delay)",
    desc: "Naiinip at nagrereklamo sa delay gamit ang galit na ALL CAPS.",
    initial: "ANG TAGAL NAMAN NG ORDER KO BAKIT WALA PA KANINA PA AKO NAGHIHINTAY!",
    followUps: ["Salamat po sa pag-update"]
  },
  {
    id: 10,
    name: "Persona 10: Ang Picture Lover / Visual Menu",
    desc: "Humihingi ng actual picture ng Hungarian Pizza bago bumili.",
    initial: "Patingin nga po ng actual picture ng Hungarian Pizza ninyo kung masarap",
    followUps: ["Ang sarap nga tignan! Pabili po ako"]
  },
  {
    id: 11,
    name: "Persona 11: Ang Cancellation Seeker",
    desc: "Nag-cancel gamit ang natural Tagalog: 'wag na pala pa-cancel na lang'.",
    initial: "Wait nagkamali ako ng napindot, wag na pala pa-cancel na lang ng order ko",
    followUps: []
  },
  {
    id: 12,
    name: "Persona 12: Ang Rapid Flooder / Sunod-Sunod Mag-chat",
    desc: "Nagpapadala ng magkakahiwalay na chat nang mabilis.",
    initial: "Hi pabili burger at milktea",
    followUps: ["Dine in po", "Si Alex 09170001122 cash", "Oo, tama"]
  },
  {
    id: 13,
    name: "Persona 13: Ang Unstructured Details Sender",
    desc: "Nagbigay ng address at pangalan pero nakalimutan ang phone number.",
    initial: "delivery na lang sa 123 Juan Luna St Tondo malapit sa 7-11 tapos maya bayad ko, ako si Mark",
    followUps: ["09289998877", "Oo, tama"]
  }
];

let activeSimulationTimer = null;
let isSimulationRunning = false;

function initPersonaSelector() {
  const select = document.getElementById('sim-persona-select');
  if (!select) return;
  select.innerHTML = '';
  PERSONAS_CONFIG.forEach(p => {
    const opt = document.createElement('option');
    opt.value = p.id;
    opt.textContent = `#${p.id}: ${p.name.split(':')[1] || p.name}`;
    select.appendChild(opt);
  });
  onPersonaSelected();
}

function onPersonaSelected() {
  const select = document.getElementById('sim-persona-select');
  const goalBox = document.getElementById('sim-persona-goal');
  if (!select || !goalBox) return;
  const p = PERSONAS_CONFIG.find(x => x.id === parseInt(select.value, 10)) || PERSONAS_CONFIG[0];
  goalBox.innerHTML = `<strong>Tunguhin:</strong> ${escapeHtml(p.desc)}<br><span style="color: var(--brand-crema, #d4a373);">Mensahe: "${escapeHtml(p.initial)}"</span>`;
}

function fillPersonaPrompt() {
  const select = document.getElementById('sim-persona-select');
  const input = document.getElementById('chat-input-text');
  if (!select || !input) return;
  const p = PERSONAS_CONFIG.find(x => x.id === parseInt(select.value, 10)) || PERSONAS_CONFIG[0];
  input.value = p.initial;
  input.focus();
}

async function startAiSimulation() {
  if (isSimulationRunning) return;
  const select = document.getElementById('sim-persona-select');
  const p = PERSONAS_CONFIG.find(x => x.id === parseInt(select.value, 10)) || PERSONAS_CONFIG[0];
  const personaShortName = (p.name.split(':')[1] || p.name).trim();

  isSimulationRunning = true;
  document.getElementById('btn-play-sim').style.display = 'none';
  document.getElementById('btn-stop-sim').style.display = 'block';
  const badge = document.getElementById('ai-sim-badge');
  if (badge) {
    badge.className = 'badge badge-warning';
    badge.textContent = 'Playing...';
  }

  // Clear chat window and reset session state
  document.getElementById('chat-messages').innerHTML = '';
  await sendSimulatedPayload('RESET_SESSION');
  await new Promise(r => setTimeout(r, 600));

  API.toast(`Starting simulation: ${p.name}...`, 'info');

  const executeTurn = async (text) => {
    if (!isSimulationRunning) return;
    showTypingIndicator('user', `✍️ ${personaShortName} is typing...`);
    await new Promise(r => setTimeout(r, 900));
    removeTypingIndicator();
    appendUserMessage(text, `👤 ${personaShortName}`);
    showTypingIndicator('bot', '☕ DinerBot is typing...');
    await handleChatText(text);
  };

  // Turn 1: Initial message
  await executeTurn(p.initial);

  // Play remaining follow-up turns sequentially
  let followUpIdx = 0;
  const runNextFollowUp = async () => {
    if (!isSimulationRunning) return;
    if (followUpIdx < p.followUps.length) {
      const msg = p.followUps[followUpIdx++];
      activeSimulationTimer = setTimeout(async () => {
        if (!isSimulationRunning) return;
        await executeTurn(msg);
        runNextFollowUp();
      }, 3500);
    } else {
      activeSimulationTimer = setTimeout(() => {
        stopAiSimulation(true);
      }, 2500);
    }
  };

  runNextFollowUp();
}

function stopAiSimulation(completed = false) {
  isSimulationRunning = false;
  if (activeSimulationTimer) {
    clearTimeout(activeSimulationTimer);
    activeSimulationTimer = null;
  }
  const btnPlay = document.getElementById('btn-play-sim');
  const btnStop = document.getElementById('btn-stop-sim');
  const badge = document.getElementById('ai-sim-badge');
  if (btnPlay) btnPlay.style.display = 'block';
  if (btnStop) btnStop.style.display = 'none';
  if (badge) {
    badge.className = completed ? 'badge badge-success' : 'badge badge-secondary';
    badge.textContent = completed ? 'Completed ✅' : 'Stopped';
  }
  if (completed) {
    API.toast('🎉 AI Simulation finished successfully!', 'success');
  }
}
