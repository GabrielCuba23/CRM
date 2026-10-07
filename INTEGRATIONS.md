# Reglas, WhatsApp manual y herramientas externas

Puedes crear, duplicar, editar y activar reglas independientes; no hay una lista fija de tres mensajes. Cada regla elige una plantilla de cualquier contexto, plataformas opcionales, días antes del vencimiento (negativos para días posteriores), hora de Lima y canal. Las reglas nuevas y duplicadas se guardan desactivadas. Las cuotas del plan Free, el documento de 1 MB y el máximo de registros del formato siguen aplicándose: no se promete envío ilimitado ni almacenamiento infinito.

## Envíos personalizados por wa.me

1. En **Mensajes**, crea cualquier plantilla con texto, emojis y variables.
2. Puedes enviarla desde un cliente, o crear una regla en **Automatización** con el canal **WhatsApp con mi confirmación**.
3. Para tareas programadas, marca la autorización de recordatorios del cliente. Activa la regla cuando quieras preparar pendientes.
4. En la bandeja, pulsa **Revisar y abrir WhatsApp**. Puedes editar el texto antes de abrir la conversación.
5. Confirma el envío dentro de WhatsApp. Después pulsa **Ya envié el mensaje: confirmar** en el CRM. Abrir el enlace no completa la tarea.

La confirmación persiste y evita preparar nuevamente la misma regla para el mismo cliente y vencimiento. Una renovación genera otra tarea. La bandeja recupera tareas de hasta siete días de antigüedad; servicios sin fecha, sin autorización, con teléfono inválido o con una regla desactivada no generan pendientes. No se programan plantillas que incluyen `{contrasena}`. Los mensajes manuales pueden cargar la contraseña guardada de la cuenta madre; las tareas programadas e integraciones no incluyen ese campo.

En GitHub Pages se prepara la bandeja al abrir la web y se guarda en ese navegador. Cloudflare conserva los datos centralizados y prepara la cola mediante un cron horario aunque nadie visite la web. Exporta un respaldo antes de cambiar de modo; en la versión privada puedes importar tu respaldo JSON o usar la migración local disponible en Configuración.

## Zapier, Make o n8n — conexión opcional

**La implementación queda preparada y desconectada.** No hay llamadas salientes a Zapier ni conexión a WhatsApp Web ni pulsaciones automáticas del navegador. La herramienta externa recoge las tareas mediante HTTPS y puede crear una notificación para ti con el enlace, o usar un proveedor oficial de WhatsApp para enviar. `wa.me` por sí solo no proporciona envío automático. Los servicios externos pueden tener coste.

### Credenciales y protección

1. Publica la versión privada según [FREE_DEPLOYMENT.md](FREE_DEPLOYMENT.md).
2. Genera un token aleatorio de al menos 32 caracteres con un gestor de contraseñas. Instálalo como secreto **INTEGRATION_API_TOKEN** en Cloudflare → Workers → nexo-crm → Settings → Variables and Secrets. No se almacena en respaldos, plantillas ni notas. No lo pegues en el chat.
3. Cloudflare Access protege también las rutas de integración. En Zero Trust → Access → Service credentials → Service tokens, crea un token de servicio para tu herramienta. Guarda allí su Client ID y Client Secret.
4. En la aplicación **Nexo CRM privado**, conserva la política del correo propietario. Añade una política **Service Auth**, que incluya exclusivamente ese token de servicio. No cambies la política del dueño por una de acceso público ni uses una regla «Everyone».
5. Configura en la herramienta estas cabeceras para cada petición:

| Cabecera | Valor privado |
| --- | --- |
| Authorization | `Bearer <INTEGRATION_API_TOKEN>` |
| CF-Access-Client-Id | Client ID del token de servicio |
| CF-Access-Client-Secret | Client Secret del token de servicio |
| Content-Type | `application/json` |

La credencial de integración solo permite reservar y confirmar tareas. No permite consultar o modificar clientes, cuentas, configuraciones ni la página del CRM. El token de servicio de Access tampoco sustituye la sesión del propietario para esas rutas. Cambiar el secreto del Worker revoca futuras llamadas de la herramienta. Nunca pongas credenciales en la URL.

### Flujo externo

Crea una regla con canal **Zapier / Make / n8n**, déjala preparada o actívala cuando conectes el flujo. Cada hora el Worker genera como máximo 10 tareas nuevas entre todos los canales para respetar el presupuesto de solicitudes del plan Free. El cron recupera las pendientes de los últimos siete días.

En Zapier, usa **Schedule → Webhooks by Zapier (Custom Request)**; en Make un programador y el módulo HTTP; en n8n un Schedule Trigger y HTTP Request. Algunas funciones pueden requerir planes de pago. Llama cada hora a:

```http
POST https://TU-WORKER.workers.dev/api/integration/claim
Content-Type: application/json
Authorization: Bearer <TOKEN>
CF-Access-Client-Id: <CLIENT-ID>
CF-Access-Client-Secret: <CLIENT-SECRET>

{"limit":10}
```

La respuesta contiene `tasks`, de cero a diez elementos. Usa un bucle externo para procesar cada uno:

```json
{
  "tasks": [{
    "id": "identificador opaco",
    "claimToken": "clave privada de reserva",
    "ruleName": "Aviso tres días antes",
    "clientName": "Cliente",
    "phone": "51987654321",
    "text": "Hola Cliente, tu servicio vence...",
    "whatsappUrl": "https://wa.me/51987654321?text=...",
    "dueDate": "2026-10-06",
    "delivery": "integration"
  }]
}
```

Antes de reservar se vuelve a verificar la regla, la fecha, el teléfono, el texto y la autorización. Los cambios anteriores a la reserva cancelan la tarea vieja; el siguiente ciclo prepara la actual si corresponde. Una tarea ya reservada puede estar en ejecución fuera del CRM: revisa la herramienta antes de modificar o revocar un envío en curso.

Para un proveedor oficial, respeta sus restricciones sobre plantillas aprobadas y ventanas de conversación. Usa `id` como clave de idempotencia si el proveedor la admite. Para un enlace manual, no marques la tarea completada por haber generado una notificación: espera la confirmación real del usuario en tu flujo.

Después de un resultado conocido llama, con las mismas cabeceras:

```http
POST https://TU-WORKER.workers.dev/api/integration/ack

{"id":"identificador de la tarea","claimToken":"clave de reserva","status":"completed","providerId":"opcional"}
```

Estados admitidos: `completed`, `failed` y `uncertain`. El historial indica «completada según la herramienta», no garantiza entrega a WhatsApp. Repetir la misma confirmación es seguro. Una confirmación con clave incorrecta se rechaza. Si hubo un timeout o no sabes si se envió, usa `uncertain` y revisa; nunca reenvíes ciegamente.

Las reservas no caducan ni se reasignan automáticamente: esto evita duplicados cuando una respuesta se pierde, pero exige revisión manual de tareas atascadas. Conserva los identificadores y claves de reserva de forma privada en tu herramienta. En **Integraciones** puedes consultar hasta 200 resultados recientes. El cron no elimina el historial. La recuperación/reasignación después de un envío incierto no está implementada.

## Meta directa, preparada sin conectar

Cada regla de canal **API oficial de Meta** admite su propio nombre aprobado, idioma y orden de variables. El mensaje real usa esa plantilla aprobada; la vista previa de texto libre se usa para wa.me y herramientas externas. Sin credenciales del Worker no se envía nada, aunque hayas dejado una regla configurada.

El cron atiende hasta tres tareas de reglas Meta por ejecución. El recordatorio antiguo de tres días sigue como opción de compatibilidad y atiende hasta cinco clientes por hora; evita activarlo junto con una regla equivalente, porque son automatizaciones independientes. Ambos están desactivados inicialmente. Solo los límites HTTP 429 se reintentan; resultados inciertos no se reenvían. Se requiere consentimiento y pueden existir tarifas de Meta.
