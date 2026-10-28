# Nexo CRM en WhatsApp Web y Android

La extensión presenta una interfaz compacta dentro de la misma página
de WhatsApp Web en Chrome de computadora. La APK abre el CRM privado en Android. Las ventas,
cuentas, perfiles, cobros, renovaciones, notas y configuración usan la misma base
del negocio; no se mantiene una copia independiente del inventario en cada app.

## Direcciones de esta publicación

- CRM principal: https://nexo-crm.acxelcubaaraoz.workers.dev
- Panel de instancias: https://nexo-retail-panel.acxelcubaaraoz.workers.dev
- Propietario autorizado: `gabostreaming0@gmail.com`.
- Equipo Access: `green-waterfall-3b33.cloudflareaccess.com`.

Los dos Workers, sus bases independientes, sus programaciones y las aplicaciones
Access se publicaron el 24 de octubre de 2026. El propietario confirmó su acceso
por correo y creó la instancia PRUEBA. Se verificaron su estado activo, su base
independiente y la política de acceso exclusiva de su correo. El secreto
`RETAIL_PROVISION_TOKEN` está configurado en el Worker de producción y permitió
esa creación real; nunca se incorpora ese token a la APK,
a la extensión ni a los archivos públicos.

El 28 de octubre de 2026 el CRM principal pasó a correo y contraseña, con sesiones
propias. La web muestra su formulario directamente y la extensión puede entrar
desde WhatsApp sin una pestaña auxiliar del CRM. El propietario elige la contraseña
mediante un enlace privado de activación de un solo uso. El panel de instancias y
las copias existentes conservan su acceso anterior hasta migrarlas por separado.

## Instalar la extensión

1. Descarga la [extensión integrada 1.3.0](https://drive.google.com/file/d/1urtxPhfjs5mWTL0yvKUdqGQ2QPYo5BRP/view)
   y descomprímela en una carpeta que conservarás.
2. Abre `chrome://extensions`, activa **Modo de desarrollador**, pulsa
   **Cargar descomprimida** y selecciona la carpeta que contiene `manifest.json`.
3. Crea tu contraseña una vez mediante el enlace privado de activación recibido.
   El CRM principal ya está configurado en la extensión.
4. Abre o recarga WhatsApp Web e inicia sesión con tu correo y contraseña dentro
   de Nexo. La web usa las mismas credenciales; puedes cerrarla mientras trabajas.
5. Pulsa el botón Nexo o el icono de la extensión para mostrar u ocultar el panel.
   **Usar otro CRM** permite configurar otra instancia cuando la necesites.

Si ya instalaste una versión anterior, reemplaza los archivos en la misma carpeta,
pulsa **Recargar** en la tarjeta de Nexo en `chrome://extensions` y recarga
WhatsApp Web. Así conservas la dirección del CRM configurada.
Conserva una sola instalación de Nexo activa para que no compitan varios paneles.

El ZIP sirve para instalación local. Esta entrega no es una publicación en
Chrome Web Store. La sesión con contraseña caduca a las ocho horas y requiere
volver a escribir tus credenciales. Cambiar la contraseña revoca todas las sesiones.
Si cambias de CRM en las opciones, recarga el panel: las solicitudes de un panel
anterior se rechazan para evitar mezclar datos entre negocios. Cada panel
integrado trabaja con el chat de su propia pestaña de WhatsApp. Al ocultarlo se
detiene la captura periódica, que requiere activación de nuevo al regresar.
Los precios sin indicar quedan vacíos en formularios y exportaciones; no se
consideran una venta gratuita ni se calculan márgenes completos con esos datos.

## Trabajar sin salir de WhatsApp Web

- **Chat actual** muestra automáticamente las fichas del teléfono identificado
  en WhatsApp. Al cambiar de conversación se descarta la selección anterior.
  Si WhatsApp no lo detecta, pulsa **Vincular contacto existente**, busca por
  nombre o número y confirma la ficha correcta. Esto abre sus servicios sin crear
  un cliente ni modificar su teléfono. Los vínculos estables se recuerdan en este
  navegador para ese CRM; si WhatsApp no ofrece una identidad estable, duran solo
  mientras permanezcas en la conversación. Puedes cambiarlos o quitarlos sin
  borrar al cliente. El nombre por sí solo no identifica al cliente.
- **Clientes** busca por nombre, teléfono o servicio. Cada contacto reúne sus
  servicios; puedes editar sus datos y añadir otro servicio sin duplicar los anteriores.
- Cada servicio tiene **Renovar**, **Mensaje** y un menú para editarlo,
  archivarlo o eliminarlo. Archivar libera su perfil y conserva su historial.
- **Cuentas** contiene sus perfiles libres y ocupados. Desde allí puedes crear
  o editar cuentas y confirmar una nueva capacidad. Los perfiles ocupados no
  desaparecen al vencer un servicio; requieren liberarlo o eliminar su ficha.
- Los precios son opcionales. Marca **Registrar como cobrado** únicamente si
  recibiste el pago; guardar o renovar sin marcarlo no crea un movimiento.
- **Mensaje** abre el editor y las plantillas dentro de la ficha.
  **Preparar en WhatsApp** inserta un borrador en el chat verificado. Revisa y
  pulsa Enviar en WhatsApp. Si había otro borrador o cambió el editor, el texto se
  copia y se indica que debes pegarlo manualmente; el borrador existente se conserva.
- **Renovar** propone una nueva fecha según la regla existente de 30 días desde
  el vencimiento vigente o desde hoy. Puedes corregirla antes de confirmar el pago
  y la renovación. La confirmación identifica el producto, perfil y fecha actual;
  renovar una ficha conserva las fechas y cobros de los demás productos y perfiles,
  así como el vencimiento de la cuenta madre. La suscripción del proveedor externo
  no se modifica automáticamente.
- **Abrir CRM** abre la web para finanzas, proveedores, reportes, automatización
  y otras tareas extensas. Ambas interfaces usan la misma base y sus revisiones.

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

1. Descarga la [APK de pruebas](https://drive.google.com/file/d/1_5whYdX4tINDmxxAmngtaXmc38_AH5yn/view)
   e instálala en Android 8 o posterior.
   Autoriza esa fuente de instalación cuando Android lo solicite.
2. Abre Nexo e introduce la dirección HTTPS del CRM principal o de tu instancia.
3. En el CRM principal entra con correo y contraseña. Las otras instancias que
   siguen usando Access solicitan el código por correo y su equipo autorizado.
4. Comprueba clientes, cuentas, pagos,
   renovaciones, importación, exportación y persistencia después de cerrar la app.

La APK requiere Internet. Abre WhatsApp como aplicación externa para revisar y
confirmar mensajes; no lee los chats de WhatsApp Android. Sí puede consultar los
registros de conversaciones guardados en el CRM desde la extensión. Está firmada
para pruebas e instalación directa y no está publicada en Google Play. Conserva
privadamente la clave de firma para que futuras APK puedan actualizarla.

## Datos anteriores y verificación

La hoja autorizada ya se importó al CRM principal; no vuelvas a importar sus mismas
filas. Las cuentas madre incompletas quedan pendientes de verificar antes de
habilitarlas como inventario. Para otros datos anteriores, revisa primero un
respaldo JSON y sus duplicados desde la web del CRM. Las nuevas instancias de
clientes comienzan vacías y tienen sus propios recursos y propietario.

Se ejecutaron pruebas de lógica, autenticación, CSRF, aislamiento, asignaciones,
venta, renovación, borradores y conversaciones con datos ficticios. El navegador
administrado de compilación bloquea instalar extensiones de terceros y no hay
dispositivo/emulador Android disponible: el ingreso con Access, la instalación real
y la compatibilidad con tu sesión de WhatsApp deben comprobarse en tus dispositivos.

Código y compilación: [extension/README.md](extension/README.md),
[android/README.md](android/README.md) y
[cloud/CONNECTOR_DEPLOY.md](cloud/CONNECTOR_DEPLOY.md).
