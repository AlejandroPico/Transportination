import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeAircraft, normalizeTrains, normalizeOpenSky, normalizeSatellites, mergeAircraft, freshness, isVisible, restoreFilters, searchVehicles } from '../src/model.js';
import { applyAisMessage } from '../tools/ais.mjs';
import { json2satrec, propagate, gstime, eciToGeodetic } from 'satellite.js';
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
  assert.equal(isVisible({ kind: 'air', category: 'airHeavy' }, f), false);
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
    assert.equal((await fetch(origin + '/api/status', { headers: { Origin: 'https://alejandropico.github.io' } })).headers.get('access-control-allow-origin'), 'https://alejandropico.github.io');
    assert.equal((await fetch(origin + '/api/status', { headers: { Origin: 'https://untrusted.example' } })).headers.get('access-control-allow-origin'), null);
    const ships = await (await fetch(origin + '/api/ships')).json();
    if (!process.env.AISSTREAM_API_KEY) { assert.equal(ships.status, 'unconfigured'); assert.deepEqual(ships.items, []); }
  } finally { await new Promise(resolve => server.close(resolve)); }
});
test('Global aviation retains aircraft outside the regional query and the newest observation wins', () => {
  const state = ['abc123', ' PAC123 ', 'USA', 1800000000, 1800000001, -122, 37, null, false, 200, 270, null, null, 10000, '1200', false, 0, 6];
  const [plane] = normalizeOpenSky({ states: [state, [...state.slice(0, 5), null, null]] });
  assert.equal(plane.category, 'airHeavy'); assert.equal(plane.speed, 720); assert.equal(plane.lon, -122);
  assert.equal(plane.altitude, 10000); assert.equal(plane.barometricAltitude, null);
  const newer = { ...plane, lat: 38, observedAt: plane.observedAt + 20000 };
  const europe = { ...plane, id: 'air:ee1', lon: 10, lat: 50 };
  assert.equal(mergeAircraft([plane], [europe]).length, 2);
  assert.equal(mergeAircraft([plane], [newer])[0].lat, 38);
  assert.equal(mergeAircraft([newer], [plane])[0].lat, 38);
});
test('AIS joins static ship types to positions and rejects unavailable coordinates and sentinel speed', () => {
  const ships = new Map(), meta = { MMSI: 123456789, ShipName: ' SHIP ', time_utc: '2026-10-02T19:00:00Z' };
  applyAisMessage({ MetaData: meta, MessageType: 'PositionReport', Message: { PositionReport: { Latitude: 91, Longitude: 181, Sog: 102.3, Cog: 360 } } }, ships);
  assert.equal(ships.get('123456789').lat, undefined);
  applyAisMessage({ MetaData: meta, MessageType: 'PositionReport', Message: { PositionReport: { Latitude: 42, Longitude: 3, Sog: 102.3, Cog: 360 } } }, ships);
  assert.equal(ships.get('123456789').speed, null); assert.equal(ships.get('123456789').bearing, null);
  applyAisMessage({ MetaData: meta, MessageType: 'ShipStaticData', Message: { ShipStaticData: { Type: 81, Name: 'TANKER', Destination: ' ROTTERDAM ' } } }, ships);
  assert.equal(ships.get('123456789').category, 'shipTanker'); assert.equal(ships.get('123456789').lat, 42);
  assert.equal(ships.get('123456789').destination, 'ROTTERDAM');
});
test('SGP4 derives moving positions from published orbital elements rather than simulated paths', () => {
  const omm = { OBJECT_NAME: 'ISS (ZARYA)', OBJECT_ID: '1998-067A', EPOCH: '2026-10-02T00:00:00', MEAN_MOTION: 15.49, ECCENTRICITY: .0002, INCLINATION: 51.64, RA_OF_ASC_NODE: 20, ARG_OF_PERICENTER: 120, MEAN_ANOMALY: 240, EPHEMERIS_TYPE: 0, CLASSIFICATION_TYPE: 'U', NORAD_CAT_ID: 25544, ELEMENT_SET_NO: 999, REV_AT_EPOCH: 50000, BSTAR: .0001, MEAN_MOTION_DOT: .00001, MEAN_MOTION_DDOT: 0 };
  const [sat] = normalizeSatellites([omm]); assert.equal(sat.category, 'satStation'); assert.equal(sat.epoch, omm.EPOCH + 'Z');
  const record = json2satrec(omm), time = new Date(omm.EPOCH + 'Z');
  const first = eciToGeodetic(propagate(record, time).position, gstime(time));
  const later = new Date(+time + 10000), second = eciToGeodetic(propagate(record, later).position, gstime(later));
  assert.ok(first.height > 300 && first.height < 500); assert.notEqual(first.longitude, second.longitude);
});
