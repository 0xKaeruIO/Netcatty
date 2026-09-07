import assert from "node:assert/strict";
import test from "node:test";
import { formatOrgCenterError } from "./formatOrgCenterError.ts";

const t = (key: string) => `t:${key}`;

test("known org center messages map to i18n keys", () => {
  assert.equal(
    formatOrgCenterError("Invalid organization center API key.", t),
    "t:settings.orgCenter.error.apiKey",
  );
  assert.equal(
    formatOrgCenterError("Could not reach the organization center.", t),
    "t:settings.orgCenter.error.generic",
  );
  assert.equal(
    formatOrgCenterError("", t),
    "t:settings.orgCenter.error.generic",
  );
});

test("electron IPC wrappers unwrap to the inner friendly message", () => {
  assert.equal(
    formatOrgCenterError(
      "Error invoking remote method 'netcatty:orgCenter:fetchCatalog': Error: Invalid organization center API key.",
      t,
    ),
    "t:settings.orgCenter.error.apiKey",
  );
  assert.equal(
    formatOrgCenterError(
      'Error invoking remote method "netcatty:orgCenterShare:start": Error: Organization center request timed out.',
      t,
    ),
    "t:settings.orgCenter.error.timeout",
  );
});

test("technical fetch and network failures become user-facing copy", () => {
  assert.equal(
    formatOrgCenterError(
      "Error invoking remote method 'netcatty:orgCenterShare:start': TypeError: fetch failed",
      t,
    ),
    "t:settings.orgCenter.error.network",
  );
  assert.equal(
    formatOrgCenterError("TypeError: fetch failed", t),
    "t:settings.orgCenter.error.network",
  );
  assert.equal(
    formatOrgCenterError("connect ECONNREFUSED 127.0.0.1:4780", t),
    "t:settings.orgCenter.error.network",
  );
  assert.equal(
    formatOrgCenterError("getaddrinfo ENOTFOUND center.example", t),
    "t:settings.orgCenter.error.network",
  );
  assert.equal(
    formatOrgCenterError("Connect Timeout Error (UND_ERR_CONNECT_TIMEOUT)", t),
    "t:settings.orgCenter.error.timeout",
  );
});

test("http status and share-room errors map without leaking ipc prefixes", () => {
  assert.equal(formatOrgCenterError("HTTP 401", t), "t:settings.orgCenter.error.apiKey");
  assert.equal(formatOrgCenterError("HTTP 502", t), "t:settings.orgCenter.error.generic");
  assert.equal(
    formatOrgCenterError("Organization center returned an unsupported share room.", t),
    "t:settings.orgCenter.error.shareRoom",
  );
  assert.equal(
    formatOrgCenterError(
      "Error invoking remote method 'netcatty:orgCenterShare:join': Error: PIN expired",
      t,
    ),
    "PIN expired",
  );
});
