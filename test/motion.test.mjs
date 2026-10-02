import test from 'node:test';
import assert from 'node:assert/strict';
import { journeyProgress, estimateTrain, prepareShape, observationTween, altitudeColor, interpolate } from '../src/motion.js';
import { RailEngine } from '../src/rail-engine.js';
import { csv, serviceDays, dayEpoch, parseGtfs } from '../tools/rail-schedules.mjs';
import { northAmericanRail, finnishRail } from '../src/rail.js';
const journey = { id: 'j', trip: 'trip', country: 'España', category: 'commuter', source: 'test', publishedAt: 500, stops: [
  { id: 'A', name: 'Origen', lat: 0, lon: 0, arrival: 1000, departure: 2000 },
  { id: 'B', name: 'Intermedia', lat: 0, lon: 1, arrival: 12000, departure: 16000 },
  { id: 'C', name: 'Destino', lat: 0, lon: 2, arrival: 26000, departure: 26000 },
] };
test('Schedule motion respects station dwell, future departures, arrivals and cancellations without claiming GPS', () => {
  assert.equal(estimateTrain(journey, 999), null); assert.equal(estimateTrain(journey, 26001), null);
  assert.equal(estimateTrain({ ...journey, cancelled: true }, 7000), null);
  const mid = estimateTrain(journey, 7000); assert.equal(mid.lon, .5); assert.equal(mid.positionMode, 'schedule'); assert.equal(mid.observedAt, null); assert.equal(mid.scheduleAt, 500);
  assert.equal(journeyProgress(journey, 14000).lon, 1); assert.equal(journeyProgress(journey, 14000).atStation, true);
  assert.equal(journeyProgress(journey, 21000).previous, 1);
});
test('Published shapes carry estimated positions along curves; unrelated shapes are rejected', () => {
  const j = { ...journey, stops: [journey.stops[0], { ...journey.stops[2], arrival: 12000 }] };
  const geometry = prepareShape(j, [[0, 0], [1, .5], [2, 0]]); assert.ok(geometry);
  assert.equal(journeyProgress({ ...j, geometry }, 7000).lat, .5);
  assert.equal(prepareShape(j, [[30, 40], [31, 41]]), null);
});
test('Observations interpolate only between recent distinct samples, never extrapolate old snapshots', () => {
  const a = { kind: 'air', lat: 0, lon: 0, observedAt: 1000 }, b = { ...a, lon: .01, observedAt: 6000 };
  assert.ok(observationTween(a, b, 7000)); assert.equal(observationTween(a, b, 100000), null); assert.equal(observationTween(a, a, 2000), null);
  assert.equal(observationTween(a, { ...b, lon: 90 }, 7000), null);
  assert.equal(interpolate({ lat: 0, lon: 179 }, { lat: 0, lon: -179 }, .5).lon, -180);
  assert.notEqual(altitudeColor(1000), altitudeColor(10000));
});
test('Rail positions prioritize fresh observations, attach a single journey and apply published delays', () => {
  const engine = new RailEngine(); engine.setJourneys([journey], [{ tripUpdate: { trip: { tripId: 'trip' }, delay: 2 } }]);
  engine.receive([{ id: 'real', kind: 'rail', source: 'Renfe', trip: 'trip', observedAt: 4000, lat: 1, lon: 1 }]);
  let p = engine.positions(7000); assert.equal(p.length, 1); assert.equal(p[0].positionMode, 'observed'); assert.equal(p[0].journey.stops[0].departure, 4000);
  p = engine.positions(140000); assert.equal(p.length, 1); assert.equal(p[0].observedAt, 4000, 'An expired trip does not animate indefinitely');
  engine.setJourneys([journey], [{ tripUpdate: { trip: { tripId: 'trip', scheduleRelationship: 'CANCELED' } } }]); assert.equal(engine.positions(7000).length, 0);
});
test('GTFS calendar exceptions, quoted fields, overnight hours and local timezone are respected', () => {
  assert.deepEqual([...csv('id,name\n1,"Station, \\"North\\""\n'.replaceAll('\\"', '""'))][0], { id: '1', name: 'Station, "North"' });
  const files = {
    'calendar.txt': 'service_id,monday,tuesday,wednesday,thursday,friday,saturday,sunday,start_date,end_date\ns,1,1,1,1,1,0,0,20260101,20261231',
    'calendar_dates.txt': 'service_id,date,exception_type\ns,20261002,2\ns,20261003,1',
    'routes.txt': 'route_id,route_type,route_short_name\nr,2,R\nb,3,Bus',
    'stops.txt': 'stop_id,stop_name,stop_lat,stop_lon\nA,A,40,0\nB,B,41,0',
    'trips.txt': 'route_id,service_id,trip_id\nr,s,night\nb,s,bus',
    'stop_times.txt': 'trip_id,stop_id,arrival_time,departure_time,stop_sequence\nnight,A,23:50:00,23:55:00,1\nnight,B,25:15:00,25:15:00,2',
  };
  const days = serviceDays(files, ['20261002', '20261003']); assert.equal(days.get('20261002').size, 0); assert.equal(days.get('20261003').has('s'), true);
  const parsed = parseGtfs(files, { key: 'x', zone: 'Europe/Madrid' }, ['20261002', '20261003']); assert.equal(parsed.journeys.length, 1);
  assert.equal(parsed.journeys[0].stops[1].arrival, Date.parse('2026-10-03T23:15:00Z'));
  assert.equal(dayEpoch('20261003', 'Europe/Madrid'), Date.parse('2026-10-02T22:00:00Z'));
});
test('International adapters preserve observation dates, operators and commercial stops', () => {
  const n = northAmericanRail({ 1: [{ trainID: '1-1', trainNum: '1', provider: 'Via', trainState: 'Active', lat: 40, lon: 0, lastValTS: '2026-10-02T10:00:00Z', updatedAt: '2026-10-02T10:05:00Z', stations: [{ code: 'A', name: 'A', schArr: '2026-10-02T10:00:00Z', schDep: '2026-10-02T10:01:00Z' }, { code: 'B', name: 'B', schArr: '2026-10-02T11:00:00Z', schDep: '2026-10-02T11:00:00Z' }] }] }, { A: { lat: 40, lon: 0 }, B: { lat: 41, lon: 0 } });
  assert.equal(n.items[0].observedAt, Date.parse('2026-10-02T10:00:00Z')); assert.equal(n.items[0].country, 'Canadá'); assert.equal(n.journeys[0].stops.length, 2);
  const fi = finnishRail([{ departureDate: '2026-10-02', trainNumber: 1, timestamp: '2026-10-02T10:00:00Z', location: { coordinates: [24, 60] }, isGpsLocation: true }], [{ departureDate: '2026-10-02', trainNumber: 1, runningCurrently: true, trainCategory: 'Commuter', timeTableRows: [{ stationShortCode: 'A', type: 'DEPARTURE', commercialStop: true, scheduledTime: '2026-10-02T10:00:00Z' }, { stationShortCode: 'B', type: 'ARRIVAL', commercialStop: true, scheduledTime: '2026-10-02T11:00:00Z' }] }], [{ stationShortCode: 'A', stationName: 'A', latitude: 60, longitude: 24 }, { stationShortCode: 'B', stationName: 'B', latitude: 61, longitude: 24 }]);
  assert.equal(fi.items[0].state, 'Posición GPS'); assert.equal(fi.journeys[0].category, 'commuter');
});
