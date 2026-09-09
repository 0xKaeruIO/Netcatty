import type { NoteFindDomMatch } from "../../domain/notes/noteFind";

export const NOTE_FIND_MATCH_HIGHLIGHT = "note-find-match";
export const NOTE_FIND_CURRENT_HIGHLIGHT = "note-find-current";

type HighlightRegistry = {
  clear: () => void;
  set: (name: string, highlight: Highlight) => void;
  delete: (name: string) => boolean;
};

const getHighlightRegistry = (): HighlightRegistry | null => {
  if (typeof CSS === "undefined") return null;
  const cssWithHighlights = CSS as typeof CSS & { highlights?: HighlightRegistry };
  return cssWithHighlights.highlights ?? null;
};

const getHighlightCtor = (): (new () => Highlight) | null => {
  const ctor = (globalThis as { Highlight?: new () => Highlight }).Highlight;
  return typeof ctor === "function" ? ctor : null;
};

export const clearNoteFindHighlights = (): void => {
  const registry = getHighlightRegistry();
  if (!registry) return;
  registry.delete(NOTE_FIND_MATCH_HIGHLIGHT);
  registry.delete(NOTE_FIND_CURRENT_HIGHLIGHT);
};

export const applyNoteFindHighlights = (
  document: Document,
  matches: readonly NoteFindDomMatch[],
  currentIndex: number,
): Range | null => {
  const registry = getHighlightRegistry();
  const HighlightCtor = getHighlightCtor();
  if (!registry || !HighlightCtor) {
    return createCurrentRange(document, matches, currentIndex);
  }

  const matchHighlight = new HighlightCtor();
  const currentHighlight = new HighlightCtor();
  let currentRange: Range | null = null;

  matches.forEach((match, index) => {
    const range = document.createRange();
    try {
      range.setStart(match.start.node, match.start.offset);
      range.setEnd(match.end.node, match.end.offset);
    } catch {
      return;
    }
    if (index === currentIndex) {
      currentHighlight.add(range);
      currentRange = range;
    } else {
      matchHighlight.add(range);
    }
  });

  registry.set(NOTE_FIND_MATCH_HIGHLIGHT, matchHighlight);
  registry.set(NOTE_FIND_CURRENT_HIGHLIGHT, currentHighlight);
  return currentRange;
};

export const revealNoteFindRange = (range: Range | null): void => {
  if (!range) return;
  const node = range.startContainer;
  const element = node instanceof Element ? node : node.parentElement;
  element?.scrollIntoView({ block: "center", inline: "nearest" });
};

const createCurrentRange = (
  document: Document,
  matches: readonly NoteFindDomMatch[],
  currentIndex: number,
): Range | null => {
  const match = matches[currentIndex];
  if (!match) return null;
  const range = document.createRange();
  try {
    range.setStart(match.start.node, match.start.offset);
    range.setEnd(match.end.node, match.end.offset);
  } catch {
    return null;
  }
  return range;
};
