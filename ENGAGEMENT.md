# Chatbot y cinco líneas · Nexo 1.6.0

Publicado en el CRM principal. Descarga la [extensión 1.6.0](https://drive.google.com/file/d/1schKsp9Jl1gA0_VqHAK8EaL_sv3XwSX8/view)
y actualiza los archivos en la misma carpeta instalada; después pulsa Recargar
en `chrome://extensions` y recarga WhatsApp Web. Conserva una sola instalación
de Nexo activa. Las líneas y el chatbot empiezan sin activar.

El chatbot usa reglas configuradas por el propietario, sin servicio de IA de
pago. La web permite configurar líneas, respuestas y horarios desde Automatización.
La extensión ofrece lo mismo en Chatbot, junto a Chat actual, Clientes, Cuentas
y Campañas. El acceso sigue siendo el correo y contraseña del CRM.

## Empezar

1. En Chatbot → Mi línea, pulsa Añadir línea e introduce su nombre y número.
2. En Reglas, crea una respuesta de texto, foto o video. Elige texto exacto,
   contiene una frase o respuesta general. Se utiliza la primera coincidencia.
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

Para que cada chatbot siga trabajando al usar otras ventanas, habilita Permitir
segundo plano al editar su línea y vuelve a autorizarlo al iniciar ese chatbot.
La autorización se limita a su pestaña de WhatsApp; no lee las otras páginas.
Sin esa autorización, perder el primer plano o cerrar la barra detiene el bot.
Chrome, la sesión de Nexo e Internet deben continuar disponibles.

Cada chatbot responde únicamente a textos nuevos cargados en el chat individual
que esté abierto en su WhatsApp. No recorre otros chats ni responde a grupos,
audios, archivos recibidos o conversaciones anteriores. Al cambiar de chat,
descarta su historial previo y espera mensajes nuevos. Las campañas conservan
su pausa al cambiar de pestaña; no heredan la autorización de segundo plano del bot.
Campaña y chatbot no trabajan a la vez sobre la misma instalación de WhatsApp.

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

- Hasta cinco líneas y cincuenta reglas, con control de revisiones al guardar.
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
