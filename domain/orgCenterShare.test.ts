import assert from "node:assert/strict";
import test from "node:test";
import {
  formatOrgShareGuestLabel,
  isOrgShareGuestRole,
  shouldBlockOrgShareFileTransfer,
} from "./orgCenterShare";

test("guest and host-sharing sessions block SFTP and YMODEM", () => {
  assert.equal(shouldBlockOrgShareFileTransfer({ orgShareRole: "guest" }), true);
  assert.equal(shouldBlockOrgShareFileTransfer({ hostSharing: true }), true);
  assert.equal(shouldBlockOrgShareFileTransfer({ orgShareRole: "host" }), false);
  assert.equal(shouldBlockOrgShareFileTransfer({}), false);
});

test("guest label prefers the host name from the center", () => {
  assert.equal(formatOrgShareGuestLabel("123456", "prod-1"), "prod-1");
  assert.equal(formatOrgShareGuestLabel("123456"), "Share · 123456");
  assert.equal(isOrgShareGuestRole("guest"), true);
  assert.equal(isOrgShareGuestRole("host"), false);
});
