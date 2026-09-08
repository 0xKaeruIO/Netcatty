const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const bridge = require("./terminalBackgroundBridge.cjs");

const PNG_BYTES = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.alloc(64, 7),
]);
const JPEG_BYTES = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(32, 3)]);

function withStore(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "netcatty-bg-"));
  bridge.__setUserDataResolverForTests(() => root);
  t.after(() => {
    bridge.__setUserDataResolverForTests(null);
    fs.rmSync(root, { recursive: true, force: true });
  });
  return root;
}

function writeSource(root, name, bytes) {
  const sourcePath = path.join(root, name);
  fs.writeFileSync(sourcePath, bytes);
  return sourcePath;
}

test("import copies an image into the store and reads it back", async (t) => {
  const root = withStore(t);

  const result = await bridge.importImage(writeSource(root, "wall.png", PNG_BYTES));

  assert.equal(result.ok, true);
  assert.equal(result.image.fileName, "wall.png");
  assert.equal(result.image.mediaType, "image/png");
  assert.equal(result.image.byteLength, PNG_BYTES.length);
  assert.match(result.image.id, /^[a-f0-9]{32}\.png$/);

  const asset = await bridge.readImage(result.image.id);
  assert.equal(asset.mediaType, "image/png");
  assert.deepEqual(Buffer.from(asset.data), PNG_BYTES);
});

test("import is content addressed so re-importing the same bytes reuses one file", async (t) => {
  const root = withStore(t);

  const first = await bridge.importImage(writeSource(root, "a.png", PNG_BYTES));
  const second = await bridge.importImage(writeSource(root, "b.png", PNG_BYTES));

  assert.equal(first.image.id, second.image.id);
  assert.equal(second.image.fileName, "b.png");
  const stored = fs.readdirSync(path.join(root, "terminal-backgrounds"));
  assert.deepEqual(stored, [first.image.id]);
});

test("the stored extension comes from the signature, not the source name", async (t) => {
  const root = withStore(t);

  const result = await bridge.importImage(writeSource(root, "actually-a-jpeg.png", JPEG_BYTES));

  assert.equal(result.ok, true);
  assert.match(result.image.id, /\.jpg$/);
  assert.equal(result.image.mediaType, "image/jpeg");
});

test("import rejects files that are not a supported image", async (t) => {
  const root = withStore(t);

  const result = await bridge.importImage(writeSource(root, "notes.txt", Buffer.from("hello")));

  assert.equal(result.ok, false);
  assert.match(result.error, /Unsupported image format/);
});

test("import rejects an oversized file without copying it", async (t) => {
  const root = withStore(t);
  const huge = Buffer.concat([PNG_BYTES, Buffer.alloc(bridge.MAX_IMAGE_BYTES, 1)]);

  const result = await bridge.importImage(writeSource(root, "huge.png", huge));

  assert.equal(result.ok, false);
  assert.match(result.error, /larger than/);
  assert.equal(fs.existsSync(path.join(root, "terminal-backgrounds")), false);
});

test("read refuses ids that try to escape the store directory", async (t) => {
  const root = withStore(t);
  await bridge.importImage(writeSource(root, "wall.png", PNG_BYTES));

  assert.equal(await bridge.readImage("../../secret.png"), null);
  assert.equal(await bridge.readImage("wall.png"), null);
  assert.equal(await bridge.readImage(""), null);
  assert.equal(await bridge.readImage(null), null);
});

test("prune deletes every stored image except the ones still referenced", async (t) => {
  const root = withStore(t);
  const keep = await bridge.importImage(writeSource(root, "keep.png", PNG_BYTES));
  const drop = await bridge.importImage(writeSource(root, "drop.jpg", JPEG_BYTES));

  const { deletedCount } = await bridge.pruneImages([keep.image.id]);

  assert.equal(deletedCount, 1);
  assert.notEqual(await bridge.readImage(keep.image.id), null);
  assert.equal(await bridge.readImage(drop.image.id), null);
});

test("prune with no referenced ids empties the store", async (t) => {
  const root = withStore(t);
  await bridge.importImage(writeSource(root, "wall.png", PNG_BYTES));

  await bridge.pruneImages([]);

  assert.deepEqual(fs.readdirSync(path.join(root, "terminal-backgrounds")), []);
});
