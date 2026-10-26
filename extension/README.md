# Nexo CRM para WhatsApp Web

Extensión Manifest V3 para Chrome de computadora. Presenta una interfaz compacta
dentro de WhatsApp Web, conectada a la misma base del CRM. Tiene tres entradas:
**Chat actual**, **Clientes** y **Cuentas**. Las herramientas avanzadas siguen
disponibles desde **Abrir CRM**.
Un botón **Nexo** muestra u oculta el panel integrado a la derecha. En pantallas
amplias se reserva espacio para mantener la conversación visible; en ventanas
estrechas el panel puede superponerse y cerrarse con el botón **×**.

## Construir e instalar

Desde la raíz del repositorio:

```sh
python3 extension/build.py
```

Descomprime el ZIP en una carpeta privada. En `chrome://extensions` activa
**Modo de desarrollador**, pulsa **Cargar descomprimida** y selecciona esa
carpeta. En una instalación local, conserva la carpeta para futuras aperturas.
La distribución en Chrome Web Store requiere su publicación por el propietario.

## Conectar el CRM

1. Abre las opciones de la extensión. Introduce el origen HTTPS real de tu CRM,
   por ejemplo `https://nexo-crm.acxelcubaaraoz.workers.dev` una vez publicado.
2. Pulsa **Conectar CRM** o **Abrir WhatsApp con Nexo**. Ambos botones guardan
   la dirección y solicitan acceso exclusivamente a ese dominio.
3. Completa el inicio de sesión con tu correo si se solicita. Se abre el CRM
   normal; puedes conservarlo en segundo plano mientras trabajas en WhatsApp.
4. El panel reconoce la sesión y se conecta automáticamente. La dirección
   sugerida en las opciones se guarda al pulsar cualquiera de los botones de conexión.
5. Recarga WhatsApp Web si ya estaba abierta al instalar. Nexo
   aparece dentro de la página. Su botón o el icono de la extensión muestran y
   ocultan las herramientas, sin abrir el CRM en otra pestaña.

### Actualizar una instalación anterior

Reemplaza los archivos de la carpeta original por los del ZIP 1.2.1. Conserva la
misma ruta para mantener la configuración. En `chrome://extensions` pulsa
**Recargar** en Nexo y después recarga WhatsApp Web. La pestaña antigua que empieza
por `chrome-extension://` ya no es necesaria para trabajar. Mantén una sola
instalación de Nexo activa. El CRM normal puede permanecer en segundo plano;
la dirección antigua `/companion` ahora abre ese CRM.

La versión 1.2.1 reconoce también el panel nativo «Info. del contacto» cuando
WhatsApp muestra su nombre y teléfono como texto normal. Conserva la ficha
al cerrar ese panel si el chat tiene una identidad estable comprobada.

La interfaz abre la ficha del chat cuyo teléfono está identificado, agrupa
sus servicios y limpia la ficha al cambiar a otra conversación. Un número escrito
sin confirmar no selecciona clientes. Si WhatsApp oculta el teléfono, busca una
ficha o introduce el número y confirma la vinculación; los nombres no bastan para
identificar un contacto. Si tampoco hay una identidad estable del chat, abre la
información del contacto para mostrar su número antes de vincular.
Si esa información ya estaba abierta antes de reconocer el chat, ciérrala y
vuelve a abrirla. Un panel antiguo no acredita la identidad de otra conversación.

Desde la ficha puedes editar los datos del contacto, añadir un servicio, renovar,
editar o archivar cada servicio y preparar mensajes. Los perfiles libres y
ocupados se muestran dentro de su cuenta. Crear una cuenta exige su capacidad
real y vencimiento; no se inventa disponibilidad a partir de una hoja incompleta.

Los formularios son cortos, conservan sus valores si un guardado falla y muestran
el error dentro del formulario. Los precios desconocidos permanecen vacíos;
registrar un cobro requiere una elección explícita. La extensión conserva la
altura nativa de WhatsApp y los borradores existentes. Copiar mensajes usa un
documento interno de la extensión para funcionar desde el panel integrado.

No se introducen tokens administrativos de Cloudflare en la extensión. Se usa
la misma sesión privada del propietario y el mismo control de revisiones del
CRM. Dos operaciones concurrentes con datos antiguos se rechazan y requieren
actualizar; un perfil no se asigna silenciosamente dos veces. La vista consulta
cambios del CRM cada 20 segundos cuando está visible y no hay formularios ni
ediciones activas; **Actualizar** permite pedirlos manualmente.

## Conversaciones, destinatarios y mensajes

El panel permite vincular el chat individual actual con un cliente. Cuando
WhatsApp muestra un nombre y oculta el número, confirma el teléfono al vincular;
el nombre por sí solo no identifica a un cliente. La vinculación manual es
efímera y se invalida cuando cambia la identidad del chat.
Si tienes varias pestañas de WhatsApp, cada panel usa la conversación de su propia
pestaña. Ocultar el panel detiene el registro periódico de textos; al volver a
mostrarlo debes activarlo otra vez si lo necesitas.

La captura obtiene solo textos de mensajes cargados y visibles en la conversación
vinculada. No descarga el historial completo, archivos adjuntos ni mensajes de
otros chats en segundo plano. La captura se inicia desde el panel; cualquier
actualización periódica debe activarse expresamente para ese cliente. WhatsApp
puede cambiar su estructura y requerir actualizar el adaptador.

Al preparar una respuesta, el adaptador verifica el chat y teléfono otra vez.
Rechaza grupos y destinatarios diferentes. Si el editor no está disponible o ya
contiene otro borrador, conserva el borrador y copia el mensaje para pegarlo.
**El envío final lo confirmas tú en WhatsApp**. Capturar un texto enviado no
demuestra que el destinatario lo haya recibido.
La ficha elegida y el chat abierto deben corresponder a la misma persona antes
de preparar un borrador. Copiar texto no equivale a enviarlo ni cambia de destinatario.

Los registros se guardan en el CRM mediante su API privada. El almacenamiento
local de Chrome contiene únicamente la URL de configuración; la sesión del
service worker conserva identificadores de pestañas. Los datos del CRM solo
permanecen en memoria mientras su interfaz está abierta, salvo una exportación
de respaldo que solicites expresamente.

## Pruebas

```sh
node --test tests/extension.test.mjs tests/companion-workspace.test.mjs tests/whatsapp-identity.test.mjs
NODE_PATH=/ruta/a/node_modules node tests/extension-browser.cjs
NODE_PATH=/ruta/a/node_modules node tests/compact-extension-browser.cjs
```

Las pruebas usan documentos controlados, sin acceder a cuentas de WhatsApp.
La prueba de navegador ejecuta la interfaz empaquetada y el enrutador real de
mensajes con límites de Chrome simulados. El Chromium administrado del entorno
bloquea extensiones de terceros; esa política no se modifica ni se evita.
La compatibilidad final con tu sesión real y el inicio de sesión de Access
deben verificarse tras publicar el CRM e instalar la extensión.
