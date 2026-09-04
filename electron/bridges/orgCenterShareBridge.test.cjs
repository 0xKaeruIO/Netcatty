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

test("shared pty layout uses the smaller grid", () => {
  const { resolveSharedPtyLayout } = require("./orgCenterShareBridge.cjs");
  assert.deepEqual(
    resolveSharedPtyLayout({ cols: 120, rows: 40 }, [{ cols: 80, rows: 24 }]),
    { cols: 80, rows: 24, source: "peer" },
  );
  assert.deepEqual(
    resolveSharedPtyLayout({ cols: 80, rows: 24 }, [{ cols: 120, rows: 40 }]),
    { cols: 80, rows: 24, source: "self" },
  );
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

test("formatGuestExecInput appends CR when the command has no newline", () => {
  const { formatGuestExecInput } = require("./orgCenterShareBridge.cjs");
  assert.equal(formatGuestExecInput("ls"), "ls\r");
  assert.equal(formatGuestExecInput("ls\n"), "ls\n");
  assert.equal(formatGuestExecInput("ls\r"), "ls\r");
  assert.equal(formatGuestExecInput(""), "");
});

test("tryExecOrgShareGuestCommand is a no-op for non-guest sessions", () => {
  const {
    bindShareRuntime,
    tryExecOrgShareGuestCommand,
  } = require("./orgCenterShareBridge.cjs");
  bindShareRuntime({ guestShares: new Map() });
  assert.equal(tryExecOrgShareGuestCommand("ssh-1", "pwd"), null);
  bindShareRuntime(null);
});

test("guest exec collects live out frames and returns a null exitCode", async () => {
  const {
    bindShareRuntime,
    execOrgShareGuestCommand,
    encodePayload,
  } = require("./orgCenterShareBridge.cjs");
  const sent = [];
  const share = {
    ws: {
      readyState: WebSocket.OPEN,
      send(raw) {
        sent.push(JSON.parse(raw));
      },
    },
  };
  bindShareRuntime({ guestShares: new Map([["guest-1", share]]) });
  try {
    const pending = execOrgShareGuestCommand("guest-1", "pwd", {
      idleMs: 30,
      timeoutMs: 1000,
    });
    assert.equal(share.outputListeners.size, 1);
    assert.equal(sent.length, 1);
    assert.equal(sent[0].type, "in");
    assert.equal(sent[0].data, encodePayload("pwd\r"));
    for (const listener of share.outputListeners) listener("$ pwd\n/home/user\n");
    const result = await pending;
    assert.deepEqual(result, {
      ok: true,
      stdout: "$ pwd\n/home/user\n",
      stderr: "",
      exitCode: null,
    });
  } finally {
    bindShareRuntime(null);
  }
});

test("guest exec does not fall through when the share socket is closed", async () => {
  const {
    bindShareRuntime,
    tryExecOrgShareGuestCommand,
  } = require("./orgCenterShareBridge.cjs");
  bindShareRuntime({
    guestShares: new Map([["guest-1", { ws: { readyState: 3 } }]]),
  });
  try {
    const pending = tryExecOrgShareGuestCommand("guest-1", "pwd");
    assert.notEqual(pending, null);
    const result = await pending;
    assert.equal(result.ok, false);
    assert.match(result.error, /not connected/i);
    assert.equal(result.exitCode, null);
  } finally {
    bindShareRuntime(null);
  }
});
