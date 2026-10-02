# Transportination

Tierra, mar y aire en un mismo mundo. Un atlas abierto de transportes con globo 3D, mapa plano y capas combinables.

## Versión 0.1 · 2 de octubre de 2026

- Globo CesiumJS con transición animada a Mercator 2D, conservando centro, escala aproximada, filtros y selección sin recargar.
- Menú superior derecho, esquinas rectas, zoom numérico que restablece la vista, búsqueda, capas y filtros independientes.
- Aviones ADSB.lol hasta 250 millas náuticas alrededor del centro de la vista en modo local; detalle de indicativo, matrícula, modelo, velocidad, rumbo y altitudes publicadas.
- Trenes de Renfe: Cercanías/Rodalies y feed conjunto de Alta Velocidad, Larga y Media Distancia en España. Posiciones, estado y códigos de estación/viaje.
- Agrupaciones al alejarse, que se pueden pulsar para acercarse. Red ferroviaria mundial OpenRailwayMap a escala regional.
- Fondos NASA: relieve/batimetría, MODIS del día anterior UTC y luces nocturnas de 2012. Carreteras y límites administrativos OSM. Son mapas y mosaicos, no vídeo en directo ni terreno geométrico 3D.
- Última imagen de radar de RainViewer, con fecha y cobertura parcial.
- Búsqueda explícita de lugares mediante Nominatim y vehículos de la cobertura cargada, sin autocompletado remoto.
- Preferencias locales, interfaz móvil, fuentes y licencias visibles, errores y datos atrasados diferenciados. No hay tráfico simulado.
- Barcos y satélites figuran como integraciones pendientes, sin marcadores ficticios.

## Ejecutar sin cuentas ni dependencias

Con Node.js 22 o superior:

```sh
node tools/server.mjs
```

Abre `http://localhost:4173`. El servidor escucha solo en la máquina local. Consulta fuentes cada 20 segundos y comparte caché; pausa consultas cuando la pestaña está oculta. Permite acceder a ADSB.lol y Renfe, que no ofrecen CORS directo al navegador. No solicita claves.

```sh
node --test
node --check src/app.js
node tools/collect.mjs
```

QA de navegador opcional: `node tools/check-browser.mjs`, con servidor activo, Playwright y Edge instalados. `PLAYWRIGHT_MODULE`, `BROWSER_CHANNEL` y `TEST_ORIGIN` configuran el entorno. Las capturas de `artifacts/` no se publican.

## GitHub Pages y Actions

Configura **Settings → Pages → Source: GitHub Actions**. `pages.yml` valida y publica cambios de `main`, ejecuciones manuales e instantáneas programadas aproximadamente cada 15 minutos. Los pull requests ejecutan comprobaciones sin publicar.

Pages es estático: **muestra instantáneas, no un flujo en directo**. Los aviones cubren un círculo fijo de 250 mn alrededor de 40° N, 3° O; los trenes cubren los feeds españoles. Mover el mapa no desplaza esa cobertura. Actions puede retrasar u omitir ejecuciones; cada posición conserva su fecha. El navegador comprueba nuevas instantáneas cada diez minutos. El despliegue publica solamente `index.html`, `src`, `assets` y la instantánea, sin servidor.

## Viabilidad sin pagar

Se puede construir el visor y conseguir una cobertura útil sin pagar. **No hay garantía gratuita de cobertura mundial completa y continua de todos los transportes.** Los servicios comunitarios tienen límites, licencias y zonas sin datos; tampoco garantizan sostener una aplicación muy popular. GitHub Pages y Actions tienen límites propios. Esta versión no contrata servicios ni activa facturación.

| Área | Fuente | Límite relevante |
| --- | --- | --- |
| Aviones | [ADSB.lol](https://www.adsb.lol/docs/open-data/api/), ODbL 1.0 | Cobertura de receptores. La posición no incluye necesariamente origen/destino ni todos los vuelos. |
| Trenes españoles | [Cercanías](https://data.renfe.com/dataset/ubicacion-vehiculos) y [AV/LD/MD](https://data.renfe.com/dataset/posicion-vehiculos-av-ld-md), CC BY 4.0 | Solo vehículos publicados por Renfe. Sin horarios ni retrasos integrados aún. La fecha del feed no siempre es individual. |
| Otros trenes y metros | Futuras fuentes por operador/país, preferentemente GTFS-RT | GPS, retrasos y horarios son distintos. Las futuras posiciones estimadas se etiquetarán como estimaciones. |
| Barcos | [AIS Stream](https://www.aisstream.io/documentation), servicio gratuito con cuenta | Requiere clave y servidor intermediario; prohíbe conexión directa desde navegador. Pendiente en 0.1. No garantiza cobertura oceánica mundial. |
| Cartografía | [OSM](https://operations.osmfoundation.org/policies/tiles/), [OpenRailwayMap](https://wiki.openstreetmap.org/wiki/OpenRailwayMap/API), [NASA GIBS](https://www.earthdata.nasa.gov/data/tools/gibs) | Atribución y capacidad limitada de teselas. ORM permite aplicaciones públicas pequeñas no comerciales. Sin descarga masiva. |
| Tiempo | [RainViewer](https://www.rainviewer.com/api/weather-maps-api.html); futuro [Open-Meteo](https://open-meteo.com/en/pricing) | Radar con huecos/latencia y zoom nativo máximo 7. Open-Meteo gratuito alojado exige uso no comercial. |
| Satélites | Futuro [CelesTrak](https://celestrak.org/NORAD/documentation/gp-data-formats.php) y SGP4 | Posiciones calculadas, no GPS recibido. Reutilizar elementos orbitales y respetar las políticas de actualización. |

Las posiciones antiguas se atenúan: más de 60 segundos en aviones, más de 120 en trenes. Son umbrales de presentación, no certificaciones de precisión. No se inventa movimiento a partir de posiciones viejas, ni se deduce precisión espacial de la antigüedad.

## Próximas versiones

1. Servidor AIS con clave protegida y filtros según tipos publicados.
2. Unir Renfe con GTFS de horarios/estaciones y actualizaciones de viaje para rutas, nombres y retrasos, sin confundir horario con GPS; añadir operadores y metros disponibles.
3. Aeropuertos, puertos y estaciones; después rutas aeronáuticas y balizas reutilizables.
4. Satélites SGP4, con edad de elementos orbitales visible.
5. Viento, nubes y más variables meteorológicas con fecha y cobertura.
6. Cobertura multirregión y caché para más usuarios; revisar políticas antes de explotar comercialmente.

## Referencias

[RadarDeTrenes](https://radardetrenes.com/), [OpenRailwayMap](https://www.openrailwaymap.org/), [Windy](https://www.windy.com/), [Positrén](https://positren.nebulacodex.com/), [Flexport Atlas](https://atlas.flexport.com/), [LocalizaTodo](https://www.localizatodo.com/html5/), [SatelliteMap](https://satellitemap.space/). Orientan alcance e interacciones; se usan fuentes independientes abiertas, sin copiar recursos ni extraer posiciones mediante scraping.

## Estructura

`src/app.js`: visor/interfaz. `src/model.js`: validación, filtros, antigüedad. `tools/providers.mjs`: conectores. `tools/server.mjs`: servidor/caché/búsqueda limitada. `tools/collect.mjs`: instantáneas. `test/`: unidades, fechas, filtros y servidor. Nuevas fuentes pueden añadirse sin rehacer el visor.
