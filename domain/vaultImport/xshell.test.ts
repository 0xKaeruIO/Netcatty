import test from "node:test";
import assert from "node:assert/strict";

import {
  MAX_XSHELL_DESCRIPTION_LENGTH,
  parseXshellSession,
} from "./xshell.ts";

const sessionWithDescription = (description: string): string => [
  "[SessionInfo]",
  "Version=7.0",
  "Description=Xshell session file",
  "[CONNECTION]",
  "Port=22",
  "Host=192.168.0.3",
  "Protocol=SSH",
  `Description=${description}`,
  "[CONNECTION:AUTHENTICATION]",
  "UserName=root",
].join("\n");

test("Xshell Description converts literal \\r\\n into notes newlines", () => {
  const parsed = parseXshellSession(sessionWithDescription("jump box\\r\\nproduction\\r\\nregion east"));
  assert.equal(parsed.notes, "jump box\nproduction\nregion east");
});

test("Xshell Description also accepts literal \\n and \\r escapes", () => {
  const parsed = parseXshellSession(sessionWithDescription("first\\nsecond\\rthird"));
  assert.equal(parsed.notes, "first\nsecond\nthird");
});

test("Xshell Description ignores generic session file text", () => {
  const parsed = parseXshellSession(sessionWithDescription("Xshell session file"));
  assert.equal(parsed.notes, undefined);
});

test("Xshell Description is capped at 2048 characters after newline decoding", () => {
  const body = "line\\r\\n".repeat(600);
  const parsed = parseXshellSession(sessionWithDescription(body));
  assert.equal(parsed.notes?.length, MAX_XSHELL_DESCRIPTION_LENGTH);
  assert.equal(parsed.notes?.startsWith("line\nline\n"), true);
  assert.equal(parsed.notes?.includes("\\r\\n"), false);
});
