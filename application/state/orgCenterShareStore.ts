import { useSyncExternalStore } from "react";

export type OrgCenterHostShare = {
  role: "host";
  sessionId: string;
  centerId: string;
  pin: string;
  roomId: string;
  status: "starting" | "active";
  ptyCols?: number;
  ptyRows?: number;
  localCols?: number;
  localRows?: number;
  peerCols?: number;
  peerRows?: number;
  sizeSource?: "self" | "peer" | "mixed" | "matched" | "self-only";
  scaleToFit?: boolean;
};

export type OrgCenterGuestShare = {
  role: "guest";
  sessionId: string;
  centerId: string;
  pin: string;
  label: string;
  cols?: number;
  rows?: number;
  localCols?: number;
  localRows?: number;
  peerCols?: number;
  peerRows?: number;
  sizeSource?: "self" | "peer" | "mixed" | "matched" | "self-only";
  scaleToFit?: boolean;
  status: "joining" | "active" | "ended";
};

export type OrgCenterShareSnapshot = {
  hostShares: Record<string, OrgCenterHostShare>;
  guestShares: Record<string, OrgCenterGuestShare>;
};

const hostShares = new Map<string, OrgCenterHostShare>();
const guestShares = new Map<string, OrgCenterGuestShare>();
const listeners = new Set<() => void>();

const EMPTY_SNAPSHOT: OrgCenterShareSnapshot = {
  hostShares: {},
  guestShares: {},
};

let snapshot: OrgCenterShareSnapshot = EMPTY_SNAPSHOT;

const emit = (): void => {
  snapshot = {
    hostShares: Object.fromEntries(hostShares),
    guestShares: Object.fromEntries(guestShares),
  };
  for (const listener of listeners) listener();
};

export const subscribeOrgCenterShare = (listener: () => void): (() => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

export const getOrgCenterShareSnapshot = (): OrgCenterShareSnapshot => snapshot;

export const isOrgShareHostSession = (sessionId: string): boolean => hostShares.has(sessionId);

export const isOrgShareGuestSession = (sessionId: string): boolean => guestShares.has(sessionId);

export const shouldBlockOrgShareFileTransferForSession = (sessionId: string): boolean => (
  hostShares.has(sessionId) || guestShares.has(sessionId)
);

export const markHostShareStarting = (sessionId: string, centerId: string): void => {
  hostShares.set(sessionId, {
    role: "host",
    sessionId,
    centerId,
    pin: "",
    roomId: "",
    status: "starting",
    scaleToFit: false,
  });
  emit();
};

export const markHostShareActive = (
  sessionId: string,
  info: {
    centerId: string;
    pin: string;
    roomId: string;
    ptyCols?: number;
    ptyRows?: number;
    localCols?: number;
    localRows?: number;
  },
): void => {
  hostShares.set(sessionId, {
    role: "host",
    sessionId,
    centerId: info.centerId,
    pin: info.pin,
    roomId: info.roomId,
    status: "active",
    scaleToFit: hostShares.get(sessionId)?.scaleToFit ?? false,
    ptyCols: info.ptyCols,
    ptyRows: info.ptyRows,
    localCols: info.localCols,
    localRows: info.localRows,
  });
  emit();
};

export const clearHostShare = (sessionId: string): void => {
  if (!hostShares.delete(sessionId)) return;
  emit();
};

export const markGuestShare = (sessionId: string, info: Omit<OrgCenterGuestShare, "role" | "sessionId">): void => {
  guestShares.set(sessionId, {
    role: "guest",
    sessionId,
    ...info,
    scaleToFit: info.scaleToFit ?? false,
  });
  emit();
};

export const patchHostShare = (
  sessionId: string,
  patch: Partial<Omit<OrgCenterHostShare, "role" | "sessionId">>,
): void => {
  const current = hostShares.get(sessionId);
  if (!current) return;
  hostShares.set(sessionId, { ...current, ...patch });
  emit();
};

export const patchGuestShare = (
  sessionId: string,
  patch: Partial<Omit<OrgCenterGuestShare, "role" | "sessionId">>,
): void => {
  const current = guestShares.get(sessionId);
  if (!current) return;
  guestShares.set(sessionId, { ...current, ...patch });
  emit();
};

export const clearGuestShare = (sessionId: string): void => {
  if (!guestShares.delete(sessionId)) return;
  emit();
};

export const setOrgShareScaleToFit = (sessionId: string, scaleToFit: boolean): void => {
  if (hostShares.has(sessionId)) {
    patchHostShare(sessionId, { scaleToFit });
    return;
  }
  patchGuestShare(sessionId, { scaleToFit });
};

export const useOrgCenterShareSnapshot = (): OrgCenterShareSnapshot => (
  useSyncExternalStore(subscribeOrgCenterShare, getOrgCenterShareSnapshot, getOrgCenterShareSnapshot)
);

export const useOrgCenterHostShare = (sessionId: string): OrgCenterHostShare | null => (
  useOrgCenterShareSnapshot().hostShares[sessionId] ?? null
);

export const useOrgCenterGuestShare = (sessionId: string): OrgCenterGuestShare | null => (
  useOrgCenterShareSnapshot().guestShares[sessionId] ?? null
);
