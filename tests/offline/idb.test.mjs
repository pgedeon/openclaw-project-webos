/**
 * IndexedDB Helper Tests
 * Run with: node --test tests/offline/idb.test.mjs
 */

import '../test-setup.mjs';
import 'fake-indexeddb/auto';
import assert from 'node:assert';
import { test, describe, beforeEach } from 'node:test';
import { idb, STORES, DB_NAME } from '../../src/offline/idb.mjs';

describe('IDBWrapper', () => {
  beforeEach(async () => {
    await idb.clear(STORES.TASKS);
    await idb.clear(STORES.SYNC_QUEUE);
    await idb.clear(STORES.CACHE);
  });

  test('should initialize database without error', async () => {
    const db = await idb.init();
    assert.ok(db);
    assert.ok(db.objectStoreNames.contains(STORES.TASKS));
    assert.ok(db.objectStoreNames.contains(STORES.SYNC_QUEUE));
    assert.ok(db.objectStoreNames.contains(STORES.CACHE));
  });

  test('should add and retrieve a task', async () => {
    const task = {
      id: 1,
      text: 'Test task',
      category: 'General',
      completed: false,
      createdAt: new Date().toISOString()
    };

    await idb.add(STORES.TASKS, task);
    const retrieved = await idb.get(STORES.TASKS, 1);

    assert.deepEqual(retrieved, task);
  });

  test('should update a task using put', async () => {
    const task = { id: 2, text: 'Original', category: 'Design', completed: false };
    await idb.add(STORES.TASKS, task);

    task.text = 'Updated';
    await idb.put(STORES.TASKS, task);

    const updated = await idb.get(STORES.TASKS, 2);
    assert.strictEqual(updated.text, 'Updated');
  });

  test('should delete a task', async () => {
    const task = { id: 3, text: 'To delete', category: 'Personal' };
    await idb.add(STORES.TASKS, task);

    await idb.delete(STORES.TASKS, 3);
    const result = await idb.get(STORES.TASKS, 3);

    assert.strictEqual(result, undefined);
  });

  test('should get all tasks', async () => {
    const tasks = [
      { id: 10, text: 'Task A', category: 'Dev' },
      { id: 11, text: 'Task B', category: 'Ops' }
    ];
    for (const t of tasks) {
      await idb.add(STORES.TASKS, t);
    }

    const all = await idb.getAll(STORES.TASKS);
    assert.strictEqual(all.length, 2);
  });

  test('should query by index', async () => {
    await idb.add(STORES.TASKS, { id: 20, text: 'A', category: 'Dev', completed: false });
    await idb.add(STORES.TASKS, { id: 21, text: 'B', category: 'Dev', completed: true });
    await idb.add(STORES.TASKS, { id: 22, text: 'C', category: 'Ops', completed: false });

    const devTasks = await idb.getAll(STORES.TASKS, 'category', 'Dev');
    assert.strictEqual(devTasks.length, 2);
  });

  test('should clear store', async () => {
    await idb.add(STORES.TASKS, { id: 30, text: 'X' });
    await idb.add(STORES.TASKS, { id: 31, text: 'Y' });

    await idb.clear(STORES.TASKS);
    const all = await idb.getAll(STORES.TASKS);
    assert.strictEqual(all.length, 0);
  });

  test('should count documents', async () => {
    await idb.add(STORES.TASKS, { id: 40, text: 'A' });
    await idb.add(STORES.TASKS, { id: 41, text: 'B' });

    const count = await idb.count(STORES.TASKS);
    assert.strictEqual(count, 2);
  });
});
