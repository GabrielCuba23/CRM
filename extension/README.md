# Nexo CRM para WhatsApp Web

Extensión Manifest V3 para Chrome de computadora. Presenta una interfaz compacta
en la barra lateral de Chrome, conectada a WhatsApp Web y a la misma base del CRM. Tiene tres entradas:
**Chat actual**, **Clientes** y **Cuentas**. Las herramientas avanzadas siguen
disponibles desde **Abrir CRM**.
Pulsa **Nexo** en WhatsApp o el icono de la extensión para abrir la barra. Una vez
abierta permanece visible al cambiar de pestaña en esa ventana, también en otros
sitios. Puedes cerrarla desde el control de Chrome y abrirla de nuevo con Nexo.
El modo integrado en la página se conserva para entornos sin el panel nativo.

## Construir e instalar

Desde la raíz del repositorio:

```sh
python3 extension/build.py
```

Descomprime el ZIP en una carpeta privada. En `chrome://extensions` activa
**Modo de desarrollador**, pulsa **Cargar descomprimida** y selecciona esa
carpeta. En una instalación local, conserva la carpeta para futuras aperturas.
La instalación local no requiere pagar una tienda ni contratar una suscripción.

## Entrar con correo y contraseña

1. Crea tu contraseña una vez mediante el enlace privado de activación del CRM.
   El enlace es personal, se utiliza una sola vez y caduca a las 24 horas.
2. Abre o recarga WhatsApp Web y pulsa **Nexo** para abrir la barra lateral.
3. Escribe tu correo y contraseña en **Iniciar sesión**, dentro del panel.
   Usa las mismas credenciales que en la web del CRM.
4. La extensión se comunica directamente con el servidor. Puedes cerrar la web
   del CRM y continuar trabajando con la barra lateral abierta.

El CRM principal está configurado en la extensión. **Usar otro CRM** permite
cambiar el dominio y autorizar esa instancia expresamente. Las instancias que
todavía usan el acceso anterior conservan su conexión mediante una pestaña del
CRM; este requisito no se aplica al CRM principal con contraseña.

### Actualizar una instalación anterior

Reemplaza los archivos de la carpeta original por los del ZIP 1.4.0. Conserva la
misma ruta para mantener la configuración. En `chrome://extensions` pulsa
**Recargar** en Nexo y después recarga WhatsApp Web. La pestaña antigua que empieza
por `chrome-extension://` ya no es necesaria para trabajar. Mantén una sola
instalación de Nexo activa. La versión 1.3.0 añade correo y contraseña dentro
del panel y elimina la necesidad de conservar abierta la web del CRM principal.
La dirección antigua `/companion` abre el CRM completo.

La versión 1.4.0 usa el panel global de Chrome para mantener Nexo visible al
cambiar de pestaña, sin recargar sus formularios ni pedir el acceso otra vez.
**Abrir WhatsApp** vuelve a la conversación conectada de esa misma ventana.
Fuera de WhatsApp puedes consultar y gestionar clientes, servicios y cuentas;
para leer textos o preparar un borrador debes volver a su pestaña. No se leen
otras páginas por tener la barra abierta. El permiso `sidePanel` solo permite
mostrar esta interfaz persistente del navegador.

La versión 1.3.1 permite **Crear ficha nueva** desde **Chat actual**, junto a
**Vincular contacto existente**. Completa los datos de la conversación, comprueba
si el teléfono ya pertenece a un contacto y conecta la ficha guardada con ese chat.

### Actualizaciones automáticas

La instalación descomprimida requiere reemplazar sus archivos y pulsar Recargar.
La web y los datos compartidos se actualizan desde el servidor. La publicación
en Chrome Web Store está aplazada porque requiere un registro de pago, fuera del
presupuesto de este proyecto. El paquete actual no está publicado en la tienda;
no utiliza un actualizador de código remoto. Los materiales de publicación en
`STORE.md` se conservan solo como referencia para el futuro.

La versión 1.2.1 reconoce también el panel nativo «Info. del contacto» cuando
WhatsApp muestra su nombre y teléfono como texto normal. Conserva la ficha
al cerrar ese panel si el chat tiene una identidad estable comprobada.

La versión 1.2.2 añade **Vincular contacto existente** en **Chat actual**. Busca
por nombre o número, revisa la ficha y confirma que corresponde al chat abierto.
Se muestran los servicios y registros que ya existen: vincular no crea clientes,
no cambia sus teléfonos ni fusiona fichas. Puedes cambiar o quitar el vínculo
sin borrar al cliente.

La versión 1.2.3 hace explícito el servicio renovado: muestra la plataforma,
el perfil y el vencimiento actual antes de confirmar, y nombra el producto y
la nueva fecha al terminar. Cada ficha mantiene su vencimiento y sus cobros
independientes, aunque el cliente tenga varios productos o perfiles.

La interfaz abre la ficha del chat cuyo teléfono está identificado, agrupa
sus servicios y limpia la ficha al cambiar a otra conversación. Un número escrito
sin confirmar no selecciona clientes. Si WhatsApp oculta el teléfono, usa
**Vincular contacto existente**. Los nombres sirven para buscar y nunca asignan
una ficha automáticamente. Si WhatsApp todavía está cambiando de conversación,
espera a que termine antes de confirmar el vínculo.

Desde la ficha puedes editar los datos del contacto, añadir un servicio, renovar,
editar o archivar cada servicio y preparar mensajes. Los perfiles libres y
ocupados se muestran dentro de su cuenta. Crear una cuenta exige su capacidad
real y vencimiento; no se inventa disponibilidad a partir de una hoja incompleta.

Los formularios son cortos, conservan sus valores si un guardado falla y muestran
el error dentro del formulario. Los precios desconocidos permanecen vacíos;
registrar un cobro requiere una elección explícita. La extensión conserva la
altura nativa de WhatsApp y los borradores existentes. Copiar mensajes usa un
documento interno de la extensión para funcionar desde el panel integrado.

No se introducen tokens administrativos de Cloudflare en la extensión. Las dos
interfaces usan las mismas credenciales y el mismo control de revisiones del
CRM, con sesiones privadas independientes. Dos operaciones concurrentes con datos antiguos se rechazan y requieren
actualizar; un perfil no se asigna silenciosamente dos veces. La vista consulta
cambios del CRM cada 20 segundos cuando está visible y no hay formularios ni
ediciones activas; **Actualizar** permite pedirlos manualmente.

## Conversaciones, destinatarios y mensajes

El panel permite vincular el chat individual actual con un cliente. Cuando
WhatsApp muestra un nombre y oculta el número, elige y confirma una ficha existente;
el nombre por sí solo no identifica a un cliente. Si WhatsApp expone un
identificador estable de conversación, la extensión recuerda el vínculo para ese
CRM en este navegador. Si solo puede reconocer la conversación abierta, el
vínculo dura mientras permanezcas en ella y requiere confirmarlo de nuevo al
cambiar de chat o recargar. Un teléfono visible contradictorio impide reutilizarlo.
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
local de Chrome contiene la URL de configuración y los vínculos confirmados de
conversaciones estables, separados por CRM. El almacenamiento de sesión confiable
de la extensión conserva su credencial temporal y los identificadores de pestañas;
la contraseña no se almacena. La sesión vence después de ocho horas y se cierra
al cerrar sesión o al cambiar la contraseña; cerrar el navegador elimina la
credencial temporal de la extensión. Los datos del CRM solo
permanecen en memoria mientras su interfaz está abierta, salvo una exportación
de respaldo que solicites expresamente.

## Pruebas

```sh
node --test tests/extension.test.mjs tests/side-panel.test.mjs tests/extension-password.test.mjs tests/native-auth.test.mjs tests/companion-workspace.test.mjs tests/whatsapp-identity.test.mjs
NODE_PATH=/ruta/a/node_modules node tests/persistent-panel-browser.cjs
NODE_PATH=/ruta/a/node_modules node tests/password-browser.cjs
NODE_PATH=/ruta/a/node_modules node tests/extension-browser.cjs
NODE_PATH=/ruta/a/node_modules node tests/compact-extension-browser.cjs
```

Las pruebas usan documentos controlados, sin acceder a cuentas de WhatsApp.
La prueba de navegador ejecuta la interfaz empaquetada y el enrutador real de
mensajes con límites de Chrome simulados. El Chromium administrado del entorno
bloquea extensiones de terceros; esa política no se modifica ni se evita.
La prueba de contraseña ejecuta el Worker y D1 reales en Miniflare, con la web y
la extensión empaquetada; solo los límites de Chrome y el chat son simulados.
La prueba de barra persistente usa la misma interfaz empaquetada y comprueba
cambios de pestaña, aislamiento entre ventanas y conservación de formularios;
las API de Chrome, su barra nativa y las páginas de WhatsApp están simuladas.
La compatibilidad final con tu sesión real debe comprobarse en tu Chrome.
