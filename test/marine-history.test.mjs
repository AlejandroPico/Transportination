import test from 'node:test';
import assert from 'node:assert/strict';
import { applyMarineMessage, normalizeMarine } from '../src/marine.js';
import { currentFlightSamples, normalizeFlightTrack } from '../src/flight-history.js';
import { RouteView } from '../src/routes.js';

test('Marine REST and MQTT share an identity, keep position dates separate from metadata and reject AIS sentinels', () => {
  const now = Date.parse('2026-10-03T00:00:00Z'), id = 123456789;
  const items = normalizeMarine({ features: [{ mmsi: id, geometry: { type: 'Point', coordinates: [24, 60] }, properties: { timestamp: 7, timestampExternal: now - 5000, sog: 10, cog: 90 } }] }, [{ mmsi: id, timestamp: now, name: ' CARGO ', shipType: 70 }], now);
  assert.equal(items.length, 1); assert.equal(items[0].observedAt, now - 5000); assert.equal(items[0].speed, 18.52); assert.equal(items[0].category, 'shipCargo');
  const ships = new Map([[String(id), items[0]]]);
  applyMarineMessage(ships, id, { time: now / 1000, lat: 60.1, lon: 24.1, sog: 102.3, cog: 360 }, null, now);
  assert.equal(ships.size, 1); assert.equal(ships.get(String(id)).lat, 60.1); assert.equal(ships.get(String(id)).speed, null);
  applyMarineMessage(ships, id, null, { timestamp: now + 1000, type: 80, name: 'TANKER' }, now);
  assert.equal(ships.get(String(id)).observedAt, now); assert.equal(ships.get(String(id)).category, 'shipTanker');
  assert.equal(applyMarineMessage(ships, id, { time: now / 1000 - 10, lat: 59, lon: 23 }, null, now), false);
  assert.equal(applyMarineMessage(ships, id, { time: now / 1000 + 100, lat: 60, lon: 24 }, null, now), false);
  assert.equal(ships.get(String(id)).lat, 60.1);
});
test('Flight tracks preserve metre altitudes and exclude earlier legs of a reused callsign', () => {
  const packet = normalizeFlightTrack({ icao24: 'ABC123', callsign: ' IBE123 ', startTime: 1000, path: [[1000, 41, 2, 0, 0, true], [1030, 42, 3, 1000, 90, false], [1040, null, null, null, null, false]] });
  const points = packet.tracks['air:abc123']; assert.equal(points.length, 2); assert.equal(points[1].altitude, 1000); assert.equal(points[0].observedAt, 1000000);
  const flight = [{ name: 'IBE123', observedAt: 1000, ground: false }, { name: 'IBE123', observedAt: 2000, ground: true }, { name: 'IBE123', observedAt: 3000, ground: true }, { name: 'IBE123', observedAt: 4000, ground: false }, { name: 'OTHER', observedAt: 5000, ground: false }];
  assert.deepEqual(currentFlightSamples(flight, { name: 'IBE123', observedAt: 4000 }).map(p => p.observedAt), [3000, 4000]);
});
test('Long flights retain earlier observed samples and use solid altitude-colored traces in either projection', () => {
  const now = Date.now(), view = Object.create(RouteView.prototype); view.history = new Map(); view.clear = () => {}; view.viewer = { scene: { requestRender() {} } }; const lines = []; view.line = (...args) => lines.push(args);
  view.importHistory({ tracks: { 'air:abc123': [{ lon: 0, lat: 40, altitude: 6000, name: 'FL123', observedAt: now - 8 * 3600000 }, { lon: 1, lat: 40, altitude: 7000, name: 'FL123', observedAt: now - 7.75 * 3600000 }] } });
  view.draw({ id: 'air:abc123', kind: 'air', name: 'FL123', observedAt: now }, '#ffffff');
  assert.equal(view.history.get('air:abc123').length, 2); assert.equal(lines.length, 1); assert.equal(lines[0][2], false); assert.notEqual(lines[0][1], '#ffffff');
});
