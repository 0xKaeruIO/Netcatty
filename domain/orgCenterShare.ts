export const ORG_SHARE_FILE_TRANSFER_MESSAGE_KEY = "terminal.share.fileTransferUnsupported";

export type ShareSizeParty = {
  cols: number;
  rows: number;
};

export type ShareSizeSource = "self" | "peer" | "mixed" | "matched" | "self-only";

export type SharedPtyLayout = ShareSizeParty & {
  source: ShareSizeSource;
};

export function isOrgShareGuestRole(role: string | null | undefined): boolean {
  return role === "guest";
}

export function isOrgShareHostRole(role: string | null | undefined): boolean {
  return role === "host";
}

export function clampShareGridSize(cols: number, rows: number): ShareSizeParty {
  const nextCols = Math.floor(Number(cols) || 0);
  const nextRows = Math.floor(Number(rows) || 0);
  return {
    cols: Math.min(1000, Math.max(2, nextCols)),
    rows: Math.min(500, Math.max(1, nextRows)),
  };
}

export function resolveSharedPtyLayout(
  self: ShareSizeParty,
  peers: ShareSizeParty[],
): SharedPtyLayout {
  const host = clampShareGridSize(self.cols, self.rows);
  if (peers.length === 0) {
    return { ...host, source: "self-only" };
  }
  let cols = host.cols;
  let rows = host.rows;
  for (const peer of peers) {
    const next = clampShareGridSize(peer.cols, peer.rows);
    cols = Math.min(cols, next.cols);
    rows = Math.min(rows, next.rows);
  }
  const allMatch = peers.every((peer) => {
    const next = clampShareGridSize(peer.cols, peer.rows);
    return next.cols === host.cols && next.rows === host.rows;
  });
  if (allMatch) return { cols, rows, source: "matched" };
  const colFromSelf = cols === host.cols;
  const rowFromSelf = rows === host.rows;
  if (colFromSelf && rowFromSelf) return { cols, rows, source: "self" };
  if (!colFromSelf && !rowFromSelf) return { cols, rows, source: "peer" };
  return { cols, rows, source: "mixed" };
}

export function flipShareSizeSource(source: ShareSizeSource | undefined): ShareSizeSource {
  if (source === "self") return "peer";
  if (source === "peer") return "self";
  if (source === "self-only") return "peer";
  return source ?? "matched";
}

export function computeShareFillScale(
  viewportWidth: number,
  viewportHeight: number,
  gridWidth: number,
  gridHeight: number,
): number {
  if (gridWidth <= 0 || gridHeight <= 0) return 1;
  const raw = Math.min(viewportWidth / gridWidth, viewportHeight / gridHeight);
  if (!Number.isFinite(raw) || raw <= 1.02) return 1;
  return Math.min(4, raw);
}

export function proposeShareCapacity(
  viewportWidth: number,
  viewportHeight: number,
  cellWidth: number,
  cellHeight: number,
): ShareSizeParty {
  if (cellWidth <= 0 || cellHeight <= 0) {
    return { cols: 80, rows: 24 };
  }
  return clampShareGridSize(
    Math.floor(viewportWidth / cellWidth),
    Math.floor(viewportHeight / cellHeight),
  );
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
