import { memo, useMemo } from 'react';

import type { TerminalBackgroundImageSettings } from '../../domain/terminalBackgroundImage';
import { resolveTerminalBackgroundLayerStyle } from '../../domain/terminalBackgroundImage';

/**
 * Wallpaper painted between the terminal background color and the xterm grid.
 *
 * The outer element matches the `xterm-container` geometry and clips the inner
 * image, which is oversized when a blur radius is set so the softened edge
 * never reveals the flat background underneath.
 */
function TerminalBackgroundLayerInner({
  settings,
  imageUrl,
  top,
  left,
  right,
  bottom,
}: {
  settings: TerminalBackgroundImageSettings;
  imageUrl: string;
  top: number;
  left: number;
  right: number;
  bottom: number;
}) {
  const { inset, ...layerStyle } = useMemo(
    () => resolveTerminalBackgroundLayerStyle(settings, imageUrl),
    [settings, imageUrl],
  );

  return (
    <div
      aria-hidden="true"
      data-terminal-background-layer="true"
      className="pointer-events-none absolute overflow-hidden"
      style={{ top, left, right, bottom }}
    >
      <div className="absolute" style={{ ...layerStyle, inset }} />
    </div>
  );
}

export const TerminalBackgroundLayer = memo(TerminalBackgroundLayerInner);
