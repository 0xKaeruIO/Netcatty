const test = require("node:test");
const assert = require("node:assert/strict");
const { Agent } = require("undici");
const {
  INSECURE_CONNECT,
  shouldSkipTlsVerify,
  getInsecureDispatcher,
  withOrgCenterTls,
} = require("./orgCenterTls.cjs");

test("shouldSkipTlsVerify is opt-in only", () => {
  assert.equal(shouldSkipTlsVerify(true), true);
  assert.equal(shouldSkipTlsVerify(false), false);
  assert.equal(shouldSkipTlsVerify(undefined), false);
  assert.equal(shouldSkipTlsVerify("true"), false);
});

test("withOrgCenterTls leaves verified requests unchanged", () => {
  const init = { headers: { Accept: "application/json" } };
  assert.equal(withOrgCenterTls(init, false).dispatcher, undefined);
  assert.deepEqual(withOrgCenterTls(init, false), init);
});

test("withOrgCenterTls uses an undici agent that skips TLS verify", () => {
  const init = withOrgCenterTls({ method: "GET" }, true);
  assert.equal(init.method, "GET");
  assert.ok(init.dispatcher instanceof Agent);
  assert.equal(init.dispatcher, getInsecureDispatcher());
  assert.equal(INSECURE_CONNECT.rejectUnauthorized, false);
});
