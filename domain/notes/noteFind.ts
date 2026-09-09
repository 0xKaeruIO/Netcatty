export type NoteFindMatch = {
  start: number;
  end: number;
};

export type NoteFindHighlightKind = "plain" | "match" | "current";

export type NoteFindHighlightSegment = {
  text: string;
  kind: NoteFindHighlightKind;
};

export type NoteFindDomPoint = {
  node: Text;
  offset: number;
};

export type NoteFindDomMatch = {
  start: NoteFindDomPoint;
  end: NoteFindDomPoint;
};

const escapeRegExp = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export const collectStringMatches = (haystack: string, needle: string): NoteFindMatch[] => {
  if (!needle) return [];
  const matches: NoteFindMatch[] = [];
  const pattern = new RegExp(escapeRegExp(needle), "gi");
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(haystack)) !== null) {
    const length = match[0].length;
    if (length === 0) {
      pattern.lastIndex += 1;
      continue;
    }
    matches.push({ start: match.index, end: match.index + length });
  }
  return matches;
};

export const advanceNoteFindIndex = (
  current: number,
  total: number,
  direction: 1 | -1,
): number => {
  if (total <= 0) return -1;
  if (current < 0 || current >= total) return direction === 1 ? 0 : total - 1;
  return (current + direction + total) % total;
};

export const indexOfMatchContainingCaret = (
  matches: readonly NoteFindMatch[],
  caret: number,
): number => {
  const containing = matches.findIndex((match) => caret >= match.start && caret < match.end);
  if (containing >= 0) return containing;
  const next = matches.findIndex((match) => match.start >= caret);
  return next >= 0 ? next : 0;
};

export const splitTextForFindHighlights = (
  text: string,
  matches: readonly NoteFindMatch[],
  currentIndex: number,
): NoteFindHighlightSegment[] => {
  if (matches.length === 0 || !text) return text ? [{ text, kind: "plain" }] : [];
  const segments: NoteFindHighlightSegment[] = [];
  let cursor = 0;
  matches.forEach((match, index) => {
    if (match.start > cursor) {
      segments.push({ text: text.slice(cursor, match.start), kind: "plain" });
    }
    segments.push({
      text: text.slice(match.start, match.end),
      kind: index === currentIndex ? "current" : "match",
    });
    cursor = match.end;
  });
  if (cursor < text.length) {
    segments.push({ text: text.slice(cursor), kind: "plain" });
  }
  return segments;
};

export const isNoteFindOpenKey = (event: {
  key: string;
  metaKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
}): boolean => {
  if (event.altKey) return false;
  if (event.key !== "f" && event.key !== "F") return false;
  return event.metaKey || event.ctrlKey;
};

export const isNoteFindNextKey = (event: {
  key: string;
  metaKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
}): boolean => {
  if (event.altKey || event.shiftKey) return false;
  if (event.key === "F3") return true;
  if ((event.key === "g" || event.key === "G") && (event.metaKey || event.ctrlKey)) return true;
  return false;
};

export const isNoteFindPreviousKey = (event: {
  key: string;
  metaKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
}): boolean => {
  if (event.altKey || !event.shiftKey) return false;
  if (event.key === "F3") return true;
  if ((event.key === "g" || event.key === "G") && (event.metaKey || event.ctrlKey)) return true;
  return false;
};

export const isNoteFindCloseKey = (event: { key: string }): boolean => event.key === "Escape";

export const shouldSkipNoteFindNode = (node: Node): boolean => {
  const element = node.nodeType === 1 ? node as Element : node.parentElement;
  if (!element || typeof element.closest !== "function") return true;
  if (element.closest("[data-note-find-bar]")) return true;
  if (element.closest("[data-note-markdown-source-notice]")) return true;
  if (element.closest(".cm-widgetBuffer, .cm-tooltip, .cm-announced, .cm-gutters")) return true;
  return false;
};

export const collectVisibleTextNodes = (root: ParentNode): Text[] => {
  const document = root.ownerDocument;
  if (!document) return [];
  const nodeFilter = document.defaultView?.NodeFilter ?? (globalThis as { NodeFilter?: typeof NodeFilter }).NodeFilter;
  if (!nodeFilter) return [];
  const nodes: Text[] = [];
  const walker = document.createTreeWalker(root, nodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      if (shouldSkipNoteFindNode(node)) return nodeFilter.FILTER_REJECT;
      if (!node.nodeValue) return nodeFilter.FILTER_REJECT;
      return nodeFilter.FILTER_ACCEPT;
    },
  });
  let current = walker.nextNode();
  while (current) {
    nodes.push(current as Text);
    current = walker.nextNode();
  }
  return nodes;
};

export const mapStringMatchesToDom = (
  nodes: readonly Text[],
  matches: readonly NoteFindMatch[],
): NoteFindDomMatch[] => {
  if (nodes.length === 0 || matches.length === 0) return [];
  const spans: Array<{ node: Text; start: number; end: number }> = [];
  let offset = 0;
  for (const node of nodes) {
    const length = node.nodeValue?.length ?? 0;
    spans.push({ node, start: offset, end: offset + length });
    offset += length;
  }
  const total = offset;

  const locate = (index: number, bound: "start" | "end"): NoteFindDomPoint | null => {
    if (spans.length === 0) return null;
    if (bound === "end" && index === total) {
      const last = spans[spans.length - 1];
      return { node: last.node, offset: last.end - last.start };
    }
    for (const span of spans) {
      if (bound === "start" && index >= span.start && index < span.end) {
        return { node: span.node, offset: index - span.start };
      }
      if (bound === "end" && index > span.start && index <= span.end) {
        return { node: span.node, offset: index - span.start };
      }
    }
    return null;
  };

  const mapped: NoteFindDomMatch[] = [];
  for (const match of matches) {
    const start = locate(match.start, "start");
    const end = locate(match.end, "end");
    if (!start || !end) continue;
    mapped.push({ start, end });
  }
  return mapped;
};
