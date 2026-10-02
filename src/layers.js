export const BASES = [
  ['satellite', 'Satélite'], ['roads', 'Carreteras'], ['political', 'Político'], ['relief', 'Relieve'],
  ['bathymetry', 'Batimetría'], ['ocean', 'Carta oceánica'], ['night', 'Luces nocturnas'], ['natural', 'Tierra natural'],
];
const ESRI = 'https://services.arcgisonline.com/arcgis/rest/services/';
export function esriProvider(C, service, max, sources) {
  const provider = new C.UrlTemplateImageryProvider({ url: `${ESRI}${service}/MapServer/tile/{z}/{y}/{x}`, maximumLevel: max,
    credit: new C.Credit(`<a href="https://www.esri.com/en-us/legal/terms/web-site-service">© Esri</a>`, true) });
  const attribution = new C.Credit(`<a href="https://www.esri.com/en-us/legal/terms/web-site-service">${sources}</a>`, false);
  provider.getTileCredits = () => [attribution];
  return provider;
}
export function nasaProvider(C, layer, level, date = 'default', extension = 'jpeg') {
  return new C.UrlTemplateImageryProvider({ url: `https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/${layer}/default/${date}/GoogleMapsCompatible_Level${level}/{z}/{y}/{x}.${extension}`,
    maximumLevel: level, credit: new C.Credit('<a href="https://www.earthdata.nasa.gov/data/tools/gibs">NASA GIBS</a>', false) });
}
export function baseProvider(C, id) {
  const imagery = 'Imagery © Esri, Vantor, Earthstar Geographics, GIS User Community';
  switch (id) {
    case 'satellite': return esriProvider(C, 'World_Imagery', 19, imagery);
    case 'roads': return new C.UrlTemplateImageryProvider({ url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png', maximumLevel: 19, credit: new C.Credit('<a href="https://www.openstreetmap.org/copyright">© OpenStreetMap contributors</a>', true) });
    case 'political': return esriProvider(C, 'Canvas/World_Light_Gray_Base', 16, '© Esri, HERE, Garmin, OSM contributors');
    case 'relief': return esriProvider(C, 'World_Shaded_Relief', 13, 'Relief © Esri, USGS, NOAA');
    case 'bathymetry': case 'ocean': return esriProvider(C, 'Ocean/World_Ocean_Base', 16, 'Ocean © Esri, Garmin, GEBCO, NOAA NGDC, contributors');
    case 'night': return nasaProvider(C, 'VIIRS_CityLights_2012', 8);
    default: return nasaProvider(C, 'BlueMarble_ShadedRelief', 8);
  }
}
