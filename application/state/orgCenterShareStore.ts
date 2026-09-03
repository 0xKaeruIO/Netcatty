import { useSyncExternalStore } from "react";

export type OrgCenterHostShare = {
  role: "host";
  sessionId: string;
  centerId: string;
  pin: string;
  roomId: string;
  status: "starting" | "active";
};

export type OrgCenterGuestShare = {
  role: "guest";
  sessionId: string;
  centerId: string;
  pin: string;
  label: string;
  cols?: number;
  rows?: number;
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
  });
  emit();
};

export const markHostShareActive = (
  sessionId: string,
  info: { centerId: string; pin: string; roomId: string },
): void => {
  hostShares.set(sessionId, {
    role: "host",
    sessionId,
    centerId: info.centerId,
    pin: info.pin,
    roomId: info.roomId,
    status: "active",
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
  });
  emit();
};

export const patchGuestShare = (
  sessionId: string,
  patch: Partial<Pick<OrgCenterGuestShare, "label" | "cols" | "rows" | "status">>,
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

export const useOrgCenterShareSnapshot = (): OrgCenterShareSnapshot => (
  useSyncExternalStore(subscribeOrgCenterShare, getOrgCenterShareSnapshot, getOrgCenterShareSnapshot)
);

export const useOrgCenterHostShare = (sessionId: string): OrgCenterHostShare | null => (
  useOrgCenterShareSnapshot().hostShares[sessionId] ?? null
);

export const useOrgCenterGuestShare = (sessionId: string): OrgCenterGuestShare | null => (
  useOrgCenterShareSnapshot().guestShares[sessionId] ?? null
);
