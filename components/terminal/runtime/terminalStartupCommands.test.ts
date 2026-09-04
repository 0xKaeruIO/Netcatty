import test from "node:test";
import assert from "node:assert/strict";

import { scheduleStartupCommand } from "./terminalStartupCommands";
import type { TerminalSessionStartersContext } from "./createTerminalSessionStarters.types";

const wait = (ms = 0) => new Promise((resolve) => setTimeout(resolve, ms));

function createRulesContext(overrides: Record<string, unknown> = {}) {
  const writes: Array<{ data: string; automated?: boolean; sensitive?: boolean }> = [];
  let dataListener: ((data: string) => void) | undefined;
  const ctx = {
    host: {
      id: "host-1",
      label: "Host",
      hostname: "example.com",
      username: "root",
      startupCommandRunMode: "rules",
      startupCommandRules: [
        { expect: "", send: "ssh jingyang@192.168.0.127" },
        { expect: "password:", send: "jingyangtec" },
      ],
    },
    sessionId: "session-1",
    sessionRef: { current: "session-1" },
    hasRunStartupCommandRef: { current: false },
    terminalSettings: { startupCommandDelayMs: 0 },
    terminalBackend: {
      writeToSession(_id: string, data: string, options?: { automated?: boolean; sensitive?: boolean }) {
        writes.push({ data, automated: options?.automated, sensitive: options?.sensitive });
      },
      onSessionData(_id: string, cb: (data: string) => void) {
        dataListener = cb;
        return () => {
          dataListener = undefined;
        };
      },
    },
    ...overrides,
  };
  return {
    ctx: ctx as unknown as TerminalSessionStartersContext,
    writes,
    emit(data: string) {
      dataListener?.(data);
    },
  };
}

test("rule mode sends empty expect immediately then waits for the next prompt", async () => {
  const { ctx, writes, emit } = createRulesContext();
  const cancel = scheduleStartupCommand(ctx, { buffer: undefined } as never, "session-1");
  assert.equal(typeof cancel, "function");
  await wait(5);
  assert.deepEqual(writes, [{
    data: "ssh jingyang@192.168.0.127\r",
    automated: true,
    sensitive: false,
  }]);
  emit("Password: ");
  await wait(5);
  assert.equal(writes.length, 2);
  assert.deepEqual(writes[1], {
    data: "jingyangtec\r",
    automated: true,
    sensitive: true,
  });
});

test("rule mode does not fall back to the leftover startup script", async () => {
  const { ctx, writes } = createRulesContext({
    host: {
      id: "host-1",
      label: "Host",
      hostname: "example.com",
      username: "root",
      startupCommand: "echo should-not-run",
      startupCommandRunMode: "rules",
      startupCommandRules: [{ expect: "", send: "hostname" }],
    },
  });
  scheduleStartupCommand(ctx, { buffer: undefined } as never, "session-1");
  await wait(5);
  assert.deepEqual(writes.map((item) => item.data), ["hostname\r"]);
});

test("snippet startup command still uses paste instead of host rules", async () => {
  const { ctx, writes } = createRulesContext({
    startupCommand: "echo snippet",
  });
  scheduleStartupCommand(ctx, { buffer: undefined } as never, "session-1");
  await wait(5);
  assert.deepEqual(writes.map((item) => item.data), ["echo snippet\r"]);
});
