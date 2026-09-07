import test from "node:test";
import assert from "node:assert/strict";
import {
  applyOrgCenterCatalog,
  catalogGroupPath,
  hostFromCatalog,
  orgHostId,
  removeOrgCenterHosts,
  type OrgCatalog,
  type OrgCenterConnection,
} from "./orgCenter.ts";
import type { Host } from "./models.ts";

const center: OrgCenterConnection = {
  id: "center-1",
  url: "http://ops.example.com:4780",
  apiKey: "ncc_abc",
  name: "Ops",
};

const catalog = (hosts: OrgCatalog["hosts"]): OrgCatalog => ({
  version: 1,
  center: { id: "remote", name: "Ops" },
  generatedAt: 1,
  hosts,
});

test("org host ids are stable per center and catalog id", () => {
  assert.equal(orgHostId("c1", "h1"), "org:c1:h1");
});

test("catalog group is nested under the center name", () => {
  assert.equal(catalogGroupPath("Ops", "production/web"), "Ops/production/web");
  assert.equal(catalogGroupPath("Ops", ""), "Ops");
});

test("applyOrgCenterCatalog inserts hosts and group paths", () => {
  const result = applyOrgCenterCatalog([], [], center, catalog([
    {
      id: "h1",
      label: "web-1",
      hostname: "10.0.1.12",
      port: 22,
      username: "deploy",
      group: "production/web",
      tags: ["prod"],
      os: "linux",
      protocol: "ssh",
      notes: "",
      updatedAt: 1,
    },
  ]));
  assert.equal(result.hosts.length, 1);
  assert.equal(result.hosts[0].id, "org:remote:h1");
  assert.equal(result.hosts[0].orgCenterId, "center-1");
  assert.equal(result.hosts[0].hostname, "10.0.1.12");
  assert.equal(result.hosts[0].group, "Ops/production/web");
  assert.deepEqual(result.customGroups, ["Ops", "Ops/production", "Ops/production/web"]);
  assert.notEqual(result.hosts[0].useSshAgent, true);
});

test("applyOrgCenterCatalog keeps empty catalog groups under the center name", () => {
  const result = applyOrgCenterCatalog([], [], center, {
    version: 1,
    center: { id: "remote", name: "Ops" },
    generatedAt: 1,
    groups: ["staging/empty"],
    hosts: [],
  });
  assert.deepEqual(result.customGroups, ["Ops", "Ops/staging", "Ops/staging/empty"]);
  assert.equal(result.hosts.length, 0);
});

test("catalog hosts do not require a system SSH agent", () => {
  const host = hostFromCatalog(center, {
    id: "h1",
    label: "web-1",
    hostname: "10.0.1.12",
    port: 22,
    username: "deploy",
    group: "",
    tags: [],
    os: "linux",
    protocol: "ssh",
    notes: "",
    updatedAt: 1,
  });
  assert.notEqual(host.useSshAgent, true);
});

test("catalog sync drops the previous agent-required default but keeps an explicit agent socket", () => {
  const forcedAgent = hostFromCatalog(center, {
    id: "h1",
    label: "web-1",
    hostname: "10.0.1.12",
    port: 22,
    username: "deploy",
    group: "",
    tags: [],
    os: "linux",
    protocol: "ssh",
    notes: "",
    updatedAt: 1,
  });
  const withDefault = { ...forcedAgent, useSshAgent: true as const };
  const stripped = applyOrgCenterCatalog([withDefault], [], center, catalog([{
    id: "h1",
    label: "web-1",
    hostname: "10.0.1.12",
    port: 22,
    username: "deploy",
    group: "",
    tags: [],
    os: "linux",
    protocol: "ssh",
    notes: "",
    updatedAt: 2,
  }]));
  assert.notEqual(stripped.hosts[0].useSshAgent, true);

  const withSocket = { ...forcedAgent, useSshAgent: true as const, identityAgent: "\\\\.\\pipe\\openssh-ssh-agent" };
  const kept = applyOrgCenterCatalog([withSocket], [], center, catalog([{
    id: "h1",
    label: "web-1",
    hostname: "10.0.1.12",
    port: 22,
    username: "deploy",
    group: "",
    tags: [],
    os: "linux",
    protocol: "ssh",
    notes: "",
    updatedAt: 2,
  }]));
  assert.equal(kept.hosts[0].useSshAgent, true);
  assert.equal(kept.hosts[0].identityAgent, "\\\\.\\pipe\\openssh-ssh-agent");
});

test("catalog password and private key are applied for one-click login", () => {
  const privateKey = "-----BEGIN OPENSSH PRIVATE KEY-----\nAAAAB3NzaC1yc2EAAAADAQABAAABAQ\n-----END OPENSSH PRIVATE KEY-----";
  const result = applyOrgCenterCatalog([], [], center, catalog([
    {
      id: "h1",
      label: "web-1",
      hostname: "10.0.1.12",
      port: 22,
      username: "deploy",
      group: "",
      tags: [],
      os: "linux",
      protocol: "ssh",
      notes: "",
      password: "hunter2",
      privateKey,
      passphrase: "phrase",
      updatedAt: 1,
    },
  ]));
  assert.equal(result.hosts[0].password, "hunter2");
  assert.equal(result.hosts[0].savePassword, true);
  assert.equal(result.hosts[0].authMethod, "auto");
  assert.equal(result.hosts[0].useSshAgent, false);
  assert.equal(result.hosts[0].identityFileId, "orgkey:remote:h1");
  assert.equal(result.keys.length, 1);
  assert.equal(result.keys[0].id, "orgkey:remote:h1");
  assert.equal(result.keys[0].privateKey, privateKey);
  assert.equal(result.keys[0].passphrase, "phrase");
  assert.ok(["RSA", "ECDSA", "ED25519"].includes(result.keys[0].type));
});

test("catalog credentials overwrite previous local password on the same org host", () => {
  const existing: Host = {
    ...hostFromCatalog(center, {
      id: "h1",
      label: "web-1",
      hostname: "10.0.1.12",
      port: 22,
      username: "deploy",
      group: "",
      tags: [],
      os: "linux",
      protocol: "ssh",
      notes: "",
      updatedAt: 1,
    }),
    password: "old-local",
  };
  const result = applyOrgCenterCatalog([existing], [], center, catalog([
    {
      id: "h1",
      label: "web-1",
      hostname: "10.0.1.12",
      port: 22,
      username: "deploy",
      group: "",
      tags: [],
      os: "linux",
      protocol: "ssh",
      notes: "",
      password: "from-center",
      updatedAt: 2,
    },
  ]));
  assert.equal(result.hosts[0].password, "from-center");
  assert.equal(result.hosts[0].authMethod, "password");
});

test("applyOrgCenterCatalog updates catalog fields but keeps local secrets", () => {
  const existing: Host = {
    ...hostFromCatalog(center, {
      id: "h1",
      label: "old",
      hostname: "10.0.0.1",
      port: 22,
      username: "root",
      group: "",
      tags: [],
      os: "linux",
      protocol: "ssh",
      notes: "",
      updatedAt: 1,
    }),
    password: "secret",
    identityId: "id-1",
    lastConnectedAt: 99,
    pinned: true,
  };
  const result = applyOrgCenterCatalog([existing], ["Ops"], center, catalog([
    {
      id: "h1",
      label: "web-1",
      hostname: "10.0.1.12",
      port: 2222,
      username: "deploy",
      group: "web",
      tags: ["prod"],
      os: "linux",
      protocol: "ssh",
      notes: "入口",
      updatedAt: 2,
    },
  ]));
  assert.equal(result.hosts.length, 1);
  assert.equal(result.hosts[0].label, "web-1");
  assert.equal(result.hosts[0].hostname, "10.0.1.12");
  assert.equal(result.hosts[0].port, 2222);
  assert.equal(result.hosts[0].username, "deploy");
  assert.equal(result.hosts[0].password, "secret");
  assert.equal(result.hosts[0].identityId, "id-1");
  assert.equal(result.hosts[0].lastConnectedAt, 99);
  assert.equal(result.hosts[0].pinned, true);
});

test("applyOrgCenterCatalog removes hosts deleted on the server and leaves local hosts", () => {
  const local: Host = {
    id: "local-1",
    label: "mine",
    hostname: "127.0.0.1",
    username: "root",
    tags: [],
    os: "linux",
  };
  const stale = hostFromCatalog(center, {
    id: "gone",
    label: "gone",
    hostname: "10.0.0.9",
    port: 22,
    username: "root",
    group: "",
    tags: [],
    os: "linux",
    protocol: "ssh",
    notes: "",
    updatedAt: 1,
  });
  const result = applyOrgCenterCatalog([local, stale], [], center, catalog([]));
  assert.deepEqual(result.hosts.map((host) => host.id), ["local-1"]);
});

test("applyOrgCenterCatalog remaps legacy local ids and keeps secrets", () => {
  const existing: Host = {
    ...hostFromCatalog(center, {
      id: "h1",
      label: "old",
      hostname: "10.0.0.1",
      port: 22,
      username: "root",
      group: "",
      tags: [],
      os: "linux",
      protocol: "ssh",
      notes: "",
      updatedAt: 1,
    }),
    password: "secret",
  };
  assert.equal(existing.id, "org:center-1:h1");
  const result = applyOrgCenterCatalog([existing], [], center, catalog([
    {
      id: "h1",
      label: "web-1",
      hostname: "10.0.1.12",
      port: 22,
      username: "deploy",
      group: "",
      tags: [],
      os: "linux",
      protocol: "ssh",
      notes: "",
      updatedAt: 2,
    },
  ]));
  assert.equal(result.hosts.length, 1);
  assert.equal(result.hosts[0].id, "org:remote:h1");
  assert.equal(result.hosts[0].password, "secret");
});

test("removeOrgCenterHosts only drops that center's hosts", () => {
  const org = hostFromCatalog(center, {
    id: "h1",
    label: "web-1",
    hostname: "10.0.1.12",
    port: 22,
    username: "deploy",
    group: "",
    tags: [],
    os: "linux",
    protocol: "ssh",
    notes: "",
    updatedAt: 1,
  });
  const local: Host = {
    id: "local-1",
    label: "mine",
    hostname: "127.0.0.1",
    username: "root",
    tags: [],
    os: "linux",
  };
  assert.deepEqual(removeOrgCenterHosts([org, local], "center-1").map((host) => host.id), ["local-1"]);
});

test("catalog startup command and lineDelay mode are applied", () => {
  const host = hostFromCatalog(center, {
    id: "h1",
    label: "web-1",
    hostname: "10.0.1.12",
    port: 22,
    username: "deploy",
    group: "",
    tags: [],
    os: "linux",
    protocol: "ssh",
    notes: "",
    startupCommand: "tmux attach || tmux",
    startupCommandRunMode: "lineDelay",
    startupCommandRules: [],
    updatedAt: 1,
  });
  assert.equal(host.startupCommand, "tmux attach || tmux");
  assert.equal(host.startupCommandRunMode, "lineDelay");
  assert.equal(host.startupCommandRules, undefined);
});

test("catalog rule mode applies expect/send and clears the startup command", () => {
  const host = hostFromCatalog(center, {
    id: "h1",
    label: "jump",
    hostname: "10.0.1.1",
    port: 22,
    username: "root",
    group: "",
    tags: [],
    os: "linux",
    protocol: "ssh",
    notes: "",
    startupCommand: "should-not-run",
    startupCommandRunMode: "rules",
    startupCommandRules: [
      { expect: "password:", send: "secret" },
      { expect: "", send: "ssh deploy@10.0.1.12" },
    ],
    updatedAt: 1,
  });
  assert.equal(host.startupCommand, undefined);
  assert.equal(host.startupCommandRunMode, "rules");
  assert.deepEqual(host.startupCommandRules, [
    { expect: "password:", send: "secret" },
    { expect: "", send: "ssh deploy@10.0.1.12" },
  ]);
});

test("catalog startup rules overwrite previous local startup settings on the same org host", () => {
  const existing: Host = {
    ...hostFromCatalog(center, {
      id: "h1",
      label: "web-1",
      hostname: "10.0.1.12",
      port: 22,
      username: "deploy",
      group: "",
      tags: [],
      os: "linux",
      protocol: "ssh",
      notes: "",
      startupCommand: "echo old",
      startupCommandRunMode: "paste",
      updatedAt: 1,
    }),
  };
  const result = applyOrgCenterCatalog([existing], [], center, catalog([{
    id: "h1",
    label: "web-1",
    hostname: "10.0.1.12",
    port: 22,
    username: "deploy",
    group: "",
    tags: [],
    os: "linux",
    protocol: "ssh",
    notes: "",
    startupCommandRunMode: "rules",
    startupCommandRules: [{ expect: "password:", send: "from-center" }],
    updatedAt: 2,
  }]));
  assert.equal(result.hosts[0].startupCommand, undefined);
  assert.equal(result.hosts[0].startupCommandRunMode, "rules");
  assert.deepEqual(result.hosts[0].startupCommandRules, [{ expect: "password:", send: "from-center" }]);
});
