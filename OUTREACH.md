# Campañas y revisión de Nexo · 1.5.0

Estado: código implementado y probado localmente. **La publicación del servidor
está pendiente de restablecer la autorización del conector Cloudflare.** El ZIP
de esta versión depende de esa publicación para guardar campañas y adjuntos.
No sustituir el paquete instalado hasta terminar ese paso.

## Funciones implementadas

La barra mantiene Chat actual, Clientes y Cuentas, y añade Campañas. Los perfiles
permanecen dentro de Cuentas. Renovar, editar y eliminar siguen identificando cada
servicio por su ID; las campañas no modifican sus vencimientos ni sus cobros.
La web ofrece el mismo editor en Marketing y conserva los datos existentes.

| Referencia de las imágenes | Nexo 1.5.0 |
| --- | --- |
| Lista de destinatarios y código de país | Lista manual, contactos del CRM y lista de contactos guardada; +51 por defecto, teléfonos normalizados y deduplicados |
| Subir Excel | CSV y XLSX con una hoja de datos, selección de columnas, vista previa de válidos, duplicados y errores, columnas personalizadas |
| Adjuntar foto o video | JPEG, PNG, WebP, GIF, MP4 y WebM, biblioteca privada y vista previa, máximo 10 archivos y 20 MiB en total por mensaje |
| Mensaje editable | Texto, formato de WhatsApp, emojis, plantillas y variables como nombre, teléfono y columnas importadas |
| Mensajes masivos | Cola con inicio confirmado, selección y verificación del destinatario, pausa, cancelación y continuación explícita |
| Retrasos y lotes | Segundos entre mensajes, tamaño del lote y pausa entre lotes configurables |
| Programación | Fecha y hora local; requiere mantener la extensión y WhatsApp abiertos y activos |
| Exportar contactos | Lectura de la lista cargada en WhatsApp, Archivados abierto o participantes de un grupo abierto; CSV y XLSX |
| Informes | Resultado por destinatario, intentos, error, fecha y evidencia; exportación CSV y XLSX |
| Mensaje individual con archivos | Foto / video en el editor de la ficha abre una campaña de un destinatario con su texto precargado |

Exportar no descarga una libreta privada completa. WhatsApp virtualiza sus listas
y puede ocultar teléfonos. La lectura ampliada recorre la lista cargada hasta 500
filas o 30 segundos y puede abrir fichas visibles para obtener sus números. Si
hay un borrador, no se navega por fichas para completarlos. Los registros que
solo tienen nombre se conservan incompletos y no pueden enviarse hasta completar
un teléfono. La fuente Archivados exige reconocer su vista; un acceso directo
«Archivados» en la lista principal no basta. Los grupos sirven como fuente de
contactos, no como destinatarios de la cola individual.

## Flujo y resultados

1. Crear campaña y revisar texto, archivos y destinatarios.
2. Guardar y pulsar Iniciar campaña. Guardar por sí solo nunca envía.
3. La extensión verifica el número de la conversación antes de cada mensaje,
   conserva los borradores existentes y registra el intento antes de pulsar Enviar.
4. Cambiar de pestaña, ocultar/cerrar la barra, cerrar sesión o detener la campaña
   impide continuar. Cada ventana conserva su propia asociación de WhatsApp.
5. Consultar Informes. «Salida observada» significa que apareció un mensaje
   saliente en WhatsApp; no acredita entrega ni lectura. Una confirmación manual
   queda diferenciada. Un resultado incierto pausa la cola y requiere revisión;
   recargar la extensión no repite ese envío.

Los fallidos no se repiten automáticamente. Los borradores y campañas duplicadas
empiezan sin resultados anteriores. Un conflicto de revisión del CRM detiene el
guardado y la cola para conservar los cambios de otra sesión.

## Limpieza y continuidad

- Eliminadas las indicaciones antiguas que describían toda la integración como
  una pestaña externa sin sincronización. La sesión principal sigue dentro de la barra.
- Marketing muestra primero la herramienta compartida. Los segmentos y borradores
  anteriores permanecen bajo un apartado plegable, sin borrar su información.
- No se modifica la base de clientes, las cuentas, el historial ni los pagos para
  añadir campañas. `growth.outreach` es opcional y compatible con respaldos antiguos.
- Los adjuntos se guardan en tablas privadas de D1, separados del JSON del CRM.
  Las API verifican sesión, origen/CSRF cuando corresponde, tamaño, firma de archivo
  y SHA-256. No se guardan tokens administrativos ni datos binarios en la extensión.
- Biblioteca limitada a 200 MiB por instancia para este despliegue. Los archivos
  referenciados por plantillas o campañas no pueden borrarse; las cargas abandonadas
  se pueden eliminar expresamente. No se ha habilitado R2 ni otro servicio de pago.

## Alcance que no se debe anunciar como terminado

Las capturas identifican ApeMasivo / AprendeloPe EIRL. Se usaron como referencia
funcional; no se copió su código ni se afirma equivalencia con un catálogo privado.
Su publicidad también menciona chatbot, IA, cinco líneas simultáneas, equipos,
embudos y API. Esta entrega no incorpora un bot de IA, un centro de agentes,
cinco sesiones simultáneas ni un proveedor de mensajes permanente en el servidor.
La automatización oficial ya existente necesita su propia configuración y no se
activa al crear una campaña de la extensión.

La instalación descomprimida sigue necesitando sustituir archivos y pulsar
Recargar cuando cambia el adaptador. No existe un autoactualizador gratuito de
código remoto en este paquete. Chrome Web Store no se ha contratado ni publicado.
La web y la APK reciben los cambios web al publicar el servidor; la APK no lee
WhatsApp Android ni ejecuta la cola de WhatsApp Web.

Referencias públicas consultadas:

- https://aprendelope.com/sistema-de-whatsapp-marketing/
- https://aprendelope.com/chatbot-whatsapp/
- https://chromewebstore.google.com/detail/apecrm-software-para-what/nagccojpbajibncopdhdcphgbbleomde

## Validación y publicación

Pruebas locales: 178 casos Node y 58 Python. Las pruebas nuevas incluyen archivos
de 20 MiB por chunks en D1 real de Miniflare, hash/firma/cupos, sesión y CSRF,
importación CSV/XLSX, plantillas, fotos y video con File/DataTransfer reales,
persistencia antes del envío, interrupción y resultado incierto, revocación,
conflictos y aislamiento entre ventanas. Se verificó también el acceso dentro de
la barra con Worker/D1 y las regresiones de clientes, cuentas y Marketing.
WhatsApp, las API de Chrome y los clics de envío son simulados. No se enviaron
mensajes a clientes ni se probó una instalación MV3 real en el Chrome del dueño.

Para publicar: comprobar nombres de secretos y bindings sin leer sus valores,
añadir únicamente las tablas de adjuntos a la D1 existente, subir el Worker
compilado conservando DB, propietario y todos los secretos, y comprobar de nuevo
autenticación y recursos privados. No recrear el CRM, su contraseña ni la D1.
El panel de instancias y PRUEBA no necesitan cambios para esta entrega.
