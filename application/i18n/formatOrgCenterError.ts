const ORG_CENTER_ERROR_KEYS: Record<string, string> = {
  "This organization center is already added.": "settings.orgCenter.error.duplicate",
  "Organization center URL is required.": "settings.orgCenter.error.urlRequired",
  "Invalid organization center URL.": "settings.orgCenter.error.urlInvalid",
  "Organization center URL must be http or https.": "settings.orgCenter.error.urlProtocol",
  "Invalid organization center API key.": "settings.orgCenter.error.apiKey",
  "Organization center request timed out.": "settings.orgCenter.error.timeout",
  "Organization center share connection timed out.": "settings.orgCenter.error.timeout",
  "Organization center returned an unsupported catalog.": "settings.orgCenter.error.catalog",
  "Organization center returned an unsupported share room.": "settings.orgCenter.error.shareRoom",
  "Organization center bridge unavailable": "settings.orgCenter.error.bridge",
  "Could not reach the organization center.": "settings.orgCenter.error.generic",
  "Could not open organization center share connection.": "settings.orgCenter.error.network",
  "WebSocket is unavailable in this process.": "settings.orgCenter.error.network",
  "Missing session id.": "settings.orgCenter.error.generic",
};

const ELECTRON_INVOKE_PREFIX = /^Error invoking remote method ['"][^'"]+['"]:\s*/i;
const ERROR_NAME_PREFIX = /^(?:TypeError|Error|AggregateError|ReferenceError):\s*/i;

function unwrapOrgCenterErrorMessage(message: string): string {
  let next = String(message || "").trim();
  for (let i = 0; i < 3 && next; i += 1) {
    const stripped = next.replace(ELECTRON_INVOKE_PREFIX, "").replace(ERROR_NAME_PREFIX, "").trim();
    if (stripped === next) break;
    next = stripped;
  }
  return next;
}

function resolveOrgCenterErrorKey(message: string): string | null {
  const unwrapped = unwrapOrgCenterErrorMessage(message);
  const exact = ORG_CENTER_ERROR_KEYS[unwrapped] || ORG_CENTER_ERROR_KEYS[message];
  if (exact) return exact;
  if (!unwrapped) return "settings.orgCenter.error.generic";

  const lower = unwrapped.toLowerCase();
  if (
    lower.includes("timed out")
    || lower.includes("etimedout")
    || lower.includes("und_err_connect_timeout")
    || lower.includes("und_err_headers_timeout")
    || lower.includes("und_err_body_timeout")
    || lower.includes("connect timeout")
  ) {
    return "settings.orgCenter.error.timeout";
  }
  if (
    lower.includes("fetch failed")
    || lower.includes("econnrefused")
    || lower.includes("enotfound")
    || lower.includes("eai_again")
    || lower.includes("econnreset")
    || lower.includes("econnaborted")
    || lower.includes("enetunreach")
    || lower.includes("ehostunreach")
    || lower.includes("getaddrinfo")
    || lower.includes("socket hang up")
    || lower.includes("cert_")
    || lower.includes("unable to verify")
    || lower.includes("self signed")
    || lower.includes("websocket")
  ) {
    return "settings.orgCenter.error.network";
  }
  if (
    /^http 40[13]\b/i.test(unwrapped)
    || lower === "unauthorized"
    || lower === "forbidden"
  ) {
    return "settings.orgCenter.error.apiKey";
  }
  if (/^http \d{3}\b/i.test(unwrapped)) {
    return "settings.orgCenter.error.generic";
  }
  return null;
}

export function formatOrgCenterError(
  message: string,
  t: (key: string) => string,
): string {
  const key = resolveOrgCenterErrorKey(message);
  if (key) return t(key);
  return unwrapOrgCenterErrorMessage(message) || t("settings.orgCenter.error.generic");
}
