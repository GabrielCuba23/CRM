# Preparar Nexo para Chrome Web Store

Estado: paquete preparado para revisión técnica; **todavía no publicado**. La
instalación como carpeta descomprimida no recibe actualizaciones automáticas.

## Distribución y actualizaciones

1. El propietario debe registrar o usar su cuenta de desarrollador en
   [Chrome Web Store](https://chrome.google.com/webstore/devconsole).
2. Crear un artículo de Nexo y cargar el ZIP generado por `extension/build.py`.
   Mantener el mismo artículo para todas las actualizaciones: cambia la versión
   del manifiesto y carga el nuevo ZIP en ese artículo.
3. Completar ficha, imágenes, declaraciones de privacidad e instrucciones de
   acceso para la revisión. Seleccionar la distribución disponible que corresponda
   en la consola; una publicación no listada permite instalar mediante su enlace.
4. Enviar a revisión. La preparación del ZIP no equivale a una aprobación.
5. Cuando esté publicado, instalar Nexo desde ese enlace una vez y desactivar la
   copia descomprimida. La instalación de la tienda recibirá las futuras versiones
   publicadas mediante el mecanismo de actualización de Chrome.

La web y la extensión usan la misma base y las mismas credenciales. Las mejoras
del servidor se aplican al publicar el servidor; los cambios del código incluido
en la extensión se distribuyen por la tienda. No se descarga JavaScript remoto
para sustituir ese proceso. No hace falta añadir un actualizador propio ni un
`update_url` de terceros.

La versión 1.3.0 incorporó correo y contraseña dentro de WhatsApp. La 1.3.1 añade
**Crear ficha nueva** a **Chat actual**. El CRM principal viene preconfigurado;
el acceso normal pide correo y contraseña. **Usar otro CRM** es una opción
avanzada para otras instancias.

## Texto propuesto para la ficha

**Nombre:** Nexo CRM para WhatsApp Web

**Descripción corta:** Gestiona clientes, servicios, cuentas y perfiles desde
WhatsApp Web, con los mismos datos y credenciales de tu CRM Nexo.

**Descripción:**

Nexo añade un panel de trabajo junto a tu conversación de WhatsApp Web. Consulta
la ficha del cliente, crea una ficha nueva o vincula un contacto existente sin
salir del chat.

- Chat actual: datos del contacto, sus servicios, renovaciones y mensajes.
- Clientes: búsqueda, edición y nuevos servicios.
- Cuentas: cuentas madre y sus perfiles disponibles u ocupados.
- Misma base y mismas credenciales que la web de Nexo. Las herramientas más
  extensas siguen disponibles desde Abrir CRM.

Los mensajes se preparan como borradores; el usuario confirma el envío en
WhatsApp. Guardar textos visibles requiere activarlo y no descarga todo el
historial ni los archivos del chat. La extensión necesita una cuenta autorizada
de Nexo y conexión a Internet. Es un producto independiente, sin afiliación con
WhatsApp ni Meta.

## Permisos y declaraciones para la consola

**Finalidad única:** gestionar el CRM Nexo junto a la conversación de WhatsApp
Web, usando la base del negocio y las operaciones que solicite el usuario.

| Permiso | Uso real |
| --- | --- |
| `storage` | Guardar el dominio del CRM y vínculos de chats localmente; conservar la credencial temporal solo en el almacenamiento de sesión confiable de la extensión. |
| `scripting` | Instalar los archivos empaquetados del panel y adaptador al abrir Nexo en una pestaña de WhatsApp; conectar instancias antiguas mediante el puente empaquetado de compatibilidad. |
| `clipboardWrite` | Copiar el texto solicitado por el usuario. No se lee el portapapeles. |
| `offscreen` | Usar un documento interno empaquetado para copiar desde el panel incrustado. |
| `https://web.whatsapp.com/*` | Mostrar el panel, reconocer la conversación visible y preparar borradores o capturar textos cuando el usuario lo solicita. |
| Dominio exacto del CRM principal | Iniciar sesión y consultar o guardar datos mediante la API HTTPS del CRM. |
| `https://*/*` opcional | Solicitar acceso al dominio exacto de otra instancia solo al elegirla en Usar otro CRM. No concede acceso a todos los sitios al instalar. |

El código ejecutable está incluido en el paquete, incluidas las dependencias
vendorizadas. Las consultas al CRM intercambian datos JSON. El formulario de
inicio de sesión transmite la contraseña al CRM elegido por HTTPS y no la guarda
en el almacenamiento de Chrome.

Las declaraciones de datos deben contemplar, según el uso del negocio:

- Información identificativa: nombre, correo, teléfono y referencias de contacto.
- Información de autenticación: contraseña de ingreso, sesión temporal y las
  credenciales de servicios que el administrador haya guardado en su CRM.
- Información financiera: precios, cobros y registros de operaciones del CRM.
- Comunicaciones personales y contenido de sitios web: identidad del chat,
  textos visibles guardados expresamente y mensajes preparados por el usuario.

Revisar las categorías y certificaciones concretas que muestre la consola antes
de enviarlas; deben coincidir con la política publicada y el comportamiento de
la versión que se entregue. No afirmar que no se manejan datos porque el
almacenamiento definitivo esté en el servidor.

## Materiales incluidos y pendientes

El paquete de preparación incluye el ZIP 1.3.1, un icono PNG de 128 × 128 y dos
capturas de 1280 × 800 con datos sintéticos. Las capturas se obtuvieron de la
interfaz empaquetada en documentos controlados; no son conversaciones reales.
También incluye los textos propuestos de la ficha y el borrador de privacidad.

Antes de enviar faltan:

- Cuenta y datos del desarrollador propietario, y correo público de soporte.
- Política de privacidad accesible mediante una URL pública estable. El archivo
  `PRIVACY.md` es un borrador; confirmar su responsable y contacto antes de
  publicarlo. No debe quedar detrás del inicio de sesión del CRM.
- Instancia de demostración aislada y acceso para el equipo de revisión. La
  contraseña del propietario y su base real no son credenciales de demostración.
- Instrucciones de prueba para iniciar sesión, abrir WhatsApp Web y comprobar el
  panel, incluyendo las limitaciones del reconocimiento de contactos.
- Envío y resultado de la revisión; todavía no existe un enlace de instalación de
  la tienda para esta preparación.

## Referencias oficiales

- [Distribuir extensiones](https://developer.chrome.com/docs/extensions/how-to/distribute)
- [Publicar en Chrome Web Store](https://developer.chrome.com/docs/webstore/publish)
- [Opciones de distribución](https://developer.chrome.com/docs/webstore/cws-dashboard-distribution)
