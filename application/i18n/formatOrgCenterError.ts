const ORG_CENTER_ERROR_KEYS: Record<string, string> = {
  "This organization center is already added.": "settings.orgCenter.error.duplicate",
  "Organization center URL is required.": "settings.orgCenter.error.urlRequired",
  "Invalid organization center URL.": "settings.orgCenter.error.urlInvalid",
  "Organization center URL must be http or https.": "settings.orgCenter.error.urlProtocol",
  "Invalid organization center API key.": "settings.orgCenter.error.apiKey",
  "Organization center request timed out.": "settings.orgCenter.error.timeout",
  "Organization center returned an unsupported catalog.": "settings.orgCenter.error.catalog",
  "Organization center bridge unavailable": "settings.orgCenter.error.bridge",
};

export function formatOrgCenterError(
  message: string,
  t: (key: string) => string,
): string {
  const key = ORG_CENTER_ERROR_KEYS[message];
  return key ? t(key) : (message || t("settings.orgCenter.error.generic"));
}
