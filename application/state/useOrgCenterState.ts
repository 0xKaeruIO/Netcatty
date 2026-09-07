import { useCallback, useEffect, useRef, useState } from "react";
import {
  applyOrgCenterCatalog,
  normalizeOrgCenterHostAuth,
  normalizeOrgCenterUrl,
  removeOrgCenterGroupConfigs,
  removeOrgCenterGroups,
  removeOrgCenterHosts,
  removeOrgCenterKeys,
  ungroupLocalHostsInOrgCenterGroups,
  type OrgCenterConnection,
} from "../../domain/orgCenter";
import type { GroupConfig, Host, SSHKey } from "../../domain/models";
import { STORAGE_KEY_ORG_CENTERS } from "../../infrastructure/config/storageKeys";
import { localStorageAdapter, LOCAL_STORAGE_ADAPTER_CHANGED_EVENT } from "../../infrastructure/persistence/localStorageAdapter";
import { fetchOrgCenterCatalog } from "../../infrastructure/services/orgCenterClient";

const randomId = (): string => {
  if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID();
  return `orgc-${Date.now().toString(16)}-${Math.random().toString(16).slice(2)}`;
};

const readConnections = (): OrgCenterConnection[] =>
  localStorageAdapter.read<OrgCenterConnection[]>(STORAGE_KEY_ORG_CENTERS) ?? [];

const writeConnections = (connections: OrgCenterConnection[]): void => {
  localStorageAdapter.write(STORAGE_KEY_ORG_CENTERS, connections);
};

export interface UseOrgCenterStateOptions {
  hosts: Host[];
  keys: SSHKey[];
  customGroups: string[];
  groupConfigs?: GroupConfig[];
  updateHosts: (hosts: Host[] | ((prev: Host[]) => Host[])) => void;
  updateKeys: (keys: SSHKey[] | ((prev: SSHKey[]) => SSHKey[])) => void;
  updateCustomGroups: (groups: string[] | ((prev: string[]) => string[])) => void;
  updateGroupConfigs?: (configs: GroupConfig[] | ((prev: GroupConfig[]) => GroupConfig[])) => void;
  autoSync?: boolean;
  isInitialized?: boolean;
}

export function useOrgCenterState({
  hosts,
  keys,
  customGroups,
  groupConfigs = [],
  updateHosts,
  updateKeys,
  updateCustomGroups,
  updateGroupConfigs,
  autoSync = false,
  isInitialized = true,
}: UseOrgCenterStateOptions) {
  const [connections, setConnections] = useState<OrgCenterConnection[]>(readConnections);
  const [syncingId, setSyncingId] = useState<string | null>(null);
  const hostsRef = useRef(hosts);
  const keysRef = useRef(keys);
  const groupsRef = useRef(customGroups);
  const groupConfigsRef = useRef(groupConfigs);
  hostsRef.current = hosts;
  keysRef.current = keys;
  groupsRef.current = customGroups;
  groupConfigsRef.current = groupConfigs;
  const hasAutoSyncedRef = useRef(false);
  const hasMigratedAuthRef = useRef(false);

  useEffect(() => {
    if (!isInitialized || hasMigratedAuthRef.current) return;
    hasMigratedAuthRef.current = true;
    updateHosts((prev) => {
      let changed = false;
      const next = prev.map((host) => {
        const normalized = normalizeOrgCenterHostAuth(host);
        if (normalized !== host) changed = true;
        return normalized;
      });
      return changed ? next : prev;
    });
  }, [isInitialized, updateHosts]);

  useEffect(() => {
    const syncFromStorage = () => {
      setConnections(readConnections());
    };
    const onAdapter = (event: Event) => {
      const key = (event as CustomEvent<{ key?: string }>).detail?.key;
      if (key === STORAGE_KEY_ORG_CENTERS) syncFromStorage();
    };
    const onStorage = (event: StorageEvent) => {
      if (event.key === STORAGE_KEY_ORG_CENTERS) syncFromStorage();
    };
    window.addEventListener(LOCAL_STORAGE_ADAPTER_CHANGED_EVENT, onAdapter);
    window.addEventListener("storage", onStorage);
    return () => {
      window.removeEventListener(LOCAL_STORAGE_ADAPTER_CHANGED_EVENT, onAdapter);
      window.removeEventListener("storage", onStorage);
    };
  }, []);

  const persist = useCallback((next: OrgCenterConnection[]) => {
    setConnections(next);
    writeConnections(next);
  }, []);

  const syncConnection = useCallback(async (connection: OrgCenterConnection): Promise<OrgCenterConnection> => {
    setSyncingId(connection.id);
    try {
      const catalog = await fetchOrgCenterCatalog(connection.url, connection.apiKey, connection.skipTlsVerify);
      const applied = applyOrgCenterCatalog(
        hostsRef.current,
        groupsRef.current,
        { ...connection, name: catalog.center?.name || connection.name },
        catalog,
        keysRef.current,
      );
      updateHosts(applied.hosts);
      updateKeys(applied.keys);
      updateCustomGroups(applied.customGroups);
      const updated: OrgCenterConnection = {
        ...connection,
        name: catalog.center?.name || connection.name,
        remoteCenterId: catalog.center?.id,
        lastSyncedAt: Date.now(),
        lastError: undefined,
      };
      persist(readConnections().map((item) => (item.id === connection.id ? updated : item)));
      return updated;
    } catch (err) {
      const message = err instanceof Error ? err.message : "Sync failed";
      const failed = { ...connection, lastError: message };
      persist(readConnections().map((item) => (item.id === connection.id ? failed : item)));
      throw err;
    } finally {
      setSyncingId(null);
    }
  }, [persist, updateCustomGroups, updateHosts, updateKeys]);

  const addConnection = useCallback(async (
    url: string,
    apiKey: string,
    options?: { skipTlsVerify?: boolean },
  ): Promise<OrgCenterConnection> => {
    const normalizedUrl = normalizeOrgCenterUrl(url);
    const trimmedKey = apiKey.trim();
    const existing = readConnections();
    if (existing.some((item) => item.url === normalizedUrl)) {
      throw new Error("This organization center is already added.");
    }
    const draft: OrgCenterConnection = {
      id: randomId(),
      url: normalizedUrl,
      apiKey: trimmedKey,
      name: normalizedUrl.replace(/^https?:\/\//, ""),
      skipTlsVerify: options?.skipTlsVerify || undefined,
    };
    persist([...existing, draft]);
    try {
      return await syncConnection(draft);
    } catch (err) {
      persist(readConnections().filter((item) => item.id !== draft.id));
      throw err;
    }
  }, [persist, syncConnection]);

  const setSkipTlsVerify = useCallback((id: string, skipTlsVerify: boolean) => {
    persist(readConnections().map((item) => (
      item.id === id
        ? { ...item, skipTlsVerify: skipTlsVerify || undefined }
        : item
    )));
  }, [persist]);

  const removeConnection = useCallback((id: string) => {
    const connection = readConnections().find((item) => item.id === id);
    persist(readConnections().filter((item) => item.id !== id));
    if (!connection) return;
    const currentHosts = hostsRef.current;
    updateCustomGroups(removeOrgCenterGroups(groupsRef.current, connection, currentHosts));
    updateGroupConfigs?.(removeOrgCenterGroupConfigs(groupConfigsRef.current, connection, currentHosts));
    updateHosts(removeOrgCenterHosts(
      ungroupLocalHostsInOrgCenterGroups(currentHosts, connection),
      id,
    ));
    updateKeys(removeOrgCenterKeys(keysRef.current, connection));
  }, [persist, updateCustomGroups, updateGroupConfigs, updateHosts, updateKeys]);

  useEffect(() => {
    if (!autoSync || !isInitialized || hasAutoSyncedRef.current || connections.length === 0) return;
    hasAutoSyncedRef.current = true;
    const timer = window.setTimeout(() => {
      void (async () => {
        for (const connection of readConnections()) {
          try {
            await syncConnection(connection);
          } catch {
            // lastError is persisted on the connection
          }
        }
      })();
    }, 2500);
    return () => window.clearTimeout(timer);
  }, [autoSync, connections.length, isInitialized, syncConnection]);

  return {
    connections,
    syncingId,
    addConnection,
    removeConnection,
    syncConnection,
    setSkipTlsVerify,
  };
}
