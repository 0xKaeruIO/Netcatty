import assert from 'node:assert/strict';
import test from 'node:test';

import {
  DEFAULT_TERMINAL_BACKGROUND_IMAGE,
  isTerminalBackgroundImageConfigured,
  normalizeTerminalBackgroundImage,
  resolveTerminalBackgroundLayerStyle,
  terminalBackgroundSupportsPosition,
  terminalBackgroundSupportsScale,
} from './terminalBackgroundImage';

const configured = normalizeTerminalBackgroundImage({
  enabled: true,
  imageId: 'abc.png',
  fileName: 'wall.png',
  naturalWidth: 800,
  naturalHeight: 600,
});

test('normalize falls back to defaults for missing input', () => {
  assert.deepEqual(normalizeTerminalBackgroundImage(null), DEFAULT_TERMINAL_BACKGROUND_IMAGE);
  assert.deepEqual(normalizeTerminalBackgroundImage(undefined), DEFAULT_TERMINAL_BACKGROUND_IMAGE);
});

test('normalize cannot enable the wallpaper without an image', () => {
  const settings = normalizeTerminalBackgroundImage({ enabled: true, imageId: null });
  assert.equal(settings.enabled, false);
  assert.equal(isTerminalBackgroundImageConfigured(settings), false);
});

test('normalize keeps the image id when the wallpaper is toggled off', () => {
  const settings = normalizeTerminalBackgroundImage({ enabled: false, imageId: 'abc.png' });
  assert.equal(settings.imageId, 'abc.png');
  assert.equal(isTerminalBackgroundImageConfigured(settings), false);
});

test('normalize allows fully transparent wallpaper opacity', () => {
  const settings = normalizeTerminalBackgroundImage({ opacity: 0 });
  assert.equal(settings.opacity, 0);
});

test('normalize clamps opacity, blur and scale into their supported ranges', () => {
  const low = normalizeTerminalBackgroundImage({ opacity: -1, blur: -5, scale: 0.01 });
  assert.equal(low.opacity, 0);
  assert.equal(low.blur, 0);
  assert.equal(low.scale, 0.25);

  const high = normalizeTerminalBackgroundImage({ opacity: 4, blur: 999, scale: 99 });
  assert.equal(high.opacity, 1);
  assert.equal(high.blur, 24);
  assert.equal(high.scale, 4);
});

test('normalize rejects unknown fit and position values', () => {
  const settings = normalizeTerminalBackgroundImage({
    fit: 'diagonal' as never,
    position: 'nowhere' as never,
  });
  assert.equal(settings.fit, 'cover');
  assert.equal(settings.position, 'center');
});

test('normalize discards non-finite numbers instead of persisting NaN', () => {
  const settings = normalizeTerminalBackgroundImage({
    opacity: Number.NaN,
    naturalWidth: Number.POSITIVE_INFINITY,
  });
  assert.equal(settings.opacity, DEFAULT_TERMINAL_BACKGROUND_IMAGE.opacity);
  assert.equal(settings.naturalWidth, 0);
});

test('cover and stretch map to the expected background-size', () => {
  assert.equal(
    resolveTerminalBackgroundLayerStyle({ ...configured, fit: 'cover' }, 'blob:x').backgroundSize,
    'cover',
  );
  assert.equal(
    resolveTerminalBackgroundLayerStyle({ ...configured, fit: 'stretch' }, 'blob:x').backgroundSize,
    '100% 100%',
  );
});

test('zoom scales the intrinsic size for tile and original fit', () => {
  const tiled = resolveTerminalBackgroundLayerStyle(
    { ...configured, fit: 'tile', scale: 0.5 },
    'blob:x',
  );
  assert.equal(tiled.backgroundSize, '400px 300px');
  assert.equal(tiled.backgroundRepeat, 'repeat');

  // Zoom cannot be applied without a decoded intrinsic size.
  const unknownSize = resolveTerminalBackgroundLayerStyle(
    { ...configured, fit: 'original', naturalWidth: 0, naturalHeight: 0, scale: 2 },
    'blob:x',
  );
  assert.equal(unknownSize.backgroundSize, 'auto');
});

test('blur oversizes the layer so the softened edge stays hidden', () => {
  const sharp = resolveTerminalBackgroundLayerStyle({ ...configured, blur: 0 }, 'blob:x');
  assert.equal(sharp.filter, undefined);
  assert.equal(sharp.inset, '0');

  const blurred = resolveTerminalBackgroundLayerStyle({ ...configured, blur: 8 }, 'blob:x');
  assert.equal(blurred.filter, 'blur(8px)');
  assert.equal(blurred.inset, '-16px');
});

test('image urls containing quotes stay escaped inside the css url()', () => {
  const style = resolveTerminalBackgroundLayerStyle(configured, 'blob:a"); color: red; x: url("b');
  assert.equal(style.backgroundImage, 'url("blob:a\\"); color: red; x: url(\\"b")');
  // Every inner quote is backslash-escaped, so none can close the url() early.
  assert.equal(/(^|[^\\])"/.test(style.backgroundImage.slice(5, -2)), false);
});

test('advanced controls are gated by the fit mode they affect', () => {
  assert.equal(terminalBackgroundSupportsScale('tile'), true);
  assert.equal(terminalBackgroundSupportsScale('original'), true);
  assert.equal(terminalBackgroundSupportsScale('cover'), false);

  assert.equal(terminalBackgroundSupportsPosition('cover'), true);
  assert.equal(terminalBackgroundSupportsPosition('stretch'), false);
});
