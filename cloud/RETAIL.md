# Copias privadas para marca blanca en Cloudflare

El panel retail del servidor y esta alternativa de Cloudflare son caminos de
despliegue distintos. El panel crea instancias privadas en el servidor; este
script prepara una instancia con su propio Worker, base D1 y aplicación Access.
La interfaz y los módulos se comparten como código. No se copian clientes,
cuentas, contraseñas, proveedores, sesiones ni claves de otras instancias.

Preparación local sin credenciales ni operaciones externas:

```sh
python cloud/retail_deploy.py \
  --instance-id 0123456789abcdef0123456789abcdef \
  --slug negocio-cliente \
  --owner-email propietario@example.com \
  --brand-name "CRM de mi negocio"
```

El identificador se genera una vez con `uuid.uuid4().hex`; no uses el valor del
ejemplo para clientes reales. El manifiesto `instance.json` queda en una carpeta
temporal privada de permisos 700/600, separado de los assets públicos. Conserva
ese manifiesto fuera del repositorio como registro del aprovisionamiento.
`--output-dir` permite elegir una carpeta nueva y privada. La marca inicial se
aplica al nuevo espacio vacío y el propietario puede cambiar nombre y logo en
Configuración.

Para publicar, añade `--deploy` al mismo comando, con un directorio de salida
nuevo. Deben estar configurados de forma segura `CLOUDFLARE_API_TOKEN` y
`CLOUDFLARE_ACCOUNT_ID`. Requiere Wrangler, Node y un equipo Zero Trust activo
en la cuenta. El script no acepta planes de pago ni activa condiciones legales.
Cada base e instancia consume la cuota de la cuenta; el plan gratuito tiene
límites y no ofrece clientes ni almacenamiento ilimitados.

La publicación crea recursos nuevos y se detiene si su nombre ya existe. Nunca
reutiliza `nexo-crm`. Publica primero con autenticación cerrada, crea Access para
el hostname completo y solamente el correo asignado, y después configura su
audiencia exclusiva. El Worker también verifica la firma, audiencia y correo
del JWT para proteger datos y archivos privados incluso ante accesos alternos.
Los canales WhatsApp y correo permanecen desconectados hasta configurar las
claves y condiciones de cada cliente individualmente.

Una publicación terminada se marca `published_pending_verification`: prueba
el ingreso del propietario y comprueba que otra cuenta y otro CRM no puedan
leer sus datos antes de entregar la URL. Si una operación falla, el manifiesto
conserva los identificadores de recursos creados y la etapa alcanzada. El
script no elimina bases para intentar recuperar un fallo; revisa esos recursos
antes de reintentar con otro identificador. Un Worker publicado en la etapa
`worker_locked` permanece cerrado. El [panel nativo de Cloudflare](panel/README.md) agrega creación desde la interfaz
y suspensión con bases independientes. Este script sigue siendo una alternativa
manual. Dominios personalizados, facturación y borrado de instancias siguen
pendientes.
