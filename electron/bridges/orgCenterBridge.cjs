/**
 * Organization Center Bridge
 *
 * Fetches the host catalog from a Netcatty Center server in the main process
 * so the renderer does not depend on CORS from a packaged file:// origin.
 */

function normalizeBaseUrl(raw) {
  const trimmed = String(raw ?? "").trim().replace(/\/+$/, "");
  if (!trimmed) {
    throw new Error("Organization center URL is required.");
  }
  let parsed;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new Error("Invalid organization center URL.");
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("Organization center URL must be http or https.");
  }
  return trimmed;
}

function extractApiKey(payload) {
  const key = String(payload?.apiKey ?? "").trim();
  if (!key.startsWith("ncc_")) {
    throw new Error("Invalid organization center API key.");
  }
  return key;
}

async function fetchJson(url, apiKey, timeoutMs = 15000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      headers: apiKey
        ? { Authorization: `Bearer ${apiKey}`, Accept: "application/json" }
        : { Accept: "application/json" },
      signal: controller.signal,
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = typeof body.error === "string" ? body.error : `HTTP ${response.status}`;
      throw new Error(error);
    }
    return body;
  } catch (err) {
    if (err?.name === "AbortError") {
      throw new Error("Organization center request timed out.");
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

function registerHandlers(ipcMain) {
  ipcMain.handle("netcatty:orgCenter:health", async (_event, payload) => {
    const baseUrl = normalizeBaseUrl(payload?.url);
    const body = await fetchJson(`${baseUrl}/api/v1/health`);
    return { ok: true, name: body.name || "Netcatty Center", version: body.version ?? 1 };
  });

  ipcMain.handle("netcatty:orgCenter:fetchCatalog", async (_event, payload) => {
    const baseUrl = normalizeBaseUrl(payload?.url);
    const apiKey = extractApiKey(payload);
    const body = await fetchJson(`${baseUrl}/api/v1/catalog`, apiKey);
    if (body?.version !== 1 || !body?.center || !Array.isArray(body.hosts)) {
      throw new Error("Organization center returned an unsupported catalog.");
    }
    return body;
  });
}

module.exports = {
  registerHandlers,
  normalizeBaseUrl,
};
