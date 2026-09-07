import type { Host, Identity, SSHKey, StartupCommandRule } from "../models";
import { isEncryptedCredentialPlaceholder, sanitizeCredentialValue } from "../credentials";
import { isPluginHostProtocol } from "../pluginConnection";
import { resolveHostAuth } from "../sshAuth";
import { parseStartupCommandRulesInput } from "../startupCommandRules";
import {
  buildVaultHostFromDraft,
  buildVaultHostMergeKey,
} from "../vaultHostCreate";
import type { VaultImportIssue, VaultImportResult } from "../vaultImport";

export interface VaultJsonHostRecord {
  label: string;
  hostname: string;
  port: number;
  username: string;
  group: string;
  tags: string[];
  os: string;
  protocol: string;
  deviceType: string;
  notes: string;
  password: string;
  privateKey: string;
  passphrase: string;
  startupCommand: string;
  startupCommandRunMode: string;
  startupCommandRules: StartupCommandRule[];
  visibility: string;
  visibleKeyIds: string[];
}

export interface VaultJsonHostList {
  groups: string[];
  hosts: VaultJsonHostRecord[];
}

export interface VaultJsonExportOptions {
  keys?: SSHKey[];
  identities?: Identity[];
}

export interface VaultJsonExportResult {
  json: string;
  payload: VaultJsonHostList;
  exportedCount: number;
  skippedCount: number;
}

const isInGroupTree = (path: string | null | undefined, root: string): boolean => {
  const normalized = String(path || "").trim();
  const base = root.trim();
  if (!normalized || !base) return false;
  return normalized === base || normalized.startsWith(`${base}/`);
};

export const collectGroupExportPaths = (
  groups: string[],
  hosts: Host[],
  root?: string,
): string[] => {
  const paths = new Set<string>();
  const consider = (path: string | null | undefined) => {
    const normalized = String(path || "").trim();
    if (!normalized) return;
    if (root && !isInGroupTree(normalized, root)) return;
    const parts = normalized.split("/").filter(Boolean);
    const start = root ? root.split("/").filter(Boolean).length : 1;
    for (let i = start; i <= parts.length; i++) {
      paths.add(parts.slice(0, i).join("/"));
    }
  };
  if (root) consider(root);
  for (const group of groups) consider(group);
  for (const host of hosts) consider(host.group);
  return [...paths];
};

export const collectHostsInGroupTree = (hosts: Host[], root: string): Host[] => (
  hosts.filter((host) => isInGroupTree(host.group, root))
);

const isUnsupportedExportHost = (host: Host): boolean => (
  host.protocol === "serial" || host.protocol === "local" || isPluginHostProtocol(host.protocol)
);

const detectImportedKeyType = (privateKey: string): SSHKey["type"] => {
  const pk = privateKey.toLowerCase();
  if (pk.includes("rsa")) return "RSA";
  if (pk.includes("ecdsa") || pk.includes("ec ")) return "ECDSA";
  return "ED25519";
};

const plaintext = (value: string | undefined | null): string => (
  sanitizeCredentialValue(value ?? undefined) ?? ""
);

const asString = (value: unknown): string => {
  if (typeof value === "string") return value;
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return "";
};

const asStringArray = (value: unknown): string[] => {
  if (!Array.isArray(value)) return [];
  return value.map((entry) => String(entry).trim()).filter(Boolean);
};

const looksLikeHostObject = (value: unknown): value is Record<string, unknown> => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return asString(record.hostname).trim() !== "" || asString(record.label).trim() !== "";
};

export const looksLikeVaultHostListJson = (text: string): boolean => {
  const trimmed = String(text || "").replace(/^\uFEFF/, "").trim();
  if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) return false;
  try {
    const parsed = JSON.parse(trimmed) as unknown;
    if (Array.isArray(parsed)) return parsed.some(looksLikeHostObject);
    if (!parsed || typeof parsed !== "object") return false;
    const record = parsed as Record<string, unknown>;
    if (Array.isArray(record.hosts)) return true;
    if (Array.isArray(record.groups)) return true;
    return looksLikeHostObject(record);
  } catch {
    return false;
  }
};

const toExportHost = (
  host: Host,
  options: VaultJsonExportOptions,
): VaultJsonHostRecord => {
  const isTelnet = host.protocol === "telnet";
  const auth = resolveHostAuth({
    host,
    keys: options.keys ?? [],
    identities: options.identities ?? [],
  });
  const username = isTelnet
    ? (host.telnetUsername ?? host.username ?? "")
    : (auth.username || host.username || "");
  const password = isTelnet
    ? plaintext(host.savePassword === false ? undefined : (host.telnetPassword ?? host.password))
    : plaintext(host.savePassword === false ? undefined : auth.password);
  const privateKey = isTelnet ? "" : plaintext(auth.key?.privateKey);
  const passphrase = isTelnet ? "" : plaintext(auth.passphrase);
  const runMode = host.startupCommandRunMode
    || (host.startupCommandRules?.length ? "rules" : "paste");
  const command = runMode === "rules" ? "" : (host.startupCommand ?? "");
  const port = isTelnet
    ? (host.telnetPort ?? host.port ?? 23)
    : (host.port ?? 22);

  return {
    label: host.label || host.hostname,
    hostname: host.hostname,
    port,
    username,
    group: host.group ?? "",
    tags: [...(host.tags ?? [])],
    os: host.os || "linux",
    protocol: isTelnet ? "telnet" : "ssh",
    deviceType: host.deviceType || "general",
    notes: host.notes ?? "",
    password,
    privateKey,
    passphrase,
    startupCommand: command,
    startupCommandRunMode: runMode,
    startupCommandRules: [...(host.startupCommandRules ?? [])],
    visibility: "all",
    visibleKeyIds: [],
  };
};

export const exportVaultHostsToJson = (
  hosts: Host[],
  groups: string[],
  options: VaultJsonExportOptions = {},
  rootGroup?: string,
): VaultJsonExportResult => {
  const scopedHosts = rootGroup ? collectHostsInGroupTree(hosts, rootGroup) : hosts;
  const skippedHosts = scopedHosts.filter(isUnsupportedExportHost);
  const exportableHosts = scopedHosts.filter((host) => !isUnsupportedExportHost(host));
  const payload: VaultJsonHostList = {
    groups: collectGroupExportPaths(groups, exportableHosts, rootGroup),
    hosts: exportableHosts.map((host) => toExportHost(host, options)),
  };
  return {
    json: `${JSON.stringify(payload, null, 2)}\n`,
    payload,
    exportedCount: exportableHosts.length,
    skippedCount: skippedHosts.length,
  };
};

const hostInputFromRecord = (record: Record<string, unknown>): {
  host: Host;
  key?: SSHKey;
} | { error: string } => {
  const protocolRaw = asString(record.protocol).trim().toLowerCase();
  const protocol = protocolRaw === "telnet" ? "telnet" : protocolRaw === "ssh" || protocolRaw === "ssh2" || !protocolRaw
    ? "ssh"
    : undefined;
  if (protocolRaw && protocol === undefined) {
    return { error: "unsupported protocol" };
  }
  const built = buildVaultHostFromDraft({
    label: asString(record.label),
    hostname: asString(record.hostname),
    port: record.port,
    username: asString(record.username),
    password: asString(record.password),
    group: asString(record.group),
    tags: record.tags,
    notes: asString(record.notes),
    protocol,
    os: asString(record.os),
  });
  if (!built.ok) return { error: built.error };

  const host: Host = { ...built.host };
  const deviceType = asString(record.deviceType).trim().toLowerCase();
  if (deviceType === "network" || deviceType === "general") {
    host.deviceType = deviceType;
  }
  const runMode = asString(record.startupCommandRunMode).trim();
  const rules = parseStartupCommandRulesInput(record.startupCommandRules);
  if (!rules.ok) return { error: rules.error };
  if (runMode === "rules") {
    host.startupCommandRunMode = "rules";
    host.startupCommand = undefined;
    host.startupCommandRules = rules.rules ?? [];
  } else if (runMode === "lineDelay" || runMode === "paste") {
    host.startupCommandRunMode = runMode;
    const command = asString(record.startupCommand);
    if (command) host.startupCommand = command;
    if (rules.rules) host.startupCommandRules = rules.rules;
  } else {
    const command = asString(record.startupCommand);
    if (command) host.startupCommand = command;
    if (rules.rules) {
      host.startupCommandRunMode = "rules";
      host.startupCommandRules = rules.rules;
    }
  }
  if (host.protocol === "telnet") {
    host.telnetPort = host.port;
    host.telnetUsername = host.username;
    host.telnetPassword = host.password;
  }

  const privateKey = asString(record.privateKey).trim();
  const passphrase = asString(record.passphrase);
  if (privateKey && !isEncryptedCredentialPlaceholder(privateKey)) {
    const key: SSHKey = {
      id: crypto.randomUUID(),
      label: `${host.label} key`,
      type: detectImportedKeyType(privateKey),
      privateKey,
      passphrase: passphrase && !isEncryptedCredentialPlaceholder(passphrase) ? passphrase : undefined,
      savePassphrase: Boolean(passphrase && !isEncryptedCredentialPlaceholder(passphrase)),
      source: "imported",
      category: "key",
      created: Date.now(),
    };
    host.identityFileId = key.id;
    host.authMethod = host.password ? host.authMethod : "key";
    return { host, key };
  }
  return { host };
};

const parseHostRecords = (
  records: Record<string, unknown>[],
): {
  hosts: Host[];
  keys: SSHKey[];
  issues: VaultImportIssue[];
  parsed: number;
  skipped: number;
} => {
  const hosts: Host[] = [];
  const keys: SSHKey[] = [];
  const issues: VaultImportIssue[] = [];
  let parsed = 0;
  let skipped = 0;
  for (let i = 0; i < records.length; i++) {
    parsed++;
    const result = hostInputFromRecord(records[i]);
    if ("error" in result) {
      skipped++;
      issues.push({
        level: "warning",
        message: `JSON host ${i + 1}: ${result.error}.`,
      });
      continue;
    }
    hosts.push(result.host);
    if (result.key) keys.push(result.key);
  }
  return { hosts, keys, issues, parsed, skipped };
};

export const importVaultHostsFromJson = (text: string): VaultImportResult => {
  const trimmed = String(text || "").replace(/^\uFEFF/, "").trim();
  if (!trimmed) {
    return {
      hosts: [],
      groups: [],
      issues: [{ level: "error", message: "JSON file is empty." }],
      stats: { parsed: 0, imported: 0, skipped: 0, duplicates: 0 },
    };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return {
      hosts: [],
      groups: [],
      issues: [{ level: "error", message: "JSON file is invalid." }],
      stats: { parsed: 0, imported: 0, skipped: 0, duplicates: 0 },
    };
  }

  let groups: string[] = [];
  let records: Record<string, unknown>[] = [];
  if (Array.isArray(parsed)) {
    records = parsed.filter((item): item is Record<string, unknown> => (
      Boolean(item) && typeof item === "object" && !Array.isArray(item)
    ));
  } else if (parsed && typeof parsed === "object") {
    const record = parsed as Record<string, unknown>;
    groups = asStringArray(record.groups);
    if (Array.isArray(record.hosts)) {
      records = record.hosts.filter((item): item is Record<string, unknown> => (
        Boolean(item) && typeof item === "object" && !Array.isArray(item)
      ));
    } else if (looksLikeHostObject(record)) {
      records = [record];
    } else if (groups.length === 0) {
      return {
        hosts: [],
        groups: [],
        issues: [{ level: "error", message: "JSON has no hosts or groups." }],
        stats: { parsed: 0, imported: 0, skipped: 0, duplicates: 0 },
      };
    }
  } else {
    return {
      hosts: [],
      groups: [],
      issues: [{ level: "error", message: "JSON must be an object or host array." }],
      stats: { parsed: 0, imported: 0, skipped: 0, duplicates: 0 },
    };
  }

  const imported = parseHostRecords(records);
  const seen = new Set<string>();
  let duplicates = 0;
  const uniqueHosts = imported.hosts.filter((host) => {
    const key = buildVaultHostMergeKey(host);
    if (seen.has(key)) {
      duplicates++;
      return false;
    }
    seen.add(key);
    return true;
  });
  const retainedKeyIds = new Set(uniqueHosts.map((host) => host.identityFileId).filter(Boolean));
  const keys = imported.keys.filter((key) => retainedKeyIds.has(key.id));
  const hostGroups = uniqueHosts.map((host) => host.group).filter((group): group is string => Boolean(group));
  return {
    hosts: uniqueHosts,
    groups: collectGroupExportPaths([...groups, ...hostGroups], uniqueHosts),
    issues: imported.issues,
    stats: {
      parsed: imported.parsed || (groups.length > 0 ? groups.length : 0),
      imported: uniqueHosts.length,
      skipped: imported.skipped,
      duplicates,
    },
    ...(keys.length > 0 ? { keys } : {}),
  };
};
