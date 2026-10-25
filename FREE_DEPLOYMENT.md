# Publicación privada con plan gratuito

Esta alternativa usa Cloudflare Workers (servidor), D1 (base de datos), Access (inicio de sesión por código enviado a tu correo) y Cron Triggers (recordatorios sin abrir el navegador). No necesitas contratar un VPS ni comprar un dominio: usa una dirección `workers.dev`. GitHub Pages conserva el modo local; la versión privada se publica en otra dirección.

## Estado

El CRM principal y el panel de instancias ya están publicados con Cloudflare Access. El propietario confirmó el ingreso por correo y creó una instancia desde el panel. Las direcciones y las instrucciones actuales de la extensión y Android están en [COMPANIONS.md](COMPANIONS.md).

Quedan por comprobar la versión actual de la extensión en la sesión real de WhatsApp del propietario, la APK en un teléfono Android y las pruebas reales de aislamiento y suspensión antes de vender instancias. Las pruebas automatizadas de WhatsApp usan datos y documentos controlados; no se enviaron mensajes reales durante ellas. La APK está firmada para pruebas y no está publicada en Google Play.

## Único requisito previo de la cuenta

Para un despliegue nuevo, crea tu cuenta en https://dash.cloudflare.com/ y activa Zero Trust eligiendo **Free**. La publicación actual ya tiene esos requisitos configurados. La cuenta y la aceptación de las condiciones deben ser tuyas. Si el proveedor pide información de facturación, comprueba el plan antes de aceptarlo; el script no contrata ni activa planes de pago.

En los ajustes seguros del entorno configura:

- `CLOUDFLARE_ACCOUNT_ID`: identificador de tu cuenta.
- `CRM_OWNER_EMAIL`: tu correo, el único que podrá ingresar.
- `CLOUDFLARE_API_TOKEN`: token privado limitado a esa cuenta, con permisos de edición para Workers Scripts, D1, Access Apps and Policies, Access Identity Providers y lectura de Access Organizations. Usa los nombres equivalentes que muestre Cloudflare. No lo envíes por chat ni lo subas a GitHub.

Una vez conectada la cuenta, el agente puede ejecutar el despliegue inicial completo:

```sh
npm install --prefix /tmp/crm-cloud-tools --cache /tmp/crm-npm-cache --no-package-lock --no-audit --no-fund wrangler@4.148.0
python3 cloud/deploy.py
```

Para actualizar una publicación existente, conserva sus identificadores y bindings; no repitas el despliegue inicial para crear otra copia. La ruta utilizada con la conexión autorizada está documentada en [cloud/CONNECTOR_DEPLOY.md](cloud/CONNECTOR_DEPLOY.md).

Tras completar la publicación conserva un archivo local ignorado `cloud/wrangler.generated.json` sin secretos, para futuras operaciones de Wrangler. El script reutiliza la base `nexo-crm`, aplica un esquema que no borra datos, genera los archivos de la interfaz y publica primero el Worker bloqueado. Crea una aplicación de Access con una política exclusiva para el correo del dueño y vuelve a publicar con su identificador. No imprime el token. Si falla a mitad, no abre el CRM al público. Conserva el nombre `nexo-crm` exclusivamente para este proyecto. Una aplicación de Access existente con otro nombre no se sobrescribe.

Después de publicar hay que comprobar en la dirección real que el dueño entra, que otro correo queda bloqueado y que los datos persisten. La validación local no sustituye esta comprobación de Access y su correo.

## WhatsApp y coste

Los mensajes manuales personalizados por `wa.me` no requieren API: eliges cualquier plantilla y confirmas el envío en WhatsApp. Puedes crear todos los contextos y mensajes que necesites.

Enviar sin pulsar nada requiere la API oficial de Meta, consentimiento del cliente y una plantilla aprobada. La aplicación WhatsApp Business que tienes no proporciona esas credenciales por sí sola. Meta puede cobrar por los recordatorios; **el envío automático no se promete gratuito**. Las plantillas manuales admiten texto libre; las automáticas deben respetar la plantilla aprobada.

Cuando tengas esa integración, instala de forma privada en el Worker `WHATSAPP_ACCESS_TOKEN` y `WHATSAPP_PHONE_NUMBER_ID` mediante `wrangler secret put` con el archivo de configuración de tu despliegue, o en Cloudflare → Workers → nexo-crm → Settings → Variables and Secrets. Un secreto del entorno de desarrollo no se copia automáticamente a producción. Después configura nombre e idioma de la plantilla, variables y hora en el CRM; marca la autorización de cada cliente y activa los recordatorios.

El recordatorio antiguo se ejecuta cada hora, después de la hora elegida en Lima. Busca servicios que vencen exactamente en tres días y procesa hasta cinco clientes por ejecución. Las reglas configurables y la integración externa tienen su propia cola: consulta [INTEGRATIONS.md](INTEGRATIONS.md). Los restantes se procesan en horas posteriores de ese mismo día; no se recuperan automáticamente días omitidos. Un envío aceptado no demuestra entrega. Una respuesta ambigua se conserva para revisión, sin volver a enviar automáticamente. Solo se reintentan límites HTTP 429. No se incluyen webhooks de entrega.

## Límites y crecimiento

Los límites publicados del plan Free de Workers son 100 000 solicitudes al día y 10 ms de CPU por ejecución. D1 incluye 5 millones de filas leídas al día, 100 000 escritas al día y 5 GB de almacenamiento total, además de límites por base. Access debe mantenerse en Free. Revisa las cuotas actuales de tu cuenta: no son recursos ilimitados ni garantizan disponibilidad comercial.

Este formato inicial guarda el conjunto de datos como un documento de hasta 1 MB y admite hasta 10 000 registros por colección dentro de ese tamaño. Sirve como punto de partida para uso personal; para superar ese volumen habría que separar clientes, cuentas y movimientos en tablas, paginar consultas y ampliar el procesamiento del cron. La infraestructura puede crecer, pero esta versión no se anuncia como una base de datos ilimitada. Exporta respaldos privados regularmente.

Fuentes oficiales: [Workers](https://developers.cloudflare.com/workers/platform/pricing/), [D1](https://developers.cloudflare.com/d1/platform/pricing/), [Access en Workers](https://developers.cloudflare.com/workers/configuration/cloudflare-access/), [workers.dev](https://developers.cloudflare.com/workers/configuration/routing/workers-dev/).

## Verificación de desarrollo

```sh
python3 cloud/build.py
node --test tests/cloud.test.mjs tests/automation.test.mjs
python3 -m unittest discover -s tests -p 'test_cloud_deploy.py'
```

Las pruebas usan D1 local real en Miniflare, JWT firmados de prueba y respuestas simuladas de Meta. Comprueban autenticación, persistencia, conflictos de revisión, CSRF, tres días de anticipación, consentimiento, concurrencia y duplicados. No requieren credenciales reales.

La conexión de Cloudflare en ChatGPT no garantiza que este chat exponga herramientas para desplegar. Si no aparecen esas herramientas ni hay credenciales inyectadas, se usa el token limitado de los ajustes seguros.
