import assert from "node:assert/strict";
import test from "node:test";

import { importVaultHostFiles } from "./vaultImportBatch.ts";

const secureCrtFile = (
  relativePath: string,
  hostname: string | null,
  portHex = "00000016",
  protocol = "SSH2",
) => {
  const file = new File([[
      hostname ? `S:"Hostname"=${hostname}` : "S:\"Username\"=nobody",
      'S:"Username"=operator',
      `S:"Protocol Name"=${protocol}`,
      `D:"[SSH2] Port"=${portHex}`,
    ].join("\n")], relativePath.split("/").at(-1) ?? "session.ini");
  Object.defineProperty(file, "webkitRelativePath", { value: relativePath });
  return file;
};

test("SecureCRT directory import reads every session and preserves folder groups", async () => {
  const result = await importVaultHostFiles({
    format: "securecrt",
    files: [
      secureCrtFile("Sessions/Production/Web.ini", "web.example.com", "000008ae"),
      secureCrtFile("Sessions/Staging/DB.ini", "db.example.com"),
      secureCrtFile("Sessions/Archive/Web Copy.ini", "web.example.com", "000008ae"),
      secureCrtFile("Sessions/Default.ini", "should-not-import.example.com"),
      secureCrtFile("Sessions/Production/__FolderData__.ini", "should-not-import.example.com"),
      secureCrtFile("Sessions/Broken.ini", null),
    ],
  });

  assert.deepEqual(result.stats, {
    parsed: 3,
    imported: 3,
    skipped: 1,
    duplicates: 0,
  });
  assert.deepEqual(
    result.hosts.map(({ label, hostname, port, group }) => ({ label, hostname, port, group })),
    [
      {
        label: "Web",
        hostname: "web.example.com",
        port: 2222,
        group: "Production",
      },
      {
        label: "DB",
        hostname: "db.example.com",
        port: 22,
        group: "Staging",
      },
      {
        label: "Web Copy",
        hostname: "web.example.com",
        port: 2222,
        group: "Archive",
      },
    ],
  );
  assert.deepEqual(result.groups, ["Production", "Staging", "Archive"]);
  assert.match(result.issues[0]?.message ?? "", /Broken\.ini/);
});

test("SecureCRT keeps separate session files that point to the same endpoint", async () => {
  const session = [
    'S:"Hostname"=shared.example.com',
    'S:"Username"=root',
    'S:"Protocol Name"=SSH2',
  ].join("\n");
  const result = await importVaultHostFiles({
    format: "securecrt",
    files: [
      new File([session], "web.ini"),
      new File([session], "web.ini"),
    ],
    relativePaths: [
      "Sessions/Prod/web.ini",
      "Sessions/Staging/web.ini",
    ],
  });

  assert.equal(result.hosts.length, 2);
  assert.deepEqual(result.hosts.map((host) => host.group), ["Prod", "Staging"]);
});

test("SecureCRT destination group keeps same-endpoint session files", async () => {
  const { applyVaultImportDestination } = await import("../../domain/vaultImport");
  const session = [
    'S:"Hostname"=shared.example.com',
    'S:"Username"=root',
    'S:"Protocol Name"=SSH2',
  ].join("\n");
  const imported = await importVaultHostFiles({
    format: "securecrt",
    files: [
      new File([session], "web.ini"),
      new File([session], "web.ini"),
    ],
    relativePaths: [
      "Sessions/Prod/web.ini",
      "Sessions/Staging/web.ini",
    ],
  });

  const targeted = applyVaultImportDestination(
    imported,
    { mode: "group", group: "Imported/SecureCRT" },
    { collapseDuplicateEndpoints: false },
  );

  assert.equal(targeted.hosts.length, 2);
  assert.deepEqual(targeted.hosts.map((host) => host.group), [
    "Imported/SecureCRT",
    "Imported/SecureCRT",
  ]);
});

test("SecureCRT batch import does not count an unsupported session twice", async () => {
  const result = await importVaultHostFiles({
    format: "securecrt",
    files: [secureCrtFile("Sessions/Local.ini", "localhost", "00000016", "Local")],
  });

  assert.equal(result.hosts.length, 0);
  assert.equal(result.stats.parsed, 1);
  assert.equal(result.stats.skipped, 1);
  assert.equal(result.issues.length, 1);
});

test("SecureCRT folder paths transferred alongside files survive the worker boundary", async () => {
  const file = new File([
    [
      'S:"Hostname"=transferred.example.com',
      'S:"Username"=operator',
      'S:"Protocol Name"=SSH2',
    ].join("\n"),
  ], "Transferred.ini");

  const result = await importVaultHostFiles({
    format: "securecrt",
    files: [file],
    relativePaths: ["Sessions/Production/Transferred.ini"],
  });

  assert.equal(result.hosts[0]?.group, "Production");
  assert.deepEqual(result.groups, ["Production"]);
});

test("SecureCRT keeps a real nested Sessions folder when that folder was selected", async () => {
  const result = await importVaultHostFiles({
    format: "securecrt",
    files: [secureCrtFile("Sessions/Sessions/Nested.ini", "nested.example.com")],
  });

  assert.equal(result.hosts[0]?.group, "Sessions");
  assert.deepEqual(result.groups, ["Sessions"]);
});

const xshellFile = (
  relativePath: string,
  hostname: string | null,
  extras: string[] = [],
) => {
  const file = new File([[
    "[SessionInfo]",
    "Description=Xshell session file",
    "[CONNECTION]",
    hostname ? `Host=${hostname}` : "Port=22",
    "Port=22",
    "Protocol=SSH",
    "[CONNECTION:AUTHENTICATION]",
    "UserName=root",
    "UseExpectSend=0",
    "ExpectSend_Count=0",
    ...extras,
  ].join("\n")], relativePath.split("/").at(-1) ?? "session.xsh");
  Object.defineProperty(file, "webkitRelativePath", { value: relativePath });
  return file;
};

test("Xshell directory import reads every session and preserves folder groups", async () => {
  const result = await importVaultHostFiles({
    format: "xshell",
    files: [
      xshellFile("Sessions/ccc/ssss/新建会话.xsh", "192.168.0.3"),
      xshellFile("Sessions/ccc/folder.ini", "should-not-import.example.com"),
      xshellFile("Sessions/default/ignored.txt", "should-not-import.example.com"),
      xshellFile("Sessions/Broken.xsh", null),
    ],
  });

  assert.deepEqual(result.stats, {
    parsed: 2,
    imported: 1,
    skipped: 1,
    duplicates: 0,
  });
  assert.equal(result.hosts.length, 1);
  assert.equal(result.hosts[0]?.label, "新建会话");
  assert.equal(result.hosts[0]?.hostname, "192.168.0.3");
  assert.equal(result.hosts[0]?.group, "ccc/ssss");
  assert.deepEqual(result.groups, ["ccc/ssss"]);
  assert.match(result.issues[0]?.message ?? "", /Broken\.xsh/);
});

test("Xshell keeps separate session files that point to the same endpoint", async () => {
  const result = await importVaultHostFiles({
    format: "xshell",
    files: [
      xshellFile("Sessions/Prod/web.xsh", "shared.example.com"),
      xshellFile("Sessions/Staging/web.xsh", "shared.example.com"),
    ],
  });

  assert.equal(result.hosts.length, 2);
  assert.deepEqual(result.hosts.map((host) => host.group), ["Prod", "Staging"]);
});

test("Xshell destination group keeps same-endpoint session files", async () => {
  const { applyVaultImportDestination } = await import("../../domain/vaultImport");
  const imported = await importVaultHostFiles({
    format: "xshell",
    files: [
      xshellFile("Sessions/Prod/web.xsh", "shared.example.com"),
      xshellFile("Sessions/Staging/web.xsh", "shared.example.com"),
    ],
  });

  const targeted = applyVaultImportDestination(
    imported,
    { mode: "group", group: "Imported/Xshell" },
    { collapseDuplicateEndpoints: false },
  );

  assert.equal(targeted.hosts.length, 2);
  assert.deepEqual(targeted.hosts.map((host) => host.group), [
    "Imported/Xshell",
    "Imported/Xshell",
  ]);
});

test("Xshell folder paths strip Xshell/Sessions wrappers when a parent folder was selected", async () => {
  const result = await importVaultHostFiles({
    format: "xshell",
    files: [xshellFile("Documents/Xshell/Sessions/ccc/ssss/jump.xsh", "jump.example.com")],
  });

  assert.equal(result.hosts[0]?.group, "ccc/ssss");
});

test("Xshell keeps a real nested Sessions folder when that folder was selected", async () => {
  const result = await importVaultHostFiles({
    format: "xshell",
    files: [xshellFile("Sessions/Sessions/Nested.xsh", "nested.example.com")],
  });

  assert.equal(result.hosts[0]?.group, "Sessions");
});
