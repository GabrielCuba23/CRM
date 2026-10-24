# Nexo CRM en WhatsApp Web y Android

La extensión reutiliza la aplicación completa del CRM en un panel lateral de
Chrome de computadora. La APK abre el mismo CRM privado en Android. Las ventas,
cuentas, perfiles, cobros, renovaciones, notas y configuración usan la misma base
del negocio; no se mantiene una copia independiente del inventario en cada app.

## Direcciones de esta publicación

- CRM principal: https://nexo-crm.acxelcubaaraoz.workers.dev
- Panel de instancias: https://nexo-retail-panel.acxelcubaaraoz.workers.dev
- Propietario autorizado: `gabostreaming0@gmail.com`.
- Equipo Access: `green-waterfall-3b33.cloudflareaccess.com`.

Los dos Workers, sus bases independientes, sus programaciones y las aplicaciones
Access se publicaron el 24 de octubre de 2026. El acceso por correo del propietario
y el funcionamiento en sus dispositivos requieren la comprobación del usuario.
La creación de copias desde el panel necesita además `RETAIL_PROVISION_TOKEN`
como secreto del Worker de producción; nunca se incorpora ese token a la APK,
a la extensión ni a los archivos públicos.

## Instalar la extensión

1. Descomprime `nexo-crm-chrome.zip` en una carpeta que conservarás.
2. Abre `chrome://extensions`, activa **Modo de desarrollador**, pulsa
   **Cargar descomprimida** y selecciona la carpeta que contiene `manifest.json`.
3. En las opciones de Nexo, introduce la dirección HTTPS del CRM y autoriza
   exclusivamente ese dominio. Pulsa **Guardar y abrir sesión**.
4. Inicia sesión con el código enviado al correo propietario. Deja abierta la
   pestaña de conexión `/companion`; puede permanecer en segundo plano.
5. Abre o recarga WhatsApp Web y pulsa el icono de Nexo para abrir su panel lateral.

El ZIP sirve para instalación local. Esta entrega no es una publicación en
Chrome Web Store. Una sesión de Access vencida requiere volver a identificarse.
Si cambias de CRM en las opciones, recarga el panel: las solicitudes de un panel
anterior se rechazan para evitar mezclar datos entre negocios.

## Trabajar sin salir de WhatsApp Web

- Usa el menú del panel para todas las secciones existentes del CRM, incluyendo
  cuentas, perfiles libres, clientes, finanzas, plantillas, proveedores y reportes.
- En **Tu conversación de WhatsApp**, revisa el teléfono internacional y pulsa
  **Vincular este chat**. Si WhatsApp oculta el número, debes escribirlo y confirmar
  la vinculación. El nombre visible por sí solo no identifica al cliente.
- Para un cliente nuevo, pulsa **Nuevo cliente / venta**, revisa los datos,
  selecciona una cuenta y un perfil, fecha e importe, y guarda. El cobro solo se
  registra si marcas la opción correspondiente.
- Selecciona la ficha o servicio correcto cuando un teléfono tenga varias fichas.
- **Preparar respuesta / entrega** abre las plantillas con los datos asignados.
  **Preparar en WhatsApp Web** inserta un borrador en el chat verificado. Revisa y
  pulsa Enviar en WhatsApp. Si había otro borrador o cambió el editor, el texto se
  copia y se indica que debes pegarlo manualmente; el borrador existente se conserva.
- **Renovar** propone una nueva fecha según la regla existente de 30 días desde
  el vencimiento vigente o desde hoy. Puedes corregirla antes de confirmar el pago
  y la renovación. La suscripción del proveedor externo no se modifica automáticamente.

Los cambios confirmados se guardan en el servidor. Una revisión antigua se rechaza
para no sobrescribir operaciones de otra sesión; guarda o cierra los formularios
y pulsa **Recargar datos del CRM** cuando corresponda. La asignación de un perfil
se confirma al guardar la venta, no al abrir el selector de disponibilidad.

## Conversaciones

**Guardar textos visibles** registra los textos cargados y visibles del chat
individual vinculado. El interruptor de registro periódico requiere confirmación
y se detiene al cambiar de chat o de ficha. Se comprueba nuevamente el destinatario
antes de leer o preparar un mensaje, y las capturas repetidas no se duplican.

No se descarga el historial completo ni archivos, audios o conversaciones ocultas.
Los registros indican su origen y, cuando no hay una hora fiable, la hora de captura.
Observar un mensaje saliente no acredita su entrega al destinatario. La integración
usa la interfaz visible de WhatsApp Web; sus cambios pueden exigir actualizar el
adaptador. Los envíos permanentes desde el servidor requieren otra integración.

El historial comparte el límite del formato actual del CRM. Exporta respaldos
privados y planifica ampliar el almacenamiento antes de acumular un historial
grande. Un error de almacenamiento detiene la captura; no se anuncia como guardada.

## Instalar Android

1. Descarga `nexo-crm-android-testing.apk` e instálala en Android 8 o posterior.
   Autoriza esa fuente de instalación cuando Android lo solicite.
2. Abre Nexo e introduce la dirección HTTPS del CRM principal o de tu instancia.
3. Cuando solicite autorización del equipo Access, comprueba su dominio exacto;
   para esta publicación es `green-waterfall-3b33.cloudflareaccess.com`.
4. Inicia sesión con el código por correo y comprueba clientes, cuentas, pagos,
   renovaciones, importación, exportación y persistencia después de cerrar la app.

La APK requiere Internet. Abre WhatsApp como aplicación externa para revisar y
confirmar mensajes; no lee los chats de WhatsApp Android. Sí puede consultar los
registros de conversaciones guardados en el CRM desde la extensión. Está firmada
para pruebas e instalación directa y no está publicada en Google Play. Conserva
privadamente la clave de firma para que futuras APK puedan actualizarla.

## Datos anteriores y verificación

El CRM principal se desplegó vacío: publicar una URL no mueve los datos que estaban
en el navegador de GitHub Pages. Si ya tienes datos, exporta un respaldo JSON del
CRM anterior e impórtalo desde Configuración en el CRM privado; comprueba clientes,
cuentas, perfiles y movimientos antes de operar. Las nuevas instancias de clientes
también comienzan vacías y tienen sus propios recursos y propietario.

Se ejecutaron pruebas de lógica, autenticación, CSRF, aislamiento, asignaciones,
venta, renovación, borradores y conversaciones con datos ficticios. El navegador
administrado de compilación bloquea instalar extensiones de terceros y no hay
dispositivo/emulador Android disponible: el ingreso con Access, la instalación real
y la compatibilidad con tu sesión de WhatsApp deben comprobarse en tus dispositivos.

Código y compilación: [extension/README.md](extension/README.md),
[android/README.md](android/README.md) y
[cloud/CONNECTOR_DEPLOY.md](cloud/CONNECTOR_DEPLOY.md).
