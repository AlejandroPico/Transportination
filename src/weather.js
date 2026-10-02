export const SCALES = {
  temperature: { title: 'Temperatura · °C', stops: [[-40,[93,46,143]],[-20,[52,99,188]],[0,[79,210,229]],[15,[117,213,105]],[25,[253,217,91]],[35,[239,116,60]],[50,[175,29,67]]] },
  rain: { title: 'Precipitación · mm/h', stops: [[0,[0,0,0]],[.2,[70,147,229]],[1,[56,210,206]],[3,[129,214,78]],[8,[250,210,61]],[15,[244,80,78]],[30,[169,74,217]]] },
  wind: { title: 'Viento a 10 m · km/h', stops: [[0,[56,98,146]],[10,[73,166,177]],[30,[132,210,115]],[50,[242,214,76]],[80,[233,105,82]],[120,[182,67,177]],[180,[124,76,195]]] },
};
export function weatherColor(value, field) {
  if (!Number.isFinite(value)) return [0,0,0,0]; const s = SCALES[field].stops;
  let i = 0; while (i < s.length - 2 && value > s[i+1][0]) i++;
  const t = Math.max(0, Math.min(1, (value - s[i][0]) / (s[i+1][0] - s[i][0])));
  return [...s[i][1].map((v,k) => Math.round(v + t * (s[i+1][1][k] - v))), field === 'rain' ? Math.min(230, Math.round(Math.max(0,value) * 250)) : 235];
}
export function gridValue(packet, lon, lat, field, hour) {
  if (Math.abs(lat) > 80) return null;
  const x = ((lon + 180) % 360 + 360) % 360 / 5, y = (lat + 80) / 5, ix = Math.floor(x), iy = Math.min(31, Math.floor(y)), tx = x-ix, ty = y-iy;
  const get = (col,row) => packet.points[row*72+(col%72)]?.[field]?.[hour];
  const a=get(ix,iy),b=get(ix+1,iy),c=get(ix,iy+1),d=get(ix+1,iy+1);
  if (![a,b,c,d].every(Number.isFinite)) return null;
  return (a*(1-tx)+b*tx)*(1-ty)+(c*(1-tx)+d*tx)*ty;
}
export class WeatherView {
  constructor(C, viewer) { this.C=C; this.viewer=viewer; this.layer=null; this.packet=null; this.sequence=0; this.arrows=viewer.scene.primitives.add(new C.PolylineCollection()); }
  async load() { const r=await fetch('./data/weather.json'); if(!r.ok) throw new Error(`HTTP ${r.status}`); this.packet=await r.json(); }
  async render(field, hour, opacity) {
    const seq=++this.sequence, C=this.C; this.arrows.removeAll();
    if(this.layer) { this.viewer.imageryLayers.remove(this.layer); this.layer=null; }
    if(!field || !this.packet) { this.viewer.scene.requestRender(); return; }
    const canvas=document.createElement('canvas'); canvas.width=720; canvas.height=320;
    const ctx=canvas.getContext('2d'), data=ctx.createImageData(720,320);
    for(let y=0;y<320;y++) for(let x=0;x<720;x++) data.data.set(weatherColor(gridValue(this.packet,x/2-180,80-y/2,field,hour),field),(y*720+x)*4);
    ctx.putImageData(data,0,0);
    const provider=await C.SingleTileImageryProvider.fromUrl(canvas.toDataURL(), { rectangle:C.Rectangle.fromDegrees(-180,-80,180,80), credit:new C.Credit('<a href="https://open-meteo.com/">Open-Meteo · CC BY 4.0</a>',false) });
    if(seq!==this.sequence) return;
    this.layer=this.viewer.imageryLayers.addImageryProvider(provider); this.layer.alpha=opacity;
    if(field==='wind') for(const p of this.packet.points) {
      const speed=p.wind[hour], dir=p.direction[hour]; if(!Number.isFinite(speed)||!Number.isFinite(dir)||speed<1) continue;
      const a=(dir+180)*Math.PI/180, dy=Math.cos(a)*1.3, dx=Math.sin(a)*1.3/Math.max(.3,Math.cos(p.lat*Math.PI/180));
      const lon=((p.lon+dx+540)%360)-180, lat=Math.max(-80,Math.min(80,p.lat+dy));
      this.arrows.add({positions:[C.Cartesian3.fromDegrees(p.lon,p.lat,800),C.Cartesian3.fromDegrees(lon,lat,800)],width:4,material:C.Material.fromType('PolylineArrow',{color:C.Color.WHITE.withAlpha(opacity)})});
    }
    this.viewer.scene.requestRender();
  }
}
