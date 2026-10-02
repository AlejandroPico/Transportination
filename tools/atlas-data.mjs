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
    const result = await run('curl', ['--ipv4','--silent','--show-error','--connect-timeout','15','--max-time','45','--write-out','\n%{http_code}',url], { maxBuffer: 8000000 });
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
export const collectWeather = () => cached('weather.json', 21600000, async () => {
  // 2,376 locations × four collections/day = 9,504 location calls, below the free daily limit.
  // Four variables and one day remain within the provider's unweighted variable/time allowance.
  const coords = []; for (let lat = -80; lat <= 80; lat += 5) for (let lon = -180; lon < 180; lon += 5) coords.push([lon, lat]);
  const points = []; let times;
  for (let start = 0; start < coords.length; start += 100) {
    if (start) await new Promise(r => setTimeout(r, 11000));
    const batch = coords.slice(start, start + 100), p = new URLSearchParams({ latitude: batch.map(p => p[1]).join(','), longitude: batch.map(p => p[0]).join(','), hourly: 'temperature_2m,precipitation,wind_speed_10m,wind_direction_10m', forecast_hours: '24', timezone: 'GMT' });
    const data = await json('https://api.open-meteo.com/v1/forecast?' + p);
    if (!Array.isArray(data) || data.length !== batch.length) throw new Error('Open-Meteo: malla incompleta');
    for (let i = 0; i < data.length; i++) { const h = data[i].hourly; times ||= h.time.map(t => Date.parse(t + 'Z')); if (h.time.some((t, k) => Date.parse(t + 'Z') !== times[k])) throw new Error('Open-Meteo: horas incompatibles'); points.push({ lon: batch[i][0], lat: batch[i][1], temperature: h.temperature_2m, rain: h.precipitation, wind: h.wind_speed_10m, direction: h.wind_direction_10m }); }
  }
  return { fetchedAt: Date.now(), source: 'Open-Meteo · modelos numéricos · CC BY 4.0', resolution: 5, times, points };
});
