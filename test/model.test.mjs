import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeAircraft, normalizeTrains, freshness, isVisible, restoreFilters, searchVehicles } from '../src/model.js';
import { createServer } from '../tools/server.mjs';
test('ADS-B preserves age, converts units, and never substitutes a missing altitude with zero', () => {
  const [a] = normalizeAircraft({ now: 1800000000, ac: [{ hex: 'abc', lat: 40, lon: -3, flight: ' TEST1 ', alt_baro: 'ground', gs: 10, seen_pos: 90 }] });
  assert.equal(a.name, 'TEST1'); assert.equal(a.altitude, null); assert.equal(a.barometricAltitude, null);
  assert.equal(a.speed, 18.52); assert.equal(a.observedAt, 1800000000000 - 90000);
  assert.equal(freshness(a, 1800000000000), 'stale');
  assert.deepEqual(normalizeAircraft({ ac: [{ hex: 'invalid', lat: 91, lon: 2 }, { hex: 'missing', lon: 2 }] }), []);
});
test('Renfe distinguishes individual timestamps from feed dates and does not invent speed', () => {
  const entity = [{ id: 'VP_1', vehicle: { position: { latitude: 41.3, longitude: 2.1 }, vehicle: { id: '001', label: 'C2-001' }, currentStatus: 'STOPPED_AT' } }];
  const [t] = normalizeTrains({ header: { timestamp: '1800000000' }, entity }, 'commuter');
  assert.equal(t.timestampScope, 'feed'); assert.equal(t.speed, null); assert.equal(t.state, 'En estación');
  entity[0].vehicle.timestamp = '1799999700';
  const [old] = normalizeTrains({ header: { timestamp: '1800000000' }, entity }, 'commuter');
  assert.equal(old.timestampScope, 'position'); assert.equal(freshness(old, 1800000000000), 'stale');
  assert.equal(normalizeTrains({ entity }, 'commuter')[0].observedAt, 1799999700000);
  delete entity[0].vehicle.timestamp;
  assert.equal(normalizeTrains({ entity }, 'commuter')[0].observedAt, null);
});
test('Independent transport and subcategory filters compose, saved preferences are validated', () => {
  const f = restoreFilters({ air: false, commuter: false, rail: 'false', unknown: true });
  assert.equal(f.rail, true); assert.equal(isVisible({ kind: 'rail', category: 'longDistance' }, f), true);
  assert.equal(isVisible({ kind: 'rail', category: 'commuter' }, f), false);
  assert.equal(isVisible({ kind: 'air', category: 'airLarge' }, f), false);
  assert.deepEqual(searchVehicles([{ name: 'IBE123', registration: 'EC-XYZ' }, { name: 'C2-001' }], ' ec-xyz '), [{ name: 'IBE123', registration: 'EC-XYZ' }]);
});
test('Server serves the app but rejects private files, unsupported methods and invalid coordinates', async () => {
  const server = createServer(); await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  try {
    assert.equal((await fetch(origin + '/')).status, 200);
    assert.equal((await fetch(origin + '/.git/config')).status, 403);
    assert.equal((await fetch(origin + '/src/%5c../%5c.git/config')).status, 403);
    assert.equal((await fetch(origin + '/tools/server.mjs')).status, 403);
    assert.equal((await fetch(origin + '/api/aircraft?lat=91&lon=0')).status, 400);
    assert.equal((await fetch(origin + '/api/status', { method: 'POST' })).status, 405);
    assert.equal((await (await fetch(origin + '/api/status')).json()).mode, 'live');
  } finally { await new Promise(resolve => server.close(resolve)); }
});
