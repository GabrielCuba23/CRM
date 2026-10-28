# Compilación para la conexión autorizada de Cloudflare

`connector_build.py` prepara una alternativa al transporte de Wrangler cuando
la conexión de Cloudflare de ChatGPT está autorizada y el proceso local no tiene
un token. Construir estos archivos **no publica ni crea recursos**.

```sh
python3 cloud/connector_build.py --kind all \
  --output-dir /workspace/work/connector-bundles
python3 -m unittest discover -s tests -p test_connector_build.py
```

Necesita Python 3, Node y esbuild. Por defecto utiliza
`/tmp/crm-cloud-tools/node_modules/.bin/esbuild`; `--esbuild` permite elegir otra
instalación. Los archivos de entrada y el esquema proceden del repositorio
actual, incluyendo sus cambios aún no confirmados.

Cada subcarpeta `crm/` o `panel/` contiene `worker.mjs` y `manifest.json`. El
manifiesto describe la ruta y SHA-256 del módulo y del esquema, el tamaño, la
fecha de compatibilidad, las variables necesarias y la programación. No contiene
identificadores inventados, valores de secretos ni datos de clientes. Los
campos `required_bindings` son descriptores para completar con los recursos
reales; no son un cuerpo de publicación listo para enviar.

El módulo incorpora exclusivamente los recursos públicos enumerados en
`cloud/build.py` o los tres archivos públicos del panel. El Worker original
conserva la autenticación, los controles de origen/CSRF y el acceso privado. La
variante del CRM principal no usa el control de ciclo de vida de las copias.
La variante del panel conserva `/lifecycle/...`, que las copias consultan por
el binding `CONTROL`. El cron de cada Worker sigue necesitando configurarse
separadamente en la API; compilar un método `scheduled` no registra un horario.

Para publicar desde la conexión, el agente debe recuperar los endpoints actuales
de Cloudflare y comprobar primero la cuenta y sus recursos. Debe completar los
bindings con los identificadores y valores reales, aplicar el esquema D1 y
publicar inicialmente con `ACCESS_AUD=not-configured-closed`. Después crea o
verifica Access, configura su audiencia propia y publica la versión habilitada.
El archivo se envía como un módulo JavaScript en un cuerpo multipart con
`metadata.main_module=worker.mjs`; no se necesita un binding externo `ASSETS`.

El panel necesita además `RETAIL_PROVISION_TOKEN` como secreto en producción
para crear CRMs. La conexión no permite recuperar el valor de un secreto ya
guardado. Los secretos existentes deben conservarse al actualizar un Worker;
no se deben copiar placeholders del proxy como si fueran credenciales reales.
Conserva un registro privado de los identificadores y etapas. Si una llamada
queda en estado incierto, revisa los recursos antes de repetir una creación.

Después de publicar, verifica en las URLs reales el acceso del propietario, el
rechazo de otros correos, la persistencia y la separación de las instancias. La
compilación y sus pruebas locales no sustituyen esta comprobación.

## Contraseña del CRM principal

`AUTH_MODE=password` activa el acceso propio del Worker. Requiere las tablas
`auth_owner`, `auth_setup`, `auth_sessions` y `auth_attempts`, y un secreto
`AUTH_PASSWORD_PEPPER` de al menos 32 caracteres aleatorios. Conserva ese secreto
al actualizar: reemplazarlo impediría verificar las contraseñas existentes.
Sin `AUTH_MODE=password`, las instancias mantienen la verificación de Access.

El primer ingreso usa una invitación aleatoria de 32 bytes, cuyo SHA-256 se
guarda en `auth_setup` con el correo propietario, caducidad y `used_at=NULL`.
El enlace privado `/login#setup=...` permite que el propietario elija su contraseña;
el token nunca se añade al repositorio ni a la extensión. La creación es atómica,
de un solo uso y no permite reemplazar una cuenta existente. La implementación
usa PBKDF2-SHA256 con 100.000 iteraciones, sal aleatoria y HMAC con el secreto del
Worker. Una prueba del runtime de producción confirmó que el límite es 100.000;
600.000 funciona localmente pero se rechaza en ese runtime de Cloudflare.

Publica el Worker y verifica sus bindings y pruebas de bloqueo anónimo antes de
retirar la pantalla de Access de ese CRM. La publicación principal conserva su
aplicación y política de propietario originales y añade una política Bypass solo
en esa aplicación: el Worker exige ahora su propia sesión. El panel de instancias
y las copias no cambian con esta operación. Comprueba después la página de
contraseña y que las API y los módulos privados sigan rechazando solicitudes sin
sesión. Cambiar la contraseña revoca todas las sesiones.
