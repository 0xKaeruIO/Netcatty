/**
 * Renderer-side access to stored terminal background images.
 *
 * The bytes live in the main process; this module turns an asset id into a
 * process-lifetime object URL and caches it so every terminal pane shares one
 * decoded copy of the wallpaper.
 */

import { useEffect, useState } from 'react';

import { netcattyBridge } from './netcattyBridge';

export interface ImportedTerminalBackgroundImage {
  id: string;
  fileName: string;
  mediaType: string;
  byteLength: number;
  objectUrl: string;
  naturalWidth: number;
  naturalHeight: number;
}

type CacheEntry = {
  objectUrl: string | null;
  promise: Promise<string | null>;
};

const cache = new Map<string, CacheEntry>();
const listeners = new Set<() => void>();

const bridge = () => netcattyBridge.get();

function notifyListeners(): void {
  for (const listener of [...listeners]) listener();
}

async function decodeNaturalSize(objectUrl: string): Promise<{ width: number; height: number }> {
  if (typeof Image === 'undefined') return { width: 0, height: 0 };
  return new Promise((resolve) => {
    const image = new Image();
    image.onload = () => resolve({ width: image.naturalWidth, height: image.naturalHeight });
    image.onerror = () => resolve({ width: 0, height: 0 });
    image.src = objectUrl;
  });
}

function loadObjectUrl(imageId: string): Promise<string | null> {
  const cached = cache.get(imageId);
  if (cached) return cached.promise;

  const promise = (async () => {
    const asset = await bridge()?.readTerminalBackgroundImage?.(imageId);
    if (!asset?.data) return null;
    const blob = new Blob([new Uint8Array(asset.data)], { type: asset.mediaType });
    return URL.createObjectURL(blob);
  })()
    .catch(() => null)
    .then((objectUrl) => {
      const entry = cache.get(imageId);
      if (entry) entry.objectUrl = objectUrl;
      if (objectUrl) notifyListeners();
      return objectUrl;
    });

  cache.set(imageId, { objectUrl: null, promise });
  return promise;
}

export type ImportTerminalBackgroundResult =
  | { ok: true; image: ImportedTerminalBackgroundImage; error?: undefined }
  | { ok: false; image?: undefined; error?: string };

/** Copy a picked file into the store and return a ready-to-preview asset. */
export async function importTerminalBackgroundImage(
  sourcePath: string,
): Promise<ImportTerminalBackgroundResult> {
  const result = await bridge()?.importTerminalBackgroundImage?.(sourcePath);
  if (!result?.ok || !result.image) {
    return { ok: false, error: result?.error };
  }

  const objectUrl = await loadObjectUrl(result.image.id);
  if (!objectUrl) return { ok: false };

  const { width, height } = await decodeNaturalSize(objectUrl);
  return {
    ok: true,
    image: { ...result.image, objectUrl, naturalWidth: width, naturalHeight: height },
  };
}

/** Drop every stored image except the one still referenced by settings. */
export async function pruneTerminalBackgroundImages(keepId: string | null): Promise<void> {
  await bridge()?.pruneTerminalBackgroundImages?.(keepId ? [keepId] : []);
  for (const [id, entry] of [...cache]) {
    if (id === keepId) continue;
    if (entry.objectUrl) URL.revokeObjectURL(entry.objectUrl);
    cache.delete(id);
  }
}

/**
 * Resolve the object URL for a stored image, or null while it is still loading
 * or when no image is selected.
 */
export function useTerminalBackgroundImageUrl(imageId: string | null): string | null {
  const [objectUrl, setObjectUrl] = useState<string | null>(
    () => (imageId ? cache.get(imageId)?.objectUrl ?? null : null),
  );

  useEffect(() => {
    if (!imageId) {
      setObjectUrl(null);
      return;
    }

    let active = true;
    const sync = () => {
      if (active) setObjectUrl(cache.get(imageId)?.objectUrl ?? null);
    };

    listeners.add(sync);
    void loadObjectUrl(imageId).then(sync);
    sync();

    return () => {
      active = false;
      listeners.delete(sync);
    };
  }, [imageId]);

  return imageId ? objectUrl : null;
}

/** Test seam: forget cached object URLs. */
export function resetTerminalBackgroundImageCacheForTests(): void {
  for (const entry of cache.values()) {
    if (entry.objectUrl) URL.revokeObjectURL(entry.objectUrl);
  }
  cache.clear();
  listeners.clear();
}
