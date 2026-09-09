import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  advanceNoteFindIndex,
  collectStringMatches,
  collectVisibleTextNodes,
  indexOfMatchContainingCaret,
  isNoteFindCloseKey,
  isNoteFindNextKey,
  isNoteFindOpenKey,
  isNoteFindPreviousKey,
  mapStringMatchesToDom,
  type NoteFindMatch,
} from "../../domain/notes/noteFind";
import {
  applyNoteFindHighlights,
  clearNoteFindHighlights,
  revealNoteFindRange,
} from "./noteFindHighlight";
import type { NoteSourceEditorHandle } from "./NoteSourceEditor";

const NOTE_FIND_REFRESH_MS = 60;
const handledFindEvents = new WeakSet<Event>();

const readRichHaystack = (container: HTMLDivElement | null): string => {
  const root = container?.querySelector(".netcatty-mdx-content") ?? container;
  if (!root) return "";
  return collectVisibleTextNodes(root).map((node) => node.nodeValue ?? "").join("");
};

export const useNoteFindController = (input: {
  containerRef: React.RefObject<HTMLDivElement | null>;
  enabled: boolean;
  sourceSurface: boolean;
  getSourceEditor: () => NoteSourceEditorHandle | null | undefined;
  getSelectedText: () => string;
  contentKey: string;
}) => {
  const [open, setOpen] = useState(false);
  const [term, setTerm] = useState("");
  const [focusToken, setFocusToken] = useState(0);
  const [matches, setMatches] = useState<NoteFindMatch[]>([]);
  const [currentIndex, setCurrentIndex] = useState(-1);
  const currentIndexRef = useRef(-1);
  const termRef = useRef("");
  const openRef = useRef(false);
  const matchesRef = useRef<NoteFindMatch[]>([]);
  const refreshTimerRef = useRef(0);
  const inputRef = useRef(input);

  currentIndexRef.current = currentIndex;
  termRef.current = term;
  openRef.current = open;
  matchesRef.current = matches;
  inputRef.current = input;

  const close = useCallback(() => {
    setOpen(false);
    setMatches([]);
    setCurrentIndex(-1);
    clearNoteFindHighlights();
  }, []);

  const revealMatch = useCallback((nextMatches: NoteFindMatch[], nextIndex: number) => {
    const current = inputRef.current;
    if (current.sourceSurface) {
      const match = nextMatches[nextIndex];
      if (!match) return;
      current.getSourceEditor()?.revealTextRange(match.start, match.end);
      return;
    }
    const container = current.containerRef.current;
    const root = container?.querySelector(".netcatty-mdx-content") ?? container;
    if (!root) {
      clearNoteFindHighlights();
      return;
    }
    const nodes = collectVisibleTextNodes(root);
    const domMatches = mapStringMatchesToDom(nodes, nextMatches);
    const range = applyNoteFindHighlights(root.ownerDocument, domMatches, nextIndex);
    revealNoteFindRange(range);
  }, []);

  const runSearch = useCallback((nextTerm: string, preferredIndex?: number) => {
    if (!openRef.current) return;
    const current = inputRef.current;
    const haystack = current.sourceSurface
      ? (current.getSourceEditor()?.getValue() ?? "")
      : readRichHaystack(current.containerRef.current);
    const nextMatches = collectStringMatches(haystack, nextTerm);
    const nextIndex = nextMatches.length === 0
      ? -1
      : preferredIndex !== undefined && preferredIndex >= 0 && preferredIndex < nextMatches.length
        ? preferredIndex
        : Math.min(Math.max(currentIndexRef.current, 0), nextMatches.length - 1);
    setMatches(nextMatches);
    setCurrentIndex(nextIndex);
    if (!nextTerm || nextMatches.length === 0) {
      clearNoteFindHighlights();
      return;
    }
    revealMatch(nextMatches, nextIndex);
  }, [revealMatch]);

  const openFind = useCallback(() => {
    if (!inputRef.current.enabled) return;
    const current = inputRef.current;
    const selected = current.getSelectedText().replace(/\s+/g, " ").trim();
    const seed = selected && !selected.includes("\n") ? selected : termRef.current;
    if (seed !== termRef.current) setTerm(seed);
    setOpen(true);
    setFocusToken((token) => token + 1);
    window.setTimeout(() => {
      if (current.sourceSurface && seed) {
        const editor = current.getSourceEditor();
        const haystack = editor?.getValue() ?? "";
        const nextMatches = collectStringMatches(haystack, seed);
        const caret = editor?.getSelectionRange().start ?? 0;
        runSearch(seed, indexOfMatchContainingCaret(nextMatches, caret));
        return;
      }
      runSearch(seed);
    }, 0);
  }, [runSearch]);

  const findNext = useCallback(() => {
    if (!openRef.current) {
      openFind();
      return;
    }
    const nextIndex = advanceNoteFindIndex(currentIndexRef.current, matchesRef.current.length, 1);
    if (nextIndex < 0) return;
    setCurrentIndex(nextIndex);
    revealMatch(matchesRef.current, nextIndex);
  }, [openFind, revealMatch]);

  const findPrevious = useCallback(() => {
    if (!openRef.current) {
      openFind();
      return;
    }
    const nextIndex = advanceNoteFindIndex(currentIndexRef.current, matchesRef.current.length, -1);
    if (nextIndex < 0) return;
    setCurrentIndex(nextIndex);
    revealMatch(matchesRef.current, nextIndex);
  }, [openFind, revealMatch]);

  const handleTermChange = useCallback((nextTerm: string) => {
    setTerm(nextTerm);
    currentIndexRef.current = 0;
    runSearch(nextTerm, 0);
  }, [runSearch]);

  const handleKeyDown = useCallback((event: React.KeyboardEvent | KeyboardEvent): boolean => {
    if (!inputRef.current.enabled) return false;
    const native = "nativeEvent" in event ? event.nativeEvent : event;
    if (handledFindEvents.has(native)) return true;
    const handled = (() => {
      if (isNoteFindOpenKey(native)) {
        event.preventDefault();
        event.stopPropagation();
        native.stopImmediatePropagation?.();
        openFind();
        return true;
      }
      if (!openRef.current) return false;
      if (isNoteFindPreviousKey(native)) {
        event.preventDefault();
        event.stopPropagation();
        native.stopImmediatePropagation?.();
        findPrevious();
        return true;
      }
      if (isNoteFindNextKey(native)) {
        event.preventDefault();
        event.stopPropagation();
        native.stopImmediatePropagation?.();
        findNext();
        return true;
      }
      if (isNoteFindCloseKey(native)) {
        const target = "target" in event ? event.target : null;
        if (
          target
          && typeof (target as { closest?: (selector: string) => Element | null }).closest === "function"
          && (target as Element).closest("[data-note-find-bar]")
        ) {
          return false;
        }
        event.preventDefault();
        event.stopPropagation();
        native.stopImmediatePropagation?.();
        close();
        return true;
      }
      return false;
    })();
    if (handled) handledFindEvents.add(native);
    return handled;
  }, [close, findNext, findPrevious, openFind]);

  useEffect(() => {
    const onWindowKeyDown = (event: KeyboardEvent) => {
      const container = inputRef.current.containerRef.current;
      if (!container) return;
      const target = event.target;
      if (!target || !("nodeType" in target) || !container.contains(target as Node)) return;
      handleKeyDown(event);
    };
    window.addEventListener("keydown", onWindowKeyDown, true);
    return () => window.removeEventListener("keydown", onWindowKeyDown, true);
  }, [handleKeyDown]);

  useEffect(() => {
    if (input.enabled) return;
    close();
  }, [close, input.enabled]);

  useEffect(() => {
    if (!open) return;
    runSearch(termRef.current);
  }, [input.contentKey, input.sourceSurface, open, runSearch]);

  useLayoutEffect(() => {
    if (!open || input.sourceSurface) return;
    if (!term || matches.length === 0) {
      clearNoteFindHighlights();
      return;
    }
    revealMatch(matches, currentIndex);
  }, [currentIndex, input.sourceSurface, matches, open, revealMatch, term]);

  useEffect(() => {
    if (!open || input.sourceSurface) return;
    const container = input.containerRef.current;
    const root = container?.querySelector(".netcatty-mdx-content") ?? container;
    if (!root) return;
    const observer = new MutationObserver(() => {
      window.clearTimeout(refreshTimerRef.current);
      refreshTimerRef.current = window.setTimeout(() => {
        runSearch(termRef.current);
      }, NOTE_FIND_REFRESH_MS);
    });
    observer.observe(root, { subtree: true, childList: true, characterData: true });
    return () => {
      observer.disconnect();
      window.clearTimeout(refreshTimerRef.current);
    };
  }, [input.containerRef, input.sourceSurface, open, runSearch]);

  useEffect(() => () => {
    window.clearTimeout(refreshTimerRef.current);
    clearNoteFindHighlights();
  }, []);

  return {
    open,
    term,
    focusToken,
    matches,
    currentIndex,
    matchCount: !term
      ? null
      : { current: matches.length === 0 ? 0 : currentIndex + 1, total: matches.length },
    close,
    handleTermChange,
    findNext,
    findPrevious,
    handleKeyDown,
  };
};
