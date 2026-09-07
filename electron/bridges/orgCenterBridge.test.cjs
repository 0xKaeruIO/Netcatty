const test = require("node:test");
const assert = require("node:assert/strict");
const { Agent } = require("undici");
const { normalizeBaseUrl, registerHandlers } = require("./orgCenterBridge.cjs");

test("normalizeBaseUrl strips trailing slashes and rejects non-http", () => {
  assert.equal(normalizeBaseUrl("http://ops.example.com:4780/"), "http://ops.example.com:4780");
  assert.throws(() => normalizeBaseUrl("ftp://ops.example.com"), /http or https/);
  assert.throws(() => normalizeBaseUrl("not-a-url"), /Invalid/);
});

test("org center HTTPS fetch skips certificate verification only when requested", async () => {
  const seen = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (_url, init) => {
    seen.push(init);
    return {
      ok: true,
      json: async () => ({ name: "Ops", version: 1, center: { id: "c", name: "Ops" }, hosts: [] }),
    };
  };
  try {
    const ipcMain = {
      handle(channel, fn) {
        this[channel] = fn;
      },
    };
    registerHandlers(ipcMain);
    await ipcMain["netcatty:orgCenter:health"]({}, {
      url: "https://center.local",
      skipTlsVerify: true,
    });
    assert.ok(seen[0].dispatcher instanceof Agent);
    await ipcMain["netcatty:orgCenter:fetchCatalog"]({}, {
      url: "https://center.local",
      apiKey: "ncc_test",
    });
    assert.equal(seen[1].dispatcher, undefined);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
