import type { VaultImportDestination } from "../../domain/vaultImport";
import type { VaultImportFileEncoding } from "./vaultImportFile";
import type { XshellDecryptContext } from "../../domain/xshellPassword";

/** Options for a vault host-file import (kept out of UI modules). */
export type VaultImportOptions = {
  managed?: boolean;
  filePath?: string;
  encoding?: VaultImportFileEncoding;
  masterPassword?: string;
  xshellDecryptContext?: XshellDecryptContext | null;
  destination?: VaultImportDestination;
};

/** Notification sink so application/state hooks do not import UI toast. */
export type VaultImportNotifier = {
  success: (message: string, title?: string) => void;
  error: (message: string, title?: string) => void;
  warning: (message: string, title?: string) => void;
};
