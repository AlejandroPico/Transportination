import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { globalAircraft, satelliteElements, trains } from './providers.mjs';
import { createAisFeed } from './ais.mjs';
const dir = new URL('../data/', import.meta.url);
let previous = {};
try { previous = JSON.parse(await readFile(new URL('feed.json', dir), 'utf8')); } catch {
  try { previous = await (await fetch('https://alejandropico.github.io/Transportination/data/feed.json', { signal: AbortSignal.timeout(15000) })).json(); } catch { /* First publication. */ }
}
const results = await Promise.allSettled([globalAircraft(), trains()]);
const feed = { mode: 'snapshot', generatedAt: Date.now(), air: null, rail: null, sea: null, errors: [] };
results.forEach((r, i) => { const key = ['air', 'rail'][i]; if (r.status === 'fulfilled') feed[key] = r.value; else { feed[key] = previous[key] || null; feed.errors.push({ source: key, message: r.reason.message }); } });
const ais = createAisFeed();
if (process.env.AISSTREAM_API_KEY) { ais.start(); await new Promise(r => setTimeout(r, 45000)); feed.sea = ais.packet(); ais.stop(); }
else feed.sea = { items: [], status: 'unconfigured', source: 'AIS Stream' };
await mkdir(new URL('../data/', import.meta.url), { recursive: true });
await writeFile(new URL('../data/feed.json', import.meta.url), JSON.stringify(feed));
let orbital;
try { orbital = JSON.parse(await readFile(new URL('satellites.json', dir), 'utf8')); } catch { /* Fetch on first run. */ }
if (!orbital || Date.now() - orbital.fetchedAt > 7200000) {
  try { orbital = await satelliteElements(); } catch (e) { if (!orbital) throw e; console.log('CelesTrak no responde; se conserva la época anterior.'); }
}
await writeFile(new URL('satellites.json', dir), JSON.stringify(orbital));
await writeFile(new URL('config.json', dir), JSON.stringify({ liveApiUrl: process.env.LIVE_API_URL || '' }));
console.log(`Instantánea: ${feed.air?.items.length ?? 0} aviones, ${feed.rail?.items.length ?? 0} trenes. Errores: ${feed.errors.length}`);
if (!feed.air && !feed.rail) process.exitCode = 1;
