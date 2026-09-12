import type { ITheme, Terminal } from '@xterm/xterm';
import type { TerminalTheme } from '../../domain/models';
import { forceSyncRenderAfterResize } from './terminalHelpers';

type PendingUpdate = {
  theme: TerminalTheme;
  transparentBackground: boolean;
  getTerminal: () => Terminal | null;
};

const pendingBySession = new Map<string, PendingUpdate>();
let flushScheduled = false;

/** xterm paints this over the wallpaper layer, so it must be fully see-through. */
const TRANSPARENT_BACKGROUND = 'rgba(0, 0, 0, 0)';

function themeFingerprint(theme: TerminalTheme, transparentBackground: boolean): string {
  return `${theme.id}:${theme.colors.background}:${theme.colors.foreground}:${theme.colors.cursor}:${transparentBackground}`;
}

/** Single source of truth for the `ITheme` handed to xterm. */
export function buildXtermTheme(theme: TerminalTheme, transparentBackground = false): ITheme {
  return {
    ...theme.colors,
    ...(transparentBackground ? { background: TRANSPARENT_BACKGROUND } : {}),
    selectionBackground: theme.colors.selection,
    scrollbarSliderBackground: theme.colors.foreground + '33',
    scrollbarSliderHoverBackground: theme.colors.foreground + '66',
    scrollbarSliderActiveBackground: theme.colors.foreground + '80',
  };
}

const appliedThemes = new WeakMap<Terminal, string>();

function applyThemeToTerminal(
  term: Terminal,
  theme: TerminalTheme,
  transparentBackground: boolean,
): void {
  const xtermTheme = buildXtermTheme(theme, transparentBackground);
  const applied = `${transparentBackground}|${JSON.stringify(xtermTheme)}`;
  // Focus and visibility changes re-run the theme effect with an unchanged
  // theme. Re-assigning it would force another full-grid repaint, which a
  // transparent grid cannot absorb without the glyphs flashing brighter.
  if (appliedThemes.get(term) === applied) return;
  appliedThemes.set(term, applied);

  // Flipping allowTransparency rebuilds the renderer, so only touch it on a
  // real change (wallpaper turned on or off).
  if (term.options.allowTransparency !== transparentBackground) {
    term.options.allowTransparency = transparentBackground;
  }
  term.options.theme = xtermTheme;
  forceSyncRenderAfterResize(term);
}

export function applyTerminalThemeSync(
  term: Terminal,
  theme: TerminalTheme,
  transparentBackground = false,
): void {
  applyThemeToTerminal(term, theme, transparentBackground);
}

function flushPendingUpdates(): void {
  flushScheduled = false;
  const entries = [...pendingBySession.entries()];
  pendingBySession.clear();

  for (const [, update] of entries) {
    const term = update.getTerminal();
    if (!term) continue;
    applyThemeToTerminal(term, update.theme, update.transparentBackground);
  }
}

export function cancelTerminalThemeUpdate(sessionId: string): void {
  pendingBySession.delete(sessionId);
}

export function scheduleTerminalThemeUpdate(
  sessionId: string,
  theme: TerminalTheme,
  _options: { visible: boolean; focused: boolean },
  getTerminal: () => Terminal | null,
  transparentBackground = false,
): void {
  const existing = pendingBySession.get(sessionId);
  if (
    existing
    && themeFingerprint(existing.theme, existing.transparentBackground)
      === themeFingerprint(theme, transparentBackground)
  ) {
    pendingBySession.set(sessionId, {
      theme,
      transparentBackground,
      getTerminal,
    });
  } else {
    pendingBySession.set(sessionId, {
      theme,
      transparentBackground,
      getTerminal,
    });
  }

  if (flushScheduled) return;
  flushScheduled = true;
  queueMicrotask(flushPendingUpdates);
}

export function resetTerminalThemeSchedulerForTests(): void {
  pendingBySession.clear();
  flushScheduled = false;
}
