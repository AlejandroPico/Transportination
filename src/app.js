import { isVisible, ageSeconds, searchVehicles, restoreFilters, mergeAircraft, normalizeSatellites, normalizeAircraft } from './model.js?v=0.5';
import { CATEGORY, KIND, markerSvg } from './catalog.js?v=0.5';
import { BASES, baseProvider, esriProvider, nasaProvider } from './layers.js?v=0.5';
import { observationTween, interpolate, journeyProgress, distance } from './motion.js?v=0.5';
import { RailEngine } from './rail-engine.js?v=0.5';
import { finnishRail, northAmericanRail } from './rail.js?v=0.5';
import { Aircraft3D, aircraftMesh } from './aircraft-3d.js?v=0.5';
import { AviationView, AIRPORT_TYPES } from './aviation.js?v=0.5';
import { WeatherView, SCALES } from './weather.js?v=0.5';
import { ENTUR_QUERY, enturRail } from './entur.js?v=0.5';
import { RouteView } from './routes.js?v=0.5';
import { MarineClient } from './marine.js?v=0.5';
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
let globalSea = [], regionalSea = [], marineClient, marineState = '';
const items = { air: [], rail: [], sea: [], space: [] }, packets = {}, errors = {}, stores = {}, symbols = new Map(), images = new Map(), busy = new Set();
let baseLayer, referenceLayer, railwayLayer, radarLayer, radarTime, cloudLayers = [], cloudTimes = [], lastRegion = '';
let worldRefreshMs = 900000;
const railEngine = new RailEngine(), tweens = new Map(), flightRoutes = new Map(), stationCache = new Map();
let routeView, stationStore, railwayPacket, stationSymbols = new Map(), osmStations = [], follow = false, lastMotion = 0, lastRouteDraw = 0;
let fiMetadata, fiTimetable, fiTimetableAt = 0, naMetadata, stationRequest = 0, stationTimer, lastFollow = 0, lastFiPoll = 0, lastNaPoll = 0;
let directCredit, lastDirectPoll = 0, emptyDirect = 0;
let detailKey = '';
let aircraft3D, aviationView, weatherView, weatherLoaded = false, weatherPacketAt = 0, weatherTimer, aviationTimer, lastNoPoll = 0, airHistoryAt = new Map();
const metadata = new Map(), labelPreferences = saved.labels || {}, aviationPreferences = saved.aviation || {};
const infrastructureKeys = ['airports','runways','navaids','atc'];
const airportTypes=Object.fromEntries(Object.keys(AIRPORT_TYPES).map(key=>[key,saved.airportTypes?.[key]!==false]));
$('airports-opacity').closest('label').insertAdjacentHTML('afterend','<div id="airport-types" class="airport-types">'+Object.entries(AIRPORT_TYPES).map(([key,type])=>'<label class="check-row"><input data-airport-type="'+key+'" type="checkbox" '+(airportTypes[key]?'checked':'')+'><span>'+type.label+'</span></label>').join('')+'<p class="small-note">Tamaños del catálogo OurAirports; no acreditan vuelos internacionales ni volumen de tráfico.</p></div>');
$$('[data-airport-type]').forEach(input=>input.addEventListener('change',()=>{airportTypes[input.dataset.airportType]=input.checked;renderAviation();persist();}));
let legendVisible = saved.legend === true;
let symbolSize = Number.isFinite(saved.symbolSize) ? Math.max(16, Math.min(36, saved.symbolSize)) : 24;
function persist() {
  try { localStorage.setItem('transportination.preferences', JSON.stringify({ version: 5, airportTypes, labels: labelPreferences, airways: { low: $('ifr-low').checked, high: $('ifr-high').checked, other: $('ifr-other').checked, opacity: +$('chart-opacity').value, lowColor: $('ifr-low-color').value, highColor: $('ifr-high-color').value, otherColor: $('ifr-other-color').value }, aviation: Object.fromEntries(infrastructureKeys.map(key => [key, { enabled: $(key).checked, color: $(key+'-color').value, opacity: +$(key+'-opacity').value }])), airModels: $('air-models').checked, directAir: $('direct-air').checked, weatherField: $('weather-field').value, weatherOpacity: +$('weather-opacity').value, satelliteProduct: $('satellite-product').value, filters, colors, base, legend: legendVisible, symbolSize, railways: $('railways').checked, railOpacity: +$('rail-opacity').value, stations: $('stations').checked, stationOpacity: +$('station-opacity').value, estimates: $('schedule-estimates').checked, routeOpacity: +$('route-opacity').value, radar: $('radar').checked, clouds: $('clouds').checked })); } catch { /* Private browsing can disable storage. */ }
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
  document.querySelector('[data-filter="air"]').closest('details').append($('air-options'));
  const railOptions = $('rail-options');
  document.querySelector('[data-filter="rail"]').closest('details').append(railOptions);
  $$('[data-filter]').forEach(input => input.addEventListener('change', () => {
    filters[input.dataset.filter] = input.checked; persist(); refreshVisibility(); updateLegend();
    if (input.dataset.filter === 'space') updateOrbits();
    if (input.dataset.filter === 'air') { renderAviation(); refreshCharts(); }
    if (input.dataset.filter === 'sea') { marineClient?.setActive(filters.sea && !document.hidden); if (filters.sea) refreshShips(); }
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
  // Terrain depth testing has no purpose on the flat projection, and its
  // billboard depth shaders are very expensive during the projection switch.
  viewer.scene.globe.depthTestAgainstTerrain = !to2D;
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
  $('base-labels').checked = value === 'roads' || (labelPreferences[value] ?? ['political','ocean'].includes(value));
  $('base-labels').disabled = value === 'roads';
  $('labels-note').textContent = value === 'roads' ? 'El fondo de OpenStreetMap incluye las etiquetas en la propia imagen.' : 'Activa nombres y referencias sobre este fondo. La selección se guarda para cada mapa.';
  if (value !== 'roads' && $('base-labels').checked) referenceLayer = viewer.imageryLayers.addImageryProvider(esriProvider(C, value === 'ocean' || value === 'bathymetry' ? 'Ocean/World_Ocean_Reference' : 'Reference/World_Boundaries_and_Places', 19, '© Esri'), 1);
  $$('[data-base]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.base === base)));
  persist(); viewer.scene.requestRender();
}
$$('[data-base]').forEach(b => b.addEventListener('click', () => { if (viewer) setBase(b.dataset.base); }));
$('direct-air').checked=saved.directAir===true;
$('direct-air').addEventListener('change',()=>{emptyDirect=0;persist();refreshDirectAir();});
$('air-models').checked=saved.airModels!==false;
$('air-models').addEventListener('change',()=>{aircraft3D?.update(selected,$('air-models').checked); if(selected?.kind==='air'&&symbols.has(selected.id)){const marker=symbols.get(selected.id);marker.width=aircraft3D?.entity?.show?8:symbolSize;marker.height=marker.width;} persist(); viewer?.scene.requestRender();});
$('base-labels').addEventListener('change', () => { labelPreferences[base] = $('base-labels').checked; setBase(base); });
function renderAviation() {
  if (!aviationView) return;
  const options = { enabled: filters.air, airportTypes, airways: { low: $('ifr-low').checked, high: $('ifr-high').checked, other: $('ifr-other').checked, opacity: +$('chart-opacity').value, lowColor: $('ifr-low-color').value, highColor: $('ifr-high-color').value, otherColor: $('ifr-other-color').value }, ...Object.fromEntries(infrastructureKeys.map(key => [key,{ enabled: $(key).checked, color: $(key+'-color').value, opacity: +$(key+'-opacity').value }])) };
  aviationView.render(options, center());
}
for (const key of infrastructureKeys) {
  const pref = aviationPreferences[key];
  $(key).checked = pref?.enabled === true;
  if (/^#[\da-f]{6}$/i.test(pref?.color)) $(key+'-color').value = pref.color;
  if (Number.isFinite(pref?.opacity)) $(key+'-opacity').value = Math.max(0,Math.min(1,pref.opacity));
  for (const id of [key,key+'-color',key+'-opacity']) $(id).addEventListener('input', () => { clearTimeout(aviationTimer); aviationTimer = setTimeout(renderAviation,100); persist(); });
}
function refreshCharts() { renderAviation(); persist(); }
for (const level of ['low', 'high', 'other']) {
  $('ifr-' + level).checked = saved.airways?.[level] === true;
  const color = saved.airways?.[level + 'Color'];
  if (/^#[\da-f]{6}$/i.test(color)) $('ifr-' + level + '-color').value = color;
}
if (Number.isFinite(saved.airways?.opacity)) $('chart-opacity').value = saved.airways.opacity;
for (const id of ['ifr-low','ifr-high','ifr-other','ifr-low-color','ifr-high-color','ifr-other-color','chart-opacity']) $(id).addEventListener('input',refreshCharts);
$('satellite-product').value = ['world','meteosat','indian'].includes(saved.satelliteProduct) ? saved.satelliteProduct : 'world';
$('satellite-product').addEventListener('change',()=>{persist();refreshClouds();});
$('weather-field').value = ['wind','rain','temperature'].includes(saved.weatherField) ? saved.weatherField : '';
$('weather-opacity').value = Number.isFinite(saved.weatherOpacity) ? Math.max(0,Math.min(1,saved.weatherOpacity)) : .6;
async function refreshForecast() {
  if(!weatherView) return;
  const field=$('weather-field').value;
  if(!field) { await weatherView.render('',0,0); $('weather-legend').hidden=true; return; }
  try {
    if(!weatherLoaded || Date.now()-weatherPacketAt>900000) { await weatherView.load(); weatherLoaded=true; weatherPacketAt=Date.now(); const nearest=weatherView.packet.times.findIndex(t=>t>=Date.now()-1800000); $('weather-hour').value=Math.max(0,nearest); }
    const packet=weatherView.packet, hour=+$('weather-hour').value;
    await weatherView.render(field,hour,+$('weather-opacity').value);
    $('weather-hour-label').textContent=date(packet.times[hour]);
    const scale=SCALES[field]; $('weather-legend').innerHTML='<strong>'+scale.title+'</strong><div class="weather-scale" style="background:linear-gradient(to right,'+scale.stops.map(s=>'rgb('+s[1].join(',')+')').join(',')+')"></div><div class="scale-values">'+scale.stops.map(s=>'<span>'+s[0]+'</span>').join('')+'</div><small>Modelo · '+date(packet.times[hour])+'</small>'; $('weather-legend').hidden=false;
    $('forecast-note').textContent='Previsión de modelos Open-Meteo, no observación. Malla mundial de 5°, interpolada; entre 80° S y 80° N. Consultada: '+date(packet.fetchedAt)+(packet.error?' · Última consulta falló: '+packet.error:'')+(Date.now()-packet.fetchedAt>28800000?' · Previsión atrasada':'')+'.';
  }catch(e){$('forecast-note').textContent='Previsión: '+e.message;}
}
for(const id of ['weather-field','weather-hour','weather-opacity']) $(id).addEventListener('input',()=>{ clearTimeout(weatherTimer); weatherTimer=setTimeout(refreshForecast,150); if(radarLayer) radarLayer.alpha=+$('weather-opacity').value; cloudLayers.forEach(l=>l.alpha=+$('weather-opacity').value); persist(); viewer?.scene.requestRender(); });
async function requestAircraftMetadata(item) {
  if(item.kind!=='air'||metadata.has(item.code)) return;
  metadata.set(item.code,null);
  try {
    const data=await getJson('https://api.adsbdb.com/v0/aircraft/'+encodeURIComponent(item.code),10000), a=data.response?.aircraft;
    if(!a) return;
    const record={registration:a.registration||item.registration,model:a.icao_type||item.model,modelName:a.type,manufacturer:a.manufacturer,owner:a.registered_owner}; metadata.set(item.code,record);
    if(selected?.id===item.id){Object.assign(selected,record);showDetail(selected);}
  }catch{/* Unknown records remain unavailable. */}
}
async function loadAirHistory() {
  if (selected?.kind !== 'air' || !/^[0-9a-f]{6}$/i.test(selected.code)) return;
  const item = selected, code = item.code.toLowerCase(), key = 'air-history:' + code;
  if (busy.has(key) || Date.now() - (airHistoryAt.get(code) || 0) < 600000) return;
  busy.add(key);
  try {
    let history;
    try { history = await getJson('./data/air-history/' + code.slice(0, 2) + '.json'); }
    catch { history = await getJson('./data/air-tracks.json'); }
    routeView.importHistory(history); airHistoryAt.set(code, Date.now());
    if (selected?.id === item.id) drawRoute();
    if (mode === 'live') {
      try {
        const detailed = await getJson(api('aircraft/track?icao24=' + code));
        routeView.importHistory(detailed);
        if (selected?.id === item.id) drawRoute();
      } catch { /* The dated observations remain available if the experimental trajectory is unavailable. */ }
    }
  } catch { /* First edition has no earlier samples. */ }
  finally { busy.delete(key); }
}
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
  $('weather-note').textContent = [radarTime && $('radar').checked ? 'Radar: ' + date(radarTime * 1000) : '', cloudTimes.length && $('clouds').checked ? 'Infrarrojo: ' + cloudTimes.join(' · ') + '. ' + ({world:'Mosaico global cada 3 horas; pueden faltar zonas polares',meteosat:'Meteosat · Europa y África · 15 minutos',indian:'Meteosat · océano Índico · 15 minutos'})[$('satellite-product').value] + '. Resolución meteorológica.' : ''].filter(Boolean).join(' · ');
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
      radarLayer = viewer.imageryLayers.addImageryProvider(new C.UrlTemplateImageryProvider({ url: `${data.host}${frame.path}/256/{z}/{x}/{y}/2/1_1.png`, maximumLevel: 7, credit: new C.Credit('<a href="https://www.rainviewer.com/">RainViewer</a>', false) }));
      radarLayer.alpha = +$('weather-opacity').value; radarTime = frame.time;
    }
    radarLayer.show = $('radar').checked; weatherNote(); viewer.scene.requestRender();
  } catch (e) { $('weather-note').textContent = 'Radar: ' + e.message; } finally { busy.delete('radar'); }
}
async function refreshClouds() {
  if (!viewer || busy.has('clouds')) return;
  if (!$('clouds').checked) { cloudLayers.forEach(l => { l.show=false; }); weatherNote(); viewer.scene.requestRender(); return; }
  busy.add('clouds');
  try {
    const response=await fetch('https://view.eumetsat.int/geoserver/wms?service=WMS&request=GetCapabilities', {signal:AbortSignal.timeout(20000)});
    if (!response.ok) throw new Error('EUMETSAT: HTTP '+response.status);
    const xml=new DOMParser().parseFromString(await response.text(),'application/xml');
    const name=({world:'mumi:worldcloudmap_ir108',meteosat:'msg_fes:ir108',indian:'msg_iodc:ir108'})[$('satellite-product').value];
    const node=[...xml.querySelectorAll('Layer')].find(n => [...n.children].some(c=>c.tagName==='Name'&&c.textContent===name));
    const time=[...node?.children||[]].find(c=>c.tagName==='Dimension'&&c.getAttribute('name')==='time')?.getAttribute('default');
    if (!time) throw new Error('No hay fecha de imagen disponible');
    cloudLayers.forEach(l=>viewer.imageryLayers.remove(l));
    const layer=viewer.imageryLayers.addImageryProvider(new C.WebMapServiceImageryProvider({url:'https://view.eumetsat.int/geoserver/wms',layers:name,parameters:{transparent:true,format:'image/png',time},tilingScheme:new C.GeographicTilingScheme(),maximumLevel:5,credit:new C.Credit('<a href="https://www.eumetsat.int/">EUMETSAT · EUMETView</a>',false)}));
    layer.alpha=+$('weather-opacity').value; layer.show=$('clouds').checked; cloudLayers=[layer]; cloudTimes=[date(Date.parse(time))]; weatherNote(); viewer.scene.requestRender();
  } catch(e) { $('weather-note').textContent='Satélite meteorológico: '+e.message; } finally { busy.delete('clouds'); }
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
  selected = null; aircraft3D?.update(null,false); follow = false; detailKey = ''; routeView?.clear(); $('detail').hidden = true; document.body.classList.remove('detail-open'); viewer?.scene.requestRender();
}
const stopTime = (time, zone) => time ? new Date(time).toLocaleTimeString('es-ES', { timeZone: zone || 'UTC', hour: '2-digit', minute: '2-digit' }) : '—';
function drawRoute() { if (routeView) { routeView.intensity = +$('route-opacity').value; routeView.draw(selected, colors[selected?.category], $('stations').checked, +$('station-opacity').value); } }
function showDetail(item) {
  const changed = selected?.id !== item.id, scroll = changed ? 0 : $('detail').scrollTop;
  if (changed && selected && symbols.has(selected.id)) symbols.get(selected.id).scale = 1;
  if (changed) follow = false;
  selected = item;
  if (item.kind === 'air' && metadata.get(item.code)) Object.assign(item, metadata.get(item.code));
  if (item.kind === 'air') { selected.flightRoute = flightRoutes.get(item.name) || null; selected.flightNumber = selected.flightRoute?.flightNumber; }
  if (symbols.has(item.id)) symbols.get(item.id).scale = 1.4;
  const c = CATEGORY[item.category], isSpace = item.kind === 'space', estimated = item.positionMode === 'schedule';
  const j = item.journey, progress = j && journeyProgress(j), stops = j?.stops || [], commercialStops = stops.filter(s => s.commercial !== false);
  let next = progress?.next;
  if (!estimated && stops.length) {
    const byCode = stops.findIndex(s => s.id === item.stop);
    next = byCode >= 0 ? byCode : stops.reduce((best, s, i) => distance(item, s) < distance(item, stops[best]) ? i : best, 0);
  }
  const location = j && next !== undefined ? (estimated && progress?.atStation ? 'En ' + stops[next].name : 'Tramo de ' + stops[Math.max(0, next - 1)].name + ' a ' + stops[next].name) : null;
  const fields = [['Indicativo de llamada', item.kind === 'air' ? item.name : null], ['Indicativo IATA', item.flightNumber], ['Vuelo comercial', item.kind === 'air' ? 'Número comercial no publicado por esta fuente' : null], ['Nivel de vuelo', Number.isFinite(item.flightLevel) ? 'FL' + String(item.flightLevel).padStart(3,'0') + ' · altitud barométrica estándar' : null], ['Velocidad vertical', Number.isFinite(item.verticalRate) ? number(item.verticalRate * 196.8504) + ' ft/min' : null], ['Squawk', item.squawk], ['Fabricante', item.manufacturer], ['Modelo publicado', item.modelName], ['Titular registrado', item.owner], ['Antigüedad', item.kind === 'air' ? 'Sin fecha de fabricación publicada' : null], ['Origen', item.origin], ['Identificador', item.code], ['Matrícula', item.registration], ['Modelo', item.model], ['País', item.country], ['Operador', item.operator], ['Viaje', j ? j.code : item.trip], ['Situación', location], ['Destino', item.destination], ['Indicativo AIS', item.callSign], ['Tipo AIS', item.shipType], ['IMO', item.imo], ['Rumbo', Number.isFinite(item.bearing) ? number(item.bearing) + '°' : null]];
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
  const routeNote = item.kind === 'air' ? (aircraftMesh(item.model) ? '<p class="small-note">Modelo 3D esquemático de la familia '+esc(item.model)+'. Geometría ilustrativa; no reproduce la librea ni todos los detalles del ejemplar.</p>' : '') + '<p class="small-note">Estela de posiciones recibidas: blanco en tierra → azul → cian → verde → amarillo → naranja → rojo → violeta. Las líneas continuas unen observaciones recibidas; entre instantáneas espaciadas el trazado es aproximado. Se conserva el vuelo disponible hasta 24 horas, sin garantizar recepción desde el despegue. La línea discontinua entre aeropuertos es solo una referencia de origen y destino.</p>' : item.kind === 'sea' ? '<p class="small-note">La estela conserva observaciones AIS nuevas. La ruta futura solo se mostrará cuando la fuente la publique.</p>' : '';
  $('detail').style.setProperty('--vehicle-color', colors[item.category]);
  $('detail').innerHTML = '<header class="panel-head"><span>' + esc(KIND[item.kind]) + '</span><button id="detail-close" aria-label="Cerrar ficha"><svg><use href="#i-close"/></svg></button></header><div class="vehicle-hero"><img src="' + imageFor(item.category) + '" alt=""><div><h2 id="detail-title">' + esc(item.name) + '</h2><p>' + esc(c.label) + '</p></div></div><div class="vehicle-state">' + esc(isSpace ? 'Órbita calculada · SGP4' : estimated ? 'Posición estimada por horario · no GPS' : item.state) + (old ? ' · Posición atrasada' : '') + '</div>' + routeHead + '<div class="metrics"><div><span>' + (isSpace ? 'PERIODO' : 'VELOCIDAD PUBLICADA') + '</span><strong>' + number(isSpace ? item.periodMinutes : item.speed) + '</strong><small>' + (isSpace ? 'min' : 'km/h') + '</small></div><div><span>ALTITUD</span><strong>' + number(item.altitude) + '</strong><small>m</small></div></div><dl class="vehicle-data">' + fields.filter(([, value]) => value !== undefined && value !== null && value !== '').map(([label, value]) => '<div><dt>' + label + '</dt><dd>' + esc(value) + '</dd></div>').join('') + '<div><dt>Latitud / longitud</dt><dd>' + (item.lat?.toFixed(5) ?? '—') + '° / ' + (item.lon?.toFixed(5) ?? '—') + '°</dd></div></dl>' + stopList + routeNote + '<div class="observation"><strong>' + esc(item.source) + '</strong><p>' + esc(stamp) + '</p>' + (estimated ? '<p>Movimiento calculado cada segundo entre los horarios disponibles. Los retrasos publicados se aplican cuando están disponibles; no acredita la ubicación real.</p>' : '') + (isSpace ? '<p>Predicción orbital a partir de elementos publicados; no es telemetría GPS.</p>' : '') + '</div><div class="vehicle-actions"><button id="locate-vehicle" class="text-button"><svg><use href="#i-target"/></svg>Centrar</button><button id="follow-vehicle" class="text-button" aria-pressed="' + follow + '">Seguir movimiento</button>'+ (item.kind==='air'&&aircraftMesh(item.model)?'<button id="inspect-aircraft" class="text-button">Ver modelo 3D</button>':'')+'</div>';
  $('detail-close').addEventListener('click', closeDetail);
  $('inspect-aircraft')?.addEventListener('click', async()=>{if(viewer.scene.mode!==C.SceneMode.SCENE3D){$('dimension').click();await new Promise(r=>setTimeout(r,250));}follow=true;aircraft3D.update(selected,$('air-models').checked);const target=C.Cartesian3.fromDegrees(selected.lon,selected.lat,selected.altitude||0);viewer.camera.lookAt(target,new C.HeadingPitchRange(C.Math.toRadians(selected.bearing||0)-.5,-.65,250));viewer.camera.lookAtTransform(C.Matrix4.IDENTITY);$('follow-vehicle').setAttribute('aria-pressed','true');viewer.scene.requestRender();});
  $('locate-vehicle').addEventListener('click', () => fly(selected.lon, selected.lat, isSpace ? Math.max(1000000, selected.altitude * 2) : 90000));
  $('follow-vehicle').addEventListener('click', () => { follow = !follow; $('follow-vehicle').setAttribute('aria-pressed', String(follow)); if (follow) fly(selected.lon, selected.lat, isSpace ? Math.max(1000000, selected.altitude * 2) : 90000); });
  $$('[data-stop]').forEach(button => button.addEventListener('click', () => { follow = false; const stop = selected.journey.stops[+button.dataset.stop]; fly(stop.lon, stop.lat, 25000); }));
  $('detail').hidden = false; $('detail').scrollTop = scroll; document.body.classList.add('detail-open'); viewer.scene.requestRender();
  if (changed) { drawRoute(); requestFlightRoute(item); requestAircraftMetadata(item); loadAirHistory(); if (item.kind === 'space') worker?.postMessage({ type: 'route', id: item.id, index: satellites.findIndex(s => s.id === item.id), period: item.periodMinutes }); }
}
async function requestFlightRoute(item) {
  if (item.kind !== 'air' || flightRoutes.has(item.name) || !/^[A-Z]{2,3}\d[A-Z\d]*$/.test(item.name)) return;
  flightRoutes.set(item.name, null);
  try {
    const data = await getJson('https://api.adsbdb.com/v0/callsign/' + encodeURIComponent(item.name), 10000);
    const route = data.response?.flightroute;
    const airport = a => a && Number.isFinite(a.latitude) && Number.isFinite(a.longitude) ? { name: a.name + ' · ' + (a.iata_code || a.icao_code), lat: a.latitude, lon: a.longitude } : null;
    const origin = airport(route?.origin), destination = airport(route?.destination);
    if (origin && destination) { flightRoutes.set(item.name, { origin, destination, flightNumber: route.callsign_iata }); if (selected?.name === item.name && selected?.id === item.id) { selected.flightRoute = { origin, destination, flightNumber: route.callsign_iata }; selected.flightNumber = route.callsign_iata; showDetail(selected); drawRoute(); } }
  } catch { /* Unknown routes remain explicitly unavailable, without invented airports. */ }
}
function sourceState(kind) {
  if (kind === 'rail') return 'España, Francia y Austria · horarios; Irlanda · horarios previstos; Finlandia, Noruega, Estados Unidos y Canadá · posiciones publicadas. ' + [errors.rail, errors.fi, errors.na, errors.no, errors.schedules].filter(Boolean).join(' · ');
  if (errors[kind]) return 'La fuente no responde. ' + errors[kind];
  if (kind === 'space') return satellitePacket ? 'CelesTrak · posiciones calculadas con SGP4; elementos: ' + date(satellitePacket.fetchedAt) : 'Cargando elementos orbitales…';
  if (kind === 'sea') return 'Fintraffic · AIS regional, principalmente Báltico. ' + (marineState || 'Consultando posiciones publicadas…') + ' ' + (packets.sea?.status === 'unconfigured' ? 'AIS mundial pendiente de activación.' : 'AIS Stream: ' + (packets.sea?.status || 'instantáneas') + '.');
  if (!packets[kind]) return 'Fuente pendiente de conexión.';
  const coverage = kind === 'air' ? 'Mundial · cobertura de receptores' : kind === 'rail' ? 'Renfe y SNCF · horarios; Finlandia, Estados Unidos y Canadá · consultas directas' : 'Mundial · cobertura AIS';
  return coverage + (kind === 'air' && mode === 'snapshot' ? ' · Recepción terrestre incompleta, especialmente sobre océanos y África. Actualización rápida pendiente de servidor; no es Flightradar.' : '') + ' · ' + (mode === 'snapshot' ? 'Instantánea: ' : 'Consulta: ') + date(packets[kind].fetchedAt);
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
  try { const status = await getJson('./api/status', 3000); if (status.mode === 'live') { mode = 'live'; worldRefreshMs = [90000,120000,900000].includes(status.worldRefreshMs) ? status.worldRefreshMs : 900000; return; } } catch { /* GitHub Pages has no server. */ }
  try {
    const config = await getJson('./data/config.json', 4000);
    if (config.liveApiUrl) {
      const url = new URL(config.liveApiUrl);
      if (url.protocol !== 'https:' || url.username || url.password) return;
      const candidate = url.href.replace(/\/$/, '');
      const status = await getJson(candidate + '/api/status', 15000);
      if (status.mode === 'live') { apiRoot = candidate; mode = 'live'; worldRefreshMs = [90000,120000,900000].includes(status.worldRefreshMs) ? status.worldRefreshMs : 900000; }
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
      else { globalSea = feed[kind].items; syncSea(); }
    }
  } catch (e) { notice('No se ha podido cargar la instantánea: ' + e.message); } finally { busy.delete('snapshot'); updateStatus(); }
}
async function refreshWorld() {
  if (mode !== 'live' || busy.has('world')) return; busy.add('world');
  try { const packet = await getJson(api('aircraft/world')); globalAir = packet.items; packets.air = packet; errors.air = ''; syncSymbols('air', mergeAircraft(globalAir, regionalAir)); }
  catch (e) { errors.air = 'OpenSky: ' + e.message; } finally { busy.delete('world'); updateStatus(); }
}
async function refreshRegion() {
  if (mode !== 'live') { await refreshDirectAir(); return; }
  if (busy.has('region') || !filters.air || document.hidden) return;
  const view = center(); if (view.height > 4000000) return;
  const lat = Math.round(Math.max(-85, Math.min(85, view.lat)) * 100) / 100, lon = Math.round(view.lon * 100) / 100;
  const radius = Math.max(5, Math.min(250, Math.ceil(view.height / 1200)));
  busy.add('region');
  try { const packet = await getJson(api(`aircraft?lat=${lat}&lon=${lon}&radius=${radius}`)); regionalAir = packet.items; lastRegion = `${lat},${lon}`; errors.region = ''; syncSymbols('air', mergeAircraft(globalAir, regionalAir)); }
  catch { /* The world layer remains intact when a regional receiver is unavailable. */ } finally { busy.delete('region'); }
}
async function refreshDirectAir() {
  if(!viewer||!$('direct-air').checked||!filters.air||document.hidden||busy.has('direct-air')||Date.now()-lastDirectPoll<10000)return;
  const view=center(); if(view.height>2000000){$('direct-air-note').textContent='Acércate a una zona: radio máximo de recepción directa de 100 millas náuticas. La capa mundial conserva las instantáneas.';return;}
  let budget={day:new Date().toISOString().slice(0,10),used:0};
  try{const old=JSON.parse(localStorage.getItem('transportination.direct-air-budget')||'{}');if(old.day===budget.day)budget.used=old.used||0;}catch{}
  const stop=message=>{$('direct-air').checked=false;$('direct-air-note').textContent=message;persist();};
  if(budget.used>=100){stop('Cuota diaria de consultas directas agotada. Sigue disponible la instantánea mundial.');return;}
  busy.add('direct-air');lastDirectPoll=Date.now();budget.used++;
  try{localStorage.setItem('transportination.direct-air-budget',JSON.stringify(budget));}catch{}
  try {
    const r=await fetch('https://avioadsb.org/v1/point/'+Math.max(-85,Math.min(85,view.lat)).toFixed(2)+'/'+view.lon.toFixed(2)+'/'+Math.max(5,Math.min(100,Math.ceil(view.height/1200))),{signal:AbortSignal.timeout(10000)});
    if(r.status===429){stop('La red ha alcanzado la cuota de AvioADSB. Las consultas se han detenido; no se reintenta automáticamente.');return;}
    if(!r.ok)throw new Error('HTTP '+r.status);
    const fresh=normalizeAircraft(await r.json(),Date.now(),'AvioADSB');
    if(!fresh.length){emptyDirect++;if(emptyDirect>=3)stop('AvioADSB no recibe posiciones en esta zona. Su red tiene cobertura limitada; se han detenido las consultas.');else $('direct-air-note').textContent='Sin recepción directa en esta zona. Comprobando cobertura…';return;}
    emptyDirect=0;regionalAir=mergeAircraft(regionalAir,fresh);syncSymbols('air',mergeAircraft(globalAir,regionalAir));
    $('direct-air-note').textContent='Recepción regional cada 10 s; movimiento interpolado entre observaciones recientes. '+budget.used+' de 100 consultas diarias usadas en este navegador. La cuota se comparte con la red.';
    if(!directCredit){directCredit=new C.Credit('<a href="https://avioadsb.org/">Data: AvioADSB (CC BY 4.0)</a>',true);viewer.scene.frameState.creditDisplay.addStaticCredit(directCredit);}
    drawRoute();
  }catch(e){stop('Recepción directa no disponible: '+e.message);}finally{busy.delete('direct-air');}
}
async function refreshRail() {
  if (mode !== 'live' || busy.has('rail') || document.hidden) return; busy.add('rail');
  try { packets.rail = await getJson(api('trains')); errors.rail = ''; railEngine.receive(packets.rail.items, 'rail:commuter:'); railEngine.receive(packets.rail.items, 'rail:longDistance:'); syncRail(); }
  catch (e) { errors.rail = e.message; } finally { busy.delete('rail'); updateStatus(); }
}
async function refreshShips() {
  if (mode !== 'live' || busy.has('sea') || !filters.sea || document.hidden) return; busy.add('sea');
  try { packets.sea = await getJson(api('ships')); errors.sea = ''; globalSea = packets.sea.items; syncSea(); }
  catch (e) { errors.sea = e.message; } finally { busy.delete('sea'); updateStatus(); }
}
function syncSea() { syncSymbols('sea', mergeAircraft(globalSea, regionalSea)); }
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
  if (!busy.has('no') && now - lastNoPoll > 30000) work.push((async()=> {
    busy.add('no'); lastNoPoll=now;
    try {
      const r=await fetch('https://api.entur.io/realtime/v2/vehicles/graphql',{method:'POST',headers:{'Content-Type':'application/json','ET-Client-Name':'alejandropico-transportination'},body:JSON.stringify({query:ENTUR_QUERY}),signal:AbortSignal.timeout(20000)});
      if(!r.ok) throw new Error('HTTP '+r.status); const data=await r.json(); if(data.errors) throw new Error('Consulta no disponible');
      railEngine.receive(enturRail(data),'rail:no:'); errors.no=''; syncRail();
    }catch(e){errors.no='Noruega: '+e.message;}finally{busy.delete('no');}
  })());
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
    lastMotion = now; syncRail(); updateStatus(); aircraft3D?.update(selected,$('air-models').checked);
    if (selected && now - lastRouteDraw > 5000) { drawRoute(); lastRouteDraw = now; }
  }
  for (const [id, tween] of tweens) {
    const marker = symbols.get(id); if (!marker) { tweens.delete(id); continue; }
    const t = Math.min(1, (now - tween.startedAt) / tween.duration), p = interpolate(tween.from, tween.to, t);
    marker.position = C.Cartesian3.fromDegrees(p.lon, p.lat, Math.max(30, p.altitude));
    if (t >= 1) tweens.delete(id);
  }
  if (selected && (tweens.has(selected.id) || now-lastFollow>950)) {
    lastFollow=now;
    const marker=symbols.get(selected.id), position=marker?.position;
    if(position){
      const cart=C.Cartographic.fromCartesian(position), visual={...selected,lon:C.Math.toDegrees(cart.longitude),lat:C.Math.toDegrees(cart.latitude),altitude:cart.height};
      if(selected.kind==='air')aircraft3D?.update(visual,$('air-models').checked);
      if(follow&&!morphing&&!viewer.camera._currentFlight){
        const view=center(), range=C.Cartesian3.distance(viewer.camera.positionWC,position);
        if(selected.kind==='air'&&viewer.scene.mode===C.SceneMode.SCENE3D&&range<20000){viewer.camera.lookAt(position,new C.HeadingPitchRange(viewer.camera.heading,viewer.camera.pitch,range));viewer.camera.lookAtTransform(C.Matrix4.IDENTITY);}
        else viewer.camera.setView({destination:C.Cartesian3.fromDegrees(visual.lon,visual.lat,view.height)});
      }
    }
  }
  if (tweens.size) viewer.scene.requestRender();
}
async function loadSatellites() {
  try {
    try { satellitePacket = await getJson(mode === 'live' ? api('satellites') : './data/satellites.json'); }
    catch (e) { if (mode !== 'live') throw e; satellitePacket = await getJson('./data/satellites.json'); }
    satellites = normalizeSatellites(satellitePacket.records); items.space = satellites;
    worker = new Worker(new URL('./orbit-worker.js?v=0.5', import.meta.url), { type: 'module' });
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
    C.CreditDisplay.cesiumCredit = new C.Credit('<span></span>', false);
    viewer = new C.Viewer('map', { baseLayer: false, terrainProvider: new C.EllipsoidTerrainProvider(), animation: false, timeline: false, baseLayerPicker: false, geocoder: false, homeButton: false, sceneModePicker: false, navigationHelpButton: false, fullscreenButton: false, infoBox: false, selectionIndicator: false, requestRenderMode: true, maximumRenderTimeChange: Infinity, scene3DOnly: false });
    viewer.scene.globe.baseColor = C.Color.fromCssColorString('#101d27'); viewer.scene.globe.enableLighting = false;
    viewer.scene.globe.depthTestAgainstTerrain = true;
    viewer.scene.backgroundColor = C.Color.fromCssColorString('#080f16'); viewer.scene.globe.maximumScreenSpaceError = 1.5;
    viewer.scene.skyBox.show = false;
    viewer.scene.postProcessStages.fxaa.enabled = true;
    viewer.camera.setView({ destination: C.Cartesian3.fromDegrees(HOME.lon, HOME.lat, HOME.height) });
    Object.keys(KIND).forEach(kind => { stores[kind] = viewer.scene.primitives.add(new C.BillboardCollection({ scene: viewer.scene })); });
    aircraft3D = new Aircraft3D(C,viewer); aviationView = new AviationView(C, viewer); weatherView = new WeatherView(C, viewer);
    viewer.scene.preRender.addEventListener(()=>aviationView.updateVisibility());
    aviationView.load().then(error => { $('aviation-note').textContent=error ? 'Catálogo: '+error : 'OurAirports · catálogo mundial. FAA · límites y aerovías de cobertura parcial. © DFS · Alemania · CC BY 4.0. España y otros países: regiones y aerovías pendientes de una fuente reutilizable.'; renderAviation(); });
    routeView = new RouteView(C, viewer); stationStore = viewer.scene.primitives.add(new C.BillboardCollection({ scene: viewer.scene }));
    [["https://www.dfs.de/homepage/de/services/geo-daten/","© DFS · INSPIRE · Alemania · CC BY 4.0"],["https://www.digitraffic.fi/en/marine-traffic/","Fintraffic / Digitraffic · AIS · CC BY 4.0"],["https://www.adsb.lol/docs/open-data/api/","ADSB.lol · ODbL 1.0"],["https://cesium.com/","CesiumJS"],["https://opensky-network.org/data/api","OpenSky Network"],["https://amtraker.com/","Amtraker · ODC-By"],["https://www.digitraffic.fi/en/railway-traffic/","Fintraffic · CC BY 4.0"],["https://data.renfe.com/","Renfe · CC BY 4.0"],["https://transport.data.gouv.fr/datasets/horaires-sncf","SNCF · ODbL"],["https://ourairports.com/data/","OurAirports · dominio público"],["https://www.faa.gov/data/aero_data","FAA · datos aeronáuticos"],["https://developer.entur.org/pages-real-time-vehicle/","Entur · NLOD"],["https://data.oebb.at/de/datensaetze~soll-fahrplan-gtfs~","ÖBB-Personenverkehr AG · CC BY 4.0 · horarios transformados en posiciones estimadas"],["https://api.irishrail.ie/realtime/","Irish Rail · horarios previstos"],["https://www.adsbdb.com/","adsbdb · metadatos de aeronaves y rutas"]].forEach(([url,label])=>viewer.scene.frameState.creditDisplay.addStaticCredit(new C.Credit(`<a href="${url}">${label}</a>`,false)));
    const creditTitle=document.querySelector('.cesium-credit-lightbox-title');if(creditTitle)creditTitle.textContent='Fuentes y atribuciones';
    const initialCredit=new C.Credit('<a href="https://amtraker.com/">Amtraker · ODC-By</a>',true); viewer.scene.frameState.creditDisplay.addStaticCredit(initialCredit); document.addEventListener('pointerdown',()=>{viewer.scene.frameState.creditDisplay.removeStaticCredit(initialCredit);viewer.scene.requestRender();},{once:true});
    setBase(base);
    railwayLayer = viewer.imageryLayers.addImageryProvider(new C.UrlTemplateImageryProvider({ url: 'https://a.tiles.openrailwaymap.org/standard/{z}/{x}/{y}.png', minimumLevel: 2, maximumLevel: 19, credit: new C.Credit('<a href="https://www.openrailwaymap.org/">© OpenStreetMap</a>', true) }));
    railwayLayer.alpha = +$('rail-opacity').value;
    viewer.camera.changed.addEventListener(updateCamera);
    viewer.camera.moveEnd.addEventListener(() => { updateCamera(); renderStations(); clearTimeout(aviationTimer); aviationTimer = setTimeout(renderAviation,250); clearTimeout(stationTimer); stationTimer = setTimeout(refreshStations, 1200); if (!morphing) refreshRegion(); });
    viewer.screenSpaceEventHandler.setInputAction(event => { const pick = viewer.scene.pick(event.position); if (pick?.id?.transport) showDetail(pick.id.transport); else if(pick?.id?.properties?.transport) showDetail(pick.id.properties.transport.getValue()); else if (pick?.id?.infrastructure) notice([pick.id.infrastructure.name,pick.id.infrastructure.code,pick.id.infrastructure.type,pick.id.infrastructure.frequency ? pick.id.infrastructure.frequency+' kHz' : ''].filter(Boolean).join(' · ')); else if (pick?.id?.station) notice(pick.id.station.name); else if (pick?.id?.properties?.station) notice(pick.id.properties.station.getValue().name); else closeDetail(); }, C.ScreenSpaceEventType.LEFT_CLICK);
    renderFilters(); updateLegend(); updateCamera(); $('loading').hidden = true;
    await discoverBackend();
    // An initial world snapshot avoids a blank globe while live providers answer.
    await refreshSnapshot();
    marineClient = new MarineClient(fresh => { regionalSea = fresh; syncSea(); drawRoute(); updateStatus(); }, state => { marineState = state; updateStatus(); });
    marineClient.setActive(filters.sea && !document.hidden);
    document.addEventListener('visibilitychange', () => marineClient.setActive(filters.sea && !document.hidden));
    await loadRailway(); refreshInternational();
    if (mode === 'live') await Promise.allSettled([refreshWorld(), refreshRail(), refreshShips()]);
    loadSatellites(); refreshRadar(); refreshClouds(); refreshForecast(); updateStatus();
    setInterval(() => { if (!document.hidden) { updateStatus(); if (selected && selected.kind !== 'space') { showDetail(selected); loadAirHistory(); } } }, 10000);
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
    setInterval(() => { if(!document.hidden){refreshRadar(); refreshClouds(); refreshForecast();} }, 600000);
  } catch (e) { $('loading').querySelector('p').textContent = 'El mundo no ha podido abrirse'; $('loading').querySelector('small').textContent = e.message; }
}
init();
