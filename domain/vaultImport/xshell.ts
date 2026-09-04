import type { HostProtocol } from "../models";
import { usableStartupCommandRules } from "../startupCommandRules";

type XshellImportIssue = {
  level: "warning" | "error";
  message: string;
};

type XshellProtocol = Exclude<HostProtocol, "mosh" | "et">;

export interface ParsedXshellSession {
  label: string;
  hostname?: string;
  username?: string;
  port?: number;
  protocol?: XshellProtocol;
  notes?: string;
  keyPath?: string;
  agentForwarding?: boolean;
  charset?: string;
  startupCommand?: string;
  startupCommandRunMode?: "rules";
  startupCommandRules?: Array<{ expect: string; send: string }>;
  encryptedPassword?: string;
  sessionVersion?: string;
  unsupportedProtocol?: string;
  issues: XshellImportIssue[];
}

const GENERIC_SESSION_NOTES = new Set([
  "xshell session file",
  "xftp session file",
]);

const parseIniSections = (text: string): Map<string, Map<string, string>> => {
  const sections = new Map<string, Map<string, string>>();
  let current = new Map<string, string>();
  sections.set("", current);

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith(";") || line.startsWith("#")) continue;

    const section = line.match(/^\[(.+)\]$/);
    if (section) {
      const name = section[1].trim().toLowerCase();
      current = sections.get(name) ?? new Map();
      sections.set(name, current);
      continue;
    }

    const eq = line.indexOf("=");
    if (eq <= 0) continue;
    current.set(line.slice(0, eq).trim().toLowerCase(), line.slice(eq + 1));
  }

  return sections;
};

const getSection = (
  sections: Map<string, Map<string, string>>,
  name: string,
): Map<string, string> => sections.get(name.toLowerCase()) ?? new Map();

const parsePort = (raw: string | undefined): number | undefined => {
  const value = raw?.trim();
  if (!value) return undefined;
  const port = Number.parseInt(value, 10);
  if (!Number.isFinite(port) || port < 1 || port > 65535) return undefined;
  return port;
};

const normalizeXshellProtocol = (
  raw: string | undefined,
): XshellProtocol | "unsupported" | undefined => {
  const value = raw?.trim().toLowerCase();
  if (!value) return undefined;
  if (value === "ssh" || value === "ssh2" || value === "ssh-2") return "ssh";
  if (value === "telnet") return "telnet";
  return "unsupported";
};

const parseCharset = (codePage: string | undefined): string | undefined => {
  const value = codePage?.trim();
  if (value === "65001") return "utf-8";
  if (value === "936" || value === "54936") return "gb18030";
  return undefined;
};

const parseUserKeyPath = (raw: string | undefined): string | undefined => {
  const value = raw?.trim();
  if (!value) return undefined;
  if (/[\\/]/.test(value) || /\.(?:pem|key|ppk)$/i.test(value)) return value;
  return undefined;
};

const parseExpectSendRules = (
  auth: Map<string, string>,
): Array<{ expect: string; send: string }> => {
  if (auth.get("useexpectsend") !== "1") return [];
  const count = Number.parseInt(auth.get("expectsend_count") ?? "0", 10);
  if (!Number.isFinite(count) || count <= 0) return [];

  const rules: Array<{ expect: string; send: string }> = [];
  for (let index = 0; index < count; index++) {
    rules.push({
      expect: auth.get(`expectsend_expect_${index}`) ?? "",
      send: auth.get(`expectsend_send_${index}`) ?? "",
    });
  }
  return usableStartupCommandRules(rules);
};

const sessionLabelFromFileName = (fileName?: string): string => {
  const base = fileName?.replace(/\.[^.]+$/, "").trim();
  return base || "Xshell Session";
};

export function parseXshellSession(
  text: string,
  fileName?: string,
): ParsedXshellSession {
  const sections = parseIniSections(text ?? "");
  const connection = getSection(sections, "CONNECTION");
  const auth = getSection(sections, "CONNECTION:AUTHENTICATION");
  const ssh = getSection(sections, "CONNECTION:SSH");
  const terminal = getSection(sections, "TERMINAL");
  const sessionInfo = getSection(sections, "SESSIONINFO");
  const issues: XshellImportIssue[] = [];

  const protocolValue = normalizeXshellProtocol(connection.get("protocol"));
  const hostname = connection.get("host")?.trim() || undefined;
  const username = auth.get("username")?.trim() || undefined;
  const notesRaw = connection.get("description")?.trim();
  const notes = notesRaw && !GENERIC_SESSION_NOTES.has(notesRaw.toLowerCase())
    ? notesRaw
    : undefined;
  const encryptedPassword = auth.get("password")?.trim() || undefined;
  const sessionVersion = sessionInfo.get("version")?.trim() || undefined;
  const rules = parseExpectSendRules(auth);
  const remoteCommand = ssh.get("remotecommand")?.trim() || undefined;

  const parsed: ParsedXshellSession = {
    label: sessionLabelFromFileName(fileName),
    hostname,
    username,
    port: parsePort(connection.get("port")),
    notes,
    keyPath: parseUserKeyPath(auth.get("userkey")),
    charset: parseCharset(terminal.get("codepage")),
    encryptedPassword,
    sessionVersion,
    issues,
  };

  if (protocolValue === "unsupported") {
    parsed.unsupportedProtocol = connection.get("protocol")?.trim() || "unknown";
    return parsed;
  }
  parsed.protocol = protocolValue ?? "ssh";

  if (ssh.get("agentforwarding") === "1") {
    parsed.agentForwarding = true;
  }

  if (rules.length > 0) {
    parsed.startupCommandRunMode = "rules";
    parsed.startupCommandRules = rules;
  } else if (remoteCommand) {
    parsed.startupCommand = remoteCommand;
  }

  return parsed;
}

export function looksLikeXshellSession(text: string): boolean {
  const input = (text ?? "").trim();
  if (!input) return false;
  if (/\[SessionInfo\]/i.test(input) && /Xshell session file/i.test(input)) {
    return true;
  }
  return /\[CONNECTION:AUTHENTICATION\]/i.test(input)
    && /^Host=/m.test(input)
    && (/UseExpectSend=/i.test(input) || /ExpectSend_Count=/i.test(input) || /^\[CONNECTION\]/m.test(input));
}
