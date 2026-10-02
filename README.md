# Transportination

Un atlas para explorar el movimiento de la Tierra: aviación, ferrocarril, navegación y órbitas, con mapas combinables y vistas 2D/3D.

## Versión 0.2.0 · 2 de octubre de 2026

La aviación pasa de una consulta regional española a la cobertura mundial publicada por OpenSky. Cada posición conserva su símbolo individual. **Está prohibida la agregación numérica de aviones, barcos, trenes y satélites**, también en la vista mundial. La norma permanente está en [AGENTS.md](AGENTS.md).

- Menú con iconos, búsqueda mundial, zoom numérico en el extremo derecho y restablecimiento de la vista. Sin marca ni estadísticas sobre el mapa.
- Acerca de central con presentación, versión, autor, portfolio y repositorio.
- Fondos en lista: Satélite, Carreteras, Político, Relieve, Batimetría, Carta oceánica, Luces nocturnas y Tierra natural. Satélite utiliza Esri World Imagery hasta nivel 19; la nitidez y las fechas varían según la zona. No se promete resolución uniforme de Google Maps.
- Infraestructura y meteorología dentro de Filtros. Vías de menor intensidad, regulable; trenes y demás vehículos opacos. El grosor del trazado raster procede de OpenRailwayMap.
- Símbolos y colores por categorías publicadas, editables. Aviación ligera/pesada/helicópteros; tipos de barcos; servicios ferroviarios; familias orbitales. Tipos no publicados permanecen sin clasificar. No se inventan generaciones Starlink.
- Leyenda activable y desactivable; ficha individual con datos disponibles, fecha de observación y fuente.
- Satélites activos de CelesTrak, cálculo SGP4 en un trabajador separado cada dos segundos, búsqueda por nombre/NORAD. Son posiciones orbitales calculadas, no telemetría recibida.
- Adaptador mundial AIS Stream preparado en servidor con clave protegida, tipos de barco y reconexión. Sin clave no aparecen barcos inventados.
- Cambio de proyección mediante fundido conservando centro y altura. Se evita el recorrido de cámara de Cesium que causaba saltos extremos al cambiar desde una ciudad.

## Cobertura y actualización

**Mundial describe el alcance del visor y de la consulta aérea, no una garantía de observar todos los vehículos del planeta.** OpenSky y AIS dependen de recepción; los trenes conectados actualmente proceden de Renfe en España. Otros operadores y metros necesitan sus fuentes propias.

GitHub Pages aloja archivos estáticos. Actions actualiza la instantánea aérea mundial y ferroviaria aproximadamente cada quince minutos; el navegador busca un nuevo archivo cada treinta segundos. Actions puede retrasarse. Ninguna posición se rejuvenece al descargarla de nuevo, ni se hace circular un tren estacionario para aparentar recepción.

El servidor opcional permite consultas regionales ADSB.lol y ferroviarias cada veinte segundos, AIS cada cinco segundos y búsqueda compartida. La consulta mundial OpenSky se comparte en caché durante quince minutos sin cuenta, o noventa segundos con credenciales: los límites gratuitos impiden consultar todo el planeta cada veinte segundos. El complemento regional conserva los aviones del resto del mundo.

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

1. Crea la clave gratuita en [AIS Stream](https://www.aisstream.io/) con GitHub.
2. Importa este repositorio en Render como Blueprint, comprueba el plan gratuito y guarda `AISSTREAM_API_KEY` como secreto del servicio. No la pongas en archivos públicos, variables del navegador ni chats.
3. Mantén `ALLOWED_ORIGINS=https://alejandropico.github.io` y comprueba `/api/status` y `/api/ships`.
4. Añade la variable de repositorio **LIVE_API_URL** con la dirección HTTPS del servidor y ejecuta el workflow de Pages. No lleva clave. La web detectará el servidor y usará consultas de datos reales; si no responde, mantiene las instantáneas.
5. Opcional: credenciales OAuth gratuitas OpenSky (`OPENSKY_CLIENT_ID` y `OPENSKY_CLIENT_SECRET`) en el servidor para aumentar la frecuencia mundial sin exceder créditos. Los secretos del workflow permiten mejorar la recolección estática; no sustituyen el servidor vivo.

AIS Stream exige intermediario y prohíbe conexiones directas desde el navegador. La conexión se implementa pero no puede activarse sin la clave del propietario. No se afirma que los barcos estén conectados mientras el estado sea `unconfigured`.

## Fuentes

| Área | Fuente | Consideraciones |
| --- | --- | --- |
| Aviación mundial | [OpenSky REST](https://openskynetwork.github.io/opensky-api/rest.html) | Datos de la red de receptores, créditos y condiciones de uso. No incluye todos los vuelos ni siempre tipo, matrícula, origen o destino. |
| Aviación regional | [ADSB.lol](https://www.adsb.lol/docs/open-data/api/) | ODbL; círculo máximo de 250 millas náuticas. No sustituye la capa mundial. |
| Trenes | [Renfe Data](https://data.renfe.com/) | CC BY 4.0. Cercanías/Rodalies y feed conjunto AV/LD/MD; no se inventa separación de servicios ni velocidad. |
| Navegación | [AIS Stream](https://www.aisstream.io/documentation) | Cuenta y clave gratuitas, servidor, cobertura parcial de mensajes AIS. |
| Órbitas | [CelesTrak OMM](https://celestrak.org/NORAD/documentation/gp-data-formats.php) y [satellite.js](https://github.com/shashwatak/satellite-js) | SGP4; política de actualización de dos horas. OMM admite identificadores NORAD mayores que los de TLE. |
| Satélite, relieve, océanos | [Esri términos](https://www.esri.com/en-us/legal/terms/web-site-service) | Servicios públicos con atribución, proyecto personal no comercial. Imágenes de distintas fechas; relieve cartográfico, no terreno geométrico 3D. |
| Calles y ferrocarril | [OSM](https://operations.osmfoundation.org/policies/tiles/), [OpenRailwayMap](https://wiki.openstreetmap.org/wiki/OpenRailwayMap/API) | Atribución y políticas para aplicaciones pequeñas, sin descarga masiva de teselas. |
| Radar | [RainViewer](https://www.rainviewer.com/api/weather-maps-api.html) | Última imagen publicada, cobertura parcial, zoom nativo máximo 7. |
| Satélite meteorológico | [NASA GIBS](https://www.earthdata.nasa.gov/data/tools/gibs) | Fecha más reciente indicada en metadatos WMTS. GOES Este/Oeste y Himawari infrarrojo; no cubre toda la Tierra ni tiene detalle de edificios. |
| Lugares | [Nominatim](https://operations.osmfoundation.org/policies/nominatim/) | Búsqueda explícita, sin autocompletado remoto; máximo una consulta por segundo y caché en servidor. |

Sin servicios de pago ni tráfico simulado. Una futura explotación comercial o gran carga requerirá revisar las condiciones y capacidad de cada proveedor.

## Estructura

`src/app.js`: visor, interfaz y símbolos individuales. `catalog.js`: categorías/iconos. `model.js`: validación, unidades, fechas y mezcla mundial/regional. `layers.js`: cartografía. `orbit-worker.js`: SGP4. `tools/providers.mjs`: fuentes. `ais.mjs`: mensajes marítimos. `server.mjs`: servidor protegido y caché. `collect.mjs`: instantáneas. `vendor.mjs`: publicación de satellite.js. `test/`: validación de datos y servidor.

Referencias de producto: [RadarDeTrenes](https://radardetrenes.com/), [OpenRailwayMap](https://www.openrailwaymap.org/), [Windy](https://www.windy.com/), [Positrén](https://positren.nebulacodex.com/), [Flexport Atlas](https://atlas.flexport.com/), [LocalizaTodo](https://www.localizatodo.com/html5/) y [SatelliteMap](https://satellitemap.space/).
