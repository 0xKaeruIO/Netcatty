import test from "node:test";
import assert from "node:assert/strict";

import {
  getSftpCurrentPathMemoryKey,
  getSftpReopenMemoryKey,
  resolveSftpAutoConnectPath,
  resolveSftpOpenLocation,
  shouldIgnoreSftpSharedHostCacheOnAutoConnect,
} from "./sftpReopenLocation.ts";

test("first open of a terminal lands on the terminal cwd", () => {
  const location = resolveSftpOpenLocation({
    hostId: "host-1",
    connectionKey: "host-1:server-a:22:ssh::deploy",
    terminalCwd: "/home/deploy",
    remembered: null,
  });

  assert.equal(location, "/home/deploy");
});

test("reopening the same terminal restores the last browsed path", () => {
  const location = resolveSftpOpenLocation({
    hostId: "host-1",
    connectionKey: "host-1:server-a:22:ssh::deploy",
    terminalCwd: "/home/deploy",
    remembered: {
      hostId: "host-1",
      connectionKey: "host-1:server-a:22:ssh::deploy",
      path: "/home/deploy/projects/app",
    },
  });

  assert.equal(location, "/home/deploy/projects/app");
});

test("remembered path for a different host falls back to terminal cwd", () => {
  const location = resolveSftpOpenLocation({
    hostId: "host-2",
    connectionKey: "host-2:server-b:22:ssh::root",
    terminalCwd: "/srv",
    remembered: {
      hostId: "host-1",
      connectionKey: "host-1:server-a:22:ssh::deploy",
      path: "/home/deploy/projects/app",
    },
  });

  assert.equal(location, "/srv");
});

test("explicit upload target wins over remembered path", () => {
  const location = resolveSftpOpenLocation({
    hostId: "host-1",
    connectionKey: "host-1:server-a:22:ssh::deploy",
    terminalCwd: "/home/deploy",
    explicitTargetPath: "/tmp/upload-here",
    hasPendingUpload: true,
    remembered: {
      hostId: "host-1",
      connectionKey: "host-1:server-a:22:ssh::deploy",
      path: "/home/deploy/projects/app",
    },
  });

  assert.equal(location, "/tmp/upload-here");
});

test("untargeted upload does not inherit a remembered reopen path", () => {
  const location = resolveSftpOpenLocation({
    hostId: "host-1",
    connectionKey: "host-1:server-a:22:ssh::deploy",
    terminalCwd: undefined,
    hasPendingUpload: true,
    remembered: {
      hostId: "host-1",
      connectionKey: "host-1:server-a:22:ssh::deploy",
      path: "/home/deploy/projects/app",
    },
  });

  assert.equal(location, undefined);
});

test("remembered path for the same saved host but different endpoint falls back to terminal cwd", () => {
  const location = resolveSftpOpenLocation({
    hostId: "host-1",
    connectionKey: "host-1:server-a:2200:ssh::root",
    terminalCwd: "/srv/root",
    remembered: {
      hostId: "host-1",
      connectionKey: "host-1:server-a:22:ssh::deploy",
      path: "/home/deploy/projects/app",
    },
  });

  assert.equal(location, "/srv/root");
});

test("workspace sftp memory is keyed by source session rather than workspace tab", () => {
  const workspaceTabId = "workspace-1";

  assert.equal(
    getSftpReopenMemoryKey({ tabId: workspaceTabId, sourceSessionId: "session-a" }),
    "session-a",
  );
  assert.equal(
    getSftpReopenMemoryKey({ tabId: workspaceTabId, sourceSessionId: "session-b" }),
    "session-b",
  );
  assert.equal(getSftpReopenMemoryKey({ tabId: "terminal-tab-1" }), "terminal-tab-1");
});

test("path changes for non-reusable sessions still use the focused terminal session", () => {
  assert.equal(
    getSftpCurrentPathMemoryKey({
      tabId: "workspace-1",
      activeTerminalSessionIdForSftp: null,
      focusedSessionId: "mosh-session-1",
    }),
    "mosh-session-1",
  );
});

test("auto-connect prefers explicit open path over remembered browse path", () => {
  assert.equal(
    resolveSftpAutoConnectPath({
      explicitPath: "/tmp/upload",
      rememberedPath: "/home/deploy/projects",
    }),
    "/tmp/upload",
  );
});

test("auto-connect restores remembered path when nothing explicit is requested", () => {
  assert.equal(
    resolveSftpAutoConnectPath({
      rememberedPath: "/home/deploy/projects/app",
    }),
    "/home/deploy/projects/app",
  );
});

test("auto-connect ignores empty remembered paths", () => {
  assert.equal(
    resolveSftpAutoConnectPath({
      explicitPath: "",
      rememberedPath: "",
    }),
    undefined,
  );
});

test("follow mode auto-connect lands on the terminal cwd, not another pane's path", () => {
  assert.equal(
    resolveSftpAutoConnectPath({
      rememberedPath: "/home/deploy/projects/app",
      followTerminalCwd: true,
      terminalCwd: "/var/log",
    }),
    "/var/log",
  );
});

test("follow mode auto-connect still honours an explicit open target", () => {
  assert.equal(
    resolveSftpAutoConnectPath({
      explicitPath: "/tmp/upload",
      followTerminalCwd: true,
      terminalCwd: "/var/log",
    }),
    "/tmp/upload",
  );
});

test("follow mode auto-connect without a known cwd skips the shared host cache", () => {
  const resolvedPath = resolveSftpAutoConnectPath({
    rememberedPath: "/home/deploy/projects/app",
    followTerminalCwd: true,
    terminalCwd: null,
  });

  assert.equal(resolvedPath, undefined);
  assert.equal(
    shouldIgnoreSftpSharedHostCacheOnAutoConnect({
      followTerminalCwd: true,
      resolvedPath,
    }),
    true,
  );
});

test("follow off keeps the shared host cache and the sticky browsed path", () => {
  const resolvedPath = resolveSftpAutoConnectPath({
    rememberedPath: "/home/deploy/projects/app",
    followTerminalCwd: false,
    terminalCwd: "/var/log",
  });

  assert.equal(resolvedPath, "/home/deploy/projects/app");
  assert.equal(
    shouldIgnoreSftpSharedHostCacheOnAutoConnect({
      followTerminalCwd: false,
      resolvedPath: undefined,
    }),
    false,
  );
});
