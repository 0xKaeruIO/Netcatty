export interface SftpRememberedLocation {
  hostId: string;
  connectionKey: string;
  path: string;
}

export function getSftpReopenMemoryKey(params: {
  tabId: string;
  sourceSessionId?: string | null;
}): string {
  return params.sourceSessionId || params.tabId;
}

export function getSftpCurrentPathMemoryKey(params: {
  tabId: string;
  activeTerminalSessionIdForSftp?: string | null;
  focusedSessionId?: string | null;
}): string {
  return params.activeTerminalSessionIdForSftp || params.focusedSessionId || params.tabId;
}

export function resolveSftpOpenLocation(params: {
  hostId: string;
  connectionKey: string;
  terminalCwd?: string;
  explicitTargetPath?: string;
  hasPendingUpload?: boolean;
  remembered?: SftpRememberedLocation | null;
}): string | undefined {
  const { hostId, connectionKey, terminalCwd, explicitTargetPath, hasPendingUpload, remembered } = params;

  if (explicitTargetPath) {
    return explicitTargetPath;
  }

  if (hasPendingUpload) {
    return terminalCwd && terminalCwd.length > 0 ? terminalCwd : undefined;
  }

  if (
    remembered &&
    remembered.hostId === hostId &&
    remembered.connectionKey === connectionKey &&
    remembered.path
  ) {
    return remembered.path;
  }

  return terminalCwd && terminalCwd.length > 0 ? terminalCwd : undefined;
}

/**
 * Path used when the side panel auto-connects / rebinds (not a user open).
 * Prefer an explicit open target, then the last browsed path for this endpoint.
 *
 * With follow off, terminal cwd is intentionally omitted so the browsed
 * directory stays sticky. With follow on the pane belongs to the linked
 * terminal, so the live cwd wins over any remembered path: a second session on
 * an already-browsed host must not open on the directory another pane left
 * behind (the shared remote-host cache would otherwise supply it).
 */
export function resolveSftpAutoConnectPath(params: {
  explicitPath?: string | null;
  rememberedPath?: string | null;
  followTerminalCwd?: boolean;
  terminalCwd?: string | null;
}): string | undefined {
  const explicit = params.explicitPath?.length ? params.explicitPath : undefined;
  if (explicit) return explicit;
  if (params.followTerminalCwd) {
    return params.terminalCwd?.length ? params.terminalCwd : undefined;
  }
  const remembered = params.rememberedPath?.length ? params.rememberedPath : undefined;
  return remembered;
}

/**
 * Whether an auto-connect must skip the cross-pane shared remote-host cache.
 *
 * The cache is keyed by endpoint, not by pane, so adopting its path lands a
 * fresh follow-mode pane on whatever directory another terminal tab was
 * browsing. Skip it when follow is on and no concrete path is known yet; the
 * follow sync then navigates once the terminal cwd resolves.
 */
export function shouldIgnoreSftpSharedHostCacheOnAutoConnect(params: {
  followTerminalCwd?: boolean;
  resolvedPath?: string | undefined;
}): boolean {
  return Boolean(params.followTerminalCwd) && !params.resolvedPath;
}
