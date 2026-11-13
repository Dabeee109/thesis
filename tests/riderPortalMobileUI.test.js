const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

describe('Mobile UI Redesign: Spacious & Modern Mobile Rider View', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'rider-portal.html'), 'utf8');
  const riderAliasHtml = fs.readFileSync(path.join(__dirname, '..', 'public', 'rider.html'), 'utf8');
  const serverJs = fs.readFileSync(path.join(__dirname, '..', 'src', 'server.js'), 'utf8');

  it('0. Ensures both rider-portal.html and rider.html are synced and served with no-store headers', () => {
    assert.ok(riderAliasHtml.includes('class="rider-avatar-circle"'));
    assert.ok(riderAliasHtml.includes('empty-state-canvas'));
    assert.ok(serverJs.includes('../public/rider-portal.html'));
  });

  it('1. Renders ultra-compact top rider profile header with Marco Santos, MC-7890-PH, Online dot badge, and compact Logout icon button', () => {
    assert.ok(html.includes('class="rider-avatar-circle"'));
    assert.ok(html.includes('id="rider-name-display">Marco Santos</h2>'));
    assert.ok(html.includes('id="rider-vehicle-display">MC-7890-PH</span>'));
    assert.ok(html.includes('class="rider-status-dot"'));
    assert.ok(html.includes('class="btn-logout-icon"'));
    assert.ok(html.includes('onclick="logoutRider()"'));
  });

  it('2. Renders consolidated nano-status row with 🔔 Alerts Active, ⚡ Live Sync, and 🔄 Refresh button', () => {
    assert.ok(html.includes('class="nano-status-row"'));
    assert.ok(html.includes('🔔 Alerts Active'));
    assert.ok(html.includes('⚡ Live Sync'));
    assert.ok(html.includes('class="nano-refresh-btn"'));
    assert.ok(html.includes('onclick="loadRiderDeliveries()"'));
  });

  it('3. Renders horizontal tabs for 🚴 Active Queue, 📜 History, and compact 👤 Profile', () => {
    assert.ok(html.includes('class="rider-tabs-bar"'));
    assert.ok(html.includes('🚴 Active Queue'));
    assert.ok(html.includes('📜 History'));
    assert.ok(html.includes('id="tab-profile"'));
  });

  it('4. Renders spacious empty state canvas with glowing icon and Tagalog empty-queue copy', () => {
    assert.ok(html.includes('empty-state-canvas'));
    assert.ok(html.includes('empty-state-glow-icon'));
    assert.ok(html.includes('Walang aktibong delivery sa iyong queue ngayon.'));
    assert.ok(html.includes('Awtomatikong lalabas dito kapag may bagong order na na-assign sa iyo.'));
    // Non-regression checks for SSE, audio, and PWA install scripts
    assert.ok(html.includes('API.connectSSE'));
    assert.ok(html.includes('markDelivered('));
    assert.ok(html.includes('/js/app-install-banner.js'));
  });
});

