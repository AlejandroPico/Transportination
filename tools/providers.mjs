import { normalizeAircraft, normalizeTrains } from '../src/model.js';
export const USER_AGENT = 'Transportination/0.1 (+https://github.com/AlejandroPico/Transportination)';
export async function fetchJson(url) {
  const response = await fetch(url, { headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' }, signal: AbortSignal.timeout(18000) });
  if (!response.ok) throw new Error(`La fuente respondió HTTP ${response.status}`);
  return response.json();
}
export async function aircraft(lat = 40, lon = -3) {
  const data = await fetchJson(`https://api.adsb.lol/v2/point/${lat}/${lon}/250`);
  return { items: normalizeAircraft(data), fetchedAt: Date.now(), coverage: { lat, lon, radiusNm: 250 }, source: 'ADSB.lol' };
}
export async function trains() {
  const feeds = [ ['commuter', 'https://gtfsrt.renfe.com/vehicle_positions.json'], ['longDistance', 'https://gtfsrt.renfe.com/vehicle_positions_LD.json'] ];
  const results = await Promise.allSettled(feeds.map(async ([category, url]) => ({ category, items: normalizeTrains(await fetchJson(url), category) })));
  const items = [], errors = [];
  results.forEach((r, i) => { if (r.status === 'fulfilled') items.push(...r.value.items); else errors.push({ category: feeds[i][0], message: r.reason.message }); });
  if (errors.length === feeds.length) throw new Error('Las dos fuentes de Renfe no están disponibles');
  return { items, errors, fetchedAt: Date.now(), coverage: 'España · Renfe', source: 'Renfe' };
}
