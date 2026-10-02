import { mkdir, writeFile } from 'node:fs/promises';
import { aircraft, trains } from './providers.mjs';
const results = await Promise.allSettled([aircraft(40, -3), trains()]);
const feed = { mode: 'snapshot', generatedAt: Date.now(), air: null, rail: null, errors: [] };
results.forEach((r, i) => { const key = ['air', 'rail'][i]; if (r.status === 'fulfilled') feed[key] = r.value; else feed.errors.push({ source: key, message: r.reason.message }); });
await mkdir(new URL('../data/', import.meta.url), { recursive: true });
await writeFile(new URL('../data/feed.json', import.meta.url), JSON.stringify(feed));
console.log(`Instantánea: ${feed.air?.items.length ?? 0} aviones, ${feed.rail?.items.length ?? 0} trenes. Errores: ${feed.errors.length}`);
if (feed.errors.length === 2) process.exitCode = 1;
