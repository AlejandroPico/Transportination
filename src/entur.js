const fields = 'vehicleId mode lastUpdated location{latitude longitude} bearing line{publicCode lineName} originName destinationName';
export const ENTUR_QUERY = `{rail:vehicles(mode:RAIL){${fields}} metro:vehicles(mode:METRO){${fields}} tram:vehicles(mode:TRAM){${fields}}}`;
export function enturRail(data) {
  const seen = new Map();
  for (const v of data.data?.vehicles || [...(data.data?.rail || []), ...(data.data?.metro || []), ...(data.data?.tram || [])]) {
    if (!['RAIL', 'METRO', 'TRAM'].includes(v.mode) || !v.vehicleId || !Number.isFinite(v.location?.latitude) || !Number.isFinite(v.location?.longitude)) continue;
    const observedAt = Date.parse(v.lastUpdated); if (!Number.isFinite(observedAt)) continue;
    const item = { id: 'rail:no:' + v.vehicleId, code: v.vehicleId, name: [v.line?.publicCode, v.line?.lineName].filter(Boolean).join(' · ') || v.vehicleId, kind: 'rail', category: v.mode === 'RAIL' ? 'railOther' : 'commuter', lat: v.location.latitude, lon: v.location.longitude, altitude: 0, bearing: Number.isFinite(v.bearing) ? v.bearing : null, speed: null, observedAt, timestampScope: 'position', source: 'Entur · NLOD', country: 'Noruega', destination: v.destinationName, origin: v.originName, state: 'Posición publicada · ' + ({RAIL:'ferrocarril',METRO:'metro',TRAM:'tranvía'})[v.mode] };
    if (!seen.has(item.id) || seen.get(item.id).observedAt < observedAt) seen.set(item.id, item);
  }
  return [...seen.values()];
}
