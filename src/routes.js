import { altitudeColor, distance, journeyProgress } from './motion.js?v=0.5';
import { FLIGHT_RETENTION_MS, currentFlightSamples } from './flight-history.js?v=0.5';
export class RouteView {
  constructor(C, viewer) { this.C = C; this.viewer = viewer; this.entities = []; this.lines = viewer.scene.primitives.add(new C.PolylineCollection()); this.history = new Map(); this.orbit = null; this.intensity = 1; }
  remember(items) {
    const cutoff = Date.now() - FLIGHT_RETENTION_MS;
    for (const i of items) {
      if (i.kind === 'space' || !i.observedAt || i.positionMode === 'schedule' || Date.now() - i.observedAt > 120000) continue;
      const list = this.history.get(i.id) || [];
      if (i.observedAt > (list.at(-1)?.observedAt || 0)) list.push({ lon: i.lon, lat: i.lat, altitude: i.altitude, observedAt: i.observedAt, name: i.name, ground: i.state === 'En tierra' });
      const itemCutoff = Date.now() - (i.kind === 'air' ? FLIGHT_RETENTION_MS : 7200000);
      while (list.length && list[0].observedAt < itemCutoff) list.shift();
      this.history.set(i.id, list);
    }
    for (const [id, list] of this.history) if (!list.length || list.at(-1).observedAt < cutoff) this.history.delete(id);
  }
  clear() { this.entities.forEach(e => this.viewer.entities.remove(e)); this.entities = []; this.lines.removeAll(); }
  importHistory(packet) {
    for (const [id, samples] of Object.entries(packet.tracks || {})) {
      const points = [...(this.history.get(id) || []), ...samples];
      const unique = new Map(points.filter(p => p.observedAt > Date.now() - FLIGHT_RETENTION_MS).map(p => [p.observedAt, p]));
      this.history.set(id, [...unique.values()].sort((a,b) => a.observedAt-b.observedAt));
    }
  }
  line(points, color, dashed = false, width = 3, inSpace = false) {
    if (points.length < 2 || this.intensity <= 0) return;
    const C = this.C, css = C.Color.fromCssColorString(color).withAlpha(this.intensity);
    const material = C.Material.fromType(dashed ? 'PolylineDash' : 'Color', dashed ? { color: css, dashLength: 18 } : { color: css });
    let positions = points.map(p => C.Cartesian3.fromDegrees(p.lon, p.lat, Math.max(35, p.altitude || 0)));
    if (!inSpace) positions = C.Cartesian3.unpackArray(C.PolylinePipeline.generateArc({ positions, height: points.map(p => Math.max(35, p.altitude || 0)), granularity: Math.PI / 1440 }));
    this.lines.add({ positions, width, material });
  }
  draw(item, color, stations = true, stationAlpha = 1) {
    this.clear(); if (!item) return;
    const C = this.C, journey = item.journey;
    if (journey) {
      const progress = journeyProgress(journey), stops = journey.stops;
      const at = progress?.next ?? stops.reduce((best, s, i) => distance(item, s) < distance(item, stops[best]) ? i : best, 0);
      if (journey.geometry) {
        const g = journey.geometry, pivot = g.offsets[at];
        this.line(g.points.slice(g.offsets[0], pivot + 1).map(p => ({ lon: p[0], lat: p[1] })), '#899ba8', false, 2);
        this.line(g.points.slice(pivot, g.offsets.at(-1) + 1).map(p => ({ lon: p[0], lat: p[1] })), color, false, 3);
      } else this.line(stops, color, true, 2.5);
      if (stations && stationAlpha > 0) stops.forEach((s, i) => { if (s.commercial === false) return; this.entities.push(this.viewer.entities.add({ id: 'route-stop:' + item.id + ':' + i,
        position: C.Cartesian3.fromDegrees(s.lon, s.lat, 45), point: { pixelSize: i === at ? 10 : 7, color: C.Color.fromCssColorString(i < at ? '#a6b5be' : color).withAlpha(stationAlpha), outlineColor: C.Color.BLACK.withAlpha(stationAlpha), outlineWidth: 2, disableDepthTestDistance: 0 },
        label: { text: s.name, font: '11px sans-serif', fillColor: C.Color.WHITE.withAlpha(stationAlpha), style: C.LabelStyle.FILL_AND_OUTLINE, outlineColor: C.Color.fromCssColorString('#0b1117').withAlpha(stationAlpha), outlineWidth: 3, pixelOffset: new C.Cartesian2(0, -18), distanceDisplayCondition: new C.DistanceDisplayCondition(0, 1500000), disableDepthTestDistance: 0 }, properties: { station: s } })); });
    }
    if (item.flightRoute) this.line([item.flightRoute.origin, item.flightRoute.destination], color, true, 2);
    const list = item.kind === 'air' ? currentFlightSamples(this.history.get(item.id) || [], item) : (this.history.get(item.id) || []);
    for (let i = 1; i < list.length; i++) {
      const gap = list[i].observedAt - list[i - 1].observedAt, jump = distance(list[i-1],list[i]);
      if (gap <= 0 || gap > (item.kind === 'air' ? 7200000 : 1200000) || jump > (item.kind === 'air' ? Math.max(50000, gap * 0.5) : 120000)) continue;
      this.line([list[i-1],list[i]], item.kind === 'air' ? altitudeColor(list[i].ground ? 0 : list[i].altitude) : color, item.kind !== 'air' && gap > 120000, 3);
    }
    if (item.kind === 'space' && this.orbit?.id === item.id) this.line(this.orbit.points, color, false, 2, true);
    this.viewer.scene.requestRender();
  }
}
