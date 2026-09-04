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

test("guest system rpc is a no-op for ordinary ssh sessions", () => {
  const {
    bindShareRuntime,
    tryInvokeOrgShareGuestSystemRpc,
  } = require("./orgCenterShareBridge.cjs");
  bindShareRuntime({ guestShares: new Map() });
  try {
    assert.equal(
      tryInvokeOrgShareGuestSystemRpc("ssh-1", "netcatty:system:listProcesses", { sessionId: "ssh-1" }),
      null,
    );
  } finally {
    bindShareRuntime(null);
  }
});

test("guest system rpc rejects write actions without sending a share frame", async () => {
  const {
    bindShareRuntime,
    tryInvokeOrgShareGuestSystemRpc,
  } = require("./orgCenterShareBridge.cjs");
  const sent = [];
  bindShareRuntime({
    guestShares: new Map([["guest-1", {
      ws: {
        readyState: WebSocket.OPEN,
        send(raw) { sent.push(JSON.parse(raw)); },
      },
    }]]),
  });
  try {
    const result = await tryInvokeOrgShareGuestSystemRpc(
      "guest-1",
      "netcatty:system:signalProcess",
      { sessionId: "guest-1", pid: 1 },
    );
    assert.equal(result.success, false);
    assert.match(result.error, /read-only/i);
    assert.equal(result.errorCode, "ORG_SHARE_SYSTEM_READ_ONLY");
    assert.deepEqual(sent, []);
  } finally {
    bindShareRuntime(null);
  }
});

test("guest system rpc waits for a host result frame", async () => {
  const {
    applyGuestSystemRpcResult,
    bindShareRuntime,
    tryInvokeOrgShareGuestSystemRpc,
  } = require("./orgCenterShareBridge.cjs");
  const sent = [];
  const share = {
    ws: {
      readyState: WebSocket.OPEN,
      send(raw) { sent.push(JSON.parse(raw)); },
    },
  };
  bindShareRuntime({ guestShares: new Map([["guest-1", share]]) });
  try {
    const pending = tryInvokeOrgShareGuestSystemRpc(
      "guest-1",
      "netcatty:system:listProcesses",
      { sessionId: "guest-1" },
    );
    assert.equal(sent.length, 1);
    assert.equal(sent[0].type, "sys-rpc");
    assert.equal(sent[0].channel, "netcatty:system:listProcesses");
    applyGuestSystemRpcResult(share, {
      requestId: sent[0].requestId,
      result: { success: true, processes: [{ pid: 1 }] },
    });
    const result = await pending;
    assert.equal(result.success, true);
    assert.equal(result.processes[0].pid, 1);
  } finally {
    bindShareRuntime(null);
  }
});

test("host system rpc rewrites the guest session id onto the host ssh session", async () => {
  const {
    respondToGuestSystemRpc,
    rewriteOrgShareSystemPayload,
  } = require("./orgCenterShareBridge.cjs");
  assert.equal(rewriteOrgShareSystemPayload("guest-1", "host-1"), "host-1");
  assert.deepEqual(
    rewriteOrgShareSystemPayload({ sessionId: "guest-1", pid: 9 }, "host-1"),
    { sessionId: "host-1", pid: 9 },
  );

  const sent = [];
  const invoked = [];
  const share = {
    sessionId: "host-1",
    ws: {
      readyState: WebSocket.OPEN,
      send(raw) { sent.push(JSON.parse(raw)); },
    },
  };
  await respondToGuestSystemRpc(share, {
    requestId: "r1",
    channel: "netcatty:system:listProcesses",
    payload: { sessionId: "guest-1" },
  }, async (sessionId, channel, payload) => {
    invoked.push({ sessionId, channel, payload });
    return { success: true, processes: [] };
  });
  assert.deepEqual(invoked, [{
    sessionId: "host-1",
    channel: "netcatty:system:listProcesses",
    payload: { sessionId: "host-1" },
  }]);
  assert.equal(sent[0].type, "sys-rpc-result");
  assert.equal(sent[0].requestId, "r1");
  assert.equal(sent[0].result.success, true);
});

test("host system rpc relays overview stats onto the host ssh session", async () => {
  const { respondToGuestSystemRpc } = require("./orgCenterShareBridge.cjs");
  const sent = [];
  const invoked = [];
  const share = {
    sessionId: "host-1",
    ws: {
      readyState: WebSocket.OPEN,
      send(raw) { sent.push(JSON.parse(raw)); },
    },
  };
  await respondToGuestSystemRpc(share, {
    requestId: "r-stats",
    channel: "netcatty:system:getServerStats",
    payload: { sessionId: "guest-1" },
  }, async (sessionId, channel, payload) => {
    invoked.push({ sessionId, channel, payload });
    return { success: true, stats: { cpu: 4 } };
  });
  assert.deepEqual(invoked, [{
    sessionId: "host-1",
    channel: "netcatty:system:getServerStats",
    payload: { sessionId: "host-1" },
  }]);
  assert.equal(sent[0].type, "sys-rpc-result");
  assert.equal(sent[0].requestId, "r-stats");
  assert.equal(sent[0].result.stats.cpu, 4);
});

test("host system rpc does not relay oversized snapshots", async () => {
  const { respondToGuestSystemRpc } = require("./orgCenterShareBridge.cjs");
  const sent = [];
  const share = {
    sessionId: "host-1",
    ws: {
      readyState: WebSocket.OPEN,
      send(raw) { sent.push(JSON.parse(raw)); },
    },
  };
  await respondToGuestSystemRpc(share, {
    requestId: "r-big",
    channel: "netcatty:system:listProcesses",
    payload: { sessionId: "guest-1" },
  }, async () => ({
    success: true,
    processes: Array.from({ length: 20000 }, (_, i) => ({
      pid: i + 1,
      command: "x".repeat(80),
    })),
  }));
  assert.equal(sent[0].type, "sys-rpc-result");
  assert.equal(sent[0].result.success, false);
  assert.match(sent[0].result.error, /too large/i);
});
