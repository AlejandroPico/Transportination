import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { unzipSync, strFromU8 } from 'fflate';
import { USER_AGENT } from './providers.mjs';
const cacheDir = new URL('../data/rail-cache/', import.meta.url);
const sources = [
  { key: 'es-ld', url: 'https://ssl.renfe.com/gtransit/Fichero_AV_LD/google_transit.zip', country: 'España', source: 'Renfe · GTFS', zone: 'Europe/Madrid', category: 'longDistance' },
  { key: 'es-cercanias', url: 'https://ssl.renfe.com/ftransit/Fichero_CER_FOMENTO/fomento_transit.zip', country: 'España', source: 'Renfe · GTFS', zone: 'Europe/Madrid', category: 'commuter' },
  { key: 'fr', url: 'https://eu.ftp.opendatasoft.com/sncf/plandata/Export_OpenData_SNCF_GTFS_NewTripId.zip', country: 'Francia', source: 'SNCF · GTFS', zone: 'Europe/Paris', category: 'railOther' },
];
export function* csv(text) {
  let cells = [], value = '', quoted = false, headers;
  text = text.replace(/^\uFEFF/, '');
  for (let i = 0; i <= text.length; i++) {
    const c = text[i];
    if (c === '"') { if (quoted && text[i + 1] === '"') { value += '"'; i++; } else quoted = !quoted; }
    else if (!quoted && (c === ',' || c === '\n' || c === undefined)) {
      cells.push(value.trim()); value = '';
      if (c !== ',') { if (cells.some(Boolean)) { if (!headers) headers = cells; else yield Object.fromEntries(headers.map((h, j) => [h, cells[j] || ''])); } cells = []; }
    } else value += c;
  }
}
export function serviceDays(files, days) {
  const active = new Map(days.map(d => [d, new Set()])), weekdays = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
  for (const r of csv(files['calendar.txt'] || '')) for (const d of days) {
    const weekday = weekdays[new Date(`${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}T12:00:00Z`).getUTCDay()];
    if (r.start_date <= d && r.end_date >= d && r[weekday] === '1') active.get(d).add(r.service_id);
  }
  for (const r of csv(files['calendar_dates.txt'] || '')) if (active.has(r.date)) {
    if (r.exception_type === '1') active.get(r.date).add(r.service_id);
    if (r.exception_type === '2') active.get(r.date).delete(r.service_id);
  }
  return active;
}
export function dayEpoch(day, zone) {
  const target = Date.UTC(+day.slice(0, 4), +day.slice(4, 6) - 1, +day.slice(6, 8));
  const formatter = new Intl.DateTimeFormat('en-GB', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' });
  // GTFS defines the origin as local noon minus twelve hours (including DST days).
  const localNoon = target + 43200000; let utcNoon = localNoon;
  for (let i = 0; i < 3; i++) { const p = Object.fromEntries(formatter.formatToParts(utcNoon).map(v => [v.type, v.value])); utcNoon += localNoon - Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second); }
  return utcNoon - 43200000;
}
const seconds = time => { const parts = time.split(':').map(Number); return parts.length === 3 && parts.every(Number.isFinite) ? parts[0] * 3600 + parts[1] * 60 + parts[2] : null; };
export function parseGtfs(files, config, days, publishedAt = Date.now()) {
  const active = serviceDays(files, days), stations = new Map(), routes = new Map(), trips = new Map(), shapes = {};
  for (const s of csv(files['stops.txt'] || '')) if (s.stop_lat && s.stop_lon && Math.abs(+s.stop_lat) <= 90 && Math.abs(+s.stop_lon) <= 180) stations.set(s.stop_id, { id: s.stop_id, name: s.stop_name, lat: +s.stop_lat, lon: +s.stop_lon });
  for (const r of csv(files['routes.txt'] || '')) if (['2', '100', '101', '102', '103', '106', '109'].includes(r.route_type)) routes.set(r.route_id, r);
  for (const t of csv(files['trips.txt'] || '')) {
    const on = days.filter(d => active.get(d).has(t.service_id));
    if (!on.length || !routes.has(t.route_id)) continue;
    trips.set(t.trip_id, { ...t, days: on, stops: [] });
  }
  for (const row of csv(files['stop_times.txt'] || '')) {
    const t = trips.get(row.trip_id), station = stations.get(row.stop_id), arrival = seconds(row.arrival_time), departure = seconds(row.departure_time);
    if (!t || !station || arrival === null || departure === null) continue;
    t.stops.push({ ...station, arrival, departure, sequence: +row.stop_sequence, commercial: row.pickup_type !== '1' || row.drop_off_type !== '1' });
  }
  const shapeIds = new Set([...trips.values()].map(t => t.shape_id).filter(Boolean));
  for (const s of csv(files['shapes.txt'] || '')) if (shapeIds.has(s.shape_id)) (shapes[config.key + ':' + s.shape_id] ||= []).push([+s.shape_pt_lon, +s.shape_pt_lat, +s.shape_pt_sequence]);
  Object.values(shapes).forEach(points => { points.sort((a, b) => a[2] - b[2]); points.forEach(p => p.pop()); });
  const journeys = [];
  for (const t of trips.values()) {
    if (t.stops.length < 2) continue;
    t.stops.sort((a, b) => a.sequence - b.sequence);
    const route = routes.get(t.route_id), code = t.trip_short_name || t.trip_headsign || t.trip_id;
    for (const day of t.days) {
      const start = dayEpoch(day, config.zone);
      const stops = t.stops.map(({ sequence, ...s }) => ({ ...s, arrival: start + s.arrival * 1000, departure: start + s.departure * 1000 }));
      if (stops.some((s, i) => s.departure < s.arrival || (i && s.arrival < stops[i - 1].departure))) continue;
      journeys.push({ id: 'rail:schedule:' + config.key + ':' + day + ':' + t.trip_id, trip: t.trip_id, code, name: [route.route_short_name, code].filter(Boolean).join(' '),
        operator: config.key === 'fr' ? 'SNCF / operadores del GTFS' : 'Renfe', country: config.country, category: config.category, source: config.source, dataset: config.key,
        timezone: config.zone, publishedAt, shapeKey: t.shape_id ? config.key + ':' + t.shape_id : null, stops });
    }
  }
  return { journeys, stations: [...stations.values()].map(s => ({ ...s, id: config.key + ':' + s.id })), shapes, fetchedAt: publishedAt, source: config.source };
}
export async function collectSchedules(now = Date.now()) {
  await mkdir(cacheDir, { recursive: true });
  const days = [-1, 0, 1].map(offset => new Date(now + offset * 86400000).toISOString().slice(0, 10).replaceAll('-', ''));
  const result = { journeys: [], stations: [], shapes: {}, fetchedAt: now, errors: [] };
  // Sequential processing keeps the large national stop-time tables out of memory together.
  for (const config of sources) {
    const target = new URL(config.key + '.json', cacheDir); let packet;
    try {
      try { const saved = JSON.parse(await readFile(target, 'utf8')); if (saved.day === days[1]) packet = saved.packet; } catch { /* First collection of the day. */ }
      if (!packet) {
        let body;
        if (process.env.GTFS_RESEARCH === '1') body = await readFile(new URL('../artifacts/gtfs/' + config.key + '.zip', import.meta.url));
        else { const response = await fetch(config.url, { headers: { 'User-Agent': USER_AGENT }, signal: AbortSignal.timeout(60000) }); if (!response.ok) throw new Error('HTTP ' + response.status); body = new Uint8Array(await response.arrayBuffer()); }
        const entries = unzipSync(body), files = {};
        for (const [name, bytes] of Object.entries(entries)) if (name.endsWith('.txt')) files[name.split('/').at(-1)] = strFromU8(bytes);
        packet = parseGtfs(files, config, days, now);
        await writeFile(target, JSON.stringify({ day: days[1], packet }));
      }
      result.journeys.push(...packet.journeys); result.stations.push(...packet.stations); Object.assign(result.shapes, packet.shapes);
    } catch (e) { result.errors.push({ source: config.source, message: e.message }); }
  }
  // Publish full routes for journeys intersecting this window; retain all network stations.
  result.journeys = result.journeys.filter(j => j.stops[0].departure < now + 14400000 && j.stops.at(-1).arrival > now - 7200000);
  return result;
}
