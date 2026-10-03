import { gzipSync, gunzipSync } from 'node:zlib';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { globalAircraft, satelliteElements, trains, internationalTrains, railDelays } from './providers.mjs';
import { collectSchedules } from './rail-schedules.mjs';
import { createAisFeed } from './ais.mjs';
import { collectAviation, collectAirspace, collectAirways, collectDfs, collectWeather } from './atlas-data.mjs';
import { normalizeMarine } from '../src/marine.js';
import { irishRail } from './irish-rail.mjs';
const dir = new URL('../data/', import.meta.url);
let previous = {};
try { previous = JSON.parse(await readFile(new URL('feed.json', dir), 'utf8')); } catch {
  try { previous = await (await fetch('https://alejandropico.github.io/Transportination/data/feed.json', { signal: AbortSignal.timeout(15000) })).json(); } catch { /* First publication. */ }
}
const atlasResults = await Promise.allSettled([collectAviation(), collectAirspace(), collectWeather(), collectAirways(), collectDfs()]);
atlasResults.forEach((r, i) => console.log(['Infraestructura aérea', 'Regiones ATC', 'Meteorología', 'Aerovías FAA', 'Aviación DFS'][i] + ': ' + (r.status === 'fulfilled' ? 'disponible' : r.reason.message)));
if (atlasResults.some(r => r.status === 'rejected')) throw new Error('No se publica una edición sin los conjuntos del atlas; se conserva la anterior.');
const results = await Promise.allSettled([globalAircraft(), trains()]);
const feed = { mode: 'snapshot', generatedAt: Date.now(), air: null, rail: null, sea: null, errors: [] };
results.forEach((r, i) => { const key = ['air', 'rail'][i]; if (r.status === 'fulfilled') feed[key] = r.value; else { feed[key] = previous[key] || null; feed.errors.push({ source: key, message: r.reason.message }); } });
const ais = createAisFeed();
if (process.env.AISSTREAM_API_KEY) { ais.start(); await new Promise(r => setTimeout(r, 45000)); feed.sea = ais.packet(); ais.stop(); }
else feed.sea = { items: [], status: 'unconfigured', source: 'AIS Stream' };
try {
  const read = async endpoint => { const r = await fetch('https://meri.digitraffic.fi/api/ais/v1/' + endpoint, { headers: { 'Digitraffic-User': 'Transportination/0.5 (https://github.com/AlejandroPico/Transportination)' }, signal: AbortSignal.timeout(20000) }); if (!r.ok) throw new Error('Fintraffic AIS HTTP ' + r.status); return r.json(); };
  const [locations, metadata] = await Promise.all([read('locations'), read('vessels')]);
  const merged = new Map(normalizeMarine(locations, metadata).map(i => [i.id, i]));
  for (const i of feed.sea.items) if (!merged.has(i.id) || i.observedAt > merged.get(i.id).observedAt) merged.set(i.id, i);
  feed.sea.items = [...merged.values()]; feed.sea.fetchedAt = Date.now(); feed.sea.regionalSource = 'Fintraffic / Digitraffic · CC BY 4.0 · principalmente Báltico';
} catch (e) { feed.errors.push({ source: 'sea', message: e.message }); if (!feed.sea.items.length && previous.sea?.items?.length) feed.sea = previous.sea; }
await mkdir(new URL('../data/', import.meta.url), { recursive: true });
await writeFile(new URL('../data/feed.json', import.meta.url), JSON.stringify(feed));
// Historical samples are retained across Pages editions with their observation times.
// Sparse snapshots are never presented as a continuous, second-by-second trace.
let airTracks = {};
try {
  let archive;
  try { archive = await readFile(new URL('air-history.json.gz', dir)); }
  catch { const r = await fetch('https://alejandropico.github.io/Transportination/data/air-history.json.gz', { signal: AbortSignal.timeout(25000) }); if (r.ok) archive = Buffer.from(await r.arrayBuffer()); }
  if (archive) airTracks = JSON.parse(gunzipSync(archive)).tracks || {};
} catch { /* Older editions only retain the small legacy history. */ }

try { if (!Object.keys(airTracks).length) airTracks = JSON.parse(await readFile(new URL('air-tracks.json', dir))).tracks || {}; } catch {
  try { if (!Object.keys(airTracks).length) airTracks = (await (await fetch('https://alejandropico.github.io/Transportination/data/air-tracks.json', { signal: AbortSignal.timeout(15000) })).json()).tracks || {}; } catch { /* First history. */ }
}
const cutoff = Date.now() - 24 * 3600000;
for (const [id, points] of Object.entries(airTracks)) { airTracks[id] = points.filter(p => p.observedAt >= cutoff); if (!airTracks[id].length) delete airTracks[id]; }
for (const item of [...(previous.air?.items || []), ...(feed.air?.items || [])]) {
  if (!item.observedAt || item.observedAt < cutoff) continue;
  const points = airTracks[item.id] ||= [];
  if (item.observedAt > (points.at(-1)?.observedAt || 0)) points.push({ lon: item.lon, lat: item.lat, altitude: item.altitude, observedAt: item.observedAt, name: item.name, ground: item.state === 'En tierra' });
}
const historyPacket = { fetchedAt: Date.now(), sampling: 'Observaciones conservadas durante 24 horas; instantáneas espaciadas, no trayectoria exhaustiva', tracks: airTracks };
await writeFile(new URL('air-history.json.gz', dir), gzipSync(JSON.stringify(historyPacket)));
await mkdir(new URL('air-history/', dir), { recursive: true });
const shards = new Map();
for (const [id, points] of Object.entries(airTracks)) {
  if (!/^air:[0-9a-f]{6}$/.test(id)) continue;
  const prefix = id.slice(4, 6); if (!shards.has(prefix)) shards.set(prefix, {});
  shards.get(prefix)[id] = points;
}
for (const [prefix, tracks] of shards) await writeFile(new URL('air-history/' + prefix + '.json', dir), JSON.stringify({ fetchedAt: historyPacket.fetchedAt, sampling: historyPacket.sampling, tracks }));
// Keep the former two-hour file for already-open older clients.
const legacy = Object.fromEntries(Object.entries(airTracks).map(([id, p]) => [id, p.filter(s => s.observedAt > Date.now() - 7200000)]).filter(([, p]) => p.length));
await writeFile(new URL('air-tracks.json', dir), JSON.stringify({ ...historyPacket, tracks: legacy }));
const railway = await collectSchedules();
try { const irish = await irishRail(); railway.stations.push(...irish.stations); railway.journeys.push(...irish.journeys); railway.errors.push(...irish.errors); } catch(e) { railway.errors.push({ source: 'Irish Rail', message: e.message }); }
const [international, delays] = await Promise.allSettled([internationalTrains(), railDelays()]);
if (international.status === 'fulfilled') {
  railway.journeys.push(...international.value.journeys); railway.stations.push(...international.value.stations);
  railway.observations = international.value.items.map(({ journey, ...item }) => item);
  railway.errors.push(...international.value.errors);
} else railway.errors.push({ source: 'Ferrocarril internacional', message: international.reason.message });
railway.delays = delays.status === 'fulfilled' ? delays.value : { entities: [] };
await writeFile(new URL('rail-network.json', dir), JSON.stringify({ stations: railway.stations, shapes: railway.shapes }));
await writeFile(new URL('rail-journeys.json', dir), JSON.stringify({ journeys: railway.journeys, observations: railway.observations || [], delays: railway.delays, fetchedAt: railway.fetchedAt, errors: railway.errors }));
console.log(`Ferrocarril: ${railway.journeys.length} viajes con horarios y ${railway.observations?.length || 0} posiciones internacionales. Errores: ${railway.errors.length}`);
let orbital;
try { orbital = JSON.parse(await readFile(new URL('satellites.json', dir), 'utf8')); } catch { /* Fetch on first run. */ }
if (!orbital || Date.now() - orbital.fetchedAt > 7200000) {
  try { orbital = await satelliteElements(); } catch (e) { if (!orbital) throw e; console.log('CelesTrak no responde; se conserva la época anterior.'); }
}
await writeFile(new URL('satellites.json', dir), JSON.stringify(orbital));
await writeFile(new URL('config.json', dir), JSON.stringify({ liveApiUrl: process.env.LIVE_API_URL || '' }));
console.log(`Instantánea: ${feed.air?.items.length ?? 0} aviones, ${feed.rail?.items.length ?? 0} trenes. Errores: ${feed.errors.length}`);
if (!feed.air && !feed.rail) process.exitCode = 1;
