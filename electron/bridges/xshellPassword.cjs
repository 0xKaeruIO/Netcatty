"use strict";

const os = require("node:os");
const { execFileSync } = require("node:child_process");
const {
  decryptXshellPassword,
} = require("../../domain/xshellPassword.shared.cjs");

let cachedWindowsIdentity = undefined;
let cachedAnsiEncoding = undefined;

function getWindowsAnsiEncoding() {
  if (cachedAnsiEncoding) return cachedAnsiEncoding;
  if (process.platform !== "win32") {
    cachedAnsiEncoding = "utf8";
    return cachedAnsiEncoding;
  }
  try {
    const output = execFileSync(
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-Command", "[System.Text.Encoding]::Default.CodePage"],
      { encoding: "utf8", windowsHide: true, timeout: 4000 },
    ).trim();
    const codePage = Number.parseInt(output, 10);
    if (codePage === 65001) cachedAnsiEncoding = "utf8";
    else if (codePage === 936 || codePage === 54936) cachedAnsiEncoding = "gbk";
    else if (Number.isFinite(codePage) && codePage > 0) cachedAnsiEncoding = `cp${codePage}`;
    else cachedAnsiEncoding = "utf8";
  } catch {
    cachedAnsiEncoding = "utf8";
  }
  return cachedAnsiEncoding;
}

function getWindowsIdentity() {
  if (cachedWindowsIdentity !== undefined) return cachedWindowsIdentity;
  if (process.platform !== "win32") {
    cachedWindowsIdentity = null;
    return cachedWindowsIdentity;
  }
  const username = os.userInfo().username;
  let sid = "";
  try {
    const csv = execFileSync("whoami", ["/user", "/fo", "csv", "/nh"], {
      encoding: "utf8",
      windowsHide: true,
      timeout: 4000,
    }).trim();
    const match = csv.match(/"(S-1-[0-9-]+)"/);
    sid = match ? match[1] : "";
  } catch {
    sid = "";
  }
  cachedWindowsIdentity = username && sid ? { username, sid } : null;
  return cachedWindowsIdentity;
}

function getXshellDecryptContext(identity = getWindowsIdentity()) {
  if (!identity?.username || !identity?.sid) return null;
  return {
    username: identity.username,
    sid: identity.sid,
    encoding: getWindowsAnsiEncoding(),
  };
}

function decryptXshellPasswordForCurrentUser(ciphertext, version, identity = getWindowsIdentity()) {
  const context = getXshellDecryptContext(identity);
  if (!ciphertext || !context) return undefined;
  return decryptXshellPassword(ciphertext, version, context);
}

function registerHandlers(ipcMain) {
  ipcMain.handle("netcatty:xshell:getDecryptContext", () => getXshellDecryptContext());
}

module.exports = {
  decryptXshellPasswordForCurrentUser,
  getWindowsIdentity,
  getXshellDecryptContext,
  registerHandlers,
};
