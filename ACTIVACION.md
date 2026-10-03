# Activar las conexiones de Transportination

Guía para el propietario · versión 0.5.0 · revisada el 3 de octubre de 2026.

**Puedes hacerlo después.** La web funciona sin estos pasos con instantáneas aéreas, barcos regionales de Fintraffic, ferrocarril conectado y órbitas calculadas. Para que los aviones visibles reciban posiciones cada pocos segundos hay que activar el servidor. Los secretos de GitHub por sí solos no permiten esa recepción continua desde Pages.

## Qué hay que configurar

| Nombre exacto | Dónde se guarda | Para qué sirve | Obligatorio |
|---|---|---|---|
| `LIVE_API_URL` | GitHub → Actions → **Variables** | Dirección pública HTTPS del servidor | Para conectar la web al servidor |
| `AISSTREAM_API_KEY` | GitHub → Actions → **Secrets** y Render → Environment | Barcos de los receptores mundiales de AIS Stream | Solo para AIS mundial |
| `OPENSKY_CLIENT_ID` | GitHub → Actions → **Secrets** y Render → Environment | Identificador del cliente OAuth de OpenSky | Opcional |
| `OPENSKY_CLIENT_SECRET` | GitHub → Actions → **Secrets** y Render → Environment | Secreto del mismo cliente OAuth | Opcional; va junto al anterior |

La aviación regional de ADSB.lol no necesita una clave. Tampoco necesitan claves Fintraffic, OurAirports, FAA, DFS, los ferrocarriles ya conectados, CelesTrak, RainViewer, EUMETSAT ni Open-Meteo. No hace falta crear cuentas de todos esos servicios.

## 1. Crear el servidor gratuito en Render

1. Abre [Render](https://dashboard.render.com/) y crea una cuenta con GitHub.
2. Abre [la configuración preparada para Transportination](https://render.com/deploy?repo=https://github.com/AlejandroPico/Transportination). Si prefieres hacerlo desde el panel, elige **New → Blueprint** y selecciona el repositorio `AlejandroPico/Transportination`.
3. Autoriza el acceso al repositorio cuando GitHub lo solicite. Render leerá el archivo `render.yaml` de la rama `main` y propondrá el servicio `transportination-data`.
4. Comprueba que el servicio use **Free**. No añadas tarjeta ni cambies a un plan de pago: al superar ciertos límites sin método de pago, Render suspende el servicio en lugar de cobrar excedentes.
5. Aplica la configuración y espera a que termine el despliegue. En este primer paso no necesitas claves de AIS ni de OpenSky.
6. Dentro del servicio, comprueba que **Environment** contenga `ALLOWED_ORIGINS` con el valor `https://alejandropico.github.io`. El archivo preparado ya lo establece.
7. Copia la dirección HTTPS que Render te asigne, por ejemplo `https://transportination-data-XXXX.onrender.com`. Usa tu dirección real, no este ejemplo. No copies una dirección del panel de administración ni añadas `/api` al final.
8. Abre esa dirección añadiendo `/api/status`. Debe responder con `mode: "live"` y la versión del proyecto. `ships: "unconfigured"` es normal mientras no configures AIS Stream; no impide la recepción aérea regional.

El plan gratuito puede dormir tras quince minutos sin tráfico y tardar alrededor de un minuto en despertar. El historial guardado en memoria y los barcos recibidos antes del reinicio se pierden; vuelven a recogerse. No garantiza funcionamiento continuo ni capacidad ilimitada. [Condiciones del plan gratuito de Render](https://render.com/docs/free).

## 2. Conectar GitHub Pages a ese servidor

1. Abre [Settings del repositorio](https://github.com/AlejandroPico/Transportination/settings).
2. En el menú lateral entra en **Secrets and variables → Actions**.
3. Abre la pestaña **Variables**. Este paso no va en Secrets.
4. Pulsa **New repository variable**.
5. En **Name** escribe exactamente `LIVE_API_URL`.
6. En **Value** pega la dirección HTTPS del servicio Render del paso anterior, sin `/api/status` ni `/api`. Guarda la variable.
7. Abre [Actions](https://github.com/AlejandroPico/Transportination/actions), selecciona **Check and publish Transportination**, pulsa **Run workflow** y elige `main`.
8. Espera a que terminen los trabajos `check` y `publish`. Después abre [Transportination](https://alejandropico.github.io/Transportination/?v=0.5) y recarga la página.
9. Acércate a un aeropuerto o a una zona con aviones. El servidor consulta esa región cada cinco segundos y el navegador interpola entre observaciones recientes. En la ficha del avión debería avanzar la fecha de observación cuando exista recepción nueva. El Acerca de muestra el estado de conexión.

No hace falta introducir ninguna clave en la web. La dirección `LIVE_API_URL` es pública; las credenciales permanecen en el servidor.

## 3. Activar AIS Stream para barcos mundiales

1. Abre [AIS Stream → Account](https://aisstream.io/account) y pulsa **Continue with GitHub**. Autoriza el inicio de sesión.
2. En tu cuenta crea una clave de API y cópiala. No la pegues en el chat ni en un archivo del repositorio.
3. Vuelve a GitHub → Transportination → **Settings → Secrets and variables → Actions**.
4. En la pestaña **Secrets**, pulsa **New repository secret**.
5. En **Name** escribe exactamente `AISSTREAM_API_KEY`. En **Secret** pega la clave y pulsa **Add secret**.
6. Ve también a Render → servicio `transportination-data` → **Environment** → añadir variable de entorno. Pon el mismo nombre `AISSTREAM_API_KEY` y la misma clave. Guarda y vuelve a desplegar el servicio si Render lo solicita.
7. Ejecuta otra vez el workflow de GitHub del paso 2. Así las instantáneas de Pages también podrán recoger barcos. **La clave de GitHub no se copia automáticamente a Render.**
8. Abre `/api/status` del servidor: el estado marítimo debería pasar de `unconfigured` a `connecting` y después `connected` al recibir mensajes. Activa Barcos en la web. Los mensajes se clasifican por el tipo AIS publicado; su cobertura depende de los receptores, no garantiza todos los barcos del planeta.

Solo GitHub, sin Render, recoge una ventana de mensajes por publicación y ofrece instantáneas espaciadas. Render mantiene la conexión mientras el servicio esté activo. AIS Stream exige una conexión desde un servidor y no admite exponer la clave al navegador. [Cuenta y condiciones de uso de claves de AIS Stream](https://aisstream.io/account).

## 4. OpenSky: opcional para aumentar la cuota mundial

Puedes saltarte este apartado inicialmente: el complemento regional frecuente funciona con ADSB.lol sin cuenta. OpenSky aporta la instantánea mundial y la trayectoria experimental de un vuelo seleccionado cuando la fuente la publica.

1. Crea una cuenta gratuita en [OpenSky Network](https://opensky-network.org/) e inicia sesión.
2. Abre tu apartado **Account** y crea un **API client**. OpenSky entregará un `client_id` y un `client_secret`. Usa estos dos valores; no tu contraseña personal.
3. En GitHub → **Settings → Secrets and variables → Actions → Secrets**, crea dos secretos de repositorio:
   - `OPENSKY_CLIENT_ID`: el `client_id`.
   - `OPENSKY_CLIENT_SECRET`: el `client_secret`.
4. En Render → servicio → **Environment**, añade esos mismos dos nombres y valores. Guarda y vuelve a desplegar el servicio.
5. Ejecuta el workflow de GitHub y recarga Transportination. Con ambos valores configurados el servidor comparte la consulta mundial cada dos minutos; sin ellos conserva quince minutos para respetar la cuota anónima. La región visible se sigue consultando mediante ADSB.lol cada cinco segundos.

La autenticación aumenta la cuota, pero no amplía por sí sola la red de receptores. OpenSky mantiene límites separados para posiciones y trayectorias. La consulta de estelas es experimental, se comparte en caché diez minutos y se detiene ante agotamiento de cuota; no garantiza el vuelo entero ni trazado segundo a segundo. [Instrucciones OAuth y cuotas oficiales de OpenSky](https://openskynetwork.github.io/opensky-api/rest.html).

## Si algo no responde

- **No hay aviones en movimiento:** comprueba que Render esté despierto, `/api/status` responda y `LIVE_API_URL` esté en **Variables**. Ejecuta el workflow después de cambiarla. Una fecha aérea antigua significa que se conserva una instantánea o que no llegan observaciones nuevas.
- **AIS mundial dice `unconfigured`:** falta `AISSTREAM_API_KEY` en Render. Guardarlo solo en GitHub no activa la conexión del servidor.
- **Solo aparecen barcos del Báltico:** Fintraffic está conectado; AIS Stream mundial aún no recibe mensajes o falta su configuración.
- **OpenSky rechaza la autenticación:** comprueba los dos valores del mismo cliente OAuth en los dos lugares. No uses nombre y contraseña de tu cuenta.
- **Un país queda vacío:** consulta las fuentes y la cobertura del panel. Activar claves no conecta automáticamente nuevos operadores ferroviarios, aerovías de otros países ni recepción satelital comercial de aviones.

Si alguna clave se publica accidentalmente, revócala en su proveedor, crea una nueva y sustitúyela en GitHub y Render. Las claves no deben aparecer en capturas, chats, código, `LIVE_API_URL` ni archivos de `data`.
