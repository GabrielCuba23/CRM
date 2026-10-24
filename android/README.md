# Nexo CRM para Android

Aplicación Android que abre el CRM privado completo dentro de una WebView. Usa
la misma base de datos que la web y la extensión; requiere Internet y un CRM
publicado. El APK es una compilación firmada para pruebas e instalación directa;
no constituye una publicación en Google Play ni una validación en un teléfono.

## Funciones

- Dirección HTTPS configurable por negocio, sin tokens administrativos incluidos.
- Inicio de sesión mediante Cloudflare Access y conservación de sus cookies.
- Autorización explícita del dominio exacto del equipo Access la primera vez.
- Acceso a las funciones existentes del CRM: clientes, inventario, asignaciones,
  pagos, renovaciones, notas, plantillas, reportes y configuración.
- WhatsApp se abre como aplicación externa o mediante el navegador para que el
  propietario revise y confirme el mensaje. La app no lee chats de WhatsApp Android.
- Importación de archivos mediante el selector de documentos de Android.
- Exportaciones de archivos Blob/HTTPS del CRM mediante el selector de guardado;
  también hay «Exportar respaldo JSON» en el menú de la aplicación.

No pide acceso a contactos, almacenamiento general, SMS, micrófono ni notificaciones.
No incluye una interfaz JavaScript con acceso a funciones nativas. HTTPS es
obligatorio, se rechazan certificados inválidos y el respaldo automático del
contenedor Android está desactivado.

## Compilar en Linux

Requiere Python 3, Java 21 o compatible, `keytool`, `curl` y bibliotecas Linux
estándar. No requiere Gradle, un token de Cloudflare ni una cuenta de Google Play.
El script obtiene Android SDK 35, Build Tools 35.0.0 y ECJ 3.39.0 desde sus fuentes
públicas oficiales y comprueba sus hashes SHA-256. Respeta el proxy y la confianza
TLS del entorno.

Desde la raíz del repositorio:

```sh
python3 android/build.py \
  --tools-dir /workspace/work/android-tools \
  --build-dir /workspace/work/android-build \
  --signing-dir /workspace/work/android-private \
  --output /workspace/work/deliverables/nexo-crm-android-testing.apk
```

La primera compilación genera una clave de pruebas en `--signing-dir`, con
carpeta privada y archivos de permisos 600. Esa carpeta debe estar fuera del
repositorio. Conserva privadamente la clave y su registro si quieres que las
siguientes APK puedan actualizar la aplicación instalada. No publiques esa
carpeta, contraseñas ni cookies. La APK y su suma SHA-256 son los entregables.

El proceso ejecuta pruebas de políticas de URL, compila Java a DEX, enlaza los
recursos, alinea, firma y verifica la APK mediante `apksigner` y `aapt2`.

Solo pruebas de URL:

```sh
python3 android/build.py --tools-dir /workspace/work/android-tools --test-policy
```

## Instalar y validar

1. Instala la APK de pruebas en un dispositivo Android 8 o posterior; autoriza
   la instalación desde la fuente usada cuando Android lo solicite.
2. Abre Nexo CRM y configura la dirección HTTPS del CRM correspondiente. La
   dirección predeterminada no garantiza que ese despliegue ya esté publicado.
3. Autoriza el dominio exacto de tu equipo Cloudflare Access e ingresa con el
   código por correo del propietario. Esta versión está orientada a ese método;
   proveedores OAuth que prohíban navegadores integrados requieren otra adaptación.
4. Prueba creación y edición, asignación de perfiles, pago, renovación, persistencia
   después de reiniciar la app, importación, exportación y apertura de WhatsApp.
5. Comprueba también el bloqueo de un correo no autorizado y el comportamiento al
   suspender una instancia desde el panel.

Las pruebas de compilación no sustituyen estas comprobaciones. Para distribuir
una versión pública se debe preparar la firma definitiva, validar en dispositivos
y completar los requisitos de la tienda si se elige Google Play.
