import WebSocket from 'ws';
import { shipCategory } from '../src/catalog.js';
import { validPosition } from '../src/model.js';
export function applyAisMessage(message, ships, now = Date.now()) {
  const meta = message.MetaData || {};
  const mmsi = String(meta.MMSI || meta.MMSI_String || message.Message?.[message.MessageType]?.UserID || '');
  if (!/^\d{9}$/.test(mmsi)) return;
  const payload = message.Message?.[message.MessageType]; if (!payload || payload.Valid === false) return;
  const previous = ships.get(mmsi) || { id: `sea:${mmsi}`, code: mmsi, kind: 'sea', category: 'shipOther', source: 'AIS Stream', name: meta.ShipName?.trim() || mmsi };
  const type = payload.Type ?? payload.ReportA?.ShipType ?? payload.ReportB?.ShipType;
  if (Number.isFinite(type)) { previous.shipType = type; previous.category = shipCategory(type); }
  previous.name = (payload.Name || payload.ReportA?.Name || meta.ShipName)?.trim() || previous.name;
  if (payload.ImoNumber) previous.imo = payload.ImoNumber;
  if (payload.Destination) previous.destination = payload.Destination.trim();
  const observedAt = Number.isFinite(Date.parse(meta.time_utc)) ? Date.parse(meta.time_utc) : now;
  if (validPosition(payload.Latitude, payload.Longitude) && (!previous.observedAt || observedAt >= previous.observedAt)) {
    previous.lat = payload.Latitude; previous.lon = payload.Longitude; previous.altitude = 0;
    previous.speed = Number.isFinite(payload.Sog) && payload.Sog < 102.3 ? payload.Sog * 1.852 : null;
    previous.bearing = Number.isFinite(payload.Cog) && payload.Cog < 360 ? payload.Cog : null;
    previous.observedAt = observedAt;
    previous.timestampScope = Number.isFinite(Date.parse(meta.time_utc)) ? 'position' : 'received'; previous.state = 'Posición AIS recibida';
  }
  ships.set(mmsi, previous);
}
export function createAisFeed(apiKey = process.env.AISSTREAM_API_KEY) {
  const ships = new Map(); let socket, retry = 0, timer, stopped = false, status = apiKey ? 'connecting' : 'unconfigured', lastMessageAt = null;
  function connect() {
    if (!apiKey || stopped) return;
    status = 'connecting';
    socket = new WebSocket('wss://stream.aisstream.io/v0/stream', { perMessageDeflate: true, handshakeTimeout: 20000 });
    socket.on('open', () => socket.send(JSON.stringify({ APIKey: apiKey, BoundingBoxes: [[[-85, -180], [85, 180]]], FilterMessageTypes: ['PositionReport', 'StandardClassBPositionReport', 'ExtendedClassBPositionReport', 'ShipStaticData', 'StaticDataReport'] })));
    socket.on('message', bytes => {
      try {
        const message = JSON.parse(bytes.toString());
        if (message.error || message.Error) { status = 'error'; return; }
        if (message.MessageType === 'SubscriptionConfirmation') { status = 'connected'; retry = 0; return; }
        applyAisMessage(message, ships); lastMessageAt = Date.now(); status = 'connected'; retry = 0;
      } catch { /* Invalid messages never reach clients or logs. */ }
    });
    socket.on('error', () => { status = 'error'; });
    socket.on('close', () => {
      if (stopped) return;
      status = 'reconnecting'; timer = setTimeout(connect, Math.min(60000, 1000 * 2 ** Math.min(retry++, 6)) + Math.random() * 500);
    });
  }
  return {
    start: connect,
    stop() { stopped = true; clearTimeout(timer); socket?.close(); },
    packet() { const now = Date.now(); for (const [id, item] of ships) if (item.observedAt && now - item.observedAt > 3600000) ships.delete(id); return { items: [...ships.values()].filter(i => validPosition(i.lat, i.lon)), fetchedAt: now, lastMessageAt, status, source: 'AIS Stream', coverage: 'Mundial · mensajes AIS recibidos' }; },
  };
}
