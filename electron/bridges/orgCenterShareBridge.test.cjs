const test = require("node:test");
const assert = require("node:assert/strict");

const {
  normalizeBaseUrl,
  toWebSocketUrl,
  encodePayload,
  decodePayload,
  createRingBuffer,
  registerHandlers,
} = require("./orgCenterShareBridge.cjs");

test("share websocket url uses ws and room path", () => {
  assert.equal(
    toWebSocketUrl("http://10.0.0.1:4780/", "abc", "host", "tok"),
    "ws://10.0.0.1:4780/ws/v1/share/abc?role=host&token=tok",
  );
  assert.match(
    toWebSocketUrl("https://center.example", "r1", "guest", "g"),
    /^wss:\/\/center\.example\/ws\/v1\/share\/r1\?/,
  );
});

test("ring buffer keeps a bounded snapshot", () => {
  const ring = createRingBuffer(8);
  ring.push("abcd");
  ring.push("efghij");
  const snap = ring.snapshot();
  assert.ok(snap.length <= 12);
  assert.ok(snap.endsWith("efghij") || snap.includes("efgh"));
});

test("payload round-trips ansi bytes", () => {
  const raw = "\x1b[31mhi\x1b[0m";
  assert.equal(decodePayload(encodePayload(raw)), raw);
});

test("normalizeBaseUrl rejects bad urls", () => {
  assert.throws(() => normalizeBaseUrl(""), /required/i);
  assert.throws(() => normalizeBaseUrl("ftp://x"), /http/i);
});

test("share start failure does not register a host share", async () => {
  const ipcMain = {
    handle(channel, fn) { this[channel] = fn; },
    on() {},
  };
  registerHandlers(ipcMain, {});
  await assert.rejects(
    () => ipcMain["netcatty:orgCenterShare:start"]({}, { sessionId: "s1", url: "not-a-url" }),
  );
});

test("share tap and guest input failures do not throw into session write", async () => {
  const writes = [];
  const closed = [];
  const ipcMain = {
    handle(channel, fn) { this[channel] = fn; },
    on(channel, fn) { this[channel] = fn; },
  };
  registerHandlers(ipcMain, {
    terminalWorkerManager: {
      send(channel, payload) {
        writes.push({ channel, payload });
        throw new Error("worker write exploded");
      },
      addOutputTap() { return () => {}; },
    },
    terminalBridge: {
      writeToSession() { throw new Error("ssh write exploded"); },
      closeSession() { closed.push("ssh"); },
    },
  });

  assert.doesNotThrow(() => {
    ipcMain["netcatty:orgCenterShare:guestInput"]({}, { sessionId: "missing", data: "x" });
  });
  const left = await ipcMain["netcatty:orgCenterShare:leave"]({}, { sessionId: "missing" });
  assert.equal(left.left, false);
  assert.deepEqual(closed, []);
  assert.deepEqual(writes, []);
});

test("guest leave does not close an SSH session", async () => {
  const closed = [];
  const ipcMain = {
    handle(channel, fn) { this[channel] = fn; },
    on(channel, fn) { this[channel] = fn; },
  };
  registerHandlers(ipcMain, {
    terminalBridge: {
      closeSession() { closed.push("ssh"); },
    },
  });
  await ipcMain["netcatty:orgCenterShare:leave"]({}, { sessionId: "guest-1" });
  assert.deepEqual(closed, []);
});
