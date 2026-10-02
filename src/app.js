import { isVisible, freshness, ageSeconds, searchVehicles, restoreFilters } from './model.js';
const $ = id => document.getElementById(id);
const $$ = query => [...document.querySelectorAll(query)];
const HOME = { lon: -3, lat: 40, height: 19000000 };
const fmt = new Intl.NumberFormat('es-ES', { maximumFractionDigits: 0 });
const fullDate = time => time ? new Date(time).toLocaleString('es-ES', { timeZone: 'Europe/Madrid' }) + ' · Madrid' : 'No publicada';
const escape = s => String(s ?? 'No publicado').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
let saved = {};
try { saved = JSON.parse(localStorage.getItem('transportination.preferences') || '{}'); } catch { /* Storage is optional. */ }
const filters = restoreFilters(saved.filters);
let viewer, C, mode = 'snapshot', activePanel, selected, selectedEntity, morphing = false, airBusy = false, railBusy = false;
let aircraftItems = [], trainItems = [], airPacket, railPacket, airError = '', railError = '', lastSearch = 0, noticeTimer, searchSequence = 0;
let baseLayer, railwayLayer, radarLayer, radarFrame, radarBusy = false;
let base = ['natural', 'roads', 'satellite', 'night'].includes(saved.base) ? saved.base : 'natural';
const stores = {}, entities = new Map();
function persist() { try { localStorage.setItem('transportination.preferences', JSON.stringify({ filters, base, railways: $('railways').checked, radar: $('radar').checked })); } catch { /* Private browsing can disable storage. */ } }
function notice(message) { $('notice').textContent = message; $('notice').hidden = false; clearTimeout(noticeTimer); noticeTimer = setTimeout(() => { $('notice').hidden = true; }, 6000); }
function openPanel(id) {
  const closing = activePanel === id;
  $$('.panel:not(#detail)').forEach(p => { p.hidden = true; });
  activePanel = closing ? null : id;
  if (activePanel) $(id).hidden = false;
  $$('[data-panel]').forEach(b => b.setAttribute('aria-expanded', String(b.dataset.panel === activePanel)));
  document.body.classList.toggle('panel-open', !!activePanel);
  if (activePanel === 'search') $('query').focus();
}
function closePanels() {
  const old = activePanel;
  if (old) openPanel(old);
  document.querySelector(`.toolbar [data-panel="${old}"]`)?.focus();
}
$$('[data-panel]').forEach(b => b.addEventListener('click', () => openPanel(b.dataset.panel)));
$$('[data-close]').forEach(b => b.addEventListener('click', closePanels));
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') { closePanels(); closeDetail(); }
  if (e.key === '/' && !['INPUT', 'TEXTAREA'].includes(document.activeElement.tagName)) { e.preventDefault(); if (activePanel !== 'search') openPanel('search'); }
});
function center() {
  const canvas = viewer.scene.canvas;
  const p = viewer.camera.pickEllipsoid(new C.Cartesian2(canvas.clientWidth / 2, canvas.clientHeight / 2), viewer.scene.globe.ellipsoid);
  const carto = p ? C.Cartographic.fromCartesian(p) : viewer.camera.positionCartographic;
  return { lat: Math.max(-85, Math.min(85, C.Math.toDegrees(carto.latitude))), lon: C.Math.negativePiToPi(carto.longitude) * 180 / Math.PI, height: viewer.camera.positionCartographic.height };
}
function fly(lon, lat, height) { viewer.camera.flyTo({ destination: C.Cartesian3.fromDegrees(lon, lat, height), duration: matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 1.4 }); }
function home() { fly(HOME.lon, HOME.lat, HOME.height); }
$$('[data-place]').forEach(b => b.addEventListener('click', () => {
  const places = { spain: [-3.7, 40.2, 1500000], europe: [10, 49, 5500000], barcelona: [2.17, 41.39, 70000], world: [HOME.lon, HOME.lat, HOME.height] };
  if (viewer) { if (activePanel) closePanels(); fly(...places[b.dataset.place]); }
}));
$('zoom').addEventListener('click', () => { if (viewer && !morphing) home(); });
$('dimension').addEventListener('click', () => {
  if (!viewer || morphing) return;
  const view = center(), to2D = viewer.scene.mode === C.SceneMode.SCENE3D;
  morphing = true; $('dimension').disabled = true; $('zoom').disabled = true;
  const done = viewer.scene.morphComplete.addEventListener(() => {
    done(); morphing = false; $('dimension').disabled = false; $('zoom').disabled = false;
    $('dimension').textContent = to2D ? '3D' : '2D';
    $('dimension').setAttribute('aria-label', to2D ? 'Cambiar a 3D' : 'Cambiar a 2D');
    $('dimension').title = to2D ? 'Cambiar a globo 3D' : 'Cambiar a mapa plano';
    viewer.camera.setView({ destination: C.Cartesian3.fromDegrees(view.lon, view.lat, view.height) });
    refreshVisibility(); updateCamera();
  });
  const duration = matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 1.8;
  if (to2D) viewer.scene.morphTo2D(duration); else viewer.scene.morphTo3D(duration);
});
function gibs(layer, level = 8, date = 'default') {
  return new C.UrlTemplateImageryProvider({
    url: `https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/${layer}/default/${date}/GoogleMapsCompatible_Level${level}/{z}/{y}/{x}.jpeg`,
    maximumLevel: level, credit: new C.Credit('<a href="https://www.earthdata.nasa.gov/data/tools/gibs">NASA GIBS</a>', true),
  });
}
function setBase(value) {
  const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
  const providers = {
    natural: () => gibs('BlueMarble_ShadedRelief_Bathymetry'),
    roads: () => new C.UrlTemplateImageryProvider({ url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png', maximumLevel: 19, credit: new C.Credit('<a href="https://www.openstreetmap.org/copyright">© OpenStreetMap contributors</a>', true) }),
    satellite: () => gibs('MODIS_Terra_CorrectedReflectance_TrueColor', 9, yesterday),
    night: () => gibs('VIIRS_CityLights_2012'),
  };
  const next = new C.ImageryLayer(providers[value]());
  next.imageryProvider.errorEvent.addEventListener(() => { $('base-note').textContent = 'Hay imágenes sin cargar. La fuente puede estar temporalmente inaccesible; prueba otro fondo.'; });
  if (baseLayer) viewer.imageryLayers.remove(baseLayer);
  viewer.imageryLayers.add(next, 0); baseLayer = next; base = value;
  $$('[data-base]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.base === value)));
  $('base-note').textContent = ({ natural: 'Mosaico de referencia de la Tierra, con relieve y fondo oceánico. No es una imagen en directo ni terreno 3D.', roads: 'Cartografía comunitaria: calles, ciudades y límites administrativos.', satellite: `Imágenes MODIS del ${yesterday} (UTC). Pueden tener nubes o huecos; no son vídeo en directo.`, night: 'Luces nocturnas: composición de referencia de 2012, sin actualización en directo.' })[value];
  persist(); viewer.scene.requestRender();
}
$$('[data-base]').forEach(b => b.addEventListener('click', () => { if (viewer) setBase(b.dataset.base); }));
$('railways').checked = saved.railways !== false;
$('radar').checked = saved.radar === true;
  $('railways').addEventListener('change', () => { if (railwayLayer) { railwayLayer.show = $('railways').checked && center().height < 4000000; viewer.scene.requestRender(); } persist(); });
async function refreshRadar() {
  if (!viewer || radarBusy) return;
  if (!$('radar').checked) { if (radarLayer) radarLayer.show = false; viewer.scene.requestRender(); return; }
  radarBusy = true;
  try {
    const r = await fetch('https://api.rainviewer.com/public/weather-maps.json', { signal: AbortSignal.timeout(15000) });
    if (!r.ok) throw new Error('Radar no disponible');
    const data = await r.json(), frame = data.radar?.past?.at(-1);
    if (!frame || !/^https:\/\/tilecache\.rainviewer\.com\/?$/.test(data.host)) throw new Error('No hay una imagen válida de radar');
    if (radarFrame !== frame.time || !radarLayer) {
      if (radarLayer) viewer.imageryLayers.remove(radarLayer);
      radarLayer = viewer.imageryLayers.addImageryProvider(new C.UrlTemplateImageryProvider({ url: `${data.host}${frame.path}/256/{z}/{x}/{y}/2/1_1.png`, maximumLevel: 7, credit: new C.Credit('<a href="https://www.rainviewer.com/">RainViewer</a>', true) }));
      radarLayer.alpha = .6; radarFrame = frame.time;
      radarLayer.imageryProvider.errorEvent.addEventListener(() => { $('radar-note').textContent = 'Error al cargar imágenes de radar. La cobertura no está garantizada.'; });
    }
    radarLayer.show = $('radar').checked;
    $('radar-note').textContent = `Imagen generada: ${fullDate(frame.time * 1000)}. Cobertura parcial; sin ecos no significa sin lluvia.`;
    viewer.scene.requestRender();
  } catch (e) { $('radar-note').textContent = e.message + '. No se sustituye por datos simulados.'; }
  finally { radarBusy = false; }
}
$('radar').addEventListener('change', () => { persist(); refreshRadar(); });
function marker(kind) {
  const path = kind === 'air' ? 'M15 2 18 12 27 18v3l-9-3v8l4 3v2l-7-2-7 2v-2l4-3v-8l-9 3v-3l9-6z' : 'M8 4h14v21l-4 4h-6l-4-4z M11 8h8v7h-8z M11 22h2 M17 22h2';
  const color = kind === 'air' ? '#e9b76b' : '#91c9a4';
  return 'data:image/svg+xml,' + encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 30 32"><path d="${path}" fill="${color}" stroke="#101820" stroke-width="1.3"/></svg>`);
}
const markerImages = { air: marker('air'), rail: marker('rail') };
function syncEntities(kind, items) {
  const source = stores[kind], incoming = new Set(items.map(i => i.id));
  source.entities.suspendEvents();
  for (const [id, entity] of entities) if (id.startsWith(kind + ':') && !incoming.has(id)) { source.entities.remove(entity); entities.delete(id); }
  for (const item of items) {
    let e = entities.get(item.id);
    const altitude = item.kind === 'air' ? Math.max(300, item.altitude ?? 300) : 50;
    const position = C.Cartesian3.fromDegrees(item.lon, item.lat, altitude);
    if (!e) {
      e = source.entities.add({ id: item.id, position, billboard: { image: markerImages[kind], width: kind === 'air' ? 23 : 18, height: kind === 'air' ? 23 : 20, alignedAxis: kind === 'air' ? C.Cartesian3.UNIT_Z : C.Cartesian3.ZERO, scale: 1 } });
      entities.set(item.id, e);
    }
    e.position = position; e.transport = item;
    e.billboard.rotation = kind === 'air' ? -C.Math.toRadians(item.bearing ?? 0) : 0;
    e.billboard.color = new C.Color(1, 1, 1, freshness(item) === 'recent' ? 1 : .45);
    e.show = isVisible(item, filters);
  }
  source.entities.resumeEvents();
  if (selected?.kind === kind) {
    const updated = items.find(i => i.id === selected.id);
    if (updated) showDetail(updated, false); else closeDetail();
  }
  updateStatus(); viewer.scene.requestRender();
}
function refreshVisibility() {
  for (const e of entities.values()) { e.show = isVisible(e.transport, filters); e.billboard.color = new C.Color(1, 1, 1, freshness(e.transport) === 'recent' ? 1 : .45); }
  if (selected && !isVisible(selected, filters)) closeDetail();
  updateStatus(); viewer.scene.requestRender();
}
$$('[data-filter]').forEach(input => {
  input.checked = filters[input.dataset.filter];
  input.addEventListener('change', () => { filters[input.dataset.filter] = input.checked; persist(); if (viewer) { refreshVisibility(); if (filters.air) refreshAir(); if (filters.rail) refreshRail(); } });
});
function packetStatus(items, packet, error) {
  if (error) return 'Fuente sin respuesta';
  if (!packet) return 'Sin datos disponibles';
  if (!items.length) return 'Sin posiciones publicadas';
  const recent = items.filter(i => freshness(i) === 'recent').length;
  const partial = packet.errors?.length ? ' · parcial' : '';
  return (recent ? `${fmt.format(recent)} recientes` : 'Datos atrasados') + (mode === 'snapshot' ? ' · instantánea' : '') + partial;
}
function updateStatus() {
  const airVisible = aircraftItems.filter(i => isVisible(i, filters)), railVisible = trainItems.filter(i => isVisible(i, filters));
  $('air-total').textContent = fmt.format(airVisible.length); $('rail-total').textContent = fmt.format(railVisible.length);
  $('air-count').textContent = fmt.format(airVisible.length); $('rail-count').textContent = fmt.format(railVisible.length);
  $('air-status').textContent = filters.air ? packetStatus(aircraftItems, airPacket, airError) : 'Ocultos';
  $('rail-status').textContent = filters.rail ? packetStatus(trainItems, railPacket, railError) : 'Ocultos';
  $('connection').textContent = mode === 'live' ? 'Consulta de fuentes · cada 20 s' : 'Instantáneas · actualización prevista cada 15 min';
  if (airError || railError) $('connection').textContent += ' · conexión parcial';
}
async function json(url) { const r = await fetch(url, { signal: AbortSignal.timeout(22000) }); if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); }
async function refreshAir() {
  if (airBusy || mode !== 'live' || !filters.air || document.hidden || morphing) return;
  airBusy = true;
  try { const view = center(); airPacket = await json(`./api/aircraft?lat=${view.lat.toFixed(2)}&lon=${view.lon.toFixed(2)}`); aircraftItems = airPacket.items; airError = ''; syncEntities('air', aircraftItems); }
  catch (e) { airError = e.message; updateStatus(); }
  finally { airBusy = false; }
}
async function refreshRail() {
  if (railBusy || mode !== 'live' || !filters.rail || document.hidden) return;
  railBusy = true;
  try { railPacket = await json('./api/trains'); trainItems = railPacket.items; railError = ''; syncEntities('rail', trainItems); }
  catch (e) { railError = e.message; updateStatus(); }
  finally { railBusy = false; }
}
async function snapshot() {
  try {
    const data = await json('./data/feed.json');
    airPacket = data.air; railPacket = data.rail;
    aircraftItems = airPacket?.items || []; trainItems = railPacket?.items || [];
    airError = data.errors?.find(e => e.source === 'air')?.message || ''; railError = data.errors?.find(e => e.source === 'rail')?.message || '';
    syncEntities('air', aircraftItems); syncEntities('rail', trainItems);
    $('air-source').textContent = 'ADSB.lol · instantánea de España: radio de 250 mn alrededor de 40° N, 3° O. La cobertura no se desplaza con la cámara en este modo.';
    $('mode-note').textContent = `Modo de instantáneas. Archivo obtenido el ${fullDate(data.generatedAt)}. GitHub Pages no mantiene conexiones en directo: la fecha de cada posición es la referencia. Las ejecuciones programadas pueden retrasarse.`;
  } catch { airError = railError = 'No hay una instantánea disponible'; $('mode-note').textContent = 'No se han podido obtener datos. El mapa sigue disponible. No se generan vehículos ficticios.'; updateStatus(); }
}
function closeDetail() {
  if (selectedEntity) selectedEntity.billboard.scale = 1;
  selectedEntity = null; selected = null; $('detail').hidden = true; viewer?.scene.requestRender();
  document.body.classList.remove('detail-open');
}
function showDetail(item, focus = true) {
  if (selectedEntity && selectedEntity.id !== item.id) selectedEntity.billboard.scale = 1;
  selected = item; selectedEntity = entities.get(item.id);
  if (selectedEntity) selectedEntity.billboard.scale = 1.4;
  const timeAge = ageSeconds(item), stale = freshness(item) === 'stale';
  const age = Number.isFinite(timeAge) ? timeAge >= 3600 ? `${fmt.format(timeAge / 3600)} h` : timeAge >= 60 ? `${fmt.format(timeAge / 60)} min` : `${fmt.format(timeAge)} s` : 'desconocida';
  const cell = (label, value, wide = false) => `<div${wide ? ' class="wide"' : ''}><dt>${escape(label)}</dt><dd>${escape(value)}</dd></div>`;
  const specific = item.kind === 'air' ? cell('Matrícula', item.registration) + cell('Modelo', item.model) + cell('Altitud geométrica', item.altitude !== null ? `${fmt.format(item.altitude)} m` : null) + cell('Altitud barométrica', item.barometricAltitude !== null ? `${fmt.format(item.barometricAltitude)} m` : null) : cell('Servicio', item.category === 'commuter' ? 'Cercanías / Rodalies' : 'AV / LD / MD') + cell('Tren', item.code) + cell('Viaje publicado', item.trip, true) + cell('Estación · código GTFS', item.stop, true);
  $('detail').className = `detail panel ${item.kind}`; $('detail').hidden = false;
  document.body.classList.add('detail-open');
  $('detail').innerHTML = `<div class="type">${item.kind === 'air' ? 'AIRE / AVIÓN' : 'TIERRA / TREN'}</div><div class="panel-head"><h2 id="detail-title">${escape(item.name)}</h2><button id="close-detail" aria-label="Cerrar detalle">×</button></div><div class="subtitle">${escape(item.state)} · ${stale ? 'Datos atrasados' : 'Posición reciente'}</div><dl>${specific}${cell('Velocidad sobre el suelo', item.speed !== null ? `${fmt.format(item.speed)} km/h` : null)}${cell('Rumbo', item.bearing !== null ? `${fmt.format(item.bearing)}°` : null)}${cell('Coordenadas', `${item.lat.toFixed(5)}, ${item.lon.toFixed(5)}`, true)}${cell(item.timestampScope === 'position' ? 'Fecha de la posición' : 'Fecha del feed · sin fecha individual', fullDate(item.observedAt), true)}</dl><p class="hint">Fuente: ${escape(item.source)} · antigüedad: ${age}. ${item.kind === 'rail' ? 'El feed no permite distinguir aquí AV, LD y MD ni calcular un retraso. ' : ''}${stale ? 'Esta posición no debe interpretarse como actual.' : 'La cobertura y disponibilidad dependen de la fuente.'}</p><button id="focus-detail" class="action">Centrar en ${item.kind === 'air' ? 'este avión' : 'este tren'} ↗</button>`;
  $('close-detail').addEventListener('click', closeDetail);
  $('focus-detail').addEventListener('click', () => fly(selected.lon, selected.lat, selected.kind === 'air' ? 150000 : 35000));
  if (focus) viewer.scene.requestRender();
}
$('search-form').addEventListener('submit', async e => {
  e.preventDefault();
  const q = $('query').value.trim(); if (!q) return;
  const seq = ++searchSequence;
  const local = searchVehicles([...aircraftItems, ...trainItems], q);
  $('results').replaceChildren();
  for (const item of local) {
    const b = document.createElement('button'); b.className = 'result';
    b.textContent = item.name; const small = document.createElement('small'); small.textContent = `${item.kind === 'air' ? 'Avión' : 'Tren'} · ${item.registration || item.code} · ${freshness(item) === 'stale' ? 'datos atrasados' : 'posición reciente'}`; b.append(small);
    b.addEventListener('click', () => { filters[item.kind] = filters[item.category] = true; $$('[data-filter]').forEach(i => { i.checked = filters[i.dataset.filter]; }); persist(); refreshVisibility(); closePanels(); showDetail(item); fly(item.lon, item.lat, 100000); });
    $('results').append(b);
  }
  const note = document.createElement('p'); note.className = 'hint'; note.textContent = 'Buscando lugares…'; $('results').append(note);
  try {
    await new Promise(resolve => setTimeout(resolve, Math.max(0, 1100 - (Date.now() - lastSearch))));
    if (seq !== searchSequence) return; lastSearch = Date.now();
    const results = await json(mode === 'live' ? `./api/search?q=${encodeURIComponent(q)}` : `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=5&q=${encodeURIComponent(q)}`);
    if (seq !== searchSequence) return;
    note.textContent = results.length ? 'LUGARES · © OpenStreetMap / Nominatim' : local.length ? 'No hay lugares con ese nombre.' : 'Sin resultados. Los vehículos se buscan en la cobertura cargada.';
    for (const place of results) {
      const b = document.createElement('button'); b.className = 'result'; b.textContent = place.display_name;
      b.addEventListener('click', () => { closePanels(); fly(Number(place.lon), Number(place.lat), 70000); }); $('results').append(b);
    }
  } catch { if (seq === searchSequence) note.textContent = 'La búsqueda de lugares no responde. Los resultados de vehículos siguen disponibles.'; }
});
function updateCamera() {
  if (morphing) return;
  const view = center(), percent = Math.max(1, Math.round(HOME.height / Math.max(1, view.height) * 100));
  if (railwayLayer) railwayLayer.show = $('railways').checked && view.height < 4000000;
  $('zoom').textContent = fmt.format(percent) + '%'; $('zoom').setAttribute('aria-label', `Restaurar vista, zoom ${percent}%`);
  $('coordinates').textContent = `${Math.abs(view.lat).toFixed(2)}° ${view.lat >= 0 ? 'N' : 'S'} · ${Math.abs(view.lon).toFixed(2)}° ${view.lon >= 0 ? 'E' : 'O'}`;
}
async function init() {
  for (let i = 0; !window.Cesium && i < 100; i++) await new Promise(resolve => setTimeout(resolve, 150));
  if (!window.Cesium) throw new Error('No se ha podido cargar el motor del mapa. Comprueba la conexión y recarga.');
  C = window.Cesium;
  C.Ion.defaultAccessToken = '';
  viewer = new C.Viewer('map', { baseLayer: false, terrainProvider: new C.EllipsoidTerrainProvider(), animation: false, timeline: false, baseLayerPicker: false, geocoder: false, homeButton: false, sceneModePicker: false, navigationHelpButton: false, fullscreenButton: false, infoBox: false, selectionIndicator: false, skyBox: false, requestRenderMode: true, maximumRenderTimeChange: Infinity, mapProjection: new C.WebMercatorProjection() });
  viewer.scene.backgroundColor = C.Color.fromCssColorString('#0b1117');
  viewer.scene.globe.baseColor = C.Color.fromCssColorString('#273e50');
  viewer.scene.globe.enableLighting = false;
  viewer.scene.screenSpaceCameraController.minimumZoomDistance = 500;
  viewer.scene.screenSpaceCameraController.maximumZoomDistance = 35000000;
  viewer.camera.setView({ destination: C.Cartesian3.fromDegrees(HOME.lon, HOME.lat, HOME.height) });
  for (const kind of ['air', 'rail']) {
    stores[kind] = new C.CustomDataSource(kind);
    stores[kind].clustering.enabled = true;
    stores[kind].clustering.pixelRange = 28;
    stores[kind].clustering.minimumClusterSize = 3;
    const color = kind === 'air' ? '#e9b76b' : '#91c9a4';
    stores[kind].clustering.clusterEvent.addEventListener((group, cluster) => {
      const tile = 'data:image/svg+xml,' + encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="42" height="25"><path fill="#101820" stroke="${color}" d="M.5.5h41v24H.5z"/><text x="21" y="16" text-anchor="middle" font-family="Consolas,monospace" font-size="11" fill="${color}">${group.length}</text></svg>`);
      cluster.point.show = false; cluster.billboard.show = true; cluster.billboard.image = tile;
      cluster.billboard.width = 42; cluster.billboard.height = 25;
      cluster.billboard.pixelOffset = new C.Cartesian2(0, kind === 'air' ? -16 : 16);
      cluster.label.show = false;
      cluster.label.font = '11px Consolas'; cluster.label.fillColor = C.Color.fromCssColorString(color);
      cluster.label.horizontalOrigin = C.HorizontalOrigin.CENTER; cluster.label.verticalOrigin = C.VerticalOrigin.CENTER;
      cluster.label.pixelOffset = new C.Cartesian2(0, kind === 'air' ? -16 : 16);
    });
    await viewer.dataSources.add(stores[kind]);
  }
  setBase(base);
  railwayLayer = viewer.imageryLayers.addImageryProvider(new C.UrlTemplateImageryProvider({ url: 'https://tiles.openrailwaymap.org/standard/{z}/{x}/{y}.png', maximumLevel: 19, credit: new C.Credit('<a href="https://www.openrailwaymap.org/">OpenRailwayMap</a> · <a href="https://www.openstreetmap.org/copyright">© OSM</a> · <a href="https://creativecommons.org/licenses/by-sa/2.0/">CC BY-SA 2.0</a>', true) }));
  railwayLayer.show = $('railways').checked && center().height < 4000000;
  railwayLayer.imageryProvider.errorEvent.addEventListener(() => { $('base-note').textContent = 'Parte de la cartografía ferroviaria no ha cargado. La red puede estar incompleta.'; });
  const handler = new C.ScreenSpaceEventHandler(viewer.scene.canvas);
  handler.setInputAction(click => {
    const pick = viewer.scene.pick(click.position);
    if (pick?.id?.transport && pick.id.show) showDetail(pick.id.transport);
    else if (Array.isArray(pick?.id) && pick.id[0]?.transport) {
      const item = pick.id[0].transport;
      fly(item.lon, item.lat, Math.max(15000, center().height / 4));
    }
  }, C.ScreenSpaceEventType.LEFT_CLICK);
  viewer.scene.canvas.setAttribute('aria-label', 'Globo de transportes. Arrastra para mover, rueda para acercar. Busca un vehículo para abrir sus detalles.');
  viewer.camera.moveEnd.addEventListener(() => { updateCamera(); refreshAir(); });
  $('loading').classList.add('done');
  try { const status = await json('./api/status'); mode = status.mode === 'live' ? 'live' : 'snapshot'; } catch { mode = 'snapshot'; }
  if (mode === 'live') { $('mode-note').textContent = 'Modo de consulta directa mediante servidor local. Se consulta cada 20 segundos y al desplazar la vista. Se conserva la fecha original de cada posición.'; await Promise.allSettled([refreshAir(), refreshRail()]); } else await snapshot();
  updateCamera(); refreshRadar();
  setInterval(() => { if (!document.hidden) { refreshAir(); refreshRail(); refreshVisibility(); if (selected) showDetail(selected, false); } }, 20000);
  setInterval(() => { if (!document.hidden) { if (mode === 'snapshot') snapshot(); if ($('radar').checked) refreshRadar(); } }, 600000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) { refreshAir(); refreshRail(); refreshVisibility(); } });
}
setInterval(() => { $('clock').textContent = new Date().toLocaleTimeString('es-ES', { timeZone: 'UTC', hour12: false }) + ' UTC'; }, 1000);
init().catch(error => { $('loading').querySelector('p').textContent = 'No se ha podido abrir el mundo'; $('loading').querySelector('small').textContent = error.message; });
