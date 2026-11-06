# Nexo CRM para WhatsApp Web

Extensión Manifest V3 para Chrome de computadora. Presenta una interfaz compacta
en la barra lateral de Chrome, conectada a WhatsApp Web y a la misma base del CRM. La versión 1.6.0 del código tiene cinco entradas:
**Chat actual**, **Clientes**, **Cuentas**, **Campañas** y **Chatbot**. Las herramientas avanzadas siguen
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

Reemplaza los archivos de la carpeta original por los del nuevo paquete construido. Conserva la
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

La versión 1.4.1 corrige el reconocimiento del panel en Chrome, donde los datos
del remitente pueden omitir el documento y los contextos laterales indican una
ventana `-1`. El acceso al CRM funciona con **Correo**, **Contraseña** e
**Iniciar sesión** dentro de la propia barra, aunque todavía no se pueda
asociar su pestaña de WhatsApp. El CRM principal no vuelve a mostrar
**Configurar CRM** ni **Ya inicié sesión: conectar aquí** por ese fallo.

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

Al preparar una respuesta individual de texto, el adaptador verifica el chat y teléfono otra vez.
Rechaza grupos y destinatarios diferentes. Si el editor no está disponible o ya
contiene otro borrador, conserva el borrador y copia el mensaje para pegarlo.
**El envío final de ese borrador lo confirmas tú en WhatsApp**. Las campañas y el
editor de fotos o videos usan el inicio explícito descrito a continuación.
Capturar un texto enviado no
demuestra que el destinatario lo haya recibido.
La ficha elegida y el chat abierto deben corresponder a la misma persona antes
de preparar un borrador. Copiar texto no equivale a enviarlo ni cambia de destinatario.

## Campañas, fotos, videos y contactos en 1.5.0

La 1.6.0 conserva estas funciones y añade **Chatbot**: hasta cinco líneas
independientes, reglas de texto exacto/contiene/respuesta general, horario de
Lima y fotos/videos. Cada número necesita su perfil de Chrome y su WhatsApp
vinculado. Crea sus respuestas, selecciona la línea y confirma **Iniciar chatbot**.
Se responde solo a textos nuevos del chat individual abierto, sin recorrer otros
chats ni el historial. Para trabajar con cinco perfiles a la vez, autoriza segundo
plano en cada línea y al iniciar cada perfil. **Detener todas las líneas** está
disponible desde la extensión y la web. No se contrata una API de IA ni una tienda.

**Campañas** contiene cuatro apartados: **Campañas**, **Contactos**, **Plantillas**
e **Informes**. La web y la extensión guardan estas listas, mensajes y resultados
en la misma base del CRM. La web permite configurarlos; iniciar una cola de envío
requiere la extensión y WhatsApp Web activos.

- Importa Excel XLSX o CSV, selecciona las columnas de nombre y teléfono y revisa
  la vista previa. Los números peruanos de nueve dígitos reciben el código +51
  predeterminado. Cada número aparece una sola vez por campaña; las exclusiones
  se aplican al preparar la lista y antes de enviar.
- Selecciona contactos guardados, clientes del CRM, una lista manual o contactos
  leídos de WhatsApp. Puedes filtrar por servicio, etiqueta o autorización para
  campañas y guardar plantillas con campos como `{nombre}` y columnas del Excel.
- Adjunta fotos PNG, JPEG, GIF o WebP y videos MP4 o WebM. Una campaña admite hasta
  diez archivos y **20 MiB en total por mensaje**. El editor de **Foto / video**
  de una ficha abre el mismo flujo para ese contacto.
- Configura intervalos, cantidad de mensajes por lote, pausas entre lotes y una
  fecha local de inicio. La vista previa muestra el texto personalizado antes de
  confirmar.

Guardar una campaña, recargar el CRM o volver a abrir Chrome no inicia envíos.
Al pulsar **Iniciar campaña** o **Continuar campaña** y confirmar, autorizas a la
extensión a abrir los destinatarios y pulsar Enviar para esa cola de texto y
adjuntos. Puedes pausarla o cancelarla. Un borrador existente o un destinatario
que WhatsApp no confirme impiden continuar ese intento sin la comprobación
correspondiente. El adaptador no usa un grupo como destino de una campaña.

La programación es local: necesita Chrome, la extensión y WhatsApp Web abiertos
y activos. Al ocultar el panel o cambiar a otra pestaña, la cola se pausa; la barra
del CRM puede seguir visible. Cerrar Chrome o interrumpir una operación requiere
recuperar la campaña y revisar sus resultados antes de continuar. No hay un envío
programado en el servidor ni una reanudación automática al volver a entrar.

El intento se guarda antes de pulsar Enviar. **Salida observada en WhatsApp**
significa que el adaptador observó el mensaje saliente; no confirma entrega ni
lectura. Un resultado **Revisar** pausa la cola y no se reintenta automáticamente.
Puedes comprobarlo en WhatsApp y marcarlo como enviado u omitido. Los informes
distinguen esos casos, los errores y las confirmaciones manuales, y se exportan
como CSV o Excel.

**Descargar contactos de WhatsApp** lee la lista cargada de chats, la vista de
archivados o los participantes del grupo abierto. El recorrido y la comprobación
opcional de teléfonos son limitados; una lectura parcial se indica en pantalla.
Los nombres cuyo número no está visible se conservan con teléfono vacío: puedes
exportarlos o completar el dato después, pero no se añaden automáticamente como
destinatarios. El nombre por sí solo no permite adivinar un teléfono ni vincular
una ficha del CRM.

Los archivos seleccionados se suben mediante la API privada autenticada. El CRM
principal usa fragmentos en su **D1 existente**, con una biblioteca limitada a
**200 MiB en total**; no se crea un servicio R2 ni se activa facturación adicional.
El servidor comprueba el tamaño, el tipo y la huella SHA-256 antes de permitir su
uso. No hay enlaces públicos a los adjuntos. La biblioteca permite eliminar
explícitamente archivos no usados y subidas incompletas; un archivo referenciado
por una campaña o plantilla debe quitarse de ella antes de borrarlo. No se borran
archivos antiguos automáticamente para liberar espacio.

La instalación descomprimida no requiere una suscripción ni pagar el registro de
Chrome Web Store. Sus cambios de código siguen necesitando reemplazar el paquete
y recargar la extensión; la base compartida permanece en el servidor. Estas
instrucciones describen el código de esta versión y no certifican un despliegue
ni una instalación en un navegador concreto.

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
node --test tests/outreach.test.mjs tests/outreach-media.test.mjs
node tests/outreach-browser.cjs
python3 -m unittest tests.test_outreach_media
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
