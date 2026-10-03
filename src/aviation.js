export const AIRPORT_TYPES = {
  large_airport: { label: 'Grandes aeropuertos', size: 22, path: 'M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20M12 6v12M6 12h12M8 17l4-2 4 2' },
  medium_airport: { label: 'Aeropuertos medianos', size: 18, path: 'M12 2 22 12 12 22 2 12zM12 7v10M7 12h10' },
  small_airport: { label: 'Pequeños y aeródromos', size: 13, path: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18M7 12h10M12 7v10' },
  heliport: { label: 'Helipuertos', size: 13, path: 'M3 3h18v18H3zM8 7v10M16 7v10M8 12h8' },
  seaplane_base: { label: 'Bases de hidroaviones', size: 14, path: 'M12 3v12M5 9h14M3 18l3-2 3 2 3-2 3 2 3-2 3 2' },
  balloonport: { label: 'Bases de globos', size: 12, path: 'M12 3a7 7 0 0 0-5 12l3 4h4l3-4a7 7 0 0 0-5-12M10 21h4' },
};
const symbol = (path, color) => 'data:image/svg+xml,' + encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24"><path d="${path}" fill="none" stroke="#0b1117" stroke-width="4"/><path d="${path}" fill="none" stroke="${color}" stroke-width="2"/></svg>`);
export class AviationView {
  constructor(C, viewer) { this.C = C; this.viewer = viewer; this.points = viewer.scene.primitives.add(new C.BillboardCollection({ scene: viewer.scene })); this.lines = viewer.scene.primitives.add(new C.PolylineCollection()); this.packet = null; this.boundaries = null; this.airways = null; this.dfs = null; }
  async load() {
    const read = async file => { const r = await fetch('./data/' + file); if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); };
    const result = await Promise.allSettled([read('aviation.json'), read('airspace.json'), read('airways.json'), read('aviation-dfs.json')]);
    if (result[0].status === 'fulfilled') this.packet = result[0].value;
    if (result[1].status === 'fulfilled') this.boundaries = result[1].value;
    if (result[2].status === 'fulfilled') this.airways = result[2].value;
    if (result[3].status === 'fulfilled') this.dfs = result[3].value;
    return result.filter(r => r.status === 'rejected').map(r => r.reason.message).join(' · ');
  }
  render(options, view) {
    const C = this.C; this.lines.removeAll();
    const pointKey=JSON.stringify([options.enabled,options.airports,options.navaids,options.airportTypes,!!this.packet]);
    const rebuild=pointKey!==this.pointKey; if(rebuild) { this.points.removeAll(); this.pointKey=pointKey; }
    this.points.show=options.enabled;
    if (!options.enabled) { this.viewer.scene.requestRender(); return; }
    const addPoints = (list, key, path) => { const o = options[key]; if (!o.enabled || !o.opacity) return; const images = new Map();
      for (const p of list || []) {
        if(key === 'airports' && options.airportTypes?.[p.type] === false) continue;
        const type = key === 'airports' ? AIRPORT_TYPES[p.type] : null;
        const drawing = type?.path || path;
        if(!images.has(drawing)) images.set(drawing,symbol(drawing,o.color));
        const size = type?.size || 16;
        this.points.add({ id: { infrastructure: p }, position: C.Cartesian3.fromDegrees(p.lon, p.lat, 40), image:images.get(drawing), width:size, height:size, color: C.Color.WHITE.withAlpha(o.opacity), disableDepthTestDistance: 0 });
      } };
    if(rebuild) { addPoints(this.packet?.airports, 'airports', 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18M8 12h8M12 8v8');
      addPoints(this.packet?.navaids, 'navaids', 'M12 2 22 19H2zM12 8v6M11 17h2'); }
    const rectangle=this.viewer.camera.computeViewRectangle(C.Ellipsoid.WGS84);
    const line = (coords, o, width) => {
      if (coords.length < 2) return;
      // Do not build GPU geometry for lines outside the current viewport. Keep
      // intersecting segments, including ones whose endpoints are off-screen.
      if (rectangle && view.height < 4000000) {
        const west=C.Math.toDegrees(rectangle.west), east=C.Math.toDegrees(rectangle.east), south=C.Math.toDegrees(rectangle.south), north=C.Math.toDegrees(rectangle.north);
        const xs=coords.map(p=>((p[0]-view.lon+540)%360)-180), ys=coords.map(p=>p[1]);
        const minX=Math.min(...xs),maxX=Math.max(...xs),halfWidth=(east>=west?east-west:360-west+east)/2+3;
        if(Math.max(...ys)<south-3 || Math.min(...ys)>north+3 || maxX-minX<180 && (maxX < -halfWidth || minX > halfWidth)) return;
      }
      this.lines.add({ positions: C.Cartesian3.unpackArray(C.PolylinePipeline.generateArc({ positions: coords.map(p => C.Cartesian3.fromDegrees(p[0], p[1], 60)), height: 60, granularity: Math.PI / 1440 })), width, material: C.Material.fromType('Color', { color: C.Color.fromCssColorString(o.color).withAlpha(o.opacity) }) });
    };
    if (options.runways.enabled && view.height < 2000000) for (const r of this.packet?.runways || []) {
      const degrees=Math.max(.5,view.height/75000), lonGap=Math.abs(((r.a[0]-view.lon+540)%360)-180);
      if(Math.abs(r.a[1]-view.lat)<degrees&&lonGap<degrees/Math.max(.15,Math.cos(view.lat*Math.PI/180))) line([r.a,r.b],options.runways,3);
    }
    if (options.atc.enabled && options.atc.opacity) for (const f of [...(this.boundaries?.features || []), ...(this.dfs?.features || [])]) { const g = f.geometry; const polygons = g?.type === 'MultiPolygon' ? g.coordinates : g?.type === 'Polygon' ? [g.coordinates] : []; for (const polygon of polygons) for (const ring of polygon) line(ring, options.atc, 2.5); }
    const routes = options.airways;
    if (routes?.opacity > 0 && (routes.low || routes.high || routes.other)) for (const f of [...(this.airways?.features || []), ...(this.dfs?.airways || [])]) {
      const level = f.properties.level, low = level === 'L' || level === 'B', high = level === 'U' || level === 'B';
      if (!(low && routes.low || high && routes.high || !low && !high && routes.other)) continue;
      const color = high && routes.high ? routes.highColor : low ? routes.lowColor : routes.otherColor;
      const g = f.geometry, segments = g?.type === 'MultiLineString' ? g.coordinates : g?.type === 'LineString' ? [g.coordinates] : [];
      for (const coords of segments) line(coords, { color, opacity: routes.opacity }, 1.7);
    }
    this.updateVisibility(true);
    this.viewer.scene.requestRender();
  }
  updateVisibility(force=false) {
    const C=this.C, scene=this.viewer.scene, camera=this.viewer.camera.positionWC;
    const width=this.viewer.camera.frustum.width ?? this.viewer.camera.frustum.right-this.viewer.camera.frustum.left;
    if(!force && this.mode===scene.mode && this.frustumWidth===width && this.camera && C.Cartesian3.equalsEpsilon(camera,this.camera,0,0.01)) return;
    this.mode=scene.mode; this.frustumWidth=width; this.camera=C.Cartesian3.clone(camera,this.camera);
    const occluder=scene.mode===C.SceneMode.SCENE3D ? new C.EllipsoidalOccluder(C.Ellipsoid.WGS84,camera) : null;
    const rectangle=scene.mode===C.SceneMode.SCENE2D ? this.viewer.camera.computeViewRectangle(C.Ellipsoid.WGS84) : null;
    for(let i=0;i<this.points.length;i++) {
      const p=this.points.get(i), place=p.id.infrastructure;
      p.show=occluder ? occluder.isPointVisible(p.position) : !rectangle || C.Rectangle.contains(rectangle,C.Cartographic.fromDegrees(place.lon,place.lat));
    }
  }
}
