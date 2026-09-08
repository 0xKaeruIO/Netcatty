import { useCallback, useState } from 'react';

import { TERMINAL_BACKGROUND_IMAGE_EXTENSIONS } from '../../domain/terminalBackgroundImage';
import { netcattyBridge } from '../../infrastructure/services/netcattyBridge';
import {
  importTerminalBackgroundImage,
  pruneTerminalBackgroundImages,
  useTerminalBackgroundImageUrl as useStoredTerminalBackgroundImageUrl,
  type ImportedTerminalBackgroundImage,
} from '../../infrastructure/services/terminalBackgroundImageService';

/**
 * Resolve the displayable URL for a stored terminal wallpaper. Returns null
 * while the image loads or when no image is selected.
 */
export function useTerminalBackgroundImageUrl(imageId: string | null): string | null {
  return useStoredTerminalBackgroundImageUrl(imageId);
}

export type TerminalBackgroundPickResult =
  | { status: 'cancelled' }
  | { status: 'imported'; image: ImportedTerminalBackgroundImage }
  | { status: 'error'; error?: string };

export interface TerminalBackgroundImagePicker {
  isPicking: boolean;
  /** Open the OS file picker and copy the chosen image into Netcatty's store. */
  pickImage: (labels: { dialogTitle: string; filterLabel: string }) => Promise<TerminalBackgroundPickResult>;
  /** Forget the stored image and delete its bytes from disk. */
  clearImage: () => Promise<void>;
}

export function useTerminalBackgroundImagePicker(): TerminalBackgroundImagePicker {
  const [isPicking, setIsPicking] = useState(false);

  const pickImage = useCallback(async (
    { dialogTitle, filterLabel }: { dialogTitle: string; filterLabel: string },
  ): Promise<TerminalBackgroundPickResult> => {
    setIsPicking(true);
    try {
      const sourcePath = await netcattyBridge.get()?.selectFile?.(
        dialogTitle,
        undefined,
        [{ name: filterLabel, extensions: [...TERMINAL_BACKGROUND_IMAGE_EXTENSIONS] }],
      );
      if (!sourcePath) return { status: 'cancelled' };

      const result = await importTerminalBackgroundImage(sourcePath);
      if (!result.ok) return { status: 'error', error: result.error };

      // Only one wallpaper is referenced at a time; drop the previous bytes.
      await pruneTerminalBackgroundImages(result.image.id);
      return { status: 'imported', image: result.image };
    } catch (error) {
      return { status: 'error', error: error instanceof Error ? error.message : undefined };
    } finally {
      setIsPicking(false);
    }
  }, []);

  const clearImage = useCallback(async () => {
    await pruneTerminalBackgroundImages(null);
  }, []);

  return { isPicking, pickImage, clearImage };
}
