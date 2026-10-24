# Nexo CRM para WhatsApp Web

Extensión Manifest V3 para Chrome de computadora. Reutiliza la interfaz completa
del CRM dentro del panel lateral: clientes, cuentas, perfiles, renovaciones,
finanzas, mensajes, reportes, proveedores, marketing y configuración.

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
2. Autoriza exclusivamente ese dominio y pulsa **Guardar y abrir sesión**.
3. Completa el inicio de sesión de Cloudflare Access con tu correo. Conserva
   abierta la pestaña **Conexión de Nexo CRM**; puedes trabajar en otra pestaña.
4. Comprueba la conexión desde las opciones.
5. Abre WhatsApp Web, recarga la página si ya estaba abierta al instalar, y pulsa
   el icono de Nexo CRM para abrir el panel lateral.

No se introducen tokens administrativos de Cloudflare en la extensión. Se usa
la misma sesión privada del propietario y el mismo control de revisiones del
CRM. Dos operaciones concurrentes con datos antiguos se rechazan y requieren
recargar; un perfil no se asigna silenciosamente dos veces.

## Conversaciones, destinatarios y mensajes

El panel permite vincular el chat individual actual con un cliente. Cuando
WhatsApp muestra un nombre y oculta el número, confirma el teléfono al vincular;
el nombre por sí solo no identifica a un cliente. La vinculación manual es
efímera y se invalida cuando cambia la identidad del chat.

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

Los registros se guardan en el CRM mediante su API privada. El almacenamiento
local de Chrome contiene únicamente la URL de configuración; la sesión del
service worker conserva identificadores de pestañas. Los datos del CRM solo
permanecen en memoria mientras su interfaz está abierta, salvo una exportación
de respaldo que solicites expresamente.

## Pruebas

```sh
node --test tests/extension.test.mjs
NODE_PATH=/ruta/a/node_modules node tests/extension-browser.cjs
```

Las pruebas usan documentos controlados, sin acceder a cuentas de WhatsApp.
La prueba de navegador ejecuta la interfaz empaquetada y el enrutador real de
mensajes con límites de Chrome simulados. El Chromium administrado del entorno
bloquea extensiones de terceros; esa política no se modifica ni se evita.
La compatibilidad final con tu sesión real y el inicio de sesión de Access
deben verificarse tras publicar el CRM e instalar la extensión.
