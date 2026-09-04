import assert from "node:assert/strict";
import test from "node:test";
import {
  computeShareFillScale,
  flipShareSizeSource,
  formatOrgShareGuestLabel,
  isOrgShareGuestRole,
  proposeShareCapacity,
  resolveSharedPtyLayout,
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

test("shared PTY size uses the smaller grid on each axis", () => {
  assert.deepEqual(
    resolveSharedPtyLayout({ cols: 120, rows: 40 }, []),
    { cols: 120, rows: 40, source: "self-only" },
  );
  assert.deepEqual(
    resolveSharedPtyLayout({ cols: 120, rows: 40 }, [{ cols: 80, rows: 24 }]),
    { cols: 80, rows: 24, source: "peer" },
  );
  assert.deepEqual(
    resolveSharedPtyLayout({ cols: 80, rows: 24 }, [{ cols: 120, rows: 40 }]),
    { cols: 80, rows: 24, source: "self" },
  );
  assert.deepEqual(
    resolveSharedPtyLayout({ cols: 120, rows: 24 }, [{ cols: 80, rows: 40 }]),
    { cols: 80, rows: 24, source: "mixed" },
  );
  assert.deepEqual(
    resolveSharedPtyLayout({ cols: 100, rows: 30 }, [{ cols: 100, rows: 30 }]),
    { cols: 100, rows: 30, source: "matched" },
  );
  assert.equal(flipShareSizeSource("self"), "peer");
  assert.equal(flipShareSizeSource("peer"), "self");
  assert.equal(flipShareSizeSource("mixed"), "mixed");
});

test("share fill scale only grows the larger viewport", () => {
  assert.equal(computeShareFillScale(800, 400, 800, 400), 1);
  assert.equal(computeShareFillScale(1600, 800, 800, 400), 2);
  assert.equal(computeShareFillScale(100, 100, 800, 400), 1);
  assert.deepEqual(
    proposeShareCapacity(800, 480, 10, 20),
    { cols: 80, rows: 24 },
  );
});
