import assert from 'node:assert/strict';
import test from 'node:test';
import { hasProviderConnectionData, isProviderReadyForSync, SYNC_CONSTANTS } from './sync';

test('hasProviderConnectionData treats falsy scalar configs as present', () => {
  assert.equal(hasProviderConnectionData({ config: false }), true);
  assert.equal(hasProviderConnectionData({ config: 0 }), true);
  assert.equal(hasProviderConnectionData({ config: '' }), true);
  assert.equal(hasProviderConnectionData({ config: null as never }), true);
  assert.equal(hasProviderConnectionData({}), false);
  assert.equal(hasProviderConnectionData({ tokens: undefined }), false);
});

test('isProviderReadyForSync keeps error status ready when only scalar config remains', () => {
  assert.equal(
    isProviderReadyForSync({ status: 'error', config: false }),
    true,
  );
  assert.equal(
    isProviderReadyForSync({ status: 'error', config: 0 }),
    true,
  );
  assert.equal(
    isProviderReadyForSync({ status: 'error', config: '' }),
    true,
  );
  assert.equal(
    isProviderReadyForSync({ status: 'error' }),
    false,
  );
  assert.equal(
    isProviderReadyForSync({ status: 'disconnected', config: false }),
    false,
  );
});

test('OAuth public client IDs stay non-empty without CI secrets', () => {
  assert.ok(SYNC_CONSTANTS.GITHUB_CLIENT_ID.length > 0);
  assert.ok(SYNC_CONSTANTS.GOOGLE_CLIENT_ID.length > 0);
  assert.ok(SYNC_CONSTANTS.ONEDRIVE_CLIENT_ID.length > 0);
});
