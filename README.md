# Nexo · Gestor Streaming

Gestor de clientes y suscripciones con interfaz adaptable a móvil, inspirado en las referencias proporcionadas. La interfaz usa HTML, CSS y JavaScript; el modo privado añade un backend Python con Flask, Gunicorn y SQLite.

## Opción privada en plan gratuito

La nueva alternativa Cloudflare Workers + D1 + Access evita contratar un VPS. Incluye acceso exclusivo por correo, almacenamiento centralizado y cron horario. El despliegue completo está automatizado en `cloud/deploy.py`; consulta [FREE_DEPLOYMENT.md](FREE_DEPLOYMENT.md) para conectar tu propia cuenta Free. Está preparado y probado localmente, pero pendiente de autorización para publicarlo. Los envíos automáticos de Meta pueden tener coste.

## Acceso privado y automatización

Se añadió un servidor con login de administrador, SQLite y un trabajador de recordatorios automáticos a tres días del vencimiento. Consulta [DEPLOYMENT.md](DEPLOYMENT.md) para activarlo con HTTPS, almacenamiento persistente y la API oficial de WhatsApp. GitHub Pages mantiene el modo local; no puede ejecutar estas funciones del servidor.

La biblioteca ahora permite crear, duplicar, buscar y organizar mensajes por cualquier contexto, con vista previa. Los mensajes manuales no están limitados a los tres ejemplos iniciales. La automatización usa una plantilla aprobada por Meta, configurada por nombre, idioma, hora y variables; está desactivada por defecto.

## Ejecutar el modo local

Con Python 3, desde la raíz del repositorio:

```sh
python3 -m http.server 8000 --bind 0.0.0.0
```

Abre la dirección del servidor en el navegador. Los módulos JavaScript requieren servir los archivos por HTTP; no abrir `index.html` directamente con `file://`. En un despliegue público usa HTTPS.

## Funciones

- Inicio con indicadores, venta rápida y suscripciones que requieren atención.
- Clientes: alta, edición, eliminación, búsqueda y filtros por estado y cuenta madre.
- Cuentas madre: plataforma, correo, proveedor, vencimiento y capacidad de 1 a 50 perfiles. Al cambiar el acceso de una cuenta, se actualiza en sus clientes vinculados.
- Perfiles disponibles: asignación del siguiente perfil libre, evitando asignaciones duplicadas. Una suscripción vencida sigue ocupando su perfil hasta liberarla o eliminarla. Las cuentas madre vencidas no admiten nuevas asignaciones.
- Renovaciones: actualización de fecha, cobro opcional y preparación de recordatorios.
- Finanzas en soles: ventas marcadas como cobradas, renovaciones cobradas, gastos, filtro mensual, ganancia, tendencia de seis meses e ingresos por plataforma. Eliminar un movimiento no modifica la suscripción.
- Combos de plataformas con precio y mensaje de oferta para un destinatario elegido explícitamente.
- Plantillas configurables de entrega, recordatorio y acceso con contraseña; texto editable antes de abrir WhatsApp.
- Configuración del negocio, medios de pago, tema claro/oscuro y respaldo/restauración JSON con validación.

### WhatsApp

Acepta móviles peruanos de 9 dígitos (por ejemplo `987654321`) o con prefijo `+51`, y números internacionales con código de país. Construye enlaces `https://wa.me/51987654321?text=...` usando codificación URL para preservar emojis, saltos de línea, tildes y caracteres especiales. El usuario confirma el envío en WhatsApp. El modo local no envía automáticamente. El modo servidor incorpora recordatorios mediante WhatsApp Cloud API; requiere credenciales y una plantilla aprobada.

Variables: `{nombre}`, `{telefono}`, `{correo}`, `{servicio}`, `{perfil}`, `{vence}`, `{pin}`, `{contrasena}`, `{negocio}` y `{pago}`. Los asteriscos y guiones bajos se conservan para el formato de WhatsApp. La contraseña se introduce solo al preparar el mensaje y se limpia al cerrar el diálogo; no se guarda en los registros del CRM. Al añadirla o cambiarla, se vuelve a completar la plantilla seleccionada.

### Datos y límites

En el modo local los datos se guardan en `localStorage` bajo `crm.workspace.v2`; en el modo privado Python se guardan en SQLite; en Cloudflare se guardan en D1. Los clientes de la versión inicial se leen y conservan en la primera actualización. El borrado de clientes no elimina movimientos financieros históricos. No se incluyen datos de las capturas ni registros de ejemplo en la aplicación.

El modo local de GitHub Pages no incluye autenticación ni sincronización. El modo servidor sí exige login y guarda los datos en SQLite; debe desplegarse con HTTPS según DEPLOYMENT.md. No incluye segundo factor, recuperación por correo ni cifrado del disco gestionado por la aplicación. Evita editar simultáneamente desde varias pestañas. Exporta respaldos regularmente. En el modo local, borrar los datos del navegador elimina los registros; en el modo servidor es necesario conservar y respaldar el disco persistente. El respaldo contiene datos personales y PIN de perfiles; debe conservarse de forma privada. Importar reemplaza el conjunto actual tras confirmación y validación. No guardes contraseñas reales dentro de plantillas o notas.

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
