import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { globalAircraft, satelliteElements, trains, internationalTrains, railDelays } from './providers.mjs';
import { collectSchedules } from './rail-schedules.mjs';
import { createAisFeed } from './ais.mjs';
import { collectAviation, collectAirspace, collectWeather } from './atlas-data.mjs';
import { irishRail } from './irish-rail.mjs';
const dir = new URL('../data/', import.meta.url);
let previous = {};
try { previous = JSON.parse(await readFile(new URL('feed.json', dir), 'utf8')); } catch {
  try { previous = await (await fetch('https://alejandropico.github.io/Transportination/data/feed.json', { signal: AbortSignal.timeout(15000) })).json(); } catch { /* First publication. */ }
}
const atlasResults = await Promise.allSettled([collectAviation(), collectAirspace(), collectWeather()]);
atlasResults.forEach((r, i) => console.log(['Infraestructura aérea', 'Regiones ATC', 'Meteorología'][i] + ': ' + (r.status === 'fulfilled' ? 'disponible' : r.reason.message)));
if (atlasResults.some(r => r.status === 'rejected')) throw new Error('No se publica una edición sin los conjuntos del atlas; se conserva la anterior.');
const results = await Promise.allSettled([globalAircraft(), trains()]);
const feed = { mode: 'snapshot', generatedAt: Date.now(), air: null, rail: null, sea: null, errors: [] };
results.forEach((r, i) => { const key = ['air', 'rail'][i]; if (r.status === 'fulfilled') feed[key] = r.value; else { feed[key] = previous[key] || null; feed.errors.push({ source: key, message: r.reason.message }); } });
const ais = createAisFeed();
if (process.env.AISSTREAM_API_KEY) { ais.start(); await new Promise(r => setTimeout(r, 45000)); feed.sea = ais.packet(); ais.stop(); }
else feed.sea = { items: [], status: 'unconfigured', source: 'AIS Stream' };
await mkdir(new URL('../data/', import.meta.url), { recursive: true });
await writeFile(new URL('../data/feed.json', import.meta.url), JSON.stringify(feed));
// Historical samples are retained across Pages editions with their observation times.
// Sparse snapshots are never presented as a continuous, second-by-second trace.
let airTracks = {};
try { airTracks = JSON.parse(await readFile(new URL('air-tracks.json', dir))).tracks || {}; } catch {
  try { airTracks = (await (await fetch('https://alejandropico.github.io/Transportination/data/air-tracks.json', { signal: AbortSignal.timeout(15000) })).json()).tracks || {}; } catch { /* First history. */ }
}
const cutoff = Date.now() - 7200000;
for (const [id, points] of Object.entries(airTracks)) { airTracks[id] = points.filter(p => p.observedAt >= cutoff); if (!airTracks[id].length) delete airTracks[id]; }
for (const item of [...(previous.air?.items || []), ...(feed.air?.items || [])]) {
  if (!item.observedAt || item.observedAt < cutoff) continue;
  const points = airTracks[item.id] ||= [];
  if (item.observedAt > (points.at(-1)?.observedAt || 0)) points.push({ lon: item.lon, lat: item.lat, altitude: item.altitude, observedAt: item.observedAt, name: item.name, ground: item.state === 'En tierra' });
}
await writeFile(new URL('air-tracks.json', dir), JSON.stringify({ fetchedAt: Date.now(), sampling: 'Instantáneas; intervalo previsto de 15 minutos, sujeto a retrasos de publicación', tracks: airTracks }));
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
