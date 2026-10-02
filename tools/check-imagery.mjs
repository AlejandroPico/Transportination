import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
const require = createRequire(import.meta.url), { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const browser = await chromium.launch({ channel: 'msedge', headless: true, args: ['--enable-webgl', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } }), tiles = [], failures = [], errors = [];
  page.on('pageerror', e => { errors.push(e.message); console.log('Page error:', e.message); });
  page.on('response', r => { if (r.url().includes('World_Imagery/MapServer/tile/')) { if (r.status() === 200) tiles.push(r.url()); else failures.push([r.status(), r.url()]); } });
  await page.addInitScript(() => localStorage.setItem('transportination.preferences', JSON.stringify({ version: 2, base: 'satellite', filters: { air: false, rail: false, sea: false, space: false }, railways: false })));
  await page.route('**/api/status', r => r.fulfill({ status: 404, body: '{}' }));
  await page.route('**/nominatim.openstreetmap.org/**', r => r.fulfill({ contentType: 'application/json', body: JSON.stringify([{ lat: '41.3874', lon: '2.1686', name: 'Barcelona', display_name: 'Barcelona', type: 'city' }]) }));
  await page.goto(process.env.TEST_ORIGIN || 'http://localhost:4174');
  await page.waitForFunction(() => document.getElementById('loading').hidden);
  await page.locator('[data-panel="search"]').click(); await page.locator('#query').fill('Barcelona'); await page.locator('#query').press('Enter'); await page.locator('[data-result-place]').click();
  await page.waitForFunction(() => document.getElementById('zoom').textContent === '27.143%');
  await page.mouse.move(640, 400);
  for (let i = 0; i < 7; i++) { await page.mouse.wheel(0, -800); await page.waitForTimeout(500); }
  await page.waitForTimeout(10000);
  console.log('Imagery tiles', tiles.length, 'max level', Math.max(...tiles.map(t => +t.split('/tile/')[1].split('/')[0])), 'failures', JSON.stringify(failures.slice(0, 5)));
  assert.ok(tiles.some(t => +t.split('/tile/')[1].split('/')[0] >= 17), 'Real imagery tiles must load at street detail');
  assert.deepEqual(errors, []);
  await page.screenshot({ path: 'artifacts/v02-street.png' });
} finally { await browser.close(); }
