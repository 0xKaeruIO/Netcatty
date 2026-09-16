const test = require("node:test");
const assert = require("node:assert/strict");

const sftpBridge = require("./sftpBridge.cjs");

function createSftpChannel(existingPaths = []) {
  const existing = new Set(existingPaths);
  const calls = {
    mkdir: [],
    realpath: [],
    rmdir: [],
    stat: [],
  };
  const channel = {
    readdir(_targetPath, callback) {
      callback(null, []);
    },
    stat(targetPath, callback) {
      calls.stat.push(targetPath);
      if (existing.has(targetPath)) {
        callback(null, { isDirectory: () => true });
        return;
      }
      const error = new Error(`No such file: ${targetPath}`);
      error.code = 2;
      callback(error);
    },
    mkdir(targetPath, callback) {
      calls.mkdir.push(targetPath);
      existing.add(targetPath);
      callback(null);
    },
    rmdir(targetPath, callback) {
      calls.rmdir.push(targetPath);
      existing.delete(targetPath);
      callback(null);
    },
    unlink(_targetPath, callback) {
      callback(null);
    },
    realpath(targetPath, callback) {
      calls.realpath.push(targetPath);
      callback(null, targetPath === ".." ? "/home" : "/home/alice");
    },
  };
  return { calls, channel };
}

test("mkdir preserves hidden relative names and resolves explicit dot segments", async () => {
  const { calls, channel } = createSftpChannel(["/home", "/home/alice"]);
  const client = {
    sftp: channel,
    realPath: (targetPath) => new Promise((resolve, reject) => {
      channel.realpath(targetPath, (error, resolvedPath) => (
        error ? reject(error) : resolve(resolvedPath)
      ));
    }),
  };
  sftpBridge.init({
    electronModule: {},
    sessions: new Map(),
    sftpClients: new Map([["mkdir-test", client]]),
  });

  await sftpBridge.mkdirSftp(null, {
    sftpId: "mkdir-test",
    path: ".config/app",
    encoding: "utf-8",
  });
  await sftpBridge.mkdirSftp(null, {
    sftpId: "mkdir-test",
    path: "..staging/cache",
    encoding: "utf-8",
  });
  await sftpBridge.mkdirSftp(null, {
    sftpId: "mkdir-test",
    path: "./logs",
    encoding: "utf-8",
  });
  await sftpBridge.mkdirSftp(null, {
    sftpId: "mkdir-test",
    path: "../shared",
    encoding: "utf-8",
  });
  await sftpBridge.mkdirSftp(null, {
    sftpId: "mkdir-test",
    path: ".\\windows-logs",
    encoding: "utf-8",
  });
  await sftpBridge.mkdirSftp(null, {
    sftpId: "mkdir-test",
    path: "..\\windows-shared",
    encoding: "utf-8",
  });

  assert.deepEqual(calls.realpath, [".", "..", ".", ".."]);
  assert.deepEqual(calls.mkdir, [
    ".config",
    ".config/app",
    "..staging",
    "..staging/cache",
    "/home/alice/logs",
    "/home/shared",
    "/home/alice/windows-logs",
    "/home/windows-shared",
  ]);
});

test("session-backed recursive delete preserves a hidden directory name", async () => {
  const { calls, channel } = createSftpChannel([".cache"]);
  const connection = {
    sftp(callback) {
      callback(null, channel);
    },
  };
  const sftpClients = new Map();
  sftpBridge.init({
    electronModule: {},
    sessions: new Map([["session-1", { conn: connection }]]),
    sftpClients,
  });
  const opened = await sftpBridge.openSftpForSession(null, { sessionId: "session-1" });

  await sftpBridge.deleteSftp(null, {
    sftpId: opened.sftpId,
    path: ".cache",
    encoding: "utf-8",
  });

  assert.deepEqual(calls.realpath, []);
  assert.deepEqual(calls.rmdir, [".cache"]);
});

test("concurrent mkdir recovers when a sibling already created the parent", async () => {
  const existing = new Set(["/remote"]);
  const calls = { mkdir: [] };
  const channel = {
    readdir(_targetPath, callback) {
      callback(null, []);
    },
    unlink(_targetPath, callback) {
      callback(null);
    },
    stat(targetPath, callback) {
      if (existing.has(targetPath) || targetPath === "/") {
        callback(null, { isDirectory: () => true });
        return;
      }
      const error = new Error(`No such file: ${targetPath}`);
      error.code = 2;
      callback(error);
    },
    mkdir(targetPath, callback) {
      calls.mkdir.push(targetPath);
      if (existing.has(targetPath)) {
        const error = new Error(`Failure: ${targetPath}`);
        error.code = 11;
        callback(error);
        return;
      }
      existing.add(targetPath);
      callback(null);
    },
    realpath(targetPath, callback) {
      callback(null, targetPath);
    },
  };
  const client = {
    sftp: channel,
    realPath: (targetPath) => Promise.resolve(targetPath),
  };
  sftpBridge.init({
    electronModule: {},
    sessions: new Map(),
    sftpClients: new Map([["mkdir-race", client]]),
  });

  await Promise.all([
    sftpBridge.mkdirSftp(null, { sftpId: "mkdir-race", path: "/remote/docs/a", encoding: "utf-8" }),
    sftpBridge.mkdirSftp(null, { sftpId: "mkdir-race", path: "/remote/docs/b", encoding: "utf-8" }),
  ]);

  assert.ok(existing.has("/remote/docs"));
  assert.ok(existing.has("/remote/docs/a"));
  assert.ok(existing.has("/remote/docs/b"));
  assert.ok(calls.mkdir.includes("/remote/docs"));
});

test("mkdir treats an already-created directory as success and continues nested segments", async () => {
  const existing = new Set(["/remote", "/remote/docs"]);
  const forcedStatMiss = new Set();
  const mkdirFailures = [];
  const channel = {
    readdir(_targetPath, callback) {
      callback(null, []);
    },
    unlink(_targetPath, callback) {
      callback(null);
    },
    stat(targetPath, callback) {
      if (targetPath === "/remote/docs" && !forcedStatMiss.has(targetPath)) {
        forcedStatMiss.add(targetPath);
        const error = new Error(`No such file: ${targetPath}`);
        error.code = 2;
        callback(error);
        return;
      }
      if (existing.has(targetPath) || targetPath === "/") {
        callback(null, { isDirectory: () => true });
        return;
      }
      const error = new Error(`No such file: ${targetPath}`);
      error.code = 2;
      callback(error);
    },
    mkdir(targetPath, callback) {
      if (existing.has(targetPath)) {
        const error = new Error(`Failure: ${targetPath}`);
        error.code = 11;
        mkdirFailures.push(targetPath);
        callback(error);
        return;
      }
      existing.add(targetPath);
      callback(null);
    },
    realpath(targetPath, callback) {
      callback(null, targetPath);
    },
  };
  sftpBridge.init({
    electronModule: {},
    sessions: new Map(),
    sftpClients: new Map([["mkdir-exists", {
      sftp: channel,
      realPath: (targetPath) => Promise.resolve(targetPath),
    }]]),
  });

  await sftpBridge.mkdirSftp(null, {
    sftpId: "mkdir-exists",
    path: "/remote/docs/nested",
    encoding: "utf-8",
  });

  assert.deepEqual(mkdirFailures, ["/remote/docs"]);
  assert.ok(existing.has("/remote/docs/nested"));
});
