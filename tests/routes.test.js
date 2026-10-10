const test = require('node:test');
const assert = require('node:assert/strict');

const BASE_URL = 'http://localhost:3000';

test('Frontend Static Assets & Pages Routing Suite', async (t) => {
  const routes = [
    { path: '/', expectedStatus: 200, contentType: 'text/html' },
    { path: '/index.html', expectedStatus: 200, contentType: 'text/html' },
    { path: '/dashboard.html', expectedStatus: 200, contentType: 'text/html' },
    { path: '/simulator.html', expectedStatus: 200, contentType: 'text/html' },
    { path: '/rider.html', expectedStatus: 200, contentType: 'text/html' },
    { path: '/login.html', expectedStatus: 200, contentType: 'text/html' },
    { path: '/css/style.css', expectedStatus: 200, contentType: 'text/css' },
    { path: '/css/dashboard.css', expectedStatus: 200, contentType: 'text/css' },
    { path: '/css/simulator.css', expectedStatus: 200, contentType: 'text/css' },
    { path: '/js/api.js', expectedStatus: 200, contentType: 'text/javascript' },
    { path: '/js/dashboard.js', expectedStatus: 200, contentType: 'text/javascript' },
    { path: '/js/simulator.js', expectedStatus: 200, contentType: 'text/javascript' },
    { path: '/manifest.json', expectedStatus: 200, contentType: 'application/json' },
    { path: '/sw.js', expectedStatus: 200, contentType: 'text/javascript' },
    { path: '/delivery-check.html', expectedStatus: 200, contentType: 'text/html' }
  ];

  for (const r of routes) {
    await t.test(`Route ${r.path}`, async () => {
      const res = await fetch(`${BASE_URL}${r.path}`);
      assert.equal(res.status, r.expectedStatus);
      const ct = res.headers.get('content-type') || '';
      assert.ok(ct.includes(r.contentType.split('/')[1]) || ct.includes(r.contentType));
    });
  }
});
