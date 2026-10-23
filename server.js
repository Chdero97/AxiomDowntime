"use strict";

const http = require("node:http");
const fs = require("node:fs/promises");
const path = require("node:path");
const { createHash, randomUUID } = require("node:crypto");

const HOST = process.env.DT_HOST || "0.0.0.0";
const PORT = Number(process.env.DT_PORT || 8080);
const DATA_FILE = process.env.DT_DATA_FILE || path.join(__dirname, "data", "flex-downtime-state.json");
const PUBLIC_DIR = path.join(__dirname, "dist");
const MAX_BODY_BYTES = 25 * 1024 * 1024;
const CONTENT_TYPES = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml"
};

let writeQueue = Promise.resolve();

function sendJson(response, statusCode, value, headers = {}) {
  response.writeHead(statusCode, {
    "Cache-Control": "no-store",
    "Content-Type": "application/json; charset=utf-8",
    "X-Content-Type-Options": "nosniff",
    ...headers
  });
  response.end(JSON.stringify(value));
}

function stateRevision(raw) {
  return `"${createHash("sha256").update(raw).digest("hex")}"`;
}

async function readStateFile() {
  try {
    const raw = await fs.readFile(DATA_FILE, "utf8");
    const state = JSON.parse(raw);
    if (!state || !Array.isArray(state.records) || !state.catalogs || typeof state.catalogs !== "object") {
      throw new Error("El archivo compartido no contiene el formato de datos esperado.");
    }
    return { raw, state, revision: stateRevision(raw) };
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}

async function readRequestBody(request) {
  const chunks = [];
  let bytes = 0;
  for await (const chunk of request) {
    bytes += chunk.length;
    if (bytes > MAX_BODY_BYTES) throw Object.assign(new Error("El estado excede el tamaño máximo permitido."), { statusCode: 413 });
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString("utf8");
}

function validateState(state) {
  if (!state || typeof state !== "object" || Array.isArray(state)) return "El cuerpo debe ser un objeto JSON.";
  if (!Array.isArray(state.records)) return "records debe ser una lista.";
  if (!state.catalogs || typeof state.catalogs !== "object" || Array.isArray(state.catalogs)) return "catalogs debe ser un objeto.";
  if (!Array.isArray(state.hourlyReports)) return "hourlyReports debe ser una lista.";
  return "";
}

async function writeStateAtomically(raw) {
  const folder = path.dirname(DATA_FILE);
  const temporaryFile = path.join(folder, `.${path.basename(DATA_FILE)}.${randomUUID()}.tmp`);
  await fs.mkdir(folder, { recursive: true });
  try {
    await fs.writeFile(temporaryFile, raw, { encoding: "utf8", flag: "wx" });
    await fs.rename(temporaryFile, DATA_FILE);
  } catch (error) {
    await fs.rm(temporaryFile, { force: true }).catch(() => {});
    throw error;
  }
}

function staticPath(urlPath) {
  let decoded;
  try {
    decoded = decodeURIComponent(urlPath);
  } catch {
    return null;
  }
  const requested = decoded === "/" ? "/index.html" : decoded;
  const resolved = path.resolve(PUBLIC_DIR, `.${requested}`);
  return resolved.startsWith(`${PUBLIC_DIR}${path.sep}`) ? resolved : null;
}

async function serveStatic(request, response) {
  const filePath = staticPath(new URL(request.url, "http://localhost").pathname);
  if (!filePath) {
    response.writeHead(400);
    response.end("Ruta inválida");
    return;
  }
  try {
    const content = await fs.readFile(filePath);
    response.writeHead(200, {
      "Cache-Control": path.extname(filePath) === ".html" ? "no-cache" : "public, max-age=300",
      "Content-Type": CONTENT_TYPES[path.extname(filePath)] || "application/octet-stream",
      "X-Content-Type-Options": "nosniff"
    });
    response.end(request.method === "HEAD" ? undefined : content);
  } catch (error) {
    if (error.code !== "ENOENT" && error.code !== "EISDIR") {
      console.error("Error al servir archivo web:", error);
      response.writeHead(500);
      response.end("Error interno del servidor");
      return;
    }
    response.writeHead(404);
    response.end("No encontrado");
  }
}

async function handleStateRequest(request, response) {
  if (request.method === "GET") {
    const stored = await readStateFile();
    if (!stored) {
      sendJson(response, 200, { initialized: false, revision: null, state: null });
      return;
    }
    sendJson(response, 200, { initialized: true, revision: stored.revision, state: stored.state }, { ETag: stored.revision });
    return;
  }
  if (request.method !== "PUT") {
    response.writeHead(405, { Allow: "GET, PUT" });
    response.end();
    return;
  }

  const contentType = String(request.headers["content-type"] || "").toLowerCase();
  if (!contentType.startsWith("application/json")) {
    sendJson(response, 415, { error: "Content-Type debe ser application/json." });
    return;
  }
  const raw = await readRequestBody(request);
  let state;
  try {
    state = JSON.parse(raw);
  } catch {
    sendJson(response, 400, { error: "El cuerpo no contiene JSON válido." });
    return;
  }
  const validationError = validateState(state);
  if (validationError) {
    sendJson(response, 400, { error: validationError });
    return;
  }

  const expectedRevision = String(request.headers["if-match"] || "");
  let release;
  const currentWrite = new Promise((resolve) => { release = resolve; });
  const previousWrite = writeQueue;
  writeQueue = currentWrite;
  await previousWrite;
  try {
    const current = await readStateFile();
    const actualRevision = current?.revision || "none";
    if (expectedRevision !== actualRevision) {
      sendJson(response, 409, {
        initialized: Boolean(current),
        revision: current?.revision || null,
        state: current?.state || null,
        error: "El archivo compartido cambió desde la última lectura."
      }, current ? { ETag: current.revision } : {});
      return;
    }
    const serialized = `${JSON.stringify(state, null, 2)}\n`;
    await writeStateAtomically(serialized);
    const revision = stateRevision(serialized);
    sendJson(response, 200, { initialized: true, revision }, { ETag: revision });
  } finally {
    release();
  }
}

const server = http.createServer(async (request, response) => {
  const pathname = new URL(request.url, "http://localhost").pathname;
  try {
    if (pathname === "/api/health" && request.method === "GET") {
      sendJson(response, 200, { status: "ok" });
      return;
    }
    if (pathname === "/api/state") {
      await handleStateRequest(request, response);
      return;
    }
    if (request.method === "GET" || request.method === "HEAD") {
      await serveStatic(request, response);
      return;
    }
    response.writeHead(405, { Allow: "GET, HEAD" });
    response.end();
  } catch (error) {
    console.error("Error procesando solicitud:", error);
    if (!response.headersSent) {
      sendJson(response, error.statusCode || 500, { error: error.statusCode ? error.message : "Error interno del servidor." });
    } else {
      response.destroy();
    }
  }
});

server.listen(PORT, HOST, () => {
  console.log(`Downtime Control disponible en http://${HOST}:${PORT}`);
  console.log(`Archivo central: ${DATA_FILE}`);
});

function shutdown() {
  server.close(() => process.exit(0));
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
