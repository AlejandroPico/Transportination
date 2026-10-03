import { validPosition } from './model.js?v=0.5';
export const FLIGHT_RETENTION_MS = 24 * 3600000;
export function normalizeFlightTrack(data) {
  const code = data.icao24?.toLowerCase();
  if (!/^[0-9a-f]{6}$/.test(code)) throw new Error('Identificador de estela inválido');
  const name = data.callsign?.trim() || data.calllsign?.trim() || code.toUpperCase();
  const points = (data.path || []).filter(p => validPosition(p[1], p[2]) && Number.isFinite(p[0])).map(p => ({ observedAt: p[0] * 1000, lat: p[1], lon: p[2], altitude: Number.isFinite(p[3]) ? p[3] : null, ground: p[5] === true, name, trackStart: data.startTime * 1000 }));
  return { fetchedAt: Date.now(), source: 'OpenSky Network · trayectoria experimental; cobertura de receptores', tracks: { ['air:' + code]: points } };
}
export function currentFlightSamples(points, item) {
  const eligible = points.filter(p => (!p.name || p.name === item.name) && p.observedAt <= (item.observedAt || Date.now()) + 60000);
  // A transponder can fly multiple legs with the same callsign. Keep the latest
  // takeoff, including its last surface observation, rather than joining legs.
  let start = 0;
  const trackStart = eligible.at(-1)?.trackStart;
  for (let i = 1; i < eligible.length; i++) {
    if (eligible[i].observedAt - eligible[i - 1].observedAt > 4 * 3600000 || eligible[i - 1].ground && !eligible[i].ground) start = i - 1;
  }
  return eligible.slice(start).filter(p => !trackStart || p.observedAt >= trackStart);
}
