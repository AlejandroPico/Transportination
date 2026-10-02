const symbol = (path, color) => 'data:image/svg+xml,' + encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24"><path d="${path}" fill="none" stroke="${color}" stroke-width="2"/></svg>`);
export class AviationView {
  constructor(C, viewer) { this.C = C; this.viewer = viewer; this.points = viewer.scene.primitives.add(new C.BillboardCollection()); this.lines = viewer.scene.primitives.add(new C.PolylineCollection()); this.packet = null; this.boundaries = null; }
  async load() {
    const read = async file => { const r = await fetch('./data/' + file); if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); };
    const result = await Promise.allSettled([read('aviation.json'), read('airspace.json')]);
    if (result[0].status === 'fulfilled') this.packet = result[0].value;
    if (result[1].status === 'fulfilled') this.boundaries = result[1].value;
    return result.filter(r => r.status === 'rejected').map(r => r.reason.message).join(' · ');
  }
  render(options, view) {
    const C = this.C; this.lines.removeAll();
    const pointKey=JSON.stringify([options.enabled,options.airports,options.navaids,!!this.packet]);
    const rebuild=pointKey!==this.pointKey; if(rebuild) { this.points.removeAll(); this.pointKey=pointKey; }
    this.points.show=options.enabled;
    if (!options.enabled) { this.viewer.scene.requestRender(); return; }
    const addPoints = (list, key, path) => { const o = options[key]; if (!o.enabled || !o.opacity) return; const image = symbol(path, o.color);
      for (const p of list || []) this.points.add({ id: { infrastructure: p }, position: C.Cartesian3.fromDegrees(p.lon, p.lat, 40), image, width: key === 'airports' ? 12 : 14, height: key === 'airports' ? 12 : 14, color: C.Color.WHITE.withAlpha(o.opacity), disableDepthTestDistance: Infinity }); };
    if(rebuild) { addPoints(this.packet?.airports, 'airports', 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18M8 12h8M12 8v8');
      addPoints(this.packet?.navaids, 'navaids', 'M12 2 22 19H2zM12 8v6M11 17h2'); }
    const line = (coords, o, width) => { if (coords.length < 2) return; this.lines.add({ positions: C.Cartesian3.unpackArray(C.PolylinePipeline.generateArc({ positions: coords.map(p => C.Cartesian3.fromDegrees(p[0], p[1], 60)), height: 60, granularity: Math.PI / 1440 })), width, material: C.Material.fromType('Color', { color: C.Color.fromCssColorString(o.color).withAlpha(o.opacity) }) }); };
    if (options.runways.enabled && view.height < 2000000) for (const r of this.packet?.runways || []) {
      const degrees=Math.max(.5,view.height/75000), lonGap=Math.abs(((r.a[0]-view.lon+540)%360)-180);
      if(Math.abs(r.a[1]-view.lat)<degrees&&lonGap<degrees/Math.max(.15,Math.cos(view.lat*Math.PI/180))) line([r.a,r.b],options.runways,3);
    }
    if (options.atc.enabled && options.atc.opacity) for (const f of this.boundaries?.features || []) { const g = f.geometry; const polygons = g?.type === 'MultiPolygon' ? g.coordinates : g?.type === 'Polygon' ? [g.coordinates] : []; for (const polygon of polygons) for (const ring of polygon) line(ring, options.atc, 1.5); }
    this.viewer.scene.requestRender();
  }
}
