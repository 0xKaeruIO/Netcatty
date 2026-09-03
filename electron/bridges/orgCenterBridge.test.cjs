const test = require("node:test");
const assert = require("node:assert/strict");
const { normalizeBaseUrl } = require("./orgCenterBridge.cjs");

test("normalizeBaseUrl strips trailing slashes and rejects non-http", () => {
  assert.equal(normalizeBaseUrl("http://ops.example.com:4780/"), "http://ops.example.com:4780");
  assert.throws(() => normalizeBaseUrl("ftp://ops.example.com"), /http or https/);
  assert.throws(() => normalizeBaseUrl("not-a-url"), /Invalid/);
});
