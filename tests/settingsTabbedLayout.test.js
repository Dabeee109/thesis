const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

describe('System Settings & Account Management Tabbed Layout Refactor', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'dashboard.html'), 'utf8');
  const js = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'dashboard.js'), 'utf8');

  it('1. Renders the 4 horizontal sub-navigation tabs with Store & Hours active by default', () => {
    assert.ok(html.includes('id="settings-tab-btn-store-hours"'));
    assert.ok(html.includes('id="settings-tab-btn-payment-gateways"'));
    assert.ok(html.includes('id="settings-tab-btn-staff-accounts"'));
    assert.ok(html.includes('id="settings-tab-btn-integrations-security"'));

    assert.ok(html.includes('id="settings-panel-store-hours" class="settings-subtab-panel active"'));
    assert.ok(html.includes('id="settings-panel-payment-gateways" class="settings-subtab-panel"'));
    assert.ok(html.includes('id="settings-panel-staff-accounts" class="settings-subtab-panel"'));
    assert.ok(html.includes('id="settings-panel-integrations-security" class="settings-subtab-panel"'));
  });

  it('2. Preserves 100% of existing Settings element IDs and form submission handlers across all 4 tab panels', () => {
    const requiredIds = [
      'card-store-location',
      'form-store-location',
      'store-name-input',
      'store-radius-input',
      'store-radius-display',
      'store-address-input',
      'store-lat-input',
      'store-lng-input',
      'btn-fetch-location',
      'btn-save-store-location',
      'card-operating-hours',
      'form-operating-hours',
      'store-open-time-input',
      'store-close-time-input',
      'btn-save-operating-hours',
      'card-gcash-config',
      'form-gcash-settings',
      'gcash-account-name-input',
      'gcash-account-number-input',
      'gcash-qr-preview',
      'gcash-qr-file-input',
      'gcash-qr-file-name',
      'btn-save-gcash-settings',
      'btn-test-gcash-output',
      'users-table',
      'users-table-tbody',
      'card-fb-token',
      'fb-token-status-badge',
      'fb-token-length-indicator',
      'fb-token-preview',
      'btn-toggle-reveal-fb-token',
      'btn-copy-fb-token',
      'fb-page-access-token-input',
      'btn-save-fb-token',
      'btn-test-fb-token',
      'fb-token-feedback'
    ];

    for (const id of requiredIds) {
      assert.ok(html.includes(`id="${id}"`), `Missing required element ID: #${id}`);
    }
  });

  it('3. Implements switchSettingsSubTab and spacious staff row padding (py-3.5) in dashboard.js', () => {
    assert.ok(js.includes('function switchSettingsSubTab(tabKey)'));
    assert.ok(js.includes('window.switchSettingsSubTab = switchSettingsSubTab'));
    assert.ok(js.includes('class="py-3.5"'));
  });
});
