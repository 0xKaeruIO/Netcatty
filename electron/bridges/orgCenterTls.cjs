/**
 * TLS helpers for organization-center HTTP and WebSocket calls.
 * Self-signed / internal HTTPS centers can opt out of certificate verification.
 */

"use strict";

const { Agent } = require("undici");

const INSECURE_CONNECT = { rejectUnauthorized: false };

let insecureDispatcher;

function shouldSkipTlsVerify(value) {
  return value === true;
}

function getInsecureDispatcher() {
  if (!insecureDispatcher) {
    insecureDispatcher = new Agent({
      connect: INSECURE_CONNECT,
    });
  }
  return insecureDispatcher;
}

function withOrgCenterTls(init = {}, skipTlsVerify = false) {
  if (!shouldSkipTlsVerify(skipTlsVerify)) return init;
  return { ...init, dispatcher: getInsecureDispatcher() };
}

function openOrgCenterWebSocket(url, skipTlsVerify = false) {
  if (typeof WebSocket !== "function") {
    throw new Error("WebSocket is unavailable in this process.");
  }
  if (shouldSkipTlsVerify(skipTlsVerify)) {
    return new WebSocket(url, { dispatcher: getInsecureDispatcher() });
  }
  return new WebSocket(url);
}

module.exports = {
  INSECURE_CONNECT,
  shouldSkipTlsVerify,
  getInsecureDispatcher,
  withOrgCenterTls,
  openOrgCenterWebSocket,
};
