import { useEffect, useState } from "react";
import type { OrgCenterConnection } from "../../domain/orgCenter";
import { STORAGE_KEY_ORG_CENTERS } from "../../infrastructure/config/storageKeys";
import { localStorageAdapter, LOCAL_STORAGE_ADAPTER_CHANGED_EVENT } from "../../infrastructure/persistence/localStorageAdapter";

export const readOrgCenterConnections = (): OrgCenterConnection[] => (
  localStorageAdapter.read<OrgCenterConnection[]>(STORAGE_KEY_ORG_CENTERS) ?? []
);

export function useOrgCenterConnections(): OrgCenterConnection[] {
  const [connections, setConnections] = useState<OrgCenterConnection[]>(readOrgCenterConnections);

  useEffect(() => {
    const syncFromStorage = () => {
      setConnections(readOrgCenterConnections());
    };
    const onAdapter = (event: Event) => {
      const key = (event as CustomEvent<{ key?: string }>).detail?.key;
      if (key === STORAGE_KEY_ORG_CENTERS) syncFromStorage();
    };
    window.addEventListener(LOCAL_STORAGE_ADAPTER_CHANGED_EVENT, onAdapter);
    window.addEventListener("storage", syncFromStorage);
    return () => {
      window.removeEventListener(LOCAL_STORAGE_ADAPTER_CHANGED_EVENT, onAdapter);
      window.removeEventListener("storage", syncFromStorage);
    };
  }, []);

  return connections;
}
