# Privacidad de Nexo CRM para WhatsApp Web

**Borrador para publicación.** Antes de hacerlo público, el propietario debe
completar el nombre del responsable, el correo de privacidad y la fecha de
entrada en vigor. Este archivo todavía no es una política publicada.

Responsable: **[completar nombre o entidad del editor de Nexo]**.  
Contacto de privacidad: **[completar correo público]**.  
Fecha de entrada en vigor: **[completar]**.

## Para qué sirve

Nexo muestra un panel de CRM dentro de WhatsApp Web. Permite consultar y
gestionar contactos, fichas de servicios, cuentas, perfiles, cobros y mensajes
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
- **Mensajes preparados:** texto que el usuario edita, copia o prepara como
  borrador en WhatsApp. La extensión no pulsa el botón de envío.

Estos datos se usan para realizar las operaciones del CRM solicitadas por el
usuario y asociarlas con la conversación correcta. La extensión no incorpora
publicidad ni un servicio de analítica de navegación.

## Dónde se procesan y guardan

Las solicitudes se transmiten por HTTPS a la instancia de CRM configurada.
El CRM principal usa infraestructura de Cloudflare para su servidor y base de
datos. Al autorizar otra instancia, las operaciones se dirigen a ese servidor;
su administrador controla la base del negocio.

La extensión guarda localmente en Chrome el dominio elegido y los vínculos de
conversaciones que el usuario confirme. Los vínculos con una identidad estable
se separan por CRM; los que solo identifican la conversación abierta no se
recuerdan como vínculos estables tras navegar a otro chat.

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

## Controles del usuario

El usuario puede cerrar sesión, cambiar su contraseña, quitar un vínculo de chat,
detener la captura de textos y gestionar los registros mediante el CRM. Quitar
el vínculo no borra la ficha. Archivar o eliminar un servicio no elimina
necesariamente sus pagos e historial anteriores.

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

Nexo es un producto independiente y no está afiliado con WhatsApp ni Meta.
