/*
 * Catálogos iniciales tomados del tracker "Captura Guiada".
 * La aplicación copia estos datos a localStorage en el primer uso.
 */
window.FLEX_DT_DEFAULTS = {
  version: 1,
  catalogs: {
    locations: [
      { line: "SMT", area: "SMT", machine: "Línea SMT" },
      { line: "SCP", area: "Edge Bonding", machine: "Camalot 1" },
      { line: "SCP", area: "Edge Bonding", machine: "Camalot 2" },
      { line: "SCP", area: "Plasma", machine: "Plasma 1" },
      { line: "SCP", area: "Plasma", machine: "Plasma 2" },
      { line: "SCP", area: "Fluxer", machine: "Fluxer 1" },
      { line: "L11A", area: "Edge Bonding", machine: "Camalot" },
      { line: "L11A", area: "Impresión GLC", machine: "DEK" },
      { line: "L11B", area: "Inspección SPI", machine: "SPI" },
      { line: "L13", area: "Fluxer", machine: "Fluxer" },
      { line: "L14A", area: "Edge Bonding", machine: "Camalot" },
      { line: "L14A", area: "Impresión GLC", machine: "DEK" },
      { line: "L14B", area: "Contramáscara", machine: "Contramáscara" },
      { line: "L1", area: "CR", machine: "Equipo CR" }
    ],
    departments: [
      "Ingeniería de Procesos",
      "Ingeniería de Equipos",
      "Manufactura",
      "Calidad",
      "Mantenimiento",
      "Proveedor / Servicio técnico"
    ],
    support: [
      "Alejandro",
      "Ana",
      "Carlos",
      "Caro / Rafa",
      "Daniela / Daniel",
      "Emma",
      "Gio / Yadhi",
      "Gio / Yadhi / Luis",
      "Jesús Loera",
      "Jorge",
      "Karen",
      "Luis",
      "Osvaldo"
    ],
    failures: [
      {
        machine: "TODAS",
        problem: "Falla de software",
        rootCause: "Software bloqueado o lento",
        containment: "Reiniciar el equipo y validar el ciclo antes de liberar producción",
        corrective: "Diagnosticar software, recursos de PC y registros del evento",
        systematic: "Definir respaldo, mantenimiento y control de versión del software"
      },
      {
        machine: "TODAS",
        problem: "Programa corrupto",
        rootCause: "Archivo del programa dañado",
        containment: "Cargar un respaldo validado y verificar la primera pieza",
        corrective: "Investigar la causa de corrupción y recuperar la versión aprobada",
        systematic: "Mantener respaldos controlados y verificar su integridad periódicamente"
      },
      {
        machine: "TODAS",
        problem: "Evento no catalogado",
        rootCause: "Pendiente de análisis",
        containment: "Documentar la condición y aplicar una contención temporal autorizada",
        corrective: "Abrir análisis de causa raíz con el responsable del proceso",
        systematic: "Actualizar este catálogo al cerrar el análisis"
      },
      {
        machine: "Línea SMT",
        problem: "Insuficiencia de soldadura",
        rootCause: "Jeringa agotada sin alarma",
        containment: "Cambiar la jeringa y validar el dispensado antes de arrancar",
        corrective: "Ajustar y validar el sensor de nivel de material",
        systematic: "Monitorear por turno la vida del cartucho y la alarma de material"
      },
      {
        machine: "Línea SMT",
        problem: "Insuficiencia de soldadura",
        rootCause: "Jeringa agotada sin repuesto",
        containment: "Usar un repuesto autorizado y realizar la purga con el parámetro estándar",
        corrective: "Definir un stock mínimo de jeringas para la línea",
        systematic: "Implementar control Kanban de repuestos y revisión por turno"
      },
      {
        machine: "Camalot",
        problem: "Insuficiencia de Edge Bonding",
        rootCause: "Material agotado",
        containment: "Cambiar la jeringa o cartucho y validar el cordón",
        corrective: "Validar el sensor de material y el parámetro de alarma",
        systematic: "Controlar la vida útil y disponibilidad de cartuchos"
      },
      {
        machine: "Camalot",
        problem: "Alarma de material bajo",
        rootCause: "Falsa alarma del sensor",
        containment: "Validar la purga y confirmar el dispensado correcto",
        corrective: "Ajustar el sensor de nivel de material",
        systematic: "Incluir verificación del sensor en mantenimiento preventivo"
      },
      {
        machine: "Camalot",
        problem: "Mal colocación de Edge Bonding",
        rootCause: "Punta doblada",
        containment: "Cambiar la punta y validar la trayectoria de dispensado",
        corrective: "Calibrar altura, posición y condición de la punta",
        systematic: "Agregar inspección de punta al arranque y cambio de turno"
      },
      {
        machine: "Camalot",
        problem: "Mal colocación de Edge Bonding",
        rootCause: "Punta incorrecta",
        containment: "Instalar la punta especificada y validar el dispensado",
        corrective: "Corregir la selección de punta en la instrucción de trabajo",
        systematic: "Aplicar identificación visual y verificación de número de punta"
      },
      {
        machine: "Camalot",
        problem: "Línea delgada",
        rootCause: "Cartucho contaminado o desgastado",
        containment: "Cambiar el cartucho y ejecutar una purga controlada",
        corrective: "Definir criterio de reemplazo por condición y horas de uso",
        systematic: "Registrar vida útil, limpieza y trazabilidad del cartucho"
      },
      {
        machine: "Camalot",
        problem: "Burbujas en dispensado",
        rootCause: "Fuga de aire en sistema de jeringa",
        containment: "Eliminar la fuga, purgar y validar el cordón",
        corrective: "Revisar conexiones, sellos y presión del sistema",
        systematic: "Incluir prueba de hermeticidad en el mantenimiento preventivo"
      },
      {
        machine: "Camalot",
        problem: "Error de verificación",
        rootCause: "Visión fuera de tolerancia",
        containment: "Confirmar fiduciales y validar una pieza antes de continuar",
        corrective: "Ajustar iluminación, cámara y tolerancias de visión",
        systematic: "Estandarizar parámetros y respaldo del programa de visión"
      },
      {
        machine: "Camalot",
        problem: "Cambio de jeringa requerido",
        rootCause: "Jeringa agotada",
        containment: "Cambiar la jeringa y validar el primer ciclo",
        corrective: "Asegurar alarma oportuna de nivel de material",
        systematic: "Controlar consumo y disponibilidad de jeringas por turno"
      },
      {
        machine: "Fluxer",
        problem: "Pesaje de flux fuera de especificación",
        rootCause: "Flux insuficiente",
        containment: "Ajustar el dispensado y confirmar el peso dentro de especificación",
        corrective: "Validar el sistema de bombeo y el parámetro de dispensado",
        systematic: "Programar verificación periódica de peso y capacidad del sistema"
      },
      {
        machine: "Fluxer",
        problem: "Voids",
        rootCause: "Mezcla de unidades de retrabajo",
        containment: "Separar material y validar pesos antes de continuar",
        corrective: "Reforzar la segregación entre retrabajo, GLC virgen y preforma",
        systematic: "Implementar identificación visual y auditoría de segregación"
      },
      {
        machine: "Fluxer",
        problem: "Macro de equipo no disponible",
        rootCause: "Paro de emergencia accionado",
        containment: "Restaurar el equipo con el respaldo autorizado",
        corrective: "Revisar la secuencia de recuperación y el origen del bloqueo",
        systematic: "Estandarizar respaldo y recuperación de la macro del equipo"
      },
      {
        machine: "Plasma",
        problem: "Falla de plasma",
        rootCause: "Software bloqueado",
        containment: "Reiniciar el equipo y validar el ciclo de plasma",
        corrective: "Analizar registros con el proveedor y actualizar el software si aplica",
        systematic: "Mantener respaldo y versión aprobada del software"
      },
      {
        machine: "Plasma",
        problem: "Proceso detenido",
        rootCause: "Argón agotado",
        containment: "Cambiar el tanque de argón y verificar presión y flujo",
        corrective: "Definir nivel mínimo y responsable del cambio de tanque",
        systematic: "Instalar alerta o control visual de disponibilidad de argón"
      },
      {
        machine: "SPI",
        problem: "Falla de visión",
        rootCause: "Problema de cámara o grabber",
        containment: "Reiniciar el programa y validar la inspección con una pieza",
        corrective: "Diagnosticar cámara, grabber, iluminación y comunicación",
        systematic: "Incluir verificación del sistema de visión en mantenimiento preventivo"
      },
      {
        machine: "DEK",
        problem: "Insuficiencia de GLC",
        rootCause: "Esténcil tapado",
        containment: "Limpiar el esténcil y reimprimir una unidad de validación",
        corrective: "Ajustar frecuencia y método de limpieza del esténcil",
        systematic: "Monitorear ciclos de impresión y cumplimiento de limpieza"
      },
      {
        machine: "DEK",
        problem: "Material bajo",
        rootCause: "Dispensado manual",
        containment: "Reponer material y verificar el depósito antes de continuar",
        corrective: "Habilitar aviso o dispensado automático cuando sea posible",
        systematic: "Estandarizar revisión de nivel cada 20 tarjetas o por frecuencia definida"
      },
      {
        machine: "Contramáscara",
        problem: "Contramáscara trabada",
        rootCause: "Software lento",
        containment: "Reiniciar el sistema y validar el movimiento",
        corrective: "Revisar recursos de PC y desempeño del software",
        systematic: "Definir capacidad mínima de PC y mantenimiento preventivo"
      },
      {
        machine: "Equipo CR",
        problem: "Cambio de jeringa EB",
        rootCause: "Jeringa agotada",
        containment: "Cambiar la jeringa y validar el dispensado",
        corrective: "Definir punto de reposición y stock mínimo",
        systematic: "Controlar consumo y disponibilidad de jeringas"
      },
      {
        machine: "Equipo CR",
        problem: "Cambio de argón",
        rootCause: "Argón agotado",
        containment: "Cambiar el tanque y verificar presión y flujo",
        corrective: "Definir nivel mínimo y responsable del cambio",
        systematic: "Instalar control visual de disponibilidad de argón"
      }
    ]
  },
  records: [
    { id: "HIST-001", date: "2026-09-04", shift: "1", line: "SMT", area: "", minutes: 15, department: "", machine: "", problem: "Insuficiencias", units: 1, support: "Ana", rootCause: "Se termina jeringa y Camalot no se alarma", containment: "Se hace cambio de jeringa para arrancar línea", corrective: "Se involucra al departamento de Equipos para ajuste de sensor", systematic: "", createdAt: "2026-09-04T12:00:00" },
    { id: "HIST-002", date: "2026-09-04", shift: "2", line: "SMT", area: "", minutes: 16, department: "", machine: "", problem: "Insuficiencias", units: 1, support: "Emma", rootCause: "Se termina jeringa y no hay repuesto", containment: "Se toma jeringa de línea 14, se retroalimenta a Manufactura y se realiza purga manual", corrective: "Seguimiento al monitoreo de cartuchos por fallas constantes", systematic: "", createdAt: "2026-09-04T15:00:00" },
    { id: "HIST-003", date: "2026-09-04", shift: "2", line: "SCP", area: "", minutes: 15, department: "", machine: "", problem: "Insuficiencias", units: 4, support: "Gio / Yadhi", rootCause: "Se termina jeringa de ambas Camalot y no se alarma", containment: "Se realiza cambio de jeringa de ambas Camalot", corrective: "Se involucra al departamento de Equipos para ajuste de sensor", systematic: "", createdAt: "2026-09-04T16:00:00" },
    { id: "HIST-004", date: "2026-09-04", shift: "2", line: "L11B KY", area: "", minutes: 15, department: "", machine: "", problem: "Falla de visión", units: 0, support: "Caro / Rafa", rootCause: "Problemas con grabber y cámara", containment: "Se reinicia programa y se realiza shutdown", corrective: "Diagnóstico de SPI por parte del proveedor", systematic: "", createdAt: "2026-09-04T17:00:00" },
    { id: "HIST-005", date: "2026-09-04", shift: "2", line: "L13 FLUXER", area: "", minutes: 20, department: "", machine: "", problem: "Pesaje de flux", units: 0, support: "Jesús Loera", rootCause: "Flux insuficiente causa voids", containment: "Se ajusta el dispensado del Fluxer", corrective: "Cambio de sistema de bombeo de flux a jeringa de 30 cc", systematic: "", createdAt: "2026-09-04T18:00:00" },
    { id: "HIST-006", date: "2026-09-04", shift: "2", line: "L11A EB", area: "", minutes: 5, department: "", machine: "", problem: "Material bajo", units: 0, support: "Emma", rootCause: "Falsa alarma por material bajo, jeringa pequeña", containment: "Se realiza validación de purga y correcto dispensado", corrective: "Se involucra al departamento de Equipos para ajuste de sensor", systematic: "", createdAt: "2026-09-04T19:00:00" },
    { id: "HIST-007", date: "2026-09-05", shift: "3", line: "L1 CR", area: "", minutes: 15, department: "", machine: "", problem: "Cambio de jeringa EB", units: 0, support: "Luis", rootCause: "Se termina jeringa", containment: "Se reemplaza", corrective: "n.a.", systematic: "n.a.", createdAt: "2026-09-05T02:00:00" },
    { id: "HIST-008", date: "2026-09-05", shift: "3", line: "L1 CR", area: "", minutes: 10, department: "", machine: "", problem: "Cambio de argón", units: 0, support: "Luis", rootCause: "Se terminó", containment: "Se reemplaza", corrective: "n.a.", systematic: "Instalación de tanques exteriores", createdAt: "2026-09-05T03:00:00" },
    { id: "HIST-009", date: "2026-09-05", shift: "3", line: "L13 FLUXER", area: "", minutes: 45, department: "", machine: "", problem: "Voids", units: 10, support: "Osvaldo", rootCause: "Mezcla de unidades de retrabajo", containment: "Validación de pesos y retroalimentación para no mezclar unidades de retrabajo con GLC virgen y preforma", corrective: "Validación de unidades", systematic: "", createdAt: "2026-09-05T04:00:00" },
    { id: "HIST-010", date: "2026-09-05", shift: "2", line: "L11A EB", area: "", minutes: 8, department: "", machine: "", problem: "Verify error", units: 0, support: "Emma", rootCause: "Problemas en la visión del equipo", containment: "Aceptar y continuar con el proceso como contención autorizada", corrective: "Ajustar la visión para evitar discrepancias en la verificación", systematic: "", createdAt: "2026-09-05T15:00:00" },
    { id: "HIST-011", date: "2026-09-05", shift: "2", line: "L14B", area: "", minutes: 6, department: "", machine: "", problem: "Contramáscara trabada", units: 1, support: "Emma", rootCause: "Software lento", containment: "Reiniciar", corrective: "PC con más RAM", systematic: "", createdAt: "2026-09-05T16:00:00" },
    { id: "HIST-012", date: "2026-09-05", shift: "2", line: "L14A", area: "", minutes: 3, department: "", machine: "", problem: "Insuficiencia en GLC", units: 1, support: "Emma", rootCause: "Problemas de esténcil tapado", containment: "Reimprimir", corrective: "Validación de esténcil y ciclo de limpieza", systematic: "", createdAt: "2026-09-05T17:00:00" },
    { id: "HIST-013", date: "2026-09-05", shift: "2", line: "L11A", area: "", minutes: 3, department: "", machine: "", problem: "Insuficiencias", units: 1, support: "Emma", rootCause: "El dispensado es manual", containment: "Se agrega conteo en DEK para avisar cada 20 tarjetas y revisar depósito de pasta", corrective: "Se solicita a Equipos habilitar el dispensado automático", systematic: "", createdAt: "2026-09-05T18:00:00" },
    { id: "HIST-014", date: "2026-09-07", shift: "1", line: "SCP", area: "", minutes: 30, department: "", machine: "", problem: "Falla de plasma 1, se traba software", units: 0, support: "Daniela / Daniel", rootCause: "TBD. Consultando con proveedor", containment: "Reiniciar equipo", corrective: "Actualizar software Plasma 1 / Plasma 2", systematic: "", createdAt: "2026-09-07T08:00:00" },
    { id: "HIST-015", date: "2026-09-07", shift: "1", line: "SCP", area: "", minutes: 30, department: "", machine: "", problem: "Camalot 1 / Camalot 2", units: 3, support: "Karen", rootCause: "Cambio de jeringa / cambio de cartucho", containment: "", corrective: "", systematic: "", createdAt: "2026-09-07T09:00:00" },
    { id: "HIST-016", date: "2026-09-07", shift: "2", line: "L14A", area: "", minutes: 5, department: "", machine: "", problem: "Mal colocación de EB", units: 2, support: "Alejandro", rootCause: "Punta doblada", containment: "Se endereza punta", corrective: "Calibración", systematic: "", createdAt: "2026-09-07T15:00:00" },
    { id: "HIST-017", date: "2026-09-07", shift: "2", line: "L11A", area: "", minutes: 7, department: "", machine: "", problem: "Alarma de material", units: 0, support: "Alejandro", rootCause: "Término de material", containment: "Se cambia material de jeringa pequeña", corrective: "", systematic: "", createdAt: "2026-09-07T16:00:00" },
    { id: "HIST-018", date: "2026-09-07", shift: "2", line: "L11A", area: "", minutes: 7, department: "", machine: "", problem: "Alarma de material bajo", units: 0, support: "Jorge", rootCause: "Material bajo", containment: "Se cambia cartucho de jeringa grande", corrective: "", systematic: "", createdAt: "2026-09-07T17:00:00" },
    { id: "HIST-019", date: "2026-09-07", shift: "2", line: "SCP", area: "", minutes: 120, department: "", machine: "", problem: "Fluxer 1 con problema de macro", units: 0, support: "Carlos", rootCause: "Uso accidental del paro de emergencia", containment: "", corrective: "Se contacta al proveedor para restaurar el equipo", systematic: "", createdAt: "2026-09-07T18:00:00" },
    { id: "HIST-020", date: "2026-09-07", shift: "2", line: "SCP", area: "", minutes: 60, department: "", machine: "", problem: "Programas corruptos en Camalot 2", units: 10, support: "Gio / Yadhi / Luis", rootCause: "Causa desconocida", containment: "Se cargan programas de backup", corrective: "Se realiza copia de programas en memoria SRA", systematic: "", createdAt: "2026-09-07T19:00:00" },
    { id: "HIST-021", date: "2026-09-07", shift: "2", line: "L14A", area: "", minutes: 5, department: "", machine: "", problem: "Insuficiencias", units: 1, support: "Alejandro", rootCause: "Término de material", containment: "Se cambia cartucho de jeringa grande", corrective: "", systematic: "", createdAt: "2026-09-07T20:00:00" },
    { id: "HIST-022", date: "2026-09-08", shift: "3", line: "L14A", area: "", minutes: 15, department: "", machine: "", problem: "Punta doblada", units: 1, support: "Luis", rootCause: "Punta mal colocada 19 en vez de 21", containment: "Cambio de punta", corrective: "Cambio de punta", systematic: "", createdAt: "2026-09-08T03:00:00" }
  ]
};
