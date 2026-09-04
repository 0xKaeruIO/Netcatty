import assert from "node:assert/strict";
import test from "node:test";

import {
  decryptXshellPassword,
  encryptXshellPassword,
} from "./xshellPassword.ts";

const SAMPLE_IDENTITY = {
  username: "asus",
  sid: "S-1-5-21-736521517-4232353097-1340300005-1001",
};

const utf8Identity = {
  ...SAMPLE_IDENTITY,
  encoding: "utf8",
};

test("Xshell 7.1 passwords round-trip with reversed username+SID key material", () => {
  const ciphertext = encryptXshellPassword("W8secretPN__%", "7.1", utf8Identity);
  assert.equal(decryptXshellPassword(ciphertext, "7.1", utf8Identity), "W8secretPN__%");
});

test("Xshell 7.0 uses username+SID without reversing", () => {
  const ciphertext = encryptXshellPassword("legacy-secret", "7.0", utf8Identity);
  assert.equal(decryptXshellPassword(ciphertext, "7.0", utf8Identity), "legacy-secret");
  assert.notEqual(decryptXshellPassword(ciphertext, "7.1", utf8Identity), "legacy-secret");
});

test("Xshell 6 uses the same username+SID schedule as 7.0", () => {
  const ciphertext = encryptXshellPassword("six-secret", "6.0", utf8Identity);
  assert.equal(decryptXshellPassword(ciphertext, "6.0", utf8Identity), "six-secret");
  assert.equal(decryptXshellPassword(ciphertext, "7.0", utf8Identity), "six-secret");
});

test("Xshell 5.2 uses SHA256(SID) and not the username", () => {
  const ciphertext = encryptXshellPassword("sid-only", "5.2", SAMPLE_IDENTITY);
  assert.equal(decryptXshellPassword(ciphertext, "5.2", SAMPLE_IDENTITY), "sid-only");
  assert.equal(
    decryptXshellPassword(ciphertext, "5.2", { ...SAMPLE_IDENTITY, username: "other-user" }),
    "sid-only",
  );
});

test("Xshell 5.0 uses the static NetSarang key", () => {
  const ciphertext = encryptXshellPassword("old-pass", "5.0", SAMPLE_IDENTITY);
  assert.equal(decryptXshellPassword(ciphertext, "5.0", SAMPLE_IDENTITY), "old-pass");
  assert.equal(
    decryptXshellPassword(ciphertext, "5.0", { username: "nobody", sid: "S-1-5-18" }),
    "old-pass",
  );
});
