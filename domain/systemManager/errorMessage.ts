export const SYSTEM_MANAGER_SHARE_READ_ONLY_CODE = "ORG_SHARE_SYSTEM_READ_ONLY";
export const SYSTEM_MANAGER_SHARE_READ_ONLY_ERROR =
  "System monitoring is read-only on shared guest sessions.";
export const SYSTEM_MANAGER_SESSION_NOT_FOUND_ERROR =
  "Session not found or not connected";

type Translate = (key: string, values?: Record<string, string | number>) => string;

export function resolveSystemManagerErrorKey(
  error: string | null | undefined,
  errorCode?: string | null,
): string | null {
  const code = String(errorCode || "").trim();
  const message = String(error || "").trim();
  const lower = message.toLowerCase();
  if (code === SYSTEM_MANAGER_SHARE_READ_ONLY_CODE || message === SYSTEM_MANAGER_SHARE_READ_ONLY_ERROR) {
    return "systemManager.errors.shareReadOnly";
  }
  if (lower.includes("session not found or not connected")) {
    return "systemManager.errors.sessionNotFound";
  }
  if (lower.includes("channel open failure") || lower.includes("unable to exec")) {
    return "systemManager.errors.sshChannelUnavailable";
  }
  return null;
}

export function formatSystemManagerError(
  error: unknown,
  t: Translate,
  errorCode?: string | null,
): string {
  const message = error instanceof Error ? error.message : String(error || "");
  const key = resolveSystemManagerErrorKey(message, errorCode);
  return key ? t(key) : message;
}
