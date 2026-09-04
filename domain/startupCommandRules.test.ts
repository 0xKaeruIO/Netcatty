import test from "node:test";
import assert from "node:assert/strict";

import {
  appendStartupRuleExpectBuffer,
  parseStartupCommandRulesInput,
  redactStartupCommandRulesForAgent,
  sanitizeStartupCommandRules,
  startupCommandRuleExpectMatches,
  usableStartupCommandRules,
} from "./startupCommandRules.ts";

test("sanitizeStartupCommandRules keeps expect/send pairs and drops junk", () => {
  assert.deepEqual(sanitizeStartupCommandRules(null), []);
  assert.deepEqual(
    sanitizeStartupCommandRules([
      { expect: "", send: "ssh jingyang@192.168.0.127" },
      { expect: "password:", send: "secret" },
      "nope",
      { expect: 1, send: 2 },
    ]),
    [
      { expect: "", send: "ssh jingyang@192.168.0.127" },
      { expect: "password:", send: "secret" },
      { expect: "1", send: "2" },
    ],
  );
});

test("usableStartupCommandRules skips empty send", () => {
  assert.deepEqual(
    usableStartupCommandRules([
      { expect: "", send: "ssh host" },
      { expect: "password:", send: "" },
    ]),
    [{ expect: "", send: "ssh host" }],
  );
});

test("parseStartupCommandRulesInput accepts JSON and arrays", () => {
  const parsed = parseStartupCommandRulesInput('[{"expect":"password:","send":"x"}]');
  assert.equal(parsed.ok, true);
  if (parsed.ok) {
    assert.deepEqual(parsed.rules, [{ expect: "password:", send: "x" }]);
  }
  const empty = parseStartupCommandRulesInput([]);
  assert.equal(empty.ok, true);
  if (empty.ok) assert.equal(empty.rules, undefined);
  const bad = parseStartupCommandRulesInput("{");
  assert.equal(bad.ok, false);
});

test("startupCommandRuleExpectMatches is case-insensitive and ignores empty expect", () => {
  assert.equal(startupCommandRuleExpectMatches("anything", ""), true);
  assert.equal(startupCommandRuleExpectMatches("Password: ", "password:"), true);
  assert.equal(startupCommandRuleExpectMatches("login:", "password:"), false);
});

test("appendStartupRuleExpectBuffer strips CSI and stays bounded", () => {
  const next = appendStartupRuleExpectBuffer("", "\x1b[31mPassword:\x1b[0m ");
  assert.equal(startupCommandRuleExpectMatches(next, "password:"), true);
  const big = "x".repeat(9000) + "password:";
  const bounded = appendStartupRuleExpectBuffer("", big);
  assert.ok(bounded.length <= 8192);
  assert.equal(startupCommandRuleExpectMatches(bounded, "password:"), true);
});

test("redactStartupCommandRulesForAgent hides send payloads", () => {
  assert.deepEqual(
    redactStartupCommandRulesForAgent([{ expect: "password:", send: "secret" }]),
    [{ expect: "password:", send: "[redacted]" }],
  );
});
