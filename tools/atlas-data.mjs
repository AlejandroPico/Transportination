import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { csv } from './rail-schedules.mjs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const dir = new URL('../data/', import.meta.url);
const run = promisify(execFile);
const json = async url => {
  let r;
  try { r = await fetch(url, { signal: AbortSignal.timeout(45000) }); }
  catch (error) {
    // GitHub runners occasionally fail Undici's connection establishment to the
    // weather host. Curl uses the same public endpoint and network, without a proxy.
    // Do not retry HTTP refusals or quotas through another transport.
    if (!process.env.GITHUB_ACTIONS || new URL(url).hostname !== 'api.open-meteo.com') throw error;
    let result;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        result = await run('curl', ['--ipv4','--silent','--show-error','--connect-timeout','25','--max-time','45','--write-out','\n%{http_code}',url], { maxBuffer: 8000000 });
        break;
      } catch (connectionError) {
        // Retry only DNS/socket/TLS transport failures on the same endpoint.
        // Curl exits successfully for HTTP replies, which are handled below.
        if (![6,7,28,35,52,56].includes(connectionError.code) || attempt === 2) throw new Error('Open-Meteo: conexión interrumpida (' + connectionError.code + ')');
        await new Promise(resolve => setTimeout(resolve, 2000));
      }
    }
    const at = result.stdout.lastIndexOf('\n'), status=Number(result.stdout.slice(at+1));
    if(status!==200) { const failure=new Error('Open-Meteo HTTP '+status);if(status===429)failure.retryAt=Date.now()+3600000;throw failure; }
    return JSON.parse(result.stdout.slice(0,at));
  }
  if (!r.ok) { const error = new Error(`HTTP ${r.status}`); if (r.status === 429) { const after = r.headers.get('Retry-After'); error.retryAt = Number.isFinite(Number(after)) && after ? Date.now() + Number(after)*1000 : Date.parse(after) || Date.now()+3600000; } throw error; }
  return r.json();
};
async function cached(name, ttl, build) {
  let old;
  try { old = JSON.parse(await readFile(new URL(name, dir))); } catch {
    try { old = await json('https://alejandropico.github.io/Transportination/data/' + name); } catch { /* First edition. */ }
  }
  // Action caches are immutable. A restored file can precede a newer edition
  // already published by another run; reuse that edition before collecting again.
  if (old && Date.now() - old.fetchedAt >= ttl) {
    try {
      const published = await json('https://alejandropico.github.io/Transportination/data/' + name);
      if (published.fetchedAt > old.fetchedAt) old = published;
    } catch { /* The existing packet remains the dated fallback. */ }
  }
  if (old && (Date.now() - old.fetchedAt < ttl || Date.now() < old.retryAt)) { await mkdir(dir, { recursive: true }); await writeFile(new URL(name, dir), JSON.stringify(old)); return old; }
  try { const packet = await build(); await mkdir(dir, { recursive: true }); await writeFile(new URL(name, dir), JSON.stringify(packet)); return packet; }
  catch (error) { if (!old) throw error; old.error = error.message; if(error.retryAt) old.retryAt=error.retryAt; await writeFile(new URL(name, dir), JSON.stringify(old)); return old; }
}
export const collectAviation = () => cached('aviation.json', 86400000, async () => {
  const read = async name => { const r = await fetch(`https://davidmegginson.github.io/ourairports-data/${name}.csv`, { signal: AbortSignal.timeout(45000) }); if (!r.ok) throw new Error(`OurAirports ${r.status}`); return [...csv(await r.text())]; };
  const [airports, aids, runways] = await Promise.all([read('airports'), read('navaids'), read('runways')]);
  const valid = r => r.latitude_deg && r.longitude_deg && Math.abs(+r.latitude_deg) <= 90 && Math.abs(+r.longitude_deg) <= 180;
  return { fetchedAt: Date.now(), source: 'OurAirports · dominio público',
    airports: airports.filter(r => valid(r) && r.type !== 'closed').map(r => ({ id: r.id, name: r.name, code: r.iata_code || r.ident, lat: +r.latitude_deg, lon: +r.longitude_deg, type: r.type })),
    navaids: aids.filter(valid).map(r => ({ id: r.id, name: r.name, code: r.ident, lat: +r.latitude_deg, lon: +r.longitude_deg, type: r.type, frequency: r.frequency_khz })),
    runways: runways.filter(r => r.closed !== '1' && r.le_latitude_deg && r.he_latitude_deg && r.le_longitude_deg && r.he_longitude_deg).map(r => ({ airport: r.airport_ref, name: `${r.le_ident} / ${r.he_ident}`, a: [+r.le_longitude_deg, +r.le_latitude_deg], b: [+r.he_longitude_deg, +r.he_latitude_deg] })) };
});
export const collectAirspace = () => cached('airspace.json', 86400000, async () => {
  const url = 'https://services6.arcgis.com/ssFJjBXIUyZDrSYZ/arcgis/rest/services/Boundary_Airspace/FeatureServer/0/query';
  const params = new URLSearchParams({ f: 'geojson', where: "TYPE_CODE IN ('FIR','ARTCC','ACC')", outFields: 'IDENT,NAME,TYPE_CODE,COUNTRY', outSR: '4326', geometryPrecision: '4', maxAllowableOffset: '0.01', resultRecordCount: '2000' });
  const data = await json(url + '?' + params); if (data.properties?.exceededTransferLimit) throw new Error('FAA: respuesta truncada');
  if (!data.features?.length) throw new Error('FAA: sin límites publicados');
  return { fetchedAt: Date.now(), source: 'FAA · regiones publicadas en Boundary Airspace; cobertura parcial', features: data.features };
});
export const collectAirways = () => cached('airways.json', 86400000, async () => {
  const url = 'https://services6.arcgis.com/ssFJjBXIUyZDrSYZ/arcgis/rest/services/ATS_Route/FeatureServer/0/query';
  const features = [];
  for (let offset = 0; offset < 100000; offset += 2000) {
    const params = new URLSearchParams({ f: 'geojson', where: '1=1', outFields: 'OBJECTID,IDENT,LEVEL_', outSR: '4326', geometryPrecision: '4', maxAllowableOffset: '0.005', resultRecordCount: '2000', resultOffset: String(offset), orderByFields: 'OBJECTID' });
    const data = await json(url + '?' + params);
    if (!Array.isArray(data.features)) throw new Error('FAA: aerovías no disponibles');
    features.push(...data.features.map(f => ({ ...f, properties: { name: f.properties.IDENT, level: f.properties.LEVEL_, source: 'FAA' } })));
    if (!data.properties?.exceededTransferLimit) return { fetchedAt: Date.now(), source: 'FAA · ATS Route · uso público · cobertura parcial de EE. UU. y rutas publicadas del Pacífico', features };
    if (!data.features.length) throw new Error('FAA: paginación incompleta');
  }
  throw new Error('FAA: aerovías truncadas');
});
export const collectDfs = () => cached('aviation-dfs.json', 604800000, async () => {
  const base = 'https://haleconnect.com/ows/services/org.732.341f2791-919e-49de-8d86-3b18e040c430_wfs';
  const read = async type => {
    const features = [], ids = new Set();
    for (let start = 0; start < 50000; start += 1000) {
      const params = new URLSearchParams({ service: 'WFS', version: '2.0.0', request: 'GetFeature', typeNames: 'tn-a:' + type, count: '1000', startIndex: String(start), outputFormat: 'application/geo+json', srsName: 'urn:ogc:def:crs:OGC::CRS84' });
      const data = await json(base + '?' + params);
      if (!Array.isArray(data.features)) throw new Error('DFS: conjunto no disponible');
      for (const f of data.features) { if (ids.has(f.id)) throw new Error('DFS: paginación repetida'); ids.add(f.id); features.push(f); }
      if (data.features.length < 1000) return features;
    }
    throw new Error('DFS: conjunto truncado');
  };
  const [spaces, routes] = await Promise.all([read('AirspaceArea'), read('AirRouteLink')]);
  const rounded = g => JSON.parse(JSON.stringify(g, (_, v) => typeof v === 'number' ? Math.round(v * 100000) / 100000 : v));
  const name = p => p.geographicalName?.GeographicalName?.spelling?.SpellingOfName?.text;
  const features = spaces.filter(f => /\/(FIR|UIR|CTR|CTA|TMA|ACC)$/.test(f.properties.AirspaceAreaType?.href)).map(f => ({ type: 'Feature', geometry: rounded(f.geometry), properties: { NAME: name(f.properties), TYPE_CODE: f.properties.AirspaceAreaType.href.split('/').at(-1), COUNTRY: 'GERMANY', source: 'DFS' } }));
  const airways = routes.filter(f => !f.properties.fictitious && f.geometry).map(f => ({ type: 'Feature', geometry: rounded(f.geometry), properties: { name: name(f.properties), level: null, source: 'DFS' } }));
  if (!features.length || !airways.length) throw new Error('DFS: geometrías vacías');
  return { fetchedAt: Date.now(), source: '© DFS Deutsche Flugsicherung · INSPIRE · CC BY 4.0 · Alemania · actualización semestral', features, airways };
});
export const collectWeather = () => cached('weather.json', 21600000, async () => {
  // 2,376 locations × four collections/day = 9,504 location calls, below the free daily limit.
  // Four variables and one day remain within the provider's unweighted variable/time allowance.
  const coords = []; for (let lat = -80; lat <= 80; lat += 5) for (let lon = -180; lon < 180; lon += 5) coords.push([lon, lat]);
  // Pin the forecast window once. A collection can cross an hour boundary;
  // forecast_hours would then return different axes in later batches.
  const forecastStart = Math.floor(Date.now()/3600000)*3600000;
  const startHour = new Date(forecastStart).toISOString().slice(0,16);
  const endHour = new Date(forecastStart+23*3600000).toISOString().slice(0,16);
  const points = []; let times;
  for (let start = 0; start < coords.length; start += 100) {
    if (start) await new Promise(r => setTimeout(r, 11000));
    const batch = coords.slice(start, start + 100), p = new URLSearchParams({ latitude: batch.map(p => p[1]).join(','), longitude: batch.map(p => p[0]).join(','), hourly: 'temperature_2m,precipitation,wind_speed_10m,wind_direction_10m', start_hour: startHour, end_hour: endHour, timezone: 'GMT', cell_selection: 'nearest' });
    const data = await json('https://api.open-meteo.com/v1/forecast?' + p);
    if (!Array.isArray(data) || data.length !== batch.length) throw new Error('Open-Meteo: malla incompleta');
    for (let i = 0; i < data.length; i++) { const h = data[i].hourly; times ||= h.time.map(t => Date.parse(t + 'Z')); if (h.time.some((t, k) => Date.parse(t + 'Z') !== times[k])) throw new Error('Open-Meteo: horas incompatibles'); points.push({ lon: batch[i][0], lat: batch[i][1], temperature: h.temperature_2m, rain: h.precipitation, wind: h.wind_speed_10m, direction: h.wind_direction_10m }); }
  }
  return { fetchedAt: Date.now(), source: 'Open-Meteo · modelos numéricos · CC BY 4.0', resolution: 5, times, points };
});
