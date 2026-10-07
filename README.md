# Downtime Control

Aplicación web local para capturar y analizar tiempos muertos mediante árboles de decisión. Está construida con HTML, CSS y JavaScript puro, por lo que se puede editar directamente en Visual Studio Code y no necesita instalar dependencias.

## Abrir en Visual Studio Code

1. Abre la carpeta `flex-downtime-platform` en Visual Studio Code.
2. Pulsa **Go Live** en la barra de estado. La página `index.html` de la raíz abrirá la aplicación automáticamente.
3. Alternativamente, abre una terminal en la carpeta del proyecto y ejecuta:

   ```bash
   python -m http.server 5500 --directory dist
   ```

4. Visita `http://localhost:5500`.

También funciona al abrir `dist/index.html` directamente, pero un servidor local evita restricciones del navegador al descargar archivos.

## Funciones incluidas

- Captura hora por hora por fecha, turno, área, línea y modelo; muestra los KPI y gráficas al inicio de la pantalla, registra tarjetas reales y calcula productividad y tiempo sin justificar. El tiempo se justifica con tickets de paro con cronómetro o cargas manuales de tiempo identificadas.
- La carga manual de DT pide autenticación, hora, duración, área, línea, equipo, problema, tarjetas de retrabajo y scrap, acción inmediata y departamento. Registra quién levantó la captura y requiere una cuenta de soporte para guardarla, dejando constancia de quién la cerró. Si se superan 5 tarjetas de retrabajo, hay 1 o más de scrap o el tiempo excede 30 minutos, también exige acciones de contención, correctiva y sistemática con owner seleccionado del catálogo y fecha de cierre.
- Cada carga manual admite de 1 a 60 minutos y se guarda como registro identificado para eventos cuyo ticket no se levantó en tiempo y forma. El acumulado manual de una hora no puede exceder 60 minutos; las cargas aparecen en Registros y se consideran en la justificación por hora y en los dashboards de tiempo caído.
- La producción por hora se guarda automáticamente como borrador por fecha, turno, área, línea y modelo; al completar las ocho horas queda marcada como turno completo y disponible en Registros. El dashboard muestra tarjetas corridas por semana y turno, filtrables por área, línea, turno y fechas.
- La captura hora por hora incluye un resumen del día con paros registrados, tiempo caído y tarjetas afectadas.
- Captura de paro de línea guiada en una ventana emergente: ubicación, problema, retrabajo, scrap y acción inmediata. Al pasar de ubicación al paso del problema inicia y muestra el cronómetro; al avanzar al paso final se detiene el tiempo de impacto mientras se asigna soporte y se completan las acciones requeridas.
- El catálogo permite crear cuentas con rol de operador o soporte. La lista de soporte inicial se convierte automáticamente en cuentas de soporte: el usuario es su nombre y la contraseña inicial es su número de empleado. Al autenticarse pueden cambiar la contraseña desde el botón del diálogo de acceso. Para abrir tickets se solicita usuario y contraseña; el ticket registra quién lo levantó. Operadores no pueden cerrar; el cierre requiere autenticación de soporte, asigna automáticamente ese usuario como quien atendió y conserva quién cerró. Las contraseñas se almacenan como hashes PBKDF2 con salt, no en texto legible. Como la aplicación no tiene un servidor de autenticación, esta autorización del lado del cliente no sustituye una autenticación centralizada y no protege contra quien pueda modificar el navegador o los datos locales.
- Al superar 5 tarjetas de retrabajo, registrar 1 o más de scrap, o exceder 30 minutos de paro, el ticket requiere acciones de contención, correctiva y sistemática, cada una con fecha de cierre y owner elegido exclusivamente del catálogo de owners.
- Horarios por turno: 1 (07:00–15:00), 2 (15:00–23:00) y 3 (23:00–07:00). Los reportes hora por hora se guardan y sincronizan junto con los catálogos cuando la nube está configurada.
- Catálogo de modelos con rate objetivo en tarjetas por hora y asociación a área y línea.
- Selección de área, línea, equipo y problema guiada por los catálogos.
- Concentrado 4Q con suma semanal, Pareto seleccionable, matriz de minutos por categoría y semana, y seguimiento persistente de acciones.
- Dashboard detallado con gráficas de problema, causa raíz, máquina, línea y turno.
- Historial con búsqueda y eliminación; los registros manuales históricos se conservan para consulta.
- Respaldo completo en JSON descargable, con registros, producción hora por hora, catálogos y usuarios; se puede importar desde otro navegador y restaura todos esos datos.
- Importación de registros desde Excel (.xlsx/.xls), agregándolos al historial existente.
- Descarga de plantilla Excel con Línea y Área en columnas separadas.
- Exportación CSV con las 14 columnas originales para Power BI.
- Catálogos editables sin modificar código.
- Acceso a la vista de catálogos protegido por NIP de 4 dígitos.
- Diseño adaptable para computadora, tableta y teléfono.

## Almacenamiento compartido

La app admite dos modos compartidos. Para el host Node.js del equipo, el servidor integrado sirve la página y una API del mismo origen que coordina la lectura y escritura del archivo central. La app conserva `localStorage` como respaldo local; con la API activa, el estado central es la fuente de verdad.

### Publicar mediante Node.js y SMB (sin iniciar sesión Microsoft)

1. Copia `server.js`, `start-server.ps1` y la carpeta `dist` a una carpeta local del host o a una ubicación accesible para el host. Node.js no requiere instalar paquetes: el servidor usa únicamente módulos integrados.
2. Confirma que la cuenta de Windows que ejecutará Node tenga permisos de modificar archivos en `\\10.106.53.191\Backup\dtm`.
3. En el host, ejecuta `start-server.ps1` desde PowerShell. Si las políticas bloquean scripts, abre PowerShell y ejecuta estos comandos manualmente desde la carpeta de la aplicación:

   ```powershell
   $env:DT_HOST = "0.0.0.0"
   $env:DT_PORT = "8080"
   $env:DT_DATA_FILE = "\\10.106.53.191\Backup\dtm\flex-downtime-state.json"
   node .\server.js
   ```

4. Desde el host, valida `http://localhost:8080/api/health`. Luego prueba la página `http://localhost:8080/` desde otra computadora de la red. Comparte esa URL usando el nombre DNS del host, por ejemplo `http://nombre-del-host:8080/`, no la ruta SMB.
5. Si otros equipos no conectan, pide a TI habilitar una regla de firewall solo para el puerto TCP 8080 y los segmentos de red necesarios. Para publicar por HTTPS o mantener Node activo al cerrar sesión, solicita a TI una configuración aprobada de proxy TLS y ejecución persistente.

El proceso Node debe permanecer encendido y con acceso a SMB. Ejecuta una sola instancia Node para ese archivo compartido; varias instancias en procesos o equipos distintos no comparten el bloqueo de escritura. El archivo `flex-downtime-state.json` se crea al primer guardado; reemplazos atómicos evitan archivos parciales y una revisión de estado detecta escrituras simultáneas. Si dos usuarios modifican exactamente el mismo registro o elemento de catálogo, la app muestra el conflicto, bloquea nuevas sincronizaciones en esa sesión y conserva una copia local de respaldo en `localStorage` como `flexDowntimePlatform.v1.serverConflictBackup`; recarga la página para recuperar la versión central y revisa el respaldo antes de descartar cambios locales. Los cambios independientes se combinan automáticamente y los navegadores consultan cambios compartidos cada cinco segundos.

**Seguridad:** esta API de despliegue no agrega autenticación de servidor. Las cuentas de operador/soporte actuales son verificadas por el JavaScript del navegador y no son una barrera contra alguien con acceso directo a la API. Usa el servidor solo en una red interna confiable; limita el puerto con firewall a los usuarios/redes autorizados y no lo publiques en Internet. Cualquier cliente que alcance la API puede leer o modificar el estado, incluidos los hashes de contraseñas. Para control de acceso fuerte, se requiere autenticación y autorización en servidor.

Si el host no puede mantener `node server.js` ejecutándose o no puede acceder al recurso SMB, la ruta SMB por sí sola no sincronizará navegadores. En ese caso se necesita que TI autorice la ejecución/red o usar una plataforma de datos compartidos.

### Microsoft 365 (alternativa)

Si se habilita Microsoft 365, todos los usuarios pueden leer y escribir el mismo archivo JSON en OneDrive for Business o SharePoint tras iniciar sesión.

#### Configuración con Microsoft 365

1. Registra una aplicación en Microsoft Entra ID (Azure AD) para la web.
2. Asigna los permisos adecuados a Microsoft Graph como `Files.ReadWrite.All`, `Sites.ReadWrite.All` y `User.Read`.
3. Crea una carpeta compartida en OneDrive for Business o SharePoint y guarda un archivo JSON central, por ejemplo `flex-downtime-data.json`.
4. Copia los valores de `Tenant ID`, `Client ID`, `Drive ID` y el nombre del archivo en `dist/supabase-config.js`.
5. Publica la app en GitHub Pages y cada usuario inicia sesión con su cuenta de Microsoft 365.

Si el archivo se comparte dentro de la organización, todos los usuarios ven el mismo historial sin depender del navegador del que capturaron los registros.

### Compatibilidad con Supabase

La app sigue aceptando una configuración legacy de Supabase para mantener compatibilidad con implementaciones previas. Si el bloque de Microsoft 365 está vacío, la lógica de cloud usa Supabase si se configura `supabaseUrl` y `supabaseAnonKey`.

Sin configurar ninguna nube, la app continuará funcionando solo en `localStorage` de cada navegador. Si activas Microsoft 365, la nube es la fuente compartida y la app conserva una copia local como respaldo temporal.

### Respaldar y mover datos entre navegadores

En **Registros**, usa **Crear respaldo JSON** para descargar una copia completa. Guárdala o muévela a `Documentos\DowntimeControl\Respaldos` (crea las carpetas si no existen). En otro navegador o después de borrar los datos del sitio, abre la aplicación, selecciona **Restaurar respaldo JSON**, elige ese archivo y confirma. Restaurar reemplaza todos los registros, reportes por hora, catálogos y usuarios actuales; toma un respaldo antes de restaurar si quieres conservarlos.

El navegador no permite que la página escriba sin permiso en una carpeta elegida por el usuario, por eso el respaldo se descarga primero a la carpeta de Descargas del navegador. En GitHub Pages, cada navegador conserva su propia copia local hasta que se importe el JSON. Los respaldos incluyen datos de producción, catálogos y hashes de contraseñas; guárdalos únicamente en una ubicación autorizada y no los publiques en GitHub.

### Límite del recurso SMB sin Node/API

Una carpeta como `\\10.106.53.191\Backup\dtm` puede compartir archivos estáticos, pero sin ejecutar el servidor Node/API de arriba no es un almacenamiento compartido de datos para el navegador. Cada usuario guarda `localStorage` en su propio perfil; publicar `index.html` en SMB no crea por sí solo una URL HTTP ni hace que todos vean los mismos registros.

Si Node no se puede ejecutar continuamente en el host, las alternativas soportables son:

1. Solicitar acceso corporativo a SharePoint/OneDrive y una aplicación Entra autorizada para que la app use el archivo JSON compartido con Microsoft Graph. La URL final debe ser HTTP(S), y su origen exacto debe estar registrado como URI de redirección en Entra. `redirectUri` queda vacío para usar automáticamente la URL en que se publique la app.
2. Solicitar a TI un servicio de datos ya administrado y accesible para los usuarios, con autenticación, control de concurrencia y respaldo; puede guardar los datos en el recurso SMB.
3. Si se conserva únicamente SMB, tratar esta app como solo local por navegador. Exportar e importar archivos manualmente no es sincronización en vivo y puede perder cambios concurrentes, así que no se recomienda como registro compartido oficial.

No se debe colocar una contraseña, token privado o secreto de aplicación en el JavaScript de la web. `tenantId`, `clientId` y permisos de Microsoft Graph requieren valores autorizados por el administrador de Microsoft 365; no se inventan ni se pueden deducir de la ruta SMB.

En Registros puedes descargar la **Plantilla Excel**, que tiene Línea y Área en columnas separadas, y cargarla con **Importar Excel**. La primera hoja debe conservar los 14 encabezados en el mismo orden; se validan los campos y se agregan los registros sin reemplazar los existentes. La lectura y generación de Excel requieren conexión para cargar la biblioteca desde CDN.

## Archivos principales

- `dist/index.html`: estructura y pantallas.
- `dist/styles.css`: colores, diseño y adaptación móvil.
- `dist/data.js`: catálogos y registros iniciales del tracker.
- `dist/supabase-config.js`: URL y clave pública opcionales para activar la nube.
- `dist/app.js`: árboles, captura, tablero, guardado y exportaciones.
- `server.js`: servidor HTTP y API para persistir/coordinar datos en el archivo central.
- `start-server.ps1`: inicio rápido apuntando al recurso SMB asignado.
- `supabase/schema.sql`: tablas, políticas RLS y publicación de cambios en tiempo real.

## Compatibilidad con el tracker actual

El CSV conserva estas columnas y este orden:

1. Fecha
2. Turno
3. Línea
4. Área
5. Tiempo afectado (min)
6. Departamento
7. Máquina
8. Problema
9. Unidades afectadas
10. Nombre de soporte
11. Causa raíz
12. Acción de contención
13. Acción correctiva
14. Acción sistemática

Los registros históricos que no tenían Área, Departamento o Máquina permanecen como `Sin clasificar` en el tablero hasta que se editen y completen.
