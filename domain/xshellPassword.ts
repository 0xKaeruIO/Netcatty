export interface XshellDecryptContext {
  username: string;
  sid: string;
  encoding?: string;
}

const CHECKSUM_LENGTH = 0x20;
const LEGACY_STATIC_KEY = "!X@s#h$e%l^l&";

const SHA256_K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

const MD5_S = [
  7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22,
  5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20,
  4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23,
  6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21,
];

const MD5_K = new Uint32Array(64);
for (let i = 0; i < 64; i++) {
  MD5_K[i] = Math.floor(Math.abs(Math.sin(i + 1)) * 0x100000000);
}

const rotr = (value: number, bits: number): number => (
  (value >>> bits) | (value << (32 - bits))
) >>> 0;

const rotl = (value: number, bits: number): number => (
  (value << bits) | (value >>> (32 - bits))
) >>> 0;

function concatBytes(chunks: Uint8Array[]): Uint8Array {
  const length = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const out = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
}

function sha256(data: Uint8Array): Uint8Array {
  const bitLen = data.length * 8;
  const paddedLen = (((data.length + 9 + 63) >> 6) << 6);
  const padded = new Uint8Array(paddedLen);
  padded.set(data);
  padded[data.length] = 0x80;
  const view = new DataView(padded.buffer);
  view.setUint32(paddedLen - 4, bitLen >>> 0, false);

  let h0 = 0x6a09e667;
  let h1 = 0xbb67ae85;
  let h2 = 0x3c6ef372;
  let h3 = 0xa54ff53a;
  let h4 = 0x510e527f;
  let h5 = 0x9b05688c;
  let h6 = 0x1f83d9ab;
  let h7 = 0x5be0cd19;
  const w = new Uint32Array(64);

  for (let offset = 0; offset < paddedLen; offset += 64) {
    for (let i = 0; i < 16; i++) {
      w[i] = view.getUint32(offset + i * 4, false);
    }
    for (let i = 16; i < 64; i++) {
      const s0 = rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ (w[i - 15] >>> 3);
      const s1 = rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ (w[i - 2] >>> 10);
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0;
    }
    let a = h0;
    let b = h1;
    let c = h2;
    let d = h3;
    let e = h4;
    let f = h5;
    let g = h6;
    let h = h7;
    for (let i = 0; i < 64; i++) {
      const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      const ch = (e & f) ^ (~e & g);
      const temp1 = (h + S1 + ch + SHA256_K[i] + w[i]) >>> 0;
      const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const temp2 = (S0 + maj) >>> 0;
      h = g;
      g = f;
      f = e;
      e = (d + temp1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (temp1 + temp2) >>> 0;
    }
    h0 = (h0 + a) >>> 0;
    h1 = (h1 + b) >>> 0;
    h2 = (h2 + c) >>> 0;
    h3 = (h3 + d) >>> 0;
    h4 = (h4 + e) >>> 0;
    h5 = (h5 + f) >>> 0;
    h6 = (h6 + g) >>> 0;
    h7 = (h7 + h) >>> 0;
  }

  const out = new Uint8Array(32);
  const outView = new DataView(out.buffer);
  outView.setUint32(0, h0, false);
  outView.setUint32(4, h1, false);
  outView.setUint32(8, h2, false);
  outView.setUint32(12, h3, false);
  outView.setUint32(16, h4, false);
  outView.setUint32(20, h5, false);
  outView.setUint32(24, h6, false);
  outView.setUint32(28, h7, false);
  return out;
}

function md5(data: Uint8Array): Uint8Array {
  const bitLen = data.length * 8;
  const paddedLen = (((data.length + 9 + 63) >> 6) << 6);
  const padded = new Uint8Array(paddedLen);
  padded.set(data);
  padded[data.length] = 0x80;
  const view = new DataView(padded.buffer);
  view.setUint32(paddedLen - 8, bitLen >>> 0, true);
  view.setUint32(paddedLen - 4, Math.floor(bitLen / 0x100000000), true);

  let a0 = 0x67452301;
  let b0 = 0xefcdab89;
  let c0 = 0x98badcfe;
  let d0 = 0x10325476;

  for (let offset = 0; offset < paddedLen; offset += 64) {
    const m = new Uint32Array(16);
    for (let i = 0; i < 16; i++) {
      m[i] = view.getUint32(offset + i * 4, true);
    }
    let a = a0;
    let b = b0;
    let c = c0;
    let d = d0;
    for (let i = 0; i < 64; i++) {
      let f: number;
      let g: number;
      if (i < 16) {
        f = (b & c) | (~b & d);
        g = i;
      } else if (i < 32) {
        f = (d & b) | (~d & c);
        g = (5 * i + 1) % 16;
      } else if (i < 48) {
        f = b ^ c ^ d;
        g = (3 * i + 5) % 16;
      } else {
        f = c ^ (b | ~d);
        g = (7 * i) % 16;
      }
      const temp = d;
      d = c;
      c = b;
      b = (b + rotl((a + f + MD5_K[i] + m[g]) >>> 0, MD5_S[i])) >>> 0;
      a = temp;
    }
    a0 = (a0 + a) >>> 0;
    b0 = (b0 + b) >>> 0;
    c0 = (c0 + c) >>> 0;
    d0 = (d0 + d) >>> 0;
  }

  const out = new Uint8Array(16);
  const outView = new DataView(out.buffer);
  outView.setUint32(0, a0, true);
  outView.setUint32(4, b0, true);
  outView.setUint32(8, c0, true);
  outView.setUint32(12, d0, true);
  return out;
}

function rc4(key: Uint8Array, data: Uint8Array): Uint8Array {
  const stream = new Array<number>(256);
  const box = new Array<number>(256);
  const output = new Uint8Array(data.length);
  for (let i = 0; i < 256; i++) {
    stream[i] = key[i % key.length];
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
  for (let i = 0; i < data.length; i++) {
    x = (x + 1) % 256;
    j = (j + box[x]) % 256;
    const swap = box[x];
    box[x] = box[j];
    box[j] = swap;
    output[i] = data[i] ^ box[(box[x] + box[j]) % 256];
  }
  return output;
}

function reverseString(value: string): string {
  return Array.from(value).reverse().join("");
}

function normalizeVersion(version: string | undefined): string {
  return String(version ?? "").trim();
}

function encodeText(text: string, encoding?: string): Uint8Array {
  const name = String(encoding || "utf8").trim().toLowerCase();
  if (name === "latin1") {
    const out = new Uint8Array(text.length);
    for (let i = 0; i < text.length; i++) out[i] = text.charCodeAt(i) & 0xff;
    return out;
  }
  return new TextEncoder().encode(text);
}

function decodeText(bytes: Uint8Array, encoding?: string): string {
  const name = String(encoding || "utf8").trim().toLowerCase();
  if (name === "latin1" || name === "ascii") {
    return Array.from(bytes, (byte) => String.fromCharCode(byte)).join("");
  }
  return new TextDecoder("utf-8", { fatal: false }).decode(bytes);
}

function usesAsciiPassword(version: string | undefined): boolean {
  const normalized = normalizeVersion(version);
  return normalized.startsWith("5.0")
    || normalized.startsWith("4")
    || normalized.startsWith("3")
    || normalized.startsWith("2")
    || normalized.startsWith("5.1")
    || normalized.startsWith("5.2");
}

function deriveXshellKey(
  version: string | undefined,
  username: string,
  sid: string,
  encoding?: string,
): Uint8Array {
  const normalized = normalizeVersion(version);
  if (
    normalized.startsWith("5.0")
    || normalized.startsWith("4")
    || normalized.startsWith("3")
    || normalized.startsWith("2")
  ) {
    return md5(encodeText(LEGACY_STATIC_KEY, "ascii"));
  }
  if (normalized.startsWith("5.1") || normalized.startsWith("5.2")) {
    return sha256(encodeText(sid, "ascii"));
  }
  if (normalized.startsWith("5") || normalized.startsWith("6") || normalized.startsWith("7.0")) {
    return sha256(encodeText(`${username}${sid}`, encoding));
  }
  if (normalized.startsWith("7")) {
    const reversed = reverseString(reverseString(username) + sid);
    return sha256(encodeText(reversed, encoding));
  }
  return sha256(encodeText(`${username}${sid}`, encoding));
}

function stripTrailingNulls(text: string): string {
  return text.replace(/\0+$/u, "");
}

function looksLikePassword(text: string): boolean {
  const value = stripTrailingNulls(text);
  if (!value) return false;
  return !/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value);
}

function decodeBase64(raw: string): Uint8Array | null {
  const value = raw.replace(/\s+/g, "");
  if (!value) return null;
  try {
    if (typeof Buffer !== "undefined") {
      return Uint8Array.from(Buffer.from(value, "base64"));
    }
    const binary = atob(value);
    const out = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
    return out;
  } catch {
    return null;
  }
}

function encodeBase64(data: Uint8Array): string {
  if (typeof Buffer !== "undefined") {
    return Buffer.from(data).toString("base64");
  }
  let binary = "";
  for (const byte of data) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function decodeXshellCiphertext(ciphertext: string): Uint8Array | null {
  const data = decodeBase64(String(ciphertext ?? ""));
  if (!data || data.length <= CHECKSUM_LENGTH) return null;
  return data.subarray(0, data.length - CHECKSUM_LENGTH);
}

export function decryptXshellPassword(
  ciphertext: string,
  version: string | undefined,
  context: XshellDecryptContext,
): string | undefined {
  if (!ciphertext.trim() || !context.username || !context.sid) return undefined;
  const payload = decodeXshellCiphertext(ciphertext);
  if (!payload) return undefined;
  const key = deriveXshellKey(version, context.username, context.sid, context.encoding);
  const decrypted = rc4(key, payload);
  const plaintext = usesAsciiPassword(version)
    ? decodeText(decrypted, "ascii")
    : decodeText(decrypted, context.encoding);
  const password = stripTrailingNulls(plaintext);
  return looksLikePassword(password) ? password : undefined;
}

export function encryptXshellPassword(
  plaintext: string,
  version: string,
  context: XshellDecryptContext,
): string {
  const key = deriveXshellKey(version, context.username, context.sid, context.encoding);
  const payload = usesAsciiPassword(version)
    ? encodeText(plaintext, "ascii")
    : encodeText(plaintext, context.encoding);
  const encrypted = rc4(key, payload);
  return encodeBase64(concatBytes([encrypted, new Uint8Array(CHECKSUM_LENGTH)]));
}
