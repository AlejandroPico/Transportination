# Transportination

Un atlas para explorar el movimiento de la Tierra: aviación, ferrocarril, navegación y órbitas, con mapas combinables y vistas 2D/3D.

## Versión 0.5.0 · 3 de octubre de 2026

- Aeropuertos y radioayudas ocultos correctamente por la Tierra en 3D. Símbolos de aeropuerto diferenciados y filtros por tamaño/tipo publicado, sin deducir categoría internacional o tráfico.
- Aerovías vectoriales sobre cualquier fondo: FAA (EE. UU. y rutas publicadas del Pacífico), bajas/altas según su clasificación; DFS (Alemania), sin nivel clasificado en este conjunto. Áreas de control FIR/ARTCC/ACC de la FAA y FIR/UIR/CTR/CTA/TMA de DFS. **Cobertura parcial, no mundial**. ENAIRE no se redistribuye: no se ha verificado autorización compatible con su aviso legal.
- Historial de observaciones aéreas conservado durante 24 horas entre publicaciones, servido por pequeños grupos de transpondedores para evitar descargarlo entero en móvil. Estelas **continuas**, coloreadas por altitud: blanco en tierra, azules bajos, arcoíris hasta violeta alto. Los enlaces entre instantáneas espaciadas son aproximados. Se separan despegues del mismo indicativo; no se garantiza observar desde el despegue ni reconstruir maniobras. La referencia origen/destino sigue discontinua.
- Servidor preparado para consultar la trayectoria experimental del vuelo seleccionado en OpenSky, con caché de diez minutos y protección de cuota. Se conserva el historial local si la trayectoria no está disponible. La recepción regional ADSB.lol sigue cada cinco segundos al activar el servidor.
- **Barcos reales sin cuenta**: Fintraffic/Digitraffic, principalmente Báltico. REST inicial y MQTT WebSocket directo, actualizando símbolos al llegar observaciones nuevas. Tipo AIS, MMSI, IMO, indicativo, destino, velocidad y fecha cuando están publicados. Colores y símbolos personalizables por categoría. Solo clase A y sin pesqueros en esta fuente; AIS Stream mundial permanece pendiente de la clave y el servidor del propietario.
- Conexión marítima suspendida al ocultar la pestaña o desactivar Barcos; reconexión con espera creciente. Las instantáneas antiguas nunca sobrescriben una posición más reciente.
- Se mantienen modelos 3D esquemáticos por tipo publicado, meteorología fechada, fondos con etiquetas regulables, créditos recogidos en la i y favicon vectorial original en la raíz.

La activación completa está explicada paso a paso en **[ACTIVACION.md](ACTIVACION.md)**. Guardar secretos en GitHub no convierte Pages en un servidor: la actualización aérea frecuente y AIS mundial necesitan también el servicio gratuito preparado.

### Base ferroviaria

Movimiento de horarios cada segundo, paradas y retrasos Renfe publicados. España y Francia aportan calendarios GTFS; Finlandia aporta Fintraffic/Digitraffic y Norteamérica Amtraker. Cada dato mantiene su fecha y fuente. Las posiciones antiguas no se animan como recepción en directo.

### Base de la versión anterior

La aviación pasa de una consulta regional española a la cobertura mundial publicada por OpenSky. Cada posición conserva su símbolo individual. **Está prohibida la agregación numérica de aviones, barcos, trenes y satélites**, también en la vista mundial. La norma permanente está en [AGENTS.md](AGENTS.md).

- Menú con iconos, búsqueda mundial, zoom numérico en el extremo derecho y restablecimiento de la vista. Sin marca ni estadísticas sobre el mapa.
- Acerca de central con presentación, versión, autor, portfolio y repositorio.
- Fondos en lista: Satélite, Carreteras, Político, Relieve, Batimetría, Carta oceánica, Luces nocturnas y Tierra natural. Satélite utiliza Esri World Imagery hasta nivel 19; la nitidez y las fechas varían según la zona. No se promete resolución uniforme de Google Maps.
- Infraestructura y meteorología dentro de Filtros. Vías regulables; trenes y demás vehículos opacos. El grosor del trazado raster procede de OpenRailwayMap.
- Símbolos y colores por categorías publicadas, editables. Aviación ligera/pesada/helicópteros; tipos de barcos; servicios ferroviarios; familias orbitales. Tipos no publicados permanecen sin clasificar. No se inventan generaciones Starlink.
- Leyenda activable y desactivable; ficha individual con datos disponibles, fecha de observación y fuente.
- Satélites activos de CelesTrak, cálculo SGP4 en un trabajador separado cada dos segundos, búsqueda por nombre/NORAD. Son posiciones orbitales calculadas, no telemetría recibida.
- Adaptador mundial AIS Stream preparado en servidor con clave protegida, tipos de barco y reconexión. Sin clave se mantiene AIS regional de Fintraffic; no aparecen barcos mundiales inventados.
- Cambio de proyección mediante fundido conservando centro y altura. Se evita el recorrido de cámara de Cesium que causaba saltos extremos al cambiar desde una ciudad.

## Cobertura y actualización

**Mundial describe el alcance del visor y de la consulta aérea, no una garantía de observar todos los vehículos del planeta.** OpenSky y AIS dependen de recepción. El ferrocarril conectado incluye España, Francia, Austria, Irlanda, Noruega, Finlandia, Estados Unidos y Canadá, con cobertura parcial por operador. Otros países y metros necesitan adaptadores propios; algunos exigen registro o claves. Esta versión no conecta aún Asia, África ni Oceanía.

GitHub Pages aloja archivos estáticos. Actions actualiza la instantánea aérea mundial y ferroviaria aproximadamente cada quince minutos; el navegador busca un nuevo archivo cada treinta segundos. Actions puede retrasarse. Ninguna observación se rejuvenece al descargarla de nuevo. Las estimaciones ferroviarias se calculan aparte y están identificadas; el usuario puede desactivarlas. Los horarios nacionales se descargan una vez al día y se interpretan con sus calendarios y zonas horarias, incluidos servicios nocturnos.

El servidor opcional consulta ADSB.lol en la zona observada cada cinco segundos, Renfe cada veinte segundos y AIS cada cinco segundos. Interpola entre muestras aéreas recientes, sin extrapolar instantáneas viejas. OpenSky mundial se comparte en caché quince minutos sin cuenta, o dos minutos con credenciales. El complemento regional conserva el resto del mundo. Sin servidor, OpenSky y ADSB.lol no admiten consultas del navegador desde GitHub Pages; AvioADSB permite el complemento limitado descrito arriba; no se promete movimiento aéreo segundo a segundo ni precisión de rodaje comparable a Flightradar24.

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

AIS Stream exige intermediario y prohíbe conexiones directas desde el navegador. La conexión se implementa pero no puede activarse sin la clave del propietario. Ese estado se refiere únicamente a AIS Stream mundial; Fintraffic regional funciona directamente sin clave.

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
| Navegación | [Fintraffic/Digitraffic](https://www.digitraffic.fi/en/marine-traffic/) y [AIS Stream](https://www.aisstream.io/documentation) | Fintraffic: CC BY 4.0, AIS regional sin cuenta, clase A y sin pesqueros. AIS Stream: clave gratuita y servidor para cobertura mundial de receptores. |
| Órbitas | [CelesTrak OMM](https://celestrak.org/NORAD/documentation/gp-data-formats.php) y [satellite.js](https://github.com/shashwatak/satellite-js) | SGP4; política de actualización de dos horas. OMM admite identificadores NORAD mayores que los de TLE. |
| Satélite, relieve, océanos | [Esri términos](https://www.esri.com/en-us/legal/terms/web-site-service) | Servicios públicos con atribución, proyecto personal no comercial. Imágenes de distintas fechas; relieve cartográfico, no terreno geométrico 3D. |
| Calles y ferrocarril | [OSM](https://operations.osmfoundation.org/policies/tiles/), [OpenRailwayMap](https://wiki.openstreetmap.org/wiki/OpenRailwayMap/API) | Atribución y políticas para aplicaciones pequeñas, sin descarga masiva de teselas. |
| Radar | [RainViewer](https://www.rainviewer.com/api/weather-maps-api.html) | Última imagen publicada, cobertura parcial, zoom nativo máximo 7. |
| Satélite meteorológico | [EUMETView](https://user.eumetsat.int/data-access/eumetview/resources) | Última fecha publicada por WMS: mosaico infrarrojo mundial de tres horas y Meteosat de quince minutos para Europa/África o el Índico. Cobertura propia de cada producto. |
| Lugares | [Nominatim](https://operations.osmfoundation.org/policies/nominatim/) | Búsqueda explícita, sin autocompletado remoto; máximo una consulta por segundo y caché en servidor. |

Sin servicios de pago. Las estimaciones ferroviarias y órbitas calculadas están identificadas como tales. Una futura explotación comercial o gran carga requerirá revisar las condiciones y capacidad de cada proveedor.

## Estructura

`src/motion.js`: geometría, horarios e interpolación. `rail-engine.js`: prioridad de posiciones y horarios. `rail.js`: adaptadores internacionales. `routes.js`: recorridos y estaciones seleccionados. `tools/rail-schedules.mjs`: GTFS, calendarios, zonas horarias y caché diaria.

`src/app.js`: visor, interfaz y símbolos individuales. `catalog.js`: categorías/iconos. `model.js`: validación, unidades, fechas y mezcla mundial/regional. `layers.js`: cartografía. `orbit-worker.js`: SGP4. `tools/providers.mjs`: fuentes. `ais.mjs`: mensajes marítimos. `server.mjs`: servidor protegido y caché. `collect.mjs`: instantáneas. `vendor.mjs`: publicación de satellite.js. `test/`: validación de datos y servidor.

Referencias de producto: [RadarDeTrenes](https://radardetrenes.com/), [OpenRailwayMap](https://www.openrailwaymap.org/), [Windy](https://www.windy.com/), [Positrén](https://positren.nebulacodex.com/), [Flexport Atlas](https://atlas.flexport.com/), [LocalizaTodo](https://www.localizatodo.com/html5/) y [SatelliteMap](https://satellitemap.space/).

## Referencias y pendientes

- [AvioADSB: límites y cobertura](https://avioadsb.org/docs/api): cien consultas diarias anónimas. No ofrece cobertura comparable a Flightradar24; OpenSky tampoco garantiza todos los vuelos, especialmente sobre océanos y zonas con pocos receptores. No se recogen datos de servicios de pago ni se eluden restricciones.
- [OurAirports](https://ourairports.com/data/), dominio público; [FAA](https://www.faa.gov/data/aero_data), datos y cartas de uso público. Los límites FIR mundiales actualizados de ICAO requieren una suscripción; quedan por investigar otros conjuntos abiertos con licencia y cobertura adecuadas.
- [Entur](https://developer.entur.org/pages-real-time-vehicle/), NLOD; [ÖBB-Personenverkehr AG](https://data.oebb.at/de/datensaetze~soll-fahrplan-gtfs~), CC BY 4.0, horarios transformados en posiciones estimadas; [Irish Rail](https://api.irishrail.ie/realtime/), estimaciones de señalización/horarios, no GPS.
- [EUMETView](https://user.eumetsat.int/data-access/eumetview/resources), WMS esencial sin registro; [Open-Meteo](https://open-meteo.com/en/docs), CC BY 4.0, servicio gratuito no comercial. La visualización transforma e interpola los datos; no implica respaldo de las fuentes al proyecto.
- Alemania, Suecia, Dinamarca, Italia, Reino Unido, Polonia, Bálticos y otros países siguen pendientes de conectores. Su ausencia no implica que no publiquen datos. Algunas fuentes exigen claves gratuitas; otras ofrecen horarios pero no posiciones. No existe una API ferroviaria gratuita universal.
- Barcos mundiales: falta la clave gratuita AIS Stream y el servidor. El radar aéreo mundial continuo y la precisión de rodaje siguen pendientes de fuentes y servidor; esta versión no los resuelve.

Comprobaciones: adaptadores, unidades, calendarios, geometrías, interpolación y privacidad; meteorología polar/dateline; escritorio y móvil; capas, créditos, modelos y proyecciones. Los datos generados están fuera de Git y se publican desde Actions.
