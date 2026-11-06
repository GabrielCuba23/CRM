# Privacidad de Nexo CRM para WhatsApp Web

**Borrador para publicación.** Antes de hacerlo público, el propietario debe
completar el nombre del responsable, el correo de privacidad y la fecha de
entrada en vigor. Este archivo todavía no es una política publicada.

Responsable: **[completar nombre o entidad del editor de Nexo]**.  
Contacto de privacidad: **[completar correo público]**.  
Fecha de entrada en vigor: **[completar]**.

## Para qué sirve

Nexo muestra un panel de CRM en la barra lateral de Chrome, conectado a WhatsApp
Web. La barra puede seguir abierta al visitar otras pestañas, sin leer esas páginas. Permite consultar y
gestionar contactos, fichas de servicios, cuentas, perfiles, cobros, campañas y mensajes
utilizando la misma base que la web del CRM. El CRM principal está preconfigurado;
el usuario puede autorizar otra instancia en las opciones avanzadas.

## Datos que utiliza

- **Acceso:** correo y contraseña de la cuenta Nexo para iniciar sesión y una
  credencial temporal para autenticar las operaciones posteriores.
- **Datos del CRM:** nombres, teléfonos, correos, servicios contratados, fechas,
  perfiles, notas, precios, cobros y otros registros que el administrador guarde
  en el negocio. Las cuentas pueden incluir correos y contraseñas de servicios.
- **Conversación abierta:** nombre, teléfono cuando es visible e identificador
  de conversación cuando WhatsApp lo expone, para mostrar la ficha correcta.
- **Textos de conversaciones:** solo los textos cargados y visibles que el
  usuario solicite guardar. El registro periódico requiere activación expresa y
  se detiene al cambiar de conversación o cerrar el panel. No se descarga el
  historial completo ni los archivos, audios o conversaciones ocultas.
- **Mensajes y adjuntos:** texto que el usuario edita, copia o prepara como
  borrador, y fotos o videos que selecciona para enviar a uno o varios
  destinatarios. Los borradores individuales de texto requieren que el usuario
  confirme su envío en WhatsApp. Al iniciar y confirmar expresamente una campaña
  o un mensaje desde el editor de fotos y videos, el usuario autoriza a la
  extensión a abrir los destinatarios y pulsar Enviar para esa cola.
- **Listas de contactos:** nombres, teléfonos visibles, etiquetas y columnas
  personalizadas que el usuario importe desde Excel o CSV, seleccione del CRM o
  solicite leer de la lista cargada de WhatsApp, chats archivados o participantes
  del grupo abierto. La lectura puede ser parcial. Si WhatsApp no muestra un
  número, se conserva vacío; no se deduce por el nombre.
- **Campañas e informes:** destinatarios, mensaje, referencias a archivos,
  plantilla, programación, ritmo, intentos y resultados de la cola. Una salida
  observada en WhatsApp no confirma que el destinatario haya recibido o leído el
  mensaje. Los resultados inciertos y las confirmaciones manuales se registran
  por separado.

Estos datos se usan para realizar las operaciones del CRM solicitadas por el
usuario y asociarlas con la conversación correcta. La extensión no incorpora
publicidad ni un servicio de analítica de navegación.

## Dónde se procesan y guardan

Las solicitudes se transmiten por HTTPS a la instancia de CRM configurada.
El CRM principal usa infraestructura de Cloudflare para su servidor y base de
datos. Al autorizar otra instancia, las operaciones se dirigen a ese servidor;
su administrador controla la base del negocio.

Los archivos que el usuario selecciona se guardan en la biblioteca privada del
CRM. El CRM principal usa su base D1 existente para almacenar fragmentos y
verificar su tamaño, tipo y huella SHA-256. Se admiten hasta diez fotos o videos
y **20 MiB en total por mensaje**, con un límite de **200 MiB para la biblioteca**.
Descargar esos archivos exige una sesión autorizada; no se crean enlaces públicos
a los adjuntos ni se envían a un proveedor de publicidad. La implementación no
activa un servicio de almacenamiento de pago adicional.

La extensión guarda localmente en Chrome el dominio elegido y los vínculos de
conversaciones que el usuario confirme. Los vínculos con una identidad estable
se separan por CRM; los que solo identifican la conversación abierta no se
recuerdan como vínculos estables tras navegar a otro chat.
El almacenamiento de sesión también conserva el identificador de la pestaña de
WhatsApp asociada a cada ventana, para mantener esa conexión cuando cambias de
pestaña. Esta asociación no contiene el contenido de otras páginas.

La credencial temporal de acceso se conserva en el almacenamiento de sesión
confiable de la extensión, separado de los scripts de la página. La contraseña
introducida para iniciar sesión no se guarda allí ni en el almacenamiento local
de Chrome. Las sesiones con contraseña vencen a las ocho horas; cerrar sesión o
cambiar la contraseña las revoca según el alcance de cada operación. Cerrar el
navegador elimina la credencial temporal de la extensión.

Las fichas y operaciones se guardan en el servidor del CRM. La extensión las
mantiene en memoria durante su uso; no crea una base de clientes independiente
en `chrome.storage`. Una exportación solicitada por el usuario sí puede producir
un archivo privado en su equipo. Los textos que se copian se escriben en el
portapapeles únicamente a petición del usuario; la extensión no lee su contenido.
Los archivos y contactos exportados, incluyendo informes CSV o Excel, quedan
bajo el control del usuario en su equipo.

La programación de campañas se ejecuta en la extensión mientras Chrome y
WhatsApp Web permanecen abiertos y activos. Al ocultar el panel o cambiar de
pestaña se pausa la cola. Cerrar o interrumpir la extensión no inicia una
reanudación automática al volver a entrar. El registro del intento se conserva
en el CRM para que el usuario pueda revisar un resultado incierto antes de
continuar.

## Controles del usuario

El chatbot por reglas y flujos se activa expresamente por línea y perfil de Chrome. Lee
textos nuevos cargados en el chat individual abierto, conserva un registro del
intento y puede pulsar Enviar para la respuesta configurada. No responde al
historial anterior ni recorre otros chats o grupos. El modo en segundo plano
se autoriza desde Mi línea, incluso con el chatbot activo; permite seguir
usando su pestaña de WhatsApp al cambiar de pestaña o ventana.
El registro compartido admite hasta cinco líneas, con reservas exclusivas que
caducan. El número de cada línea lo declara el propietario; registrarlo no inicia
ni certifica una cuenta de WhatsApp. Detener todas las líneas revoca las reservas.

Los flujos conservan en el servidor el paso y las respuestas recopiladas por
línea y conversación, con caducidad de treinta minutos por defecto. Un
identificador estable permite responder aunque WhatsApp oculte el teléfono;
no se deduce el número ni se asigna una ficha por nombre. El avance requiere
observar la salida. Un resultado incierto bloquea esa conversación; el usuario
puede revisarla y reiniciar su flujo desde Actividad. Las respuestas de los
clientes no se envían a ningún proveedor de IA.

El usuario puede cerrar sesión, cambiar su contraseña, quitar un vínculo de chat,
detener la captura de textos y gestionar los registros mediante el CRM. Quitar
el vínculo no borra la ficha. Archivar o eliminar un servicio no elimina
necesariamente sus pagos e historial anteriores.

También puede revisar destinatarios, exclusiones, texto y archivos antes de
iniciar una campaña, pausarla o cancelarla y exportar sus resultados. La
biblioteca permite borrar explícitamente archivos sin referencias y subidas
incompletas. Si una campaña o plantilla usa un archivo, debe quitarse esa
referencia antes de eliminarlo. No se eliminan automáticamente archivos antiguos
ni datos del negocio para liberar espacio.

Desinstalar la extensión elimina su almacenamiento de Chrome, pero no borra los
datos del negocio guardados en el servidor ni los respaldos que el usuario haya
descargado. Las solicitudes de acceso, corrección o eliminación adicional de
datos del negocio se dirigen al administrador de esa instancia o al contacto de
privacidad indicado arriba.

## Permisos y acceso a sitios

La extensión usa acceso a WhatsApp Web para mostrar el panel y trabajar con la
conversación visible, y acceso al CRM para autenticar y guardar operaciones. El
permiso opcional para otros sitios solo se solicita al seleccionar otra instancia
de CRM, para su dominio concreto. El código de la extensión se incluye en su
paquete; las respuestas del CRM son datos, no actualizaciones de código remoto.
La instalación local descomprimida no necesita una suscripción ni un registro de
pago en Chrome Web Store. Cambiar el código del paquete requiere reemplazarlo y
recargarlo; esa instalación no utiliza un actualizador de código remoto.

Nexo es un producto independiente y no está afiliado con WhatsApp ni Meta.
