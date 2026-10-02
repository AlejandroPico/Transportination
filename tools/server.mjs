import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { aircraft, globalAircraft, satelliteElements, trains, fetchJson } from './providers.mjs';
import { createAisFeed } from './ais.mjs';
try { process.loadEnvFile?.(); } catch (e) { if (e.code !== 'ENOENT') throw e; }
const root = fileURLToPath(new URL('../', import.meta.url));
const cache = new Map(), inFlight = new Map();
let searchQueue = Promise.resolve(), lastSearch = 0;
async function cached(key, ttl, get) {
  const entry = cache.get(key);
  if (entry && Date.now() - entry.at < ttl) return entry.data;
  if (inFlight.has(key)) return inFlight.get(key);
  const promise = get().then(data => {
    if (cache.size >= 64) { const expendable = [...cache.keys()].find(k => k.startsWith('search:') || k.startsWith('air:')); if (expendable) cache.delete(expendable); }
    cache.set(key, { at: Date.now(), data }); return data;
  }).finally(() => inFlight.delete(key));
  inFlight.set(key, promise); return promise;
}
function json(res, status, data) { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(data)); }
export function createServer() {
  const ais = createAisFeed();
  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://localhost');
      const origin = req.headers.origin;
      const allowed = (process.env.ALLOWED_ORIGINS || 'https://alejandropico.github.io').split(',');
      if (origin && allowed.includes(origin)) { res.setHeader('Access-Control-Allow-Origin', origin); res.setHeader('Vary', 'Origin'); }
      if (req.method === 'OPTIONS') { res.writeHead(204, { 'Access-Control-Allow-Methods': 'GET, OPTIONS' }); return res.end(); }
      if (req.method !== 'GET') return json(res, 405, { error: 'Método no permitido' });
      if (url.pathname === '/api/status') return json(res, 200, { mode: 'live', version: '0.2.0', worldRefreshMs: process.env.OPENSKY_CLIENT_ID && process.env.OPENSKY_CLIENT_SECRET ? 90000 : 900000, ships: ais.packet().status });
      if (url.pathname === '/api/aircraft/world') return json(res, 200, await cached('air-world', process.env.OPENSKY_CLIENT_ID ? 90000 : 900000, globalAircraft));
      if (url.pathname === '/api/aircraft') {
        const lat = Number(url.searchParams.get('lat')), lon = Number(url.searchParams.get('lon'));
        if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) return json(res, 400, { error: 'Coordenadas inválidas' });
        const a = Math.round(lat * 2) / 2, b = Math.round(lon * 2) / 2;
        return json(res, 200, await cached(`air:${a}:${b}`, 20000, () => aircraft(a, b)));
      }
      if (url.pathname === '/api/trains') return json(res, 200, await cached('rail', 20000, trains));
      if (url.pathname === '/api/ships') return json(res, 200, ais.packet());
      if (url.pathname === '/api/satellites') return json(res, 200, await cached('satellites', 7200000, satelliteElements));
      if (url.pathname === '/api/search') {
        const q = url.searchParams.get('q')?.trim();
        if (!q || q.length > 120) return json(res, 400, { error: 'Consulta inválida' });
        const data = await cached(`search:${q}`, 86400000, () => {
          const job = searchQueue.catch(() => {}).then(async () => {
            await new Promise(resolve => setTimeout(resolve, Math.max(0, 1100 - (Date.now() - lastSearch))));
            lastSearch = Date.now();
            return fetchJson(`https://nominatim.openstreetmap.org/search?format=jsonv2&limit=5&q=${encodeURIComponent(q)}`);
          });
          searchQueue = job; return job;
        });
        return json(res, 200, data);
      }
      if (url.pathname.startsWith('/api/')) return json(res, 404, { error: 'Servicio no conectado' });
      const decoded = decodeURIComponent(url.pathname);
      const target = path.resolve(root, '.' + (decoded === '/' ? '/index.html' : decoded));
      const publicPath = decoded === '/' || decoded === '/index.html' || /^\/(assets|src|data|vendor)\//.test(decoded);
      if (!publicPath || !target.startsWith(root) || decoded.includes('\\') || decoded.split('/').some(p => p.startsWith('.'))) return json(res, 403, { error: 'Acceso no permitido' });
      const types = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.json': 'application/json', '.svg': 'image/svg+xml', '.md': 'text/plain' };
      const body = await readFile(target);
      res.writeHead(200, { 'Content-Type': `${types[path.extname(target)] || 'application/octet-stream'}; charset=utf-8`, 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'strict-origin-when-cross-origin' });
      res.end(body);
    } catch (error) {
      json(res, error.code === 'ENOENT' ? 404 : 502, { error: error.code === 'ENOENT' ? 'Archivo no encontrado' : error.message });
    }
  });
  server.on('listening', () => ais.start());
  server.on('close', () => ais.stop());
  return server;
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT || 4173);
  createServer().listen(port, process.env.HOST || '127.0.0.1', () => console.log(`Transportination: http://localhost:${port}`));
}
