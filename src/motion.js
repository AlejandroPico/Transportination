// Schedule estimates and interpolation are deliberately separate from observations.
export const wrapLongitude = lon => ((lon + 540) % 360) - 180;
export function distance(a, b) {
  const r = Math.PI / 180, x = (b.lat - a.lat) * r, y = wrapLongitude(b.lon - a.lon) * r;
  const h = Math.sin(x / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(y / 2) ** 2;
  return 6371000 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(Math.max(0, 1 - h)));
}
export function interpolate(a, b, ratio) {
  const t = Math.max(0, Math.min(1, ratio));
  return { lon: wrapLongitude(a.lon + wrapLongitude(b.lon - a.lon) * t), lat: a.lat + (b.lat - a.lat) * t,
    altitude: (a.altitude ?? 0) + ((b.altitude ?? 0) - (a.altitude ?? 0)) * t };
}
export function heading(a, b) {
  const r = Math.PI / 180, d = wrapLongitude(b.lon - a.lon) * r;
  return (Math.atan2(Math.sin(d) * Math.cos(b.lat * r), Math.cos(a.lat * r) * Math.sin(b.lat * r) - Math.sin(a.lat * r) * Math.cos(b.lat * r) * Math.cos(d)) / r + 360) % 360;
}
export function prepareShape(journey, points) {
  if (!points?.length || journey.stops.length < 2) return null;
  const stops = journey.stops;
  const nearest = stop => { let at = 0, best = Infinity; points.forEach((p, i) => { const d = distance(stop, { lon: p[0], lat: p[1] }); if (d < best) { best = d; at = i; } }); return { at, best }; };
  const indexes = stops.map(nearest);
  // Never attach a line to unrelated or ambiguously looping stations.
  if (indexes.some(i => i.best > 2000)) return null;
  const direction = Math.sign(indexes.at(-1).at - indexes[0].at);
  if (!direction || indexes.some((v, i) => i && direction * (v.at - indexes[i - 1].at) < 0)) return null;
  const ordered = direction > 0 ? points : [...points].reverse();
  const offsets = indexes.map(p => direction > 0 ? p.at : points.length - 1 - p.at);
  const cumulative = [0];
  for (let i = 1; i < ordered.length; i++) cumulative.push(cumulative[i - 1] + distance({ lon: ordered[i - 1][0], lat: ordered[i - 1][1] }, { lon: ordered[i][0], lat: ordered[i][1] }));
  return { points: ordered, offsets, cumulative };
}
export function journeyProgress(journey, now = Date.now()) {
  const stops = journey.stops;
  if (stops.length < 2 || journey.cancelled || now < stops[0].departure || now > stops.at(-1).arrival) return null;
  for (let i = 0; i < stops.length; i++) {
    const s = stops[i];
    if (now >= s.arrival && now <= s.departure) return { ...s, previous: Math.max(0, i - 1), next: i, ratio: 0, atStation: true, state: 'En estación · estimación por horario' };
    if (i < stops.length - 1 && now < stops[i + 1].arrival) {
      const next = stops[i + 1], ratio = Math.max(0, Math.min(1, (now - s.departure) / (next.arrival - s.departure)));
      let position = interpolate(s, next, ratio);
      const shape = journey.geometry;
      if (shape) {
        const start = shape.offsets[i], end = shape.offsets[i + 1], target = shape.cumulative[start] + (shape.cumulative[end] - shape.cumulative[start]) * ratio;
        let p = start;
        while (p < end - 1 && shape.cumulative[p + 1] < target) p++;
        if (p < end) position = interpolate({ lon: shape.points[p][0], lat: shape.points[p][1] }, { lon: shape.points[p + 1][0], lat: shape.points[p + 1][1] }, (target - shape.cumulative[p]) / (shape.cumulative[p + 1] - shape.cumulative[p] || 1));
      }
      return { ...position, previous: i, next: i + 1, ratio, bearing: heading(s, next), atStation: false, state: 'Entre estaciones · estimación por horario' };
    }
  }
  return null;
}
export function estimateTrain(journey, now = Date.now()) {
  const p = journeyProgress(journey, now);
  if (!p) return null;
  return { id: journey.id, kind: 'rail', category: journey.category, code: journey.code, name: journey.name, trip: journey.trip,
    country: journey.country, operator: journey.operator, source: journey.source, journey, ...p, altitude: 0,
    observedAt: null, calculatedAt: now, positionMode: 'schedule', scheduleAt: journey.publishedAt };
}
export function observationTween(previous, next, now = Date.now()) {
  if (!previous || !previous.observedAt || !next.observedAt || next.observedAt <= previous.observedAt || now - next.observedAt > 60000 || next.observedAt - previous.observedAt > 60000) return null;
  // Reject discontinuities, including identity changes and bad receiver coordinates.
  if (distance(previous, next) > (next.kind === 'air' ? 60000 : 12000)) return null;
  return { from: previous, to: next, startedAt: now, duration: Math.min(5000, next.observedAt - previous.observedAt) };
}
export function altitudeColor(metres) {
  if (!Number.isFinite(metres)) return '#a9b4bd';
  const stops = [[0, [104, 239, 178]], [3000, [247, 224, 108]], [6000, [255, 157, 78]], [9000, [236, 111, 154]], [12000, [167, 130, 255]]];
  let i = 0; while (i < stops.length - 2 && metres > stops[i + 1][0]) i++;
  const t = Math.max(0, Math.min(1, (metres - stops[i][0]) / (stops[i + 1][0] - stops[i][0])));
  return '#' + stops[i][1].map((v, k) => Math.round(v + (stops[i + 1][1][k] - v) * t).toString(16).padStart(2, '0')).join('');
}
