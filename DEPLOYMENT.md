> Para la alternativa sin VPS con Cloudflare Free, consulta [FREE_DEPLOYMENT.md](FREE_DEPLOYMENT.md). Este documento describe el servidor Python opcional.

# Activar acceso privado y recordatorios automáticos

La página en GitHub Pages sigue siendo el modo local. No puede ejecutar el servidor Python ni el trabajador de recordatorios. Los cambios de la biblioteca de mensajes funcionan en Pages; el login y la automatización se activan en un servidor que ejecute este proyecto.

## Qué contratar y configurar

Para esta versión con SQLite, usa un VPS o un servicio de contenedores que tenga **disco persistente, HTTPS y procesos siempre activos**. La web y el trabajador deben compartir el mismo archivo SQLite. No uses una instancia que se suspenda cuando nadie visita la página ni despliegues varias réplicas con discos independientes. Un VPS con Docker Compose es la opción documentada aquí. El proyecto no contrata servicios ni crea una cuenta en Meta.

1. Obtén el servidor y un dominio o subdominio con HTTPS.
2. Despliega el repositorio completo en ese servidor.
3. Configura el administrador y el origen público. Inicia web y trabajador.
4. Descarga un respaldo desde tu página actual de GitHub Pages y restáuralo tras iniciar sesión en el sitio privado. Cambiar de dominio no transfiere `localStorage`.
5. Conecta la API oficial de WhatsApp y una plantilla aprobada por Meta. Activa la regla desde Automatización.

## Servidor web y datos

Python 3.12+, Flask, Gunicorn y SQLite. Las dos dependencias directas están fijadas en `requirements.txt`. La base de datos almacena usuario, hash scrypt de contraseña, sesiones, datos del CRM y registro de recordatorios. Las sesiones caducan a las 8 horas; las cookies son HttpOnly, SameSite=Strict y Secure en HTTPS. La API exige sesión, origen correcto y token CSRF en las modificaciones. No existe registro público de usuarios.

Configura **en privado** en el hosting:

| Variable                   | Uso                                                                                                                                     |
| -------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| `CRM_PUBLIC_URL`           | Origen del sitio, por ejemplo `https://crm.tudominio.com`, sin subruta. Debe coincidir exactamente con el navegador.                    |
| `CRM_DB_PATH`              | Archivo SQLite en almacenamiento persistente. En Docker: `/data/crm.sqlite3`.                                                           |
| `CRM_OWNER_EMAIL`          | Correo de la única cuenta administradora.                                                                                               |
| `CRM_OWNER_PASSWORD`       | Contraseña inicial, mínimo 12 caracteres. Se usa solo al crear el administrador por primera vez. No se guarda en texto plano en SQLite. |
| `WHATSAPP_ACCESS_TOKEN`    | Token válido de WhatsApp Cloud API, configurado como secreto del hosting.                                                               |
| `WHATSAPP_PHONE_NUMBER_ID` | Identificador del número emisor en Meta; no es el número de teléfono.                                                                   |
| `WHATSAPP_API_VERSION`     | Versión soportada de Graph API; valor inicial `v23.0`. Revisar vigencia al desplegar.                                                   |

No pongas credenciales en GitHub, formularios de plantillas o mensajes de chat. `.env.example` no contiene valores reales. Si usas `.env`, mantenlo fuera del repositorio y con permisos privados. Puedes retirar la contraseña inicial del entorno tras crear el administrador; el hash queda en el disco persistente. No se muestra ninguna contraseña ni token en la interfaz de estado.

Como alternativa al bootstrap por variable, crea o recupera la cuenta desde una terminal privada del servidor:

```sh
python -m backend.admin --email tu-correo@example.com
```

La contraseña se solicita con entrada oculta. Esto invalida las sesiones anteriores. La interfaz Seguridad permite cambiar la contraseña verificando la actual; también cierra todas las sesiones. No se ha implementado recuperación por correo ni segundo factor.

## Docker Compose en un VPS

Con Docker y el plugin Compose instalados, crea un `.env` privado con las variables anteriores. El repositorio incluye `Dockerfile` y `compose.yaml`.

```sh
docker compose up -d --build
```

El servicio `web` expone su puerto 8000 solo en la interfaz local del VPS. Configura un proxy HTTPS de tu hosting (Caddy, Nginx o equivalente) hacia ese puerto y fija `CRM_PUBLIC_URL` al dominio HTTPS. No expongas el puerto de desarrollo directamente en Internet. El servicio `reminders` ejecuta `python -m backend.worker` continuamente. Ambos comparten el volumen `crm-data` y se reinician con `unless-stopped`.

Comprueba:

- `/healthz` devuelve `{"status":"ok"}`.
- Abrir `/` sin sesión redirige al login; `/api/workspace` sin sesión devuelve 401.
- Tras entrar, guardar un cliente y recargar conserva los datos en el servidor.
- La vista Automatización informa de una revisión reciente del trabajador.
- Sin token/identificador de Meta, el sistema informa que falta configuración y no intenta enviar.

No elimines el volumen `crm-data`: contiene la cuenta y los registros. Haz respaldos de la aplicación y respaldos consistentes de SQLite mediante la API de backup de SQLite o un procedimiento del hosting. Copiar solo el archivo principal mientras SQLite tiene un WAL activo puede perder cambios. El JSON del CRM conserva clientes/configuración, incluye contraseñas de cuentas madre si las guardaste, pero no incluye credenciales de inicio de sesión ni sesiones.

### Construcción en entornos sin red dentro de Docker

El entorno de desarrollo actual permite descargar paquetes en el host, pero el DNS del contenedor de construcción no alcanza PyPI. Se probó esta ruta de instalación sin red dentro de Docker, conservando verificación TLS en la descarga del host:

```sh
python -m pip download --only-binary=:all: -r requirements.txt --dest build-wheels
docker build --network=none --build-arg INSTALL_FROM_WHEELS=1 -t nexo-crm .
```

Las ruedas generadas están ignoradas por Git. Deben corresponder al Python 3.12 y arquitectura del contenedor. La construcción normal descarga los paquetes directamente de PyPI cuando el hosting tiene conectividad; no se requiere desactivar certificados ni verificación.

## Configurar WhatsApp Cloud API

Tener instalada la app WhatsApp Business no equivale a tener acceso a Cloud API. Sigue la documentación oficial de [Meta](https://developers.facebook.com/docs/whatsapp/cloud-api/get-started). Completa el alta correspondiente a tu negocio, agrega un número apto para la API y obtén un token y el identificador del número. Confirma con Meta si tu número actual puede usarse con la app y API a la vez; no se asume esa capacidad.

Para mensajes iniciados por el negocio fuera de la ventana de conversación, usa una **plantilla aprobada**. Un texto de ejemplo para registrar en Meta, con parámetros posicionales en el cuerpo:

```text
Hola {{1}}, tu servicio {{2}} vence el {{3}}.
¿Deseas renovarlo? Responde a este mensaje y te ayudamos.
```

Tras la aprobación, configura en Automatización:

- El nombre exacto de la plantilla de Meta, por ejemplo `recordatorio_renovacion`.
- Su idioma exacto, por ejemplo `es` o `es_PE`, según la aprobación.
- Las variables en el mismo orden: `nombre, servicio, vence`.
- La hora de revisión en Lima (0–23); la anticipación es siempre de tres días.
- La casilla de autorización del cliente en su registro.

La biblioteca de mensajes permite textos y contextos arbitrarios para enviar manualmente con `wa.me`. Editar esa biblioteca no modifica una plantilla ya aprobada por Meta. Para automatización, el contenido fijo proviene de la plantilla registrada allí; este sistema completa sus variables y llama a `https://graph.facebook.com/<version>/<phone-number-id>/messages`. Esta versión admite parámetros de texto posicionales en el cuerpo, sin encabezados multimedia ni botones dinámicos.

El trabajador revisa cada minuto desde la hora elegida, considerando el día de Lima. Solo procesa suscripciones cuya fecha de vencimiento está exactamente a tres días y cuyos clientes autorizaron recordatorios. Si el servidor estuvo apagado todo ese día, no envía retroactivamente el recordatorio en otra fecha.

Cada cliente y vencimiento tiene un registro único. Si Meta acepta el mensaje, el trabajador no vuelve a enviarlo. Un rechazo explícito por límite de velocidad (HTTP 429) se reintenta después de 15 minutos durante el mismo día. Un timeout o caída tras iniciar el envío queda como incierto/pendiente de revisión y no se reenvía automáticamente, porque Meta podría haberlo aceptado. Los rechazos de configuración/plantilla requieren corregir la integración y revisar el registro. «Aceptado por Meta» no confirma entrega: todavía no hay webhooks de entrega/lectura implementados. No se han enviado mensajes reales durante las pruebas.

Meta y el hosting pueden tener costos. Consulta sus condiciones vigentes antes de activar la cuenta.

## Desarrollo y pruebas

```sh
python3 -m venv /workspace/crm-venv
/workspace/crm-venv/bin/python -m pip install -r requirements.txt
/workspace/crm-venv/bin/python -m unittest discover -s tests -p 'test_*.py' -v
node --test tests/crm.test.mjs
```

Para desarrollo local solamente, usa `CRM_PUBLIC_URL=http://127.0.0.1:8001` y `CRM_ALLOW_HTTP=1`. Configura un administrador con entrada oculta antes de usar datos reales. Inicia dos procesos en terminales persistentes desde la raíz del repositorio:

```sh
/workspace/crm-venv/bin/python -m gunicorn --bind 127.0.0.1:8001 backend.wsgi:app
/workspace/crm-venv/bin/python -m backend.worker
```

Ambos necesitan el mismo `CRM_DB_PATH`. No uses `python -m http.server` como servidor privado: únicamente sirve el modo local sin autenticación.

Con Playwright/Chromium disponibles como herramientas de prueba externas al proyecto:

```sh
npm install --prefix /tmp/crm-browser-tools --cache /tmp/crm-npm-cache --no-package-lock --no-audit --no-fund playwright
NODE_PATH=/tmp/crm-browser-tools/node_modules /workspace/crm-venv/bin/python tests/run_secure_browser.py
```

El runner inicia Gunicorn en un puerto libre, crea credenciales aleatorias solo para pruebas y usa una base de datos temporal. Valida login, datos privados, ocho mensajes en contextos personalizados, preview, configuración de automatización, rechazo de visitante anónimo, cambio de contraseña y logout. Termina el servidor y elimina los datos al acabar. Las pruebas de recordatorios usan un emisor simulado; nunca llaman a Meta.
