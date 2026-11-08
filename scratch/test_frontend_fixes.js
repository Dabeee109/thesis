const fs = require('fs');
const assert = require('assert');

console.log('=== VERIFYING FRONTEND SECURITY & UI FIXES ===\n');

// 1. Verify manifest.json start_url
console.log('Checking manifest.json...');
const manifest = JSON.parse(fs.readFileSync('public/manifest.json', 'utf8'));
assert.strictEqual(manifest.start_url, '/login.html', 'start_url must be /login.html');
assert(!JSON.stringify(manifest).includes('/rider.html'), 'Direct operational shortcut to rider.html should not be in manifest');
console.log('✔ manifest.json start_url is /login.html');

// 2. Verify index.html cleanup
console.log('Checking index.html...');
const indexHtml = fs.readFileSync('public/index.html', 'utf8');
assert(!indexHtml.includes('Open Rider View'), 'Direct link to Open Rider View must be removed from index.html');
assert(!indexHtml.includes('Rider Mobile Portal'), 'Rider Mobile Portal direct shortcut must be removed from index.html');
assert(indexHtml.includes('login.html'), 'Staff login link must be present on index.html');
console.log('✔ index.html cleaned of operational rider shortcuts');

// 3. Verify Auth Guards in protected views
console.log('Checking Auth Guards in protected views...');
['public/dashboard.html', 'public/rider-portal.html', 'public/rider.html'].forEach(file => {
  const content = fs.readFileSync(file, 'utf8');
  assert(content.includes("window.location.replace('/login.html"), `${file} must contain auth redirect to /login.html`);
  assert(content.includes('isTokenValid'), `${file} must contain token validation logic in head`);
  console.log(`✔ Auth Guard present in ${file}`);
});

// 4. Verify Hamburger button & responsive fixes
console.log('Checking Hamburger button implementation...');
const dashboardJs = fs.readFileSync('public/js/dashboard.js', 'utf8');
assert(dashboardJs.includes('initSidebarToggle'), 'initSidebarToggle must exist in dashboard.js');
assert(dashboardJs.includes('touchend'), 'touchend handler must exist in dashboard.js for mobile/iPad');
assert(dashboardJs.includes('window.innerWidth <= 1024'), 'Breakpoint must support up to 1024px tablets');

const dashboardCss = fs.readFileSync('public/css/dashboard.css', 'utf8');
assert(dashboardCss.includes('@media (max-width: 1024px)'), 'CSS must include max-width: 1024px for tablet drawer');
assert(dashboardCss.includes('min-width: 44px'), 'Sidebar toggle button must have 44px touch target');
assert(dashboardCss.includes('touch-action: manipulation'), 'Sidebar toggle button must have touch-action: manipulation');
console.log('✔ Mobile hamburger button, touch event listeners, and tablet CSS verified');

console.log('\n=========================================');
console.log('ALL FRONTEND & SECURITY CHECKS PASSED!');
console.log('=========================================\n');
