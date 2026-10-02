import { isVisible, ageSeconds, searchVehicles, restoreFilters, mergeAircraft, normalizeSatellites } from './model.js';
import { CATEGORY, KIND, markerSvg } from './catalog.js';
import { BASES, baseProvider, esriProvider, nasaProvider } from './layers.js';
const $ = id => document.getElementById(id);
const $$ = q => [...document.querySelectorAll(q)];
const HOME = { lon: 5, lat: 24, height: 19000000 };
const esc = s => String(s ?? 'Sin datos publicados').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const number = n => Number.isFinite(n) ? new Intl.NumberFormat('es-ES', { maximumFractionDigits: 0 }).format(n) : '—';
const date = n => n ? new Date(n).toLocaleString('es-ES', { timeZone: 'UTC' }) + ' UTC' : 'No publicada';
let saved = {};
try { saved = JSON.parse(localStorage.getItem('transportination.preferences') || '{}'); } catch { /* Optional storage. */ }
const filters = restoreFilters(saved.version === 2 ? saved.filters : { ...saved.filters, sea: true, space: false });
const colors = Object.fromEntries(Object.entries(CATEGORY).map(([key, c]) => [key, /^#[\da-f]{6}$/i.test(saved.colors?.[key]) ? saved.colors[key] : c.color]));
let base = saved.version === 2 && BASES.some(([key]) => key === saved.base) ? saved.base : 'satellite';
let viewer, C, apiRoot = '', mode = 'snapshot', activePanel, selected, worker, workerLoaded = false, morphing = false;
let globalAir = [], regionalAir = [], satellites = [], satellitePacket, orbitTime, noticeTimer, searchSequence = 0, lastSearch = 0;
const items = { air: [], rail: [], sea: [], space: [] }, packets = {}, errors = {}, stores = {}, symbols = new Map(), images = new Map(), busy = new Set();
let baseLayer, referenceLayer, railwayLayer, radarLayer, radarTime, cloudLayers = [], cloudTimes = [], lastRegion = '';
let worldRefreshMs = 900000;
let legendVisible = saved.legend === true;
let symbolSize = Number.isFinite(saved.symbolSize) ? Math.max(16, Math.min(36, saved.symbolSize)) : 24;
function persist() {
  try { localStorage.setItem('transportination.preferences', JSON.stringify({ version: 2, filters, colors, base, legend: legendVisible, symbolSize, railways: $('railways').checked, railOpacity: +$('rail-opacity').value, radar: $('radar').checked, clouds: $('clouds').checked })); } catch { /* Private browsing can disable storage. */ }
}
function notice(message) { $('notice').textContent = message; $('notice').hidden = false; clearTimeout(noticeTimer); noticeTimer = setTimeout(() => { $('notice').hidden = true; }, 6500); }
function openPanel(id) {
  activePanel = activePanel === id ? null : id;
  ['search', 'layers', 'filters'].forEach(key => { $(key).hidden = activePanel !== key; });
  $$('[data-panel]').forEach(b => b.setAttribute('aria-expanded', String(b.dataset.panel === activePanel)));
  document.body.classList.toggle('panel-open', !!activePanel);
  if (activePanel === 'search') $('query').focus();
}
function closePanels() { if (activePanel) openPanel(activePanel); }
$$('[data-panel]').forEach(b => b.addEventListener('click', () => openPanel(b.dataset.panel)));
$$('[data-close]').forEach(b => b.addEventListener('click', closePanels));
$('about-button').addEventListener('click', () => { closePanels(); updateStatus(); $('about').showModal(); });
$('about-close').addEventListener('click', () => $('about').close());
$('about').addEventListener('click', e => { if (e.target === $('about')) { const r = $('about').getBoundingClientRect(); if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) $('about').close(); } });
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') { closePanels(); closeDetail(); }
  if (e.key === '/' && !['INPUT', 'TEXTAREA'].includes(document.activeElement.tagName) && !$('about').open) { e.preventDefault(); if (activePanel !== 'search') openPanel('search'); }
});
function imageFor(category) {
  const key = category + colors[category];
  if (!images.has(key)) images.set(key, 'data:image/svg+xml,' + encodeURIComponent(markerSvg(category, colors[category])));
  return images.get(key);
}
function renderFilters() {
  $('transport-filters').innerHTML = Object.entries(KIND).map(([kind, label]) => `<details class="filter-group" ${kind === 'air' ? 'open' : ''}><summary>${label}</summary><label class="check-row master"><input type="checkbox" data-filter="${kind}" ${filters[kind] ? 'checked' : ''}><span>Mostrar ${label.toLowerCase()}</span></label>${Object.entries(CATEGORY).filter(([, c]) => c.kind === kind).map(([key, c]) => `<div class="category-row"><label class="check-row"><input type="checkbox" data-filter="${key}" ${filters[key] ? 'checked' : ''}><span>${esc(c.label)}</span></label><input type="color" data-color="${key}" value="${colors[key]}" aria-label="Color de ${esc(c.label)}" title="Color de ${esc(c.label)}"></div>`).join('')}<p class="small-note" id="state-${kind}"></p></details>`).join('');
  $$('[data-filter]').forEach(input => input.addEventListener('change', () => {
    filters[input.dataset.filter] = input.checked; persist(); refreshVisibility(); updateLegend();
    if (input.dataset.filter === 'space') updateOrbits();
    if (input.dataset.filter === 'sea' && filters.sea && mode === 'live') refreshShips();
  }));
  $$('[data-color]').forEach(input => input.addEventListener('input', () => { colors[input.dataset.color] = input.value; persist(); refreshVisibility(); updateLegend(); if (selected) showDetail(selected); }));
}
function updateLegend() {
  $('legend').hidden = !legendVisible;
  $('legend-check').checked = legendVisible;
  $('legend-toggle').setAttribute('aria-pressed', String(legendVisible));
  $('legend-toggle').setAttribute('aria-label', legendVisible ? 'Ocultar leyenda' : 'Mostrar leyenda');
  $('legend-toggle').title = legendVisible ? 'Ocultar leyenda' : 'Mostrar leyenda';
  $('legend-items').innerHTML = Object.entries(CATEGORY).filter(([key, c]) => filters[c.kind] && filters[key]).map(([key, c]) => `<div class="legend-row"><img src="${imageFor(key)}" alt="">${esc(c.label)}</div>`).join('');
}
function setLegend(value) { legendVisible = value; updateLegend(); persist(); }
$('legend-toggle').addEventListener('click', () => setLegend(!legendVisible));
$('legend-close').addEventListener('click', () => setLegend(false));
$('legend-check').addEventListener('change', () => setLegend($('legend-check').checked));
$('symbol-size').value = symbolSize;
$('symbol-size').addEventListener('input', () => { symbolSize = +$('symbol-size').value; refreshVisibility(); persist(); });
$('reset-colors').addEventListener('click', () => { Object.entries(CATEGORY).forEach(([key, c]) => { colors[key] = c.color; document.querySelector(`[data-color="${key}"]`).value = c.color; }); refreshVisibility(); updateLegend(); persist(); if (selected) showDetail(selected); });
function center() {
  const canvas = viewer.scene.canvas;
  const point = viewer.camera.pickEllipsoid(new C.Cartesian2(canvas.clientWidth / 2, canvas.clientHeight / 2), viewer.scene.globe.ellipsoid);
  const p = point ? C.Cartographic.fromCartesian(point) : viewer.camera.positionCartographic;
  return { lon: C.Math.toDegrees(C.Math.negativePiToPi(p.longitude)), lat: C.Math.toDegrees(p.latitude), height: Math.max(200, viewer.camera.positionCartographic.height) };
}
function fly(lon, lat, height = 50000) { viewer.camera.flyTo({ destination: C.Cartesian3.fromDegrees(lon, lat, height), duration: matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 1.2 }); }
$('zoom').addEventListener('click', () => { if (viewer && !morphing) fly(HOME.lon, HOME.lat, HOME.height); });
$('dimension').addEventListener('click', async () => {
  if (!viewer || morphing) return;
  const view = center(), to2D = viewer.scene.mode === C.SceneMode.SCENE3D;
  morphing = true; $('dimension').disabled = true; viewer.camera.cancelFlight();
  // Cesium's animated morph travels through a world camera and causes a severe local zoom jump.
  // Fade the projection change while preserving the exact center and viewing height instead.
  $('map').classList.add('switching');
  await new Promise(r => setTimeout(r, matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 150));
  if (to2D) viewer.scene.morphTo2D(0); else viewer.scene.morphTo3D(0);
  viewer.camera.setView({ destination: C.Cartesian3.fromDegrees(view.lon, view.lat, view.height) });
  $('dimension').querySelector('use').setAttribute('href', to2D ? '#i-globe' : '#i-flat');
  $('dimension').title = to2D ? 'Cambiar a 3D' : 'Cambiar a 2D';
  $('dimension').setAttribute('aria-label', $('dimension').title);
  viewer.scene.requestRender(); updateCamera();
  await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
  $('map').classList.remove('switching'); morphing = false; $('dimension').disabled = false;
});
function updateCamera() {
  if (!viewer) return;
  const p = center(), zoom = Math.max(1, Math.round(HOME.height / p.height * 100));
  $('zoom').textContent = number(zoom) + '%'; $('zoom').setAttribute('aria-label', `Restaurar vista, zoom ${zoom}%`);
  $('zoom').style.fontSize = $('zoom').textContent.length > 8 ? '9px' : '11px';
  $('coordinates').textContent = `${p.lat.toFixed(2)}° · ${p.lon.toFixed(2)}°`;
  if (railwayLayer) railwayLayer.show = $('railways').checked && p.height < 4000000;
}
$('base-list').innerHTML = BASES.map(([key, label]) => `<button class="base-option" data-base="${key}" aria-pressed="${base === key}">${label}<span aria-hidden="true">✓</span></button>`).join('');
function setBase(value) {
  if (baseLayer) viewer.imageryLayers.remove(baseLayer);
  if (referenceLayer) { viewer.imageryLayers.remove(referenceLayer); referenceLayer = null; }
  baseLayer = viewer.imageryLayers.addImageryProvider(baseProvider(C, value), 0); base = value;
  if (value === 'ocean') referenceLayer = viewer.imageryLayers.addImageryProvider(esriProvider(C, 'Ocean/World_Ocean_Reference', 16, 'Ocean reference © Esri, contributors'), 1);
  if (value === 'political') referenceLayer = viewer.imageryLayers.addImageryProvider(esriProvider(C, 'Canvas/World_Light_Gray_Reference', 16, 'Map labels © Esri, contributors'), 1);
  $$('[data-base]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.base === base)));
  persist(); viewer.scene.requestRender();
}
$$('[data-base]').forEach(b => b.addEventListener('click', () => { if (viewer) setBase(b.dataset.base); }));
$('railways').checked = saved.railways !== false;
$('rail-opacity').value = Number.isFinite(saved.railOpacity) ? Math.max(.05, Math.min(.7, saved.railOpacity)) : .25;
$('railways').addEventListener('change', () => { if (viewer) { updateCamera(); viewer.scene.requestRender(); } persist(); });
$('rail-opacity').addEventListener('input', () => { if (railwayLayer) { railwayLayer.alpha = +$('rail-opacity').value; viewer.scene.requestRender(); } persist(); });
$('radar').checked = saved.radar === true; $('clouds').checked = saved.clouds === true;
function weatherNote() {
  $('weather-note').textContent = [radarTime && $('radar').checked ? 'Radar: ' + date(radarTime * 1000) : '', cloudTimes.length && $('clouds').checked ? 'Infrarrojo: ' + cloudTimes.join(' · ') + '. Cobertura GOES y Himawari, resolución meteorológica.' : ''].filter(Boolean).join(' · ');
}
async function refreshRadar() {
  if (!viewer || busy.has('radar')) return;
  if (!$('radar').checked) { if (radarLayer) radarLayer.show = false; weatherNote(); viewer.scene.requestRender(); return; }
  busy.add('radar');
  try {
    const data = await getJson('https://api.rainviewer.com/public/weather-maps.json'), frame = data.radar?.past?.at(-1);
    if (!frame || !/^https:\/\/tilecache\.rainviewer\.com\/?$/.test(data.host)) throw new Error('Radar sin una imagen válida');
    if (radarTime !== frame.time || !radarLayer) {
      if (radarLayer) viewer.imageryLayers.remove(radarLayer);
      radarLayer = viewer.imageryLayers.addImageryProvider(new C.UrlTemplateImageryProvider({ url: `${data.host}${frame.path}/256/{z}/{x}/{y}/2/1_1.png`, maximumLevel: 7, credit: new C.Credit('<a href="https://www.rainviewer.com/">RainViewer</a>', true) }));
      radarLayer.alpha = .55; radarTime = frame.time;
    }
    radarLayer.show = $('radar').checked; weatherNote(); viewer.scene.requestRender();
  } catch (e) { $('weather-note').textContent = 'Radar: ' + e.message; } finally { busy.delete('radar'); }
}
async function refreshClouds() {
  if (!viewer || busy.has('clouds')) return;
  if (!$('clouds').checked) { cloudLayers.forEach(l => { l.show = false; }); weatherNote(); viewer.scene.requestRender(); return; }
  busy.add('clouds');
  try {
    const response = await fetch('https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/1.0.0/WMTSCapabilities.xml', { signal: AbortSignal.timeout(20000) });
    if (!response.ok) throw new Error('NASA no ha publicado la imagen');
    const xml = new DOMParser().parseFromString(await response.text(), 'application/xml');
    const names = ['GOES-East_ABI_Band13_Clean_Infrared', 'GOES-West_ABI_Band13_Clean_Infrared', 'Himawari_AHI_Band13_Clean_Infrared'];
    const latest = names.map(name => { const layer = [...xml.getElementsByTagNameNS('*', 'Layer')].find(l => l.getElementsByTagNameNS('*', 'Identifier')[0]?.textContent === name); const time = layer?.getElementsByTagNameNS('*', 'Default')[0]?.textContent; return { name, time }; }).filter(l => l.time && l.time !== 'default');
    if (!latest.length) throw new Error('No hay fechas de satélite disponibles');
    cloudLayers.forEach(l => viewer.imageryLayers.remove(l)); cloudLayers = [];
    latest.forEach(({ name, time }) => { const layer = viewer.imageryLayers.addImageryProvider(nasaProvider(C, name, 6, time, 'png')); layer.alpha = .45; layer.show = $('clouds').checked; cloudLayers.push(layer); });
    cloudTimes = [...new Set(latest.map(l => date(Date.parse(l.time))))]; weatherNote(); viewer.scene.requestRender();
  } catch (e) { $('weather-note').textContent = 'Satélite meteorológico: ' + e.message; } finally { busy.delete('clouds'); }
}
$('radar').addEventListener('change', () => { persist(); refreshRadar(); });
$('clouds').addEventListener('change', () => { persist(); refreshClouds(); });
function styleSymbol(symbol, item) {
  symbol.image = imageFor(item.category); symbol.width = symbolSize * (item.kind === 'space' ? .85 : 1); symbol.height = symbol.width;
  symbol.rotation = ['air', 'sea'].includes(item.kind) ? -C.Math.toRadians(item.bearing ?? 0) : 0;
  symbol.scale = selected?.id === item.id ? 1.4 : 1;
  symbol.show = isVisible(item, filters); // Every vehicle is a symbol, with no clustering or opacity penalty.
}
function syncSymbols(kind, incoming) {
  items[kind] = incoming;
  const ids = new Set(incoming.map(i => i.id));
  for (const [id, symbol] of symbols) if (symbol.id.transport.kind === kind && !ids.has(id)) { stores[kind].remove(symbol); symbols.delete(id); }
  incoming.forEach(item => {
    if (!Number.isFinite(item.lon) || !Number.isFinite(item.lat)) return;
    let symbol = symbols.get(item.id);
    if (!symbol) {
      symbol = stores[kind].add({ id: { transport: item }, position: C.Cartesian3.fromDegrees(item.lon, item.lat, Math.max(kind === 'air' ? 100 : 30, item.altitude ?? 30)), image: imageFor(item.category), alignedAxis: ['air', 'sea'].includes(kind) ? C.Cartesian3.UNIT_Z : C.Cartesian3.ZERO });
      symbols.set(item.id, symbol);
    } else { symbol.position = C.Cartesian3.fromDegrees(item.lon, item.lat, Math.max(kind === 'air' ? 100 : 30, item.altitude ?? 30)); symbol.id.transport = item; }
    styleSymbol(symbol, item);
  });
  if (selected?.kind === kind) { const next = incoming.find(i => i.id === selected.id); if (next) showDetail(next); else closeDetail(); }
  viewer.scene.requestRender(); updateStatus();
}
function refreshVisibility() {
  if (!viewer) return;
  for (const symbol of symbols.values()) styleSymbol(symbol, symbol.id.transport);
  if (selected && !isVisible(selected, filters)) closeDetail();
  viewer.scene.requestRender(); updateStatus();
}
function closeDetail() { if (selected && symbols.has(selected.id)) symbols.get(selected.id).scale = 1; selected = null; $('detail').hidden = true; document.body.classList.remove('detail-open'); viewer?.scene.requestRender(); }
function showDetail(item) {
  if (selected?.id !== item.id && selected && symbols.has(selected.id)) symbols.get(selected.id).scale = 1;
  selected = item; if (symbols.has(item.id)) symbols.get(item.id).scale = 1.4;
  const c = CATEGORY[item.category], isSpace = item.kind === 'space';
  const fields = [['Identificador', item.code], ['Matrícula', item.registration], ['Modelo', item.model], ['País de matrícula', item.country], ['Viaje', item.trip], ['Próxima parada · código', item.stop], ['Destino', item.destination], ['IMO', item.imo], ['Rumbo', Number.isFinite(item.bearing) ? number(item.bearing) + '°' : null]];
  if (isSpace) fields.push(['NORAD', item.code], ['Inclinación orbital', number(item.inclination) + '°'], ['Época orbital', date(Date.parse(item.epoch))]);
  const stamp = isSpace ? 'Calculada: ' + date(item.observedAt) : (item.timestampScope === 'feed' ? 'Fecha del conjunto: ' : 'Posición: ') + date(item.observedAt);
  const old = !isSpace && ageSeconds(item) > (item.kind === 'air' ? 60 : 120);
  $('detail').style.setProperty('--vehicle-color', colors[item.category]);
  $('detail').innerHTML = `<header class="panel-head"><span>${esc(KIND[item.kind])}</span><button id="detail-close" aria-label="Cerrar ficha"><svg><use href="#i-close"/></svg></button></header><div class="vehicle-hero"><img src="${imageFor(item.category)}" alt=""><div><h2 id="detail-title">${esc(item.name)}</h2><p>${esc(c.label)}</p></div></div><div class="vehicle-state">${esc(isSpace ? 'Órbita calculada · SGP4' : item.state)}${old ? ' · Posición atrasada' : ''}</div><div class="metrics"><div><span>${isSpace ? 'PERIODO' : 'VELOCIDAD'}</span><strong>${number(isSpace ? item.periodMinutes : item.speed)}</strong><small>${isSpace ? 'min' : 'km/h'}</small></div><div><span>ALTITUD</span><strong>${number(item.altitude)}</strong><small>m</small></div></div><dl class="vehicle-data">${fields.filter(([, value]) => value !== undefined && value !== null && value !== '').map(([label, value]) => `<div><dt>${label}</dt><dd>${esc(value)}</dd></div>`).join('')}<div><dt>Latitud / longitud</dt><dd>${item.lat?.toFixed(5) ?? '—'}° / ${item.lon?.toFixed(5) ?? '—'}°</dd></div></dl><div class="observation"><strong>${esc(item.source)}</strong><p>${esc(stamp)}</p>${old ? '<p>No se extrapola una posición antigua como si fuera en directo.</p>' : ''}${isSpace ? '<p>Predicción orbital a partir de elementos publicados; no es telemetría GPS.</p>' : ''}</div><button id="locate-vehicle" class="text-button"><svg><use href="#i-target"/></svg>Centrar en el mapa</button>`;
  $('detail-close').addEventListener('click', closeDetail);
  $('locate-vehicle').addEventListener('click', () => fly(item.lon, item.lat, isSpace ? Math.max(1000000, item.altitude * 2) : 90000));
  $('detail').hidden = false; document.body.classList.add('detail-open'); viewer.scene.requestRender();
}
function sourceState(kind) {
  if (errors[kind]) return 'La fuente no responde. ' + errors[kind];
  if (kind === 'space') return satellitePacket ? 'CelesTrak · posiciones calculadas con SGP4; elementos: ' + date(satellitePacket.fetchedAt) : 'Cargando elementos orbitales…';
  if (kind === 'sea' && packets.sea?.status === 'unconfigured') return 'AIS preparado. Falta configurar una clave gratuita en el servidor.';
  if (!packets[kind]) return 'Fuente pendiente de conexión.';
  const coverage = kind === 'air' ? 'Mundial · cobertura de receptores' : kind === 'rail' ? 'España · Renfe; otros países pendientes' : 'Mundial · cobertura AIS';
  return coverage + ' · ' + (mode === 'snapshot' ? 'Instantánea: ' : 'Consulta: ') + date(packets[kind].fetchedAt);
}
function updateStatus() {
  for (const kind of Object.keys(KIND)) if ($('state-' + kind)) $('state-' + kind).textContent = sourceState(kind);
  $('source-status').innerHTML = Object.entries(KIND).map(([kind, label]) => `<p><strong>${label}</strong><br>${esc(sourceState(kind))}</p>`).join('');
  $('connection').textContent = mode === 'live' ? 'Fuentes conectadas · fechas en cada ficha' : 'Instantáneas periódicas · órbitas calculadas';
  $('clock').textContent = new Date().toLocaleTimeString('es-ES', { timeZone: 'UTC', hour12: false }) + ' UTC';
}
async function getJson(url, timeout = 30000) {
  const response = await fetch(url, { cache: 'no-cache', signal: AbortSignal.timeout(timeout) });
  if (!response.ok) throw new Error('HTTP ' + response.status);
  return response.json();
}
const api = path => apiRoot ? apiRoot + '/api/' + path : './api/' + path;
async function discoverBackend() {
  try { const status = await getJson('./api/status', 3000); if (status.mode === 'live') { mode = 'live'; worldRefreshMs = status.worldRefreshMs === 90000 ? 90000 : 900000; return; } } catch { /* GitHub Pages has no server. */ }
  try {
    const config = await getJson('./data/config.json', 4000);
    if (config.liveApiUrl) {
      const url = new URL(config.liveApiUrl);
      if (url.protocol !== 'https:' || url.username || url.password) return;
      const candidate = url.href.replace(/\/$/, '');
      const status = await getJson(candidate + '/api/status', 15000);
      if (status.mode === 'live') { apiRoot = candidate; mode = 'live'; worldRefreshMs = status.worldRefreshMs === 90000 ? 90000 : 900000; }
    }
  } catch { /* Static snapshots remain useful if the optional server is offline. */ }
}
async function refreshSnapshot() {
  if (busy.has('snapshot')) return; busy.add('snapshot');
  try {
    const feed = await getJson('./data/feed.json');
    for (const kind of ['air', 'rail', 'sea']) {
      if (!feed[kind]) continue;
      packets[kind] = feed[kind]; errors[kind] = feed.errors?.find(e => e.source === kind)?.message || '';
      if (kind === 'air') { globalAir = feed.air.items; syncSymbols('air', mergeAircraft(globalAir, regionalAir)); } else syncSymbols(kind, feed[kind].items);
    }
  } catch (e) { notice('No se ha podido cargar la instantánea: ' + e.message); } finally { busy.delete('snapshot'); updateStatus(); }
}
async function refreshWorld() {
  if (mode !== 'live' || busy.has('world')) return; busy.add('world');
  try { const packet = await getJson(api('aircraft/world')); globalAir = packet.items; packets.air = packet; errors.air = ''; syncSymbols('air', mergeAircraft(globalAir, regionalAir)); }
  catch (e) { errors.air = 'OpenSky: ' + e.message; } finally { busy.delete('world'); updateStatus(); }
}
async function refreshRegion() {
  if (mode !== 'live' || busy.has('region') || !filters.air || document.hidden) return;
  const view = center(); if (view.height > 4000000) return;
  const lat = Math.round(Math.max(-85, Math.min(85, view.lat)) * 2) / 2, lon = Math.round(view.lon * 2) / 2;
  busy.add('region');
  try { const packet = await getJson(api(`aircraft?lat=${lat}&lon=${lon}`)); regionalAir = packet.items; lastRegion = `${lat},${lon}`; syncSymbols('air', mergeAircraft(globalAir, regionalAir)); }
  catch { /* The world layer remains intact when a regional receiver is unavailable. */ } finally { busy.delete('region'); }
}
async function refreshRail() {
  if (mode !== 'live' || busy.has('rail') || document.hidden) return; busy.add('rail');
  try { packets.rail = await getJson(api('trains')); errors.rail = ''; syncSymbols('rail', packets.rail.items); }
  catch (e) { errors.rail = e.message; } finally { busy.delete('rail'); updateStatus(); }
}
async function refreshShips() {
  if (mode !== 'live' || busy.has('sea') || !filters.sea || document.hidden) return; busy.add('sea');
  try { packets.sea = await getJson(api('ships')); errors.sea = ''; syncSymbols('sea', packets.sea.items); }
  catch (e) { errors.sea = e.message; } finally { busy.delete('sea'); updateStatus(); }
}
async function loadSatellites() {
  try {
    try { satellitePacket = await getJson(mode === 'live' ? api('satellites') : './data/satellites.json'); }
    catch (e) { if (mode !== 'live') throw e; satellitePacket = await getJson('./data/satellites.json'); }
    satellites = normalizeSatellites(satellitePacket.records); items.space = satellites;
    worker = new Worker(new URL('./orbit-worker.js', import.meta.url), { type: 'module' });
    worker.onmessage = e => {
      if (e.data.type !== 'positions' || !filters.space) return;
      orbitTime = e.data.time;
      const positions = e.data.positions, valid = [];
      satellites.forEach((sat, i) => { if (!Number.isFinite(positions[i * 3])) return; sat.lon = C.Math.toDegrees(positions[i * 3]); sat.lat = C.Math.toDegrees(positions[i * 3 + 1]); sat.altitude = positions[i * 3 + 2]; sat.observedAt = orbitTime; valid.push(sat); });
      syncSymbols('space', valid);
    };
    worker.onerror = () => { errors.space = 'No se ha podido calcular la órbita.'; updateStatus(); };
    updateOrbits();
  } catch (e) { errors.space = e.message; } finally { updateStatus(); }
}
function updateOrbits() {
  if (!worker) return;
  if (!filters.space || document.hidden) worker.postMessage({ type: 'pause' });
  else if (!workerLoaded) { worker.postMessage({ type: 'load', records: satellites.map(s => s.omm) }); workerLoaded = true; }
  else worker.postMessage({ type: 'resume' });
}
document.addEventListener('visibilitychange', updateOrbits);
$('search-form').addEventListener('submit', async e => {
  e.preventDefault(); const query = $('query').value.trim(); if (!query || !viewer) return;
  const seq = ++searchSequence;
  const matching = searchVehicles([...items.air, ...items.rail, ...items.sea, ...satellites], query);
  $('results').innerHTML = '<p class="small-note">Buscando lugares y vehículos…</p>';
  let places = [], error = '';
  try {
    await new Promise(r => setTimeout(r, Math.max(0, 1100 - (Date.now() - lastSearch)))); lastSearch = Date.now();
    places = await getJson(mode === 'live' ? api('search?q=' + encodeURIComponent(query)) : `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=5&q=${encodeURIComponent(query)}`, 20000);
  } catch { error = 'El buscador de lugares no responde. Los vehículos disponibles siguen siendo buscables.'; }
  if (seq !== searchSequence) return;
  $('results').innerHTML = matching.map((item, i) => `<button class="search-result" data-result-vehicle="${i}"><img src="${imageFor(item.category)}" alt=""><span><strong>${esc(item.name)}</strong><small>${esc(KIND[item.kind])} · ${esc(item.registration || item.code)}</small></span></button>`).join('') + places.map((p, i) => `<button class="search-result" data-result-place="${i}"><svg><use href="#i-target"/></svg><span><strong>${esc(p.name || p.display_name.split(',')[0])}</strong><small>${esc(p.display_name)}</small></span></button>`).join('') + (!matching.length && !places.length ? '<p class="small-note">No hay resultados en las fuentes conectadas.</p>' : '') + (error ? `<p class="small-note">${error}</p>` : '');
  $$('[data-result-vehicle]').forEach(b => b.addEventListener('click', async () => {
    const item = matching[+b.dataset.resultVehicle]; filters[item.kind] = true; filters[item.category] = true;
    $$('[data-filter]').forEach(input => { input.checked = filters[input.dataset.filter]; }); persist(); refreshVisibility(); updateLegend();
    if (item.kind === 'space') { updateOrbits(); if (!Number.isFinite(item.lon)) { notice('Calculando la posición orbital…'); for (let i = 0; i < 30 && !Number.isFinite(item.lon); i++) await new Promise(r => setTimeout(r, 100)); } }
    closePanels(); if (Number.isFinite(item.lon)) { fly(item.lon, item.lat, item.kind === 'space' ? Math.max(1000000, item.altitude * 2) : 90000); showDetail(item); }
  }));
  $$('[data-result-place]').forEach(b => b.addEventListener('click', () => { const place = places[+b.dataset.resultPlace]; closePanels(); closeDetail(); fly(+place.lon, +place.lat, ['city', 'town'].includes(place.type) ? 70000 : 18000); }));
});
async function init() {
  try {
    for (let i = 0; !window.Cesium && i < 200; i++) await new Promise(r => setTimeout(r, 100));
    if (!window.Cesium) throw new Error('No se ha podido cargar el motor del mapa.');
    C = window.Cesium;
    viewer = new C.Viewer('map', { baseLayer: false, terrainProvider: new C.EllipsoidTerrainProvider(), animation: false, timeline: false, baseLayerPicker: false, geocoder: false, homeButton: false, sceneModePicker: false, navigationHelpButton: false, fullscreenButton: false, infoBox: false, selectionIndicator: false, requestRenderMode: true, maximumRenderTimeChange: Infinity, scene3DOnly: false });
    viewer.scene.globe.baseColor = C.Color.fromCssColorString('#101d27'); viewer.scene.globe.enableLighting = false;
    viewer.scene.backgroundColor = C.Color.fromCssColorString('#080f16'); viewer.scene.globe.maximumScreenSpaceError = 1.5;
    viewer.scene.skyBox.show = false;
    viewer.scene.postProcessStages.fxaa.enabled = true;
    viewer.camera.setView({ destination: C.Cartesian3.fromDegrees(HOME.lon, HOME.lat, HOME.height) });
    Object.keys(KIND).forEach(kind => { stores[kind] = viewer.scene.primitives.add(new C.BillboardCollection({ scene: viewer.scene })); });
    setBase(base);
    railwayLayer = viewer.imageryLayers.addImageryProvider(new C.UrlTemplateImageryProvider({ url: 'https://a.tiles.openrailwaymap.org/standard/{z}/{x}/{y}.png', minimumLevel: 2, maximumLevel: 19, credit: new C.Credit('<a href="https://www.openrailwaymap.org/">OpenRailwayMap · © OpenStreetMap contributors</a>', true) }));
    railwayLayer.alpha = +$('rail-opacity').value;
    viewer.camera.changed.addEventListener(updateCamera);
    viewer.camera.moveEnd.addEventListener(() => { updateCamera(); if (!morphing) { const p = center(), region = `${Math.round(p.lat * 2) / 2},${Math.round(p.lon * 2) / 2}`; if (region !== lastRegion) refreshRegion(); } });
    viewer.screenSpaceEventHandler.setInputAction(event => { const pick = viewer.scene.pick(event.position); if (pick?.id?.transport) showDetail(pick.id.transport); else closeDetail(); }, C.ScreenSpaceEventType.LEFT_CLICK);
    renderFilters(); updateLegend(); updateCamera(); $('loading').hidden = true;
    await discoverBackend();
    // An initial world snapshot avoids a blank globe while live providers answer.
    await refreshSnapshot();
    if (mode === 'live') await Promise.allSettled([refreshWorld(), refreshRail(), refreshShips()]);
    loadSatellites(); refreshRadar(); refreshClouds(); updateStatus();
    setInterval(() => { if (!document.hidden) { updateStatus(); if (selected && selected.kind !== 'space') showDetail(selected); } }, 10000);
    setInterval(() => { if (!document.hidden && mode === 'snapshot') refreshSnapshot(); }, 30000);
    setInterval(() => { if (!document.hidden) { refreshRegion(); refreshRail(); } }, 20000);
    setInterval(() => { if (!document.hidden) refreshWorld(); }, worldRefreshMs);
    setInterval(refreshShips, 5000);
    setInterval(() => { refreshRadar(); refreshClouds(); }, 600000);
  } catch (e) { $('loading').querySelector('p').textContent = 'El mundo no ha podido abrirse'; $('loading').querySelector('small').textContent = e.message; }
}
init();
