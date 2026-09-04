"use strict";

const { addTerminalDataTap } = require("./emitTerminalSessionData.cjs");

const SNAPSHOT_MAX_CHARS = 256 * 1024;
const FETCH_TIMEOUT_MS = 15000;
const WS_TIMEOUT_MS = 15000;
const GUEST_EXEC_IDLE_MS = 3000;
const GUEST_EXEC_MAX_OUTPUT = 1024 * 1024;
const GUEST_EXEC_DEFAULT_TIMEOUT_MS = 60000;
const GUEST_BACKGROUND_JOB_ERROR =
  "Shared guest sessions do not support background jobs. Use terminal_execute.";

let liveShareRuntime = null;

function normalizeBaseUrl(raw) {
  const trimmed = String(raw ?? "").trim().replace(/\/+$/, "");
  if (!trimmed) throw new Error("Organization center URL is required.");
  let parsed;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new Error("Invalid organization center URL.");
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("Organization center URL must be http or https.");
  }
  return trimmed;
}

function toWebSocketUrl(baseUrl, roomId, role, token) {
  const url = new URL(`${normalizeBaseUrl(baseUrl)}/ws/v1/share/${encodeURIComponent(roomId)}`);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  url.searchParams.set("role", role);
  url.searchParams.set("token", token);
  return url.toString();
}

function extractApiKey(payload) {
  const key = String(payload?.apiKey ?? "").trim();
  if (!key.startsWith("ncc_")) {
    throw new Error("Invalid organization center API key.");
  }
  return key;
}

function encodePayload(text) {
  return Buffer.from(String(text ?? ""), "utf8").toString("base64");
}

function decodePayload(data) {
  if (!data) return "";
  try {
    return Buffer.from(String(data), "base64").toString("utf8");
  } catch (err) {
    console.error("[orgCenterShare] payload decode failed", err);
    return "";
  }
}

function clampShareGridSize(cols, rows) {
  const nextCols = Math.min(1000, Math.max(2, Math.floor(Number(cols) || 0)));
  const nextRows = Math.min(500, Math.max(1, Math.floor(Number(rows) || 0)));
  return { cols: nextCols, rows: nextRows };
}

function resolveSharedPtyLayout(self, peers) {
  const host = clampShareGridSize(self?.cols, self?.rows);
  const list = Array.isArray(peers) ? peers : [];
  if (list.length === 0) return { ...host, source: "self-only" };
  let cols = host.cols;
  let rows = host.rows;
  for (const peer of list) {
    const next = clampShareGridSize(peer.cols, peer.rows);
    cols = Math.min(cols, next.cols);
    rows = Math.min(rows, next.rows);
  }
  const allMatch = list.every((peer) => {
    const next = clampShareGridSize(peer.cols, peer.rows);
    return next.cols === host.cols && next.rows === host.rows;
  });
  if (allMatch) return { cols, rows, source: "matched" };
  const colFromSelf = cols === host.cols;
  const rowFromSelf = rows === host.rows;
  if (colFromSelf && rowFromSelf) return { cols, rows, source: "self" };
  if (!colFromSelf && !rowFromSelf) return { cols, rows, source: "peer" };
  return { cols, rows, source: "mixed" };
}

function createRingBuffer(maxChars = SNAPSHOT_MAX_CHARS) {
  const chunks = [];
  let size = 0;
  return {
    push(text) {
      const value = String(text ?? "");
      if (!value) return;
      chunks.push(value);
      size += value.length;
      while (size > maxChars && chunks.length > 1) {
        const removed = chunks.shift();
        size -= removed.length;
      }
    },
    snapshot() {
      return chunks.join("");
    },
  };
}

async function fetchJson(url, { method = "GET", apiKey, body, timeoutMs = FETCH_TIMEOUT_MS } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      method,
      headers: {
        Authorization: `Bearer ${apiKey}`,
        Accept: "application/json",
        ...(body ? { "Content-Type": "application/json" } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = typeof payload.error === "string" ? payload.error : `HTTP ${response.status}`;
      throw new Error(error);
    }
    return payload;
  } catch (err) {
    if (err?.name === "AbortError") {
      throw new Error("Organization center request timed out.");
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

function parseSocketMessage(event) {
  const text = typeof event.data === "string"
    ? event.data
    : Buffer.from(event.data).toString("utf8");
  return JSON.parse(text);
}

function openShareSocket(url) {
  if (typeof WebSocket !== "function") {
    return Promise.reject(new Error("WebSocket is unavailable in this process."));
  }
  return new Promise((resolve, reject) => {
    let settled = false;
    const ws = new WebSocket(url);
    const queued = [];
    let onMessage = null;
    const deliver = (message) => {
      if (typeof onMessage === "function") {
        onMessage(message);
        return;
      }
      queued.push(message);
    };
    ws.addEventListener("message", (event) => {
      try {
        deliver(parseSocketMessage(event));
      } catch (err) {
        console.error("[orgCenterShare] malformed share frame", err);
      }
    });
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      try { ws.close(); } catch { /* ignore */ }
      reject(new Error("Organization center share connection timed out."));
    }, WS_TIMEOUT_MS);
    ws.addEventListener("open", () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({
        ws,
        setHandler(handler) {
          onMessage = handler;
          const pending = queued.splice(0);
          for (const message of pending) handler(message);
        },
      });
    });
    ws.addEventListener("error", () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(new Error("Could not open organization center share connection."));
    });
  });
}

function sendJson(ws, message) {
  if (!ws || ws.readyState !== WebSocket.OPEN) {
    if (message?.type && message.type !== "out") {
      console.error("[orgCenterShare] send skipped: socket not open", message.type);
    }
    return;
  }
  try {
    ws.send(JSON.stringify(message));
  } catch (err) {
    console.error("[orgCenterShare] send failed", err);
  }
}

function bindShareRuntime(runtime) {
  liveShareRuntime = runtime && typeof runtime === "object" ? runtime : null;
}

function hasOrgShareGuestSession(sessionId) {
  const id = String(sessionId || "");
  if (!id) return false;
  return Boolean(liveShareRuntime?.guestShares?.has(id));
}

function formatGuestExecInput(command) {
  const text = String(command ?? "");
  if (!text) return text;
  if (text.endsWith("\r") || text.endsWith("\n")) return text;
  return `${text}\r`;
}

function emitGuestOutput(share, text) {
  const value = String(text ?? "");
  if (!value) return;
  const listeners = share?.outputListeners;
  if (!listeners || listeners.size === 0) return;
  for (const listener of [...listeners]) {
    try {
      listener(value);
    } catch (err) {
      console.error("[orgCenterShare] guest output listener failed", err);
    }
  }
}

function abortGuestShareExecs(share, reason) {
  const closers = [...(share?.closeListeners || [])];
  share?.closeListeners?.clear();
  for (const close of closers) {
    try {
      close(reason);
    } catch (err) {
      console.error("[orgCenterShare] guest exec abort failed", err);
    }
  }
}

function waitForGuestShareOutput(share, options = {}) {
  const timeoutMs = Number(options.timeoutMs) > 0
    ? Number(options.timeoutMs)
    : GUEST_EXEC_DEFAULT_TIMEOUT_MS;
  const idleMs = Number(options.idleMs) > 0
    ? Number(options.idleMs)
    : Math.min(GUEST_EXEC_IDLE_MS, Math.max(1, Math.floor(timeoutMs / 20)));
  const maxChars = Number(options.maxChars) > 0 ? Number(options.maxChars) : GUEST_EXEC_MAX_OUTPUT;

  return new Promise((resolve) => {
    let output = "";
    let finished = false;
    let idleTimer = null;
    let overallTimer = null;
    let noResponseTimer = null;
    let chunkCount = 0;

    function finish(error) {
      if (finished) return;
      finished = true;
      clearTimeout(idleTimer);
      clearTimeout(overallTimer);
      clearTimeout(noResponseTimer);
      share.outputListeners?.delete(onData);
      share.closeListeners?.delete(onClose);
      const stdout = output.length > maxChars ? output.slice(0, maxChars) : output;
      if (error) {
        resolve({ ok: false, stdout, stderr: "", exitCode: null, error });
        return;
      }
      resolve({ ok: true, stdout, stderr: "", exitCode: null });
    }

    function resetIdleTimer() {
      clearTimeout(idleTimer);
      const effectiveIdle = chunkCount <= 2 ? idleMs * 2 : idleMs;
      idleTimer = setTimeout(() => finish(null), effectiveIdle);
    }

    function onData(text) {
      chunkCount += 1;
      if (noResponseTimer) {
        clearTimeout(noResponseTimer);
        noResponseTimer = null;
      }
      if (output.length < maxChars) {
        output += text;
        resetIdleTimer();
      }
    }

    function onClose() {
      finish("Shared session disconnected.");
    }

    if (!share.outputListeners) share.outputListeners = new Set();
    if (!share.closeListeners) share.closeListeners = new Set();
    share.outputListeners.add(onData);
    share.closeListeners.add(onClose);

    overallTimer = setTimeout(() => {
      sendJson(share.ws, { type: "in", data: encodePayload("\x03") });
      const timeoutSec = Math.round(timeoutMs / 1000);
      finish(`Command timed out (${timeoutSec}s)`);
    }, timeoutMs);

    const noResponseMs = Math.min(idleMs * 4, Math.max(1, Math.floor(timeoutMs / 4)));
    noResponseTimer = setTimeout(() => finish(null), noResponseMs);
  });
}

function disconnectedGuestExecResult() {
  return {
    ok: false,
    error: "Shared session is not connected.",
    stdout: "",
    stderr: "",
    exitCode: null,
  };
}

function execOrgShareGuestCommand(sessionId, command, options = {}) {
  const share = liveShareRuntime?.guestShares?.get(String(sessionId || ""));
  if (!share) return Promise.resolve(disconnectedGuestExecResult());
  if (!share.ws || share.ws.readyState !== WebSocket.OPEN) {
    return Promise.resolve(disconnectedGuestExecResult());
  }
  const pending = waitForGuestShareOutput(share, options);
  sendJson(share.ws, { type: "in", data: encodePayload(formatGuestExecInput(command)) });
  return pending;
}

function tryExecOrgShareGuestCommand(sessionId, command, options = {}) {
  if (!hasOrgShareGuestSession(sessionId)) return null;
  return execOrgShareGuestCommand(sessionId, command, options);
}

function notifySender(contents, payload) {
  try {
    if (contents && !contents.isDestroyed?.()) {
      contents.send("netcatty:orgCenterShare:event", payload);
    }
  } catch (err) {
    console.error("[orgCenterShare] notify sender failed", err);
  }
}

function registerHandlers(ipcMain, options = {}) {
  const hostShares = new Map();
  const guestShares = new Map();
  bindShareRuntime({ guestShares });
  let outputTapInstalled = false;
  let workerTapCleanup = null;

  const getTerminalBridge = () => {
    try {
      return options.terminalBridge || require("./terminalBridge.cjs");
    } catch (err) {
      console.error("[orgCenterShare] terminal bridge unavailable", err);
      return null;
    }
  };

  const writeToHostPty = (sessionId, data) => {
    try {
      const worker = options.terminalWorkerManager;
      if (worker?.send) {
        worker.send("netcatty:write", { sessionId, data }, {});
        return;
      }
      getTerminalBridge()?.writeToSession?.(null, { sessionId, data });
    } catch (err) {
      console.error("[orgCenterShare] host write failed", err);
    }
  };

  const resizeHostPty = (sessionId, cols, rows) => {
    try {
      const worker = options.terminalWorkerManager;
      if (worker?.send) {
        worker.send("netcatty:resize", { sessionId, cols, rows }, {});
        return;
      }
      getTerminalBridge()?.resizeSession?.(null, { sessionId, cols, rows });
    } catch (err) {
      console.error("[orgCenterShare] host resize failed", err);
    }
  };

  const minGuestCapacity = (share) => {
    const guests = [...(share.guestCaps?.values?.() ?? [])];
    if (guests.length === 0) return null;
    return guests.reduce((min, item) => ({
      cols: Math.min(min.cols, item.cols),
      rows: Math.min(min.rows, item.rows),
    }));
  };

  const applyLockedShareSize = (share, immediate = false) => {
    const run = () => {
      share.sizeTimer = null;
      const guests = [...(share.guestCaps?.values?.() ?? [])];
      const layout = resolveSharedPtyLayout(
        { cols: share.hostCols, rows: share.hostRows },
        guests,
      );
      const changed = share.cols !== layout.cols || share.rows !== layout.rows;
      share.cols = layout.cols;
      share.rows = layout.rows;
      share.sizeSource = layout.source;
      const guestMin = minGuestCapacity(share);
      if (changed) {
        resizeHostPty(share.sessionId, layout.cols, layout.rows);
      }
      sendJson(share.ws, {
        type: "resize",
        cols: layout.cols,
        rows: layout.rows,
        source: layout.source,
        hostCols: share.hostCols,
        hostRows: share.hostRows,
        guestCols: guestMin?.cols,
        guestRows: guestMin?.rows,
      });
      notifySender(share.contents, {
        type: "resize",
        sessionId: share.sessionId,
        cols: layout.cols,
        rows: layout.rows,
        source: layout.source,
        hostCols: share.hostCols,
        hostRows: share.hostRows,
        guestCols: guestMin?.cols,
        guestRows: guestMin?.rows,
      });
    };
    if (immediate) {
      if (share.sizeTimer) {
        clearTimeout(share.sizeTimer);
        share.sizeTimer = null;
      }
      run();
      return;
    }
    if (share.sizeTimer) {
      clearTimeout(share.sizeTimer);
    }
    share.sizeTimer = setTimeout(run, 200);
  };

  const ensureOutputTaps = () => {
    if (outputTapInstalled) return;
    outputTapInstalled = true;
    addTerminalDataTap((sessionId, data) => {
      try {
        const share = hostShares.get(sessionId);
        if (!share) return;
        share.ring.push(data);
        sendJson(share.ws, { type: "out", data: encodePayload(data) });
      } catch (err) {
        console.error("[orgCenterShare] output tap failed", err);
      }
    });
    if (typeof options.terminalWorkerManager?.addOutputTap === "function") {
      workerTapCleanup = options.terminalWorkerManager.addOutputTap((sessionId, data) => {
        try {
          const share = hostShares.get(sessionId);
          if (!share) return;
          share.ring.push(data);
          sendJson(share.ws, { type: "out", data: encodePayload(data) });
        } catch (err) {
          console.error("[orgCenterShare] output tap failed", err);
        }
      });
    }
  };

  const stopHostShare = async (sessionId, reason = "stopped") => {
    const share = hostShares.get(sessionId);
    if (!share) return { stopped: false };
    hostShares.delete(sessionId);
    if (share.sizeTimer) {
      clearTimeout(share.sizeTimer);
      share.sizeTimer = null;
    }
    try { share.ws?.close(); } catch { /* ignore */ }
    try {
      if (share.roomId) {
        await fetchJson(`${share.baseUrl}/api/v1/share/rooms/${encodeURIComponent(share.roomId)}`, {
          method: "DELETE",
          apiKey: share.apiKey,
        });
      }
    } catch (err) {
      console.error("[orgCenterShare] stop room delete failed", err);
    }
    notifySender(share.contents, {
      type: "stopped",
      sessionId,
      reason,
    });
    return { stopped: true };
  };

  const leaveGuestShare = (sessionId, reason = "left") => {
    const share = guestShares.get(sessionId);
    if (!share) return { left: false };
    guestShares.delete(sessionId);
    abortGuestShareExecs(share, reason);
    try { share.ws?.close(); } catch { /* ignore */ }
    notifySender(share.contents, {
      type: "ended",
      sessionId,
      reason,
      message: share.lastMessage || "",
    });
    return { left: true };
  };

  const bindSocketClose = (ws, onClose) => {
    let closed = false;
    const handleClose = () => {
      if (closed) return;
      closed = true;
      onClose();
    };
    ws.addEventListener("close", handleClose);
    ws.addEventListener("error", handleClose);
  };

  ensureOutputTaps();

  ipcMain.handle("netcatty:orgCenterShare:start", async (event, payload) => {
    const sessionId = String(payload?.sessionId ?? "");
    if (!sessionId) throw new Error("Missing session id.");
    if (hostShares.has(sessionId)) {
      const current = hostShares.get(sessionId);
      return { ok: true, pin: current.pin, roomId: current.roomId };
    }
    const baseUrl = normalizeBaseUrl(payload?.url);
    const apiKey = extractApiKey(payload);
    const created = await fetchJson(`${baseUrl}/api/v1/share/rooms`, {
      method: "POST",
      apiKey,
      body: {
        label: String(payload?.label ?? ""),
        cols: Number(payload?.cols) || 80,
        rows: Number(payload?.rows) || 24,
      },
    });
    const roomId = String(created.roomId || "");
    const pin = String(created.pin || "");
    const hostToken = String(created.hostToken || "");
    if (!roomId || !pin || !hostToken) {
      throw new Error("Organization center returned an unsupported share room.");
    }
    let socket;
    try {
      socket = await openShareSocket(toWebSocketUrl(baseUrl, roomId, "host", hostToken));
    } catch (err) {
      try {
        await fetchJson(`${baseUrl}/api/v1/share/rooms/${encodeURIComponent(roomId)}`, {
          method: "DELETE",
          apiKey,
        });
      } catch (cleanupErr) {
        console.error("[orgCenterShare] start-failure room delete failed", cleanupErr);
      }
      throw err;
    }
    const share = {
      sessionId,
      baseUrl,
      apiKey,
      roomId,
      pin,
      ws: socket.ws,
      ring: createRingBuffer(),
      contents: event?.sender,
      hostCols: Number(payload?.cols) || 80,
      hostRows: Number(payload?.rows) || 24,
      cols: Number(payload?.cols) || 80,
      rows: Number(payload?.rows) || 24,
      guestCaps: new Map(),
      sizeSource: "self-only",
      sizeTimer: null,
    };
    hostShares.set(sessionId, share);
    const sendSnapshot = () => {
      const snapshot = share.ring.snapshot();
      if (snapshot) sendJson(share.ws, { type: "snapshot", data: encodePayload(snapshot) });
      const guestMin = minGuestCapacity(share);
      sendJson(share.ws, {
        type: "resize",
        cols: share.cols,
        rows: share.rows,
        source: share.sizeSource,
        hostCols: share.hostCols,
        hostRows: share.hostRows,
        guestCols: guestMin?.cols,
        guestRows: guestMin?.rows,
      });
    };
    socket.setHandler((message) => {
      if (message?.type === "in") {
        writeToHostPty(sessionId, decodePayload(message.data));
        return;
      }
      if (message?.type === "capacity") {
        const guestId = String(message.id || "guest");
        share.guestCaps.set(guestId, clampShareGridSize(message.cols, message.rows));
        applyLockedShareSize(share);
        return;
      }
      if (message?.type === "guest-left") {
        share.guestCaps.delete(String(message.id || "guest"));
        applyLockedShareSize(share, true);
        return;
      }
      if (message?.type === "hello") {
        sendSnapshot();
        return;
      }
      if (message?.type === "ended" || message?.type === "error") {
        void stopHostShare(sessionId, message.type);
      }
    });
    bindSocketClose(socket.ws, () => {
      void stopHostShare(sessionId, "disconnected");
    });
    notifySender(event?.sender, { type: "started", sessionId, pin, roomId });
    return { ok: true, pin, roomId };
  });

  ipcMain.handle("netcatty:orgCenterShare:stop", async (_event, payload) => {
    return stopHostShare(String(payload?.sessionId ?? ""), "stopped");
  });

  ipcMain.handle("netcatty:orgCenterShare:join", async (event, payload) => {
    const sessionId = String(payload?.sessionId ?? "");
    if (!sessionId) throw new Error("Missing session id.");
    const baseUrl = normalizeBaseUrl(payload?.url);
    const apiKey = extractApiKey(payload);
    const pin = String(payload?.pin ?? "").trim();
    const joined = await fetchJson(`${baseUrl}/api/v1/share/join`, {
      method: "POST",
      apiKey,
      body: { pin },
    });
    const roomId = String(joined.roomId || "");
    const guestToken = String(joined.guestToken || "");
    if (!roomId || !guestToken) {
      throw new Error("Organization center returned an unsupported share room.");
    }
    const socket = await openShareSocket(toWebSocketUrl(baseUrl, roomId, "guest", guestToken));
    const share = {
      sessionId,
      baseUrl,
      apiKey,
      roomId,
      pin,
      ws: socket.ws,
      contents: event?.sender,
      lastMessage: "",
    };
    guestShares.set(sessionId, share);
    const sendData = (data) => {
      try {
        if (share.contents && !share.contents.isDestroyed?.()) {
          share.contents.send("netcatty:data", { sessionId, data });
        }
      } catch (err) {
        console.error("[orgCenterShare] guest output send failed", err);
      }
    };
    socket.setHandler((message) => {
      if (message?.type === "snapshot") {
        sendData(decodePayload(message.data));
        return;
      }
      if (message?.type === "out") {
        const text = decodePayload(message.data);
        sendData(text);
        emitGuestOutput(share, text);
        return;
      }
      if (message?.type === "resize") {
        notifySender(share.contents, {
          type: "resize",
          sessionId,
          cols: message.cols,
          rows: message.rows,
          source: message.source,
          hostCols: message.hostCols,
          hostRows: message.hostRows,
          guestCols: message.guestCols,
          guestRows: message.guestRows,
        });
        return;
      }
      if (message?.type === "hello") {
        notifySender(share.contents, {
          type: "joined",
          sessionId,
          label: message.label || joined.label || "",
          cols: message.cols || joined.cols,
          rows: message.rows || joined.rows,
        });
        return;
      }
      if (message?.type === "ended" || message?.type === "error") {
        share.lastMessage = message.message || "";
        leaveGuestShare(sessionId, message.type);
      }
    });
    bindSocketClose(socket.ws, () => {
      leaveGuestShare(sessionId, "disconnected");
    });
    return {
      ok: true,
      roomId,
      label: joined.label || "",
      cols: joined.cols || 80,
      rows: joined.rows || 24,
    };
  });

  ipcMain.handle("netcatty:orgCenterShare:leave", async (_event, payload) => {
    return leaveGuestShare(String(payload?.sessionId ?? ""), "left");
  });

  ipcMain.on("netcatty:orgCenterShare:guestInput", (_event, payload) => {
    try {
      const sessionId = String(payload?.sessionId ?? "");
      const share = guestShares.get(sessionId);
      if (!share) {
        console.error("[orgCenterShare] guest input: no share for session", sessionId);
        return;
      }
      sendJson(share.ws, { type: "in", data: encodePayload(payload?.data) });
    } catch (err) {
      console.error("[orgCenterShare] guest input failed", err);
    }
  });

  ipcMain.on("netcatty:orgCenterShare:reportCapacity", (_event, payload) => {
    try {
      const sessionId = String(payload?.sessionId ?? "");
      const next = clampShareGridSize(payload?.cols, payload?.rows);
      const hostShare = hostShares.get(sessionId);
      if (hostShare) {
        hostShare.hostCols = next.cols;
        hostShare.hostRows = next.rows;
        applyLockedShareSize(hostShare);
        return;
      }
      const guestShare = guestShares.get(sessionId);
      if (!guestShare) {
        console.error("[orgCenterShare] capacity: no share for session", sessionId);
        return;
      }
      sendJson(guestShare.ws, { type: "capacity", cols: next.cols, rows: next.rows });
    } catch (err) {
      console.error("[orgCenterShare] capacity failed", err);
    }
  });

  ipcMain.on("netcatty:orgCenterShare:hostResize", (_event, payload) => {
    try {
      const share = hostShares.get(String(payload?.sessionId ?? ""));
      if (!share) return;
      share.hostCols = clampShareGridSize(payload?.cols, payload?.rows).cols;
      share.hostRows = clampShareGridSize(payload?.cols, payload?.rows).rows;
      applyLockedShareSize(share);
    } catch (err) {
      console.error("[orgCenterShare] resize failed", err);
    }
  });

  ipcMain.on("netcatty:close", (_event, payload) => {
    const sessionId = payload?.sessionId;
    if (!sessionId) return;
    void stopHostShare(sessionId, "session-closed");
    leaveGuestShare(sessionId, "session-closed");
  });

  ipcMain.on("netcatty:resize", (_event, payload) => {
    const share = hostShares.get(payload?.sessionId);
    if (!share) return;
    // During share, FitAddon window size is reported via reportCapacity.
    // Ignore locked-grid ioctl echoes so they cannot replace host capacity.
    const cols = Number(payload?.cols) || 0;
    const rows = Number(payload?.rows) || 0;
    if (cols === share.cols && rows === share.rows) return;
  });

  return {
    stopAll() {
      for (const sessionId of [...hostShares.keys()]) {
        void stopHostShare(sessionId, "shutdown");
      }
      for (const sessionId of [...guestShares.keys()]) {
        leaveGuestShare(sessionId, "shutdown");
      }
      workerTapCleanup?.();
    },
  };
}

module.exports = {
  registerHandlers,
  normalizeBaseUrl,
  toWebSocketUrl,
  encodePayload,
  decodePayload,
  createRingBuffer,
  clampShareGridSize,
  resolveSharedPtyLayout,
  bindShareRuntime,
  hasOrgShareGuestSession,
  formatGuestExecInput,
  waitForGuestShareOutput,
  execOrgShareGuestCommand,
  tryExecOrgShareGuestCommand,
  GUEST_BACKGROUND_JOB_ERROR,
};
