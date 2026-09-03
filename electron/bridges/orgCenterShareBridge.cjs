"use strict";

const { addTerminalDataTap } = require("./emitTerminalSessionData.cjs");

const SNAPSHOT_MAX_CHARS = 256 * 1024;
const FETCH_TIMEOUT_MS = 15000;
const WS_TIMEOUT_MS = 15000;

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
  } catch {
    return "";
  }
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
      } catch {
        // ignore malformed frames
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
  if (!ws || ws.readyState !== WebSocket.OPEN) return;
  try {
    ws.send(JSON.stringify(message));
  } catch (err) {
    console.warn("[orgCenterShare] send failed", err);
  }
}

function notifySender(contents, payload) {
  try {
    if (contents && !contents.isDestroyed?.()) {
      contents.send("netcatty:orgCenterShare:event", payload);
    }
  } catch {
    // Renderer may have gone away.
  }
}

function registerHandlers(ipcMain, options = {}) {
  const hostShares = new Map();
  const guestShares = new Map();
  let outputTapInstalled = false;
  let workerTapCleanup = null;

  const getTerminalBridge = () => {
    try {
      return options.terminalBridge || require("./terminalBridge.cjs");
    } catch {
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
      console.warn("[orgCenterShare] host write failed", err);
    }
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
        console.warn("[orgCenterShare] output tap failed", err);
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
          console.warn("[orgCenterShare] output tap failed", err);
        }
      });
    }
  };

  const stopHostShare = async (sessionId, reason = "stopped") => {
    const share = hostShares.get(sessionId);
    if (!share) return { stopped: false };
    hostShares.delete(sessionId);
    try { share.ws?.close(); } catch { /* ignore */ }
    try {
      if (share.roomId) {
        await fetchJson(`${share.baseUrl}/api/v1/share/rooms/${encodeURIComponent(share.roomId)}`, {
          method: "DELETE",
          apiKey: share.apiKey,
        });
      }
    } catch {
      // Closing the local socket is enough if the center is gone.
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
      } catch { /* ignore */ }
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
      cols: Number(payload?.cols) || 80,
      rows: Number(payload?.rows) || 24,
    };
    hostShares.set(sessionId, share);
    const sendSnapshot = () => {
      const snapshot = share.ring.snapshot();
      if (snapshot) sendJson(share.ws, { type: "snapshot", data: encodePayload(snapshot) });
      sendJson(share.ws, {
        type: "resize",
        cols: share.cols,
        rows: share.rows,
      });
    };
    socket.setHandler((message) => {
      if (message?.type === "in") {
        writeToHostPty(sessionId, decodePayload(message.data));
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
      } catch {
        // ignore
      }
    };
    socket.setHandler((message) => {
      if (message?.type === "snapshot" || message?.type === "out") {
        sendData(decodePayload(message.data));
        return;
      }
      if (message?.type === "resize") {
        notifySender(share.contents, {
          type: "resize",
          sessionId,
          cols: message.cols,
          rows: message.rows,
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
      if (!share) return;
      sendJson(share.ws, { type: "in", data: encodePayload(payload?.data) });
    } catch (err) {
      console.warn("[orgCenterShare] guest input failed", err);
    }
  });

  ipcMain.on("netcatty:orgCenterShare:hostResize", (_event, payload) => {
    try {
      const share = hostShares.get(String(payload?.sessionId ?? ""));
      if (!share) return;
      share.cols = Number(payload?.cols) || share.cols;
      share.rows = Number(payload?.rows) || share.rows;
      sendJson(share.ws, {
        type: "resize",
        cols: share.cols,
        rows: share.rows,
      });
    } catch (err) {
      console.warn("[orgCenterShare] resize failed", err);
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
    share.cols = Number(payload?.cols) || share.cols;
    share.rows = Number(payload?.rows) || share.rows;
    sendJson(share.ws, {
      type: "resize",
      cols: share.cols,
      rows: share.rows,
    });
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
};
