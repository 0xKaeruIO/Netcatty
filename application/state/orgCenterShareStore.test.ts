import assert from "node:assert/strict";
import test from "node:test";
import {
  clearGuestShare,
  clearHostShare,
  isOrgShareGuestSession,
  markGuestShare,
  markHostShareActive,
  shouldBlockOrgShareFileTransferForSession,
} from "./orgCenterShareStore";

test("only the shared host session and guests block file transfer", () => {
  markHostShareActive("host-1", { centerId: "c1", pin: "123456", roomId: "r1" });
  markGuestShare("guest-1", {
    centerId: "c1",
    pin: "123456",
    label: "lab",
    status: "active",
  });
  assert.equal(shouldBlockOrgShareFileTransferForSession("host-1"), true);
  assert.equal(shouldBlockOrgShareFileTransferForSession("guest-1"), true);
  assert.equal(shouldBlockOrgShareFileTransferForSession("other"), false);
  assert.equal(isOrgShareGuestSession("guest-1"), true);
  clearHostShare("host-1");
  clearGuestShare("guest-1");
  assert.equal(shouldBlockOrgShareFileTransferForSession("host-1"), false);
  assert.equal(shouldBlockOrgShareFileTransferForSession("guest-1"), false);
});
