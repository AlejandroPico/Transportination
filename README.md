# Transportination

Un atlas para explorar el movimiento de la Tierra: aviación, ferrocarril, navegación y órbitas, con mapas combinables y vistas 2D/3D.

## Versión 0.3.0 · 2 de octubre de 2026

- Movimiento ferroviario calculado cada segundo a partir de horarios, respetando las paradas. Renfe aporta retrasos y cancelaciones cuando están publicados; SNCF aporta horarios, sin GPS ni retrasos franceses conectados en esta versión. Cada estimación está identificada y se puede desactivar.
- Finlandia: posiciones Fintraffic/Digitraffic y horarios, con consultas directas de posición cada diez segundos al observar la zona. Estados Unidos y Canadá: Amtrak, VIA Rail y Brightline mediante Amtraker, con consultas cada treinta segundos al observar la zona. Los datos conservan la fecha original del operador.
- Selección de tren: origen, destino, horas locales, estaciones anteriores y siguientes en mapa y ficha. El trazado GTFS de Cercanías se usa cuando se puede relacionar con las paradas; sin geometría válida, la línea y la ubicación estimada son aproximaciones entre estaciones y se indican como tales.
- Interruptores y reguladores independientes para líneas y estaciones dentro de Trenes, al máximo por defecto. Estaciones de los operadores conectados y consulta local OpenStreetMap al acercarse en cualquier país, según la cartografía disponible.
- Estelas aéreas de observaciones nuevas recibidas durante la sesión, con colores por altitud; origen/destino de adsbdb cuando se conoce el indicativo. La unión entre aeropuertos es orientativa, no un plan de vuelo exacto. Órbita completa calculada del satélite seleccionado.
- Seguir el vehículo y regular el resalte del recorrido. Interpolación entre posiciones recientes; las instantáneas aéreas antiguas permanecen fijas.

### Base de la versión anterior

La aviación pasa de una consulta regional española a la cobertura mundial publicada por OpenSky. Cada posición conserva su símbolo individual. **Está prohibida la agregación numérica de aviones, barcos, trenes y satélites**, también en la vista mundial. La norma permanente está en [AGENTS.md](AGENTS.md).

- Menú con iconos, búsqueda mundial, zoom numérico en el extremo derecho y restablecimiento de la vista. Sin marca ni estadísticas sobre el mapa.
- Acerca de central con presentación, versión, autor, portfolio y repositorio.
- Fondos en lista: Satélite, Carreteras, Político, Relieve, Batimetría, Carta oceánica, Luces nocturnas y Tierra natural. Satélite utiliza Esri World Imagery hasta nivel 19; la nitidez y las fechas varían según la zona. No se promete resolución uniforme de Google Maps.
- Infraestructura y meteorología dentro de Filtros. Vías regulables; trenes y demás vehículos opacos. El grosor del trazado raster procede de OpenRailwayMap.
- Símbolos y colores por categorías publicadas, editables. Aviación ligera/pesada/helicópteros; tipos de barcos; servicios ferroviarios; familias orbitales. Tipos no publicados permanecen sin clasificar. No se inventan generaciones Starlink.
- Leyenda activable y desactivable; ficha individual con datos disponibles, fecha de observación y fuente.
- Satélites activos de CelesTrak, cálculo SGP4 en un trabajador separado cada dos segundos, búsqueda por nombre/NORAD. Son posiciones orbitales calculadas, no telemetría recibida.
- Adaptador mundial AIS Stream preparado en servidor con clave protegida, tipos de barco y reconexión. Sin clave no aparecen barcos inventados.
- Cambio de proyección mediante fundido conservando centro y altura. Se evita el recorrido de cámara de Cesium que causaba saltos extremos al cambiar desde una ciudad.

## Cobertura y actualización

**Mundial describe el alcance del visor y de la consulta aérea, no una garantía de observar todos los vehículos del planeta.** OpenSky y AIS dependen de recepción. El ferrocarril conectado incluye España, Francia, Finlandia, Estados Unidos y Canadá, con cobertura parcial por operador. Otros países y metros necesitan adaptadores propios; algunos exigen registro o claves. Esta versión no conecta aún Asia, África ni Oceanía.

GitHub Pages aloja archivos estáticos. Actions actualiza la instantánea aérea mundial y ferroviaria aproximadamente cada quince minutos; el navegador busca un nuevo archivo cada treinta segundos. Actions puede retrasarse. Ninguna observación se rejuvenece al descargarla de nuevo. Las estimaciones ferroviarias se calculan aparte y están identificadas; el usuario puede desactivarlas. Los horarios nacionales se descargan una vez al día y se interpretan con sus calendarios y zonas horarias, incluidos servicios nocturnos.

El servidor opcional consulta ADSB.lol en la zona observada cada cinco segundos, Renfe cada veinte segundos y AIS cada cinco segundos. Interpola entre muestras aéreas recientes, sin extrapolar instantáneas viejas. OpenSky mundial se comparte en caché quince minutos sin cuenta, o noventa segundos con credenciales. El complemento regional conserva el resto del mundo. Sin servidor, las fuentes aéreas no admiten consultas del navegador desde GitHub Pages; no se promete movimiento aéreo segundo a segundo ni precisión de rodaje comparable a Flightradar24.

CelesTrak se descarga como máximo cada dos horas y se reutiliza para calcular el movimiento orbital en el navegador. La época de los elementos aparece en cada ficha. Si una fuente falla, se conserva el dato anterior con su fecha y error.

## Desarrollo

Node.js 22 o superior, dependencias gratuitas:

```sh
corepack enable
corepack prepare pnpm@10.17.1 --activate
pnpm install --frozen-lockfile
pnpm vendor
pnpm collect
pnpm start
```

Abre `http://localhost:4173`. El servidor solo escucha en la máquina local por defecto. Para otro puerto utiliza `PORT`. Copia `.env.example` a `.env` para configurar claves; `.env` no se publica ni se sirve.

```sh
pnpm test
node --check src/app.js
node --check src/orbit-worker.js
```

QA visual: servidor activo, Playwright y Edge, `node tools/check-browser.mjs`. Variables: `PLAYWRIGHT_MODULE`, `BROWSER_CHANNEL`, `TEST_ORIGIN` (por defecto puerto 4174). Comprueba escritorio/móvil, búsqueda mundial, capas, leyenda, colores, diálogo, conservación de vista y movimiento orbital. Capturas en `artifacts/`, fuera del despliegue.

## Conectar el servidor público gratuito

El repositorio incluye `Dockerfile` y `render.yaml` para un servicio en el [plan gratuito de Render](https://render.com/docs/free). Hace falta una cuenta del propietario; no se crea ni se activa facturación automáticamente. Para respetar el presupuesto de cero euros, úsalo sin añadir un método de pago: al agotar límites se suspenden los servicios, en lugar de cobrar excedentes. El servicio gratuito puede dormir y tardar en despertar: no garantiza continuidad de AIS. Para navegación continua podría ser necesario otro alojamiento que admita conexiones persistentes dentro de sus límites gratuitos.

1. Abre [la preparación del servicio en Render](https://render.com/deploy?repo=https://github.com/AlejandroPico/Transportination), crea tu cuenta y vincula el repositorio. La configuración fija el plan **Free**. No añadas tarjeta ni cambies a un plan de pago.
2. La aviación regional no requiere clave de ADSB.lol ni clave AIS. Mantén `ALLOWED_ORIGINS=https://alejandropico.github.io` y espera a que `/api/status` devuelva `mode: live`.
3. Añade la variable de repositorio **LIVE_API_URL** con la dirección HTTPS del servidor y ejecuta el workflow de Pages. Es una dirección pública sin claves. La web detectará el servidor; si falla, conserva las instantáneas.
4. Opcional para barcos: crea una clave gratuita en [AIS Stream](https://www.aisstream.io/) y guárdala como secreto `AISSTREAM_API_KEY` del servicio. No la pongas en archivos públicos ni chats.
5. Opcional para la consulta aérea mundial: credenciales OAuth OpenSky como secretos del servidor. Los secretos del workflow no sustituyen el servidor de consultas frecuentes.

AIS Stream exige intermediario y prohíbe conexiones directas desde el navegador. La conexión se implementa pero no puede activarse sin la clave del propietario. No se afirma que los barcos estén conectados mientras el estado sea `unconfigured`.

## Fuentes

| Área | Fuente | Consideraciones |
| --- | --- | --- |
| Aviación mundial | [OpenSky REST](https://openskynetwork.github.io/opensky-api/rest.html) | Datos de la red de receptores, créditos y condiciones de uso. No incluye todos los vuelos ni siempre tipo, matrícula, origen o destino. |
| Aviación regional | [ADSB.lol](https://www.adsb.lol/docs/open-data/api/) | ODbL; círculo máximo de 250 millas náuticas. No sustituye la capa mundial. |
| Trenes | [Renfe Data](https://data.renfe.com/) | CC BY 4.0. Cercanías/Rodalies y feed conjunto AV/LD/MD; no se inventa separación de servicios ni velocidad. |
| Trenes Francia | [SNCF / transport.data.gouv.fr](https://transport.data.gouv.fr/datasets/horaires-sncf) | GTFS: calendarios, estaciones y horarios; ODbL. Estimaciones, sin GPS conectado. |
| Trenes Finlandia | [Fintraffic / Digitraffic](https://www.digitraffic.fi/en/railway-traffic/) | CC BY 4.0, posiciones publicadas y tiempos previstos/reales. |
| Trenes Norteamérica | [Amtraker](https://amtraker.com/), [documentación](https://api-v3.amtraker.com/docs) | Datos obtenidos de Amtraker bajo ODC-By 1.0, con atribución visible en el mapa. |
| Rutas aéreas | [adsbdb](https://www.adsbdb.com/) | Aeropuertos asociados a indicativos disponibles; no determina el recorrido exacto ni acredita el vuelo de una fecha concreta. |
| Navegación | [AIS Stream](https://www.aisstream.io/documentation) | Cuenta y clave gratuitas, servidor, cobertura parcial de mensajes AIS. |
| Órbitas | [CelesTrak OMM](https://celestrak.org/NORAD/documentation/gp-data-formats.php) y [satellite.js](https://github.com/shashwatak/satellite-js) | SGP4; política de actualización de dos horas. OMM admite identificadores NORAD mayores que los de TLE. |
| Satélite, relieve, océanos | [Esri términos](https://www.esri.com/en-us/legal/terms/web-site-service) | Servicios públicos con atribución, proyecto personal no comercial. Imágenes de distintas fechas; relieve cartográfico, no terreno geométrico 3D. |
| Calles y ferrocarril | [OSM](https://operations.osmfoundation.org/policies/tiles/), [OpenRailwayMap](https://wiki.openstreetmap.org/wiki/OpenRailwayMap/API) | Atribución y políticas para aplicaciones pequeñas, sin descarga masiva de teselas. |
| Radar | [RainViewer](https://www.rainviewer.com/api/weather-maps-api.html) | Última imagen publicada, cobertura parcial, zoom nativo máximo 7. |
| Satélite meteorológico | [NASA GIBS](https://www.earthdata.nasa.gov/data/tools/gibs) | Fecha más reciente indicada en metadatos WMTS. GOES Este/Oeste y Himawari infrarrojo; no cubre toda la Tierra ni tiene detalle de edificios. |
| Lugares | [Nominatim](https://operations.osmfoundation.org/policies/nominatim/) | Búsqueda explícita, sin autocompletado remoto; máximo una consulta por segundo y caché en servidor. |

Sin servicios de pago. Las estimaciones ferroviarias y órbitas calculadas están identificadas como tales. Una futura explotación comercial o gran carga requerirá revisar las condiciones y capacidad de cada proveedor.

## Estructura

`src/motion.js`: geometría, horarios e interpolación. `rail-engine.js`: prioridad de posiciones y horarios. `rail.js`: adaptadores internacionales. `routes.js`: recorridos y estaciones seleccionados. `tools/rail-schedules.mjs`: GTFS, calendarios, zonas horarias y caché diaria.

`src/app.js`: visor, interfaz y símbolos individuales. `catalog.js`: categorías/iconos. `model.js`: validación, unidades, fechas y mezcla mundial/regional. `layers.js`: cartografía. `orbit-worker.js`: SGP4. `tools/providers.mjs`: fuentes. `ais.mjs`: mensajes marítimos. `server.mjs`: servidor protegido y caché. `collect.mjs`: instantáneas. `vendor.mjs`: publicación de satellite.js. `test/`: validación de datos y servidor.

Referencias de producto: [RadarDeTrenes](https://radardetrenes.com/), [OpenRailwayMap](https://www.openrailwaymap.org/), [Windy](https://www.windy.com/), [Positrén](https://positren.nebulacodex.com/), [Flexport Atlas](https://atlas.flexport.com/), [LocalizaTodo](https://www.localizatodo.com/html5/) y [SatelliteMap](https://satellitemap.space/).
