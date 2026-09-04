import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { executeTerminalExecute } from './toolExecutors';
import type { NetcattyBridge } from '../cattyAgent/executor';

function makeDeps(aiExec: NetcattyBridge['aiExec']) {
  return {
    bridge: { aiExec } as NetcattyBridge,
    context: {
      sessions: [{
        sessionId: 'guest-1',
        hostId: 'org-share-guest-1',
        hostname: 'shared',
        label: 'Guest',
        protocol: 'ssh',
        connected: true,
      }],
      workspaceId: null,
      workspaceName: null,
    },
    permissionMode: 'auto' as const,
  };
}

describe('executeTerminalExecute exitCode', () => {
  it('keeps an explicit null exitCode for org-share guest results', async () => {
    const result = await executeTerminalExecute(makeDeps(async () => ({
      ok: true,
      stdout: '/tmp\n',
      stderr: '',
      exitCode: null,
    })), { sessionId: 'guest-1', command: 'pwd' });
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.data.exitCode, null);
      assert.equal(result.data.stdout, '/tmp\n');
    }
  });

  it('still maps a missing SSH exitCode to -1', async () => {
    const result = await executeTerminalExecute(makeDeps(async () => ({
      ok: true,
      stdout: '/tmp\n',
      stderr: '',
    })), { sessionId: 'guest-1', command: 'pwd' });
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.data.exitCode, -1);
    }
  });
});
