import { isVisible, ageSeconds, searchVehicles, restoreFilters, mergeAircraft, normalizeSatellites } from './model.js?v=0.3';
import { CATEGORY, KIND, markerSvg } from './catalog.js?v=0.3';
import { BASES, baseProvider, esriProvider, nasaProvider } from './layers.js?v=0.3';
import { observationTween, interpolate, journeyProgress, distance } from './motion.js?v=0.3';
import { RailEngine } from './rail-engine.js?v=0.3';
import { finnishRail, northAmericanRail } from './rail.js?v=0.3';
import { RouteView } from './routes.js?v=0.3';
const $ = id => document.getElementById(id);
const $$ = q => [...document.querySelectorAll(q)];
const HOME = { lon: 5, lat: 24, height: 19000000 };
const esc = s => String(s ?? 'Sin datos publicados').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const number = n => Number.isFinite(n) ? new Intl.NumberFormat('es-ES', { maximumFractionDigits: 0 }).format(n) : '—';
const date = n => n ? new Date(n).toLocaleString('es-ES', { timeZone: 'UTC' }) + ' UTC' : 'No publicada';
let saved = {};
try { saved = JSON.parse(localStorage.getItem('transportination.preferences') || '{}'); } catch { /* Optional storage. */ }
const filters = restoreFilters(saved.version >= 2 ? saved.filters : { ...saved.filters, sea: true, space: false });
const colors = Object.fromEntries(Object.entries(CATEGORY).map(([key, c]) => [key, /^#[\da-f]{6}$/i.test(saved.colors?.[key]) ? saved.colors[key] : c.color]));
let base = saved.version >= 2 && BASES.some(([key]) => key === saved.base) ? saved.base : 'satellite';
let viewer, C, apiRoot = '', mode = 'snapshot', activePanel, selected, worker, workerLoaded = false, morphing = false;
let globalAir = [], regionalAir = [], satellites = [], satellitePacket, orbitTime, noticeTimer, searchSequence = 0, lastSearch = 0;
const items = { air: [], rail: [], sea: [], space: [] }, packets = {}, errors = {}, stores = {}, symbols = new Map(), images = new Map(), busy = new Set();
let baseLayer, referenceLayer, railwayLayer, radarLayer, radarTime, cloudLayers = [], cloudTimes = [], lastRegion = '';
let worldRefreshMs = 900000;
const railEngine = new RailEngine(), tweens = new Map(), flightRoutes = new Map(), stationCache = new Map();
let routeView, stationStore, railwayPacket, stationSymbols = new Map(), osmStations = [], follow = false, lastMotion = 0, lastRouteDraw = 0;
let fiMetadata, fiTimetable, fiTimetableAt = 0, naMetadata, stationRequest = 0, stationTimer, lastFiPoll = 0, lastNaPoll = 0;
let detailKey = '';
let legendVisible = saved.legend === true;
let symbolSize = Number.isFinite(saved.symbolSize) ? Math.max(16, Math.min(36, saved.symbolSize)) : 24;
function persist() {
  try { localStorage.setItem('transportination.preferences', JSON.stringify({ version: 3, filters, colors, base, legend: legendVisible, symbolSize, railways: $('railways').checked, railOpacity: +$('rail-opacity').value, stations: $('stations').checked, stationOpacity: +$('station-opacity').value, estimates: $('schedule-estimates').checked, routeOpacity: +$('route-opacity').value, radar: $('radar').checked, clouds: $('clouds').checked })); } catch { /* Private browsing can disable storage. */ }
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
  const railOptions = $('rail-options');
  document.querySelector('[data-filter="rail"]').closest('details').append(railOptions);
  $$('[data-filter]').forEach(input => input.addEventListener('change', () => {
    filters[input.dataset.filter] = input.checked; persist(); refreshVisibility(); updateLegend();
    if (input.dataset.filter === 'space') updateOrbits();
    if (input.dataset.filter === 'sea' && filters.sea && mode === 'live') refreshShips();
    if (input.dataset.filter === 'rail') { renderStations(); if (filters.rail) refreshInternational(); }
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
  if (railwayLayer) railwayLayer.show = filters.rail && $('railways').checked && p.height < 4000000;
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
$('rail-opacity').value = saved.version >= 3 && Number.isFinite(saved.railOpacity) ? Math.max(0, Math.min(1, saved.railOpacity)) : 1;
$('railways').addEventListener('change', () => { if (viewer) { updateCamera(); viewer.scene.requestRender(); } persist(); });
$('rail-opacity').addEventListener('input', () => { if (railwayLayer) { railwayLayer.alpha = +$('rail-opacity').value; viewer.scene.requestRender(); } persist(); });
$('stations').checked = saved.stations !== false;
$('station-opacity').value = saved.version >= 3 && Number.isFinite(saved.stationOpacity) ? Math.max(0, Math.min(1, saved.stationOpacity)) : 1;
$('schedule-estimates').checked = saved.estimates !== false;
$('route-opacity').value = saved.version >= 3 && Number.isFinite(saved.routeOpacity) ? Math.max(0, Math.min(1, saved.routeOpacity)) : 1;
for (const id of ['stations', 'station-opacity']) $(id).addEventListener('input', () => { renderStations(); drawRoute(); refreshStations(); persist(); });
$('schedule-estimates').addEventListener('change', () => { motionTick(); persist(); });
$('route-opacity').addEventListener('input', () => { drawRoute(); persist(); });
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
  routeView?.remember(incoming);
  items[kind] = incoming;
  const ids = new Set(incoming.map(i => i.id));
  for (const [id, symbol] of symbols) if (symbol.id.transport.kind === kind && !ids.has(id)) { stores[kind].remove(symbol); symbols.delete(id); tweens.delete(id); }
  incoming.forEach(item => {
    if (!Number.isFinite(item.lon) || !Number.isFinite(item.lat)) return;
    let symbol = symbols.get(item.id);
    if (!symbol) {
      symbol = stores[kind].add({ id: { transport: item }, position: C.Cartesian3.fromDegrees(item.lon, item.lat, Math.max(kind === 'air' ? 100 : 30, item.altitude ?? 30)), image: imageFor(item.category), alignedAxis: ['air', 'sea'].includes(kind) ? C.Cartesian3.UNIT_Z : C.Cartesian3.ZERO });
      symbols.set(item.id, symbol);
    } else {
      const tween = ['air', 'rail', 'sea'].includes(kind) && item.positionMode !== 'schedule' ? observationTween(symbol.id.transport, item) : null;
      if (tween) tweens.set(item.id, tween);
      if (!tween && !tweens.has(item.id)) symbol.position = C.Cartesian3.fromDegrees(item.lon, item.lat, Math.max(kind === 'air' ? 100 : 30, item.altitude ?? 30));
      if (item.positionMode === 'schedule') { tweens.delete(item.id); symbol.position = C.Cartesian3.fromDegrees(item.lon, item.lat, 30); }
      symbol.id.transport = item;
    }
    styleSymbol(symbol, item);
  });
  if (selected?.kind === kind) { const next = incoming.find(i => i.id === selected.id); if (next) showDetail(next); else closeDetail(); }
  viewer.scene.requestRender(); updateStatus();
}
function refreshVisibility() {
  if (!viewer) return;
  for (const symbol of symbols.values()) styleSymbol(symbol, symbol.id.transport);
  if (selected && !isVisible(selected, filters)) closeDetail();
  viewer.scene.requestRender(); updateStatus(); updateCamera(); renderStations(); drawRoute();
}
function closeDetail() {
  if (selected && symbols.has(selected.id)) symbols.get(selected.id).scale = 1;
  selected = null; follow = false; detailKey = ''; routeView?.clear(); $('detail').hidden = true; document.body.classList.remove('detail-open'); viewer?.scene.requestRender();
}
const stopTime = (time, zone) => time ? new Date(time).toLocaleTimeString('es-ES', { timeZone: zone || 'UTC', hour: '2-digit', minute: '2-digit' }) : '—';
function drawRoute() { if (routeView) { routeView.intensity = +$('route-opacity').value; routeView.draw(selected, colors[selected?.category], $('stations').checked, +$('station-opacity').value); } }
function showDetail(item) {
  const changed = selected?.id !== item.id, scroll = changed ? 0 : $('detail').scrollTop;
  if (changed && selected && symbols.has(selected.id)) symbols.get(selected.id).scale = 1;
  if (changed) follow = false;
  selected = item;
  if (item.kind === 'air') selected.flightRoute = flightRoutes.get(item.name) || null;
  if (symbols.has(item.id)) symbols.get(item.id).scale = 1.4;
  const c = CATEGORY[item.category], isSpace = item.kind === 'space', estimated = item.positionMode === 'schedule';
  const j = item.journey, progress = j && journeyProgress(j), stops = j?.stops || [], commercialStops = stops.filter(s => s.commercial !== false);
  let next = progress?.next;
  if (!estimated && stops.length) {
    const byCode = stops.findIndex(s => s.id === item.stop);
    next = byCode >= 0 ? byCode : stops.reduce((best, s, i) => distance(item, s) < distance(item, stops[best]) ? i : best, 0);
  }
  const location = j && next !== undefined ? (estimated && progress?.atStation ? 'En ' + stops[next].name : 'Tramo de ' + stops[Math.max(0, next - 1)].name + ' a ' + stops[next].name) : null;
  const fields = [['Identificador', item.code], ['Matrícula', item.registration], ['Modelo', item.model], ['País', item.country], ['Operador', item.operator], ['Viaje', j ? j.code : item.trip], ['Situación', location], ['Destino', item.destination], ['IMO', item.imo], ['Rumbo', Number.isFinite(item.bearing) ? number(item.bearing) + '°' : null]];
  if (isSpace) fields.push(['NORAD', item.code], ['Inclinación orbital', number(item.inclination) + '°'], ['Época orbital', date(Date.parse(item.epoch))]);
  const stamp = estimated ? 'Horario consultado: ' + date(item.scheduleAt) : isSpace ? 'Calculada: ' + date(item.observedAt) : (item.timestampScope === 'feed' ? 'Fecha del conjunto: ' : 'Posición recibida: ') + date(item.observedAt);
  const old = !estimated && !isSpace && ageSeconds(item) > (item.kind === 'air' ? 60 : 120);
  const flight = item.flightRoute;
  const state = (isSpace ? 'Órbita calculada · SGP4' : estimated ? 'Posición estimada por horario · no GPS' : item.state) + (old ? ' · Posición atrasada' : '');
  const key = item.id + ':' + item.category + ':' + item.name + ':' + estimated + ':' + fields.filter(([, v]) => v !== null && v !== undefined && v !== '').map(([label]) => label).join(',') + ':' + (j?.stops.map(s => `${s.id}:${s.arrival}:${s.departure}`).join(',') || '') + ':' + !!flight;
  if (!changed && detailKey === key) {
    $('detail').querySelector('.vehicle-state').textContent = state;
    const metrics = $('detail').querySelectorAll('.metrics strong'); metrics[0].textContent = number(isSpace ? item.periodMinutes : item.speed); metrics[1].textContent = number(item.altitude);
    const values = new Map(fields);
    $('detail').querySelectorAll('.vehicle-data>div').forEach(row => { const label = row.querySelector('dt').textContent; row.querySelector('dd').textContent = label === 'Latitud / longitud' ? `${item.lat?.toFixed(5) ?? '—'}° / ${item.lon?.toFixed(5) ?? '—'}°` : values.get(label); });
    $('detail').querySelector('.observation p').textContent = stamp;
    $('detail').querySelectorAll('.journey-stops li').forEach(row => {
      const index = +row.querySelector('button').dataset.stop, stop = stops[index];
      row.className = index === next ? 'next' : index < next ? 'passed' : '';
      row.querySelector('small').textContent = (index === next ? 'Próxima / estación actual' : index < next ? 'Anterior' : 'Por delante') + (stop.platform ? ' · vía ' + stop.platform : '');
    });
    return;
  }
  detailKey = key;
  const routeHead = j ? '<section class="journey-head"><span>ORIGEN → DESTINO</span><strong>' + esc(stops[0].name) + ' → ' + esc(stops.at(-1).name) + '</strong><small>' + stopTime(stops[0].departure, j.timezone || stops[0].timezone) + ' → ' + stopTime(stops.at(-1).arrival, j.timezone || stops.at(-1).timezone) + ' · horas locales</small></section>' : flight ? '<section class="journey-head"><span>RUTA PUBLICADA</span><strong>' + esc(flight.origin.name) + ' → ' + esc(flight.destination.name) + '</strong><small>Unión entre aeropuertos; no es el plan de vuelo exacto.</small></section>' : '';
  const stopList = j ? '<section class="journey-stops"><h3>Estaciones del recorrido</h3><ol>' + commercialStops.map(s => {
    const index = stops.indexOf(s), past = index < next, upcoming = index === next;
    return '<li class="' + (upcoming ? 'next' : past ? 'passed' : '') + '"><button data-stop="' + index + '"><span>' + esc(s.name) + '</span><time>' + stopTime(s.departure, j.timezone || s.timezone) + '</time></button><small>' + (upcoming ? 'Próxima / estación actual' : past ? 'Anterior' : 'Por delante') + (s.platform ? ' · vía ' + esc(s.platform) : '') + '</small></li>';
  }).join('') + '</ol><p class="small-note">' + (j.geometry ? 'Trazado ferroviario publicado en GTFS.' : 'Recorrido aproximado entre estaciones publicadas; no se dispone de la geometría exacta.') + '</p></section>' : '';
  const routeNote = item.kind === 'air' ? '<p class="small-note">La estela conserva las posiciones nuevas recibidas durante esta sesión. Su color indica la altitud: verde → amarillo → naranja → rosa → violeta.</p>' : item.kind === 'sea' ? '<p class="small-note">La estela conserva observaciones AIS nuevas. La ruta futura solo se mostrará cuando la fuente la publique.</p>' : '';
  $('detail').style.setProperty('--vehicle-color', colors[item.category]);
  $('detail').innerHTML = '<header class="panel-head"><span>' + esc(KIND[item.kind]) + '</span><button id="detail-close" aria-label="Cerrar ficha"><svg><use href="#i-close"/></svg></button></header><div class="vehicle-hero"><img src="' + imageFor(item.category) + '" alt=""><div><h2 id="detail-title">' + esc(item.name) + '</h2><p>' + esc(c.label) + '</p></div></div><div class="vehicle-state">' + esc(isSpace ? 'Órbita calculada · SGP4' : estimated ? 'Posición estimada por horario · no GPS' : item.state) + (old ? ' · Posición atrasada' : '') + '</div>' + routeHead + '<div class="metrics"><div><span>' + (isSpace ? 'PERIODO' : 'VELOCIDAD PUBLICADA') + '</span><strong>' + number(isSpace ? item.periodMinutes : item.speed) + '</strong><small>' + (isSpace ? 'min' : 'km/h') + '</small></div><div><span>ALTITUD</span><strong>' + number(item.altitude) + '</strong><small>m</small></div></div><dl class="vehicle-data">' + fields.filter(([, value]) => value !== undefined && value !== null && value !== '').map(([label, value]) => '<div><dt>' + label + '</dt><dd>' + esc(value) + '</dd></div>').join('') + '<div><dt>Latitud / longitud</dt><dd>' + (item.lat?.toFixed(5) ?? '—') + '° / ' + (item.lon?.toFixed(5) ?? '—') + '°</dd></div></dl>' + stopList + routeNote + '<div class="observation"><strong>' + esc(item.source) + '</strong><p>' + esc(stamp) + '</p>' + (estimated ? '<p>Movimiento calculado cada segundo entre los horarios disponibles. Los retrasos publicados se aplican cuando están disponibles; no acredita la ubicación real.</p>' : '') + (isSpace ? '<p>Predicción orbital a partir de elementos publicados; no es telemetría GPS.</p>' : '') + '</div><div class="vehicle-actions"><button id="locate-vehicle" class="text-button"><svg><use href="#i-target"/></svg>Centrar</button><button id="follow-vehicle" class="text-button" aria-pressed="' + follow + '">Seguir movimiento</button></div>';
  $('detail-close').addEventListener('click', closeDetail);
  $('locate-vehicle').addEventListener('click', () => fly(selected.lon, selected.lat, isSpace ? Math.max(1000000, selected.altitude * 2) : 90000));
  $('follow-vehicle').addEventListener('click', () => { follow = !follow; $('follow-vehicle').setAttribute('aria-pressed', String(follow)); if (follow) fly(selected.lon, selected.lat, isSpace ? Math.max(1000000, selected.altitude * 2) : 90000); });
  $$('[data-stop]').forEach(button => button.addEventListener('click', () => { follow = false; const stop = selected.journey.stops[+button.dataset.stop]; fly(stop.lon, stop.lat, 25000); }));
  $('detail').hidden = false; $('detail').scrollTop = scroll; document.body.classList.add('detail-open'); viewer.scene.requestRender();
  if (changed) { drawRoute(); requestFlightRoute(item); if (item.kind === 'space') worker?.postMessage({ type: 'route', id: item.id, index: satellites.findIndex(s => s.id === item.id), period: item.periodMinutes }); }
}
async function requestFlightRoute(item) {
  if (item.kind !== 'air' || flightRoutes.has(item.name) || !/^[A-Z]{2,3}\d[A-Z\d]*$/.test(item.name)) return;
  flightRoutes.set(item.name, null);
  try {
    const data = await getJson('https://api.adsbdb.com/v0/callsign/' + encodeURIComponent(item.name), 10000);
    const route = data.response?.flightroute;
    const airport = a => a && Number.isFinite(a.latitude) && Number.isFinite(a.longitude) ? { name: a.name + ' · ' + (a.iata_code || a.icao_code), lat: a.latitude, lon: a.longitude } : null;
    const origin = airport(route?.origin), destination = airport(route?.destination);
    if (origin && destination) { flightRoutes.set(item.name, { origin, destination }); if (selected?.name === item.name && selected?.id === item.id) { selected.flightRoute = { origin, destination }; showDetail(selected); drawRoute(); } }
  } catch { /* Unknown routes remain explicitly unavailable, without invented airports. */ }
}
function sourceState(kind) {
  if (kind === 'rail') return 'España y Francia · horarios publicados; Finlandia, Estados Unidos y Canadá · posiciones y horarios. ' + [errors.rail, errors.fi, errors.na, errors.schedules].filter(Boolean).join(' · ');
  if (errors[kind]) return 'La fuente no responde. ' + errors[kind];
  if (kind === 'space') return satellitePacket ? 'CelesTrak · posiciones calculadas con SGP4; elementos: ' + date(satellitePacket.fetchedAt) : 'Cargando elementos orbitales…';
  if (kind === 'sea' && packets.sea?.status === 'unconfigured') return 'AIS preparado. Falta configurar una clave gratuita en el servidor.';
  if (!packets[kind]) return 'Fuente pendiente de conexión.';
  const coverage = kind === 'air' ? 'Mundial · cobertura de receptores' : kind === 'rail' ? 'Renfe y SNCF · horarios; Finlandia, Estados Unidos y Canadá · consultas directas' : 'Mundial · cobertura AIS';
  return coverage + ' · ' + (mode === 'snapshot' ? 'Instantánea: ' : 'Consulta: ') + date(packets[kind].fetchedAt);
}
function updateStatus() {
  for (const kind of Object.keys(KIND)) if ($('state-' + kind)) $('state-' + kind).textContent = sourceState(kind);
  $('source-status').innerHTML = Object.entries(KIND).map(([kind, label]) => `<p><strong>${label}</strong><br>${esc(sourceState(kind))}</p>`).join('');
  $('connection').textContent = mode === 'live' ? 'Consultas activas · horarios y órbitas calculados' : 'Aviación: instantáneas · trenes: consultas y horarios';
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
      if (kind === 'air') { globalAir = feed.air.items; syncSymbols('air', mergeAircraft(globalAir, regionalAir)); }
      else if (kind === 'rail') { railEngine.receive(feed.rail.items, 'rail:commuter:'); railEngine.receive(feed.rail.items, 'rail:longDistance:'); syncRail(); }
      else syncSymbols(kind, feed[kind].items);
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
  const lat = Math.round(Math.max(-85, Math.min(85, view.lat)) * 100) / 100, lon = Math.round(view.lon * 100) / 100;
  const radius = Math.max(5, Math.min(250, Math.ceil(view.height / 1200)));
  busy.add('region');
  try { const packet = await getJson(api(`aircraft?lat=${lat}&lon=${lon}&radius=${radius}`)); regionalAir = packet.items; lastRegion = `${lat},${lon}`; errors.region = ''; syncSymbols('air', mergeAircraft(globalAir, regionalAir)); }
  catch { /* The world layer remains intact when a regional receiver is unavailable. */ } finally { busy.delete('region'); }
}
async function refreshRail() {
  if (mode !== 'live' || busy.has('rail') || document.hidden) return; busy.add('rail');
  try { packets.rail = await getJson(api('trains')); errors.rail = ''; railEngine.receive(packets.rail.items, 'rail:commuter:'); railEngine.receive(packets.rail.items, 'rail:longDistance:'); syncRail(); }
  catch (e) { errors.rail = e.message; } finally { busy.delete('rail'); updateStatus(); }
}
async function refreshShips() {
  if (mode !== 'live' || busy.has('sea') || !filters.sea || document.hidden) return; busy.add('sea');
  try { packets.sea = await getJson(api('ships')); errors.sea = ''; syncSymbols('sea', packets.sea.items); }
  catch (e) { errors.sea = e.message; } finally { busy.delete('sea'); updateStatus(); }
}
function syncRail() {
  const trains = railEngine.positions().filter(i => $('schedule-estimates').checked || i.positionMode !== 'schedule');
  syncSymbols('rail', trains);
}
async function loadRailway() {
  if (busy.has('railway')) return; busy.add('railway');
  try {
    if (!railwayPacket) railEngine.setNetwork(await getJson('./data/rail-network.json'));
    railwayPacket = await getJson('./data/rail-journeys.json');
    railEngine.setJourneys(railwayPacket.journeys, railwayPacket.delays?.entities || []);
    railEngine.receive(railwayPacket.observations || []);
    errors.schedules = railwayPacket.errors?.map(e => `${e.source}: ${e.message}`).join(' · ');
    syncRail(); renderStations();
  } catch (e) { errors.schedules = 'Horarios: ' + e.message; } finally { busy.delete('railway'); updateStatus(); }
}
async function refreshInternational() {
  if (!viewer || !filters.rail || document.hidden) return;
  const view = center(), now = Date.now();
  const focusFi = selected?.country === 'Finlandia' || (view.lat > 58 && view.lon > 18 && view.lon < 33 && view.height < 4000000);
  const focusNa = ['Estados Unidos', 'Canadá'].includes(selected?.country) || (view.lon < -50 && view.lon > -170 && view.height < 4000000);
  const work = [];
  if (!busy.has('fi') && now - lastFiPoll > (focusFi ? 10000 : 60000)) work.push((async () => {
    busy.add('fi'); lastFiPoll = now;
    try {
      if (!fiMetadata) fiMetadata = await getJson('https://rata.digitraffic.fi/api/v1/metadata/stations');
      if (!fiTimetable || now - fiTimetableAt > 120000) { fiTimetable = await getJson('https://rata.digitraffic.fi/api/v1/live-trains'); fiTimetableAt = Date.now(); }
      const positions = await getJson('https://rata.digitraffic.fi/api/v1/train-locations/latest/');
      const packet = finnishRail(positions, fiTimetable, fiMetadata, fiTimetableAt);
      railEngine.replaceJourneys('rail:fi:', packet.journeys); railEngine.receive(packet.items, 'rail:fi:');
      railEngine.network.stations = [...railEngine.network.stations.filter(s => !s.id.startsWith('fi:')), ...packet.stations]; renderStations();
      errors.fi = ''; packets.fi = { fetchedAt: Date.now() }; syncRail();
    } catch (e) { errors.fi = 'Finlandia: ' + e.message; } finally { busy.delete('fi'); }
  })());
  if (!busy.has('na') && now - lastNaPoll > (focusNa ? 30000 : 120000)) work.push((async () => {
    busy.add('na'); lastNaPoll = now;
    try {
      if (!naMetadata) naMetadata = await getJson('https://api-v3.amtraker.com/v3/stations');
      const packet = northAmericanRail(await getJson('https://api-v3.amtraker.com/v3/trains'), naMetadata);
      railEngine.replaceJourneys('rail:na:', packet.journeys); railEngine.receive(packet.items, 'rail:na:');
      railEngine.network.stations = [...railEngine.network.stations.filter(s => !s.id.startsWith('na:')), ...packet.stations]; renderStations();
      errors.na = ''; packets.na = { fetchedAt: packet.fetchedAt }; syncRail();
    } catch (e) { errors.na = 'Norteamérica: ' + e.message; } finally { busy.delete('na'); }
  })());
  await Promise.allSettled(work); updateStatus();
}
function renderStations() {
  if (!stationStore) return;
  const show = filters.rail && $('stations').checked, alpha = +$('station-opacity').value, view = center();
  const stations = [...(railEngine.network.stations || []), ...osmStations];
  const current = new Set(stations.map(s => s.id));
  for (const [id, marker] of stationSymbols) if (!current.has(id)) { stationStore.remove(marker); stationSymbols.delete(id); }
  const visible = show && view.height < 1500000 && alpha > 0;
  for (const station of stations) {
    let marker = stationSymbols.get(station.id);
    if (!marker) {
      marker = stationStore.add({ id: { station }, position: C.Cartesian3.fromDegrees(station.lon, station.lat, 20),
        image: 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14"><rect x="3" y="3" width="8" height="8" fill="#eaf5fb" stroke="#081119" stroke-width="2"/></svg>'), width: 10, height: 10 });
      stationSymbols.set(station.id, marker);
    }
    marker.show = visible; marker.color = C.Color.WHITE.withAlpha(alpha);
  }
  viewer.scene.requestRender();
}
async function refreshStations() {
  if (!viewer || !filters.rail || !$('stations').checked || document.hidden) return;
  const view = center();
  renderStations();
  if (view.height > 200000) { $('station-state').textContent = 'Acércate para ver las estaciones. En vistas locales se consulta también OpenStreetMap.'; return; }
  const rect = viewer.camera.computeViewRectangle();
  if (!rect) return;
  const south = C.Math.toDegrees(rect.south), north = C.Math.toDegrees(rect.north), west = C.Math.toDegrees(rect.west), east = C.Math.toDegrees(rect.east);
  if (north - south > 3 || east - west > 3 || east < west) return;
  const bbox = [Math.floor(south * 10) / 10, Math.floor(west * 10) / 10, Math.ceil(north * 10) / 10, Math.ceil(east * 10) / 10].join(',');
  const previous = stationCache.get(bbox);
  if (previous) { osmStations = previous; renderStations(); $('station-state').textContent = 'Estaciones de las fuentes conectadas y OpenStreetMap.'; return; }
  if (busy.has('stations')) return;
  const seq = ++stationRequest; busy.add('stations'); $('station-state').textContent = 'Consultando estaciones de esta zona…';
  try {
    const query = `[out:json][timeout:18];nwr["railway"~"^(station|halt|tram_stop)$"](${bbox});out center;`;
    const response = await fetch('https://overpass-api.de/api/interpreter', { method: 'POST', body: new URLSearchParams({ data: query }), signal: AbortSignal.timeout(25000) });
    if (!response.ok) throw new Error('HTTP ' + response.status);
    const result = await response.json();
    if (seq !== stationRequest) return;
    osmStations = result.elements.map(s => ({ id: 'osm:' + s.type + ':' + s.id, name: s.tags?.name || s.tags?.ref || 'Estación ferroviaria', lat: s.lat ?? s.center?.lat, lon: s.lon ?? s.center?.lon })).filter(s => Number.isFinite(s.lat) && Number.isFinite(s.lon));
    stationCache.set(bbox, osmStations); if (stationCache.size > 20) stationCache.delete(stationCache.keys().next().value);
    renderStations(); $('station-state').textContent = 'Estaciones de las fuentes conectadas y OpenStreetMap · cobertura según cartografía disponible.';
  } catch (e) { $('station-state').textContent = 'OpenStreetMap no responde en esta zona. Se conservan las estaciones publicadas por los operadores.'; } finally { busy.delete('stations'); }
}
function motionTick() {
  if (!viewer || document.hidden) return;
  const now = Date.now();
  if (now - lastMotion > 950) {
    lastMotion = now; syncRail(); updateStatus();
    if (follow && selected && !morphing && !viewer.camera._currentFlight) {
      const view = center(); viewer.camera.setView({ destination: C.Cartesian3.fromDegrees(selected.lon, selected.lat, view.height) });
    }
    if (selected && now - lastRouteDraw > 5000) { drawRoute(); lastRouteDraw = now; }
  }
  for (const [id, tween] of tweens) {
    const marker = symbols.get(id); if (!marker) { tweens.delete(id); continue; }
    const t = Math.min(1, (now - tween.startedAt) / tween.duration), p = interpolate(tween.from, tween.to, t);
    marker.position = C.Cartesian3.fromDegrees(p.lon, p.lat, Math.max(30, p.altitude));
    if (t >= 1) tweens.delete(id);
  }
  if (tweens.size) viewer.scene.requestRender();
}
async function loadSatellites() {
  try {
    try { satellitePacket = await getJson(mode === 'live' ? api('satellites') : './data/satellites.json'); }
    catch (e) { if (mode !== 'live') throw e; satellitePacket = await getJson('./data/satellites.json'); }
    satellites = normalizeSatellites(satellitePacket.records); items.space = satellites;
    worker = new Worker(new URL('./orbit-worker.js?v=0.3', import.meta.url), { type: 'module' });
    worker.onmessage = e => {
      if (e.data.type === 'route') { routeView.orbit = { id: e.data.id, points: e.data.points }; if (selected?.id === e.data.id) drawRoute(); return; }
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
    routeView = new RouteView(C, viewer); stationStore = viewer.scene.primitives.add(new C.BillboardCollection({ scene: viewer.scene }));
    viewer.scene.frameState.creditDisplay.addStaticCredit(new C.Credit('<a href="https://amtraker.com/">Amtraker · ODC-By</a> · <a href="https://www.digitraffic.fi/en/railway-traffic/">Fintraffic</a> · <a href="https://data.renfe.com/">Renfe</a> · <a href="https://transport.data.gouv.fr/datasets/horaires-sncf">SNCF</a>', true));
    setBase(base);
    railwayLayer = viewer.imageryLayers.addImageryProvider(new C.UrlTemplateImageryProvider({ url: 'https://a.tiles.openrailwaymap.org/standard/{z}/{x}/{y}.png', minimumLevel: 2, maximumLevel: 19, credit: new C.Credit('<a href="https://www.openrailwaymap.org/">OpenRailwayMap · © OpenStreetMap contributors</a>', true) }));
    railwayLayer.alpha = +$('rail-opacity').value;
    viewer.camera.changed.addEventListener(updateCamera);
    viewer.camera.moveEnd.addEventListener(() => { updateCamera(); renderStations(); clearTimeout(stationTimer); stationTimer = setTimeout(refreshStations, 1200); if (!morphing) refreshRegion(); });
    viewer.screenSpaceEventHandler.setInputAction(event => { const pick = viewer.scene.pick(event.position); if (pick?.id?.transport) showDetail(pick.id.transport); else if (pick?.id?.station) notice(pick.id.station.name); else if (pick?.id?.properties?.station) notice(pick.id.properties.station.getValue().name); else closeDetail(); }, C.ScreenSpaceEventType.LEFT_CLICK);
    renderFilters(); updateLegend(); updateCamera(); $('loading').hidden = true;
    await discoverBackend();
    // An initial world snapshot avoids a blank globe while live providers answer.
    await refreshSnapshot();
    await loadRailway(); refreshInternational();
    if (mode === 'live') await Promise.allSettled([refreshWorld(), refreshRail(), refreshShips()]);
    loadSatellites(); refreshRadar(); refreshClouds(); updateStatus();
    setInterval(() => { if (!document.hidden) { updateStatus(); if (selected && selected.kind !== 'space') showDetail(selected); } }, 10000);
    setInterval(() => { if (!document.hidden && mode === 'snapshot') refreshSnapshot(); }, 30000);
    setInterval(() => { if (!document.hidden) refreshRail(); }, 20000);
    setInterval(() => { if (!document.hidden) { refreshRegion(); refreshInternational(); } }, 5000);
    setInterval(motionTick, 100);
    setInterval(loadRailway, 300000);
    setInterval(() => { if (selected?.kind === 'space') worker?.postMessage({ type: 'route', id: selected.id, index: satellites.findIndex(s => s.id === selected.id), period: selected.periodMinutes }); }, 30000);
    setInterval(() => { if (!document.hidden) refreshWorld(); }, worldRefreshMs);
    setInterval(async () => {
      if (document.hidden || mode === 'live' || busy.has('backend')) return;
      busy.add('backend');
      try { await discoverBackend(); if (mode === 'live') { refreshWorld(); refreshRegion(); refreshRail(); updateStatus(); } } finally { busy.delete('backend'); }
    }, 60000);
    setInterval(refreshShips, 5000);
    setInterval(() => { refreshRadar(); refreshClouds(); }, 600000);
  } catch (e) { $('loading').querySelector('p').textContent = 'El mundo no ha podido abrirse'; $('loading').querySelector('small').textContent = e.message; }
}
init();
