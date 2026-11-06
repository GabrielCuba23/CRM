# Chatbot, flujos y cinco líneas · Nexo 1.7.0

Publicado en el CRM principal. Descarga la [extensión 1.7.0](https://drive.google.com/file/d/1nvrSId8VEoJNKbp7qmK88WtRsu_6KPNG/view)
y actualiza los archivos en la misma carpeta instalada; después pulsa Recargar
en `chrome://extensions` y recarga WhatsApp Web. Conserva una sola instalación
de Nexo activa. Las líneas y reglas existentes se conservan. Los nuevos flujos requieren guardar su configuración.

El chatbot usa flujos y reglas configurados por el propietario, sin servicio de IA de
pago. La web permite configurar líneas, respuestas y horarios desde Automatización.
La extensión ofrece lo mismo en Chatbot, junto a Chat actual, Clientes, Cuentas
y Campañas. El acceso sigue siendo el correo y contraseña del CRM.

## Empezar

Si todavía no hay líneas, la primera pantalla muestra **Añadir mi línea** y
**Crear una respuesta**, sin un selector vacío. **Configurar respuestas** abre
las reglas. Los requisitos que falten para activar el perfil tienen acciones
directas. **Detener chatbot** aparece cuando ese perfil está activado.

1. En Chatbot → Mi línea, pulsa Añadir línea e introduce su nombre y número.
2. En **Flujos**, pulsa **Crear flujo** o **Usar ejemplo menú 1–8**. Edita los
   mensajes, preguntas y destinos, prueba el recorrido y guarda. Elige un flujo
   inicial o sus frases de inicio. En **Reglas** también puedes conservar
   respuestas sencillas de texto, foto o video.
3. Activa las respuestas automáticas y guarda. Puedes limitar días y horas de
   atención, usando la hora de Lima, y el intervalo mínimo por contacto.
4. Vuelve a Mi línea, selecciona la línea de ese perfil y pulsa Usar esta línea.
5. Con WhatsApp abierto, pulsa Iniciar chatbot y confirma. No responde mensajes
   anteriores a la activación. Detener chatbot libera esa línea.

Registrar un número no crea ni inicia una cuenta de WhatsApp. El propietario
debe vincular el WhatsApp que corresponde al número declarado. La sesión activa
indica una reserva del perfil de Nexo; no certifica el teléfono de la cuenta.
Los clientes y sus servicios siguen en la misma base del CRM y no se duplican.

## Usar hasta cinco números simultáneos

Cada número necesita un perfil de Chrome distinto con su propia sesión de
WhatsApp Web y una instalación de Nexo. En todos puedes entrar al mismo CRM.
Cinco pestañas del mismo perfil comparten la cuenta de WhatsApp y no equivalen a
cinco números distintos. Los perfiles se pueden ejecutar en uno o varios equipos.

Para que cada chatbot siga trabajando al usar otras ventanas, marca **Permitir
trabajar en segundo plano en este perfil** en **Mi línea**. Puedes cambiarlo
con el chatbot activo; el cambio no reinicia su escucha ni borra mensajes pendientes.
La autorización se limita a su pestaña de WhatsApp; no lee las otras páginas.
Sin esa autorización, perder el primer plano o cerrar la barra detiene el bot.
Chrome, la sesión de Nexo e Internet deben continuar disponibles.

Cada chatbot responde únicamente a textos nuevos cargados en el chat individual
que esté abierto en su WhatsApp. No recorre otros chats ni responde a grupos,
audios, archivos recibidos o conversaciones anteriores. Al cambiar de chat,
descarta su historial previo y espera mensajes nuevos. Las campañas conservan
su pausa al cambiar de pestaña; no heredan la autorización de segundo plano del bot.
Campaña y chatbot no trabajan a la vez sobre la misma instalación de WhatsApp.

## Menús, preguntas y memoria

Un flujo tiene un primer paso y hasta cincuenta pasos editables: mensaje y
continuación, menú numerado, pregunta, respuesta final o atención personal.
Cada opción del menú dirige a otro paso. Las preguntas guardan una respuesta en
una variable, por ejemplo `{consulta}`, para usarla en los mensajes siguientes.
Admiten texto, número, correo o teléfono, con reintento si el formato no coincide.
El ejemplo ofrece ocho opciones; un menú admite hasta diez. La prueba del editor
es local y no envía mensajes a clientes. Guardar tampoco activa una línea.

El bot reconoce una conversación por su identificador estable de WhatsApp,
aunque el teléfono esté oculto. No adivina números ni vincula fichas por nombre.
Las respuestas y el paso actual se conservan por línea y conversación; no se
comparten entre clientes. La memoria caduca a los treinta minutos de inactividad
por defecto. **menú** o **0** reinician el flujo; **salir** lo termina. La atención
personal suspende el flujo hasta un reinicio explícito.

Los menús son texto con opciones numeradas. No son botones interactivos nativos
de WhatsApp ni respuestas generadas por IA. No requieren contratar servicios.

Solo se guarda el avance después de observar el envío. Si el resultado es
incierto, se bloquea esa conversación para revisar WhatsApp. En **Actividad**
puedes ver los datos recopilados y **Reiniciar conversación** para continuar desde cero.
Ese control afecta únicamente a la conversación elegida.

## Respuestas e historial

Las respuestas admiten hasta diez fotos/videos y 20 MiB en total. Los archivos
permanecen en la biblioteca privada del negocio, junto con los de Campañas.
Variables: nombre, teléfono, negocio, servicio, servicios, vencimiento, perfil y
precio registrado. Si un contacto tiene varios servicios, servicio/vencimiento/
perfil/precio corresponden al primero de su ficha; servicios lista las plataformas.
No se sustituyen contraseñas automáticamente. La regla de respuesta no renueva,
elimina ni entrega por sí misma un producto del inventario.

Actividad distingue salida observada, fallo y resultado incierto. Salida observada
no confirma entrega ni lectura. Un resultado incierto detiene el chatbot y nunca
se repite automáticamente. Los borradores del propietario se conservan.
Detener todas las líneas, disponible también desde la web, desactiva el chatbot
y revoca sus reservas. Cambiar contraseña, cerrar sesión o cambiar de CRM revoca
el runtime local. La credencial temporal no se copia a respuestas ni exportaciones.

## Coordinación y almacenamiento

- Hasta cinco líneas, cincuenta reglas y veinte flujos, con control de revisiones al guardar.
- Hasta cinco mil conversaciones con memoria temporal, independiente por línea y chat.
- Reserva exclusiva de línea por perfil, con vencimiento y renovación periódica.
- Registro duradero del mensaje entrante antes de preparar una respuesta; una
  interrupción no permite repetir ese mensaje en otro perfil.
- Comprobación de reserva, sesión, configuración y destinatario antes de Enviar.
- Tablas nuevas de D1, sin reemplazar workspace, cuentas, cobros ni autenticación.
- Máximo 10 000 intentos conservados; al alcanzarlo se detienen nuevos intentos
  hasta gestionar el historial. La vista muestra los últimos cien.

Pruebas: API privada de Worker/D1 con cinco reservas simultáneas, duplicados y
conflictos; servidor Flask; runtime por perfil; navegador con interfaz empaquetada,
router nativo, adaptador de WhatsApp y servidor/D1 reales de prueba. WhatsApp y las
API de Chrome se simulan: no se enviaron mensajes reales ni se conectaron números
del propietario durante la implementación.

La extensión descomprimida requiere reemplazar sus archivos y pulsar Recargar.
No se ha contratado Chrome Web Store ni se ejecuta código remoto para actualizarla.
