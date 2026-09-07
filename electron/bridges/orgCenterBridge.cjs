/**
 * Organization Center Bridge
 *
 * Fetches the host catalog from a Netcatty Center server in the main process
 * so the renderer does not depend on CORS from a packaged file:// origin.
 */

const { shouldSkipTlsVerify, withOrgCenterTls } = require("./orgCenterTls.cjs");

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

function rewriteOrgCenterFetchError(err) {
  if (err?.name === "AbortError") {
    return new Error("Organization center request timed out.");
  }
  const combined = `${err?.message || ""} ${err?.cause?.message || err?.cause?.code || ""}`.toLowerCase();
  if (
    /timed out|etimedout|und_err_connect_timeout|und_err_headers_timeout|und_err_body_timeout|connect timeout/.test(combined)
  ) {
    return new Error("Organization center request timed out.");
  }
  if (
    err?.name === "TypeError"
    || /fetch failed|econnrefused|enotfound|eai_again|econnreset|econnaborted|enetunreach|ehostunreach|getaddrinfo|socket hang up/.test(combined)
  ) {
    return new Error("Could not reach the organization center.");
  }
  return err instanceof Error ? err : new Error(String(err || "Could not reach the organization center."));
}

function extractApiKey(payload) {
  const key = String(payload?.apiKey ?? "").trim();
  if (!key.startsWith("ncc_")) {
    throw new Error("Invalid organization center API key.");
  }
  return key;
}

async function fetchJson(url, apiKey, timeoutMs = 15000, skipTlsVerify = false) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, withOrgCenterTls({
      headers: apiKey
        ? { Authorization: `Bearer ${apiKey}`, Accept: "application/json" }
        : { Accept: "application/json" },
      signal: controller.signal,
    }, skipTlsVerify));
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = typeof body.error === "string" ? body.error : `HTTP ${response.status}`;
      throw new Error(error);
    }
    return body;
  } catch (err) {
    throw rewriteOrgCenterFetchError(err);
  } finally {
    clearTimeout(timer);
  }
}

function registerHandlers(ipcMain) {
  ipcMain.handle("netcatty:orgCenter:health", async (_event, payload) => {
    const baseUrl = normalizeBaseUrl(payload?.url);
    const skipTls = shouldSkipTlsVerify(payload?.skipTlsVerify);
    const body = await fetchJson(`${baseUrl}/api/v1/health`, undefined, 15000, skipTls);
    return { ok: true, name: body.name || "Netcatty Center", version: body.version ?? 1 };
  });

  ipcMain.handle("netcatty:orgCenter:fetchCatalog", async (_event, payload) => {
    const baseUrl = normalizeBaseUrl(payload?.url);
    const apiKey = extractApiKey(payload);
    const skipTls = shouldSkipTlsVerify(payload?.skipTlsVerify);
    const body = await fetchJson(`${baseUrl}/api/v1/catalog`, apiKey, 15000, skipTls);
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
