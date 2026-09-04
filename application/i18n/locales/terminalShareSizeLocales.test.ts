import test from "node:test";
import assert from "node:assert/strict";

import en from "./en.ts";
import ru from "./ru.ts";
import es from "./es.ts";
import zhCN from "./zh-CN.ts";

const shareSizeKeys = [
  "terminal.share.sizeTitle",
  "terminal.share.ptySize",
  "terminal.share.sizeFromSelf",
  "terminal.share.sizeFromPeer",
  "terminal.share.sizeFromMixed",
  "terminal.share.sizeMatched",
  "terminal.share.selfCapacity",
  "terminal.share.peerCapacity",
  "terminal.share.scaleToFit",
] as const;

test("shared PTY size copy exists in every bundled locale", () => {
  for (const [locale, messages] of Object.entries({ en, ru, es, zhCN })) {
    for (const key of shareSizeKeys) {
      assert.equal(typeof messages[key], "string", `${locale} is missing ${key}`);
      assert.notEqual(messages[key], "", `${locale} has empty ${key}`);
    }
  }
});
