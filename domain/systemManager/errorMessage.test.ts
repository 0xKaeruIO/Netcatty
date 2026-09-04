import assert from "node:assert/strict";
import test from "node:test";
import {
  SYSTEM_MANAGER_SHARE_READ_ONLY_CODE,
  SYSTEM_MANAGER_SHARE_READ_ONLY_ERROR,
  formatSystemManagerError,
  resolveSystemManagerErrorKey,
} from "./errorMessage.ts";

test("share read-only and missing-session errors map to i18n keys", () => {
  assert.equal(
    resolveSystemManagerErrorKey(SYSTEM_MANAGER_SHARE_READ_ONLY_ERROR),
    "systemManager.errors.shareReadOnly",
  );
  assert.equal(
    resolveSystemManagerErrorKey("ignored", SYSTEM_MANAGER_SHARE_READ_ONLY_CODE),
    "systemManager.errors.shareReadOnly",
  );
  assert.equal(
    resolveSystemManagerErrorKey("Session not found or not connected"),
    "systemManager.errors.sessionNotFound",
  );
  assert.equal(
    formatSystemManagerError(SYSTEM_MANAGER_SHARE_READ_ONLY_ERROR, (key) => `t:${key}`),
    "t:systemManager.errors.shareReadOnly",
  );
});
