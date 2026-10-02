export const validPosition = (lat, lon) => Number.isFinite(lat) && Number.isFinite(lon) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180;
const finite = value => typeof value === 'number' && Number.isFinite(value) ? value : null;
export function normalizeAircraft(data, receivedAt = Date.now()) {
  const epoch = Number(data.now);
  const generatedAt = Number.isFinite(epoch) && epoch > 0 ? (epoch > 1e12 ? epoch : epoch * 1000) : receivedAt;
  return (data.ac ?? []).filter(a => a.hex && validPosition(a.lat, a.lon)).map(a => ({
    id: `air:${a.hex}`, kind: 'air', category: ['A1', 'A2', 'A7'].includes(a.category) ? 'airSmall' : ['A3', 'A4', 'A5'].includes(a.category) ? 'airLarge' : 'airOther',
    name: a.flight?.trim() || a.r || a.hex.toUpperCase(), registration: a.r || null, code: a.hex.toUpperCase(), model: a.t || null,
    lat: a.lat, lon: a.lon, altitude: finite(a.alt_geom) !== null ? a.alt_geom * .3048 : null,
    barometricAltitude: finite(a.alt_baro) !== null ? a.alt_baro * .3048 : null,
    speed: finite(a.gs) !== null ? a.gs * 1.852 : null, bearing: finite(a.track),
    observedAt: generatedAt - Math.max(0, finite(a.seen_pos) ?? 0) * 1000,
    source: 'ADSB.lol', timestampScope: finite(a.seen_pos) !== null ? 'position' : 'feed', state: a.alt_baro === 'ground' ? 'En tierra' : 'Posición recibida',
  }));
}
export function normalizeTrains(data, category) {
  const feedTime = Number(data.header?.timestamp) * 1000;
  return (data.entity ?? []).filter(e => validPosition(e.vehicle?.position?.latitude, e.vehicle?.position?.longitude)).map(e => {
    const v = e.vehicle;
    const ownTime = Number(v.timestamp) * 1000;
    return { id: `rail:${category}:${e.id}`, kind: 'rail', category, name: v.vehicle?.label || v.vehicle?.id || e.id,
      code: v.vehicle?.id || e.id, trip: v.trip?.tripId || null, stop: v.stopId || null,
      lat: v.position.latitude, lon: v.position.longitude, altitude: 0,
      speed: finite(v.position.speed) !== null ? v.position.speed * 3.6 : null, bearing: finite(v.position.bearing),
      observedAt: Number.isFinite(ownTime) && ownTime > 0 ? ownTime : Number.isFinite(feedTime) && feedTime > 0 ? feedTime : null,
      timestampScope: Number.isFinite(ownTime) && ownTime > 0 ? 'position' : 'feed', source: 'Renfe',
      state: ({ STOPPED_AT: 'En estación', IN_TRANSIT_TO: 'En circulación', INCOMING_AT: 'Aproximándose a estación' })[v.currentStatus] || 'Estado no publicado',
    };
  });
}
export function isVisible(item, filters) { return !!filters[item.kind] && !!filters[item.category]; }
export function ageSeconds(item, now = Date.now()) { return item.observedAt ? Math.max(0, (now - item.observedAt) / 1000) : Infinity; }
export function freshness(item, now = Date.now()) { return ageSeconds(item, now) > (item.kind === 'air' ? 60 : 120) ? 'stale' : 'recent'; }
export function searchVehicles(items, query) {
  const q = query.trim().toLocaleLowerCase('es');
  if (!q) return [];
  return items.filter(i => [i.name, i.code, i.registration, i.trip].some(s => s?.toLocaleLowerCase('es').includes(q))).slice(0, 30);
}
export function restoreFilters(saved) {
  const defaults = { air: true, rail: true, airLarge: true, airSmall: true, airOther: true, commuter: true, longDistance: true };
  for (const k of Object.keys(defaults)) if (typeof saved?.[k] === 'boolean') defaults[k] = saved[k];
  return defaults;
}
