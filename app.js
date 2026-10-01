(function () {
  "use strict";

  const STORAGE_KEY = "flexDowntimePlatform.v1";
  const CUSTOM_VALUE = "__custom";
  const RECORD_HEADERS = [
    "Fecha", "Turno", "Linea", "Area", "Tiempo afectado (min)", "Departamento", "Maquina", "Problema",
    "Unidades afectadas", "Nombre de soporte", "Causa Raiz", "Accion de Contension", "Accion Correctiva", "Accion sistematica"
  ];
  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));
  const clone = (value) => JSON.parse(JSON.stringify(value));
  const unique = (values) => [...new Set(values.filter(Boolean))].sort((a, b) => a.localeCompare(b, "es", { sensitivity: "base" }));

  let state = loadState();
  let editingId = null;
  let legacyPrefill = null;
  let confirmAction = null;

  const viewMeta = {
    capture: { eyebrow: "OPERACIÓN / CAPTURA", title: "Nuevo evento de tiempo muerto" },
    dashboard: { eyebrow: "ANÁLISIS / CUATRO CUADRANTES", title: "Concentrado de tiempos muertos" },
    analytics: { eyebrow: "ANÁLISIS / DETALLE", title: "Dashboard de tiempos muertos" },
    records: { eyebrow: "DATOS / HISTORIAL", title: "Registros capturados" },
    catalogs: { eyebrow: "CONFIGURACIÓN / ÁRBOLES", title: "Catálogos y reglas de decisión" }
  };

  const form = $("#downtimeForm");
  const fields = {
    date: $("#eventDate"),
    shift: $("#shift"),
    line: $("#line"),
    area: $("#area"),
    department: $("#department"),
    machine: $("#machine"),
    problem: $("#problem"),
    rootCause: $("#rootCause"),
    minutes: $("#minutes"),
    units: $("#units"),
    support: $("#support"),
    containment: $("#containment"),
    corrective: $("#corrective"),
    systematic: $("#systematic"),
    customProblem: $("#customProblem"),
    customRootCause: $("#customRootCause")
  };

  init();

  function init() {
    $("#todayLabel").textContent = new Intl.DateTimeFormat("es-MX", {
      weekday: "short",
      day: "2-digit",
      month: "short"
    }).format(new Date()).replace(".", "");

    bindNavigation();
    bindCapture();
    bindDashboard();
    bindAnalytics();
    bindRecords();
    bindCatalogs();
    bindConfirmDialog();
    initializeForm();
    populateDashboardFilters();
    renderTodaySummary();
    renderRecords();
    renderCatalogs();
    renderDashboard();
  }

  function loadState() {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (!saved) return clone(window.FLEX_DT_DEFAULTS);
      const parsed = JSON.parse(saved);
      if (!parsed || !Array.isArray(parsed.records) || !parsed.catalogs) throw new Error("Estructura inválida");
      const required = ["locations", "departments", "support", "failures"];
      if (required.some((key) => !Array.isArray(parsed.catalogs[key]))) throw new Error("Catálogos inválidos");
      return parsed;
    } catch (error) {
      console.warn("No fue posible cargar los datos locales. Se restauró la base inicial.", error);
      return clone(window.FLEX_DT_DEFAULTS);
    }
  }

  function saveState() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  }

  function bindNavigation() {
    $$(".nav-item").forEach((button) => {
      button.addEventListener("click", () => navigate(button.dataset.view));
    });
    $("#goDashboard").addEventListener("click", () => navigate("dashboard"));
    $("#viewToday").addEventListener("click", () => {
      const today = localDateISO();
      $("#filterFrom").value = today;
      $("#filterTo").value = today;
      navigate("dashboard");
    });
  }

  function navigate(viewName) {
    const meta = viewMeta[viewName] || viewMeta.capture;
    $$("[data-view-panel]").forEach((panel) => panel.classList.toggle("active", panel.dataset.viewPanel === viewName));
    $$(".nav-item").forEach((button) => button.classList.toggle("active", button.dataset.view === viewName));
    $("#viewEyebrow").textContent = meta.eyebrow;
    $("#viewTitle").textContent = editingId && viewName === "capture" ? "Editar evento de tiempo muerto" : meta.title;

    if (viewName === "dashboard") renderDashboard();
    if (viewName === "analytics") renderAnalyticsDashboard();
    if (viewName === "records") renderRecords();
    if (viewName === "catalogs") renderCatalogs();
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function bindCapture() {
    fields.line.addEventListener("change", onLineChange);
    fields.area.addEventListener("change", onAreaChange);
    fields.machine.addEventListener("change", onMachineChange);
    fields.problem.addEventListener("change", onProblemChange);
    fields.rootCause.addEventListener("change", onRootCauseChange);

    form.addEventListener("input", updateFormStatus);
    form.addEventListener("change", updateFormStatus);
    form.addEventListener("submit", saveRecordFromForm);
    $("#clearForm").addEventListener("click", () => resetForm(true));
    $("#cancelEdit").addEventListener("click", () => resetForm(true));

    document.addEventListener("keydown", (event) => {
      if (!(event.ctrlKey && event.shiftKey)) return;
      if (event.key.toLowerCase() === "g") {
        event.preventDefault();
        navigate("capture");
        form.requestSubmit();
      }
      if (event.key.toLowerCase() === "l") {
        event.preventDefault();
        resetForm(true);
      }
    });
  }

  function initializeForm() {
    populateBaseFormOptions();
    fields.date.value = localDateISO();
    populateSelect(fields.area, [], "Selecciona una línea");
    populateSelect(fields.machine, [], "Selecciona un área");
    populateSelect(fields.problem, [], "Selecciona una máquina");
    populateSelect(fields.rootCause, [], "Selecciona un problema");
    fields.area.disabled = true;
    fields.machine.disabled = true;
    fields.problem.disabled = true;
    fields.rootCause.disabled = true;
    toggleCustomFields(false, false);
    updateDecisionPath();
    updateFormStatus();
  }

  function populateBaseFormOptions(preserve = {}) {
    const lines = unique(state.catalogs.locations.map((item) => item.line));
    populateSelect(fields.line, lines, "Seleccionar", preserve.line || fields.line.value);
    populateSelect(fields.department, unique(state.catalogs.departments), "Seleccionar", preserve.department || fields.department.value);
    populateSelect(fields.support, unique(state.catalogs.support), "Seleccionar", preserve.support || fields.support.value);
  }

  function populateSelect(select, options, placeholder, selected = "") {
    select.replaceChildren();
    const placeholderOption = document.createElement("option");
    placeholderOption.value = "";
    placeholderOption.textContent = placeholder;
    select.append(placeholderOption);

    options.forEach((option) => {
      const item = typeof option === "string" ? { value: option, label: option } : option;
      const element = document.createElement("option");
      element.value = item.value;
      element.textContent = item.label;
      select.append(element);
    });

    if (selected && !Array.from(select.options).some((option) => option.value === selected)) {
      const legacy = document.createElement("option");
      legacy.value = selected;
      legacy.textContent = selected;
      legacy.dataset.legacy = "true";
      select.append(legacy);
    }
    select.value = selected || "";
  }

  function onLineChange() {
    const areas = unique(state.catalogs.locations.filter((item) => item.line === fields.line.value).map((item) => item.area));
    populateSelect(fields.area, areas, areas.length ? "Seleccionar" : "Sin áreas catalogadas");
    fields.area.disabled = !fields.line.value || !areas.length;
    populateSelect(fields.machine, [], "Selecciona un área");
    populateSelect(fields.problem, [], "Selecciona una máquina");
    populateSelect(fields.rootCause, [], "Selecciona un problema");
    fields.machine.disabled = true;
    fields.problem.disabled = true;
    fields.rootCause.disabled = true;
    clearActions();
    toggleCustomFields(false, false);
    updateDecisionPath();
  }

  function onAreaChange() {
    const machines = unique(state.catalogs.locations
      .filter((item) => item.line === fields.line.value && item.area === fields.area.value)
      .map((item) => item.machine));
    populateSelect(fields.machine, machines, machines.length ? "Seleccionar" : "Sin máquinas catalogadas");
    fields.machine.disabled = !fields.area.value || !machines.length;
    populateSelect(fields.problem, [], "Selecciona una máquina");
    populateSelect(fields.rootCause, [], "Selecciona un problema");
    fields.problem.disabled = true;
    fields.rootCause.disabled = true;
    clearActions();
    toggleCustomFields(false, false);
    updateDecisionPath();
  }

  function onMachineChange() {
    const rules = failureRulesForMachine(fields.machine.value);
    const problems = unique(rules.map((rule) => rule.problem)).map((value) => ({ value, label: value }));
    problems.push({ value: CUSTOM_VALUE, label: "Otro / no catalogado" });
    populateSelect(fields.problem, problems, problems.length ? "Seleccionar" : "Sin problemas catalogados");
    fields.problem.disabled = !fields.machine.value;
    populateSelect(fields.rootCause, [], "Selecciona un problema");
    fields.rootCause.disabled = true;
    clearActions();
    toggleCustomFields(false, false);

    if (legacyPrefill && fields.machine.value) {
      const record = legacyPrefill;
      const available = Array.from(fields.problem.options).some((option) => normalize(option.value) === normalize(record.problem));
      fields.problem.value = available ? Array.from(fields.problem.options).find((option) => normalize(option.value) === normalize(record.problem)).value : CUSTOM_VALUE;
      if (!available) fields.customProblem.value = record.problem || "";
      onProblemChange();

      const causeAvailable = Array.from(fields.rootCause.options).some((option) => normalize(option.value) === normalize(record.rootCause));
      fields.rootCause.value = causeAvailable ? Array.from(fields.rootCause.options).find((option) => normalize(option.value) === normalize(record.rootCause)).value : CUSTOM_VALUE;
      if (!causeAvailable) fields.customRootCause.value = record.rootCause || "";
      onRootCauseChange(false);
      fields.containment.value = record.containment || "";
      fields.corrective.value = record.corrective || "";
      fields.systematic.value = record.systematic || "";
      legacyPrefill = null;
    }
    updateDecisionPath();
  }

  function onProblemChange() {
    clearActions();
    const isCustomProblem = fields.problem.value === CUSTOM_VALUE;
    $("#customProblemRow").classList.toggle("hidden", !isCustomProblem);
    fields.customProblem.required = isCustomProblem;

    if (!fields.problem.value) {
      populateSelect(fields.rootCause, [], "Selecciona un problema");
      fields.rootCause.disabled = true;
      toggleCustomFields(isCustomProblem, false);
      updateDecisionPath();
      return;
    }

    if (isCustomProblem) {
      populateSelect(fields.rootCause, [{ value: CUSTOM_VALUE, label: "Escribir causa o condición" }], "Seleccionar", CUSTOM_VALUE);
      fields.rootCause.disabled = false;
      toggleCustomFields(true, true);
    } else {
      const causes = unique(failureRulesForMachine(fields.machine.value)
        .filter((rule) => rule.problem === fields.problem.value)
        .map((rule) => rule.rootCause))
        .map((value) => ({ value, label: value }));
      causes.push({ value: CUSTOM_VALUE, label: "Otra causa / pendiente de análisis" });
      populateSelect(fields.rootCause, causes, "Seleccionar");
      fields.rootCause.disabled = false;
      toggleCustomFields(false, false);
    }
    updateDecisionPath();
  }

  function onRootCauseChange(fillSuggestedActions = true) {
    const custom = fields.rootCause.value === CUSTOM_VALUE;
    $("#customCauseRow").classList.toggle("hidden", !custom);
    fields.customRootCause.required = custom;

    if (custom) {
      if (fillSuggestedActions) clearActions();
    } else if (fields.rootCause.value && fillSuggestedActions) {
      const rule = failureRulesForMachine(fields.machine.value).find((item) =>
        item.problem === fields.problem.value && item.rootCause === fields.rootCause.value
      );
      if (rule) {
        fields.containment.value = rule.containment || "";
        fields.corrective.value = rule.corrective || "";
        fields.systematic.value = rule.systematic || "";
      }
    }
    updateDecisionPath();
    updateFormStatus();
  }

  function toggleCustomFields(problemVisible, causeVisible) {
    $("#customProblemRow").classList.toggle("hidden", !problemVisible);
    $("#customCauseRow").classList.toggle("hidden", !causeVisible);
    fields.customProblem.required = problemVisible;
    fields.customRootCause.required = causeVisible;
  }

  function clearActions() {
    fields.containment.value = "";
    fields.corrective.value = "";
    fields.systematic.value = "";
  }

  function failureRulesForMachine(machine) {
    if (!machine) return [];
    const normalized = normalize(machine);
    const families = [normalized];
    if (normalized.includes("camalot")) families.push("camalot");
    if (normalized.includes("plasma")) families.push("plasma");
    if (normalized.includes("fluxer")) families.push("fluxer");
    return state.catalogs.failures.filter((rule) => {
      const ruleMachine = normalize(rule.machine);
      return ruleMachine === "todas" || families.includes(ruleMachine);
    });
  }

  function updateDecisionPath() {
    const path = {
      line: fields.line.value,
      area: fields.area.value,
      machine: fields.machine.value,
      problem: fields.problem.value === CUSTOM_VALUE ? fields.customProblem.value : fields.problem.value,
      rootCause: fields.rootCause.value === CUSTOM_VALUE ? fields.customRootCause.value : fields.rootCause.value
    };
    const waiting = {
      line: "Sin seleccionar",
      area: fields.line.value ? "Sin seleccionar" : "Esperando línea",
      machine: fields.area.value ? "Sin seleccionar" : "Esperando área",
      problem: fields.machine.value ? "Sin seleccionar" : "Esperando máquina",
      rootCause: fields.problem.value ? "Sin seleccionar" : "Esperando problema"
    };
    Object.entries(path).forEach(([key, value]) => {
      const row = $(`[data-path="${key}"]`);
      if (!row) return;
      row.classList.toggle("selected", Boolean(value));
      $("strong", row).textContent = value || waiting[key];
    });
  }

  function updateFormStatus() {
    updateDecisionPath();
    const status = $("#formStatus");
    if (form.checkValidity()) {
      status.textContent = editingId ? "Registro listo para actualizar." : "Registro completo y listo para guardar.";
      status.className = "validation-message ready";
      return;
    }
    const required = $$('[required]', form).filter((field) => !field.disabled);
    const completed = required.filter((field) => String(field.value).trim() !== "").length;
    status.textContent = `Progreso: ${completed} de ${required.length} campos obligatorios.`;
    status.className = "validation-message";
  }

  function saveRecordFromForm(event) {
    event.preventDefault();
    if (!form.checkValidity()) {
      form.reportValidity();
      $("#formStatus").textContent = "Revisa los campos marcados antes de guardar.";
      $("#formStatus").className = "validation-message error";
      return;
    }

    const existing = editingId ? state.records.find((record) => record.id === editingId) : null;
    const record = {
      id: existing ? existing.id : createRecordId(),
      date: fields.date.value,
      shift: fields.shift.value,
      line: fields.line.value.trim(),
      area: fields.area.value.trim(),
      minutes: Number(fields.minutes.value),
      department: fields.department.value.trim(),
      machine: fields.machine.value.trim(),
      problem: (fields.problem.value === CUSTOM_VALUE ? fields.customProblem.value : fields.problem.value).trim(),
      units: Number(fields.units.value),
      support: fields.support.value.trim(),
      rootCause: (fields.rootCause.value === CUSTOM_VALUE ? fields.customRootCause.value : fields.rootCause.value).trim(),
      containment: fields.containment.value.trim(),
      corrective: fields.corrective.value.trim(),
      systematic: fields.systematic.value.trim(),
      actionStatus: existing?.actionStatus || { containment: "pending", corrective: "pending", systematic: "pending" },
      createdAt: existing ? existing.createdAt : new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    if (existing) {
      state.records = state.records.map((item) => item.id === editingId ? record : item);
      showToast("Registro actualizado correctamente.");
    } else {
      state.records.push(record);
      showToast("Evento guardado. El concentrado 4Q ya fue actualizado.");
    }
    saveState();
    renderTodaySummary();
    resetForm(false);
  }

  function resetForm(showMessage) {
    editingId = null;
    legacyPrefill = null;
    form.reset();
    $("#cancelEdit").classList.add("hidden");
    $("#saveRecord").textContent = "Guardar registro";
    $("#viewTitle").textContent = viewMeta.capture.title;
    initializeForm();
    if (showMessage) showToast("Formulario limpio.");
  }

  function createRecordId() {
    const now = new Date();
    const stamp = [
      now.getFullYear(),
      String(now.getMonth() + 1).padStart(2, "0"),
      String(now.getDate()).padStart(2, "0"),
      String(now.getHours()).padStart(2, "0"),
      String(now.getMinutes()).padStart(2, "0"),
      String(now.getSeconds()).padStart(2, "0")
    ].join("");
    return `DT-${stamp}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
  }

  function renderTodaySummary() {
    const todayRecords = state.records.filter((record) => record.date === localDateISO());
    $("#todayEvents").textContent = formatNumber(todayRecords.length);
    $("#todayMinutes").textContent = formatNumber(sum(todayRecords, "minutes"));
    $("#todayUnits").textContent = formatNumber(sum(todayRecords, "units"));
  }

  /* Dashboard */
  function bindDashboard() {
    ["#filterFrom", "#filterTo", "#filterShift", "#filterLine", "#filterArea", "#dashboardMetric", "#q2Group", "#q3Group", "#q4StatusFilter"]
      .forEach((selector) => $(selector).addEventListener("change", renderDashboard));
    $("#resetFilters").addEventListener("click", () => {
      $("#filterFrom").value = "";
      $("#filterTo").value = "";
      $("#filterShift").value = "";
      $("#filterLine").value = "";
      $("#filterArea").value = "";
      $("#dashboardMetric").value = "minutes";
      renderDashboard();
    });
    $("#exportDashboardCsv").addEventListener("click", () => exportCsv(getDashboardRecords(), "tiempos_muertos_filtrados"));
  }

  function bindAnalytics() {
    ["#analyticsFrom", "#analyticsTo", "#analyticsShift", "#analyticsLine", "#analyticsArea", "#analyticsMetric"]
      .forEach((selector) => $(selector).addEventListener("change", renderAnalyticsDashboard));
    $("#resetAnalyticsFilters").addEventListener("click", () => {
      $("#analyticsFrom").value = "";
      $("#analyticsTo").value = "";
      $("#analyticsShift").value = "";
      $("#analyticsLine").value = "";
      $("#analyticsArea").value = "";
      $("#analyticsMetric").value = "minutes";
      renderAnalyticsDashboard();
    });
    $("#exportAnalyticsCsv").addEventListener("click", () => exportCsv(getAnalyticsRecords(), "dashboard_tiempos_muertos"));
  }

  function populateDashboardFilters() {
    const selectedValues = {
      filterLine: $("#filterLine").value,
      filterArea: $("#filterArea").value,
      analyticsLine: $("#analyticsLine").value,
      analyticsArea: $("#analyticsArea").value
    };
    const lines = unique([...state.catalogs.locations.map((item) => item.line), ...state.records.map((item) => item.line)]);
    const areas = unique([...state.catalogs.locations.map((item) => item.area), ...state.records.map((item) => item.area)]);
    if (state.records.some((record) => !String(record.area || "").trim()) && !areas.includes("Sin clasificar")) areas.push("Sin clasificar");
    populateSelect($("#filterLine"), lines, "Todas", selectedValues.filterLine);
    populateSelect($("#filterArea"), areas, "Todas", selectedValues.filterArea);
    populateSelect($("#analyticsLine"), lines, "Todas", selectedValues.analyticsLine);
    populateSelect($("#analyticsArea"), areas, "Todas", selectedValues.analyticsArea);
  }

  function getDashboardRecords() {
    return getRecordsByFilters({ from: "#filterFrom", to: "#filterTo", shift: "#filterShift", line: "#filterLine", area: "#filterArea" });
  }

  function getAnalyticsRecords() {
    return getRecordsByFilters({ from: "#analyticsFrom", to: "#analyticsTo", shift: "#analyticsShift", line: "#analyticsLine", area: "#analyticsArea" });
  }

  function getRecordsByFilters(selectors) {
    const from = $(selectors.from).value;
    const to = $(selectors.to).value;
    const shift = $(selectors.shift).value;
    const line = $(selectors.line).value;
    const area = $(selectors.area).value;
    return state.records.filter((record) => {
      if (from && record.date < from) return false;
      if (to && record.date > to) return false;
      if (shift && String(record.shift) !== shift) return false;
      if (line && record.line !== line) return false;
      if (area === "Sin clasificar" && String(record.area || "").trim()) return false;
      if (area && area !== "Sin clasificar" && record.area !== area) return false;
      return true;
    });
  }

  function renderDashboard() {
    const records = getDashboardRecords();
    const minutes = sum(records, "minutes");
    const units = sum(records, "units");
    const events = records.length;
    const topArea = aggregate(records, "area", "minutes")[0];

    $("#kpiMinutes").textContent = `${formatNumber(minutes)} min`;
    $("#kpiHours").textContent = `${(minutes / 60).toFixed(1)} h acumuladas`;
    $("#kpiEvents").textContent = formatNumber(events);
    $("#kpiAverage").textContent = `${events ? Math.round(minutes / events) : 0} min por evento`;
    $("#kpiUnits").textContent = formatNumber(units);
    $("#kpiUnitRate").textContent = `${events ? (units / events).toFixed(1) : "0.0"} por evento`;
    $("#kpiTopArea").textContent = topArea ? topArea.label : "—";
    $("#kpiTopAreaValue").textContent = topArea ? `${formatNumber(topArea.value)} min acumulados` : "Sin registros";

    const metric = $("#dashboardMetric").value;
    renderWeeklyBars(records);
    renderParetoChart(records, $("#q2Group").value, metric);
    renderWeeklyMatrix(records, $("#q3Group").value);
    renderActions(records);

    const scopeParts = [];
    if ($("#filterFrom").value || $("#filterTo").value) scopeParts.push(`${$("#filterFrom").value || "inicio"} a ${$("#filterTo").value || "hoy"}`);
    if ($("#filterShift").value) scopeParts.push(`turno ${$("#filterShift").value}`);
    if ($("#filterLine").value) scopeParts.push($("#filterLine").value);
    if ($("#filterArea").value) scopeParts.push($("#filterArea").value);
    $("#dashboardScope").textContent = `${formatNumber(records.length)} registros${scopeParts.length ? ` · ${scopeParts.join(" · ")}` : " · alcance completo"}`;
  }

  function renderAnalyticsDashboard() {
    const records = getAnalyticsRecords();
    const minutes = sum(records, "minutes");
    const events = records.length;
    const topProblem = aggregate(records, "problem", "minutes")[0];
    $("#analyticsMinutes").textContent = `${formatNumber(minutes)} min`;
    $("#analyticsEvents").textContent = formatNumber(events);
    $("#analyticsUnits").textContent = formatNumber(sum(records, "units"));
    $("#analyticsTopProblem").textContent = topProblem ? topProblem.label : "—";
    $("#analyticsTopProblemValue").textContent = topProblem ? `${formatNumber(topProblem.value)} min acumulados` : "Sin registros";

    const metric = $("#analyticsMetric").value;
    renderAnalyticsCategoryChart("#analyticsProblemChart", records, "problem", metric, "#c55b38");
    renderAnalyticsCategoryChart("#analyticsRootCauseChart", records, "rootCause", metric, "#357fa2");
    renderAnalyticsCategoryChart("#analyticsMachineChart", records, "machine", metric, "#078a78");
    renderAnalyticsCategoryChart("#analyticsLineChart", records, "line", metric, "#c28a19");
    renderAnalyticsCategoryChart("#analyticsShiftChart", records, "shift", metric, "#7652a6");

    const scopeParts = [];
    if ($("#analyticsFrom").value || $("#analyticsTo").value) scopeParts.push(`${$("#analyticsFrom").value || "inicio"} a ${$("#analyticsTo").value || "hoy"}`);
    if ($("#analyticsShift").value) scopeParts.push(`turno ${$("#analyticsShift").value}`);
    if ($("#analyticsLine").value) scopeParts.push($("#analyticsLine").value);
    if ($("#analyticsArea").value) scopeParts.push($("#analyticsArea").value);
    $("#analyticsScope").textContent = `${formatNumber(records.length)} registros${scopeParts.length ? ` · ${scopeParts.join(" · ")}` : " · alcance completo"}`;
  }

  function renderAnalyticsCategoryChart(selector, records, group, metric, color) {
    const container = $(selector);
    container.replaceChildren();
    const data = aggregate(records, group, metric);
    if (!data.length) {
      container.append(emptyChart("No hay datos para los filtros seleccionados."));
      return;
    }
    if (group === "shift") data.sort((a, b) => Number(a.label) - Number(b.label));
    const maximum = Math.max(...data.map((item) => item.value), 1);
    const chart = document.createElement("div");
    chart.className = "analytics-bars";
    data.forEach((item) => {
      const column = document.createElement("div");
      column.className = "analytics-bar-column";
      const value = document.createElement("strong");
      value.textContent = formatNumber(item.value);
      value.title = metricValue(item.value, metric);
      const track = document.createElement("div");
      track.className = "analytics-bar-track";
      const bar = document.createElement("div");
      bar.className = "analytics-bar";
      bar.style.height = `${item.value ? Math.max(2, item.value / maximum * 100) : 0}%`;
      bar.style.setProperty("--analytics-color", color);
      track.append(bar);
      const label = document.createElement("span");
      label.textContent = group === "shift" ? `Turno ${item.label}` : item.label;
      label.title = label.textContent;
      column.append(value, track, label);
      chart.append(column);
    });
    container.append(chart);
  }

  function aggregate(records, key, metric) {
    const values = new Map();
    records.forEach((record) => {
      const label = String(record[key] || "Sin clasificar").trim() || "Sin clasificar";
      const amount = metric === "events" ? 1 : Number(record[metric] || 0);
      values.set(label, (values.get(label) || 0) + amount);
    });
    return [...values.entries()]
      .map(([label, value]) => ({ label, value }))
      .sort((a, b) => b.value - a.value || a.label.localeCompare(b.label, "es"));
  }

  function renderWeeklyBars(records) {
    const container = $("#locationBars");
    container.replaceChildren();
    const totals = new Map();
    records.forEach((record) => {
      if (!record.date) return;
      const week = startOfWeek(record.date);
      totals.set(week, (totals.get(week) || 0) + (Number(record.minutes) || 0));
    });
    if (!totals.size) {
      container.append(emptyChart("La tendencia semanal aparecerá cuando existan registros."));
      $("#q1Caption").textContent = "Sin datos";
      return;
    }
    const visible = getDashboardWeeks(records).map((week) => ({ ...week, value: totals.get(week.start) || 0 }));
    const max = Math.max(...visible.map((item) => item.value), 1);
    const chart = document.createElement("div");
    chart.className = "vertical-bars";
    visible.forEach((item) => {
      const column = document.createElement("div");
      column.className = "vertical-bar-column";
      const value = document.createElement("strong");
      value.textContent = formatNumber(item.value);
      value.title = `${item.label}: ${formatNumber(item.value)} min`;
      const track = document.createElement("div");
      track.className = "vertical-bar-track";
      const bar = document.createElement("div");
      bar.className = "weekly-bar-fill";
      bar.style.height = `${Math.max(item.value > 0 ? 2 : 0, item.value / max * 100)}%`;
      track.append(bar);
      const label = document.createElement("span");
      label.textContent = item.label;
      label.title = `Semana del ${formatDate(item.start)}`;
      column.append(value, track, label);
      chart.append(column);
    });
    container.append(chart);
    $("#q1Caption").textContent = `${visible[0].label}–${visible.at(-1).label} · minutos`;
  }

  function renderParetoChart(records, group, metric) {
    const container = $("#problemPareto");
    container.replaceChildren();
    const all = aggregate(records, group, metric);
    if (!all.length) {
      container.append(emptyChart("No hay datos para el Pareto."));
      return;
    }
    const items = all.length > 8
      ? [...all.slice(0, 7), { label: "Otros", value: all.slice(7).reduce((total, item) => total + item.value, 0) }]
      : all;
    const total = all.reduce((sumValue, item) => sumValue + item.value, 0);
    const width = 640;
    const height = 250;
    const pad = { left: 42, right: 40, top: 16, bottom: 70 };
    const graphWidth = width - pad.left - pad.right;
    const graphHeight = height - pad.top - pad.bottom;
    const max = Math.max(...items.map((item) => item.value), 1);
    const slot = graphWidth / items.length;
    const points = [];
    const svg = svgElement("svg", { viewBox: `0 0 ${width} ${height}`, role: "img", "aria-label": `Pareto por ${group}` });
    [0, .5, 1].forEach((ratio) => {
      const y = pad.top + graphHeight * (1 - ratio);
      svg.append(svgElement("line", { x1: pad.left, x2: width - pad.right, y1: y, y2: y, class: "chart-grid-line" }));
      const countLabel = svgElement("text", { x: pad.left - 7, y: y + 4, "text-anchor": "end" });
      countLabel.textContent = formatNumber(max * ratio);
      svg.append(countLabel);
      const percentLabel = svgElement("text", { x: width - pad.right + 7, y: y + 4, "text-anchor": "start" });
      percentLabel.textContent = `${Math.round(ratio * 100)}%`;
      svg.append(percentLabel);
    });
    let cumulative = 0;
    items.forEach((item, index) => {
      const barWidth = Math.min(42, slot * .62);
      const x = pad.left + index * slot + (slot - barWidth) / 2;
      const barHeight = item.value / max * graphHeight;
      const bar = svgElement("rect", { x, y: pad.top + graphHeight - barHeight, width: barWidth, height: barHeight, rx: 3, class: "pareto-bar" });
      cumulative += total ? item.value / total * 100 : 0;
      const title = svgElement("title");
      title.textContent = `${item.label}: ${metricValue(item.value, metric)} · acumulado ${cumulative.toFixed(1)}%`;
      bar.append(title);
      svg.append(bar);
      points.push({ x: x + barWidth / 2, y: pad.top + graphHeight * (1 - cumulative / 100) });
      const category = svgElement("text", { x: x + barWidth / 2, y: height - 12, "text-anchor": "end", transform: `rotate(-35 ${x + barWidth / 2} ${height - 12})` });
      category.textContent = item.label.length > 16 ? `${item.label.slice(0, 15)}…` : item.label;
      const categoryTitle = svgElement("title");
      categoryTitle.textContent = item.label;
      category.append(categoryTitle);
      svg.append(category);
    });
    svg.append(svgElement("polyline", { points: points.map((point) => `${point.x},${point.y}`).join(" "), class: "pareto-line" }));
    points.forEach((point, index) => {
      const dot = svgElement("circle", { cx: point.x, cy: point.y, r: 3, class: "pareto-point" });
      const title = svgElement("title");
      const subtotal = items.slice(0, index + 1).reduce((sumValue, item) => sumValue + item.value, 0);
      title.textContent = `Acumulado: ${total ? (subtotal / total * 100).toFixed(1) : "0.0"}%`;
      dot.append(title);
      svg.append(dot);
    });
    container.append(svg);
  }

  function renderWeeklyMatrix(records, group) {
    const container = $("#trendChart");
    container.replaceChildren();
    const weeks = getDashboardWeeks(records);
    const weekStarts = new Set(weeks.map((week) => week.start));
    const scopedRecords = records.filter((record) => record.date && weekStarts.has(startOfWeek(record.date)));
    if (!scopedRecords.length) {
      container.append(emptyChart("La tabla semanal aparecerá cuando existan registros en este periodo."));
      return;
    }
    const categories = new Map();
    const weekTotals = new Map(weeks.map((week) => [week.start, 0]));
    scopedRecords.forEach((record) => {
      const label = String(record[group] || "Sin clasificar").trim() || "Sin clasificar";
      const week = startOfWeek(record.date);
      if (!categories.has(label)) categories.set(label, new Map(weeks.map((item) => [item.start, 0])));
      const minutes = Number(record.minutes) || 0;
      categories.get(label).set(week, categories.get(label).get(week) + minutes);
      weekTotals.set(week, weekTotals.get(week) + minutes);
    });
    const rows = [...categories.entries()]
      .map(([label, values]) => ({ label, values, total: [...values.values()].reduce((sumValue, value) => sumValue + value, 0) }))
      .sort((a, b) => b.total - a.total || a.label.localeCompare(b.label, "es"));
    const scroll = document.createElement("div");
    scroll.className = "matrix-scroll";
    const table = document.createElement("table");
    table.className = "weekly-matrix-table";
    const head = document.createElement("thead");
    const headerRow = document.createElement("tr");
    const categoryHeader = document.createElement("th");
    categoryHeader.scope = "col";
    categoryHeader.textContent = "Categoría / Equipo";
    headerRow.append(categoryHeader);
    weeks.forEach((week) => {
      const cell = document.createElement("th");
      cell.scope = "col";
      cell.textContent = week.label;
      cell.title = `Semana del ${formatDate(week.start)}`;
      headerRow.append(cell);
    });
    const totalHeader = document.createElement("th");
    totalHeader.scope = "col";
    totalHeader.textContent = "Total (min)";
    headerRow.append(totalHeader);
    head.append(headerRow);
    table.append(head);
    const body = document.createElement("tbody");
    const maximum = Math.max(...rows.flatMap((row) => [...row.values.values()]), 1);
    rows.forEach((row) => {
      const positiveValues = weeks.map((week) => row.values.get(week.start)).filter((value) => value > 0);
      const rowMinimum = Math.min(...positiveValues);
      const rowMaximum = Math.max(...positiveValues);
      const tableRow = document.createElement("tr");
      const labelCell = document.createElement("th");
      labelCell.scope = "row";
      labelCell.textContent = row.label;
      labelCell.title = row.label;
      tableRow.append(labelCell);
      weeks.forEach((week) => {
        const value = row.values.get(week.start);
        const cell = document.createElement("td");
        cell.className = "matrix-value";
        cell.textContent = value ? formatNumber(value) : "";
        cell.title = `${week.label}: ${formatNumber(value)} min`;
        if (value && rowMinimum === rowMaximum) cell.classList.add("matrix-medium");
        else if (value === rowMaximum) cell.classList.add("matrix-high");
        else if (value === rowMinimum) cell.classList.add("matrix-low");
        else if (value) cell.classList.add("matrix-medium");
        tableRow.append(cell);
      });
      const totalCell = document.createElement("td");
      totalCell.className = "matrix-total";
      totalCell.textContent = formatNumber(row.total);
      tableRow.append(totalCell);
      body.append(tableRow);
    });
    const totalRow = document.createElement("tr");
    totalRow.className = "matrix-grand-total";
    const totalLabel = document.createElement("th");
    totalLabel.scope = "row";
    totalLabel.textContent = "Total (min)";
    totalRow.append(totalLabel);
    weeks.forEach((week) => {
      const cell = document.createElement("td");
      cell.textContent = formatNumber(weekTotals.get(week.start));
      totalRow.append(cell);
    });
    const grandTotal = document.createElement("td");
    grandTotal.textContent = formatNumber([...weekTotals.values()].reduce((sumValue, value) => sumValue + value, 0));
    totalRow.append(grandTotal);
    body.append(totalRow);
    table.append(body);
    scroll.append(table);
    container.append(scroll);
  }

  function startOfWeek(value) {
    const date = new Date(`${value}T00:00:00`);
    date.setDate(date.getDate() - ((date.getDay() + 6) % 7));
    return localDateISO(date);
  }

  function getDashboardWeeks(records) {
    const latestRecordDate = records.reduce((latest, record) => record.date > latest ? record.date : latest, "");
    const filterFrom = $("#filterFrom").value;
    const filterTo = $("#filterTo").value;
    const today = localDateISO();
    const endDate = filterTo || (filterFrom
      ? latestRecordDate || filterFrom
      : latestRecordDate > today ? latestRecordDate : today);
    const lastWeek = new Date(`${startOfWeek(endDate)}T00:00:00`);
    return Array.from({ length: 12 }, (_, index) => {
      const date = new Date(lastWeek);
      date.setDate(date.getDate() - (11 - index) * 7);
      const start = localDateISO(date);
      return { start, label: `W${String(isoWeekNumber(start)).padStart(2, "0")}` };
    });
  }

  function isoWeekNumber(value) {
    const date = new Date(`${value}T00:00:00Z`);
    const day = date.getUTCDay() || 7;
    date.setUTCDate(date.getUTCDate() + 4 - day);
    const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
    return Math.ceil(((date - yearStart) / 86400000 + 1) / 7);
  }

  function renderActions(records) {
    const container = $("#priorityList");
    container.replaceChildren();
    const filter = $("#q4StatusFilter").value;
    const actionTypes = [
      { key: "containment", short: "C", label: "Contención" },
      { key: "corrective", short: "CA", label: "Correctiva" },
      { key: "systematic", short: "S", label: "Sistemática" }
    ];
    const actions = records.flatMap((record) => actionTypes
      .filter((action) => String(record[action.key] || "").trim())
      .map((action) => ({ record, action, status: record.actionStatus?.[action.key] === "completed" ? "completed" : "pending" })))
      .filter((item) => filter === "all" || item.status === filter)
      .sort((a, b) => Number(a.status === "completed") - Number(b.status === "completed") || Number(b.record.minutes) - Number(a.record.minutes));
    if (!actions.length) {
      container.append(emptyChart(filter === "completed" ? "No hay acciones completadas en este alcance." : "No hay acciones pendientes en este alcance."));
      return;
    }
    actions.forEach(({ record, action, status }, index) => {
      const item = document.createElement("div");
      item.className = "priority-item action-item";
      const rank = document.createElement("span");
      rank.className = "priority-rank action-type";
      rank.textContent = action.short;
      const copy = document.createElement("div");
      copy.className = "priority-copy";
      const text = document.createElement("strong");
      text.textContent = `${action.label}: ${record[action.key]}`;
      text.title = record[action.key];
      const detail = document.createElement("small");
      detail.textContent = `${record.line || "Sin línea"} · ${record.machine || "Sin clasificar"} · ${formatDate(record.date)} · ${formatNumber(record.minutes)} min`;
      copy.append(text, detail);
      const statusSelect = document.createElement("select");
      statusSelect.className = "action-status";
      statusSelect.setAttribute("aria-label", `Estado de ${action.label}, acción ${index + 1}`);
      [{ value: "pending", label: "Pendiente" }, { value: "completed", label: "Completada" }].forEach((entry) => {
        const option = document.createElement("option");
        option.value = entry.value;
        option.textContent = entry.label;
        statusSelect.append(option);
      });
      statusSelect.value = status;
      statusSelect.addEventListener("change", () => {
        const target = state.records.find((candidate) => candidate.id === record.id);
        if (!target) return;
        target.actionStatus = { ...(target.actionStatus || {}), [action.key]: statusSelect.value };
        saveState();
        renderDashboard();
      });
      item.append(rank, copy, statusSelect);
      container.append(item);
    });
  }

  /* Records */
  function bindRecords() {
    $("#recordSearch").addEventListener("input", renderRecords);
    $("#exportCsv").addEventListener("click", () => exportCsv(state.records, "tiempos_muertos_power_bi"));
    $("#exportExcelTemplate").addEventListener("click", exportExcelTemplate);
    $("#exportJson").addEventListener("click", exportJson);
    $("#backupShortcut").addEventListener("click", exportJson);
    $("#importExcel").addEventListener("click", () => $("#importExcelInput").click());
    $("#importExcelInput").addEventListener("change", importExcel);
    $("#importJson").addEventListener("click", () => $("#importJsonInput").click());
    $("#importJsonInput").addEventListener("change", importJson);
    $("#deleteAll").addEventListener("click", async () => {
      if (!state.records.length) return;
      const confirmed = await askConfirmation(
        "Eliminar todos los registros",
        `Se eliminarán ${state.records.length} eventos guardados en este navegador. Crea un respaldo si deseas conservarlos.`,
        "Eliminar todo"
      );
      if (!confirmed) return;
      state.records = [];
      saveState();
      renderRecords();
      renderDashboard();
      renderTodaySummary();
      showToast("Todos los registros fueron eliminados.");
    });
  }

  function renderRecords() {
    const body = $("#recordsBody");
    const query = normalize($("#recordSearch").value || "");
    const records = [...state.records]
      .filter((record) => !query || Object.values(record).some((value) => normalize(String(value)).includes(query)))
      .sort((a, b) => (b.date || "").localeCompare(a.date || "") || (b.createdAt || "").localeCompare(a.createdAt || ""));

    body.replaceChildren();
    records.forEach((record) => {
      const row = document.createElement("tr");
      row.append(
        tableCell(formatDate(record.date)),
        tableCell(`T${record.shift || "—"}`, "shift"),
        tableCell(record.line || "Sin línea"),
        tableCell(record.area || "Sin área"),
        tableCell(record.machine || "Sin clasificar"),
        twoLineCell(record.problem || "Sin problema", record.rootCause || "Sin causa"),
        tableCell(formatNumber(record.minutes), "number"),
        tableCell(formatNumber(record.units), "number"),
        tableCell(record.support || "—")
      );

      const actionsCell = document.createElement("td");
      const actions = document.createElement("div");
      actions.className = "row-actions";
      const edit = document.createElement("button");
      edit.className = "table-action";
      edit.type = "button";
      edit.textContent = "Editar";
      edit.addEventListener("click", () => editRecord(record.id));
      const remove = document.createElement("button");
      remove.className = "table-action delete";
      remove.type = "button";
      remove.textContent = "Borrar";
      remove.addEventListener("click", () => deleteRecord(record.id));
      actions.append(edit, remove);
      actionsCell.append(actions);
      row.append(actionsCell);
      body.append(row);
    });

    $("#recordsEmpty").classList.toggle("hidden", records.length > 0);
    $(".table-scroll").classList.toggle("hidden", records.length === 0);
    $("#recordCount").textContent = `${formatNumber(records.length)} ${records.length === 1 ? "registro" : "registros"}`;
    $("#recordSummary").textContent = `${formatNumber(sum(records, "minutes"))} min · ${formatNumber(sum(records, "units"))} unidades afectadas`;
  }

  function tableCell(text, type = "") {
    const cell = document.createElement("td");
    if (type === "number") cell.className = "number-cell";
    if (type === "shift") {
      const badge = document.createElement("span");
      badge.className = "shift-badge";
      badge.textContent = text;
      cell.append(badge);
    } else {
      cell.textContent = text;
    }
    return cell;
  }

  function twoLineCell(primaryText, secondaryText) {
    const cell = document.createElement("td");
    const primary = document.createElement("span");
    primary.className = "cell-primary";
    primary.textContent = primaryText;
    primary.title = primaryText;
    const secondary = document.createElement("span");
    secondary.className = "cell-secondary";
    secondary.textContent = secondaryText;
    secondary.title = secondaryText;
    cell.append(primary, secondary);
    return cell;
  }

  function editRecord(id) {
    const record = state.records.find((item) => item.id === id);
    if (!record) return;
    editingId = id;
    legacyPrefill = record;
    form.reset();
    populateBaseFormOptions({ line: record.line, department: record.department, support: record.support });
    fields.date.value = record.date || localDateISO();
    fields.shift.value = String(record.shift || "");
    fields.line.value = record.line || "";
    onLineChange();

    if (record.area) {
      ensureOption(fields.area, record.area);
      fields.area.value = record.area;
      onAreaChange();
    }
    if (record.machine) {
      ensureOption(fields.machine, record.machine);
      fields.machine.value = record.machine;
      onMachineChange();
    }

    fields.minutes.value = record.minutes;
    fields.units.value = record.units;
    ensureOption(fields.department, record.department);
    fields.department.value = record.department || "";
    ensureOption(fields.support, record.support);
    fields.support.value = record.support || "";
    fields.containment.value = record.containment || "";
    fields.corrective.value = record.corrective || "";
    fields.systematic.value = record.systematic || "";

    $("#cancelEdit").classList.remove("hidden");
    $("#saveRecord").textContent = "Actualizar registro";
    navigate("capture");
    if (!record.area || !record.machine) {
      showToast("Este registro histórico no tenía área o máquina. Complétalas para actualizarlo.");
    }
    updateFormStatus();
  }

  function ensureOption(select, value) {
    if (!value || Array.from(select.options).some((option) => option.value === value)) return;
    const option = document.createElement("option");
    option.value = value;
    option.textContent = value;
    select.append(option);
    select.disabled = false;
  }

  async function deleteRecord(id) {
    const record = state.records.find((item) => item.id === id);
    if (!record) return;
    const confirmed = await askConfirmation(
      "Eliminar registro",
      `Se eliminará el evento “${record.problem || "Sin problema"}” de ${formatNumber(record.minutes)} minutos.`,
      "Eliminar"
    );
    if (!confirmed) return;
    state.records = state.records.filter((item) => item.id !== id);
    saveState();
    renderRecords();
    renderDashboard();
    renderTodaySummary();
    showToast("Registro eliminado.");
  }

  function exportCsv(records, baseName) {
    if (!records.length) {
      showToast("No hay registros para exportar.", true);
      return;
    }
    const rows = records.map((record) => [
      record.date, record.shift, record.line, record.area, record.minutes, record.department, record.machine, record.problem,
      record.units, record.support, record.rootCause, record.containment, record.corrective, record.systematic
    ]);
    const csv = [RECORD_HEADERS, ...rows].map((row) => row.map(csvCell).join(",")).join("\r\n");
    downloadBlob(`\ufeff${csv}`, `${baseName}_${localDateISO()}.csv`, "text/csv;charset=utf-8");
    showToast(`${records.length} registros exportados a CSV.`);
  }

  function exportExcelTemplate() {
    if (!window.XLSX) {
      showToast("No se pudo cargar el generador de Excel. Revisa tu conexión e inténtalo de nuevo.", true);
      return;
    }
    const worksheet = XLSX.utils.aoa_to_sheet([RECORD_HEADERS]);
    worksheet["!cols"] = [12, 10, 16, 18, 23, 22, 20, 34, 20, 24, 34, 42, 42, 42].map((wch) => ({ wch }));
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "Registros");
    XLSX.writeFile(workbook, "plantilla_registros_downtime.xlsx");
    showToast("Plantilla Excel descargada.");
  }

  async function importExcel(event) {
    const input = event.target;
    const file = input.files && input.files[0];
    if (!file) return;
    try {
      if (!window.XLSX) throw new Error("No se pudo cargar el lector de Excel. Revisa tu conexión e inténtalo de nuevo.");
      const workbook = XLSX.read(await file.arrayBuffer(), { type: "array", cellDates: true });
      const worksheet = workbook.Sheets[workbook.SheetNames[0]];
      if (!worksheet) throw new Error("El archivo no contiene una hoja de cálculo.");

      const rows = XLSX.utils.sheet_to_json(worksheet, { header: 1, defval: "", raw: true });
      if (!rows.length || RECORD_HEADERS.some((header, index) => normalize(rows[0][index]) !== normalize(header))) {
        throw new Error("Los encabezados u orden de columnas no coinciden con la plantilla de Registros.");
      }

      const dataRows = rows.slice(1).filter((row) => row.some((value) => String(value).trim() !== ""));
      if (!dataRows.length) throw new Error("El archivo no contiene registros para importar.");

      const importedRecords = dataRows.map((row, index) => {
        const values = RECORD_HEADERS.map((_, column) => row[column] ?? "");
        const [dateValue, shift, line, area, minutesValue, department, machine, problem, unitsValue, support, rootCause, containment, corrective, systematic] = values;
        const date = parseExcelDate(dateValue);
        const minutes = Number(minutesValue);
        const units = Number(unitsValue);
        const record = {
          date,
          shift: String(shift).trim(),
          line: String(line).trim(),
          area: String(area).trim(),
          minutes,
          department: String(department).trim(),
          machine: String(machine).trim(),
          problem: String(problem).trim(),
          units,
          support: String(support).trim(),
          rootCause: String(rootCause).trim(),
          containment: String(containment).trim(),
          corrective: String(corrective).trim(),
          systematic: String(systematic).trim(),
          actionStatus: { containment: "pending", corrective: "pending", systematic: "pending" }
        };
        const requiredFields = ["date", "shift", "line", "area", "department", "machine", "problem", "support", "rootCause", "containment", "corrective", "systematic"];
        const missingFields = requiredFields.filter((key) => !record[key]);
        if (missingFields.length || String(minutesValue).trim() === "" || String(unitsValue).trim() === "" || !["1", "2", "3"].includes(record.shift) || !Number.isInteger(minutes) || minutes < 1 || minutes > 1440 || !Number.isInteger(units) || units < 0) {
          throw new Error(`Revisa los datos de la fila ${index + 2}: hay campos obligatorios vacíos o valores numéricos inválidos.`);
        }
        const timestamp = new Date().toISOString();
        return { id: createRecordId(), ...record, createdAt: timestamp, updatedAt: timestamp };
      });

      const confirmed = await askConfirmation(
        "Importar registros de Excel",
        `Se agregarán ${importedRecords.length} registros al historial actual. No se reemplazarán los datos existentes.`,
        "Importar"
      );
      if (!confirmed) return;

      state.records.push(...importedRecords);
      saveState();
      populateDashboardFilters();
      renderRecords();
      renderDashboard();
      renderTodaySummary();
      showToast(`${importedRecords.length} registros importados correctamente.`);
    } catch (error) {
      showToast(error.message || "No fue posible importar el archivo de Excel.", true);
    } finally {
      input.value = "";
    }
  }

  function parseExcelDate(value) {
    let date = "";
    if (value instanceof Date && !Number.isNaN(value.getTime())) return localDateISO(value);
    if (typeof value === "number") {
      const parsed = XLSX.SSF.parse_date_code(value);
      if (parsed) date = `${parsed.y}-${String(parsed.m).padStart(2, "0")}-${String(parsed.d).padStart(2, "0")}`;
    }
    if (!date) {
      const text = String(value).trim();
      const isoDate = text.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
      if (isoDate) date = `${isoDate[1]}-${isoDate[2].padStart(2, "0")}-${isoDate[3].padStart(2, "0")}`;
      const localDate = text.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
      if (!date && localDate) date = `${localDate[3]}-${localDate[2].padStart(2, "0")}-${localDate[1].padStart(2, "0")}`;
    }
    const parsedDate = new Date(`${date}T00:00:00`);
    return date && !Number.isNaN(parsedDate.getTime()) && localDateISO(parsedDate) === date ? date : "";
  }

  function exportJson() {
    const payload = {
      app: "Downtime Control",
      version: state.version || 1,
      exportedAt: new Date().toISOString(),
      catalogs: state.catalogs,
      records: state.records
    };
    downloadBlob(JSON.stringify(payload, null, 2), `respaldo_downtime_${localDateISO()}.json`, "application/json");
    showToast("Respaldo JSON creado.");
  }

  async function importJson(event) {
    const input = event.target;
    const file = input.files && input.files[0];
    if (!file) return;
    try {
      const parsed = JSON.parse(await file.text());
      if (!parsed || !Array.isArray(parsed.records) || !parsed.catalogs) throw new Error("El archivo no contiene registros y catálogos válidos.");
      ["locations", "departments", "support", "failures"].forEach((key) => {
        if (!Array.isArray(parsed.catalogs[key])) throw new Error(`Falta el catálogo ${key}.`);
      });
      const confirmed = await askConfirmation(
        "Importar respaldo",
        `El archivo contiene ${parsed.records.length} registros. Reemplazará la información local actual.`,
        "Importar"
      );
      if (!confirmed) return;
      state = { version: parsed.version || 1, catalogs: parsed.catalogs, records: parsed.records };
      saveState();
      resetForm(false);
      populateDashboardFilters();
      renderRecords();
      renderCatalogs();
      renderDashboard();
      renderTodaySummary();
      showToast("Respaldo importado correctamente.");
    } catch (error) {
      showToast(error.message || "No fue posible importar el archivo.", true);
    } finally {
      input.value = "";
    }
  }

  /* Catalogs */
  function bindCatalogs() {
    $("#locationForm").addEventListener("submit", (event) => {
      event.preventDefault();
      const item = {
        line: $("#catalogLine").value.trim(),
        area: $("#catalogArea").value.trim(),
        machine: $("#catalogMachine").value.trim()
      };
      if (state.catalogs.locations.some((current) =>
        normalize(current.line) === normalize(item.line) && normalize(current.area) === normalize(item.area) && normalize(current.machine) === normalize(item.machine)
      )) {
        showToast("Esa combinación ya existe.", true);
        return;
      }
      state.catalogs.locations.push(item);
      saveCatalogChange(event.currentTarget, "Ubicación agregada al árbol.");
    });

    $("#departmentForm").addEventListener("submit", (event) => addSimpleCatalog(event, "departments", $("#catalogDepartment")));
    $("#supportForm").addEventListener("submit", (event) => addSimpleCatalog(event, "support", $("#catalogSupport")));

    $("#failureForm").addEventListener("submit", (event) => {
      event.preventDefault();
      const rule = {
        machine: $("#failureMachine").value.trim(),
        problem: $("#failureProblem").value.trim(),
        rootCause: $("#failureCause").value.trim(),
        containment: $("#failureContainment").value.trim(),
        corrective: $("#failureCorrective").value.trim(),
        systematic: $("#failureSystematic").value.trim()
      };
      const duplicate = state.catalogs.failures.some((current) =>
        normalize(current.machine) === normalize(rule.machine) &&
        normalize(current.problem) === normalize(rule.problem) &&
        normalize(current.rootCause) === normalize(rule.rootCause)
      );
      if (duplicate) {
        showToast("Esa regla ya existe.", true);
        return;
      }
      state.catalogs.failures.push(rule);
      saveCatalogChange(event.currentTarget, "Regla agregada al árbol de diagnóstico.");
    });

    $("#restoreCatalogs").addEventListener("click", async () => {
      const confirmed = await askConfirmation(
        "Restaurar catálogos",
        "Se reemplazarán ubicaciones, departamentos, soporte y fallas. Los registros capturados no se eliminarán.",
        "Restaurar"
      );
      if (!confirmed) return;
      state.catalogs = clone(window.FLEX_DT_DEFAULTS.catalogs);
      saveState();
      resetForm(false);
      renderCatalogs();
      populateDashboardFilters();
      showToast("Catálogos iniciales restaurados.");
    });
  }

  function addSimpleCatalog(event, key, input) {
    event.preventDefault();
    const value = input.value.trim();
    if (state.catalogs[key].some((item) => normalize(item) === normalize(value))) {
      showToast("Ese valor ya existe.", true);
      return;
    }
    state.catalogs[key].push(value);
    saveCatalogChange(event.currentTarget, "Catálogo actualizado.");
  }

  function saveCatalogChange(formElement, message) {
    saveState();
    formElement.reset();
    populateBaseFormOptions();
    populateDashboardFilters();
    renderCatalogs();
    showToast(message);
  }

  function renderCatalogs() {
    renderLocations();
    renderSimpleCatalog("departments", $("#departmentList"), $("#departmentCount"));
    renderSimpleCatalog("support", $("#supportList"), $("#supportCount"));
    renderFailures();
    renderMachineSuggestions();
  }

  function renderLocations() {
    const list = $("#locationList");
    list.replaceChildren();
    const items = state.catalogs.locations
      .map((item, index) => ({ ...item, index }))
      .sort((a, b) => `${a.line}|${a.area}|${a.machine}`.localeCompare(`${b.line}|${b.area}|${b.machine}`, "es"));
    items.forEach((item) => {
      const row = document.createElement("div");
      row.className = "catalog-row";
      const copy = document.createElement("div");
      const title = document.createElement("strong");
      title.textContent = `${item.line} · ${item.area}`;
      const detail = document.createElement("small");
      detail.textContent = item.machine;
      copy.append(title, detail);
      const remove = removeButton(() => removeCatalogItem("locations", item.index, "ubicación"));
      row.append(copy, remove);
      list.append(row);
    });
    $("#locationCount").textContent = state.catalogs.locations.length;
  }

  function renderSimpleCatalog(key, container, countElement) {
    container.replaceChildren();
    state.catalogs[key]
      .map((value, index) => ({ value, index }))
      .sort((a, b) => a.value.localeCompare(b.value, "es"))
      .forEach(({ value, index }) => {
        const chip = document.createElement("span");
        chip.className = "editable-chip";
        const label = document.createElement("span");
        label.textContent = value;
        const remove = document.createElement("button");
        remove.type = "button";
        remove.title = `Eliminar ${value}`;
        remove.textContent = "×";
        remove.addEventListener("click", () => removeCatalogItem(key, index, "valor"));
        chip.append(label, remove);
        container.append(chip);
      });
    countElement.textContent = state.catalogs[key].length;
  }

  function renderFailures() {
    const list = $("#failureList");
    list.replaceChildren();
    state.catalogs.failures
      .map((rule, index) => ({ ...rule, index }))
      .sort((a, b) => `${a.machine}|${a.problem}|${a.rootCause}`.localeCompare(`${b.machine}|${b.problem}|${b.rootCause}`, "es"))
      .forEach((rule) => {
        const row = document.createElement("tr");
        row.append(tableCell(rule.machine), twoLineCell(rule.problem, rule.containment), twoLineCell(rule.rootCause, rule.corrective));
        const action = document.createElement("td");
        action.append(removeButton(() => removeCatalogItem("failures", rule.index, "regla")));
        row.append(action);
        list.append(row);
      });
    $("#failureCount").textContent = state.catalogs.failures.length;
  }

  function renderMachineSuggestions() {
    const dataList = $("#machineSuggestions");
    dataList.replaceChildren();
    const values = unique([
      "TODAS", "Camalot", "Fluxer", "Plasma",
      ...state.catalogs.locations.map((item) => item.machine)
    ]);
    values.forEach((value) => {
      const option = document.createElement("option");
      option.value = value;
      dataList.append(option);
    });
  }

  async function removeCatalogItem(key, index, label) {
    const confirmed = await askConfirmation(
      `Eliminar ${label}`,
      "La opción dejará de aparecer en nuevas capturas. Los registros históricos no cambiarán.",
      "Eliminar"
    );
    if (!confirmed) return;
    state.catalogs[key].splice(index, 1);
    saveState();
    resetForm(false);
    renderCatalogs();
    populateDashboardFilters();
    showToast("Catálogo actualizado.");
  }

  function removeButton(handler) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "remove-button";
    button.title = "Eliminar";
    button.setAttribute("aria-label", "Eliminar");
    button.textContent = "×";
    button.addEventListener("click", handler);
    return button;
  }

  /* Confirmation and utility */
  function bindConfirmDialog() {
    const dialog = $("#confirmDialog");
    dialog.addEventListener("close", () => {
      if (confirmAction) confirmAction(dialog.returnValue === "confirm");
      confirmAction = null;
    });
  }

  function askConfirmation(title, message, confirmLabel) {
    const dialog = $("#confirmDialog");
    if (!dialog.showModal) return Promise.resolve(window.confirm(message));
    $("#dialogTitle").textContent = title;
    $("#dialogMessage").textContent = message;
    $("#dialogConfirm").textContent = confirmLabel;
    dialog.returnValue = "cancel";
    dialog.showModal();
    return new Promise((resolve) => { confirmAction = resolve; });
  }

  function showToast(message, isError = false) {
    const toast = document.createElement("div");
    toast.className = `toast${isError ? " error" : ""}`;
    const text = document.createElement("span");
    text.textContent = message;
    toast.append(text);
    $("#toastStack").append(toast);
    window.setTimeout(() => toast.remove(), 3600);
  }

  function emptyChart(message) {
    const element = document.createElement("div");
    element.className = "empty-chart";
    element.textContent = message;
    return element;
  }

  function svgElement(name, attributes = {}) {
    const element = document.createElementNS("http://www.w3.org/2000/svg", name);
    Object.entries(attributes).forEach(([key, value]) => element.setAttribute(key, value));
    return element;
  }

  function sum(records, key) {
    return records.reduce((total, record) => total + (Number(record[key]) || 0), 0);
  }

  function normalize(value) {
    return String(value || "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .trim()
      .toLowerCase();
  }

  function localDateISO(date = new Date()) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  }

  function formatDate(value) {
    if (!value) return "—";
    const date = new Date(`${value}T00:00:00`);
    return new Intl.DateTimeFormat("es-MX", { day: "2-digit", month: "short", year: "numeric" }).format(date).replace(".", "");
  }

  function formatShortDate(value) {
    if (!value) return "—";
    const date = new Date(`${value}T00:00:00`);
    return new Intl.DateTimeFormat("es-MX", { day: "2-digit", month: "short" }).format(date).replace(".", "");
  }

  function formatNumber(value) {
    return new Intl.NumberFormat("es-MX", { maximumFractionDigits: 1 }).format(Number(value) || 0);
  }

  function metricValue(value, metric) {
    if (metric === "minutes") return `${formatNumber(value)} min`;
    if (metric === "units") return `${formatNumber(value)} un.`;
    return `${formatNumber(value)} ev.`;
  }

  function csvCell(value) {
    const text = String(value ?? "").replace(/"/g, '""');
    return `"${text}"`;
  }

  function downloadBlob(content, filename, type) {
    const blob = new Blob([content], { type });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    document.body.append(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  }
})();
