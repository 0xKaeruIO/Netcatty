const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const {
  resolveTerminalBackgroundFeatureEnabled,
  writeBakedTerminalBackgroundFeatureFlag,
} = require("./terminalBackgroundFeatureFlag.cjs");

test("terminal background feature defaults to on", () => {
  assert.equal(resolveTerminalBackgroundFeatureEnabled({}), true);
  assert.equal(resolveTerminalBackgroundFeatureEnabled({ NETCATTY_TERMINAL_BACKGROUND: "" }), true);
  assert.equal(resolveTerminalBackgroundFeatureEnabled({ NETCATTY_TERMINAL_BACKGROUND: "1" }), true);
});

test("terminal background feature turns off for 0 / false / off", () => {
  assert.equal(resolveTerminalBackgroundFeatureEnabled({ NETCATTY_TERMINAL_BACKGROUND: "0" }), false);
  assert.equal(resolveTerminalBackgroundFeatureEnabled({ NETCATTY_TERMINAL_BACKGROUND: "false" }), false);
  assert.equal(resolveTerminalBackgroundFeatureEnabled({ VITE_TERMINAL_BACKGROUND: "off" }), false);
});

test("VITE_TERMINAL_BACKGROUND wins when both aliases are set", () => {
  assert.equal(resolveTerminalBackgroundFeatureEnabled({
    VITE_TERMINAL_BACKGROUND: "0",
    NETCATTY_TERMINAL_BACKGROUND: "1",
  }), false);
});

test("baked feature-flag file is a loadable CJS module", () => {
  const filePath = path.join(os.tmpdir(), `netcatty-feature-flags-${Date.now()}.cjs`);
  try {
    writeBakedTerminalBackgroundFeatureFlag(filePath, false);
    assert.equal(require(filePath).TERMINAL_BACKGROUND_IMAGE_ENABLED, false);
  } finally {
    fs.rmSync(filePath, { force: true });
  }
});
