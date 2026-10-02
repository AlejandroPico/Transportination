const epoch = value => { const n = Date.parse(value); return Number.isFinite(n) ? n : null; };
const valid = (lat, lon) => Number.isFinite(lat) && Number.isFinite(lon) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180;
export function finnishRail(locations, timetable, metadata, publishedAt = Date.now()) {
  const stations = new Map(metadata.map(s => [s.stationShortCode, s]));
  const journeys = [], items = [], locationMap = new Map(locations.map(p => [p.departureDate + ':' + p.trainNumber, p]));
  for (const train of timetable) {
    if (!train.runningCurrently || train.cancelled) continue;
    const trip = train.departureDate + ':' + train.trainNumber, id = 'rail:fi:' + trip;
    const category = train.trainCategory === 'Commuter' ? 'commuter' : train.trainCategory === 'Cargo' ? 'railFreight' : 'longDistance';
    const stops = [];
    for (const row of train.timeTableRows || []) {
      const station = stations.get(row.stationShortCode);
      if (!station || !valid(station.latitude, station.longitude) || row.cancelled) continue;
      const time = epoch(row.actualTime || row.liveEstimateTime || row.scheduledTime), planned = epoch(row.scheduledTime);
      if (!time) continue;
      let s = stops.at(-1);
      if (s?.id !== row.stationShortCode) { s = { id: row.stationShortCode, name: station.stationName, lat: station.latitude, lon: station.longitude, arrival: time, departure: time, plannedArrival: planned, plannedDeparture: planned, commercial: row.commercialStop === true, platform: row.commercialTrack }; stops.push(s); }
      s[row.type === 'ARRIVAL' ? 'arrival' : 'departure'] = time;
      s[row.type === 'ARRIVAL' ? 'plannedArrival' : 'plannedDeparture'] = planned;
      if (row.commercialStop) s.commercial = true;
    }
    const journey = { id, trip, code: String(train.trainNumber), name: [train.commuterLineID || train.trainType, train.trainNumber].filter(Boolean).join(' '), category, country: 'Finlandia', timezone: 'Europe/Helsinki', operator: train.operatorShortCode, source: 'Fintraffic · Digitraffic', publishedAt, stops };
    if (stops.length > 1) journeys.push(journey);
    const p = locationMap.get(trip);
    if (!p || !valid(p.location?.coordinates?.[1], p.location?.coordinates?.[0])) continue;
    items.push({ id, trip, kind: 'rail', category, name: journey.name, code: journey.code, country: journey.country, operator: journey.operator,
      lat: p.location.coordinates[1], lon: p.location.coordinates[0], speed: Number.isFinite(p.speed) ? p.speed : null, altitude: 0,
      observedAt: epoch(p.timestamp), source: journey.source, state: p.isGpsLocation ? 'Posición GPS' : 'Posición publicada', positionMode: 'observed', journey });
  }
  return { items, journeys, stations: metadata.filter(s => s.passengerTraffic && valid(s.latitude, s.longitude)).map(s => ({ id: 'fi:' + s.stationShortCode, name: s.stationName, lat: s.latitude, lon: s.longitude })), fetchedAt: publishedAt, source: 'Fintraffic · Digitraffic' };
}
export function northAmericanRail(data, metadata, publishedAt = Date.now()) {
  const items = [], journeys = [];
  for (const train of Object.values(data).flat()) {
    if (!valid(train.lat, train.lon) || train.trainState === 'Predeparture' || !['Amtrak', 'Via', 'VIA Rail', 'Brightline'].includes(train.provider)) continue;
    if (train.stations?.every(s => s.bus)) continue;
    const id = 'rail:na:' + train.provider + ':' + train.trainID, country = /via/i.test(train.provider) ? 'Canadá' : 'Estados Unidos';
    const stops = (train.stations || []).filter(s => !s.bus && valid(metadata[s.code]?.lat, metadata[s.code]?.lon)).map(s => ({
      id: s.code, name: s.name, lat: metadata[s.code].lat, lon: metadata[s.code].lon, arrival: epoch(s.arr || s.schArr), departure: epoch(s.dep || s.schDep),
      plannedArrival: epoch(s.schArr), plannedDeparture: epoch(s.schDep), status: s.status, platform: s.platform, commercial: true, timezone: s.tz,
    })).filter(s => s.arrival && s.departure);
    const journey = { id, trip: train.trainID, code: train.trainNum, name: `${train.routeName} ${train.trainNum}`, country, category: 'longDistance', operator: train.provider, source: 'Amtraker · ' + train.provider, publishedAt, stops };
    if (stops.length > 1) journeys.push(journey);
    const bearing = ({ N: 0, NE: 45, E: 90, SE: 135, S: 180, SW: 225, W: 270, NW: 315 })[train.heading];
    items.push({ id, trip: train.trainID, kind: 'rail', category: 'longDistance', code: train.trainNum, name: journey.name, country, operator: train.provider, source: journey.source,
      lat: train.lat, lon: train.lon, altitude: 0, bearing, speed: Number.isFinite(train.velocity) ? train.velocity * 1.609344 : null,
      observedAt: epoch(train.lastValTS || train.updatedAt), state: 'Posición publicada por el operador', positionMode: 'observed', journey, stop: train.eventCode });
  }
  return { items, journeys, stations: Object.entries(metadata).filter(([, s]) => valid(s.lat, s.lon)).map(([id, s]) => ({ id: 'na:' + id, name: s.name, lat: s.lat, lon: s.lon })), fetchedAt: publishedAt, source: 'Amtraker · Amtrak, VIA Rail y Brightline' };
}
