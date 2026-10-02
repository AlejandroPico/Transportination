import { dayEpoch } from './rail-schedules.mjs';
const decode = s => s.replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&quot;/g,'"').replace(/&apos;/g,"'").replace(/&amp;/g,'&');
export function records(xml, element) {
  return [...xml.matchAll(new RegExp(`<${element}>([\\s\\S]*?)</${element}>`, 'g'))].map(m => Object.fromEntries([...m[1].matchAll(/<(\w+)>([^<]*)<\/\1>/g)].map(x => [x[1],decode(x[2].trim())])));
}
const root='https://api.irishrail.ie/realtime/realtime.asmx/';
const read=async path=>{const r=await fetch(root+path,{signal:AbortSignal.timeout(20000)});if(!r.ok)throw new Error('Irish Rail: HTTP '+r.status);return r.text();};
export async function irishRail() {
  const publishedAt=Date.now(), stations=records(await read('getAllStationsXML'),'objStation').filter(s=>s.StationLatitude&&s.StationLongitude).map(s=>({id:'ie:'+s.StationCode,name:s.StationDesc,lat:+s.StationLatitude,lon:+s.StationLongitude}));
  const byId=new Map(stations.map(s=>[s.id,s])), journeys=[], errors=[];
  const trains=records(await read('getCurrentTrainsXML'),'objTrainPositions');
  for(const t of trains) {
    try {
      const rows=records(await read('getTrainMovementsXML?'+new URLSearchParams({TrainId:t.TrainCode,TrainDate:t.TrainDate})),'objTrainMovements').sort((a,b)=>+a.LocationOrder-+b.LocationOrder);
      const parts=t.TrainDate.split(' '), month=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'].indexOf(parts[1])+1;
      if(!month)continue;
      const day=parts[2]+String(month).padStart(2,'0')+parts[0].padStart(2,'0'), start=dayEpoch(day,'Europe/Dublin'); let previous=-1, offset=0;
      const stops=[];
      for(const row of rows){const station=byId.get('ie:'+row.LocationCode);if(!station||!['O','S','D'].includes(row.LocationType))continue;
        const secs=s=>/^\d\d:\d\d:\d\d$/.test(s||'')?s.split(':').reduce((n,v)=>n*60+(+v),0):null;
        let a=secs(row.ExpectedArrival||row.ScheduledArrival),d=secs(row.ExpectedDeparture||row.ScheduledDeparture);
        if(row.LocationType==='O')a=d;if(row.LocationType==='D')d=a;if(a===null||d===null)continue;
        if(a+offset<previous)offset+=86400;a+=offset;d+=offset;if(d<a)d+=86400;previous=d;
        stops.push({...station,arrival:start+a*1000,departure:start+d*1000});
      }
      if(stops.length>1) journeys.push({id:'rail:schedule:ie:'+day+':'+t.TrainCode,trip:t.TrainCode,code:t.TrainCode,name:t.TrainCode,country:'Irlanda',operator:'Iarnród Éireann',category:'railOther',source:'Irish Rail · horarios previstos / señalización · no GPS',dataset:'ie',timezone:'Europe/Dublin',publishedAt,stops});
    }catch(e){errors.push({source:'Irish Rail '+t.TrainCode,message:e.message});}
    await new Promise(r=>setTimeout(r,400));
  }
  return {stations,journeys,errors};
}
