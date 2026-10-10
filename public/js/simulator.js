/**
 * Diner's Cafe Facebook Messenger Chatbot Web Simulator Controller
 */

const SIMULATOR_PSID = 'PSID_SIMULATOR_USER';
let currentSession = null;

document.addEventListener('DOMContentLoaded', async () => {
  // Check initial chatbot status
  checkBotStatus();

  // Connect to SSE for real-time bot responses & delivery notifications
  API.connectSSE((eventType, data) => {
    if (eventType === 'SIMULATOR_MESSAGE' && data.psid === SIMULATOR_PSID) {
      renderBotPayload(data.payload.message);
    }
    if (eventType === 'FEEDBACK_PROMPT_TRIGGERED' && data.psid === SIMULATOR_PSID) {
      renderFeedbackPrompt(data.orderNumber);
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
  } catch (e) {}
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

function appendUserMessage(text) {
  const container = document.getElementById('chat-messages');
  const div = document.createElement('div');
  div.className = 'chat-msg user';
  div.innerHTML = `<div class="bubble">${escapeHtml(text)}</div>`;
  container.appendChild(div);
  scrollToBottom();
}

function renderBotPayload(message) {
  const container = document.getElementById('chat-messages');

  // 1. Text Message
  if (message.text) {
    const div = document.createElement('div');
    div.className = 'chat-msg bot';
    div.innerHTML = `<div class="bubble">${escapeHtml(message.text)}</div>`;
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

      payload.elements.forEach(el => {
        const card = document.createElement('div');
        card.className = 'carousel-card';
        card.innerHTML = `
          <img src="${el.image_url || 'https://images.unsplash.com/photo-1541167760496-1628856ab772?w=500'}" alt="${el.title}">
          <div class="carousel-card-body">
            <div class="carousel-title">${el.title}</div>
            <div class="carousel-subtitle">${el.subtitle || ''}</div>
          </div>
          ${(el.buttons || []).map(btn => `
            <button class="carousel-btn" onclick="sendSimulatedPayload('${btn.payload}')">
              ${btn.title}
            </button>
          `).join('')}
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
    text: `🎉 Order #${orderNumber} has been delivered!\n\nHow was your food and delivery experience with Diner's Cafe? Please rate us:`,
    quick_replies: [
      { title: '⭐ 5 - Excellent', payload: `FEEDBACK_RATE_5_${orderNumber}` },
      { title: '⭐ 4 - Very Good', payload: `FEEDBACK_RATE_4_${orderNumber}` },
      { title: '⭐ 3 - Average', payload: `FEEDBACK_RATE_3_${orderNumber}` },
      { title: '⭐ 2 - Poor', payload: `FEEDBACK_RATE_2_${orderNumber}` },
      { title: '⭐ 1 - Terrible', payload: `FEEDBACK_RATE_1_${orderNumber}` }
    ]
  });
}

async function resetChat() {
  document.getElementById('chat-messages').innerHTML = '';
  await sendSimulatedPayload('CLEAR_CART');
}
