const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('Mobile Sidebar Drawer Scroll & Auto-Close Bug Fix', async (t) => {
  const html = fs.readFileSync(path.join(__dirname, '../public/dashboard.html'), 'utf8');
  const css = fs.readFileSync(path.join(__dirname, '../public/css/dashboard.css'), 'utf8');
  const js = fs.readFileSync(path.join(__dirname, '../public/js/dashboard.js'), 'utf8');

  await t.test('1. Removes premature touchend auto-close listener on .nav-item and guards resize handler', () => {
    assert.ok(
      !js.includes("item.addEventListener('touchend', closeOnNav"),
      'Must not attach touchend auto-close listener to .nav-item'
    );
    assert.ok(
      js.includes('lastViewportWidth') && js.includes('crossedToDesktop'),
      'Resize listener must only close mobile drawer when crossing desktop width breakpoint, ignoring height-only mobile browser bar changes'
    );
  });

  await t.test('2. Isolates sidebar internal scrolling and locks background body overflow', () => {
    assert.ok(
      html.includes('overflow-y-auto overscroll-contain'),
      'Sidebar container and nav-menu must include overflow-y-auto overscroll-contain classes'
    );
    assert.ok(
      css.includes('overscroll-behavior: contain'),
      'dashboard.css must set overscroll-behavior: contain on .nav-menu and .sidebar'
    );
    assert.ok(
      js.includes("document.body.style.overflow = nextOpenState ? 'hidden' : ''"),
      'toggleSidebar must lock document.body.style.overflow to hidden while mobile drawer is open'
    );
    assert.ok(
      js.includes("navMenu.addEventListener('scroll'") && js.includes("navMenu.addEventListener('touchmove'"),
      'navMenu scroll and touchmove must stopPropagation so scrolling never bubbles to backdrop'
    );
  });

  await t.test('3. Enforces strict explicit close triggers only (nav click without scroll drag, backdrop click, or toggle button)', () => {
    assert.ok(
      js.includes('if (isSidebarScrolling)'),
      'Must guard nav-item click handler against touch-scroll gestures'
    );
    assert.ok(
      js.includes('if (e.target !== backdrop) return;'),
      'Backdrop close handler must strictly verify e.target === backdrop'
    );
  });
});
