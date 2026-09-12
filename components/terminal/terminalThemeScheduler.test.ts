import assert from 'node:assert/strict';
import test from 'node:test';

import {
  applyTerminalThemeSync,
  buildXtermTheme,
  cancelTerminalThemeUpdate,
  resetTerminalThemeSchedulerForTests,
  scheduleTerminalThemeUpdate,
} from './terminalThemeScheduler';
import type { TerminalTheme } from '../../domain/models';

const theme = (id: string): TerminalTheme => ({
  id,
  name: id,
  type: 'dark',
  colors: {
    background: '#111111',
    foreground: '#eeeeee',
    cursor: '#22aaff',
    selection: '#22aaff44',
    black: '#000',
    red: '#000',
    green: '#000',
    yellow: '#000',
    blue: '#000',
    magenta: '#000',
    cyan: '#000',
    white: '#fff',
    brightBlack: '#000',
    brightRed: '#000',
    brightGreen: '#000',
    brightYellow: '#000',
    brightBlue: '#000',
    brightMagenta: '#000',
    brightCyan: '#000',
    brightWhite: '#fff',
  },
});

test('cancelTerminalThemeUpdate drops a pending hidden-pane theme flush', async () => {
  resetTerminalThemeSchedulerForTests();
  let appliedThemeId: string | null = null;
  const fakeTerm = {
    options: { theme: {} as Record<string, string> },
  };

  scheduleTerminalThemeUpdate(
    'session-1',
    theme('old-theme'),
    { visible: false, focused: false },
    () => fakeTerm as never,
  );

  cancelTerminalThemeUpdate('session-1');

  await new Promise<void>((resolve) => {
    if (typeof requestIdleCallback === 'function') {
      requestIdleCallback(() => resolve());
      return;
    }
    setTimeout(resolve, 0);
  });

  appliedThemeId = fakeTerm.options.theme.background ?? null;
  assert.equal(appliedThemeId, null);
});

test('hidden terminal theme updates do not wait for browser idle time', async () => {
  resetTerminalThemeSchedulerForTests();
  const fakeTerm = {
    options: { theme: {} as Record<string, string> },
  };

  scheduleTerminalThemeUpdate(
    'session-2',
    theme('new-theme'),
    { visible: false, focused: false },
    () => fakeTerm as never,
  );

  await Promise.resolve();
  assert.equal(fakeTerm.options.theme.background, '#111111');
});

test('buildXtermTheme keeps the theme background unless a wallpaper is shown', () => {
  assert.equal(buildXtermTheme(theme('opaque')).background, '#111111');
  assert.equal(buildXtermTheme(theme('opaque'), false).background, '#111111');
  assert.equal(buildXtermTheme(theme('wallpaper'), true).background, 'rgba(0, 0, 0, 0)');
});

test('a wallpaper turns on xterm transparency and clears its background fill', () => {
  resetTerminalThemeSchedulerForTests();
  const fakeTerm = {
    options: { allowTransparency: false, theme: {} as Record<string, string> },
  };

  applyTerminalThemeSync(fakeTerm as never, theme('wallpaper'), true);
  assert.equal(fakeTerm.options.allowTransparency, true);
  assert.equal(fakeTerm.options.theme.background, 'rgba(0, 0, 0, 0)');
  // Non-background colors still come from the terminal theme.
  assert.equal(fakeTerm.options.theme.foreground, '#eeeeee');

  applyTerminalThemeSync(fakeTerm as never, theme('wallpaper'), false);
  assert.equal(fakeTerm.options.allowTransparency, false);
  assert.equal(fakeTerm.options.theme.background, '#111111');
});

test('re-applying an unchanged theme does not touch xterm again', () => {
  resetTerminalThemeSchedulerForTests();
  let themeWrites = 0;
  const fakeTerm = {
    options: {
      allowTransparency: false,
      _theme: {} as Record<string, string>,
      get theme() {
        return this._theme;
      },
      set theme(value: Record<string, string>) {
        themeWrites += 1;
        this._theme = value;
      },
    },
  };

  applyTerminalThemeSync(fakeTerm as never, theme('wallpaper'), true);
  assert.equal(themeWrites, 1);

  // Focus / visibility churn re-runs the effect with the same theme. A second
  // write would force another full-grid repaint and flash a transparent grid.
  applyTerminalThemeSync(fakeTerm as never, theme('wallpaper'), true);
  assert.equal(themeWrites, 1);

  // A real change still gets through.
  applyTerminalThemeSync(fakeTerm as never, theme('wallpaper'), false);
  assert.equal(themeWrites, 2);
  assert.equal(fakeTerm.options.theme.background, '#111111');
});

test('scheduled hidden-pane updates carry the transparency flag', async () => {
  resetTerminalThemeSchedulerForTests();
  const fakeTerm = {
    options: { allowTransparency: false, theme: {} as Record<string, string> },
  };

  scheduleTerminalThemeUpdate(
    'session-3',
    theme('wallpaper'),
    { visible: false, focused: false },
    () => fakeTerm as never,
    true,
  );

  await Promise.resolve();
  assert.equal(fakeTerm.options.allowTransparency, true);
  assert.equal(fakeTerm.options.theme.background, 'rgba(0, 0, 0, 0)');
});
