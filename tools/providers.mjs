import { normalizeAircraft, normalizeTrains, normalizeOpenSky } from '../src/model.js';
export const USER_AGENT = 'Transportination/0.2 (+https://github.com/AlejandroPico/Transportination)';
export async function fetchJson(url) {
  const response = await fetch(url, { headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' }, signal: AbortSignal.timeout(18000) });
  if (!response.ok) throw new Error(`La fuente respondió HTTP ${response.status}`);
  return response.json();
}
export async function aircraft(lat = 40, lon = -3) {
  const data = await fetchJson(`https://api.adsb.lol/v2/point/${lat}/${lon}/250`);
  return { items: normalizeAircraft(data), fetchedAt: Date.now(), coverage: { lat, lon, radiusNm: 250 }, source: 'ADSB.lol' };
}
let skyToken;
export async function globalAircraft() {
  const headers = { 'User-Agent': USER_AGENT };
  if (process.env.OPENSKY_CLIENT_ID && process.env.OPENSKY_CLIENT_SECRET) {
    if (!skyToken || skyToken.expiresAt < Date.now()) {
      const response = await fetch('https://auth.opensky-network.org/auth/realms/opensky-network/protocol/openid-connect/token', {
        method: 'POST', body: new URLSearchParams({ grant_type: 'client_credentials', client_id: process.env.OPENSKY_CLIENT_ID, client_secret: process.env.OPENSKY_CLIENT_SECRET }), signal: AbortSignal.timeout(18000),
      });
      if (!response.ok) throw new Error('La autenticación de OpenSky no está disponible');
      const data = await response.json(); skyToken = { value: data.access_token, expiresAt: Date.now() + (data.expires_in - 60) * 1000 };
    }
    headers.Authorization = `Bearer ${skyToken.value}`;
  }
  const response = await fetch('https://opensky-network.org/api/states/all?extended=1', { headers, signal: AbortSignal.timeout(25000) });
  if (!response.ok) throw new Error(`OpenSky respondió HTTP ${response.status}`);
  const data = await response.json();
  return { items: normalizeOpenSky(data), fetchedAt: Date.now(), coverage: 'Mundial · red de receptores OpenSky', source: 'OpenSky Network' };
}
export async function satelliteElements() {
  const records = await fetchJson('https://celestrak.org/NORAD/elements/gp.php?GROUP=active&FORMAT=json');
  return { records, fetchedAt: Date.now(), source: 'CelesTrak', coverage: 'Satélites activos publicados' };
}
export async function trains() {
  const feeds = [ ['commuter', 'https://gtfsrt.renfe.com/vehicle_positions.json'], ['longDistance', 'https://gtfsrt.renfe.com/vehicle_positions_LD.json'] ];
  const results = await Promise.allSettled(feeds.map(async ([category, url]) => ({ category, items: normalizeTrains(await fetchJson(url), category) })));
  const items = [], errors = [];
  results.forEach((r, i) => { if (r.status === 'fulfilled') items.push(...r.value.items); else errors.push({ category: feeds[i][0], message: r.reason.message }); });
  if (errors.length === feeds.length) throw new Error('Las dos fuentes de Renfe no están disponibles');
  return { items, errors, fetchedAt: Date.now(), coverage: 'España · Renfe', source: 'Renfe' };
}
