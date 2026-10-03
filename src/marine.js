import { shipCategory } from './catalog.js?v=0.5';
import { validPosition } from './model.js?v=0.5';

export const MARINE_CREDIT = 'Fintraffic / Digitraffic · CC BY 4.0';
export function applyMarineMessage(ships, mmsi, location, metadata, now = Date.now()) {
  mmsi = String(mmsi);
  if (!/^\d{9}$/.test(mmsi)) return false;
  const previous = ships.get(mmsi), item = { ...previous, id: 'sea:' + mmsi, code: mmsi, kind: 'sea', altitude: 0, source: MARINE_CREDIT };
  if (metadata) {
    if (!item.metadataAt || metadata.timestamp >= item.metadataAt) {
      item.metadataAt = metadata.timestamp;
      item.name = metadata.name?.trim() || item.name || mmsi;
      const type = metadata.shipType ?? metadata.type;
      if (Number.isFinite(type)) { item.shipType = type; item.category = shipCategory(type); }
      item.imo = metadata.imo || item.imo;
      item.callSign = metadata.callSign?.trim() || item.callSign;
      item.destination = metadata.destination?.trim() || null;
    }
  }
  if (location) {
    // REST timestampExternal is milliseconds; MQTT time is epoch seconds.
    // The REST AIS 'timestamp' is only a second within the minute.
    const stamp = location.timestampExternal ?? location.time * 1000;
    if (!validPosition(location.lat, location.lon) || !Number.isFinite(stamp) || stamp <= 0 || stamp > now + 60000 || stamp <= (item.observedAt || 0)) return false;
    Object.assign(item, { lat: location.lat, lon: location.lon, observedAt: stamp, timestampScope: 'position',
      speed: Number.isFinite(location.sog) && location.sog >= 0 && location.sog < 102.3 ? location.sog * 1.852 : null,
      bearing: Number.isFinite(location.cog) && location.cog >= 0 && location.cog < 360 ? location.cog : null,
      state: ({ 0: 'En navegación', 1: 'Fondeado', 5: 'Amarrado', 6: 'Varado', 8: 'A vela' })[location.navStat] || 'Posición AIS recibida' });
  }
  item.name ||= mmsi; item.category ||= 'shipOther';
  ships.set(mmsi, item); return true;
}
export function normalizeMarine(locations, metadata, now = Date.now()) {
  const ships = new Map();
  for (const m of metadata || []) applyMarineMessage(ships, m.mmsi, null, m, now);
  for (const f of locations.features || []) {
    if (f.geometry?.type !== 'Point') continue;
    applyMarineMessage(ships, f.mmsi ?? f.properties?.mmsi, { ...f.properties, lon: f.geometry.coordinates[0], lat: f.geometry.coordinates[1] }, null, now);
  }
  return [...ships.values()].filter(i => validPosition(i.lat, i.lon) && now - i.observedAt <= 3600000);
}
export class MarineClient {
  constructor(publish, state) { this.publish = publish; this.state = state; this.ships = new Map(); this.active = false; this.generation = 0; this.retry = 0; }
  setActive(active) {
    if (active === this.active) return;
    this.active = active; ++this.generation; clearTimeout(this.reconnect); clearInterval(this.poll); clearTimeout(this.flushTimer);
    if (!active) { try { this.socket?.disconnect(); } catch { /* Connection still opening. */ } this.socket = null; return; }
    this.refresh(); this.connect(); this.poll = setInterval(() => this.refresh(), 60000);
  }
  async refresh() {
    if (this.loading || !this.active) return; this.loading = true; const generation = this.generation;
    const read = async endpoint => {
      const r = await fetch('https://meri.digitraffic.fi/api/ais/v1/' + endpoint, { headers: { 'Digitraffic-User': 'Transportination/0.5 (https://github.com/AlejandroPico/Transportination)' }, signal: AbortSignal.timeout(20000) });
      if (!r.ok) throw new Error('HTTP ' + r.status); return r.json();
    };
    try {
      const locations = await read('locations');
      if (!this.metadataAt || Date.now() - this.metadataAt > 3600000) {
        const metadata = await read('vessels');
        if (generation !== this.generation) return;
        for (const m of metadata) applyMarineMessage(this.ships, m.mmsi, null, m);
        this.metadataAt = Date.now();
      }
      if (generation !== this.generation) return;
      for (const f of locations.features || []) if (f.geometry?.type === 'Point') applyMarineMessage(this.ships, f.mmsi ?? f.properties?.mmsi, { ...f.properties, lon: f.geometry.coordinates[0], lat: f.geometry.coordinates[1] });
      this.flush();
    } catch (e) { if (generation === this.generation) this.state('Consulta AIS regional: ' + e.message); }
    finally { this.loading = false; }
  }
  connect() {
    if (!this.active || !globalThis.Paho?.Client) return;
    const generation = this.generation;
    const client = this.socket = new Paho.Client('wss://meri.digitraffic.fi:443/mqtt', 'Transportination-' + crypto.randomUUID());
    client.onMessageArrived = message => {
      if (!this.active || generation !== this.generation) return;
      try {
        const [, mmsi, type] = message.destinationName.split('/'), data = JSON.parse(message.payloadString);
        if (!['location', 'locations', 'metadata'].includes(type)) return;
        if (applyMarineMessage(this.ships, mmsi, type === 'metadata' ? null : data, type === 'metadata' ? data : null) && !this.flushTimer) {
          this.flushTimer = setTimeout(() => { this.flushTimer = null; this.flush(); }, 1000);
        }
      } catch { /* Invalid telemetry cannot change a position. */ }
    };
    const retry = () => {
      if (!this.active || generation !== this.generation) return;
      this.state('AIS regional: reconectando; se mantienen las observaciones fechadas.');
      clearTimeout(this.reconnect); this.reconnect = setTimeout(() => this.connect(), Math.min(60000, 2000 * 2 ** Math.min(this.retry++, 5)));
    };
    client.onConnectionLost = retry;
    client.connect({ useSSL: true, mqttVersion: 4, timeout: 20, keepAliveInterval: 30,
      onSuccess: () => {
        if (!this.active || generation !== this.generation) { client.disconnect(); return; }
        this.retry = 0; this.state('AIS regional conectado · actualizaciones al recibir cada mensaje.');
        client.subscribe('vessels-v2/#', { qos: 0 });
      }, onFailure: retry });
  }
  flush() {
    const now = Date.now();
    for (const [id, i] of this.ships) if (i.observedAt && now - i.observedAt > 3600000) this.ships.delete(id);
    this.publish([...this.ships.values()].filter(i => validPosition(i.lat, i.lon)));
  }
}
