import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("guest input is routed to the share bridge, not the local PTY write", () => {
  const source = readFileSync(new URL("./useTerminalBackend.ts", import.meta.url), "utf8");
  const writeIndex = source.indexOf("const writeToSession = useCallback");
  const guestWriteIndex = source.indexOf("isOrgShareGuestSession(sessionId)", writeIndex);
  const shareInputIndex = source.indexOf("orgCenterShareGuestInput", guestWriteIndex);
  const localWriteIndex = source.indexOf("bridge?.writeToSession", shareInputIndex);
  assert.notEqual(writeIndex, -1);
  assert.notEqual(guestWriteIndex, -1);
  assert.notEqual(shareInputIndex, -1);
  assert.notEqual(localWriteIndex, -1);
  assert.ok(guestWriteIndex < shareInputIndex && shareInputIndex < localWriteIndex);
});

test("guest close leaves the share instead of closing the host SSH session", () => {
  const source = readFileSync(new URL("./useTerminalBackend.ts", import.meta.url), "utf8");
  const closeIndex = source.indexOf("const closeSession = useCallback");
  const guestCloseIndex = source.indexOf("isOrgShareGuestSession(sessionId)", closeIndex);
  const leaveIndex = source.indexOf("orgCenterShareLeave", guestCloseIndex);
  const backendCloseIndex = source.indexOf("bridge?.closeSession", leaveIndex);
  assert.notEqual(closeIndex, -1);
  assert.notEqual(guestCloseIndex, -1);
  assert.notEqual(leaveIndex, -1);
  assert.notEqual(backendCloseIndex, -1);
  assert.ok(guestCloseIndex < leaveIndex && leaveIndex < backendCloseIndex);
  assert.match(source.slice(guestCloseIndex, backendCloseIndex), /return;/);
});
