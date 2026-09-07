import assert from "node:assert/strict";
import test from "node:test";

import { detectVaultImportFormat, importVaultHostsFromText } from "../vaultImport.ts";
import {
  collectGroupExportPaths,
  exportVaultHostsToJson,
  importVaultHostsFromJson,
} from "./jsonHosts.ts";
import type { Host, SSHKey } from "../models.ts";

const exampleJson = `{
  "groups": [
    "production",
    "production/web",
    "staging/empty"
  ],
  "hosts": [
    {
      "label": "prod-web-1",
      "hostname": "10.0.1.12",
      "port": 22,
      "username": "deploy",
      "group": "production/web",
      "tags": ["linux", "prod"],
      "os": "linux",
      "protocol": "ssh",
      "deviceType": "general",
      "notes": "entry",
      "password": "change-me",
      "privateKey": "-----BEGIN OPENSSH PRIVATE KEY-----\\nTEST-KEY\\n-----END OPENSSH PRIVATE KEY-----",
      "passphrase": "key-pass",
      "startupCommand": "",
      "startupCommandRunMode": "rules",
      "startupCommandRules": [
        { "expect": "password:", "send": "inner-secret" }
      ],
      "visibility": "all",
      "visibleKeyIds": []
    },
    {
      "label": "core-sw-1",
      "hostname": "10.0.9.1",
      "port": 23,
      "username": "admin",
      "group": "network",
      "tags": ["switch"],
      "os": "linux",
      "protocol": "telnet",
      "deviceType": "network",
      "notes": "",
      "password": "cisco",
      "privateKey": "",
      "passphrase": "",
      "startupCommand": "enable",
      "startupCommandRunMode": "lineDelay",
      "startupCommandRules": [],
      "visibility": "all",
      "visibleKeyIds": []
    }
  ]
}`;

test("detectVaultImportFormat recognizes Center host list JSON", () => {
  assert.equal(detectVaultImportFormat(exampleJson), "json");
  assert.equal(importVaultHostsFromText("json", exampleJson).hosts.length, 2);
});

test("JSON import keeps plaintext secrets, rules, empty groups, and imported keys", () => {
  const result = importVaultHostsFromJson(exampleJson);
  assert.equal(result.hosts.length, 2);
  assert.ok(result.groups.includes("staging/empty"));
  assert.ok(result.groups.includes("production/web"));

  const web = result.hosts.find((host) => host.label === "prod-web-1");
  assert.ok(web);
  assert.equal(web.password, "change-me");
  assert.equal(web.startupCommandRunMode, "rules");
  assert.equal(web.startupCommandRules?.[0]?.send, "inner-secret");
  assert.ok(web.identityFileId);
  assert.equal(result.keys?.length, 1);
  assert.equal(result.keys?.[0]?.id, web.identityFileId);
  assert.equal(result.keys?.[0]?.passphrase, "key-pass");
  assert.match(result.keys?.[0]?.privateKey ?? "", /TEST-KEY/);

  const sw = result.hosts.find((host) => host.label === "core-sw-1");
  assert.ok(sw);
  assert.equal(sw.protocol, "telnet");
  assert.equal(sw.port, 23);
  assert.equal(sw.password, "cisco");
  assert.equal(sw.deviceType, "network");
  assert.equal(sw.startupCommandRunMode, "lineDelay");
  assert.equal(sw.startupCommand, "enable");
});

test("JSON export is plaintext and round-trips through import", () => {
  const key: SSHKey = {
    id: "key-1",
    label: "ops",
    type: "ED25519",
    privateKey: "-----BEGIN OPENSSH PRIVATE KEY-----\nSECRET\n-----END OPENSSH PRIVATE KEY-----",
    passphrase: "phrase",
    savePassphrase: true,
    source: "imported",
    category: "key",
    created: 1,
  };
  const host: Host = {
    id: "host-1",
    label: "web",
    hostname: "10.0.0.8",
    username: "root",
    port: 22,
    group: "ops/web",
    tags: ["prod"],
    os: "linux",
    protocol: "ssh",
    notes: "box",
    password: "root-secret",
    identityFileId: "key-1",
    startupCommand: "tmux",
    startupCommandRunMode: "paste",
  };
  const exported = exportVaultHostsToJson([host], ["ops", "ops/web", "ops/empty"], { keys: [key] });
  assert.equal(exported.exportedCount, 1);
  assert.ok(exported.payload.groups.includes("ops/empty"));
  assert.equal(exported.payload.hosts[0].password, "root-secret");
  assert.match(exported.payload.hosts[0].privateKey, /SECRET/);
  assert.equal(exported.payload.hosts[0].passphrase, "phrase");
  assert.equal(exported.payload.hosts[0].startupCommand, "tmux");
  assert.doesNotMatch(exported.json, /"id":/);

  const imported = importVaultHostsFromJson(exported.json);
  assert.equal(imported.hosts[0]?.hostname, "10.0.0.8");
  assert.equal(imported.hosts[0]?.password, "root-secret");
  assert.equal(imported.keys?.[0]?.privateKey.includes("SECRET"), true);
});

test("group JSON export stays inside the selected subtree", () => {
  const web: Host = {
    id: "h1",
    label: "web",
    hostname: "10.0.0.1",
    username: "root",
    tags: [],
    os: "linux",
    group: "ops/web",
  };
  const db: Host = {
    id: "h2",
    label: "db",
    hostname: "10.0.0.2",
    username: "root",
    tags: [],
    os: "linux",
    group: "ops/db",
  };
  const personal: Host = {
    id: "h3",
    label: "mine",
    hostname: "10.0.0.3",
    username: "root",
    tags: [],
    os: "linux",
    group: "personal",
  };
  const exported = exportVaultHostsToJson(
    [web, db, personal],
    ["ops", "ops/web", "ops/db", "personal"],
    {},
    "ops/web",
  );
  assert.deepEqual(exported.payload.groups, ["ops/web"]);
  assert.equal(exported.exportedCount, 1);
  assert.equal(exported.payload.hosts[0].label, "web");
  assert.deepEqual(collectGroupExportPaths(["ops", "ops/web", "personal"], [web], "ops"), ["ops", "ops/web"]);
});
