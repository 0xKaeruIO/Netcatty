import type { Host } from "../../domain/models";
import {
  buildVaultHostMergeKey,
  importVaultHostsFromText,
  mergeVaultImportIssues,
  vaultImportKeepsDistinctSessionFiles,
  type VaultImportFormat,
  type VaultImportIssue,
  type VaultImportResult,
} from "../../domain/vaultImport";
import type { XshellDecryptContext } from "../../domain/xshellPassword";
import {
  readVaultImportFile,
  type VaultImportFileEncoding,
} from "./vaultImportFile";

export interface VaultImportBatchProgress {
  completedFiles: number;
  totalFiles: number;
  fileName: string;
}

interface ImportVaultHostFilesOptions {
  format: VaultImportFormat;
  files: File[];
  relativePaths?: string[];
  encoding?: VaultImportFileEncoding;
  masterPassword?: string;
  xshellDecryptContext?: XshellDecryptContext | null;
  onProgress?: (progress: VaultImportBatchProgress) => void;
}

const SECURE_CRT_METADATA_FILES = new Set([
  "__folderdata__.ini",
  "default.ini",
]);

const SESSION_FOLDER_WRAPPERS: Record<"securecrt" | "xshell", string[]> = {
  securecrt: ["sessions"],
  xshell: ["sessions", "xshell"],
};

const normalizeRelativePath = (file: File, transferredRelativePath?: string): string[] => {
  const relativePath = transferredRelativePath?.trim() || file.webkitRelativePath?.trim();
  if (!relativePath) return [file.name];
  return relativePath.split(/[\\/]+/).filter(Boolean);
};

const sessionFolderGroupFromFile = (
  file: File,
  transferredRelativePath: string | undefined,
  wrappers: string[],
): string | undefined => {
  const segments = normalizeRelativePath(file, transferredRelativePath);
  if (segments.length <= 1) return undefined;

  segments.pop();
  const selectedRoot = segments.shift()?.toLowerCase();
  const wrapperSet = new Set(wrappers.map((name) => name.toLowerCase()));
  if (selectedRoot && !wrapperSet.has(selectedRoot)) {
    while (segments[0] && wrapperSet.has(segments[0].toLowerCase())) {
      segments.shift();
    }
  } else if (selectedRoot === "xshell" && segments[0]?.toLowerCase() === "sessions") {
    segments.shift();
  }
  return segments.length > 0 ? segments.join("/") : undefined;
};

const shouldIgnoreSessionFile = (format: VaultImportFormat, file: File): boolean => {
  const name = file.name.toLowerCase();
  if (format === "securecrt") {
    return SECURE_CRT_METADATA_FILES.has(name) || !name.endsWith(".ini");
  }
  if (format === "xshell") {
    return name === "folder.ini" || !name.endsWith(".xsh");
  }
  return false;
};

const emptySessionMessage = (format: VaultImportFormat, fileName: string): string => (
  format === "xshell"
    ? `${fileName}: no importable Xshell session found.`
    : `${fileName}: no importable SecureCRT session found.`
);

export async function importVaultHostFiles({
  format,
  files,
  relativePaths,
  encoding,
  masterPassword,
  xshellDecryptContext,
  onProgress,
}: ImportVaultHostFilesOptions): Promise<VaultImportResult> {
  const keepDistinct = vaultImportKeepsDistinctSessionFiles(format);
  const sourceFiles = files.map((file, index) => ({
    file,
    relativePath: relativePaths?.[index],
  }));
  const selectedFiles = keepDistinct
    ? sourceFiles.filter(({ file }) => !shouldIgnoreSessionFile(format, file))
    : sourceFiles.slice(0, 1);
  const hosts: Host[] = [];
  const issues: VaultImportIssue[] = [];
  const keyPassphrases: NonNullable<VaultImportResult["keyPassphrases"]> = [];
  const keyPassphraseCandidates: NonNullable<VaultImportResult["keyPassphraseCandidates"]> = [];
  const importedKeys: NonNullable<VaultImportResult["keys"]> = [];
  const importedGroups: string[] = [];
  let parsed = 0;
  let skipped = 0;
  let duplicates = 0;
  const wrappers = format === "xshell"
    ? SESSION_FOLDER_WRAPPERS.xshell
    : SESSION_FOLDER_WRAPPERS.securecrt;

  for (let index = 0; index < selectedFiles.length; index++) {
    const { file, relativePath } = selectedFiles[index];
    try {
      const text = await readVaultImportFile(format, file, encoding);
      const result = importVaultHostsFromText(format, text, {
        fileName: file.name,
        masterPassword,
        xshellDecryptContext,
      });
      const group = keepDistinct
        ? sessionFolderGroupFromFile(file, relativePath, wrappers)
        : undefined;
      const fileHosts = result.hosts.map((host) => (
        group && !host.group ? { ...host, group } : host
      ));

      parsed += result.stats.parsed;
      skipped += result.stats.skipped;
      duplicates += result.stats.duplicates;
      issues.push(...result.issues.map((issue) => ({
        ...issue,
        message: `${file.name}: ${issue.message}`,
      })));
      keyPassphrases.push(...(result.keyPassphrases ?? []));
      keyPassphraseCandidates.push(...(result.keyPassphraseCandidates ?? []));
      importedKeys.push(...(result.keys ?? []));
      importedGroups.push(...result.groups);

      if (fileHosts.length === 0) {
        if (result.stats.skipped === 0 && result.issues.length === 0) {
          skipped++;
          issues.push({
            level: "warning",
            message: emptySessionMessage(format, file.name),
          });
        }
      } else {
        hosts.push(...fileHosts);
      }
    } catch (error) {
      if (!keepDistinct || selectedFiles.length <= 1) throw error;
      skipped++;
      issues.push({
        level: "error",
        message: `${file.name}: ${error instanceof Error ? error.message : "Unable to read file."}`,
      });
    } finally {
      onProgress?.({
        completedFiles: index + 1,
        totalFiles: selectedFiles.length,
        fileName: file.name,
      });
    }
  }

  const seen = new Set<string>();
  const uniqueHosts = keepDistinct
    ? hosts
    : hosts.filter((host) => {
      const key = buildVaultHostMergeKey(host);
      if (seen.has(key)) {
        duplicates++;
        return false;
      }
      seen.add(key);
      return true;
    });
  const retainedKeyIds = new Set(uniqueHosts.map((host) => host.identityFileId).filter(Boolean));
  const keys = importedKeys.filter((key) => retainedKeyIds.has(key.id));
  const groups = Array.from(new Set([
    ...importedGroups,
    ...uniqueHosts.map((host) => host.group).filter((group): group is string => Boolean(group)),
  ]));

  return {
    hosts: uniqueHosts,
    groups,
    issues: mergeVaultImportIssues(issues),
    stats: {
      parsed,
      imported: uniqueHosts.length,
      skipped,
      duplicates,
    },
    ...(keyPassphrases.length > 0 ? { keyPassphrases } : {}),
    ...(keyPassphraseCandidates.length > 0 ? { keyPassphraseCandidates } : {}),
    ...(keys.length > 0 ? { keys } : {}),
  };
}
