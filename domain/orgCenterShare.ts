export const ORG_SHARE_FILE_TRANSFER_MESSAGE_KEY = "terminal.share.fileTransferUnsupported";

export function isOrgShareGuestRole(role: string | null | undefined): boolean {
  return role === "guest";
}

export function isOrgShareHostRole(role: string | null | undefined): boolean {
  return role === "host";
}

export function shouldBlockOrgShareFileTransfer(options: {
  orgShareRole?: string | null;
  hostSharing?: boolean;
}): boolean {
  return isOrgShareGuestRole(options.orgShareRole) || options.hostSharing === true;
}

export function formatOrgShareGuestLabel(pin: string, hostLabel?: string): string {
  const trimmed = String(hostLabel ?? "").trim();
  if (trimmed) return trimmed;
  return `Share · ${pin}`;
}
