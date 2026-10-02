export const CATEGORY = {
  airLight: { label: 'Aviones ligeros', kind: 'air', color: '#fff096', icon: 'light' },
  airMedium: { label: 'Aviones medianos', kind: 'air', color: '#ffc052', icon: 'plane' },
  airHeavy: { label: 'Aviones pesados', kind: 'air', color: '#ff8b4d', icon: 'heavy' },
  airHelicopter: { label: 'Helicópteros', kind: 'air', color: '#f8a0d9', icon: 'helicopter' },
  airGlider: { label: 'Planeadores', kind: 'air', color: '#d8ffa6', icon: 'glider' },
  airMilitary: { label: 'Aviación militar identificada', kind: 'air', color: '#c6b1ff', icon: 'jet' },
  airOther: { label: 'Sin clasificación publicada', kind: 'air', color: '#ffe08a', icon: 'plane' },
  commuter: { label: 'Cercanías y Rodalies', kind: 'rail', color: '#70f0af', icon: 'train' },
  longDistance: { label: 'Alta Velocidad / Larga y Media Distancia', kind: 'rail', color: '#7cd9ff', icon: 'express' },
  railOther: { label: 'Otros servicios', kind: 'rail', color: '#a1e781', icon: 'train' },
  shipCargo: { label: 'Mercantes', kind: 'sea', color: '#62dcff', icon: 'cargo' },
  shipTanker: { label: 'Petroleros', kind: 'sea', color: '#eab47f', icon: 'tanker' },
  shipFishing: { label: 'Pesqueros', kind: 'sea', color: '#95eca5', icon: 'fishing' },
  shipPassenger: { label: 'Pasajeros', kind: 'sea', color: '#e2abff', icon: 'passenger' },
  shipPleasure: { label: 'Recreo y veleros', kind: 'sea', color: '#ffe89e', icon: 'sail' },
  shipMilitary: { label: 'Militares identificados', kind: 'sea', color: '#d0d5e0', icon: 'ship' },
  shipOther: { label: 'Otros / sin tipo publicado', kind: 'sea', color: '#83bacd', icon: 'ship' },
  satStarlink: { label: 'Starlink', kind: 'space', color: '#bb91ff', icon: 'satellite' },
  satOneweb: { label: 'OneWeb', kind: 'space', color: '#6cc6ff', icon: 'satellite' },
  satNavigation: { label: 'GPS, Galileo, GLONASS y BeiDou', kind: 'space', color: '#ffb8d8', icon: 'navigation' },
  satWeather: { label: 'Meteorología', kind: 'space', color: '#a1f6e4', icon: 'weather-sat' },
  satStation: { label: 'Estaciones espaciales', kind: 'space', color: '#ffb65c', icon: 'station' },
  satOther: { label: 'Otras constelaciones y misiones', kind: 'space', color: '#e2e4f0', icon: 'satellite' },
};
export const KIND = { air: 'Aviones', rail: 'Trenes', sea: 'Barcos', space: 'Satélites' };
export const SHAPES = {
  plane: 'M20 3 23 17 36 24v4l-13-4v9l5 4v2l-8-2-8 2v-2l5-4v-9L4 28v-4l13-7z',
  heavy: 'M20 2 24 16 37 22v5l-13-3v10l6 3v2l-10-2-10 2v-2l6-3V24L3 27v-5l13-6z',
  light: 'M20 3 22 18h15v5H22v11l6 2v3l-8-2-8 2v-3l6-2V23H3v-5h15z',
  helicopter: 'M18 4h4v6h15v3H22v4l4 4v10l-4 4v4h-4v-4l-4-4V21l4-4v-4H3v-3h15z M9 23h3v11H9z M28 23h3v11h-3z',
  glider: 'M19 3h2v16l17 3v3l-17-1v11l6 2v2l-7-1-7 1v-2l6-2V24L2 25v-3l17-3z',
  jet: 'M20 2 23 20 33 31l-10-3v8l4 3-7-2-7 2 4-3v-8L7 31l10-11z',
  train: 'M10 4h20v28l-6 5h-8l-6-5z M14 9h12v10H14z M14 26h4v3h-4z M22 26h4v3h-4z',
  express: 'M16 3h8l8 26-4 8H12l-4-8z M15 14h10l2 8H13z M14 28h4v3h-4z M22 28h4v3h-4z',
  cargo: 'M20 2 29 12v25H11V12z M14 15h12v6H14z M14 23h12v6H14z M14 31h12v3H14z',
  tanker: 'M20 2 28 12v25H12V12z M16 15h8v7h-8z M16 25h8v7h-8z',
  fishing: 'M20 2 28 13l-2 24H14l-2-24z M16 15h8v6h-8z M18 25h4v8h-4z M28 21l8 8M12 21l-8 8',
  passenger: 'M20 2 30 13v24H10V13z M14 14h12v3H14z M14 21h12v3H14z M14 28h12v3H14z',
  sail: 'M20 2v29l-10-4z M23 8l10 19H23z M10 32h23l-5 6H15z',
  ship: 'M20 2 28 14v23H12V14z M17 17h6v9h-6z',
  satellite: 'M15 14h10v12H15z M3 11h9v18H3z M28 11h9v18h-9z M20 6v7M18 3h4v3h-4z',
  navigation: 'M20 9 28 20 20 31 12 20z M2 15h7v10H2z M31 15h7v10h-7z M19 2h2v6',
  'weather-sat': 'M15 14h10v12H15z M3 12h9v16H3z M28 12h9v16h-9z M14 8l6-5 6 5-6 5z',
  station: 'M18 3h4v34h-4z M3 8h12v8H3z M25 8h12v8H25z M3 24h12v8H3z M25 24h12v8h-12z',
};
export function markerSvg(category, color) {
  const c = CATEGORY[category] || CATEGORY.airOther;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="42" height="42" viewBox="0 0 40 42"><path d="${SHAPES[c.icon]}" fill="${color || c.color}" fill-rule="evenodd" stroke="#081119" stroke-width="1.5" stroke-linejoin="miter"/></svg>`;
}
export function aircraftCategory(code, source = 'adsb', military = false) {
  if (military) return 'airMilitary';
  if (source === 'opensky') return ({ 2: 'airLight', 3: 'airLight', 4: 'airMedium', 5: 'airHeavy', 6: 'airHeavy', 7: 'airMedium', 8: 'airHelicopter', 9: 'airGlider', 12: 'airLight' })[code] || 'airOther';
  return ({ A1: 'airLight', A2: 'airLight', A3: 'airMedium', A4: 'airHeavy', A5: 'airHeavy', A6: 'airMedium', A7: 'airHelicopter', B1: 'airGlider' })[code] || 'airOther';
}
export function shipCategory(code) {
  if (code >= 70 && code <= 79) return 'shipCargo';
  if (code >= 80 && code <= 89) return 'shipTanker';
  if (code >= 60 && code <= 69) return 'shipPassenger';
  return ({ 30: 'shipFishing', 36: 'shipPleasure', 37: 'shipPleasure', 35: 'shipMilitary' })[code] || 'shipOther';
}
export function satelliteCategory(name) {
  if (/^STARLINK/i.test(name)) return 'satStarlink';
  if (/^ONEWEB/i.test(name)) return 'satOneweb';
  if (/NAVSTAR|GPS|GALILEO|GSAT|GLONASS|BEIDOU/i.test(name)) return 'satNavigation';
  if (/GOES|METEOSAT|HIMAWARI|METOP|NOAA|FENGYUN|ELEKTRO/i.test(name)) return 'satWeather';
  if (/^ISS \(|^CSS \(|TIANHE|ZARYA/i.test(name)) return 'satStation';
  return 'satOther';
}
