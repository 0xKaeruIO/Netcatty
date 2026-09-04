"use strict";

const crypto = require("node:crypto");

const CHECKSUM_LENGTH = 0x20;
const LEGACY_STATIC_KEY = "!X@s#h$e%l^l&";

function rc4(key, data) {
  const keyBytes = Buffer.isBuffer(key) ? key : Buffer.from(key);
  const input = Buffer.isBuffer(data) ? data : Buffer.from(data);
  const stream = new Array(256);
  const box = new Array(256);
  const output = Buffer.alloc(input.length);
  for (let i = 0; i < 256; i++) {
    stream[i] = keyBytes[i % keyBytes.length];
    box[i] = i;
  }
  let j = 0;
  for (let i = 0; i < 256; i++) {
    j = (j + box[i] + stream[i]) % 256;
    const swap = box[i];
    box[i] = box[j];
    box[j] = swap;
  }
  let x = 0;
  j = 0;
  for (let i = 0; i < input.length; i++) {
    x = (x + 1) % 256;
    j = (j + box[x]) % 256;
    const swap = box[x];
    box[x] = box[j];
    box[j] = swap;
    output[i] = input[i] ^ box[(box[x] + box[j]) % 256];
  }
  return output;
}

function reverseString(value) {
  return Array.from(String(value ?? "")).reverse().join("");
}

function normalizeVersion(version) {
  return String(version ?? "").trim();
}

function resolveAnsiCodec(encoding) {
  const name = String(encoding || "utf8").trim().toLowerCase();
  if (name === "utf-8" || name === "utf8" || name === "ascii" || name === "latin1") {
    return {
      encode: (text) => Buffer.from(text, name === "utf-8" ? "utf8" : name),
      decode: (buf) => Buffer.from(buf).toString(name === "utf-8" ? "utf8" : name),
    };
  }
  try {
    const iconv = require("iconv-lite");
    const iconvName = name === "cp936" || name === "windows-936" ? "gbk" : name;
    if (iconv.encodingExists(iconvName)) {
      return {
        encode: (text) => iconv.encode(text, iconvName),
        decode: (buf) => iconv.decode(Buffer.from(buf), iconvName),
      };
    }
  } catch {
    // Fall through to UTF-8 when iconv-lite is unavailable.
  }
  return {
    encode: (text) => Buffer.from(text, "utf8"),
    decode: (buf) => Buffer.from(buf).toString("utf8"),
  };
}

function sha256(bytes) {
  return crypto.createHash("sha256").update(bytes).digest();
}

function md5(bytes) {
  return crypto.createHash("md5").update(bytes).digest();
}

function deriveXshellKey(version, username, sid, codec) {
  const normalized = normalizeVersion(version);
  if (
    normalized.startsWith("5.0")
    || normalized.startsWith("4")
    || normalized.startsWith("3")
    || normalized.startsWith("2")
  ) {
    return md5(Buffer.from(LEGACY_STATIC_KEY, "ascii"));
  }
  if (normalized.startsWith("5.1") || normalized.startsWith("5.2")) {
    return sha256(Buffer.from(sid, "ascii"));
  }
  if (normalized.startsWith("5") || normalized.startsWith("6") || normalized.startsWith("7.0")) {
    return sha256(codec.encode(`${username}${sid}`));
  }
  if (normalized.startsWith("7")) {
    const reversed = reverseString(reverseString(username) + sid);
    return sha256(codec.encode(reversed));
  }
  return sha256(codec.encode(`${username}${sid}`));
}

function stripTrailingNulls(text) {
  return String(text ?? "").replace(/\0+$/u, "");
}

function looksLikePassword(text) {
  const value = stripTrailingNulls(text);
  if (!value) return false;
  return !/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value);
}

function decodeXshellCiphertext(ciphertext) {
  const raw = String(ciphertext ?? "").replace(/\s+/g, "");
  if (!raw) return null;
  let data;
  try {
    data = Buffer.from(raw, "base64");
  } catch {
    return null;
  }
  if (data.length <= CHECKSUM_LENGTH) return null;
  return data.subarray(0, data.length - CHECKSUM_LENGTH);
}

function decryptXshellPassword(ciphertext, version, options = {}) {
  const payload = decodeXshellCiphertext(ciphertext);
  if (!payload) return undefined;
  const username = String(options.username ?? "");
  const sid = String(options.sid ?? "");
  const codec = resolveAnsiCodec(options.encoding);
  const key = deriveXshellKey(version, username, sid, codec);
  const decrypted = rc4(key, payload);
  const usesAscii = (() => {
    const normalized = normalizeVersion(version);
    return normalized.startsWith("5.0")
      || normalized.startsWith("4")
      || normalized.startsWith("3")
      || normalized.startsWith("2")
      || normalized.startsWith("5.1")
      || normalized.startsWith("5.2");
  })();
  const plaintext = usesAscii
    ? decrypted.toString("ascii")
    : codec.decode(decrypted);
  const password = stripTrailingNulls(plaintext);
  return looksLikePassword(password) ? password : undefined;
}

function encryptXshellPassword(plaintext, version, options = {}) {
  const username = String(options.username ?? "");
  const sid = String(options.sid ?? "");
  const codec = resolveAnsiCodec(options.encoding);
  const key = deriveXshellKey(version, username, sid, codec);
  const usesAscii = (() => {
    const normalized = normalizeVersion(version);
    return normalized.startsWith("5.0")
      || normalized.startsWith("4")
      || normalized.startsWith("3")
      || normalized.startsWith("2")
      || normalized.startsWith("5.1")
      || normalized.startsWith("5.2");
  })();
  const payload = usesAscii
    ? Buffer.from(String(plaintext ?? ""), "ascii")
    : codec.encode(String(plaintext ?? ""));
  const encrypted = rc4(key, payload);
  return Buffer.concat([encrypted, Buffer.alloc(CHECKSUM_LENGTH)]).toString("base64");
}

module.exports = {
  decryptXshellPassword,
  encryptXshellPassword,
  rc4,
};
