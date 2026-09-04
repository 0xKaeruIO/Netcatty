"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const {
  encryptXshellPassword,
} = require("../../domain/xshellPassword.shared.cjs");
const {
  decryptXshellPasswordForCurrentUser,
  getXshellDecryptContext,
} = require("./xshellPassword.cjs");

const SAMPLE_IDENTITY = {
  username: "asus",
  sid: "S-1-5-21-736521517-4232353097-1340300005-1001",
};

test("getXshellDecryptContext includes username, SID, and encoding", () => {
  const context = getXshellDecryptContext(SAMPLE_IDENTITY);
  assert.equal(context.username, SAMPLE_IDENTITY.username);
  assert.equal(context.sid, SAMPLE_IDENTITY.sid);
  assert.ok(typeof context.encoding === "string" && context.encoding.length > 0);
});

test("decryptXshellPasswordForCurrentUser decrypts with injected identity", () => {
  const ciphertext = encryptXshellPassword("wwwuser-secret", "7.1", {
    ...SAMPLE_IDENTITY,
    encoding: "utf8",
  });
  assert.equal(
    decryptXshellPasswordForCurrentUser(ciphertext, "7.1", SAMPLE_IDENTITY),
    "wwwuser-secret",
  );
});

test("decryptXshellPasswordForCurrentUser returns nothing for the wrong SID", () => {
  const ciphertext = encryptXshellPassword("imported-secret", "7.1", {
    ...SAMPLE_IDENTITY,
    encoding: "utf8",
  });
  const decrypted = decryptXshellPasswordForCurrentUser(ciphertext, "7.1", {
    username: "wrong",
    sid: "S-1-5-18",
  });
  assert.notEqual(decrypted, "imported-secret");
});
