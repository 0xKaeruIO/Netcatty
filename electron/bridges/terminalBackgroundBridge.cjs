/**
 * Terminal Background Bridge - stores terminal wallpaper images.
 *
 * Images are copied into a dedicated folder under userData and addressed by a
 * content hash. Only the opaque asset id is persisted in renderer settings, so
 * the picked file can move or disappear without breaking the wallpaper.
 */

"use strict";

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

const STORE_DIR_NAME = "terminal-backgrounds";
const MAX_IMAGE_BYTES = 16 * 1024 * 1024;
const ASSET_ID_PATTERN = /^[a-f0-9]{32}\.[a-z0-9]{3,4}$/;

// Extension is derived from the sniffed signature, never from the source name,
// so a mislabeled file cannot be stored under a type it is not.
const IMAGE_SIGNATURES = [
  { ext: "png", mediaType: "image/png", test: b => b.length > 8 && b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) },
  { ext: "jpg", mediaType: "image/jpeg", test: b => b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  { ext: "gif", mediaType: "image/gif", test: b => b.length > 6 && (b.subarray(0, 6).toString("latin1") === "GIF87a" || b.subarray(0, 6).toString("latin1") === "GIF89a") },
  { ext: "bmp", mediaType: "image/bmp", test: b => b.length > 2 && b[0] === 0x42 && b[1] === 0x4d },
  { ext: "webp", mediaType: "image/webp", test: b => b.length > 12 && b.subarray(0, 4).toString("latin1") === "RIFF" && b.subarray(8, 12).toString("latin1") === "WEBP" },
  { ext: "avif", mediaType: "image/avif", test: b => b.length > 12 && b.subarray(4, 8).toString("latin1") === "ftyp" && ["avif", "avis"].includes(b.subarray(8, 12).toString("latin1")) },
];

let resolveUserDataDir = null;

function detectImageType(buffer) {
  return IMAGE_SIGNATURES.find(signature => signature.test(buffer)) ?? null;
}

function getStoreDir() {
  if (typeof resolveUserDataDir !== "function") {
    throw new Error("Terminal background store is not initialized.");
  }
  const dir = path.join(resolveUserDataDir(), STORE_DIR_NAME);
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  return dir;
}

function resolveAssetPath(id) {
  if (typeof id !== "string" || !ASSET_ID_PATTERN.test(id)) return null;
  return path.join(getStoreDir(), id);
}

async function readSourceImage(sourcePath) {
  if (typeof sourcePath !== "string" || !sourcePath) {
    return { ok: false, error: "No image file was selected." };
  }
  let handle;
  try {
    handle = await fs.promises.open(sourcePath, fs.constants.O_RDONLY);
    const stat = await handle.stat();
    if (!stat.isFile()) return { ok: false, error: "Selected path is not a file." };
    if (stat.size === 0) return { ok: false, error: "Selected image is empty." };
    if (stat.size > MAX_IMAGE_BYTES) {
      return { ok: false, error: `Image is larger than ${Math.round(MAX_IMAGE_BYTES / (1024 * 1024))} MB.` };
    }
    return { ok: true, buffer: await handle.readFile() };
  } catch (error) {
    return { ok: false, error: error?.message || "Unable to read the selected image." };
  } finally {
    await handle?.close().catch(() => {});
  }
}

async function importImage(sourcePath) {
  const source = await readSourceImage(sourcePath);
  if (!source.ok) return source;

  const signature = detectImageType(source.buffer);
  if (!signature) {
    return { ok: false, error: "Unsupported image format. Use PNG, JPEG, WebP, GIF, BMP or AVIF." };
  }

  const id = `${crypto.createHash("sha256").update(source.buffer).digest("hex").slice(0, 32)}.${signature.ext}`;
  const targetPath = path.join(getStoreDir(), id);
  try {
    // Content-addressed: an identical re-import reuses the stored copy.
    await fs.promises.writeFile(targetPath, source.buffer, { mode: 0o600, flag: "wx" });
  } catch (error) {
    if (error?.code !== "EEXIST") {
      return { ok: false, error: error?.message || "Unable to save the image." };
    }
  }

  return {
    ok: true,
    image: {
      id,
      fileName: path.basename(sourcePath).slice(0, 260),
      mediaType: signature.mediaType,
      byteLength: source.buffer.length,
    },
  };
}

async function readImage(id) {
  const assetPath = resolveAssetPath(id);
  if (!assetPath) return null;
  let handle;
  try {
    const noFollow = fs.constants.O_NOFOLLOW ?? 0;
    handle = await fs.promises.open(assetPath, fs.constants.O_RDONLY | noFollow);
    const stat = await handle.stat();
    if (!stat.isFile() || stat.size > MAX_IMAGE_BYTES) return null;
    const buffer = await handle.readFile();
    const signature = detectImageType(buffer);
    if (!signature) return null;
    return { id, mediaType: signature.mediaType, data: new Uint8Array(buffer) };
  } catch {
    return null;
  } finally {
    await handle?.close().catch(() => {});
  }
}

async function removeImage(id) {
  const assetPath = resolveAssetPath(id);
  if (!assetPath) return { ok: false };
  try {
    await fs.promises.unlink(assetPath);
    return { ok: true };
  } catch (error) {
    return { ok: error?.code === "ENOENT" };
  }
}

/** Drop stored images the renderer no longer references. */
async function pruneImages(keepIds) {
  const keep = new Set(Array.isArray(keepIds) ? keepIds.filter(id => ASSET_ID_PATTERN.test(id)) : []);
  let deletedCount = 0;
  try {
    for (const file of await fs.promises.readdir(getStoreDir())) {
      if (!ASSET_ID_PATTERN.test(file) || keep.has(file)) continue;
      if ((await removeImage(file)).ok) deletedCount += 1;
    }
  } catch {
    // Pruning is best-effort housekeeping.
  }
  return { deletedCount };
}

function registerHandlers(ipcMain, electronModule) {
  resolveUserDataDir = () => electronModule.app.getPath("userData");

  ipcMain.handle("netcatty:terminalBackground:import", (_event, payload = {}) =>
    importImage(payload.sourcePath));

  ipcMain.handle("netcatty:terminalBackground:read", (_event, payload = {}) =>
    readImage(payload.id));

  ipcMain.handle("netcatty:terminalBackground:remove", (_event, payload = {}) =>
    removeImage(payload.id));

  ipcMain.handle("netcatty:terminalBackground:prune", (_event, payload = {}) =>
    pruneImages(payload.keepIds));
}

module.exports = {
  registerHandlers,
  detectImageType,
  importImage,
  readImage,
  removeImage,
  pruneImages,
  MAX_IMAGE_BYTES,
  ASSET_ID_PATTERN,
  /** Test seam: point the store at a scratch directory. */
  __setUserDataResolverForTests(resolver) {
    resolveUserDataDir = resolver;
  },
};
