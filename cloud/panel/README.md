# Panel de marca blanca en Cloudflare

Panel nativo de Workers, D1 y Access. El administrador previsto es
`gabostreaming0@gmail.com`; entra con un código enviado por Access a ese correo.
El panel tiene una base de registro propia y cada nuevo CRM recibe otro Worker,
otra base D1 y una aplicación Access exclusiva para el correo de su propietario.
Se comparte código, nunca clientes, contraseñas, sesiones ni claves de canales.

## Preparar y publicar

Desde la raíz del repositorio, con Python 3 y Node 22:

```sh
npm install --prefix /tmp/crm-cloud-tools wrangler@4.148.0
python3 cloud/panel/deploy.py
```

El comando por defecto solo construye archivos locales. Para publicar:

```sh
python3 cloud/panel/deploy.py --deploy
```

Necesita `CLOUDFLARE_API_TOKEN` y `CLOUDFLARE_ACCOUNT_ID` configurados en los
ajustes seguros del entorno, además de un equipo Zero Trust y un subdominio
workers.dev activados. Se pueden reutilizar las credenciales del CRM en la misma
cuenta si permiten Workers Scripts, D1, Access Apps and Policies e Identity
Providers con edición, y Access Organizations con lectura. El token activo en
el dashboard no significa que esté conectado al entorno de desarrollo.

El despliegue no acepta planes de pago, no sobrescribe recursos existentes y
publica primero cerrado hasta configurar Access. Devuelve la dirección real
solo después de publicar. Guarda los identificadores y el archivo privado
`wrangler.json` en la carpeta temporal indicada; conserva ese registro fuera
del repositorio para recuperar una publicación interrumpida.

## Habilitar la creación de CRMs

Tras publicar, en Cloudflare → Workers & Pages → **nexo-retail-panel** →
Settings → Variables and Secrets, añade un **Secret** llamado
`RETAIL_PROVISION_TOKEN`, con un token Cloudflare limitado a esta cuenta y esos
permisos. Puede ser el mismo token autorizado. Este secreto pertenece al Worker
en producción: el script no copia una credencial del entorno de desarrollo a
producción ni la incluye en los archivos públicos. Nunca pongas tokens en el
chat o en GitHub. Sin este secreto, el panel permite ingresar y consultar el
registro, pero no crear instancias.

La cola procesa una instancia cada cinco minutos. El panel muestra su progreso
y entrega la URL al finalizar. WhatsApp y correo de cada cliente permanecen
sin conectar. El propietario entra con su propio código de Access; no hay una
contraseña compartida con el administrador. Suspender conserva los datos y
bloquea los accesos; reactivar exige una sesión posterior a la suspensión.

Si falla una operación, el registro conserva su etapa y los identificadores.
No reintenta una publicación de resultado ambiguo ni borra bases: requiere
revisar los recursos en Cloudflare. No incluye todavía reintentos desde la
interfaz, dominios personalizados, facturación o eliminación de instancias.
Las cuotas gratuitas de Workers, D1 y Access limitan cuántos CRMs se pueden
alojar; crear copias no equivale a capacidad ilimitada.

## Verificar antes de entregar

```sh
python3 cloud/panel/deploy.py
node --test tests/panel.test.mjs
python3 -m unittest discover -s tests -p test_panel_deploy.py
node tests/browser_cloud_panel.cjs
```

Las pruebas utilizan bases desechables y una API simulada, sin publicar recursos
ni enviar mensajes. Tras el despliegue real, comprobar el ingreso del correo
administrador, el rechazo de otro correo, el acceso individual del propietario,
la separación entre dos CRMs y la suspensión antes de vender el servicio.
Los administradores de infraestructura de la cuenta Cloudflare conservan
capacidad de administrar sus bases; el aislamiento del CRM no elimina ese
privilegio.
