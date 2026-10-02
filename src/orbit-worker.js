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
};
