# Nexo · Gestor Streaming

Gestor de clientes y suscripciones con interfaz adaptable a móvil, inspirado en las referencias proporcionadas. La interfaz usa HTML, CSS y JavaScript; el modo privado añade un backend Python con Flask, Gunicorn y SQLite.

## Opción privada en plan gratuito

La nueva alternativa Cloudflare Workers + D1 + Access evita contratar un VPS. Incluye acceso exclusivo por correo, almacenamiento centralizado y cron horario. El despliegue completo está automatizado en `cloud/deploy.py`; consulta [FREE_DEPLOYMENT.md](FREE_DEPLOYMENT.md) para conectar tu propia cuenta Free. Está preparado y probado localmente, pero pendiente de autorización para publicarlo. Los envíos automáticos de Meta pueden tener coste.

## Acceso privado y automatización

Se añadió un servidor con login de administrador, SQLite y un trabajador de recordatorios automáticos a tres días del vencimiento. Consulta [DEPLOYMENT.md](DEPLOYMENT.md) para activarlo con HTTPS, almacenamiento persistente y la API oficial de WhatsApp. GitHub Pages mantiene el modo local; no puede ejecutar estas funciones del servidor.

La biblioteca ahora permite crear, duplicar, buscar y organizar mensajes por cualquier contexto, con vista previa. Los mensajes manuales no están limitados a los tres ejemplos iniciales. La automatización usa una plantilla aprobada por Meta, configurada por nombre, idioma, hora y variables; está desactivada por defecto.

## Reglas y tareas configurables

En Automatización puedes crear y duplicar reglas por plantilla, plataformas, días antes o después del vencimiento, hora y canal. La bandeja permite revisar el texto, abrir wa.me y registrar tu confirmación sin confundir abrir con enviar. Las reglas nuevas y duplicadas están desactivadas. La integración opcional de Zapier, Make o n8n tiene una API protegida que reserva tareas y recibe resultados; queda preparada sin credenciales ni envíos reales. Consulta [INTEGRATIONS.md](INTEGRATIONS.md). No hay tres espacios fijos de mensajes; siguen aplicándose las cuotas de alojamiento y almacenamiento.

## Ejecutar el modo local

Con Python 3, desde la raíz del repositorio:

```sh
python3 -m http.server 8000 --bind 0.0.0.0
```

Abre la dirección del servidor en el navegador. Los módulos JavaScript requieren servir los archivos por HTTP; no abrir `index.html` directamente con `file://`. En un despliegue público usa HTTPS.

## Funciones

- Inicio con indicadores, venta rápida y suscripciones que requieren atención.
- Clientes: botón visible de alta, edición, ficha 360, búsqueda y filtros; teléfono y usuario de WhatsApp opcionales. Importación CSV/XLSX con vista previa, errores y duplicados; exportación de todos los clientes en ambos formatos. La importación no genera cobros.
- Cuentas madre: plataforma, correo, contraseña opcional con mostrar/ocultar, proveedor, vencimiento y capacidad de 1 a 50 perfiles. Al cambiar el acceso de una cuenta, se actualiza en sus clientes vinculados.
- Perfiles disponibles: asignación del siguiente perfil libre, evitando asignaciones duplicadas. Una suscripción vencida sigue ocupando su perfil hasta liberarla o eliminarla. Las cuentas madre vencidas no admiten nuevas asignaciones.
- Renovaciones: actualización de fecha, cobro opcional y preparación de recordatorios.
- Finanzas en soles: las altas nuevas registran una venta si se deja marcada como cobrada y se indica un precio positivo; editar no duplica la venta. Se pueden registrar ingresos anteriores desde Finanzas y vincularlos al cliente. Incluye ventas marcadas como cobradas, renovaciones cobradas, gastos, filtro mensual, ganancia, tendencia de seis meses e ingresos por plataforma. Eliminar un movimiento no modifica la suscripción.
- Combos de plataformas con precio y mensaje de oferta para un destinatario elegido explícitamente.
- Plantillas de texto y categorías libres, creables también dentro del diálogo WhatsApp; opción de mensaje 100 % libre. La contraseña se hereda de la cuenta vinculada, sin copiarse al cliente.
- Configuración del negocio, medios de pago, tema claro/oscuro y respaldo/restauración JSON con validación.

### WhatsApp

Acepta móviles peruanos de 9 dígitos (por ejemplo `987654321`) o con prefijo `+51`, y números internacionales con código de país. Construye enlaces `https://wa.me/51987654321?text=...` usando codificación URL para preservar emojis, saltos de línea, tildes y caracteres especiales. El usuario confirma el envío en WhatsApp. El modo local no envía automáticamente. El modo servidor incorpora recordatorios mediante WhatsApp Cloud API; requiere credenciales y una plantilla aprobada.

Variables: `{nombre}`, `{telefono}`, `{usuario_whatsapp}`, `{correo}`, `{servicio}`, `{perfil}`, `{vence}`, `{pin}`, `{contrasena}`, `{negocio}` y `{pago}`. Los asteriscos y guiones bajos se conservan para el formato de WhatsApp. Puedes guardar una contraseña opcional en la cuenta madre; se carga al preparar un mensaje para un cliente vinculado y completa `{contrasena}`. El campo del mensaje se limpia al cerrar el diálogo; cambiarlo allí no modifica la cuenta madre. Al añadirla o cambiarla, se vuelve a completar la plantilla seleccionada.

### Datos y límites

En el modo local los datos se guardan en `localStorage` bajo `crm.workspace.v2`; en el modo privado Python se guardan en SQLite; en Cloudflare se guardan en D1. Los clientes de la versión inicial se leen y conservan en la primera actualización. El borrado de clientes no elimina movimientos financieros históricos. No se incluyen datos de las capturas ni registros de ejemplo en la aplicación.

El modo local de GitHub Pages no incluye autenticación ni sincronización. El modo servidor sí exige login y guarda los datos en SQLite; debe desplegarse con HTTPS según DEPLOYMENT.md. No incluye segundo factor, recuperación por correo ni cifrado del disco gestionado por la aplicación. Evita editar simultáneamente desde varias pestañas. Exporta respaldos regularmente. En el modo local, borrar los datos del navegador elimina los registros; en el modo servidor es necesario conservar y respaldar el disco persistente. El respaldo contiene datos personales, PIN de perfiles y contraseñas guardadas de cuentas madre; debe conservarse de forma privada. Importar reemplaza el conjunto actual tras confirmación y validación. No guardes contraseñas reales dentro de plantillas o notas.

## Verificación

Las pruebas de lógica no requieren instalar paquetes, solo Node.js:

```sh
node --test tests/crm.test.mjs
node --check app.js
```

La prueba funcional de navegador usa Playwright y Chromium, instalados como herramientas externas al proyecto. Con el servidor activo:

```sh
npm install --prefix /tmp/crm-browser-tools --cache /tmp/crm-npm-cache --no-package-lock --no-audit --no-fund playwright
NODE_PATH=/tmp/crm-browser-tools/node_modules node tests/browser.cjs
```

Por defecto busca Chromium en `/usr/bin/chromium` y el servidor en `http://127.0.0.1:8000/`. Puedes definir `CHROMIUM_PATH` y `CRM_TEST_URL` para otros entornos. Usa un perfil de navegador aislado y una fecha fija; no envía mensajes reales. Verifica inventario, ventas, enlaces de WhatsApp, contraseñas temporales, renovación, finanzas, combos, persistencia, plantillas, temas, respaldo/restauración y disposición móvil.

Las contraseñas de cuentas madre se guardan con los datos, sin cifrado adicional de la aplicación. En GitHub Pages permanecen en este navegador; en modo privado se guardan en la base de datos. No se muestran en tarjetas ni se incluyen en las tareas de integración o recordatorios automáticos.

## Marketing, redes y marca

Marketing permite listas dinámicas por búsqueda/servicio/estado/puntuación, un buyer persona descriptivo, pesos de puntuación configurables y campañas email/WhatsApp/RSS en borrador. Las campañas WhatsApp permiten preparar mensajes por contacto usando variables y confirmar el envío en WhatsApp. No se realizan envíos masivos automáticos.

Redes sociales incorpora borradores con fecha de planificación, registro manual de comentarios/DM/reseñas vinculados al contacto, resultados pendientes/respondidos/convertidos, métricas por red y agente y ficha 360 con pagos e interacciones. Las redes están desconectadas; no publica ni responde externamente. SEO, visitas web, enriquecimiento y anuncios requieren etapas posteriores. Consulta [ROADMAP.md](ROADMAP.md).

En Configuración puedes cambiar el nombre del CRM y cargar un logo PNG/JPG/WebP de hasta 100 KB; aplica al título, encabezado y menú. El logo queda en el respaldo. La PWA adapta su nombre/logo al navegador controlado por el service worker. Android permite instalar desde Chrome; iPhone desde Safari → Compartir → Añadir a pantalla de inicio. Requiere HTTPS en producción e Internet. No existe APK ni publicación en Google Play. El service worker no mantiene caché de datos privados; instalar la app no añade login ni sincronización al modo GitHub Pages.

Usuarios/permisos, embudo, auditoría y sincronización entre dispositivos quedan explícitamente pendientes, por solicitud del usuario.

Pruebas adicionales:

```sh
node --test tests/bulk.test.mjs tests/growth.test.mjs
CRM_TEST_URL=http://127.0.0.1:8000/ NODE_PATH=/tmp/crm-browser-tools/node_modules node tests/browser_crm_updates.cjs
CRM_TEST_URL=http://127.0.0.1:8000/ NODE_PATH=/tmp/crm-browser-tools/node_modules node tests/browser_growth.cjs
```

La importación de Excel utiliza ExcelJS 4.4.0 incluido localmente bajo licencia MIT; no depende de un CDN. Las fórmulas en XLSX no se evalúan y se rechazan; el CSV exportado neutraliza contenido interpretable como fórmula.

## Proveedores, compras y rentabilidad

En Finanzas → Proveedores puedes registrar contactos y mantener un catálogo de productos para revender (Netflix, Adobe, Spotify, etc.) y herramientas del negocio (hosting, CRM, Canva, GPT, etc.). Cada producto/servicio tiene coste en soles, periodo mensual/trimestral/semestral/anual o pago único y, para reventa, capacidad de perfiles. Permite editar y eliminar registros sin referencias; los proveedores/productos con cuentas o pagos vinculados se conservan para mantener la trazabilidad.

En Cuenta madre elige proveedor y producto: carga servicio, coste, periodo y capacidad. Puedes ajustar el coste real de esa cuenta; queda guardado como copia independiente. Cambiar el precio del catálogo no modifica cuentas ni pagos anteriores. Las cuentas antiguas sin coste conservan sus datos y muestran «Coste sin definir»; no se les inventa un coste cero.

Finanzas muestra el coste total, coste por perfil (dividido entre todos los perfiles disponibles), suma de precios de perfiles asignados y margen previsto de cada cuenta. Nuevo cliente muestra coste y margen de su perfil al asignar la cuenta. Compara costes y precios para el mismo periodo; no es una contabilidad de devengos ni un indicador de cobros confirmados. Los perfiles asignados vencidos siguen incluidos hasta liberarlos. No hay un precio de venta impuesto por el catálogo.

Ejemplo: cuenta de S/40 con 5 perfiles → S/8 por perfil. Vender un perfil a S/12 produce margen de S/4 para ese perfil; con solo ese perfil asignado el margen previsto de la cuenta es S/−28. Con los cinco a S/12, el margen previsto es S/20, antes de herramientas y otros gastos.

Registrar pago permite indicar fecha, importe, cuenta vinculada, concepto y referencia de comprobante. Usa el coste guardado de la cuenta vinculada. Crea un gasto real con identificadores de proveedor/producto/cuenta y categoría compra u operativo; aparece en los movimientos y en el total pagado al proveedor del mes. Una referencia no vacía es única por proveedor para evitar duplicar un pago: si divides un comprobante en varios gastos usa referencias distintas por partida. Sin referencia pueden registrarse pagos legítimos repetidos; no se ejecutan pagos bancarios.

Las herramientas muestran un presupuesto mensual equivalente (anual ÷12, por ejemplo) que incluye cada servicio registrado una vez y excluye pagos únicos. Es una previsión, no un gasto cobrado; solo Registrar pago modifica gastos/ganancia. No hay cobros recurrentes automáticos. Los datos y enlaces se incluyen en respaldos JSON y se conservan tanto en el modo local como en Python/Cloudflare.

## Antiguos clientes, historial y reventa

En Clientes → Estado aparecen «Antiguos / sin servicio vigente», «Archivados» y «Con servicio vigente». Los contactos vencidos o sin fecha se conservan y se incluyen en el primer grupo. Archivar libera la cuenta/perfil, conserva el contacto, registra una copia del servicio finalizado y desactiva sus recordatorios de renovación. La ficha 360 mantiene sus pagos e interacciones. Al archivar se vinculan al contacto los pagos antiguos reconocibles por nombre/servicio para conservarlos tras cambiar de producto.

Reactivar / nueva venta reutiliza el mismo contacto y conserva su historial. Permite asignar una cuenta y un nuevo vencimiento y registrar un nuevo cobro opcional; no duplica el contacto. Los segmentos de Marketing pueden filtrar antiguos, archivados o clientes con servicio vigente. Las reglas configurables tienen un selector de destinatarios para antiguos: usan días antes/después del vencimiento original y requieren autorización de marketing separada. El canal manual mantiene la confirmación en WhatsApp; los canales externos siguen sujetos a sus conexiones. Las reglas habituales y los recordatorios antiguos excluyen clientes archivados.

El respaldo JSON conserva el historial completo. El CSV/XLSX de contactos sigue siendo un listado de contactos, no un exportador del historial de compras. Eliminar definitivamente borra la ficha; Archivar es la opción para conservar la relación y realizar futuras campañas.

### Reportes Excel por correo

En **Configuración → Reportes Excel por correo** puedes descargar ahora la cartera completa (incluidos clientes archivados, historial de servicios y compras) y el estado financiero del mes hasta hoy. Los Excel incluyen precio de venta, coste por perfil cuando existe, vencimiento, ingresos/gastos efectivamente registrados y costes configurados separados de los gastos pagados. Los costes por perfil corresponden al ciclo contratado; no se comparan automáticamente ciclos distintos. No exportan campos de contraseña ni PIN. Las notas/descripciones son texto literal y deben revisarse si contienen información privada.

Activa las casillas para preparar clientes todos los viernes y finanzas el día 15 y el último día de cada mes, a las 09:00 en **America/Lima**, con hora configurable. La programación no depende de abrir el navegador. Requiere desplegar el backend privado: Cloudflare Cron cada hora o el proceso continuo `python -m backend.worker`. GitHub Pages solo permite descargas manuales; para los envíos importa primero tu respaldo al servidor, ya que no puede leer el almacenamiento de otro navegador.

Correo preparado con **Resend**, sin conexión ni envíos reales realizados. Crea una cuenta, verifica un dominio/remitente y configura privadamente `RESEND_API_KEY` y `REPORT_FROM_EMAIL` en el servidor. El destinatario es exclusivamente el correo propietario: `OWNER_EMAIL` en Cloudflare (provisionado desde `CRM_OWNER_EMAIL`) o el propietario de SQLite en Python. No guardes claves en el frontend, Git ni en el chat. Resend y Cloudflare tienen cuotas; un dominio puede tener coste. No se activan planes de pago automáticamente.

En Cloudflare aplica también el esquema actualizado `cloud/schema.sql` y despliega los recursos con `python3 cloud/build.py`; añade las variables en el Worker de producción (una clave añadida al entorno de desarrollo no configura ese Worker). Puedes introducir `RESEND_API_KEY` mediante `wrangler secret put RESEND_API_KEY` y `REPORT_FROM_EMAIL` como variable de producción en el panel. En Python añade ambas al entorno del proceso web y del trabajador y reinicia esos procesos; inicialización migra la tabla sin borrar datos.

`GET /api/report-status` requiere sesión privada y muestra conexión y últimos intentos. Cada tipo/fecha se reserva atómicamente para evitar duplicados. `accepted` significa aceptado por el proveedor, no entregado; `rejected`, `failed`, `processing` persistente o `uncertain` requieren revisión. No se reenvían automáticamente intentos inciertos ni se recuperan fechas anteriores si el servidor estuvo caído todo el día. Activar después de la hora genera el reporte en la siguiente revisión del mismo día. El financiero usa la fecha de los movimientos, excluye fechas futuras y no convierte ventas pendientes en cobradas.

Validación sin correos reales: `node --test tests/reports.test.mjs`, Python unittest discovery y `tests/browser_reports.cjs` con Playwright y un servidor estático interno. Prueban meses bisiestos, quincena/viernes coincidentes, Excel legibles y deduplicación.
