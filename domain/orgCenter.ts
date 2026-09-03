import { sanitizeHost } from "./host";
import type { Host, SSHKey } from "./models";

export interface OrgCenterConnection {
  id: string;
  url: string;
  apiKey: string;
  name: string;
  remoteCenterId?: string;
  lastSyncedAt?: number;
  lastError?: string;
}

export interface OrgCatalogHost {
  id: string;
  label: string;
  hostname: string;
  port: number;
  username: string;
  group: string;
  tags: string[];
  os: Host["os"];
  protocol: "ssh" | "telnet";
  deviceType?: Host["deviceType"];
  notes: string;
  password?: string;
  privateKey?: string;
  passphrase?: string;
  updatedAt: number;
}

export interface OrgCatalog {
  version: 1;
  center: { id: string; name: string };
  generatedAt: number;
  hosts: OrgCatalogHost[];
}

export const orgHostId = (centerId: string, catalogHostId: string): string =>
  `org:${centerId}:${catalogHostId}`;

export const orgKeyId = (centerId: string, catalogHostId: string): string =>
  `orgkey:${centerId}:${catalogHostId}`;

export const catalogIdNamespace = (
  center: Pick<OrgCenterConnection, "id" | "remoteCenterId">,
  catalog?: Pick<OrgCatalog, "center">,
): string => catalog?.center?.id || center.remoteCenterId || center.id;

export const normalizeOrgCenterUrl = (raw: string): string => raw.trim().replace(/\/+$/, "");

export const isOrgCenterHost = (host: Host, centerId: string): boolean =>
  host.orgCenterId === centerId || (host.id?.startsWith(`org:${centerId}:`) ?? false);

export const isOrgCenterKey = (key: SSHKey, centerId: string): boolean =>
  Boolean(centerId) && (key.id?.startsWith(`orgkey:${centerId}:`) ?? false);

const hasExplicitAgentSettings = (host: Pick<Host, "identityAgent" | "useKeychain" | "addKeysToAgent">): boolean => {
  if (host.identityAgent?.trim() || host.useKeychain === true) return true;
  const addKeys = host.addKeysToAgent?.trim().toLowerCase();
  return Boolean(addKeys && addKeys !== "no");
};

/**
 * Catalog hosts may still have no secrets. Requiring a running system SSH
 * agent made first-click connect fail on Windows when ssh-agent is not started.
 * Keep agent-only auth only when the user configured an explicit agent.
 */
export const normalizeOrgCenterHostAuth = (host: Host): Host => {
  if (!host.orgCenterId || host.useSshAgent !== true || hasExplicitAgentSettings(host)) {
    return host;
  }
  return { ...host, useSshAgent: undefined, authMethod: host.authMethod ?? "auto" };
};

export const detectOrgKeyType = (privateKey: string): SSHKey["type"] => {
  const pk = privateKey.toLowerCase();
  if (pk.includes("rsa")) return "RSA";
  if (pk.includes("ecdsa") || pk.includes("ec ")) return "ECDSA";
  return "ED25519";
};

export const sshKeyFromCatalog = (
  center: OrgCenterConnection,
  catalogHost: OrgCatalogHost,
  namespace: string,
  existing?: SSHKey,
): SSHKey | null => {
  const privateKey = catalogHost.privateKey?.trim();
  if (!privateKey) return null;
  const passphrase = catalogHost.passphrase?.trim();
  return {
    id: orgKeyId(namespace, catalogHost.id),
    label: `${center.name} / ${catalogHost.label}`,
    type: detectOrgKeyType(privateKey),
    privateKey,
    passphrase: passphrase || undefined,
    savePassphrase: Boolean(passphrase),
    source: "imported",
    category: "key",
    created: existing?.created ?? Date.now(),
  };
};

const LOCAL_ONLY_KEYS = [
  "password",
  "savePassword",
  "identityId",
  "identityFileId",
  "identityFilePaths",
  "authMethod",
  "authPolicyVersion",
  "useSshAgent",
  "identityAgent",
  "addKeysToAgent",
  "useKeychain",
  "pinned",
  "lastConnectedAt",
  "theme",
  "themeOverride",
  "fontFamily",
  "fontFamilyOverride",
  "fontSize",
  "fontSizeOverride",
  "order",
] as const;

export const catalogGroupPath = (centerName: string, catalogGroup: string): string => {
  const root = centerName.trim() || "Org";
  const nested = catalogGroup.trim().replace(/^\/+|\/+$/g, "");
  return nested ? `${root}/${nested}` : root;
};

export const collectGroupPaths = (path: string): string[] => {
  const parts = path.split("/").map((part) => part.trim()).filter(Boolean);
  const paths: string[] = [];
  for (let i = 0; i < parts.length; i += 1) {
    paths.push(parts.slice(0, i + 1).join("/"));
  }
  return paths;
};

export const hostFromCatalog = (
  center: OrgCenterConnection,
  catalogHost: OrgCatalogHost,
  existing?: Host,
  remoteCenterId?: string,
): Host => {
  const group = catalogGroupPath(center.name, catalogHost.group);
  const next: Host = {
    id: orgHostId(
      catalogIdNamespace(center, remoteCenterId ? { center: { id: remoteCenterId, name: center.name } } : undefined),
      catalogHost.id,
    ),
    label: catalogHost.label,
    hostname: catalogHost.hostname,
    port: catalogHost.port || 22,
    username: catalogHost.username,
    group,
    tags: Array.isArray(catalogHost.tags) ? catalogHost.tags : [],
    os: catalogHost.os === "windows" || catalogHost.os === "macos" ? catalogHost.os : "linux",
    protocol: catalogHost.protocol === "telnet" ? "telnet" : "ssh",
    deviceType: catalogHost.deviceType === "network" ? "network" : "general",
    notes: catalogHost.notes || undefined,
    orgCenterId: center.id,
  };
  if (existing) {
    for (const key of LOCAL_ONLY_KEYS) {
      const value = existing[key];
      if (value !== undefined) {
        (next as unknown as Record<string, unknown>)[key] = value;
      }
    }
  }
  applyCatalogCredentials(next, catalogHost, catalogIdNamespace(
    center,
    remoteCenterId ? { center: { id: remoteCenterId, name: center.name } } : undefined,
  ));
  return sanitizeHost(normalizeOrgCenterHostAuth(next));
};

const applyCatalogCredentials = (host: Host, catalogHost: OrgCatalogHost, namespace: string): void => {
  const password = catalogHost.password?.trim();
  const privateKey = catalogHost.privateKey?.trim();
  if (password) {
    host.password = password;
    host.savePassword = true;
  }
  if (privateKey) {
    host.identityFileId = orgKeyId(namespace, catalogHost.id);
  } else if (host.identityFileId?.startsWith("orgkey:")) {
    host.identityFileId = undefined;
  }
  if (password && privateKey) {
    host.authMethod = "auto";
    host.useSshAgent = false;
  } else if (privateKey) {
    host.authMethod = "key";
    host.useSshAgent = false;
  } else if (password) {
    host.authMethod = "password";
    host.useSshAgent = false;
  }
};

export const applyOrgCenterCatalog = (
  hosts: Host[],
  customGroups: string[],
  center: OrgCenterConnection,
  catalog: OrgCatalog,
  keys: SSHKey[] = [],
): { hosts: Host[]; customGroups: string[]; keys: SSHKey[]; changed: boolean } => {
  const namespace = catalogIdNamespace(center, catalog);
  const incomingIds = new Set(catalog.hosts.map((host) => orgHostId(namespace, host.id)));
  const incomingKeyIds = new Set(
    catalog.hosts.filter((host) => host.privateKey?.trim()).map((host) => orgKeyId(namespace, host.id)),
  );
  const existingById = new Map(hosts.map((host) => [host.id, host]));
  const existingKeysById = new Map(keys.map((key) => [key.id, key]));
  const kept = hosts.filter((host) => !isOrgCenterHost(host, center.id) || incomingIds.has(host.id));

  const merged = [...kept];
  for (const catalogHost of catalog.hosts) {
    const id = orgHostId(namespace, catalogHost.id);
    const existing = existingById.get(id) ?? existingById.get(orgHostId(center.id, catalogHost.id));
    const next = hostFromCatalog(center, catalogHost, existing, catalog.center.id);
    const index = merged.findIndex((host) => host.id === id);
    if (index >= 0) {
      merged[index] = next;
    } else {
      merged.push(next);
    }
  }

  const keptKeys = keys.filter((key) => {
    if (isOrgCenterKey(key, center.id) || isOrgCenterKey(key, namespace)) {
      return incomingKeyIds.has(key.id);
    }
    return true;
  });
  const mergedKeys = [...keptKeys];
  for (const catalogHost of catalog.hosts) {
    const nextKey = sshKeyFromCatalog(
      { ...center, name: catalog.center?.name || center.name },
      catalogHost,
      namespace,
      existingKeysById.get(orgKeyId(namespace, catalogHost.id))
        ?? existingKeysById.get(orgKeyId(center.id, catalogHost.id)),
    );
    if (!nextKey) continue;
    const index = mergedKeys.findIndex((key) => key.id === nextKey.id);
    if (index >= 0) mergedKeys[index] = nextKey;
    else mergedKeys.push(nextKey);
  }

  const groupSet = new Set(customGroups);
  for (const catalogHost of catalog.hosts) {
    for (const path of collectGroupPaths(catalogGroupPath(center.name, catalogHost.group))) {
      groupSet.add(path);
    }
  }

  const nextGroups = [...groupSet];
  const changed = merged.length !== hosts.length
    || merged.some((host, index) => host !== hosts[index])
    || mergedKeys.length !== keys.length
    || mergedKeys.some((key, index) => key !== keys[index])
    || nextGroups.length !== customGroups.length
    || nextGroups.some((group, index) => group !== customGroups[index]);

  return { hosts: merged, customGroups: nextGroups, keys: mergedKeys, changed };
};

export const removeOrgCenterHosts = (
  hosts: Host[],
  centerId: string,
): Host[] => hosts.filter((host) => !isOrgCenterHost(host, centerId));

export const removeOrgCenterKeys = (
  keys: SSHKey[],
  center: Pick<OrgCenterConnection, "id" | "remoteCenterId">,
): SSHKey[] => keys.filter((key) =>
  !isOrgCenterKey(key, center.id)
  && !(center.remoteCenterId && isOrgCenterKey(key, center.remoteCenterId))
);
