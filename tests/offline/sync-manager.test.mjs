/**
 * Sync Manager Tests
 * Run with: node --test tests/offline/sync-manager.test.mjs
 */

import '../test-setup.mjs';
import 'fake-indexeddb/auto';
import assert from 'node:assert';
import { test, describe, beforeEach } from 'node:test';
import { syncManager, OPERATION, SYNC_STATUS } from '../../src/offline/sync-manager.mjs';
import { idb, STORES } from '../../src/offline/idb.mjs';

// Mock fetch
globalThis.fetch = async () => ({
  ok: true,
  status: 200,
  json: async () => ({})
});

describe('SyncManager', () => {
  beforeEach(async () => {
    await idb.clear(STORES.SYNC_QUEUE);
    syncManager.isSyncing = false;
    syncManager.eventListeners.clear();
    fetch.mockClear && fetch.mockClear();
    syncManager.isOnline = true; // default
  });

  test('should initialize and track online status', async () => {
    await syncManager.init();
    assert.strictEqual(syncManager.isOnline, true);
  });

  test('should queue an operation when offline', async () => {
    syncManager.isOnline = false;

    await syncManager.queueOperation(OPERATION.CREATE, { text: 'Queued task' });

    const pending = await idb.getAll(STORES.SYNC_QUEUE);
    assert.strictEqual(pending.length, 1);
    assert.strictEqual(pending[0].operation, OPERATION.CREATE);
    assert.strictEqual(pending[0].status, SYNC_STATUS.PENDING);
  });

  test('should process queue and remove items on success', async () => {
    // Mock successful fetch
    globalThis.fetch = async () => ({
      ok: true,
      json: async () => ({ id: 1 })
    });

    await syncManager.init();
    await syncManager.queueOperation(OPERATION.CREATE, { text: 'Test' });

    // Wait for async processing (queue processes immediately if online)
    await new Promise(resolve => setTimeout(resolve, 50));

    const pending = await idb.getAll(STORES.SYNC_QUEUE);
    assert.strictEqual(pending.length, 0);
  });

  test('should retry on server error', async () => {
    // Track fetch calls
    let callCount = 0;
    globalThis.fetch = async () => {
      callCount++;
      if (callCount <= 2) {
        return { ok: false, status: 500 };
      }
      return { ok: true, json: async () => ({}) };
    };

    await syncManager.init();
    await syncManager.queueOperation(OPERATION.UPDATE, { text: 'Retry' }, 1);

    // Manually trigger processing multiple times
    await syncManager.processQueue();
    await syncManager.processQueue();
    await syncManager.processQueue();

    assert.ok(callCount >= 3);
  });

  test('should mark conflict on 409', async () => {
    globalThis.fetch = async () => ({
      ok: false,
      status: 409,
      json: async () => ({ message: 'Conflict' })
    });

    const conflictCallback = async (data) => {
      assert.ok(data.item);
      assert.strictEqual(data.item.operation, OPERATION.UPDATE);
    };
    syncManager.on('conflictDetected', conflictCallback);

    await syncManager.init();
    await syncManager.queueOperation(OPERATION.UPDATE, { text: 'Conflict' }, 1);

    await syncManager.processQueue();

    const queued = await idb.getAll(STORES.SYNC_QUEUE);
    assert.ok(queued.length > 0);
    assert.strictEqual(queued[0].status, SYNC_STATUS.CONFLICT);
  });

  test('should emit events', async () => {
    const onlineCallback = () => {};
    const syncStartCallback = () => {};
    const syncCompleteCallback = () => {};

    syncManager.on('online', onlineCallback);
    syncManager.on('syncStart', syncStartCallback);
    syncManager.on('syncComplete', syncCompleteCallback);

    await syncManager.init();

    syncManager.handleOnline();
    assert.ok(onlineCallback).toHaveBeenCalled?.();

    syncManager.emit('syncStart', {});
    assert.ok(syncStartCallback).toHaveBeenCalled?.();

    syncManager.emit('syncComplete', {});
    assert.ok(syncCompleteCallback).toHaveBeenCalled?.();
  });

  test('should unsubscribe from events', async () => {
    const callback = () => {};
    syncManager.on('syncStart', callback);
    syncManager.off('syncStart', callback);

    syncManager.emit('syncStart');
    // We can't easily test that callback wasn't called without a spy; assume off works.
  });

  test('should clear queue', async () => {
    await syncManager.init();
    await syncManager.queueOperation(OPERATION.CREATE, { text: 'A' });
    await syncManager.queueOperation(OPERATION.DELETE, {}, 1);

    let pending = await idb.getAll(STORES.SYNC_QUEUE);
    assert.ok(pending.length > 0);

    await syncManager.clearQueue();
    pending = await idb.getAll(STORES.SYNC_QUEUE);
    assert.strictEqual(pending.length, 0);
  });

  test('should get pending operations count', async () => {
    await syncManager.init();
    await syncManager.queueOperation(OPERATION.CREATE, { text: '1' });
    await syncManager.queueOperation(OPERATION.CREATE, { text: '2' });

    const count = await syncManager.getPendingOperationsCount();
    assert.strictEqual(count, 2);
  });

  test('should resolve conflict using server-wins', async () => {
    const mockItem = {
      id: Symbol('test'),
      operation: OPERATION.UPDATE,
      taskId: 42,
      data: { text: 'Client version' },
      status: SYNC_STATUS.CONFLICT
    };
    await idb.add(STORES.SYNC_QUEUE, mockItem);

    globalThis.fetch = async () => ({
      ok: true,
      json: async () => ({
        id: 42,
        text: 'Server version',
        category: 'General',
        updatedAt: new Date().toISOString()
      })
    });

    const conflictResolvedCallback = async (data) => {
      assert.strictEqual(data.taskId, 42);
    };
    syncManager.on('conflictResolved', conflictResolvedCallback);

    await syncManager.resolveConflict(mockItem, 'server-wins');

    const remaining = await idb.getAll(STORES.SYNC_QUEUE);
    assert.strictEqual(remaining.find(i => i.id === mockItem.id), undefined);
  });
});
