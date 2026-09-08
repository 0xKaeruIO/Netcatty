/**
 * Terminal background image (wallpaper) configuration.
 *
 * Pure domain helpers: normalization of persisted settings plus the CSS
 * description of the layer that is painted behind the xterm grid. The image
 * bytes themselves live in the main process (see `terminalBackgroundBridge`);
 * only the opaque asset id is persisted here.
 */

/** How the image is scaled inside the terminal viewport. */
export type TerminalBackgroundFit =
  | 'cover'
  | 'contain'
  | 'stretch'
  | 'tile'
  | 'original';

/** Anchor used for every fit mode except `stretch`. */
export type TerminalBackgroundPosition =
  | 'top-left'
  | 'top'
  | 'top-right'
  | 'left'
  | 'center'
  | 'right'
  | 'bottom-left'
  | 'bottom'
  | 'bottom-right';

export interface TerminalBackgroundImageSettings {
  enabled: boolean;
  /** Asset id returned by the main-process store, or null when unset. */
  imageId: string | null;
  /** Original file name, shown in settings. */
  fileName: string;
  /** Intrinsic size captured at import; 0 when it could not be decoded. */
  naturalWidth: number;
  naturalHeight: number;
  /** Image opacity over the terminal background color. */
  opacity: number;
  fit: TerminalBackgroundFit;
  position: TerminalBackgroundPosition;
  /** Gaussian blur radius in CSS pixels. */
  blur: number;
  /** Zoom factor; only meaningful for `tile` and `original`. */
  scale: number;
}

export const TERMINAL_BACKGROUND_OPACITY_MIN = 0.05;
export const TERMINAL_BACKGROUND_OPACITY_MAX = 1;
export const TERMINAL_BACKGROUND_BLUR_MAX = 24;
export const TERMINAL_BACKGROUND_SCALE_MIN = 0.25;
export const TERMINAL_BACKGROUND_SCALE_MAX = 4;

/** Upper bound accepted by the main-process importer. */
export const TERMINAL_BACKGROUND_MAX_BYTES = 16 * 1024 * 1024;

export const TERMINAL_BACKGROUND_IMAGE_EXTENSIONS = [
  'png',
  'jpg',
  'jpeg',
  'webp',
  'gif',
  'bmp',
  'avif',
] as const;

export const TERMINAL_BACKGROUND_FIT_OPTIONS: readonly TerminalBackgroundFit[] = [
  'cover',
  'contain',
  'stretch',
  'tile',
  'original',
];

export const TERMINAL_BACKGROUND_POSITION_OPTIONS: readonly TerminalBackgroundPosition[] = [
  'top-left',
  'top',
  'top-right',
  'left',
  'center',
  'right',
  'bottom-left',
  'bottom',
  'bottom-right',
];

export const DEFAULT_TERMINAL_BACKGROUND_IMAGE: TerminalBackgroundImageSettings = {
  enabled: false,
  imageId: null,
  fileName: '',
  naturalWidth: 0,
  naturalHeight: 0,
  opacity: 0.25,
  fit: 'cover',
  position: 'center',
  blur: 0,
  scale: 1,
};

const CSS_POSITION: Record<TerminalBackgroundPosition, string> = {
  'top-left': 'left top',
  top: 'center top',
  'top-right': 'right top',
  left: 'left center',
  center: 'center center',
  right: 'right center',
  'bottom-left': 'left bottom',
  bottom: 'center bottom',
  'bottom-right': 'right bottom',
};

const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value));

const readNumber = (value: unknown, fallback: number): number =>
  typeof value === 'number' && Number.isFinite(value) ? value : fallback;

/** Accepts an unknown persisted payload and returns a fully-populated config. */
export function normalizeTerminalBackgroundImage(
  raw?: Partial<TerminalBackgroundImageSettings> | null,
): TerminalBackgroundImageSettings {
  if (!raw || typeof raw !== 'object') return { ...DEFAULT_TERMINAL_BACKGROUND_IMAGE };

  const imageId = typeof raw.imageId === 'string' && raw.imageId.trim() ? raw.imageId.trim() : null;
  const fit = TERMINAL_BACKGROUND_FIT_OPTIONS.includes(raw.fit as TerminalBackgroundFit)
    ? (raw.fit as TerminalBackgroundFit)
    : DEFAULT_TERMINAL_BACKGROUND_IMAGE.fit;
  const position = TERMINAL_BACKGROUND_POSITION_OPTIONS.includes(
    raw.position as TerminalBackgroundPosition,
  )
    ? (raw.position as TerminalBackgroundPosition)
    : DEFAULT_TERMINAL_BACKGROUND_IMAGE.position;

  return {
    enabled: raw.enabled === true && imageId !== null,
    imageId,
    fileName: typeof raw.fileName === 'string' ? raw.fileName.slice(0, 260) : '',
    naturalWidth: Math.max(0, Math.round(readNumber(raw.naturalWidth, 0))),
    naturalHeight: Math.max(0, Math.round(readNumber(raw.naturalHeight, 0))),
    opacity: clamp(
      readNumber(raw.opacity, DEFAULT_TERMINAL_BACKGROUND_IMAGE.opacity),
      TERMINAL_BACKGROUND_OPACITY_MIN,
      TERMINAL_BACKGROUND_OPACITY_MAX,
    ),
    fit,
    position,
    blur: clamp(readNumber(raw.blur, 0), 0, TERMINAL_BACKGROUND_BLUR_MAX),
    scale: clamp(
      readNumber(raw.scale, 1),
      TERMINAL_BACKGROUND_SCALE_MIN,
      TERMINAL_BACKGROUND_SCALE_MAX,
    ),
  };
}

/** True when an image has been picked and the feature is turned on. */
export function isTerminalBackgroundImageConfigured(
  settings?: TerminalBackgroundImageSettings | null,
): boolean {
  return !!settings?.enabled && !!settings.imageId;
}

/** `scale` only changes rendering for the two intrinsic-size fit modes. */
export function terminalBackgroundSupportsScale(fit: TerminalBackgroundFit): boolean {
  return fit === 'tile' || fit === 'original';
}

/** `stretch` and `tile` fill the whole viewport, so the anchor is a no-op. */
export function terminalBackgroundSupportsPosition(fit: TerminalBackgroundFit): boolean {
  return fit !== 'stretch';
}

export interface TerminalBackgroundLayerStyle {
  backgroundImage: string;
  backgroundSize: string;
  backgroundPosition: string;
  backgroundRepeat: string;
  opacity: number;
  filter?: string;
  /** Negative offset that hides the soft edge a blur filter would reveal. */
  inset: string;
}

function resolveBackgroundSize(settings: TerminalBackgroundImageSettings): string {
  switch (settings.fit) {
    case 'cover':
      return 'cover';
    case 'contain':
      return 'contain';
    case 'stretch':
      return '100% 100%';
    case 'tile':
    case 'original': {
      const { naturalWidth, naturalHeight, scale } = settings;
      if (scale === 1 || naturalWidth <= 0 || naturalHeight <= 0) return 'auto';
      return `${Math.round(naturalWidth * scale)}px ${Math.round(naturalHeight * scale)}px`;
    }
  }
}

/**
 * Build the inline style for the layer painted between the terminal background
 * color and the (transparent) xterm grid.
 */
export function resolveTerminalBackgroundLayerStyle(
  settings: TerminalBackgroundImageSettings,
  imageUrl: string,
): TerminalBackgroundLayerStyle {
  const blur = clamp(settings.blur, 0, TERMINAL_BACKGROUND_BLUR_MAX);
  return {
    backgroundImage: `url("${imageUrl.replace(/"/g, '\\"')}")`,
    backgroundSize: resolveBackgroundSize(settings),
    backgroundPosition: CSS_POSITION[settings.position],
    backgroundRepeat: settings.fit === 'tile' ? 'repeat' : 'no-repeat',
    opacity: clamp(
      settings.opacity,
      TERMINAL_BACKGROUND_OPACITY_MIN,
      TERMINAL_BACKGROUND_OPACITY_MAX,
    ),
    filter: blur > 0 ? `blur(${blur}px)` : undefined,
    inset: blur > 0 ? `${-Math.ceil(blur * 2)}px` : '0',
  };
}
