# CRM de marca blanca y panel de instancias

Sí: el CRM puede ofrecerse con la marca de cada cliente. La carpeta nueva
`retail/` agrega el panel del operador, el registro de instancias y el acceso
privado de cada propietario. Se mantiene el mismo repositorio; no necesitas
copiarlo a otro repositorio por cada venta.

## Qué está implementado

- Panel con login propio, creación, búsqueda, estado y suspensión de instancias.
- Nombre del negocio, nombre visible del CRM y logo inicial por cliente; el
  propietario puede personalizarlos en Configuración.
- Subdominio propio y base SQLite independiente por instancia, identificada
  internamente con un UUID aleatorio. El registro del panel contiene únicamente
  metadatos de las instancias.
- Instancias vacías: se reutiliza el código y las plantillas iniciales del
  producto, sin copiar clientes, cuentas, proveedores, contraseñas, sesiones ni
  claves del CRM original.
- Invitación privada de un solo uso, válida durante 48 horas, vinculada al
  correo y a la instancia. El propietario elige una contraseña de al menos
  12 caracteres. Renovar una invitación pendiente invalida la anterior.
- Cookies seguras limitadas al dominio, contraseñas con hash, sesiones de ocho
  horas, protección de origen/CSRF y límites de intentos de acceso. Se rechazan
  dominios desconocidos y solicitudes que intenten reutilizar sesiones de otra
  instancia.
- Suspensión sin borrar datos; revoca las sesiones existentes y bloquea rutas,
  API y archivos de ese CRM. Reactivar exige iniciar sesión de nuevo.
- Cambio de contraseña del panel con cierre de sus sesiones. El panel no
  incluye suplantación de clientes ni restablecimiento de contraseñas de CRMs
  ya activados.

Las claves WhatsApp, correo y automatizaciones del CRM personal no se heredan.
Los envíos externos de las instancias permanecen desconectados. Cada cliente
conserva sus plantillas y mensajes manuales mediante `wa.me`; las integraciones
automáticas requieren configurar credenciales y ejecución por instancia en una
etapa posterior.

En el modo servidor, la invitación acredita la posesión del enlace y el correo
asignado; no realiza una verificación del buzón por correo. El operador ve el
enlace inicial y debe entregarlo privadamente al cliente. En la alternativa
Cloudflare, Access verifica el acceso al correo cuando se configura su proveedor
de identidad. La verificación de correo del modo servidor queda pendiente de
conectar un proveedor por instancia.

## Cómo se separan los datos

```text
retail-data/                    # fuera del repositorio y del directorio público
  registry.sqlite3             # propietario del panel y metadatos de instancias
  instances/
    <uuid-cliente-a>/crm.sqlite3
    <uuid-cliente-b>/crm.sqlite3
```

El dominio determina la instancia antes de autenticar y leer datos. El cliente
no elige una ruta de archivo ni un identificador para leer otra base. El panel
no tiene una API para consultar espacios de clientes. Las carpetas tienen
permisos 700 y los archivos SQLite 600.

Este modo separa los datos y el acceso de los clientes dentro de un mismo
servidor y proceso. El administrador de la infraestructura con acceso al disco
todavía puede leer las bases; las contraseñas de cuentas madre forman parte del
contenido privado del CRM y no tienen cifrado adicional de aplicación. No
equivale a contenedores o cuentas de infraestructura independientes ni garantiza
que cualquier ataque sea imposible. El volumen y los respaldos deben estar
protegidos y, en producción, cifrados mediante el proveedor de alojamiento.

Para una separación de recursos por cliente existe también
[cloud/RETAIL.md](cloud/RETAIL.md): crea un Worker, una base D1 y una aplicación
Access exclusivos. Es un camino de despliegue diferente, todavía no conectado
al botón del panel. Los permisos administrativos de la cuenta Cloudflare siguen
siendo permisos de infraestructura; Access protege a los usuarios finales.

## Desplegar el panel y las instancias en un servidor

Necesitas un dominio, DNS, HTTPS, un servidor con almacenamiento persistente y
respaldo. GitHub Pages sirve la versión local; no puede alojar este panel ni
aislar bases privadas en el servidor.

1. Instala `requirements.txt` y configura las variables de
   [.env.retail.example](.env.retail.example) en el servidor. Usa tus dominios
   reales, por ejemplo un dominio para el panel y otro dominio base para sus
   clientes. No subas contraseñas ni bases al repositorio.
2. Apunta el dominio del panel y `*.tu-dominio-base` al servidor. Instala HTTPS
   para ambos, incluyendo los subdominios. El sistema registra la instancia; no
   crea DNS ni certificados automáticamente.
3. Configura el propietario del panel una sola vez con `RETAIL_ADMIN_EMAIL` y
   `RETAIL_ADMIN_PASSWORD` en el gestor seguro del alojamiento, o con
   `python -m retail.cli init-admin --email tu-correo` desde el servidor y
   contraseña oculta en terminal. No existe una contraseña predeterminada.
4. Ejecuta el servidor con las mismas variables:

   ```sh
   python -m gunicorn --bind 127.0.0.1:8002 --workers 2 retail.wsgi:app
   ```

5. Coloca el servidor detrás de un proxy HTTPS que preserve el `Host` original
   validado. Rechaza hosts desconocidos en el proxy también. El dispatcher no
   confía en `X-Forwarded-Host`; configura `RETAIL_PUBLIC_URL` sin ruta, y
   `RETAIL_BASE_DOMAIN` sin esquema ni puerto. El puerto HTTPS de clientes es
   443 por defecto (`RETAIL_TENANT_PORT` solo para otro puerto explícito).
6. Inicia sesión en el dominio del panel, crea un CRM y comparte la invitación
   de forma privada con su propietario. La activación no envía correo ni
   mensajes automáticamente.
7. Antes de entregar cada CRM, comprueba acceso del propietario, rechazo de
   otra cuenta, datos persistentes tras reiniciar y recuperación de su respaldo.

Alternativa Docker, con `.env.retail` privado y los dominios/HTTPS ya preparados:

```sh
docker compose -f compose.retail.yaml up -d --build
```

El puerto interno se expone solamente en loopback; el proxy HTTPS debe estar en
el mismo servidor. El volumen `retail-data` persiste independientemente de la
imagen. Este servicio no inicia el trabajador de recordatorios del CRM original.
Si el entorno de desarrollo requiere construcción sin red, consulta la ruta de
wheels documentada en las instrucciones de instalación existentes.

## Validación local y preparación Cloudflare

```sh
python -m unittest discover -s tests -p 'test_*.py'
NODE_PATH=/tmp/crm-browser-tools/node_modules python tests/run_retail_browser.py
```

La prueba de navegador inicia Gunicorn con dos trabajadores para varios dominios HTTPS
de prueba con certificado temporal y bases desechables. Comprueba panel,
activaciones, marca, persistencia separada, rechazo de cookies ajenas,
suspensión y pantalla móvil. Playwright y Chromium son herramientas de prueba
externas al producto. No se crean clientes reales ni se envían mensajes.

La alternativa Cloudflare se puede preparar localmente sin publicar:

```sh
python cloud/retail_deploy.py --instance-id <uuid-de-la-instancia> \
  --slug mi-cliente --owner-email propietario@example.com \
  --brand-name "CRM de mi cliente"
```

`--deploy` requiere cuenta y credenciales de Cloudflare, Zero Trust configurado
y verificación real posterior. El script crea recursos nuevos, se detiene ante
colisiones y publica inicialmente bloqueado hasta configurar el Access de ese
propietario. El manifiesto queda fuera de los archivos públicos. Las instancias
preparadas para Cloudflare no se publican ni se sincronizan desde el panel
Python. Conserva ambos caminos como alternativas y elige uno para cada cliente.

## Siguientes etapas para comercializar

1. Desplegar y verificar el camino elegido con dominios y propietarios reales.
   Esta implementación está probada localmente, sin un panel público desplegado.
2. Definir planes, cuotas de almacenamiento/instancias y política de respaldo
   y recuperación por cliente. Los planes gratuitos de Cloudflare tienen límites;
   no implican alojamiento ilimitado ni coste cero para cualquier escala.
3. Añadir facturación, renovaciones comerciales, términos de uso y política de
   privacidad antes de cobrar. Revisar licencias de dependencias; el producto no
   incluye gestión de suscripciones ni condiciones comerciales predefinidas.
4. Conectar el aprovisionamiento Cloudflare al panel si se elige esa arquitectura,
   y configurar proveedores de mensajes/correo por instancia sin compartir claves.
5. Desarrollar recuperación de contraseña, segundo factor, registros de
   administración y controles de operación para la plataforma comercial.

Los usuarios/permisos dentro de cada CRM, el embudo de ventas y la auditoría de
clientes siguen como tareas pendientes solicitadas previamente. El propietario
único de una instancia y el operador del panel son accesos separados, no un
sistema de equipos internos. No hay importación automática de la base del CRM
actual a una nueva instancia.
