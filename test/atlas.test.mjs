import test from 'node:test';
import assert from 'node:assert/strict';
import { gridValue, weatherColor } from '../src/weather.js';
import { enturRail } from '../src/entur.js';
import { aircraftMesh } from '../src/aircraft-3d.js';
import { altitudeColor } from '../src/motion.js';
import { normalizeAircraft } from '../src/model.js';
import { records } from '../tools/irish-rail.mjs';

test('Weather interpolation wraps the date line, preserves missing cells and excludes polar gaps',()=>{
  const points=[];for(let lat=-80;lat<=80;lat+=5)for(let lon=-180;lon<180;lon+=5)points.push({temperature:[lat],wind:[10],rain:[null]});
  const packet={points};assert.equal(gridValue(packet,179.5,32.5,'temperature',0),32.5);assert.equal(gridValue(packet,-180,80,'wind',0),10);
  assert.equal(gridValue(packet,0,81,'temperature',0),null);assert.equal(gridValue(packet,0,0,'rain',0),null);
  assert.equal(weatherColor(0,'rain')[3],0);assert.equal(weatherColor(null,'temperature')[3],0);
});
test('Entur excludes buses and ferries, preserves timestamps, and selects newest duplicate rail observation',()=>{
  const base={vehicleId:'v1',mode:'RAIL',location:{latitude:60,longitude:10},lastUpdated:'2026-10-02T12:00:00Z',line:{publicCode:'R10'}};
  const data={data:{vehicles:[base,{...base,mode:'BUS',vehicleId:'b'},{...base,mode:'FERRY',vehicleId:'f'},{...base,lastUpdated:'2026-10-02T12:01:00Z',location:{latitude:60.1,longitude:10}}]}};
  const items=enturRail(data);assert.equal(items.length,1);assert.equal(items[0].lat,60.1);assert.equal(items[0].observedAt,Date.parse('2026-10-02T12:01:00Z'));assert.equal(items[0].speed,null);
});
test('Aircraft telemetry uses published units and unknown model types retain symbols',()=>{
  const [a]=normalizeAircraft({now:1790000000000,ac:[{hex:'abc123',lat:41,lon:2,alt_baro:35000,baro_rate:1000,squawk:'1000',seen_pos:3}]},1790000000000,'AvioADSB');
  assert.equal(a.flightLevel,350);assert.equal(a.source,'AvioADSB');assert.equal(a.squawk,'1000');assert.equal(a.verticalRate,5.08);
  assert.equal(aircraftMesh('B738'),'b737');assert.equal(aircraftMesh('A388'),'a380');assert.equal(aircraftMesh('UNKNOWN'),null);
  assert.equal(altitudeColor(0),'#ffffff');assert.equal(altitudeColor(14000),'#ad5eec');assert.equal(altitudeColor(null),'#a9b4bd');
});
test('Irish Rail parser decodes public text and trims station and train identifiers',()=>{
  assert.deepEqual(records('<objTrainMovements><TrainCode>A12 </TrainCode><LocationFullName>A &amp; B</LocationFullName></objTrainMovements>','objTrainMovements'),[{TrainCode:'A12',LocationFullName:'A & B'}]);
});
