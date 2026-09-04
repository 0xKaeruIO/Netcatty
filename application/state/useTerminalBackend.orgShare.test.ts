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

test("guest boot closeSession does not leave the share or close host SSH", () => {
  const source = readFileSync(new URL("./useTerminalBackend.ts", import.meta.url), "utf8");
  const closeIndex = source.indexOf("const closeSession = useCallback");
  const guestCloseIndex = source.indexOf("isOrgShareGuestSession(sessionId)", closeIndex);
  const backendCloseIndex = source.indexOf("bridge?.closeSession", closeIndex);
  assert.notEqual(closeIndex, -1);
  assert.notEqual(guestCloseIndex, -1);
  assert.notEqual(backendCloseIndex, -1);
  const guestBranch = source.slice(guestCloseIndex, backendCloseIndex);
  assert.match(guestBranch, /return;/);
  assert.doesNotMatch(guestBranch, /orgCenterShareLeave/);
});

test("guest input failures are logged to the console", () => {
  const source = readFileSync(new URL("./useTerminalBackend.ts", import.meta.url), "utf8");
  const writeIndex = source.indexOf("const writeToSession = useCallback");
  const writeBody = source.slice(writeIndex, source.indexOf("const interruptSession", writeIndex));
  assert.match(writeBody, /console\.error\("\[orgCenterShare\] guest input unavailable"/);
  assert.match(writeBody, /console\.error\("\[orgCenterShare\] guest input failed"/);
});
