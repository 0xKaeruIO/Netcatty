import test from "node:test";
import assert from "node:assert/strict";

import en from "./en.ts";
import ru from "./ru.ts";
import es from "./es.ts";
import zhCN from "./zh-CN.ts";
import zhTW from "./zh-TW.ts";

const keys = [
  "hostDetails.startupCommand.runMode.rules",
  "hostDetails.startupCommand.rules.help",
  "hostDetails.startupCommand.rules.step",
  "hostDetails.startupCommand.rules.expect.placeholder",
  "hostDetails.startupCommand.rules.send.placeholder",
  "hostDetails.startupCommand.rules.add",
  "hostDetails.startupCommand.rules.remove",
] as const;

test("startup command rule-mode copy exists in every bundled locale", () => {
  for (const [locale, messages] of Object.entries({ en, ru, es, zhCN, zhTW })) {
    for (const key of keys) {
      assert.equal(typeof messages[key], "string", `${locale} is missing ${key}`);
      assert.notEqual(messages[key], "", `${locale} has empty ${key}`);
    }
  }
});
