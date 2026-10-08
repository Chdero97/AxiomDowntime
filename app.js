(function () {
  "use strict";

  const STORAGE_KEY = "flexDowntimePlatform.v1";
  const CUSTOM_VALUE = "__custom";
  const COST_PER_DOWNTIME_MINUTE_USD = 716666.67;
  const PARETO_LEVELS = {
    area: [
      { key: "area", label: "Área" },
      { key: "line", label: "Línea" },
      { key: "machine", label: "Equipo" },
      { key: "rootCause", label: "Causa raíz" },
      { key: "problem", label: "Problema" }
    ],
    department: [
      { key: "department", label: "Departamento" },
      { key: "line", label: "Línea" },
      { key: "machine", label: "Equipo" },
      { key: "rootCause", label: "Causa raíz" },
      { key: "problem", label: "Problema" }
    ]
  };
  const RECORD_HEADERS = [
    "Fecha", "Turno", "Linea", "Area", "Tiempo afectado (min)", "Departamento", "Maquina", "Problema",
    "Unidades afectadas", "Nombre de soporte", "Causa Raiz", "Accion de Contension", "Accion Correctiva", "Accion sistematica"
  ];
  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));
  const clone = (value) => JSON.parse(JSON.stringify(value));
  const unique = (values) => [...new Set(values.filter(Boolean))].sort((a, b) => a.localeCompare(b, "es", { sensitivity: "base" }));

  let state = loadState();
  let paretoMode = "area";
  let paretoPath = [];
  let ticketStep = 1;
  let activeTicketId = null;
  let ticketClock = null;
  let ticketActionSaveTimer = null;
  let catalogAccessGranted = false;
  let currentTicketUser = null;
  let manualDowntimeOpenedBy = null;
  let ticketUserAuthReady = null;
  let editingTicketUserIndex = null;
  let ticketUserAuthCallback = null;
  let requiredTicketUserRole = "";
  let confirmAction = null;
  let supabaseClient = null;
  let msalInstance = null;
  let graphAccessToken = null;
  let cloudUser = null;
  let cloudMode = false;
  let activeCloudBackend = "local";
  let cloudSnapshot = { records: new Map(), catalogs: null };
  let localMigrationRecords = [];
  let cloudChannel = null;
  let cloudSyncTimer = null;
  let cloudSyncQueue = Promise.resolve();
  let cloudSyncBusy = false;
  let cloudStateLoading = false;
  let serverStorageMode = false;
  let serverStorageReady = false;
  let serverRevision = null;
  let serverBaseState = null;
  let serverSyncTimer = null;
  let serverSyncQueue = Promise.resolve();
  let serverPollTimer = null;
  let lastServerPollError = "";
  let serverConflictBlocked = false;

  const viewMeta = {
    capture: { eyebrow: "OPERACIÓN / PRODUCCIÓN POR HORA", title: "Captura hora por hora" },
    dashboard: { eyebrow: "ANÁLISIS / CUATRO CUADRANTES", title: "Concentrado de tiempos muertos" },
    analytics: { eyebrow: "ANÁLISIS / DETALLE", title: "Dashboard de tiempos muertos" },
    records: { eyebrow: "DATOS / HISTORIAL", title: "Registros capturados" },
    catalogs: { eyebrow: "CONFIGURACIÓN / ÁRBOLES", title: "Catálogos y reglas de decisión" }
  };

  void bootstrap();

  async function bootstrap() {
    let sharedStorageError = null;
    try {
      await initializeSharedStorage();
    } catch (error) {
      sharedStorageError = error;
    }
    init();
    ticketUserAuthReady = seedDefaultSupportUsers();
    try {
      await ticketUserAuthReady;
      if (serverStorageMode) {
        serverStorageReady = true;
        if (!serverBaseState) {
          serverBaseState = clone(state);
        }
        await syncSharedState();
        $("#storageStatus").textContent = "Datos compartidos";
        $(".status-line").dataset.cloud = "connected";
        $("#storageDescription").textContent = "Registros compartidos mediante la API del host y guardados en la carpeta de red.";
        renderState();
        serverPollTimer = window.setInterval(pollSharedState, 5000);
      }
    } catch (error) {
      showToast(`No se pudieron preparar las cuentas iniciales de soporte: ${error.message}`, true);
    } finally {
      ticketUserAuthReady = null;
    }

    initializeCloud();
    if (sharedStorageError) {
      showToast(`No se pudo conectar con la API compartida: ${sharedStorageError.message}. Los datos siguen locales en este navegador.`, true);
    }
  }

  function emptyApplicationState() {
    return { records: [], catalogs: clone(window.FLEX_DT_DEFAULTS.catalogs), hourlyReports: [] };
  }

  async function initializeSharedStorage() {
    if (!["http:", "https:"].includes(window.location.protocol)) return;
    const response = await fetch("/api/state", { headers: { Accept: "application/json" } });
    if (response.status === 404) return;
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const remote = await response.json();
    if (remote.initialized && (!remote.state || !Array.isArray(remote.state.records) || !remote.state.catalogs)) {
      throw new Error("El servidor devolvió un estado compartido inválido.");
    }
    serverStorageMode = true;
    serverRevision = remote.revision || null;
    if (remote.initialized) {
      serverBaseState = normalizeServerState(remote.state);
      state = clone(serverBaseState);
    }
  }

  function normalizeServerState(value) {
    const catalogs = mergeDefaultLocations(value.catalogs || clone(window.FLEX_DT_DEFAULTS.catalogs));
    return {
      records: Array.isArray(value.records) ? value.records : [],
      catalogs,
      hourlyReports: Array.isArray(value.hourlyReports) ? value.hourlyReports : []
    };
  }

  function catalogOwnerValue(value) {
    if (!value) return "";
    return state.catalogs.owners.find((owner) => normalize(owner) === normalize(value)) || "";
  }

  function populateActionOwnerSelects() {
    [
      "#ticketContainmentOwner", "#ticketCorrectiveOwner", "#ticketPreventiveOwner",
      "#manualContainmentOwner", "#manualCorrectiveOwner", "#manualPreventiveOwner"
    ].forEach((selector) => {
      const select = $(selector);
      const selected = catalogOwnerValue(select.value);
      populateSelect(select, unique(state.catalogs.owners), "Seleccionar owner", selected);
    });
  }

  async function seedDefaultSupportUsers() {
    const legacySupport = Array.isArray(state.catalogs.support) ? state.catalogs.support : [];
    if (state.catalogs.supportUsersMigrated) {
      if (legacySupport.length) {
        state.catalogs.support = [];
        saveState();
      }
      return;
    }
    const initialSupport = Array.isArray(window.FLEX_DT_DEFAULTS.catalogs.support)
      ? window.FLEX_DT_DEFAULTS.catalogs.support
      : [];
    const supportPeople = new Map();
    [...legacySupport, ...initialSupport]
      .map((person) => typeof person === "string" ? { name: person.trim(), employeeId: "" } : person)
      .filter((person) => person?.name && person.employeeId)
      .forEach((person) => supportPeople.set(normalize(person.name), person));
    const newSupportUsers = [...supportPeople.values()].filter((person) =>
      !state.catalogs.ticketUsers.some((user) => normalize(user.username) === normalize(person.name))
    );
    if (newSupportUsers.length && (!window.crypto?.subtle || !window.crypto?.getRandomValues)) {
      throw new Error("Este navegador no permite crear las cuentas iniciales de soporte.");
    }
    const preparedUsers = await Promise.all(newSupportUsers.map(async (person) => {
      const credentials = await createPasswordCredentials(String(person.employeeId));
      return {
        name: String(person.name).trim(),
        username: String(person.name).trim(),
        role: "support",
        ...credentials,
        createdAt: new Date().toISOString()
      };
    }));
    if (preparedUsers.length || legacySupport.length) {
      state.catalogs.ticketUsers.push(...preparedUsers);
    }
    state.catalogs.support = [];
    state.catalogs.supportUsersMigrated = true;
    saveState();
  }

  function init() {
    $("#todayLabel").textContent = new Intl.DateTimeFormat("es-MX", {
      weekday: "short",
      day: "2-digit",
      month: "short"
    }).format(new Date()).replace(".", "");

    bindNavigation();
    bindCatalogAccess();
    bindTicketUserAuthentication();
    bindHourlyCapture();
    bindStopTickets();
    bindDashboard();
    bindAnalytics();
    bindRecords();
    bindCatalogs();
    bindConfirmDialog();
    bindCloudControls();
    initializeHourlyCapture();
    renderActiveTickets();
    renderTodaySummary();
    updateStopTicketView();
    ticketClock = window.setInterval(updateStopTicketView, 1000);
    populateDashboardFilters();
    renderRecords();
    renderCatalogs();
    renderDashboard();
    navigate("capture");
  }

  function bindTicketUserAuthentication() {
    $("#ticketUserLoginForm").addEventListener("submit", authenticateTicketUser);
    $("#openChangeTicketPassword").addEventListener("click", () => {
      $("#changeTicketPasswordForm").reset();
      $("#changeTicketPasswordMessage").textContent = "";
      $("#changeTicketPasswordDialog").showModal();
      $("#changeTicketPasswordUsername").focus();
    });
    $("#changeTicketPasswordForm").addEventListener("submit", changeTicketPassword);
    $("#editTicketUserForm").addEventListener("submit", saveEditedTicketUser);
    $("#cancelEditTicketUser").addEventListener("click", () => $("#editTicketUserDialog").close());
    $("#cancelTicketUserLogin").addEventListener("click", () => {
      ticketUserAuthCallback = null;
      $("#ticketUserLoginDialog").close();
    });
    $("#cancelChangeTicketPassword").addEventListener("click", () => $("#changeTicketPasswordDialog").close());
  }

  async function requestTicketUserAuthentication(role, callback) {
    if (ticketUserAuthReady) await ticketUserAuthReady;
    if (!window.crypto?.subtle || !window.crypto?.getRandomValues) {
      showToast("Este navegador no ofrece almacenamiento seguro para validar usuarios.", true);
      return;
    }
    if (!state.catalogs.ticketUsers.length) {
      showToast("No hay usuarios registrados. Da de alta operadores y soporte desde Catálogos.", true);
      return;
    }
    requiredTicketUserRole = role;
    ticketUserAuthCallback = callback;
    $("#ticketUserLoginForm").reset();
    $("#ticketUserLoginMessage").textContent = "";
    $("#ticketUserLoginTitle").textContent = role === "support" ? "Autenticación de soporte" : "Identificación para ticket";
    $("#ticketUserLoginDescription").textContent = role === "support"
      ? "Ingresa con una cuenta de soporte para cerrar el paro."
      : "Ingresa tu usuario y contraseña. Esta persona quedará registrada como quien levanta el ticket.";
    $("#ticketUserLoginDialog").showModal();
    $("#ticketLoginUsername").focus();
  }

  async function hashTicketPassword(password, salt) {
    const encoder = new TextEncoder();
    const keyMaterial = await window.crypto.subtle.importKey(
      "raw",
      encoder.encode(password),
      "PBKDF2",
      false,
      ["deriveBits"]
    );
    const bits = await window.crypto.subtle.deriveBits({
      name: "PBKDF2",
      salt: encoder.encode(salt),
      iterations: 120000,
      hash: "SHA-256"
    }, keyMaterial, 256);
    return Array.from(new Uint8Array(bits), (byte) => byte.toString(16).padStart(2, "0")).join("");
  }

  async function createPasswordCredentials(password) {
    const saltBytes = window.crypto.getRandomValues(new Uint8Array(16));
    const passwordSalt = Array.from(saltBytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
    return { passwordSalt, passwordHash: await hashTicketPassword(password, passwordSalt) };
  }

  async function changeTicketPassword(event) {
    event.preventDefault();
    const username = $("#changeTicketPasswordUsername").value.trim();
    const currentPassword = $("#changeTicketCurrentPassword").value;
    const newPassword = $("#changeTicketNewPassword").value;
    const confirmation = $("#changeTicketPasswordConfirmation").value;
    const user = state.catalogs.ticketUsers.find((item) => normalize(item.username) === normalize(username));
    if (!user || !currentPassword || !newPassword) {
      $("#changeTicketPasswordMessage").textContent = "Verifica el usuario y completa todos los campos.";
      return;
    }
    if (newPassword !== confirmation) {
      $("#changeTicketPasswordMessage").textContent = "La nueva contraseña y su confirmación no coinciden.";
      return;
    }
    if (newPassword.length < 8) {
      $("#changeTicketPasswordMessage").textContent = "La nueva contraseña debe tener al menos 8 caracteres.";
      return;
    }
    try {
      const currentHash = await hashTicketPassword(currentPassword, user.passwordSalt);
      if (currentHash !== user.passwordHash) {
        $("#changeTicketPasswordMessage").textContent = "Usuario o contraseña actual incorrectos.";
        return;
      }
      Object.assign(user, await createPasswordCredentials(newPassword));
      user.passwordChangedAt = new Date().toISOString();
      saveState();
      $("#changeTicketPasswordDialog").close();
      showToast("Contraseña actualizada correctamente.");
    } catch (error) {
      $("#changeTicketPasswordMessage").textContent = `No se pudo cambiar la contraseña: ${error.message}`;
    }
  }

  async function authenticateTicketUser(event) {
    event.preventDefault();
    const username = $("#ticketLoginUsername").value.trim();
    const password = $("#ticketLoginPassword").value;
    if (!username || !password) {
      $("#ticketUserLoginMessage").textContent = "Ingresa usuario y contraseña.";
      return;
    }
    const user = state.catalogs.ticketUsers.find((item) => normalize(item.username) === normalize(username));
    if (!user) {
      $("#ticketUserLoginMessage").textContent = "Usuario o contraseña incorrectos.";
      $("#ticketLoginPassword").value = "";
      return;
    }
    if (requiredTicketUserRole && user.role !== requiredTicketUserRole) {
      $("#ticketUserLoginMessage").textContent = "Esta acción requiere una cuenta de soporte.";
      $("#ticketLoginPassword").value = "";
      return;
    }
    try {
      const passwordHash = await hashTicketPassword(password, user.passwordSalt);
      if (passwordHash !== user.passwordHash) {
        $("#ticketUserLoginMessage").textContent = "Usuario o contraseña incorrectos.";
        $("#ticketLoginPassword").value = "";
        return;
      }
      currentTicketUser = { username: user.username, name: user.name, role: user.role };
      const callback = ticketUserAuthCallback;
      ticketUserAuthCallback = null;
      $("#ticketUserLoginDialog").close();
      if (callback) callback(currentTicketUser);
    } catch (error) {
      $("#ticketUserLoginMessage").textContent = `No se pudo validar la cuenta: ${error.message}`;
    }
  }

  function ticketUserSnapshot(user) {
    return user ? { username: user.username, name: user.name, role: user.role } : null;
  }

  function loadState() {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (!saved) return clone(window.FLEX_DT_DEFAULTS);
      const parsed = JSON.parse(saved);
      if (!parsed || !Array.isArray(parsed.records) || !parsed.catalogs) throw new Error("Estructura inválida");
      const required = ["locations", "departments", "support", "failures"];
      if (required.some((key) => !Array.isArray(parsed.catalogs[key]))) throw new Error("Catálogos inválidos");
      parsed.hourlyReports = Array.isArray(parsed.hourlyReports) ? parsed.hourlyReports : [];
      parsed.catalogs = mergeDefaultLocations(parsed.catalogs);
      if (!parsed.catalogs.goals.length) {
        parsed.catalogs.goals = clone(window.FLEX_DT_DEFAULTS.catalogs.goals);
        localStorage.setItem(STORAGE_KEY, JSON.stringify(parsed));
      }
      return parsed;
    } catch (error) {
      console.warn("No fue posible cargar los datos locales. Se restauró la base inicial.", error);
      return clone(window.FLEX_DT_DEFAULTS);
    }
  }

  function mergeDefaultLocations(catalogs) {
    const locations = new Map();
    [...(Array.isArray(catalogs.locations) ? catalogs.locations : []), ...window.FLEX_DT_DEFAULTS.catalogs.locations]
      .filter((item) => item && typeof item === "object")
      .forEach((item) => {
        const key = JSON.stringify([item.area, item.line, item.machine]
          .map((value) => String(value ?? "").trim().toLocaleLowerCase("es")));
        if (!locations.has(key)) locations.set(key, item);
      });
    const legacySupportNames = new Set([
      "Alejandro", "Ana", "Carlos", "Caro / Rafa", "Daniela / Daniel", "Emma", "Gio / Yadhi",
      "Gio / Yadhi / Luis", "Jesús Loera", "Jorge", "Karen", "Luis", "Osvaldo"
    ].map(normalize));
    const supports = new Map();
    (Array.isArray(catalogs.support) ? catalogs.support : []).forEach((value) => {
      const person = typeof value === "string" ? { name: value.trim(), employeeId: "" } : value;
      if (!person || !String(person.name || "").trim()) return;
      if (!person.employeeId && legacySupportNames.has(normalize(person.name))) return;
      const key = person.employeeId ? `id:${normalize(person.employeeId)}` : `name:${normalize(person.name)}`;
      if (!supports.has(key)) supports.set(key, { name: String(person.name).trim(), employeeId: String(person.employeeId || "").trim() });
    });
    return {
      ...catalogs,
      areas: [...window.FLEX_DT_DEFAULTS.catalogs.areas],
      locations: [...locations.values()],
      models: Array.isArray(catalogs.models) ? catalogs.models : [],
      support: [...supports.values()],
      ticketUsers: Array.isArray(catalogs.ticketUsers) ? catalogs.ticketUsers : [],
      owners: Array.isArray(catalogs.owners) ? catalogs.owners : [...window.FLEX_DT_DEFAULTS.catalogs.owners],
      goals: normalizeCatalogGoals(catalogs.goals)
    };
  }

  function normalizeCatalogGoals(goals) {
    const normalized = new Map();
    (Array.isArray(goals) ? goals : []).forEach((goal) => {
      if (!goal || typeof goal !== "object") return;
      const item = {
        area: String(goal.area || "").trim(),
        line: String(goal.line || "").trim(),
        minutes: Number(goal.minutes),
        week: String(goal.week || "")
      };
      if (!Number.isFinite(item.minutes) || item.minutes < 0) return;
      const key = `${normalize(item.area)}|${normalize(item.line)}`;
      const current = normalized.get(key);
      const currentIsLegacy = Boolean(current?.week);
      const itemIsLegacy = Boolean(item.week);
      if (!current ||
        (currentIsLegacy && !itemIsLegacy) ||
        (currentIsLegacy === itemIsLegacy && item.week.localeCompare(current.week) >= 0)) {
        normalized.set(key, item);
      }
    });
    return [...normalized.values()].map(({ area, line, minutes }) => ({ area, line, minutes }));
  }

  function mergeCloudCatalogs(catalogs, localCatalogs) {
    const merged = mergeDefaultLocations(catalogs);
    const users = new Map(merged.ticketUsers.map((user) => [normalize(user.username), user]));
    localCatalogs.ticketUsers.forEach((user) => {
      const key = normalize(user.username);
      const remoteUser = users.get(key);
      const localUpdated = Date.parse(user.passwordChangedAt || user.updatedAt || user.createdAt || "") || 0;
      const remoteUpdated = Date.parse(remoteUser?.passwordChangedAt || remoteUser?.updatedAt || remoteUser?.createdAt || "") || 0;
      if (!remoteUser || localUpdated > remoteUpdated) users.set(key, user);
    });
    merged.ticketUsers = [...users.values()];
    merged.support = [];
    merged.supportUsersMigrated = Boolean(merged.supportUsersMigrated || localCatalogs.supportUsersMigrated);
    return merged;
  }

  function saveState() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    if (serverStorageMode && serverStorageReady) scheduleServerSync();
    scheduleCloudSync();
  }

  function scheduleServerSync() {
    if (!serverStorageMode || !serverStorageReady || serverConflictBlocked) return;
    window.clearTimeout(serverSyncTimer);
    serverSyncTimer = window.setTimeout(() => {
      serverSyncQueue = serverSyncQueue.then(syncSharedState).catch((error) => {
        $("#storageStatus").textContent = serverConflictBlocked ? "Conflicto de cambios" : "Error de sincronización";
        showToast(`No se pudieron guardar los datos compartidos: ${error.message}`, true);
      });
    }, 300);
  }

  async function syncSharedState() {
    if (!serverStorageMode || !serverStorageReady || serverConflictBlocked) return;
    if (serverRevision && stableSerialize(state) === stableSerialize(serverBaseState)) return;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const snapshot = clone(state);
      const response = await fetch("/api/state", {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          "If-Match": serverRevision || "none"
        },
        body: JSON.stringify(snapshot)
      });
      if (response.ok) {
        const result = await response.json();
        serverRevision = result.revision;
        serverBaseState = snapshot;
        $("#storageStatus").textContent = "Datos compartidos";
        if (stableSerialize(state) !== stableSerialize(snapshot)) scheduleServerSync();
        return;
      }
      if (response.status !== 409) {
        const result = await response.json().catch(() => ({}));
        throw new Error(result.error || `HTTP ${response.status}`);
      }
      const latest = await response.json();
      if (!latest.initialized || !latest.state || !latest.revision) throw new Error("El estado compartido cambió pero no pudo recuperarse.");
      const remoteState = normalizeServerState(latest.state);
      const localState = clone(state);
      const base = serverBaseState || emptyApplicationState();
      serverRevision = latest.revision;
      serverBaseState = remoteState;
      try {
        state = mergeConcurrentStates(base, localState, remoteState);
      } catch (error) {
        localStorage.setItem(`${STORAGE_KEY}.serverConflictBackup`, JSON.stringify(localState));
        serverConflictBlocked = true;
        throw error;
      }
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    }
    throw new Error("Hay demasiadas escrituras simultáneas. Espera unos segundos y vuelve a guardar.");
  }

  async function pollSharedState() {
    if (!serverStorageMode || !serverStorageReady || cloudStateLoading) return;
    try {
      const response = await fetch("/api/state", { headers: { Accept: "application/json" } });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const latest = await response.json();
      if (!latest.initialized || !latest.state || !latest.revision || latest.revision === serverRevision) return;
      const remoteState = normalizeServerState(latest.state);
      const localState = clone(state);
      const base = serverBaseState || emptyApplicationState();
      const merged = mergeConcurrentStates(base, localState, remoteState);
      serverRevision = latest.revision;
      serverBaseState = remoteState;
      state = merged;
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
      renderState();
      if (stableSerialize(state) !== stableSerialize(remoteState)) scheduleServerSync();
      lastServerPollError = "";
    } catch (error) {
      if (error.message.startsWith("conflicto simultáneo")) {
        localStorage.setItem(`${STORAGE_KEY}.serverConflictBackup`, JSON.stringify(state));
        serverConflictBlocked = true;
        $("#storageStatus").textContent = "Conflicto de cambios";
      }
      if (lastServerPollError !== error.message) {
        showToast(`No se pudo actualizar desde el almacenamiento compartido: ${error.message}`, true);
        lastServerPollError = error.message;
      }
    }
  }

  function mergeConcurrentStates(base, local, remote) {
    return {
      records: mergeKeyedCollection(base.records, local.records, remote.records, (item) => item.id, "registros"),
      hourlyReports: mergeKeyedCollection(base.hourlyReports, local.hourlyReports, remote.hourlyReports, hourlyReportKey, "reportes hora por hora"),
      catalogs: mergeConcurrentCatalogs(base.catalogs, local.catalogs, remote.catalogs)
    };
  }

  function mergeConcurrentCatalogs(base, local, remote) {
    const merged = { ...remote };
    const keys = new Set([...Object.keys(base || {}), ...Object.keys(local || {}), ...Object.keys(remote || {})]);
    keys.forEach((key) => {
      const baseValue = base?.[key];
      const localValue = local?.[key];
      const remoteValue = remote?.[key];
      if (Array.isArray(baseValue) || Array.isArray(localValue) || Array.isArray(remoteValue)) {
        const getKey = (item) => {
          if (typeof item === "string") return normalize(item);
          if (key === "ticketUsers") return normalize(item.username);
          if (key === "models") return [item.area, item.line, item.name].map(normalize).join("|");
          if (key === "locations") return [item.area, item.line, item.machine].map(normalize).join("|");
          if (key === "goals") return [normalize(item.area), normalize(item.line || "")].join("|");
          if (key === "failures") return [item.machine, item.problem, item.rootCause].map(normalize).join("|");
          if (key === "support") return normalize(item.employeeId || item.name);
          return stableSerialize(item);
        };
        merged[key] = mergeKeyedCollection(baseValue || [], localValue || [], remoteValue || [], getKey, `catálogo ${key}`);
        return;
      }
      const localChanged = stableSerialize(localValue) !== stableSerialize(baseValue);
      const remoteChanged = stableSerialize(remoteValue) !== stableSerialize(baseValue);
      if (localChanged && remoteChanged && stableSerialize(localValue) !== stableSerialize(remoteValue)) {
        throw new Error(`conflicto simultáneo en el catálogo ${key}; conserva los cambios locales y recarga para revisar el estado central.`);
      }
      if (localChanged) merged[key] = localValue;
    });
    return mergeDefaultLocations(merged);
  }

  function mergeKeyedCollection(baseItems, localItems, remoteItems, getKey, label) {
    const toMap = (items) => new Map((items || []).map((item) => [String(getKey(item)), item]));
    const base = toMap(baseItems);
    const local = toMap(localItems);
    const remote = toMap(remoteItems);
    const merged = new Map(remote);
    const keys = new Set([...base.keys(), ...local.keys(), ...remote.keys()]);
    keys.forEach((key) => {
      const baseItem = base.get(key);
      const localItem = local.get(key);
      const remoteItem = remote.get(key);
      const localChanged = stableSerialize(localItem) !== stableSerialize(baseItem);
      const remoteChanged = stableSerialize(remoteItem) !== stableSerialize(baseItem);
      if (localChanged && remoteChanged && stableSerialize(localItem) !== stableSerialize(remoteItem)) {
        throw new Error(`conflicto simultáneo en ${label} (${key}); conserva los cambios locales y recarga para revisar el estado central.`);
      }
      if (!localChanged) return;
      if (localItem === undefined) merged.delete(key);
      else merged.set(key, localItem);
    });
    return [...merged.values()];
  }

  function stableSerialize(value) {
    if (Array.isArray(value)) return `[${value.map(stableSerialize).join(",")}]`;
    if (value && typeof value === "object") {
      return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableSerialize(value[key])}`).join(",")}}`;
    }
    return JSON.stringify(value);
  }

  function decodeCloudCatalogPayload(payload, fallbackReports = []) {
    if (payload && payload.catalogs) {
      return {
        catalogs: payload.catalogs,
        hourlyReports: Array.isArray(payload.hourlyReports) ? payload.hourlyReports : fallbackReports
      };
    }
    const { hourlyReports, ...catalogs } = payload || {};
    return {
      catalogs,
      hourlyReports: Array.isArray(hourlyReports) ? hourlyReports : fallbackReports
    };
  }

  function cloudCatalogPayload() {
    return { ...state.catalogs, hourlyReports: state.hourlyReports };
  }

  function bindCloudControls() {
    $("#authForm").addEventListener("submit", async (event) => {
      event.preventDefault();
      const config = window.FLEX_DOWNTIME_CLOUD || {};
      if (config.clientId && config.tenantId && window.msal?.PublicClientApplication) {
        await signInWithMicrosoft();
        return;
      }
      if (!supabaseClient) return;
      const email = $("#authEmail").value.trim();
      $("#authMessage").textContent = "Enviando enlace...";
      const { error } = await supabaseClient.auth.signInWithOtp({
        email,
        options: { emailRedirectTo: window.location.href.split("#")[0] }
      });
      $("#authMessage").textContent = error
        ? `No se pudo enviar el enlace: ${error.message}`
        : "Revisa tu correo y abre el enlace de acceso desde este dispositivo.";
    });
    $("#cloudSignOut").addEventListener("click", async () => {
      if (activeCloudBackend === "microsoft") {
        if (msalInstance) {
          const accounts = msalInstance.getAllAccounts();
          if (accounts.length) {
            try {
              await msalInstance.logoutPopup({ account: accounts[0] });
            } catch (error) {
              console.warn("No se pudo cerrar la sesión de Microsoft.", error);
            }
          }
        }
        cloudUser = null;
        graphAccessToken = null;
        msalInstance = null;
        activeCloudBackend = "local";
        $("#appShell").hidden = true;
        $("#authGate").hidden = false;
        $("#authMessage").textContent = "Sesión cerrada. Inicia sesión con Microsoft 365.";
        $("#storageStatus").textContent = "Datos locales";
        $(".status-line").dataset.cloud = "local";
        return;
      }
      if (!supabaseClient) return;
      const { error } = await supabaseClient.auth.signOut();
      if (error) showToast(`No se pudo cerrar sesión: ${error.message}`, true);
    });
    $("#migrateLocalData").addEventListener("click", migrateLocalRecords);
    $("#dismissLocalMigration").addEventListener("click", () => {
      $("#localMigration").hidden = true;
      showToast("Los registros locales no se subieron; volverán a aparecer como pendientes al iniciar sesión.");
    });
  }

  async function initializeCloud() {
    if (serverStorageMode) return;
    const config = window.FLEX_DOWNTIME_CLOUD || {};
    if (config.clientId && config.tenantId && window.msal?.PublicClientApplication) {
      await initializeMicrosoftCloud();
      return;
    }
    if (!config.supabaseUrl && !config.supabaseAnonKey) return;
    $("#appShell").hidden = true;
    $("#authGate").hidden = false;
    if (!config.supabaseUrl || !config.supabaseAnonKey) {
      $("#authMessage").textContent = "Completa la URL y la clave pública en supabase-config.js.";
      return;
    }
    if (!window.supabase?.createClient) {
      $("#authMessage").textContent = "No se pudo cargar Supabase. Revisa la conexión a internet.";
      return;
    }

    cloudMode = true;
    activeCloudBackend = "supabase";
    supabaseClient = window.supabase.createClient(config.supabaseUrl, config.supabaseAnonKey);
    $("#storageStatus").textContent = "Acceso requerido";
    $("#storageDescription").textContent = "Los datos compartidos requieren iniciar sesión.";
    $("#authMessage").textContent = "Ingresa tu correo para recibir un enlace de acceso.";

    supabaseClient.auth.onAuthStateChange((event, session) => {
      if (session) {
        void activateCloudSession(session);
      } else if (event === "SIGNED_OUT") {
        if (cloudChannel) void supabaseClient.removeChannel(cloudChannel);
        if (cloudSyncTimer) window.clearTimeout(cloudSyncTimer);
        cloudUser = null;
        cloudChannel = null;
        $("#appShell").hidden = true;
        $("#authGate").hidden = false;
        $("#authMessage").textContent = "Sesión cerrada. Ingresa tu correo para continuar.";
      }
    });
    const { data, error } = await supabaseClient.auth.getSession();
    if (error) {
      $("#authMessage").textContent = `No se pudo validar la sesión: ${error.message}`;
      return;
    }
    if (data.session) await activateCloudSession(data.session);
  }

  async function initializeMicrosoftCloud() {
    const config = window.FLEX_DOWNTIME_CLOUD || {};
    if (!config.clientId || !config.tenantId) return;
    $("#appShell").hidden = true;
    $("#authGate").hidden = false;
    if (!window.msal?.PublicClientApplication) {
      $("#authMessage").textContent = "No se pudo cargar Microsoft Authentication Library. Revisa la conexión a internet.";
      return;
    }
    cloudMode = true;
    activeCloudBackend = "microsoft";
    const graphScopes = config.graphScopes || ["Files.ReadWrite.All", "Sites.ReadWrite.All", "User.Read"];
    msalInstance = new window.msal.PublicClientApplication({
      auth: {
        clientId: config.clientId,
        authority: `https://login.microsoftonline.com/${config.tenantId}`,
        redirectUri: config.redirectUri || `${window.location.origin}${window.location.pathname}`
      }
    });
    $("#storageStatus").textContent = "Acceso requerido";
    $("#storageDescription").textContent = "Los datos compartidos requieren iniciar sesión con Microsoft 365.";
    $("#authMessage").textContent = "Inicia sesión con tu cuenta de Flex para continuar.";

    const accounts = msalInstance.getAllAccounts();
    if (!accounts.length) return;

    try {
      const accessToken = await acquireMicrosoftAccessToken(graphScopes, accounts[0]);
      if (accessToken) await activateMicrosoftSession(accounts[0], accessToken);
    } catch (error) {
      $("#authMessage").textContent = `No se pudo validar la sesión: ${error.message}`;
    }
  }

  async function signInWithMicrosoft() {
    const config = window.FLEX_DOWNTIME_CLOUD || {};
    if (!msalInstance && config.clientId && config.tenantId && window.msal?.PublicClientApplication) {
      await initializeMicrosoftCloud();
    }
    if (!msalInstance) return;
    const graphScopes = config.graphScopes || ["Files.ReadWrite.All", "Sites.ReadWrite.All", "User.Read"];
    $("#authMessage").textContent = "Iniciando sesión con Microsoft 365...";
    try {
      const loginResult = await msalInstance.loginPopup({ scopes: graphScopes });
      const accessToken = await acquireMicrosoftAccessToken(graphScopes, loginResult.account);
      await activateMicrosoftSession(loginResult.account, accessToken);
    } catch (error) {
      $("#authMessage").textContent = `No se pudo iniciar sesión: ${error.message}`;
    }
  }

  async function acquireMicrosoftAccessToken(scopes, account) {
    if (!msalInstance) throw new Error("MSAL no se inicializó.");
    try {
      const silentResult = await msalInstance.acquireTokenSilent({ account, scopes });
      return silentResult.accessToken;
    } catch (error) {
      const interactiveResult = await msalInstance.acquireTokenPopup({ account, scopes });
      return interactiveResult.accessToken;
    }
  }

  async function requestMicrosoftGraph(path, options = {}) {
    if (!graphAccessToken) throw new Error("No hay token activo de Microsoft Graph.");
    const headers = { Authorization: `Bearer ${graphAccessToken}`, Accept: "application/json" };
    if (options.body && !(options.body instanceof FormData)) {
      headers["Content-Type"] = "application/json";
    }
    const response = await fetch(`https://graph.microsoft.com/v1.0${path}`, {
      method: options.method || "GET",
      headers,
      body: options.body
    });
    if (response.status === 204) return null;
    const text = await response.text();
    if (!response.ok) {
      throw new Error(`${response.status} ${response.statusText}${text ? `: ${text}` : ""}`);
    }
    if (!text) return null;
    try {
      return JSON.parse(text);
    } catch (error) {
      return text;
    }
  }

  async function resolveMicrosoftFileInfo() {
    const config = window.FLEX_DOWNTIME_CLOUD || {};
    const fileName = config.fileName || "flex-downtime-data.json";
    if (config.fileId) return { id: config.fileId, name: fileName };
    const listing = await requestMicrosoftGraph(`/drives/${config.driveId}/root/children?$select=id,name`);
    const found = Array.isArray(listing?.value)
      ? listing.value.find((item) => item.name === fileName)
      : null;
    return found || null;
  }

  async function uploadMicrosoftState(payload) {
    const config = window.FLEX_DOWNTIME_CLOUD || {};
    const fileName = config.fileName || "flex-downtime-data.json";
    const fileInfo = await resolveMicrosoftFileInfo();
    const content = JSON.stringify(payload, null, 2);
    if (fileInfo?.id) {
      return requestMicrosoftGraph(`/drives/${config.driveId}/items/${fileInfo.id}/content`, {
        method: "PUT",
        body: content
      });
    }
    return requestMicrosoftGraph(`/drives/${config.driveId}/root:/${encodeURIComponent(fileName)}:/content`, {
      method: "PUT",
      body: content
    });
  }

  async function loadMicrosoftState() {
    const config = window.FLEX_DOWNTIME_CLOUD || {};
    if (!config.driveId) throw new Error("Falta driveId en la configuración de OneDrive/SharePoint.");
    const fileInfo = await resolveMicrosoftFileInfo();
    if (!fileInfo) {
      const emptyState = { records: [], catalogs: clone(window.FLEX_DT_DEFAULTS.catalogs), hourlyReports: [] };
      await uploadMicrosoftState(emptyState);
      return emptyState;
    }
    const fileUrl = config.fileId
      ? `/drives/${config.driveId}/items/${config.fileId}/content`
      : `/drives/${config.driveId}/items/${fileInfo.id}/content`;
    const content = await requestMicrosoftGraph(fileUrl);
    if (!content || !String(content).trim()) {
      return { records: [], catalogs: clone(window.FLEX_DT_DEFAULTS.catalogs), hourlyReports: [] };
    }
    try {
      const parsed = JSON.parse(String(content));
      const cloudData = decodeCloudCatalogPayload(parsed.catalogs, parsed.hourlyReports || []);
      return {
        records: Array.isArray(parsed.records) ? parsed.records : [],
        catalogs: parsed.catalogs ? cloudData.catalogs : clone(window.FLEX_DT_DEFAULTS.catalogs),
        hourlyReports: cloudData.hourlyReports
      };
    } catch (error) {
      console.warn("No fue posible leer la información compartida en OneDrive.", error);
      return { records: [], catalogs: clone(window.FLEX_DT_DEFAULTS.catalogs), hourlyReports: [] };
    }
  }

  async function activateMicrosoftSession(account, accessToken) {
    cloudUser = {
      id: account.homeAccountId || account.localAccountId || account.username,
      email: account.username || "usuario@flex.com"
    };
    graphAccessToken = accessToken;
    cloudStateLoading = true;
    try {
      const remoteState = await loadMicrosoftState();
      const remoteRecords = Array.isArray(remoteState.records) ? remoteState.records : [];
      const remoteCatalogs = mergeDefaultLocations(remoteState.catalogs || state.catalogs || clone(window.FLEX_DT_DEFAULTS.catalogs));
      const mergedCatalogs = mergeCloudCatalogs(remoteCatalogs, state.catalogs);
      const remoteHourlyReports = Array.isArray(remoteState.hourlyReports) ? remoteState.hourlyReports : [];
      state = { ...state, records: remoteRecords, catalogs: mergedCatalogs, hourlyReports: remoteHourlyReports };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
      cloudSnapshot = {
        records: new Map(remoteRecords.map((record) => [record.id, stableSerialize(record)])),
        catalogs: stableSerialize({ catalogs: remoteCatalogs, hourlyReports: remoteHourlyReports })
      };
      renderState();
      $("#storageStatus").textContent = `Compartido · ${cloudUser.email}`;
      $(".status-line").dataset.cloud = "connected";
      $("#storageDescription").textContent = "Registros sincronizados con OneDrive / SharePoint de Microsoft 365.";
      $("#cloudSignOut").hidden = false;
      $("#authGate").hidden = true;
      $("#appShell").hidden = false;
      $("#localMigration").hidden = localMigrationRecords.length === 0;
      if (localMigrationRecords.length) {
        $("#localMigrationMessage").textContent = `Hay ${formatNumber(localMigrationRecords.length)} registros guardados antes de sincronizar. Puedes compartirlos ahora o dejarlos locales.`;
      }
      subscribeToCloudChanges();
    } catch (error) {
      cloudUser = null;
      graphAccessToken = null;
      $("#authMessage").textContent = `No se pudieron cargar los datos compartidos: ${error.message}`;
    } finally {
      cloudStateLoading = false;
      scheduleCatalogSyncIfNeeded();
    }
  }

  async function activateCloudSession(session) {
    if (cloudStateLoading || (cloudUser?.id === session.user.id && cloudChannel)) return;
    cloudStateLoading = true;
    cloudUser = session.user;
    $("#authMessage").textContent = "Cargando datos compartidos...";
    try {
      const localState = clone(state);
      let preservedLocalRecords = [];
      try {
        const savedMigration = JSON.parse(localStorage.getItem(`${STORAGE_KEY}.preCloudBackup`) || "{}");
        if (Array.isArray(savedMigration.records)) preservedLocalRecords = savedMigration.records;
      } catch (error) {
        localStorage.removeItem(`${STORAGE_KEY}.preCloudBackup`);
      }
      const [recordsResult, catalogsResult] = await Promise.all([
        supabaseClient.from("downtime_records").select("id,payload"),
        supabaseClient.from("downtime_catalogs").select("id,payload").eq("id", "shared").maybeSingle()
      ]);
      if (recordsResult.error) throw recordsResult.error;
      if (catalogsResult.error) throw catalogsResult.error;

      const remoteRecords = (recordsResult.data || []).map((row) => ({ ...row.payload, id: row.id }));
      const remoteById = new Map(remoteRecords.map((record) => [record.id, record]));
      const localCandidates = new Map([...preservedLocalRecords, ...localState.records].map((record) => [record.id, record]));
      localMigrationRecords = [...localCandidates.values()].filter((record) => {
        const remoteRecord = remoteById.get(record.id);
        if (!remoteRecord) return true;
        const localUpdated = Date.parse(record.updatedAt || record.createdAt || "") || 0;
        const remoteUpdated = Date.parse(remoteRecord.updatedAt || remoteRecord.createdAt || "") || 0;
        return localUpdated > remoteUpdated;
      });
      if (localMigrationRecords.length) {
        localStorage.setItem(`${STORAGE_KEY}.preCloudBackup`, JSON.stringify({ records: localMigrationRecords }));
      } else {
        localStorage.removeItem(`${STORAGE_KEY}.preCloudBackup`);
      }

      const remoteCatalogPayload = catalogsResult.data?.payload;
      const remoteCloudData = decodeCloudCatalogPayload(
        remoteCatalogPayload || localState.catalogs || clone(window.FLEX_DT_DEFAULTS.catalogs),
        localState.hourlyReports || []
      );
      let remoteCatalogs = remoteCloudData.catalogs;
      if (!catalogsResult.data) {
        const { error } = await supabaseClient.from("downtime_catalogs").upsert({
          id: "shared",
          payload: { ...remoteCatalogs, hourlyReports: remoteCloudData.hourlyReports }
        });
        if (error) throw error;
      }
      if (!Array.isArray(remoteCatalogs.locations) || !Array.isArray(remoteCatalogs.failures)) {
        remoteCatalogs = clone(window.FLEX_DT_DEFAULTS.catalogs);
      }
      remoteCatalogs = mergeDefaultLocations(remoteCatalogs);
      const mergedCatalogs = mergeCloudCatalogs(remoteCatalogs, localState.catalogs);

      cloudSnapshot = {
        records: new Map(remoteRecords.map((record) => [record.id, stableSerialize(record)])),
        catalogs: stableSerialize({ catalogs: remoteCatalogs, hourlyReports: remoteCloudData.hourlyReports })
      };
      state = { ...state, catalogs: mergedCatalogs, hourlyReports: remoteCloudData.hourlyReports, records: remoteRecords };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
      renderState();
      $("#storageStatus").textContent = `Compartido · ${session.user.email || "sesión activa"}`;
      $(".status-line").dataset.cloud = "connected";
      $("#storageDescription").textContent = "Registros compartidos entre usuarios autenticados.";
      $("#cloudSignOut").hidden = false;
      $("#authGate").hidden = true;
      $("#appShell").hidden = false;
      $("#localMigration").hidden = localMigrationRecords.length === 0;
      if (localMigrationRecords.length) {
        $("#localMigrationMessage").textContent = `Hay ${formatNumber(localMigrationRecords.length)} registros guardados antes de conectar la nube. Puedes compartirlos ahora o conservarlos localmente.`;
      }
      subscribeToCloudChanges();
    } catch (error) {
      cloudUser = null;
      $("#authMessage").textContent = `No se pudieron cargar los datos. Verifica que ejecutaste supabase/schema.sql: ${error.message}`;
    } finally {
      cloudStateLoading = false;
      scheduleCatalogSyncIfNeeded();
    }
  }

  function renderState() {
    populateDashboardFilters();
    renderRecords();
    renderTodaySummary();
    renderCatalogs();
    renderActiveTickets();
    renderDashboard();
    renderAnalyticsDashboard();
  }

  async function migrateLocalRecords() {
    if (!cloudUser || !localMigrationRecords.length) return;
    if (activeCloudBackend === "microsoft") {
      const mergedRecords = [...state.records];
      localMigrationRecords.forEach((record) => {
        if (!mergedRecords.some((item) => item.id === record.id)) mergedRecords.push(record);
      });
      state.records = mergedRecords;
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
      await uploadMicrosoftState({
        records: mergedRecords,
        catalogs: cloudCatalogPayload(),
        hourlyReports: state.hourlyReports,
        updatedAt: new Date().toISOString()
      });
      localMigrationRecords = [];
      localStorage.removeItem(`${STORAGE_KEY}.preCloudBackup`);
      $("#localMigration").hidden = true;
      cloudSnapshot.records = new Map(mergedRecords.map((record) => [record.id, stableSerialize(record)]));
      renderState();
      showToast("Los registros locales se compartieron correctamente.");
      return;
    }
    const rows = localMigrationRecords.map((record) => ({ id: record.id, payload: record }));
    const { error } = await supabaseClient.from("downtime_records").upsert(rows, { onConflict: "id" });
    if (error) {
      showToast(`No se pudieron compartir los registros: ${error.message}`, true);
      return;
    }
    const currentIds = new Set(state.records.map((record) => record.id));
    localMigrationRecords.forEach((record) => {
      if (!currentIds.has(record.id)) state.records.push(record);
      cloudSnapshot.records.set(record.id, stableSerialize(record));
    });
    localMigrationRecords = [];
    localStorage.removeItem(`${STORAGE_KEY}.preCloudBackup`);
    $("#localMigration").hidden = true;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    renderState();
    showToast("Los registros locales se compartieron correctamente.");
  }

  function subscribeToCloudChanges() {
    if (activeCloudBackend === "microsoft") {
      cloudChannel = { type: "graph-poll" };
      if (cloudSyncTimer) window.clearTimeout(cloudSyncTimer);
      cloudSyncTimer = window.setInterval(() => {
        if (!cloudSyncBusy && !cloudStateLoading) void refreshCloudState();
      }, 20000);
      return;
    }
    if (cloudChannel) void supabaseClient.removeChannel(cloudChannel);
    cloudChannel = supabaseClient.channel("downtime-shared-state")
      .on("postgres_changes", { event: "*", schema: "public", table: "downtime_records" }, () => {
        if (!cloudSyncBusy && !cloudStateLoading) void refreshCloudState();
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "downtime_catalogs" }, () => {
        if (!cloudSyncBusy && !cloudStateLoading) void refreshCloudState();
      })
      .subscribe();
  }

  async function refreshCloudState() {
    if (!cloudUser || cloudStateLoading) return;
    if (activeCloudBackend === "microsoft") {
      cloudStateLoading = true;
      try {
        const remoteState = await loadMicrosoftState();
        const remoteRecords = Array.isArray(remoteState.records) ? remoteState.records : [];
        const remoteCatalogs = mergeDefaultLocations(remoteState.catalogs || state.catalogs);
        const mergedCatalogs = mergeCloudCatalogs(remoteCatalogs, state.catalogs);
        const remoteHourlyReports = Array.isArray(remoteState.hourlyReports) ? remoteState.hourlyReports : [];
        state = { ...state, records: remoteRecords, catalogs: mergedCatalogs, hourlyReports: remoteHourlyReports };
        localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
        cloudSnapshot = {
          records: new Map(remoteRecords.map((record) => [record.id, stableSerialize(record)])),
          catalogs: stableSerialize({ catalogs: remoteCatalogs, hourlyReports: remoteHourlyReports })
        };
        renderState();
      } catch (error) {
        showToast(`No se pudieron actualizar los datos compartidos: ${error.message}`, true);
      } finally {
        cloudStateLoading = false;
        scheduleCatalogSyncIfNeeded();
      }
      return;
    }
    cloudStateLoading = true;
    try {
      const localById = new Map(state.records.map((record) => [record.id, record]));
      const localChanges = state.records.filter((record) => cloudSnapshot.records.get(record.id) !== stableSerialize(record));
      const localDeletions = [...cloudSnapshot.records.keys()].filter((id) => !localById.has(id));
      const localCatalogData = { catalogs: state.catalogs, hourlyReports: state.hourlyReports };
      const catalogsChanged = stableSerialize(localCatalogData) !== cloudSnapshot.catalogs;
      const [recordsResult, catalogsResult] = await Promise.all([
        supabaseClient.from("downtime_records").select("id,payload"),
        supabaseClient.from("downtime_catalogs").select("id,payload").eq("id", "shared").maybeSingle()
      ]);
      if (recordsResult.error) throw recordsResult.error;
      if (catalogsResult.error) throw catalogsResult.error;

      const remoteRecords = (recordsResult.data || []).map((row) => ({ ...row.payload, id: row.id }));
      const remoteById = new Map(remoteRecords.map((record) => [record.id, record]));
      localChanges.forEach((record) => remoteById.set(record.id, record));
      localDeletions.forEach((id) => remoteById.delete(id));
      cloudSnapshot.records = new Map(remoteRecords.map((record) => [record.id, stableSerialize(record)]));
      const remotePayload = catalogsResult.data?.payload;
      const remoteCloudData = remotePayload ? decodeCloudCatalogPayload(remotePayload) : null;
      if (remoteCloudData) {
        cloudSnapshot.catalogs = stableSerialize(remoteCloudData);
      }
      state = {
        ...state,
        records: [...remoteById.values()],
        catalogs: catalogsChanged || !remoteCloudData
          ? state.catalogs
          : mergeCloudCatalogs(remoteCloudData.catalogs, state.catalogs),
        hourlyReports: catalogsChanged || !remoteCloudData
          ? state.hourlyReports
          : remoteCloudData.hourlyReports
      };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
      renderState();
      if (localChanges.length || localDeletions.length || catalogsChanged) scheduleCloudSync();
    } catch (error) {
      showToast(`No se pudieron actualizar los datos compartidos: ${error.message}`, true);
    } finally {
      cloudStateLoading = false;
      scheduleCatalogSyncIfNeeded();
    }
  }

  function scheduleCatalogSyncIfNeeded() {
    if (!cloudMode || !cloudUser) return;
    const localCatalogData = { catalogs: state.catalogs, hourlyReports: state.hourlyReports };
    if (stableSerialize(localCatalogData) !== cloudSnapshot.catalogs) scheduleCloudSync();
  }

  function scheduleCloudSync() {
    if (!cloudMode || !cloudUser || cloudStateLoading) return;
    $("#storageStatus").textContent = "Sincronizando...";
    window.clearTimeout(cloudSyncTimer);
    cloudSyncTimer = window.setTimeout(() => {
      cloudSyncQueue = cloudSyncQueue.then(syncCloudChanges);
    }, 300);
  }

  async function syncCloudChanges() {
    if (!cloudMode || !cloudUser || cloudSyncBusy || cloudStateLoading) return;
    if (activeCloudBackend === "microsoft") {
      cloudSyncBusy = true;
      try {
        const payload = {
          records: state.records,
          catalogs: cloudCatalogPayload(),
          hourlyReports: state.hourlyReports,
          updatedAt: new Date().toISOString()
        };
        await uploadMicrosoftState(payload);
        cloudSnapshot.records = new Map(state.records.map((record) => [record.id, stableSerialize(record)]));
        cloudSnapshot.catalogs = stableSerialize({ catalogs: state.catalogs, hourlyReports: state.hourlyReports });
        $("#storageStatus").textContent = `Sincronizado · ${cloudUser.email || "sesión activa"}`;
        showToast("Cambios sincronizados con OneDrive.");
      } catch (error) {
        $("#storageStatus").textContent = "Sincronización pendiente";
        showToast(`No se pudo sincronizar. La copia local se conservó: ${error.message}`, true);
      } finally {
        cloudSyncBusy = false;
      }
      return;
    }
    const currentById = new Map(state.records.map((record) => [record.id, record]));
    const changedRecords = state.records.filter((record) => cloudSnapshot.records.get(record.id) !== stableSerialize(record));
    const deletedIds = [...cloudSnapshot.records.keys()].filter((id) => !currentById.has(id));
    const localCatalogData = { catalogs: state.catalogs, hourlyReports: state.hourlyReports };
    const catalogsChanged = stableSerialize(localCatalogData) !== cloudSnapshot.catalogs;
    if (!changedRecords.length && !deletedIds.length && !catalogsChanged) return;

    cloudSyncBusy = true;
    try {
      if (changedRecords.length) {
        const { error } = await supabaseClient.from("downtime_records").upsert(
          changedRecords.map((record) => ({ id: record.id, payload: record })),
          { onConflict: "id" }
        );
        if (error) throw error;
        changedRecords.forEach((record) => cloudSnapshot.records.set(record.id, stableSerialize(record)));
      }
      if (deletedIds.length) {
        for (let index = 0; index < deletedIds.length; index += 100) {
          const chunk = deletedIds.slice(index, index + 100);
          const { error } = await supabaseClient.from("downtime_records").delete().in("id", chunk);
          if (error) throw error;
          chunk.forEach((id) => cloudSnapshot.records.delete(id));
        }
      }
      if (catalogsChanged) {
        const catalogsSnapshot = stableSerialize(localCatalogData);
        const { error } = await supabaseClient.from("downtime_catalogs").upsert({
          id: "shared",
          payload: cloudCatalogPayload()
        });
        if (error) throw error;
        cloudSnapshot.catalogs = catalogsSnapshot;
      }
      $("#storageStatus").textContent = `Sincronizado · ${cloudUser.email || "sesión activa"}`;
      showToast("Cambios sincronizados con la nube.");
    } catch (error) {
      $("#storageStatus").textContent = "Sincronización pendiente";
      showToast(`No se pudo sincronizar. La copia local se conservó: ${error.message}`, true);
    } finally {
      cloudSyncBusy = false;
    }
  }

  function bindNavigation() {
    $("#menuToggle").addEventListener("click", () => {
      setMenuOpen(!document.body.classList.contains("nav-open"));
    });
    $("#navBackdrop").addEventListener("click", () => setMenuOpen(false, true));
    $$(".nav-item").forEach((button) => {
      button.addEventListener("click", () => {
        navigate(button.dataset.view);
        if (button.dataset.view !== "catalogs" || catalogAccessGranted) $("#menuToggle").focus();
      });
    });
    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && document.body.classList.contains("nav-open")) setMenuOpen(false, true);
    });
    $("#goDashboard").addEventListener("click", () => navigate("dashboard"));
  }

  function setMenuOpen(isOpen, restoreFocus = false) {
    document.body.classList.toggle("nav-open", isOpen);
    $("#appSidebar").setAttribute("aria-hidden", String(!isOpen));
    $("#appSidebar").inert = !isOpen;
    $("#navBackdrop").hidden = !isOpen;
    $("#menuToggle").setAttribute("aria-expanded", String(isOpen));
    $("#menuToggle").setAttribute("aria-label", isOpen ? "Cerrar menú" : "Abrir menú");
    $("#menuToggle").title = isOpen ? "Cerrar menú" : "Abrir menú";
    if (restoreFocus) $("#menuToggle").focus();
  }

  function navigate(viewName) {
    setMenuOpen(false);
    if (viewName === "catalogs" && !catalogAccessGranted) {
      $("#catalogAccessPin").value = "";
      $("#catalogAccessMessage").textContent = "";
      $("#catalogAccessDialog").showModal();
      $("#catalogAccessPin").focus();
      return;
    }
    if (viewName !== "catalogs") catalogAccessGranted = false;
    const meta = viewMeta[viewName] || viewMeta.capture;
    $$("[data-view-panel]").forEach((panel) => panel.classList.toggle("active", panel.dataset.viewPanel === viewName));
    $$(".nav-item").forEach((button) => button.classList.toggle("active", button.dataset.view === viewName));
    $("#viewEyebrow").textContent = meta.eyebrow;
    $("#viewTitle").textContent = meta.title;

    if (viewName === "dashboard") renderDashboard();
    if (viewName === "analytics") renderAnalyticsDashboard();
    if (viewName === "records") renderRecords();
    if (viewName === "catalogs") renderCatalogs();
    if (viewName === "capture") refreshHourlyCaptureOptions();
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function bindCatalogAccess() {
    $("#catalogAccessForm").addEventListener("submit", (event) => {
      event.preventDefault();
      const pin = $("#catalogAccessPin");
      if (!pin.checkValidity()) {
        pin.reportValidity();
        return;
      }
      if (pin.value !== "1730") {
        $("#catalogAccessMessage").textContent = "NIP incorrecto. Intenta de nuevo.";
        pin.value = "";
        pin.focus();
        return;
      }
      catalogAccessGranted = true;
      $("#catalogAccessDialog").close();
      navigate("catalogs");
    });
    $("#cancelCatalogAccess").addEventListener("click", () => $("#catalogAccessDialog").close());
  }

  function bindStopTickets() {
    $("#openStopTicket").addEventListener("click", openStopTicketDialog);
    $("#closeStopTicketDialog").addEventListener("click", () => $("#stopTicketDialog").close());
    $("#authenticateSupportClose").addEventListener("click", authenticateSupportAndClose);
    $("#ticketPrevious").addEventListener("click", () => setTicketStep(ticketStep - 1));
    $("#ticketNext").addEventListener("click", () => {
      if (!validateTicketStep(ticketStep)) return;
      if (ticketStep === 1) {
        startStopTicket();
        return;
      }
      if (ticketStep === 2) {
        saveStopTicketProblem();
        setTicketStep(3);
        renderActiveTickets();
        renderRecords();
        renderDashboard();
        renderAnalyticsDashboard();
        showToast("Problema guardado. Valida las condiciones y asigna soporte en el paso 3.");
        return;
      }
      setTicketStep(ticketStep + 1);
    });
    $("#closeStopTicket").addEventListener("click", closeStopTicket);
    $("#ticketArea").addEventListener("change", populateTicketLines);
    $("#ticketLine").addEventListener("change", populateTicketMachines);
    $("#ticketMachine").addEventListener("change", () => {
      const custom = $("#ticketMachine").value === CUSTOM_VALUE;
      $("#ticketCustomMachineRow").classList.toggle("hidden", !custom);
      $("#ticketCustomMachine").required = custom;
      if (!custom) $("#ticketCustomMachine").value = "";
      populateTicketProblems();
    });
    $("#ticketCustomMachine").addEventListener("input", populateTicketProblems);
    $("#ticketProblem").addEventListener("change", () => {
      const custom = $("#ticketProblem").value === CUSTOM_VALUE;
      $("#ticketCustomProblemRow").classList.toggle("hidden", !custom);
      $("#ticketCustomProblem").required = custom;
      if (!custom) $("#ticketCustomProblem").value = "";
    });
    ["#ticketRework", "#ticketScrap"].forEach((selector) =>
      $(selector).addEventListener("input", updateTicketActionRequirements)
    );
    $("#ticketActionRequirements").addEventListener("input", scheduleStopTicketActionSave);
    $("#ticketActionRequirements").addEventListener("change", scheduleStopTicketActionSave);
    ["#ticketDepartment", "#ticketSupport"].forEach((selector) => {
      $(selector).addEventListener("change", scheduleStopTicketActionSave);
    });
    $("#activeTickets").addEventListener("click", (event) => {
      const button = event.target.closest("[data-resume-ticket]");
      if (!button) return;
      const ticket = state.records.find((record) => record.id === button.dataset.resumeTicket && !record.closedAt);
      if (ticket) resumeStopTicket(ticket);
    });
  }

  function openStopTicketDialog() {
    requestTicketUserAuthentication("", openStopTicketDialogForUser);
  }

  function openStopTicketDialogForUser(user) {
    const openTicket = state.records.find((record) => record.isStopTicket && !record.closedAt);
    if (openTicket) {
      resumeStopTicket(openTicket);
      return;
    } else {
      activeTicketId = null;
      ticketStep = 1;
      resetStopTicketForm();
      setTicketStep(ticketStep);
    }
    $("#stopTicketDialog").showModal();
    updateStopTicketView();
  }

  function resumeStopTicket(ticket) {
    activeTicketId = ticket.id;
    if (ticket.captureStep !== 2 && !ticket.impactEndedAt) {
      ticket.impactEndedAt = new Date().toISOString();
      ticket.minutes = Math.round(elapsedStopTicketMinutes(ticket, Date.parse(ticket.impactEndedAt)) * 60) / 60;
      ticket.updatedAt = ticket.impactEndedAt;
      saveState();
    }
    resetStopTicketForm();
    loadStopTicketIntoDialog(ticket);
    ticketStep = ticket.captureStep === 2 ? 2 : 3;
    setTicketStep(ticketStep);
    $("#stopTicketDialog").showModal();
    updateStopTicketView();
  }

  function resetStopTicketForm() {
    $("#stopTicketForm").reset();
    populateSelect($("#ticketArea"), window.FLEX_DT_DEFAULTS.catalogs.areas, "Seleccionar");
    populateSelect($("#ticketLine"), [], "Selecciona un área");
    populateSelect($("#ticketMachine"), [], "Selecciona una línea");
    populateSelect($("#ticketProblem"), [], "Selecciona un equipo");
    populateSelect($("#ticketDepartment"), unique(state.catalogs.departments), "Seleccionar");
    $("#ticketSupport").value = "";
    $("#ticketLine").disabled = true;
    $("#ticketMachine").disabled = true;
    $("#ticketProblem").disabled = true;
    $("#ticketCustomMachineRow").classList.add("hidden");
    $("#ticketCustomProblemRow").classList.add("hidden");
    $("#ticketActionRequirements").classList.add("hidden");
    setTicketActionFieldsRequired(false);
    $("#ticketRunning").classList.add("hidden");
  }

  function loadStopTicketIntoDialog(ticket) {
    populateActionOwnerSelects();
    $("#ticketArea").value = ticket.area || "";
    populateTicketLines();
    $("#ticketLine").value = ticket.line || "";
    populateTicketMachines();
    const machineValues = Array.from($("#ticketMachine").options).map((option) => option.value);
    if (machineValues.includes(ticket.machine)) {
      $("#ticketMachine").value = ticket.machine;
    } else if (ticket.machine) {
      $("#ticketMachine").value = CUSTOM_VALUE;
      $("#ticketCustomMachineRow").classList.remove("hidden");
      $("#ticketCustomMachine").value = ticket.machine;
    }
    populateTicketProblems();
    const problemValues = Array.from($("#ticketProblem").options).map((option) => option.value);
    if (problemValues.includes(ticket.problem)) {
      $("#ticketProblem").value = ticket.problem;
    } else if (ticket.problem) {
      $("#ticketProblem").value = CUSTOM_VALUE;
      $("#ticketCustomProblemRow").classList.remove("hidden");
      $("#ticketCustomProblem").value = ticket.problem;
    }
    $("#ticketDepartment").value = ticket.department || "";
    $("#ticketSupport").value = ticket.support || "";
    $("#ticketRework").value = ticket.reworkUnits ?? 0;
    $("#ticketScrap").value = ticket.scrapUnits ?? 0;
    $("#ticketImmediateAction").value = ticket.immediateAction || "";
    $("#ticketContainment").value = ticket.containment || "";
    $("#ticketCorrective").value = ticket.corrective || "";
    $("#ticketPreventive").value = ticket.systematic || "";
    $("#ticketContainmentDue").value = ticket.actionDetails?.containment?.dueDate || "";
    $("#ticketContainmentOwner").value = catalogOwnerValue(ticket.actionDetails?.containment?.owner);
    $("#ticketCorrectiveDue").value = ticket.actionDetails?.corrective?.dueDate || "";
    $("#ticketCorrectiveOwner").value = catalogOwnerValue(ticket.actionDetails?.corrective?.owner);
    $("#ticketPreventiveDue").value = ticket.actionDetails?.systematic?.dueDate || "";
    $("#ticketPreventiveOwner").value = catalogOwnerValue(ticket.actionDetails?.systematic?.owner);
    $("#ticketActiveSummary").textContent = `${ticket.area} · ${ticket.line} · ${ticket.machine} · ${ticket.problem} · Retrabajo ${formatNumber(ticket.reworkUnits)} · Scrap ${formatNumber(ticket.scrapUnits)}`;
  }

  function setTicketStep(step) {
    ticketStep = step;
    const active = Boolean(activeTicketId);
    $$("[data-ticket-step]").forEach((panel) => panel.classList.toggle("hidden", Number(panel.dataset.ticketStep) !== step));
    $$("[data-ticket-progress]").forEach((item) => {
      const number = Number(item.dataset.ticketProgress);
      item.classList.toggle("complete", number < step);
      item.classList.toggle("current", number === step);
    });
    $("#ticketPrevious").hidden = active || step <= 1;
    $("#ticketNext").classList.toggle("hidden", step >= 3);
    const canClose = active && step === 3 && currentTicketUser?.role === "support";
    $("#closeStopTicket").classList.toggle("hidden", !canClose);
    $("#authenticateSupportClose").classList.toggle("hidden", !active || step !== 3 || currentTicketUser?.role === "support");
    if (canClose && !$("#ticketSupport").value) $("#ticketSupport").value = currentTicketUser.name;
    $("#ticketNext").textContent = step === 2 ? "Validar condiciones y asignar soporte" : "Siguiente";
    $("#ticketNext").classList.toggle("secondary", step !== 2);
    $("#ticketNext").classList.toggle("primary", step === 2);
    $("#ticketStepMessage").textContent = active ? "" : `Paso ${step} de 3`;
    if (active && step >= 2) {
      $("#ticketRunning").classList.remove("hidden");
    } else {
      $("#ticketRunning").classList.add("hidden");
    }
    updateTicketActionRequirements();
  }

  function validateTicketStep(step) {
    const panel = $(`[data-ticket-step="${step}"]`);
    const invalid = $$("[required]", panel).find((input) => !input.disabled && !input.checkValidity());
    if (invalid) {
      invalid.reportValidity();
      return false;
    }
    return true;
  }

  function populateTicketLines() {
    const area = $("#ticketArea").value;
    const lines = unique(state.catalogs.locations.filter((item) => item.area === area).map((item) => item.line));
    populateSelect($("#ticketLine"), lines, area ? "Seleccionar" : "Selecciona un área");
    $("#ticketLine").disabled = !area || !lines.length;
    populateSelect($("#ticketMachine"), [], "Selecciona una línea");
    populateSelect($("#ticketProblem"), [], "Selecciona un equipo");
    $("#ticketMachine").disabled = true;
    $("#ticketProblem").disabled = true;
  }

  function populateTicketMachines() {
    const area = $("#ticketArea").value;
    const line = $("#ticketLine").value;
    const machines = unique(state.catalogs.locations
      .filter((item) => item.area === area && item.line === line)
      .map((item) => item.machine))
      .map((value) => ({ value, label: value }));
    if (line) machines.push({ value: CUSTOM_VALUE, label: "Otro / no catalogado" });
    populateSelect($("#ticketMachine"), machines, line ? "Seleccionar" : "Selecciona una línea");
    $("#ticketMachine").disabled = !line;
    $("#ticketCustomMachineRow").classList.add("hidden");
    $("#ticketCustomMachine").required = false;
    $("#ticketCustomMachine").value = "";
    populateTicketProblems();
  }

  function ticketMachineName() {
    return $("#ticketMachine").value === CUSTOM_VALUE
      ? $("#ticketCustomMachine").value.trim()
      : $("#ticketMachine").value;
  }

  function populateTicketProblems() {
    const machine = ticketMachineName();
    const problems = unique(failureRulesForMachine(machine).map((rule) => rule.problem))
      .map((value) => ({ value, label: value }));
    if (machine) problems.push({ value: CUSTOM_VALUE, label: "Otro / no catalogado" });
    populateSelect($("#ticketProblem"), problems, machine ? "Seleccionar" : "Selecciona un equipo");
    $("#ticketProblem").disabled = !machine;
    $("#ticketCustomProblemRow").classList.add("hidden");
    $("#ticketCustomProblem").required = false;
    $("#ticketCustomProblem").value = "";
  }

  function ticketProblemName() {
    return $("#ticketProblem").value === CUSTOM_VALUE
      ? $("#ticketCustomProblem").value.trim()
      : $("#ticketProblem").value;
  }

  function ticketActionThreshold(record, minutes = record.minutes) {
    return Number(record.reworkUnits) > 5 || Number(record.scrapUnits) >= 1 || Number(minutes) > 30;
  }

  function setTicketActionFieldsRequired(isRequired) {
    [
      "#ticketContainment", "#ticketContainmentDue", "#ticketContainmentOwner",
      "#ticketCorrective", "#ticketCorrectiveDue", "#ticketCorrectiveOwner",
      "#ticketPreventive", "#ticketPreventiveDue", "#ticketPreventiveOwner"
    ].forEach((selector) => {
      $(selector).required = isRequired;
    });
  }

  function updateTicketActionRequirements() {
    const ticket = state.records.find((record) => record.id === activeTicketId && record.isStopTicket);
    const minutes = ticket ? elapsedStopTicketMinutes(ticket) : 0;
    const reasons = [];
    const reworkUnits = ticket ? Number(ticket.reworkUnits) : Number($("#ticketRework").value);
    const scrapUnits = ticket ? Number(ticket.scrapUnits) : Number($("#ticketScrap").value);
    if (reworkUnits > 5) reasons.push(`retrabajo: ${formatNumber(reworkUnits)} tarjetas`);
    if (scrapUnits >= 1) reasons.push(`scrap: ${formatNumber(scrapUnits)} tarjetas`);
    if (minutes > 30) reasons.push(`tiempo de paro: ${formatNumber(minutes)} minutos`);
    const requiresActions = ticket
      ? ticketActionThreshold(ticket, minutes)
      : reworkUnits > 5 || scrapUnits >= 1;
    $("#ticketActionRequirements").classList.toggle("hidden", !requiresActions || ticketStep !== 3);
    $("#ticketActionReason").textContent = requiresActions
      ? `Condición(es) cumplida(s): ${reasons.join("; ")}. Completa cada acción con owner y fecha de cierre.`
      : "Completa las acciones de contención, correctiva y sistemática con owner y fecha de cierre.";
    setTicketActionFieldsRequired(requiresActions);
  }

  function scheduleStopTicketActionSave() {
    if (ticketStep !== 3 || !activeTicketId) return;
    window.clearTimeout(ticketActionSaveTimer);
    ticketActionSaveTimer = window.setTimeout(() => {
      const ticket = state.records.find((record) => record.id === activeTicketId && !record.closedAt);
      if (!ticket) return;
      ticket.containment = $("#ticketContainment").value.trim();
      ticket.corrective = $("#ticketCorrective").value.trim();
      ticket.systematic = $("#ticketPreventive").value.trim();
      ticket.actionDetails = {
        containment: { dueDate: $("#ticketContainmentDue").value, owner: $("#ticketContainmentOwner").value },
        corrective: { dueDate: $("#ticketCorrectiveDue").value, owner: $("#ticketCorrectiveOwner").value },
        systematic: { dueDate: $("#ticketPreventiveDue").value, owner: $("#ticketPreventiveOwner").value }
      };
      ticket.updatedAt = new Date().toISOString();
      saveState();
    }, 500);
  }

  function shiftContextForTimestamp(value) {
    const timestamp = value instanceof Date ? new Date(value) : new Date(value);
    const hour = timestamp.getHours();
    if (hour >= 7 && hour < 15) return { date: localDateISO(timestamp), shift: "1" };
    if (hour >= 15 && hour < 23) return { date: localDateISO(timestamp), shift: "2" };
    if (hour < 7) timestamp.setDate(timestamp.getDate() - 1);
    return { date: localDateISO(timestamp), shift: "3" };
  }

  function selectedTicketSupport() {
    return currentTicketUser?.role === "support" ? currentTicketUser.name : "";
  }

  function startStopTicket() {
    const now = new Date();
    const context = shiftContextForTimestamp(now);
    const reworkUnits = Number($("#ticketRework").value);
    const scrapUnits = Number($("#ticketScrap").value);
    const record = {
      id: createRecordId(),
      isStopTicket: true,
      date: context.date,
      shift: context.shift,
      line: $("#ticketLine").value,
      area: $("#ticketArea").value,
      machine: ticketMachineName(),
      problem: "",
      department: "",
      support: "",
      openedBy: ticketUserSnapshot(currentTicketUser),
      closedBy: null,
      units: reworkUnits + scrapUnits,
      reworkUnits,
      scrapUnits,
      immediateAction: $("#ticketImmediateAction").value.trim(),
      containment: "",
      corrective: "",
      systematic: "",
      actionStatus: { containment: "pending", corrective: "pending", systematic: "pending" },
      actionDetails: {},
      minutes: 0,
      startedAt: now.toISOString(),
      captureStep: 2,
      closedAt: null,
      createdAt: now.toISOString(),
      updatedAt: now.toISOString()
    };
    state.records.push(record);
    activeTicketId = record.id;
    loadStopTicketIntoDialog(record);
    saveState();
    setTicketStep(2);
    renderActiveTickets();
    renderRecords();
    renderDashboard();
    renderAnalyticsDashboard();
    updateStopTicketView();
    showToast("Cronómetro iniciado. Registra el problema y su impacto en el paso 2.");
  }

  function saveStopTicketProblem() {
    const ticket = state.records.find((record) => record.id === activeTicketId && record.isStopTicket && !record.closedAt);
    if (!ticket) {
      showToast("No se encontró el ticket de paro abierto para guardar el problema.", true);
      return;
    }
    ticket.problem = ticketProblemName();
    ticket.reworkUnits = Number($("#ticketRework").value);
    ticket.scrapUnits = Number($("#ticketScrap").value);
    ticket.units = ticket.reworkUnits + ticket.scrapUnits;
    ticket.immediateAction = $("#ticketImmediateAction").value.trim();
    ticket.impactEndedAt = new Date().toISOString();
    ticket.minutes = Math.round(elapsedStopTicketMinutes(ticket, Date.parse(ticket.impactEndedAt)) * 60) / 60;
    ticket.captureStep = 3;
    ticket.updatedAt = new Date().toISOString();
    saveState();
    updateTicketActionRequirements();
    updateStopTicketView();
  }

  function elapsedStopTicketMinutes(ticket, now = Date.now()) {
    const start = Date.parse(ticket.startedAt);
    const stoppedAt = ticket.impactEndedAt || ticket.closedAt;
    const end = stoppedAt ? Date.parse(stoppedAt) : now;
    return Number.isFinite(start) && Number.isFinite(end) && end >= start ? (end - start) / 60000 : 0;
  }

  function formatElapsedStopTicket(ticket, now = Date.now()) {
    const seconds = Math.floor(elapsedStopTicketMinutes(ticket, now) * 60);
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const remainingSeconds = seconds % 60;
    return [hours, minutes, remainingSeconds].map((value) => String(value).padStart(2, "0")).join(":");
  }

  function updateStopTicketView() {
    const now = Date.now();
    const ticket = state.records.find((record) => record.id === activeTicketId && record.isStopTicket && !record.closedAt);
    if (ticket && ticketStep >= 2) {
      $("#ticketElapsed").textContent = formatElapsedStopTicket(ticket, now);
      $("#ticketOpenedAt").textContent = `Iniciado ${new Intl.DateTimeFormat("es-MX", { dateStyle: "short", timeStyle: "medium" }).format(new Date(ticket.startedAt))}`;
      $("#ticketClockStatus").textContent = ticket.impactEndedAt
        ? "TIEMPO DE IMPACTO · DETENIDO"
        : "TIEMPO DE IMPACTO · EN CURSO";
      $("#ticketRunning").classList.remove("hidden");
      $("#ticketActiveSummary").textContent = `${ticket.area} · ${ticket.line} · ${ticket.machine}${ticket.problem ? ` · ${ticket.problem}` : ""} · Retrabajo ${formatNumber(ticket.reworkUnits)} · Scrap ${formatNumber(ticket.scrapUnits)}`;
    } else {
      $("#ticketRunning").classList.add("hidden");
    }
    $$("#activeTickets [data-ticket-clock]").forEach((clock) => {
      const active = state.records.find((record) => record.id === clock.dataset.ticketClock && !record.closedAt);
      if (active) clock.textContent = formatElapsedStopTicket(active, now);
    });
    updateTicketActionRequirements();
    if ($("#hourlyRows tr[data-index]")) updateHourlyMetrics();
  }

  function renderActiveTickets() {
    const container = $("#activeTickets");
    container.replaceChildren();
    const tickets = state.records.filter((record) => record.isStopTicket && !record.closedAt);
    container.classList.toggle("hidden", tickets.length === 0);
    tickets.forEach((ticket) => {
      const item = document.createElement("div");
      item.className = "active-ticket";
      const details = document.createElement("span");
      details.textContent = `${ticket.area} · ${ticket.line} · ${ticket.machine} · ${ticket.problem}`;
      const timer = document.createElement("strong");
      timer.dataset.ticketClock = ticket.id;
      timer.textContent = formatElapsedStopTicket(ticket);
      const resume = document.createElement("button");
      resume.type = "button";
      resume.className = "button ghost";
      resume.dataset.resumeTicket = ticket.id;
      resume.textContent = "Abrir ticket";
      item.append(details, timer, resume);
      container.append(item);
    });
  }

  function closeStopTicket() {
    if (currentTicketUser?.role !== "support") {
      showToast("Solo una cuenta autenticada de soporte puede cerrar el ticket.", true);
      return;
    }
    const ticket = state.records.find((record) => record.id === activeTicketId && record.isStopTicket && !record.closedAt);
    if (!ticket) {
      showToast("No se encontró un ticket de paro abierto para cerrar.", true);
      return;
    }
    const invalidSupport = ["#ticketDepartment", "#ticketSupport"]
      .map((selector) => $(selector))
      .find((input) => !input.value || !input.checkValidity());
    if (invalidSupport) {
      invalidSupport.reportValidity();
      return;
    }
    const minutes = elapsedStopTicketMinutes(ticket);
    if (ticketActionThreshold(ticket, minutes)) {
      $("#ticketActionRequirements").classList.remove("hidden");
      setTicketActionFieldsRequired(true);
      const invalidAction = $$("#ticketActionRequirements [required]")
        .find((input) => !input.checkValidity());
      if (invalidAction) {
        invalidAction.reportValidity();
        return;
      }
      ticket.containment = $("#ticketContainment").value.trim();
      ticket.corrective = $("#ticketCorrective").value.trim();
      ticket.systematic = $("#ticketPreventive").value.trim();
      ticket.actionDetails = {
        containment: { dueDate: $("#ticketContainmentDue").value, owner: $("#ticketContainmentOwner").value },
        corrective: { dueDate: $("#ticketCorrectiveDue").value, owner: $("#ticketCorrectiveOwner").value },
        systematic: { dueDate: $("#ticketPreventiveDue").value, owner: $("#ticketPreventiveOwner").value }
      };
    }
    ticket.department = $("#ticketDepartment").value;
    ticket.support = selectedTicketSupport();
    ticket.closedBy = ticketUserSnapshot(currentTicketUser);
    const closedAt = new Date();
    ticket.closedAt = closedAt.toISOString();
    ticket.captureStep = null;
    ticket.minutes = Math.round(elapsedStopTicketMinutes(ticket, closedAt.getTime()) * 60) / 60;
    ticket.updatedAt = closedAt.toISOString();
    saveState();
    activeTicketId = null;
    ticketStep = 1;
    $("#stopTicketDialog").close();
    renderActiveTickets();
    renderRecords();
    renderDashboard();
    renderAnalyticsDashboard();
    updateHourlyMetrics();
    showToast(`Paro cerrado. Tiempo de impacto: ${formatNumber(ticket.minutes)} minutos.`);
  }

  function authenticateSupportAndClose() {
    requestTicketUserAuthentication("support", (user) => {
      $("#ticketSupport").value = user.name;
      closeStopTicket();
    });
  }

  function initializeHourlyCapture() {
    $("#hourlyDate").value = localDateISO();
    populateSelect($("#hourlyArea"), window.FLEX_DT_DEFAULTS.catalogs.areas, "Seleccionar");
    populateSelect($("#hourlyLine"), [], "Selecciona un área");
    populateSelect($("#hourlyModel"), [], "Selecciona una línea");
    $("#hourlyLine").disabled = true;
    $("#hourlyModel").disabled = true;
    renderHourlyRows();
  }

  function bindHourlyCapture() {
    $("#hourlyArea").addEventListener("change", () => {
      populateHourlyLines();
      populateHourlyModels();
      renderHourlyRows();
    });
    $("#hourlyLine").addEventListener("change", () => {
      populateHourlyModels();
      renderHourlyRows();
    });
    ["#hourlyDate", "#hourlyShift", "#hourlyModel"].forEach((selector) =>
      $(selector).addEventListener("change", () => {
        updateHourlyRate();
        renderHourlyRows();
      })
    );
    $("#hourlyRows").addEventListener("input", updateHourlyMetrics);
    $("#hourlyRows").addEventListener("input", saveHourlyDraft);
    $("#hourlyRows").addEventListener("change", () => {
      updateHourlyMetrics();
      saveHourlyDraft();
    });
    $("#hourlyRows").addEventListener("click", (event) => {
      const button = event.target.closest("button[data-manual-hour]");
      if (button) openManualDowntimeDialog(Number(button.dataset.manualHour));
    });
    $("#openManualDowntime").addEventListener("click", () => openManualDowntimeDialog());
    ["#cancelManualDowntime", "#cancelManualDowntimeAction"].forEach((selector) =>
      $(selector).addEventListener("click", () => $("#manualDowntimeDialog").close())
    );
    $("#manualDowntimeForm").addEventListener("submit", saveManualDowntime);
    $("#manualArea").addEventListener("change", populateManualLines);
    $("#manualLine").addEventListener("change", populateManualMachines);
    $("#manualMachine").addEventListener("change", updateManualMachine);
    $("#manualCustomMachine").addEventListener("input", populateManualProblems);
    $("#manualProblem").addEventListener("change", updateManualProblem);
    ["#manualRework", "#manualScrap", "#manualDowntimeMinutes"].forEach((selector) =>
      $(selector).addEventListener("input", updateManualActionRequirements)
    );
    $("#saveHourlyReport").addEventListener("click", saveHourlyReport);
  }

  function openManualDowntimeDialog(hourIndex) {
    requestTicketUserAuthentication("", (user) => openManualDowntimeDialogForUser(user, hourIndex));
  }

  function openManualDowntimeDialogForUser(user, hourIndex) {
    $("#manualDowntimeForm").reset();
    const hourSelect = $("#manualDowntimeHour");
    populateSelect(hourSelect, [], "Selecciona la hora");
    const date = $("#hourlyDate").value;
    const shift = $("#hourlyShift").value;
    const area = $("#hourlyArea").value;
    const line = $("#hourlyLine").value;
    if (date && shift) {
      const start = hourlyShiftStart(shift);
      const hours = Array.from({ length: 8 }, (_, index) => {
        const hourStart = (start + index) % 24;
        const hourEnd = (hourStart + 1) % 24;
        return {
          value: String(index),
          label: `${String(hourStart).padStart(2, "0")}:00–${String(hourEnd).padStart(2, "0")}:00`
        };
      });
      populateSelect(hourSelect, hours, "Selecciona la hora");
      if (Number.isInteger(hourIndex) && hourIndex >= 0 && hourIndex < 8) {
        hourSelect.value = String(hourIndex);
      }
    }
    populateSelect($("#manualArea"), window.FLEX_DT_DEFAULTS.catalogs.areas, "Seleccionar", area);
    populateManualLines(line);
    populateSelect($("#manualDepartment"), unique(state.catalogs.departments), "Seleccionar");
    populateActionOwnerSelects();
    $("#manualRework").value = "0";
    $("#manualScrap").value = "0";
    manualDowntimeOpenedBy = ticketUserSnapshot(user);
    $("#manualSupport").value = user.role === "support" ? user.name : "";
    setManualActionFieldsRequired(false);
    $("#manualActionRequirements").classList.add("hidden");
    $("#manualDowntimeMessage").textContent = "";
    updateManualActionRequirements();
    $("#manualDowntimeDialog").showModal();
  }

  function populateManualLines(selectedLine = "") {
    const area = $("#manualArea").value;
    const lines = unique(state.catalogs.locations.filter((item) => item.area === area).map((item) => item.line));
    populateSelect($("#manualLine"), lines, area ? "Seleccionar" : "Selecciona un área", lines.includes(selectedLine) ? selectedLine : "");
    $("#manualLine").disabled = !area || !lines.length;
    populateManualMachines();
  }

  function populateManualMachines(selectedMachine = "") {
    const area = $("#manualArea").value;
    const line = $("#manualLine").value;
    const machines = unique(state.catalogs.locations
      .filter((item) => item.area === area && item.line === line)
      .map((item) => item.machine))
      .map((value) => ({ value, label: value }));
    if (line) machines.push({ value: CUSTOM_VALUE, label: "Otro / no catalogado" });
    populateSelect($("#manualMachine"), machines, line ? "Seleccionar" : "Selecciona una línea", machines.some((item) => item.value === selectedMachine) ? selectedMachine : "");
    $("#manualMachine").disabled = !line;
    updateManualMachine();
  }

  function updateManualMachine() {
    const custom = $("#manualMachine").value === CUSTOM_VALUE;
    $("#manualCustomMachineRow").classList.toggle("hidden", !custom);
    $("#manualCustomMachine").required = custom;
    if (!custom) $("#manualCustomMachine").value = "";
    populateManualProblems();
  }

  function manualMachineName() {
    return $("#manualMachine").value === CUSTOM_VALUE
      ? $("#manualCustomMachine").value.trim()
      : $("#manualMachine").value;
  }

  function populateManualProblems(selectedProblem = "") {
    const machine = manualMachineName();
    const problems = unique(failureRulesForMachine(machine).map((rule) => rule.problem))
      .map((value) => ({ value, label: value }));
    if (machine) problems.push({ value: CUSTOM_VALUE, label: "Otro / no catalogado" });
    populateSelect($("#manualProblem"), problems, machine ? "Seleccionar" : "Selecciona un equipo", selectedProblem);
    $("#manualProblem").disabled = !machine;
    updateManualProblem();
  }

  function updateManualProblem() {
    const custom = $("#manualProblem").value === CUSTOM_VALUE;
    $("#manualCustomProblemRow").classList.toggle("hidden", !custom);
    $("#manualCustomProblem").required = custom;
    if (!custom) $("#manualCustomProblem").value = "";
  }

  function manualProblemName() {
    return $("#manualProblem").value === CUSTOM_VALUE
      ? $("#manualCustomProblem").value.trim()
      : $("#manualProblem").value;
  }

  function manualActionThreshold() {
    return Number($("#manualRework").value) > 5 ||
      Number($("#manualScrap").value) >= 1 ||
      Number($("#manualDowntimeMinutes").value) > 30;
  }

  function setManualActionFieldsRequired(required) {
    [
      "#manualContainment", "#manualContainmentDue", "#manualContainmentOwner",
      "#manualCorrective", "#manualCorrectiveDue", "#manualCorrectiveOwner",
      "#manualPreventive", "#manualPreventiveDue", "#manualPreventiveOwner"
    ].forEach((selector) => {
      $(selector).required = required;
    });
  }

  function updateManualActionRequirements() {
    const rework = Number($("#manualRework").value);
    const scrap = Number($("#manualScrap").value);
    const minutes = Number($("#manualDowntimeMinutes").value);
    const reasons = [];
    if (rework > 5) reasons.push(`retrabajo: ${formatNumber(rework)} tarjetas`);
    if (scrap >= 1) reasons.push(`scrap: ${formatNumber(scrap)} tarjetas`);
    if (minutes > 30) reasons.push(`tiempo de paro: ${formatNumber(minutes)} minutos`);
    const required = manualActionThreshold();
    $("#manualActionRequirements").classList.toggle("hidden", !required);
    $("#manualActionReason").textContent = required
      ? `Condición(es) cumplida(s): ${reasons.join("; ")}. Registra las acciones con owner y fecha de cierre.`
      : "Aplica por más de 5 tarjetas para retrabajo, 1 o más para scrap, o más de 30 minutos de paro.";
    setManualActionFieldsRequired(required);
  }

  function saveManualDowntime(event, options = {}) {
    event.preventDefault();
    const keepOpen = options.keepOpen || event.submitter?.id === "saveManualAndContinue";
    if (currentTicketUser?.role !== "support") {
      requestTicketUserAuthentication("support", (user) => {
        $("#manualSupport").value = user.name;
        saveManualDowntime(new Event("submit", { cancelable: true }), { keepOpen });
      });
      return;
    }
    $("#manualSupport").value = currentTicketUser.name;
    if (!$("#hourlyDate").value || !$("#hourlyShift").value) {
      $("#manualDowntimeMessage").textContent = "Selecciona primero la fecha y el turno de producción para asignar la hora.";
      return;
    }
    const invalidInput = $$("[required]", $("#manualDowntimeForm"))
      .find((input) => !input.disabled && !input.checkValidity());
    if (invalidInput) {
      invalidInput.reportValidity();
      return;
    }
    const hourInput = $("#manualDowntimeHour");
    const minutesInput = $("#manualDowntimeMinutes");
    const hourIndex = Number(hourInput.value);
    const minutes = Number(minutesInput.value);
    const bounds = hourlyInterval($("#hourlyDate").value, $("#hourlyShift").value, hourIndex);
    if (!bounds || !Number.isInteger(minutes) || minutes < 1 || minutes > 60) {
      minutesInput.reportValidity();
      return;
    }
    const date = $("#hourlyDate").value;
    const shift = $("#hourlyShift").value;
    const area = $("#manualArea").value;
    const line = $("#manualLine").value;
    const reworkUnits = Number($("#manualRework").value);
    const scrapUnits = Number($("#manualScrap").value);
    const existingManualMinutes = state.records
      .filter((record) => record.isManualDowntime &&
        record.date === date &&
        String(record.shift) === shift &&
        record.area === area &&
        record.line === line &&
        Number(record.hourIndex) === hourIndex)
      .reduce((total, record) => total + Number(record.minutes || 0), 0);
    if (existingManualMinutes + minutes > 60) {
      $("#manualDowntimeMessage").textContent = `Esta hora ya tiene ${formatNumber(existingManualMinutes)} min de carga manual; el total manual no puede exceder 60 min.`;
      return;
    }
    const priorMinutes = existingManualMinutes;
    const startedAt = new Date(bounds.start.getTime() + priorMinutes * 60000);
    const impactEndedAt = new Date(Math.min(bounds.end.getTime(), startedAt.getTime() + minutes * 60000));
    const createdAt = new Date();
    const requiresActions = manualActionThreshold();
    const actionDetails = requiresActions ? {
      containment: { dueDate: $("#manualContainmentDue").value, owner: $("#manualContainmentOwner").value },
      corrective: { dueDate: $("#manualCorrectiveDue").value, owner: $("#manualCorrectiveOwner").value },
      systematic: { dueDate: $("#manualPreventiveDue").value, owner: $("#manualPreventiveOwner").value }
    } : {};
    const record = {
      id: createRecordId(),
      isManualDowntime: true,
      date,
      shift,
      area,
      line,
      machine: manualMachineName(),
      problem: manualProblemName(),
      rootCause: "Ticket no levantado en tiempo y forma",
      department: $("#manualDepartment").value,
      support: currentTicketUser.name,
      openedBy: manualDowntimeOpenedBy,
      closedBy: ticketUserSnapshot(currentTicketUser),
      units: reworkUnits + scrapUnits,
      reworkUnits,
      scrapUnits,
      immediateAction: $("#manualImmediateAction").value.trim(),
      containment: requiresActions ? $("#manualContainment").value.trim() : "",
      corrective: requiresActions ? $("#manualCorrective").value.trim() : "",
      systematic: requiresActions ? $("#manualPreventive").value.trim() : "",
      actionStatus: { containment: "pending", corrective: "pending", systematic: "pending" },
      actionDetails,
      minutes: (impactEndedAt.getTime() - startedAt.getTime()) / 60000,
      hourIndex,
      startedAt: startedAt.toISOString(),
      impactEndedAt: impactEndedAt.toISOString(),
      closedAt: createdAt.toISOString(),
      createdAt: createdAt.toISOString(),
      updatedAt: createdAt.toISOString()
    };
    state.records.push(record);
    saveState();
    renderActiveTickets();
    renderRecords();
    renderDashboard();
    renderAnalyticsDashboard();
    updateHourlyMetrics();
    if (keepOpen) {
      resetManualDowntimeEventFields();
      showToast(`${formatNumber(record.minutes)} min guardados. Puedes capturar otro evento para esta hora.`);
    } else {
      $("#manualDowntimeDialog").close();
      showToast(`${formatNumber(record.minutes)} min de captura manual asignados a la hora seleccionada.`);
    }
  }

  function resetManualDowntimeEventFields() {
    $("#manualDowntimeMinutes").value = "";
    $("#manualRework").value = "0";
    $("#manualScrap").value = "0";
    $("#manualImmediateAction").value = "";
    [
      "#manualContainment", "#manualContainmentDue", "#manualContainmentOwner",
      "#manualCorrective", "#manualCorrectiveDue", "#manualCorrectiveOwner",
      "#manualPreventive", "#manualPreventiveDue", "#manualPreventiveOwner"
    ].forEach((selector) => { $(selector).value = ""; });
    $("#manualSupport").value = currentTicketUser?.name || "";
    $("#manualDowntimeMessage").textContent = "";
    updateManualActionRequirements();
  }

  function populateHourlyLines(selectedLine = "") {
    const area = $("#hourlyArea").value;
    const lines = unique(state.catalogs.locations.filter((item) => item.area === area).map((item) => item.line));
    populateSelect($("#hourlyLine"), lines, area ? "Seleccionar" : "Selecciona un área", lines.includes(selectedLine) ? selectedLine : "");
    $("#hourlyLine").disabled = !area || !lines.length;
  }

  function populateHourlyModels(selectedModel = "") {
    const area = $("#hourlyArea").value;
    const line = $("#hourlyLine").value;
    const models = state.catalogs.models
      .filter((item) => item.area === area && item.line === line)
      .sort((a, b) => a.name.localeCompare(b.name, "es"))
      .map((item) => ({ value: item.name, label: item.name }));
    populateSelect(
      $("#hourlyModel"),
      models,
      line ? "Seleccionar" : "Selecciona una línea",
      models.some((item) => item.value === selectedModel) ? selectedModel : ""
    );
    $("#hourlyModel").disabled = !line || !models.length;
    updateHourlyRate();
  }

  function refreshHourlyCaptureOptions() {
    const area = $("#hourlyArea").value;
    const line = $("#hourlyLine").value;
    const model = $("#hourlyModel").value;
    populateSelect($("#hourlyArea"), window.FLEX_DT_DEFAULTS.catalogs.areas, "Seleccionar", area);
    populateHourlyLines(line);
    populateHourlyModels(model);
    renderHourlyRows();
  }

  function selectedHourlyModel() {
    return state.catalogs.models.find((item) =>
      item.area === $("#hourlyArea").value &&
      item.line === $("#hourlyLine").value &&
      item.name === $("#hourlyModel").value
    );
  }

  function updateHourlyRate() {
    const model = selectedHourlyModel();
    $("#hourlyRate").textContent = model ? `${formatNumber(activeHourlyRate(model))} tarjetas` : "—";
  }

  function hourlyReportKey(report) {
    return [report.date, report.shift, report.area, report.line, report.model].join("|");
  }

  function activeHourlyRate(model = selectedHourlyModel()) {
    if (!model) return 0;
    const currentKey = hourlyReportKey({
      date: $("#hourlyDate").value,
      shift: $("#hourlyShift").value,
      area: $("#hourlyArea").value,
      line: $("#hourlyLine").value,
      model: model.name
    });
    const saved = state.hourlyReports.find((report) => hourlyReportKey(report) === currentKey);
    return Number(saved?.rate) > 0 ? Number(saved.rate) : Number(model.rate);
  }

  function hourlyShiftStart(shift) {
    return { "1": 7, "2": 15, "3": 23 }[shift];
  }

  function hourlyInterval(date, shift, index) {
    const shiftStart = hourlyShiftStart(shift);
    if (!date || shiftStart === undefined || !Number.isInteger(index)) return null;
    const start = new Date(`${date}T00:00:00`);
    start.setHours(shiftStart + index, 0, 0, 0);
    return { start, end: new Date(start.getTime() + 60 * 60 * 1000) };
  }

  function stopTicketMinutesInRange(area, line, start, end) {
    const rangeStart = start.getTime();
    const rangeEnd = end.getTime();
    const intervals = state.records
      .filter((record) => (record.isStopTicket || record.isManualDowntime) &&
        record.area === area && record.line === line && record.startedAt)
      .map((record) => ({
        start: Math.max(rangeStart, Date.parse(record.startedAt)),
        end: Math.min(rangeEnd, Date.parse(record.impactEndedAt || record.closedAt || new Date().toISOString()))
      }))
      .filter((interval) => interval.end > interval.start)
      .sort((a, b) => a.start - b.start);
    let elapsed = 0;
    let activeStart = null;
    let activeEnd = null;
    intervals.forEach((interval) => {
      if (activeStart === null) {
        activeStart = interval.start;
        activeEnd = interval.end;
      } else if (interval.start <= activeEnd) {
        activeEnd = Math.max(activeEnd, interval.end);
      } else {
        elapsed += activeEnd - activeStart;
        activeStart = interval.start;
        activeEnd = interval.end;
      }
    });
    if (activeStart !== null) elapsed += activeEnd - activeStart;
    return elapsed / 60000;
  }

  function renderHourlyRows() {
    const body = $("#hourlyRows");
    body.replaceChildren();
    const date = $("#hourlyDate").value;
    const shift = $("#hourlyShift").value;
    const model = selectedHourlyModel();
    if (!date || !shift) {
      const empty = document.createElement("tr");
      const message = document.createElement("td");
      message.colSpan = 6;
      message.className = "hourly-empty";
      message.textContent = "Selecciona fecha y turno para mostrar las horas de captura.";
      empty.append(message);
      body.append(empty);
      updateHourlyMetrics();
      return;
    }

    const key = hourlyReportKey({
      date,
      shift,
      area: $("#hourlyArea").value,
      line: $("#hourlyLine").value,
      model: model?.name || ""
    });
    const saved = model ? state.hourlyReports.find((report) => hourlyReportKey(report) === key) : null;
    const startingHour = hourlyShiftStart(shift);
    Array.from({ length: 8 }, (_, index) => {
      const hourStart = (startingHour + index) % 24;
      const hourEnd = (hourStart + 1) % 24;
      const savedHour = saved?.hours?.[index] || {};
      const row = document.createElement("tr");
      row.dataset.index = String(index);
      const hour = document.createElement("th");
      hour.scope = "row";
      hour.textContent = `${String(hourStart).padStart(2, "0")}:00–${String(hourEnd).padStart(2, "0")}:00`;
      row.append(hour);

      const target = document.createElement("td");
      target.textContent = model ? formatNumber(saved?.rate || model.rate) : "—";
      row.append(target);

      const actualCell = document.createElement("td");
      const actualInput = hourlyNumberInput("actual", savedHour.actual ?? "", "Tarjetas reales", 0);
      actualInput.disabled = !model;
      actualCell.append(actualInput);
      row.append(actualCell);

      const downtimeCell = document.createElement("td");
      downtimeCell.className = "hourly-ticket-time";
      downtimeCell.dataset.field = "ticketDowntime";
      downtimeCell.textContent = "0 min";
      row.append(downtimeCell);

      const justifyCell = document.createElement("td");
      justifyCell.className = "hourly-justify";
      justifyCell.dataset.field = "justify";
      justifyCell.textContent = "—";
      row.append(justifyCell);

      const manualCell = document.createElement("td");
      const manualButton = document.createElement("button");
      manualButton.type = "button";
      manualButton.className = "button ghost hourly-manual-button";
      manualButton.dataset.manualHour = String(index);
      manualButton.textContent = "Cargar DT";
      manualButton.setAttribute("aria-label", `Cargar tiempo muerto manual de ${hour.textContent}`);
      manualCell.append(manualButton);
      row.append(manualCell);
      body.append(row);
    });
    updateHourlyMetrics();
  }

  function hourlyNumberInput(field, value, label, min, max) {
    const input = document.createElement("input");
    input.type = "number";
    input.min = String(min);
    if (max !== undefined) input.max = String(max);
    input.step = field === "actual" || field === "downtime" ? "1" : "any";
    input.inputMode = "decimal";
    input.placeholder = field === "actual" ? "0" : "0";
    input.value = value;
    input.dataset.field = field;
    input.setAttribute("aria-label", label);
    if (field === "actual") input.required = true;
    return input;
  }

  function hourlyRowValues() {
    const rate = activeHourlyRate();
    return $$("#hourlyRows tr[data-index]").map((row) => {
      const actual = Number($('[data-field="actual"]', row).value) || 0;
      const lostMinutes = rate ? Math.min(60, Math.max(0, (rate - actual) / rate * 60)) : 0;
      const date = $("#hourlyDate").value;
      const shift = $("#hourlyShift").value;
      const index = Number(row.dataset.index);
      const bounds = hourlyInterval(date, shift, index);
      const downtime = bounds && $("#hourlyArea").value && $("#hourlyLine").value
        ? stopTicketMinutesInRange($("#hourlyArea").value, $("#hourlyLine").value, bounds.start, bounds.end)
        : 0;
      const unjustified = Math.max(0, lostMinutes - downtime);
      const downtimeCell = $('[data-field="ticketDowntime"]', row);
      if (downtimeCell) downtimeCell.textContent = `${formatNumber(downtime)} min`;
      const justifyCell = $('[data-field="justify"]', row);
      if (justifyCell) {
        justifyCell.textContent = `${formatNumber(unjustified)} min`;
        justifyCell.classList.toggle("has-unjustified", unjustified > 0);
      }
      return {
        row,
        actual,
        downtime,
        lostMinutes,
        unjustified
      };
    });
  }

  function updateHourlyMetrics() {
    const model = selectedHourlyModel();
    const rows = hourlyRowValues();
    const rate = Number(activeHourlyRate(model)) || 0;
    const actual = rows.reduce((total, row) => total + row.actual, 0);
    const target = rate * rows.length;
    const downtime = rows.reduce((total, row) => total + row.downtime, 0);
    const lost = rows.reduce((total, row) => total + row.lostMinutes, 0);
    const unjustified = rows.reduce((total, row) => total + row.unjustified, 0);
    $("#hourlyProductivity").textContent = target ? `${formatNumber(actual / target * 100)}%` : "—";
    $("#hourlyUnitsSummary").textContent = target
      ? `Tarjetas: ${formatNumber(actual)} / ${formatNumber(target)}`
      : "Tarjetas: — / —";
    $("#hourlyDowntime").textContent = model ? `${formatNumber(lost)} min` : "—";
    $("#hourlyDowntimeCoverage").textContent = model
      ? `${formatNumber(downtime)} min cubiertos por tickets o captura manual`
      : "Tiempo equivalente al faltante contra el rate";
    $("#hourlyUnjustified").textContent = model ? `${formatNumber(unjustified)} min` : "—";
    renderHourlyCharts(rows);
  }

  function currentHourlyReport() {
    const model = selectedHourlyModel();
    if (!model) return null;
    const rows = $$("#hourlyRows tr[data-index]");
    if (rows.length !== 8) return null;
    return {
      date: $("#hourlyDate").value,
      shift: $("#hourlyShift").value,
      area: $("#hourlyArea").value,
      line: $("#hourlyLine").value,
      model: model.name,
      rate: activeHourlyRate(model),
      hours: rows.map((row, index) => {
        const value = $('[data-field="actual"]', row).value.trim();
        return {
          start: (hourlyShiftStart($("#hourlyShift").value) + index) % 24,
          actual: value === "" ? null : Number(value)
        };
      }),
      updatedAt: new Date().toISOString()
    };
  }

  function saveHourlyDraft() {
    const report = currentHourlyReport();
    if (!report || !report.date || !report.shift || !report.area || !report.line) return;
    report.completed = report.hours.every((hour) => hour.actual !== null);
    const key = hourlyReportKey(report);
    const existingIndex = state.hourlyReports.findIndex((item) => hourlyReportKey(item) === key);
    if (existingIndex >= 0) {
      state.hourlyReports[existingIndex] = report;
    } else state.hourlyReports.push(report);
    saveState();
    renderWeeklyProductionChart();
    if ($("#view-records").classList.contains("active")) renderHourlyRecords();
  }

  function renderHourlyCharts(rows) {
    const productivityChart = $("#hourlyProductivityChart");
    const timeChart = $("#hourlyTimeChart");
    productivityChart.replaceChildren();
    timeChart.replaceChildren();
    if (!rows.length) return;
    const maxTime = Math.max(1, ...rows.flatMap((item) => [item.downtime, item.unjustified]));
    rows.forEach(({ row, actual, downtime, unjustified }, index) => {
      const rate = activeHourlyRate();
      const hourLabel = $("th", row)?.textContent.slice(0, 5) || String(index + 1);
      const productivity = rate ? actual / rate * 100 : 0;
      const column = document.createElement("div");
      column.className = "hourly-bar-column";
      const value = document.createElement("small");
      value.textContent = `${formatNumber(productivity)}%`;
      const track = document.createElement("div");
      track.className = "hourly-bar-track";
      const bar = document.createElement("span");
      bar.className = "hourly-bar productivity";
      bar.style.height = `${Math.min(100, productivity / 120 * 100)}%`;
      track.append(bar);
      const label = document.createElement("small");
      label.textContent = hourLabel;
      column.append(value, track, label);
      productivityChart.append(column);

      const timeColumn = document.createElement("div");
      timeColumn.className = "hourly-bar-column time-column";
      const timeValue = document.createElement("small");
      timeValue.textContent = `${formatNumber(downtime)} / ${formatNumber(unjustified)}m`;
      const timeTrack = document.createElement("div");
      timeTrack.className = "hourly-bar-track";
      const lossBar = document.createElement("span");
      lossBar.className = "hourly-bar downtime";
      lossBar.style.height = `${downtime / maxTime * 100}%`;
      const unjustifiedBar = document.createElement("span");
      unjustifiedBar.className = "hourly-bar unjustified";
      unjustifiedBar.style.height = `${unjustified / maxTime * 100}%`;
      timeTrack.append(lossBar, unjustifiedBar);
      const timeLabel = document.createElement("small");
      timeLabel.textContent = hourLabel;
      timeColumn.append(timeValue, timeTrack, timeLabel);
      timeChart.append(timeColumn);
    });
  }

  function saveHourlyReport() {
    const controls = ["#hourlyDate", "#hourlyShift", "#hourlyArea", "#hourlyLine", "#hourlyModel"].map((selector) => $(selector));
    const model = selectedHourlyModel();
    if (controls.some((control) => !control.value) || !model || !$$('#hourlyRows tr[data-index]').length) {
      showToast("Selecciona fecha, turno, área, línea y modelo para registrar las horas.", true);
      return;
    }
    const invalidInput = $$("input", $("#hourlyRows")).find((input) => !input.checkValidity());
    if (invalidInput) {
      invalidInput.reportValidity();
      return;
    }
    const rows = hourlyRowValues();
    if (rows.some((item) => !$('[data-field="actual"]', item.row).value.trim())) {
      showToast("Captura las tarjetas reales de las 8 horas antes de guardar.", true);
      return;
    }
    const report = currentHourlyReport();
    report.hours.forEach((hour, index) => {
      hour.actual = Number($('[data-field="actual"]', rows[index].row).value);
    });
    report.completed = true;
    const key = hourlyReportKey(report);
    const existingIndex = state.hourlyReports.findIndex((item) => hourlyReportKey(item) === key);
    if (existingIndex >= 0) state.hourlyReports[existingIndex] = report;
    else state.hourlyReports.push(report);
    saveState();
    updateHourlyMetrics();
    renderHourlyRecords();
    renderDashboard();
    showToast("Turno hora por hora guardado correctamente.");
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

  /* Dashboard */
  function bindDashboard() {
    ["#filterFrom", "#filterTo", "#filterShift", "#filterLine", "#filterArea"]
      .forEach((selector) => $(selector).addEventListener("change", () => {
        paretoPath = [];
        renderDashboard();
      }));
    ["#q3Group", "#q4StatusFilter"]
      .forEach((selector) => $(selector).addEventListener("change", renderDashboard));
    $("#paretoModeToggle").addEventListener("click", () => {
      paretoMode = paretoMode === "area" ? "department" : "area";
      paretoPath = [];
      renderDashboard();
    });
    $("#resetFilters").addEventListener("click", () => {
      $("#filterFrom").value = "";
      $("#filterTo").value = "";
      $("#filterShift").value = "";
      $("#filterLine").value = "";
      $("#filterArea").value = "";
      paretoPath = [];
      renderDashboard();
    });
    $("#exportDashboardCsv").addEventListener("click", () => exportCsv(getDashboardRecords(), "tiempos_muertos_filtrados"));
  }

  function bindAnalytics() {
    ["#analyticsFrom", "#analyticsTo", "#analyticsShift", "#analyticsLine", "#analyticsArea"]
      .forEach((selector) => $(selector).addEventListener("change", renderAnalyticsDashboard));
    $("#resetAnalyticsFilters").addEventListener("click", () => {
      $("#analyticsFrom").value = "";
      $("#analyticsTo").value = "";
      $("#analyticsShift").value = "";
      $("#analyticsLine").value = "";
      $("#analyticsArea").value = "";
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
    const lines = unique([
      ...state.catalogs.locations.map((item) => item.line),
      ...state.records.map((item) => item.line),
      ...state.hourlyReports.map((item) => item.line)
    ]);
    const areas = unique([
      ...window.FLEX_DT_DEFAULTS.catalogs.areas,
      ...state.catalogs.locations.map((item) => item.area),
      ...state.records.map((item) => item.area),
      ...state.hourlyReports.map((item) => item.area)
    ]);
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
    $("#kpiCost").textContent = formatUSD(minutes * COST_PER_DOWNTIME_MINUTE_USD);
    $("#kpiTopArea").textContent = topArea ? topArea.label : "—";
    $("#kpiTopAreaValue").textContent = topArea ? `${formatNumber(topArea.value)} min acumulados` : "Sin registros";

    renderWeeklyBars(records);
    renderWeeklyProductionChart();
    renderParetoChart(records, "minutes");
    renderWeeklyMatrix(records, $("#q3Group").value);
    renderActions(records);
    renderDashboardDetailTable(records);

    const scopeParts = [];
    if ($("#filterFrom").value || $("#filterTo").value) scopeParts.push(`${$("#filterFrom").value || "inicio"} a ${$("#filterTo").value || "hoy"}`);
    if ($("#filterShift").value) scopeParts.push(`turno ${$("#filterShift").value}`);
    if ($("#filterLine").value) scopeParts.push($("#filterLine").value);
    if ($("#filterArea").value) scopeParts.push($("#filterArea").value);
    $("#dashboardScope").textContent = `${formatNumber(records.length)} registros${scopeParts.length ? ` · ${scopeParts.join(" · ")}` : " · alcance completo"}`;
  }

  function renderDashboardDetailTable(records) {
    const body = $("#dashboardDetailRows");
    body.replaceChildren();
    const sorted = [...records].sort((a, b) =>
      (b.date || "").localeCompare(a.date || "") ||
      (b.createdAt || "").localeCompare(a.createdAt || "")
    );
    sorted.forEach((record) => {
      const actionDetails = record.actionDetails || {};
      const containment = actionDetails.containment || {};
      const corrective = actionDetails.corrective || {};
      const systematic = actionDetails.systematic || {};
      const minutes = record.isStopTicket && !record.closedAt
        ? elapsedStopTicketMinutes(record)
        : Number(record.minutes || 0);
      const startedAt = Date.parse(record.startedAt);
      const eventTime = Number.isFinite(startedAt)
        ? new Intl.DateTimeFormat("es-MX", { hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(startedAt))
        : "—";
      const actionStatus = (key) => {
        if (!record[key]) return "—";
        return record.actionStatus?.[key] === "completed" ? "Completada" : "Pendiente";
      };
      const row = document.createElement("tr");
      row.append(
        tableCell(record.isManualDowntime ? "Manual" : record.isStopTicket ? "Ticket" : "Registro"),
        tableCell(formatDate(record.date)),
        tableCell(eventTime),
        tableCell(`T${record.shift || "—"}`, "shift"),
        tableCell(record.line || "Sin línea"),
        tableCell(record.area || "Sin área"),
        tableCell(record.machine || "Sin equipo"),
        tableCell(record.problem || "Sin problema"),
        tableCell(record.rootCause || "Sin causa raíz"),
        tableCell(record.department || "—"),
        tableCell(formatNumber(minutes), "number"),
        tableCell(formatNumber(record.reworkUnits), "number"),
        tableCell(formatNumber(record.scrapUnits), "number"),
        tableCell(formatNumber(record.units), "number"),
        tableCell(record.immediateAction || "—"),
        tableCell(record.containment || "—"),
        tableCell(containment.dueDate ? formatDate(containment.dueDate) : "—"),
        tableCell(containment.owner || "—"),
        tableCell(actionStatus("containment")),
        tableCell(record.corrective || "—"),
        tableCell(corrective.dueDate ? formatDate(corrective.dueDate) : "—"),
        tableCell(corrective.owner || "—"),
        tableCell(actionStatus("corrective")),
        tableCell(record.systematic || "—"),
        tableCell(systematic.dueDate ? formatDate(systematic.dueDate) : "—"),
        tableCell(systematic.owner || "—"),
        tableCell(actionStatus("systematic")),
        tableCell(record.support || "—"),
        tableCell(record.openedBy?.name || "—"),
        tableCell(record.closedBy?.name || "—")
      );
      body.append(row);
    });
    $("#dashboardDetailCount").textContent = `${formatNumber(records.length)} ${records.length === 1 ? "evento" : "eventos"} en el alcance seleccionado`;
    $("#dashboardDetailEmpty").classList.toggle("hidden", records.length > 0);
    $(".dashboard-detail-panel .table-scroll").classList.toggle("hidden", records.length === 0);
  }

  function renderAnalyticsDashboard() {
    const records = getAnalyticsRecords();
    const minutes = sum(records, "minutes");
    const events = records.length;
    const topProblem = aggregate(records, "problem", "minutes")[0];
    $("#analyticsMinutes").textContent = `${formatNumber(minutes)} min`;
    $("#analyticsEvents").textContent = formatNumber(events);
    $("#analyticsUnits").textContent = formatNumber(sum(records, "units"));
    $("#analyticsCost").textContent = formatUSD(minutes * COST_PER_DOWNTIME_MINUTE_USD);
    $("#analyticsTopProblem").textContent = topProblem
      ? topProblem.label.replace(/\s+con problema de macro$/i, "")
      : "—";
    $("#analyticsTopProblemValue").textContent = topProblem ? `${formatNumber(topProblem.value)} min acumulados` : "Sin registros";

    const metric = "minutes";
    renderAnalyticsCategoryChart("#analyticsProblemChart", records, "problem", metric, "#009add");
    renderAnalyticsCategoryChart("#analyticsRootCauseChart", records, "rootCause", metric, "#009add");
    renderAnalyticsCategoryChart("#analyticsMachineChart", records, "machine", metric, "#009add");
    renderAnalyticsCategoryChart("#analyticsLineChart", records, "line", metric, "#009add");
    renderShiftTrendChart(records, metric, "#analyticsShiftChart", "#analyticsShiftCaption");

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
    const goal = dashboardDowntimeGoal();
    const visible = getDashboardWeeks(records).map((week) => ({
      ...week,
      value: totals.get(week.start) || 0,
      goal
    }));
    const hasGoals = visible.some((week) => Number.isFinite(week.goal));
    $("#q1GoalLegend").classList.toggle("hidden", !hasGoals);
    if (!totals.size && !hasGoals) {
      container.append(emptyChart("La tendencia semanal aparecerá cuando existan registros."));
      $("#q1Caption").textContent = "Sin datos";
      return;
    }
    const max = Math.max(1, ...visible.flatMap((week) => [week.value, Number.isFinite(week.goal) ? week.goal : 0]));
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
    if (hasGoals) renderWeeklyGoalOverlay(chart, visible, max);
    $("#q1Caption").textContent = `${visible[0].label}–${visible.at(-1).label} · minutos`;
  }

  function dashboardDowntimeGoal() {
    const goals = state.catalogs.goals || [];
    const area = $("#filterArea").value;
    const line = $("#filterLine").value;
    const scopedToLine = goals.filter((goal) =>
      line && normalize(goal.line || "") === normalize(line) &&
      (!area || normalize(goal.area || "") === normalize(area))
    );
    if (scopedToLine.length) return scopedToLine.reduce((total, goal) => total + Number(goal.minutes || 0), 0);

    const areaGoal = goals.find((goal) =>
      !goal.line && area && normalize(goal.area || "") === normalize(area)
    );
    if (areaGoal) return Number(areaGoal.minutes || 0);

    if (area) {
      const lineGoals = goals.filter((goal) =>
        goal.line && normalize(goal.area || "") === normalize(area)
      );
      if (lineGoals.length) return lineGoals.reduce((total, goal) => total + Number(goal.minutes || 0), 0);
    }

    const globalGoals = goals.filter((goal) => !goal.area && !goal.line);
    if (globalGoals.length) return globalGoals.reduce((total, goal) => total + Number(goal.minutes || 0), 0);

    if (!area && !line) {
      const lineGoals = goals.filter((goal) => goal.line);
      if (lineGoals.length) return lineGoals.reduce((total, goal) => total + Number(goal.minutes || 0), 0);
      return goals.reduce((total, goal) => total + Number(goal.minutes || 0), 0);
    }
    return null;
  }

  function renderWeeklyProductionChart() {
    const container = $("#productionWeekChart");
    if (!container) return;
    container.replaceChildren();
    const from = $("#filterFrom").value;
    const to = $("#filterTo").value;
    const shift = $("#filterShift").value;
    const line = $("#filterLine").value;
    const area = $("#filterArea").value;
    const reports = state.hourlyReports.filter((report) =>
      (!from || report.date >= from) &&
      (!to || report.date <= to) &&
      (!shift || String(report.shift) === shift) &&
      (!line || report.line === line) &&
      (!area || report.area === area)
    );
    const weeks = new Map();
    reports.forEach((report) => {
      const cards = (report.hours || []).reduce((total, hour) => {
        if (hour.actual === null || hour.actual === undefined || hour.actual === "") return total;
        const actual = Number(hour.actual);
        return total + (Number.isFinite(actual) ? actual : 0);
      }, 0);
      if (!cards) return;
      const weekStart = startOfWeek(report.date);
      const totals = weeks.get(weekStart) || [0, 0, 0];
      const shiftIndex = Number(report.shift) - 1;
      if (shiftIndex >= 0 && shiftIndex < totals.length) totals[shiftIndex] += cards;
      weeks.set(weekStart, totals);
    });
    const visibleWeeks = [...weeks.entries()].sort(([a], [b]) => a.localeCompare(b)).slice(-12);
    const totalCards = visibleWeeks.reduce((total, [, values]) => total + values.reduce((sumCards, cards) => sumCards + cards, 0), 0);
    $("#productionWeekCaption").textContent = `${formatNumber(totalCards)} tarjetas · ${visibleWeeks.length} semanas`;
    if (!visibleWeeks.length) {
      container.append(emptyChart("Las tarjetas por semana aparecerán al capturar y guardar producción por hora."));
      return;
    }
    const maxValue = Math.max(1, ...visibleWeeks.map(([, values]) => values.reduce((total, cards) => total + cards, 0)));
    visibleWeeks.forEach(([weekStart, values]) => {
      const column = document.createElement("div");
      column.className = "production-week-column";
      const total = values.reduce((sumCards, cards) => sumCards + cards, 0);
      const amount = document.createElement("strong");
      amount.textContent = formatNumber(total);
      const stack = document.createElement("div");
      stack.className = "production-week-stack";
      stack.title = `${isoWeekKey(weekStart)}: ${formatNumber(total)} tarjetas`;
      stack.setAttribute("aria-label", `${isoWeekKey(weekStart)}: ${formatNumber(total)} tarjetas`);
      values.forEach((cards, index) => {
        const segment = document.createElement("span");
        segment.className = `shift-color-${index + 1}`;
        segment.style.height = `${cards ? Math.max(2, cards / maxValue * 100) : 0}%`;
        segment.title = `Turno ${index + 1}: ${formatNumber(cards)} tarjetas`;
        stack.append(segment);
      });
      const label = document.createElement("span");
      label.textContent = isoWeekKey(weekStart);
      label.title = `Semana del ${formatDate(weekStart)}`;
      column.append(amount, stack, label);
      container.append(column);
    });
  }

  function renderWeeklyGoalOverlay(chart, weeks, maximum) {
    const chartRect = chart.getBoundingClientRect();
    const tracks = $$(".vertical-bar-track", chart);
    if (!chartRect.width || !chartRect.height || tracks.length !== weeks.length) return;

    const svgNamespace = "http://www.w3.org/2000/svg";
    const overlay = document.createElementNS(svgNamespace, "svg");
    overlay.classList.add("weekly-goal-overlay");
    overlay.setAttribute("viewBox", `0 0 ${chartRect.width} ${chartRect.height}`);
    overlay.setAttribute("preserveAspectRatio", "none");
    overlay.setAttribute("aria-hidden", "true");

    const points = weeks.map((week, index) => {
      if (!Number.isFinite(week.goal)) return null;
      const trackRect = tracks[index].getBoundingClientRect();
      return {
        x: trackRect.left - chartRect.left + trackRect.width / 2,
        y: trackRect.bottom - chartRect.top - week.goal / maximum * trackRect.height
      };
    });

    let segment = [];
    const drawSegment = () => {
      if (segment.length > 1) {
        const line = document.createElementNS(svgNamespace, "polyline");
        line.classList.add("weekly-goal-line");
        line.setAttribute("points", segment.map((point) => `${point.x},${point.y}`).join(" "));
        overlay.append(line);
      }
      segment.forEach((point) => {
        const marker = document.createElementNS(svgNamespace, "circle");
        marker.classList.add("weekly-goal-point");
        marker.setAttribute("cx", point.x);
        marker.setAttribute("cy", point.y);
        marker.setAttribute("r", "3.5");
        overlay.append(marker);
      });
      segment = [];
    };

    points.forEach((point) => {
      if (!point) {
        drawSegment();
        return;
      }
      segment.push(point);
    });
    drawSegment();
    chart.append(overlay);
  }

  function renderShiftTrendChart(records, metric, chartSelector, captionSelector) {
    const container = $(chartSelector);
    container.replaceChildren();
    const totals = new Map();
    records.forEach((record) => {
      if (!record.date) return;
      const shift = Number(record.shift);
      if (shift < 1 || shift > 3) return;
      const day = totals.get(record.date) || [0, 0, 0];
      day[shift - 1] += metric === "events" ? 1 : Number(record[metric] || 0);
      totals.set(record.date, day);
    });
    if (!totals.size) {
      container.append(emptyChart("La gráfica por turno aparecerá cuando existan registros con fecha."));
      return;
    }

    const days = [...totals.entries()].sort(([first], [second]) => first.localeCompare(second)).slice(-10);
    const maximum = Math.max(...days.flatMap(([, values]) => values), 1);
    days.forEach(([date, values]) => {
      const column = document.createElement("div");
      column.className = "shift-trend-column";
      const bars = document.createElement("div");
      bars.className = "shift-trend-bars";
      values.forEach((value, index) => {
        const item = document.createElement("div");
        item.className = "shift-trend-item";
        const amount = document.createElement("strong");
        amount.textContent = value ? formatNumber(value) : "";
        const barHeight = value ? Math.max(2, value / maximum * 86) : 0;
        item.style.setProperty("--bar-height", `${barHeight}%`);
        const track = document.createElement("div");
        track.className = "shift-trend-track";
        const bar = document.createElement("div");
        bar.className = `shift-trend-bar shift-color-${index + 1}`;
        bar.style.height = `${barHeight}%`;
        bar.title = `Turno ${index + 1}: ${metricValue(value, metric)}`;
        track.append(bar);
        item.append(amount, track);
        bars.append(item);
      });
      const label = document.createElement("span");
      label.textContent = formatDate(date);
      label.title = date;
      column.append(bars, label);
      container.append(column);
    });
    $(captionSelector).textContent = `${metric === "events" ? "Eventos" : metric === "units" ? "Unidades" : "Minutos"} por día`;
  }

  function renderParetoBreadcrumbs() {
    const container = $("#paretoBreadcrumbs");
    container.replaceChildren();
    const levels = PARETO_LEVELS[paretoMode];
    const rootLabel = paretoMode === "area" ? "Áreas" : "Departamentos";
    const steps = [{ label: rootLabel, pathLength: 0 }];
    paretoPath.forEach((value, index) => steps.push({ label: value, pathLength: index + 1 }));
    steps.forEach((step, index) => {
      if (index) {
        const separator = document.createElement("span");
        separator.className = "pareto-separator";
        separator.setAttribute("aria-hidden", "true");
        separator.textContent = "›";
        container.append(separator);
      }
      const button = document.createElement("button");
      button.type = "button";
      button.className = "pareto-step";
      button.textContent = step.label;
      if (index === steps.length - 1) {
        button.classList.add("current");
        button.setAttribute("aria-current", "step");
        button.disabled = true;
      } else {
        const levelIndex = step.pathLength;
        const level = levels[levelIndex];
        button.setAttribute("aria-label", `Volver a Pareto por ${level.label.toLowerCase()}`);
        button.addEventListener("click", () => {
          paretoPath = paretoPath.slice(0, step.pathLength);
          renderDashboard();
        });
      }
      container.append(button);
    });
  }

  function paretoRecordLabel(record, key) {
    return String(record[key] || "Sin clasificar").trim() || "Sin clasificar";
  }

  function renderParetoChart(records, metric) {
    const container = $("#problemPareto");
    container.replaceChildren();
    const levels = PARETO_LEVELS[paretoMode];
    const levelIndex = paretoPath.length;
    const level = levels[levelIndex];
    $("#q2Title").textContent = `Pareto por ${level.label.toLowerCase()}`;
    $("#paretoModeToggle").textContent = paretoMode === "area"
      ? "Visualizar Pareto por departamento"
      : "Visualizar Pareto por área";
    $("#paretoModeToggle").setAttribute("aria-label", $("#paretoModeToggle").textContent);
    renderParetoBreadcrumbs();
    const scopedRecords = records.filter((record) => paretoPath.every((value, index) =>
      paretoRecordLabel(record, levels[index].key) === value
    ));
    const all = aggregate(scopedRecords, level.key, metric);
    if (!all.length) {
      container.append(emptyChart(`No hay datos de ${level.label.toLowerCase()} para el Pareto.`));
      return;
    }
    const items = all;
    if (level.key === "rootCause") {
      items.sort((a, b) => {
        const aManual = normalize(a.label) === normalize("Ticket no levantado en tiempo y forma");
        const bManual = normalize(b.label) === normalize("Ticket no levantado en tiempo y forma");
        if (aManual !== bManual) return aManual ? 1 : -1;
        return b.value - a.value || a.label.localeCompare(b.label, "es");
      });
    }
    const total = all.reduce((sumValue, item) => sumValue + item.value, 0);
    const width = 640;
    const labelAngle = 45;
    const labelWidths = items.map((item) => item.label.length * 6);
    const labelSpace = Math.max(70, Math.ceil(Math.max(...labelWidths) * Math.sin(labelAngle * Math.PI / 180) + 20));
    const pad = { left: 42, right: 40, top: 16, bottom: labelSpace };
    const height = pad.top + 164 + pad.bottom;
    const graphWidth = width - pad.left - pad.right;
    const graphHeight = height - pad.top - pad.bottom;
    const max = Math.max(...items.map((item) => item.value), 1);
    const chartWidth = Math.max(width, pad.left + pad.right + labelWidths.reduce((totalWidth, labelWidth) => totalWidth + Math.max(64, labelWidth), 0));
    const chartGraphWidth = chartWidth - pad.left - pad.right;
    const slot = chartGraphWidth / items.length;
    const points = [];
    const svg = svgElement("svg", { viewBox: `0 0 ${chartWidth} ${height}`, role: "img", "aria-label": `Pareto por ${level.label}` });
    if (chartWidth > width) svg.style.minWidth = `${chartWidth}px`;
    [0, .5, 1].forEach((ratio) => {
      const y = pad.top + graphHeight * (1 - ratio);
      svg.append(svgElement("line", { x1: pad.left, x2: chartWidth - pad.right, y1: y, y2: y, class: "chart-grid-line" }));
      const countLabel = svgElement("text", { x: pad.left - 7, y: y + 4, "text-anchor": "end" });
      countLabel.textContent = formatNumber(max * ratio);
      svg.append(countLabel);
      const percentLabel = svgElement("text", { x: chartWidth - pad.right + 7, y: y + 4, "text-anchor": "start" });
      percentLabel.textContent = `${Math.round(ratio * 100)}%`;
      svg.append(percentLabel);
    });
    let cumulative = 0;
    items.forEach((item, index) => {
      const barWidth = Math.min(42, slot * .62);
      const x = pad.left + index * slot + (slot - barWidth) / 2;
      const barHeight = item.value / max * graphHeight;
      const drillable = levelIndex < levels.length - 1;
      const bar = svgElement("rect", {
        x,
        y: pad.top + graphHeight - barHeight,
        width: barWidth,
        height: barHeight,
        rx: 3,
        class: drillable ? "pareto-bar pareto-bar-drillable" : "pareto-bar"
      });
      if (drillable) {
        bar.setAttribute("role", "button");
        bar.setAttribute("tabindex", "0");
        bar.setAttribute("aria-label", `Desglosar ${item.label} por ${levels[levelIndex + 1].label.toLowerCase()}`);
        const drillDown = () => {
          paretoPath = [...paretoPath.slice(0, levelIndex), item.label];
          renderDashboard();
        };
        bar.addEventListener("click", drillDown);
        bar.addEventListener("keydown", (event) => {
          if (event.key !== "Enter" && event.key !== " ") return;
          event.preventDefault();
          drillDown();
        });
      }
      cumulative += total ? item.value / total * 100 : 0;
      const title = svgElement("title");
      title.textContent = `${item.label}: ${metricValue(item.value, metric)} · acumulado ${cumulative.toFixed(1)}%`;
      bar.append(title);
      svg.append(bar);
      points.push({ x: x + barWidth / 2, y: pad.top + graphHeight * (1 - cumulative / 100) });
      const categoryY = pad.top + graphHeight + 12;
      const category = svgElement("text", { x: x + barWidth / 2, y: categoryY, "text-anchor": "end", transform: `rotate(-${labelAngle} ${x + barWidth / 2} ${categoryY})` });
      category.textContent = item.label;
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

  function isoWeekKey(value) {
    const date = new Date(`${value}T00:00:00Z`);
    const day = date.getUTCDay() || 7;
    date.setUTCDate(date.getUTCDate() + 4 - day);
    return `${date.getUTCFullYear()}-W${String(isoWeekNumber(value)).padStart(2, "0")}`;
  }

  function renderActions(records) {
    const container = $("#priorityList");
    container.replaceChildren();
    const filter = $("#q4StatusFilter").value;
    const actionTypes = [
      { key: "containment", short: "C", label: "Contención" },
      { key: "corrective", short: "CA", label: "Corrección" },
      { key: "systematic", short: "P", label: "Prevención" }
    ];
    const actions = records.flatMap((record) => actionTypes
      .filter((action) => String(record[action.key] || "").trim())
      .map((action) => ({ record, action, status: record.actionStatus?.[action.key] === "completed" ? "completed" : "pending" })))
      .filter((item) => filter === "all" || item.status === filter)
      .sort((a, b) => Number(b.record.minutes) - Number(a.record.minutes));
    if (!actions.length) {
      container.append(emptyChart(filter === "completed" ? "No hay acciones completadas en este alcance." : "No hay acciones pendientes en este alcance."));
      return;
    }

    const tableScroll = document.createElement("div");
    tableScroll.className = "action-table-scroll";
    const table = document.createElement("table");
    table.className = "data-table action-table";
    table.setAttribute("aria-label", "Acciones priorizadas por tiempo afectado");
    const head = document.createElement("thead");
    const headerRow = document.createElement("tr");
    ["Tipo", "Acción", "Fecha compromiso", "Owner"].forEach((label) => {
      const cell = document.createElement("th");
      cell.textContent = label;
      headerRow.append(cell);
    });
    head.append(headerRow);
    const body = document.createElement("tbody");
    actions.forEach(({ record, action, status }, index) => {
      const row = document.createElement("tr");
      row.dataset.impactMinutes = Number(record.minutes) || 0;

      const typeCell = document.createElement("td");
      const typeContent = document.createElement("div");
      typeContent.className = "action-type-cell";
      const typeLabel = document.createElement("strong");
      typeLabel.className = "action-kind";
      typeLabel.textContent = action.label;
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
      typeContent.append(typeLabel, statusSelect);
      typeCell.append(typeContent);

      const actionCell = document.createElement("td");
      actionCell.className = "action-description-cell";
      const copy = document.createElement("div");
      copy.className = "action-copy";
      const text = document.createElement("strong");
      text.textContent = record[action.key];
      text.title = record[action.key];
      const detail = document.createElement("small");
      detail.textContent = `${record.area || "Sin área"} · ${record.line || "Sin línea"} · ${record.machine || "Sin clasificar"} · ${formatNumber(record.minutes)} min`;
      copy.append(text, detail);
      actionCell.append(copy);

      const details = record.actionDetails?.[action.key] || {};
      const dueDateCell = document.createElement("td");
      const dueDateInput = document.createElement("input");
      dueDateInput.type = "date";
      dueDateInput.className = "action-date";
      dueDateInput.value = details.dueDate || "";
      dueDateInput.setAttribute("aria-label", `Fecha compromiso de ${action.label}, acción ${index + 1}`);
      dueDateInput.addEventListener("change", () => saveActionDetail(record.id, action.key, "dueDate", dueDateInput.value));
      dueDateCell.append(dueDateInput);

      const ownerCell = document.createElement("td");
      const ownerSelect = document.createElement("select");
      ownerSelect.className = "action-owner";
      ownerSelect.setAttribute("aria-label", `Owner de ${action.label}, acción ${index + 1}`);
      populateSelect(ownerSelect, unique(state.catalogs.owners), "Sin asignar", details.owner || "");
      ownerSelect.addEventListener("change", () => saveActionDetail(record.id, action.key, "owner", ownerSelect.value));
      ownerCell.append(ownerSelect);

      row.append(typeCell, actionCell, dueDateCell, ownerCell);
      body.append(row);
    });
    table.append(head, body);
    tableScroll.append(table);
    container.append(tableScroll);
  }

  function saveActionDetail(recordId, actionKey, field, value) {
    const target = state.records.find((record) => record.id === recordId);
    if (!target) return;
    target.actionDetails = {
      ...(target.actionDetails || {}),
      [actionKey]: { ...(target.actionDetails?.[actionKey] || {}), [field]: value }
    };
    saveState();
  }

  /* Records */
  function createApplicationBackup() {
    const backup = {
      format: "flex-downtime-backup",
      version: 1,
      createdAt: new Date().toISOString(),
      state: {
        records: state.records,
        catalogs: state.catalogs,
        hourlyReports: state.hourlyReports
      }
    };
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const filename = `downtime-control-respaldo-${timestamp}.json`;
    downloadBlob(`${JSON.stringify(backup, null, 2)}\n`, filename, "application/json;charset=utf-8");
    showToast(`Respaldo creado: ${filename}. Muévelo a Documentos\\DowntimeControl\\Respaldos.`);
  }

  async function restoreApplicationBackup(event) {
    const input = event.currentTarget;
    const file = input.files?.[0];
    if (!file) return;
    try {
      const backup = JSON.parse(await file.text());
      if (backup?.format !== "flex-downtime-backup" || backup.version !== 1) {
        throw new Error("El archivo no es un respaldo compatible de Downtime Control.");
      }
      const restored = backup.state;
      if (!restored || !Array.isArray(restored.records) || !restored.catalogs || typeof restored.catalogs !== "object" ||
          !Array.isArray(restored.hourlyReports)) {
        throw new Error("El respaldo está incompleto o dañado; no se modificaron los datos actuales.");
      }
      const confirmed = await askConfirmation(
        "Restaurar respaldo",
        `Se reemplazarán los datos ${cloudMode || serverStorageMode ? "compartidos" : "de este navegador"} por el respaldo del ${new Intl.DateTimeFormat("es-MX", { dateStyle: "medium", timeStyle: "short" }).format(new Date(backup.createdAt))}. Los datos actuales se perderán si no tienes otra copia.`,
        "Restaurar respaldo"
      );
      if (!confirmed) return;
      state = {
        records: restored.records,
        catalogs: mergeDefaultLocations(restored.catalogs),
        hourlyReports: restored.hourlyReports
      };
      activeTicketId = null;
      ticketStep = 1;
      currentTicketUser = null;
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
      if (serverStorageMode && serverStorageReady) scheduleServerSync();
      scheduleCloudSync();
      renderState();
      renderHourlyRows();
      updateHourlyMetrics();
      if ($("#stopTicketDialog").open) $("#stopTicketDialog").close();
      showToast("Respaldo restaurado correctamente en este navegador.");
    } catch (error) {
      showToast(`No se pudo restaurar el respaldo: ${error.message}`, true);
    } finally {
      input.value = "";
    }
  }

  function bindRecords() {
    $("#recordSearch").addEventListener("input", renderRecords);
    $("#exportCsv").addEventListener("click", () => exportCsv(state.records, "tiempos_muertos_power_bi"));
    $("#exportExcelTemplate").addEventListener("click", exportExcelTemplate);
    $("#createBackup").addEventListener("click", createApplicationBackup);
    $("#restoreBackup").addEventListener("click", () => $("#restoreBackupInput").click());
    $("#restoreBackupInput").addEventListener("change", restoreApplicationBackup);
    $("#importExcel").addEventListener("click", () => $("#importExcelInput").click());
    $("#importExcelInput").addEventListener("change", importExcel);
    $("#deleteAll").addEventListener("click", async () => {
      if (!state.records.length) return;
      const confirmed = await askConfirmation(
        "Eliminar todos los registros",
        `Se eliminarán ${state.records.length} eventos del ${cloudMode ? "espacio compartido" : "este navegador"}. Esta acción no se puede deshacer.`,
        "Eliminar todo"
      );
      if (!confirmed) return;
      state.records = [];
      activeTicketId = null;
      saveState();
      if ($("#stopTicketDialog").open) $("#stopTicketDialog").close();
      renderActiveTickets();
      renderRecords();
      renderDashboard();
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
      const manualStartedAt = record.isManualDowntime ? Date.parse(record.startedAt || "") : NaN;
      const manualTime = Number.isFinite(manualStartedAt)
        ? new Intl.DateTimeFormat("es-MX", { hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(manualStartedAt))
        : "Hora no disponible";
      row.append(
        tableCell(formatDate(record.date)),
        tableCell(`T${record.shift || "—"}`, "shift"),
        tableCell(record.line || "Sin línea"),
        tableCell(record.area || "Sin área"),
        tableCell(record.machine || "Sin clasificar"),
        twoLineCell(record.problem || "Sin problema", record.isManualDowntime
          ? `CAPTURA MANUAL · ${manualTime} · Levantó: ${record.openedBy?.name || "Sin usuario"} · Cerró: ${record.closedBy?.name || "Sin soporte"}`
          : record.isStopTicket
          ? `${record.closedAt ? "Cerrado" : "EN CURSO"} · Retrabajo ${formatNumber(record.reworkUnits)} · Scrap ${formatNumber(record.scrapUnits)} · Levantó: ${record.openedBy?.name || "Sin usuario"} · Cerró: ${record.closedBy?.name || "Pendiente"}`
          : record.rootCause || "Sin causa"),
        tableCell(formatNumber(record.isStopTicket && !record.closedAt ? elapsedStopTicketMinutes(record) : record.minutes), "number"),
        tableCell(formatNumber(record.units), "number"),
        tableCell(record.support || "—")
      );

      const actionsCell = document.createElement("td");
      const actions = document.createElement("div");
      actions.className = "row-actions";
      const inspect = document.createElement("button");
      inspect.className = "table-action";
      inspect.type = "button";
      inspect.textContent = record.isStopTicket && !record.closedAt ? "Abrir" : "Ver";
      inspect.addEventListener("click", () => editRecord(record.id));
      const remove = document.createElement("button");
      remove.className = "table-action delete";
      remove.type = "button";
      remove.textContent = "Borrar";
      remove.addEventListener("click", () => deleteRecord(record.id));
      actions.append(inspect, remove);
      actionsCell.append(actions);
      row.append(actionsCell);
      body.append(row);
    });

    $("#recordsEmpty").classList.toggle("hidden", records.length > 0);
    $(".table-scroll").classList.toggle("hidden", records.length === 0);
    $("#recordCount").textContent = `${formatNumber(records.length)} ${records.length === 1 ? "registro" : "registros"}`;
    $("#recordSummary").textContent = `${formatNumber(sum(records, "minutes"))} min · ${formatNumber(sum(records, "units"))} unidades afectadas`;
    renderHourlyRecords();
    renderTodaySummary();
  }

  function renderHourlyRecords() {
    const body = $("#hourlyRecordsBody");
    if (!body) return;
    const query = normalize($("#recordSearch").value || "");
    const reports = [...state.hourlyReports]
      .filter((report) => !query || normalize([
        report.date, report.shift, report.area, report.line, report.model
      ].join(" ")).includes(query))
      .sort((a, b) => b.date.localeCompare(a.date) || String(b.shift).localeCompare(String(a.shift)));
    body.replaceChildren();
    let totalCards = 0;
    reports.forEach((report) => {
      const cards = (report.hours || []).reduce((total, hour) =>
        total + (Number.isFinite(Number(hour.actual)) ? Number(hour.actual) : 0), 0);
      const target = Number(report.rate || 0) * 8;
      totalCards += cards;
      const row = document.createElement("tr");
      row.append(
        tableCell(formatDate(report.date)),
        tableCell(`T${report.shift || "—"}`, "shift"),
        tableCell(report.area || "Sin área"),
        tableCell(report.line || "Sin línea"),
        tableCell(report.model || "Sin modelo"),
        tableCell(formatNumber(state.records
          .filter((record) => record.isManualDowntime &&
            record.date === report.date &&
            String(record.shift) === String(report.shift) &&
            record.area === report.area &&
            record.line === report.line)
          .reduce((total, record) => total + Number(record.minutes || 0), 0)), "number"),
        tableCell(formatNumber(cards), "number"),
        tableCell(formatNumber(target), "number"),
        tableCell(target ? `${formatNumber(cards / target * 100)}%` : "—", "number"),
        tableCell(report.completed ? "Completo" : "Borrador")
      );
      body.append(row);
    });
    $("#hourlyRecordsScroll").classList.toggle("hidden", reports.length === 0);
    $("#hourlyRecordsEmpty").classList.toggle("hidden", reports.length > 0);
    $("#hourlyRecordCount").textContent = `${formatNumber(reports.length)} ${reports.length === 1 ? "turno" : "turnos"} hora por hora`;
    $("#hourlyRecordSummary").textContent = `${formatNumber(totalCards)} tarjetas corridas guardadas`;
  }

  function renderTodaySummary() {
    const todayRecords = state.records.filter((record) => record.date === localDateISO());
    const todayMinutes = todayRecords.reduce((total, record) =>
      total + (record.isStopTicket && !record.closedAt
        ? elapsedStopTicketMinutes(record)
        : Number(record.minutes || 0)), 0);
    $("#todayEvents").textContent = formatNumber(todayRecords.length);
    $("#todayMinutes").textContent = `${formatNumber(todayMinutes)} min`;
    $("#todayUnits").textContent = formatNumber(sum(todayRecords, "units"));
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
    if (record.isManualDowntime) {
      const hour = new Intl.DateTimeFormat("es-MX", { hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(record.startedAt));
      showToast(`Captura manual: ${formatNumber(record.minutes)} min asignados a la hora ${hour}.`);
      return;
    }
    if (record.isStopTicket) {
    if (!record.closedAt) {
      resumeStopTicket(record);
    } else {
      showToast(`Ticket cerrado: ${record.problem} · ${formatNumber(record.minutes)} min · Retrabajo ${formatNumber(record.reworkUnits)} · Scrap ${formatNumber(record.scrapUnits)}.`);
    }
    return;
    }
    showToast("Los registros manuales históricos se pueden consultar, pero la captura manual ya no está disponible.", true);
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

    $("#catalogModelArea").addEventListener("change", populateModelCatalogLines);
    $("#goalArea").addEventListener("change", populateGoalLines);
    $("#modelForm").addEventListener("submit", (event) => {
      event.preventDefault();
      const item = {
        area: $("#catalogModelArea").value,
        line: $("#catalogModelLine").value,
        name: $("#catalogModelName").value.trim(),
        rate: Number($("#catalogModelRate").value)
      };
      if (state.catalogs.models.some((model) =>
        model.area === item.area && model.line === item.line && normalize(model.name) === normalize(item.name)
      )) {
        showToast("Ese modelo ya está registrado para esa línea.", true);
        return;
      }
      state.catalogs.models.push(item);
      saveCatalogChange(event.currentTarget, "Modelo y rate agregados al catálogo.");
    });

    $("#departmentForm").addEventListener("submit", (event) => addSimpleCatalog(event, "departments", $("#catalogDepartment")));
    $("#ticketUserForm").addEventListener("submit", addTicketUser);
    $("#ticketUserList").addEventListener("click", (event) => {
      const button = event.target.closest("[data-edit-ticket-user]");
      if (button) openEditTicketUser(Number(button.dataset.editTicketUser));
    });
    $("#ownerForm").addEventListener("submit", (event) => addSimpleCatalog(event, "owners", $("#catalogOwner")));

    $("#goalForm").addEventListener("submit", (event) => {
      event.preventDefault();
      const goal = {
        area: $("#goalArea").value.trim(),
        line: $("#goalLine").value === "__all_lines" ? "" : $("#goalLine").value.trim(),
        minutes: Number($("#goalMinutes").value)
      };
      const existingIndex = state.catalogs.goals.findIndex((current) =>
        normalize(current.area || "") === normalize(goal.area) &&
        normalize(current.line || "") === normalize(goal.line)
      );
      if (existingIndex >= 0) state.catalogs.goals[existingIndex] = goal;
      else state.catalogs.goals.push(goal);
      saveCatalogChange(event.currentTarget, "Objetivo por área y línea guardado.");
    });

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
        "Se reemplazarán ubicaciones, objetivos por área y línea, departamentos y fallas. Los usuarios registrados y los registros capturados no se eliminarán.",
        "Restaurar"
      );
      if (!confirmed) return;
      const hourlyReports = state.hourlyReports;
      const ticketUsers = state.catalogs.ticketUsers;
      state.catalogs = clone(window.FLEX_DT_DEFAULTS.catalogs);
      state.catalogs.ticketUsers = ticketUsers;
      state.catalogs.support = [];
      state.catalogs.supportUsersMigrated = true;
      state.hourlyReports = hourlyReports;
      saveState();
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

  async function addTicketUser(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const username = $("#ticketUsername").value.trim();
    const password = $("#ticketUserPassword").value;
    const role = $("#ticketUserRole").value;
    if (!form.checkValidity()) {
      form.reportValidity();
      return;
    }
    if (state.catalogs.ticketUsers.some((user) => normalize(user.username) === normalize(username))) {
      showToast("Ese nombre de usuario ya está registrado.", true);
      return;
    }
    if (!window.crypto?.getRandomValues || !window.crypto?.subtle) {
      showToast("Este navegador no permite crear credenciales protegidas.", true);
      return;
    }
    try {
      const saltBytes = window.crypto.getRandomValues(new Uint8Array(16));
      const passwordSalt = Array.from(saltBytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
      const passwordHash = await hashTicketPassword(password, passwordSalt);
      state.catalogs.ticketUsers.push({
        name: $("#ticketUserName").value.trim(),
        username,
        role,
        passwordSalt,
        passwordHash,
        createdAt: new Date().toISOString()
      });
      saveCatalogChange(form, "Usuario de tickets agregado. La contraseña no se almacena en texto legible.");
    } catch (error) {
      showToast(`No se pudo proteger la contraseña: ${error.message}`, true);
    }
  }

  function saveCatalogChange(formElement, message) {
    saveState();
    const selectedLocationArea = formElement.id === "locationForm" ? $("#catalogArea").value : "";
    formElement.reset();
    if (selectedLocationArea) $("#catalogArea").value = selectedLocationArea;
    populateDashboardFilters();
    renderCatalogs();
    renderDashboard();
    showToast(message);
  }

  function renderCatalogs() {
    const areas = unique([
      ...window.FLEX_DT_DEFAULTS.catalogs.areas,
      ...state.catalogs.locations.map((item) => item.area)
    ]);
    populateSelect($("#catalogArea"), areas, "Seleccionar área", $("#catalogArea").value);
    populateSelect($("#goalArea"), areas, "Seleccionar área", $("#goalArea").value);
    populateGoalLines();
    populateSelect($("#catalogModelArea"), areas, "Seleccionar", $("#catalogModelArea").value);
    populateModelCatalogLines();
    renderModels();
    renderLocations();
    renderGoals();
    renderSimpleCatalog("departments", $("#departmentList"), $("#departmentCount"));
    renderTicketUsers();
    renderSimpleCatalog("owners", $("#ownerList"), $("#ownerCount"));
    populateActionOwnerSelects();
    renderFailures();
    renderMachineSuggestions();
    refreshHourlyCaptureOptions();
  }

  function populateGoalLines() {
    const area = $("#goalArea").value;
    const lines = unique(state.catalogs.locations
      .filter((item) => normalize(item.area) === normalize(area))
      .map((item) => item.line));
    const options = area
      ? [{ value: "__all_lines", label: "Todas las líneas del área" }, ...lines]
      : [];
    populateSelect($("#goalLine"), options, area ? "Seleccionar línea" : "Selecciona un área", $("#goalLine").value);
    $("#goalLine").disabled = !area;
  }

  function populateModelCatalogLines() {
    const area = $("#catalogModelArea").value;
    const lines = unique(state.catalogs.locations.filter((item) => item.area === area).map((item) => item.line));
    populateSelect($("#catalogModelLine"), lines, area ? "Seleccionar" : "Selecciona un área", $("#catalogModelLine").value);
    $("#catalogModelLine").disabled = !area || !lines.length;
  }

  function renderModels() {
    const list = $("#modelList");
    list.replaceChildren();
    state.catalogs.models
      .map((model, index) => ({ model, index }))
      .sort((a, b) => `${a.model.area}|${a.model.line}|${a.model.name}`.localeCompare(`${b.model.area}|${b.model.line}|${b.model.name}`, "es"))
      .forEach(({ model, index }) => {
        const row = document.createElement("div");
        row.className = "catalog-row";
        const copy = document.createElement("div");
        const title = document.createElement("strong");
        title.textContent = `${model.area} · ${model.line} · ${model.name}`;
        const detail = document.createElement("small");
        detail.textContent = `${formatNumber(model.rate)} tarjetas / hora`;
        copy.append(title, detail);
        row.append(copy, removeButton(() => removeCatalogItem("models", index, "modelo")));
        list.append(row);
      });
    $("#modelCount").textContent = state.catalogs.models.length;
  }

  function goalScopeLabel(areaValue) {
    const normalized = normalize(areaValue || "");
    if (!areaValue || normalized === "all" || normalized === "general" || normalized === "todas" || normalized === "todas las areas") {
      return "Todas las áreas";
    }
    return String(areaValue).trim();
  }

  function renderGoals() {
    const list = $("#goalList");
    list.replaceChildren();
    state.catalogs.goals
      .map((goal, index) => ({ goal, index }))
      .sort((a, b) => `${a.goal.area}|${a.goal.line}`.localeCompare(`${b.goal.area}|${b.goal.line}`, "es"))
      .forEach(({ goal, index }) => {
        const row = document.createElement("div");
        row.className = "catalog-row";
        const copy = document.createElement("div");
        const title = document.createElement("strong");
        title.textContent = `${goalScopeLabel(goal.area)} · ${goal.line || "Todas las líneas"}`;
        const detail = document.createElement("small");
        detail.textContent = `${formatNumber(goal.minutes)} min`;
        copy.append(title, detail);
        row.append(copy, removeButton(() => removeCatalogItem("goals", index, "objetivo")));
        list.append(row);
      });
    $("#goalCount").textContent = state.catalogs.goals.length;
  }

  function renderLocations() {
    const list = $("#locationList");
    list.replaceChildren();
    const items = state.catalogs.locations
      .map((item, index) => ({ ...item, index }))
      .sort((a, b) => `${a.area}|${a.line}|${a.machine}`.localeCompare(`${b.area}|${b.line}|${b.machine}`, "es"));
    items.forEach((item) => {
      const row = document.createElement("div");
      row.className = "catalog-row";
      const copy = document.createElement("div");
      const title = document.createElement("strong");
      title.textContent = `${item.area} · ${item.line}`;
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

  function renderTicketUsers() {
    const container = $("#ticketUserList");
    container.replaceChildren();
    state.catalogs.ticketUsers
      .map((user, index) => ({ user, index }))
      .sort((a, b) => a.user.name.localeCompare(b.user.name, "es"))
      .forEach(({ user, index }) => {
        const row = document.createElement("div");
        row.className = "catalog-row";
        const copy = document.createElement("div");
        const title = document.createElement("strong");
        title.textContent = `${user.name} · @${user.username}`;
        const detail = document.createElement("small");
        detail.textContent = user.role === "support" ? "Soporte · puede abrir y cerrar tickets" : "Operador · puede abrir tickets";
        copy.append(title, detail);
        const actions = document.createElement("div");
        actions.className = "row-actions";
        const edit = document.createElement("button");
        edit.type = "button";
        edit.className = "table-action";
        edit.dataset.editTicketUser = String(index);
        edit.textContent = "Editar";
        edit.setAttribute("aria-label", `Editar usuario ${user.name}`);
        actions.append(edit, removeButton(() => removeTicketUser(index)));
        row.append(copy, actions);
        container.append(row);
      });
    $("#ticketUserCount").textContent = state.catalogs.ticketUsers.length;
  }

  function openEditTicketUser(index) {
    const user = state.catalogs.ticketUsers[index];
    if (!user) {
      showToast("No se encontró el usuario que intentas editar.", true);
      return;
    }
    editingTicketUserIndex = index;
    $("#editTicketUserName").value = user.name;
    $("#editTicketUsername").value = user.username;
    $("#editTicketUserRole").value = user.role;
    $("#editTicketUserMessage").textContent = "";
    $("#editTicketUserDialog").showModal();
    $("#editTicketUserName").focus();
  }

  function saveEditedTicketUser(event) {
    event.preventDefault();
    const user = state.catalogs.ticketUsers[editingTicketUserIndex];
    const form = event.currentTarget;
    if (!user) {
      showToast("No se encontró el usuario que intentas actualizar.", true);
      $("#editTicketUserDialog").close();
      return;
    }
    if (!form.checkValidity()) {
      form.reportValidity();
      return;
    }
    const name = $("#editTicketUserName").value.trim();
    const username = $("#editTicketUsername").value.trim();
    const role = $("#editTicketUserRole").value;
    if (state.catalogs.ticketUsers.some((candidate, index) =>
      index !== editingTicketUserIndex && normalize(candidate.username) === normalize(username)
    )) {
      $("#editTicketUserMessage").textContent = "Ese nombre de usuario ya está asignado a otra cuenta.";
      return;
    }
    const changedIdentity = user.name !== name || user.username !== username || user.role !== role;
    const previousUsername = user.username;
    user.name = name;
    user.username = username;
    user.role = role;
    user.updatedAt = new Date().toISOString();
    if (changedIdentity && currentTicketUser?.username === previousUsername) currentTicketUser = null;
    saveState();
    renderTicketUsers();
    $("#editTicketUserDialog").close();
    editingTicketUserIndex = null;
    showToast("Usuario actualizado. La contraseña existente se conservó.");
  }

  async function removeTicketUser(index) {
    const user = state.catalogs.ticketUsers[index];
    if (!user) return;
    const confirmed = await askConfirmation(
      "Eliminar usuario de tickets",
      `Se eliminará el acceso de ${user.name}. Los tickets históricos conservarán su nombre.`,
      "Eliminar usuario"
    );
    if (!confirmed) return;
    state.catalogs.ticketUsers.splice(index, 1);
    if (currentTicketUser?.username === user.username) currentTicketUser = null;
    saveState();
    renderTicketUsers();
    showToast("Usuario eliminado del acceso a tickets.");
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
      key === "goals"
        ? "El objetivo dejará de aparecer en la gráfica de tendencia."
        : "La opción dejará de aparecer en nuevas capturas. Los registros históricos no cambiarán.",
      "Eliminar"
    );
    if (!confirmed) return;
    state.catalogs[key].splice(index, 1);
    saveState();
    renderCatalogs();
    populateDashboardFilters();
    renderDashboard();
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

  function formatUSD(value) {
    const amount = Number(value) || 0;
    const magnitude = Math.abs(amount);
    const scale = magnitude >= 1000000000
      ? { divisor: 1000000000, suffix: "B" }
      : magnitude >= 1000000
        ? { divisor: 1000000, suffix: "M" }
        : magnitude >= 1000
          ? { divisor: 1000, suffix: "K" }
          : null;
    if (scale) {
      const compactAmount = new Intl.NumberFormat("en-US", {
        minimumFractionDigits: 1,
        maximumFractionDigits: 1
      }).format(amount / scale.divisor);
      return `$${compactAmount} ${scale.suffix}`;
    }
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    }).format(Number(value) || 0);
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
