import { json2satrec, propagate, gstime, eciToGeodetic } from '../vendor/satellite/index.js';
let records = [], active = false, timer;
function tick() {
  if (!active) return;
  const now = new Date(), sidereal = gstime(now), positions = new Float64Array(records.length * 3);
  positions.fill(NaN);
  records.forEach((record, i) => {
    try {
      const state = propagate(record, now);
      if (!state?.position) return;
      const p = eciToGeodetic(state.position, sidereal);
      if (p.height < 0) return;
      positions[i * 3] = p.longitude; positions[i * 3 + 1] = p.latitude; positions[i * 3 + 2] = p.height * 1000;
    } catch { /* Decayed or invalid orbital elements are not rendered. */ }
  });
  postMessage({ type: 'positions', time: now.getTime(), positions }, [positions.buffer]);
  timer = setTimeout(tick, 2000);
}
onmessage = e => {
  if (e.data.type === 'load') {
    records = e.data.records.map(omm => { try { return json2satrec(omm); } catch { return null; } });
    clearTimeout(timer); active = true; tick();
  } else if (e.data.type === 'pause') { active = false; clearTimeout(timer); }
  else if (e.data.type === 'resume' && !active) { active = true; tick(); }
  else if (e.data.type === 'route') {
    const record = records[e.data.index], points = [], now = Date.now(), period = Math.min(2880, e.data.period) * 60000;
    if (!record || !Number.isFinite(period) || period <= 0) return;
    for (let i = 0; i <= 240; i++) {
      const date = new Date(now + period * (i / 240 - .25));
      try { const state = propagate(record, date); if (!state?.position) continue; const p = eciToGeodetic(state.position, gstime(date)); if (p.height < 0) continue; points.push({ lon: p.longitude * 180 / Math.PI, lat: p.latitude * 180 / Math.PI, altitude: p.height * 1000 }); } catch { /* Invalid propagation is omitted. */ }
    }
    postMessage({ type: 'route', id: e.data.id, points });
  }
};
