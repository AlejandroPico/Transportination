import { estimateTrain, prepareShape } from './motion.js';
export class RailEngine {
  constructor() { this.journeys = []; this.observations = new Map(); this.network = { stations: [], shapes: {} }; this.geometries = new Map(); }
  setNetwork(network) { this.network = network; }
  setJourneys(journeys, delays = []) {
    const updates = new Map(delays.map(e => e.tripUpdate).filter(Boolean).map(u => [u.trip?.tripId, u]));
    this.journeys = journeys.map(j => {
      const update = j.country === 'España' ? updates.get(j.trip) : null;
      const stops = j.stops.map(s => {
        const u = update?.stopTimeUpdate?.find(p => p.stopId === s.id);
        const arrival = Number(u?.arrival?.time), departure = Number(u?.departure?.time);
        return { ...s, plannedArrival: s.plannedArrival || s.arrival, plannedDeparture: s.plannedDeparture || s.departure,
          arrival: arrival > 0 ? arrival * 1000 : s.arrival + (Number(u?.arrival?.delay ?? update?.delay) || 0) * 1000,
          departure: departure > 0 ? departure * 1000 : s.departure + (Number(u?.departure?.delay ?? update?.delay) || 0) * 1000 };
      });
      const journey = { ...j, stops, cancelled: j.cancelled || update?.trip?.scheduleRelationship === 'CANCELED' || update?.trip?.scheduleRelationship === 3 };
      if (journey.shapeKey) {
        const key = journey.shapeKey + ':' + stops.map(s => s.id).join(',');
        if (!this.geometries.has(key)) this.geometries.set(key, prepareShape(journey, this.network.shapes[journey.shapeKey]));
        journey.geometry = this.geometries.get(key);
      }
      return journey;
    });
    this.index = new Map();
    for (const j of this.journeys) { const key = j.country + ':' + j.trip; if (!this.index.has(key)) this.index.set(key, []); this.index.get(key).push(j); }
  }
  replaceJourneys(sourcePrefix, journeys) { this.setJourneys([...this.journeys.filter(j => !j.id.startsWith(sourcePrefix)), ...journeys]); }
  receive(items, prefix) {
    if (prefix) for (const id of this.observations.keys()) if (id.startsWith(prefix) && !items.some(i => i.id === id)) this.observations.delete(id);
    for (const item of items) { const old = this.observations.get(item.id); if (!old || (item.observedAt ?? 0) >= (old.observedAt ?? 0)) this.observations.set(item.id, item); }
  }
  positions(now = Date.now()) {
    const result = new Map(), claimed = new Set();
    for (const observation of this.observations.values()) {
      const country = observation.country || (observation.source === 'Renfe' ? 'España' : '');
      const candidates = this.index?.get(country + ':' + observation.trip) || [];
      const journey = candidates.find(j => j.stops[0].departure <= now + 3600000 && j.stops.at(-1).arrival >= now - 3600000) || observation.journey;
      if (journey?.cancelled) continue;
      if (journey) claimed.add(journey.id);
      const estimated = journey && estimateTrain(journey, now);
      if (observation.observedAt && now - observation.observedAt <= 120000) result.set(observation.id, { ...observation, journey, positionMode: 'observed' });
      else if (estimated) result.set(observation.id, { ...estimated, id: observation.id, code: observation.code, name: observation.name });
      else result.set(observation.id, { ...observation, journey });
    }
    for (const journey of this.journeys) if (!claimed.has(journey.id)) {
      const item = estimateTrain(journey, now); if (item) result.set(item.id, item);
    }
    return [...result.values()];
  }
}
