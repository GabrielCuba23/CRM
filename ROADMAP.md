# Próximas etapas del CRM

La versión actual incorpora Marketing y Redes sociales como herramientas de planificación y registro. No sustituye todavía la integración completa de un CRM comercial.

## Pendientes expresamente para más adelante

- Usuarios, equipos y permisos por rol.
- Embudo de ventas, etapas y oportunidades.
- Auditoría de modificaciones y accesos.
- Sincronización entre dispositivos: requiere desplegar el backend privado. GitHub Pages conserva los datos por navegador.

Estas tareas se posponen por indicación del usuario; no están implementadas en esta entrega.

## Marketing y redes: ruta de integración

| Etapa | Trabajo | Dificultad | Requisitos |
| --- | --- | --- | --- |
| Base disponible | Segmentos dinámicos, puntuación configurable, buyer persona descriptivo, campañas en borrador y WhatsApp manual | Media | Sin credenciales externas |
| Base social disponible | Borradores con fecha, registro manual de comentarios/DM/reseñas, ficha 360 y reportes del registro | Media | Sin credenciales externas |
| Meta conectado | Publicación y programación real, recepción por webhook y respuestas en Facebook/Instagram | Alta | Backend privado publicado, app de Meta, cuentas profesionales, OAuth y permisos aprobados según operación |
| Publicidad | Google Ads/Meta Ads, captación de leads y métricas de anuncios | Alta | Cuentas publicitarias, permisos, OAuth, token de desarrollador de Google Ads y posible revisión del proveedor |
| Email y RSS | Envío y seguimiento de email; publicación de feed RSS | Media/alta | Proveedor de email, dominio/verificación, bajas y consentimiento; definir origen/contenido del RSS |
| Analítica y enriquecimiento | Eventos web, atribución, métricas por publicación, SEO y datos enriquecidos | Alta | Sitio a medir, integración de eventos/consentimiento y fuentes o proveedores de datos |
| Otras redes | LinkedIn, TikTok, X y Google Business | Alta | Acceso a APIs y autorizaciones específicas; algunas operaciones/API pueden tener coste |

Las APIs no permiten todas las funciones en todos los tipos de cuenta. Guardar un borrador o una interacción manual no publica, responde ni recibe datos externos. Las conversiones actuales son resultados registrados manualmente; no representan atribución verificada de una plataforma.

La infraestructura personal puede empezar dentro de cuotas gratuitas. No se promete envío ilimitado ni coste cero de las APIs externas. El formato actual guarda el CRM como documento con límite de 1 MB en Cloudflare; escalar requiere dividir contactos, campañas e interacciones en tablas con paginación, índices y una cola de trabajos.

## Aplicación móvil y marca

Disponible: nombre del CRM y logo raster personalizables, diseño adaptable y PWA instalable desde un navegador compatible. La PWA necesita Internet y no almacena HTML privado, credenciales ni respuestas de la API en caché. No se ha generado un APK ni publicado en Google Play. Un APK puede evaluarse más adelante usando la PWA como base.

## Plataforma de marca blanca

Disponible en `retail/`: panel del operador, creación de instancias vacías con
marca propia, bases y sesiones separadas, propietario asignado, activación
privada y suspensión. Incluye una alternativa de aprovisionamiento Cloudflare
con Worker/D1/Access por cliente. Consulta [WHITE_LABEL.md](WHITE_LABEL.md).

Pendiente: despliegue público, dominios/HTTPS y respaldo verificado; conectar el
aprovisionamiento Cloudflare al panel, verificación de correo y recuperación de
acceso del modo servidor, cuotas, facturación e integraciones independientes.
El operador de la infraestructura conserva acceso técnico al almacenamiento.
Los equipos y permisos internos de cada CRM siguen pospuestos.
