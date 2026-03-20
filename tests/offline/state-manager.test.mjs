/**
 * State Manager Tests
 * Run with: node --test tests/offline/state-manager.test.mjs
 */

import '../test-setup.mjs';
import 'fake-indexeddb/auto';
import assert from 'node:assert';
import { test, describe, beforeEach } from 'node:test';
import {
  init,
  getState,
  setState,
  addTask,
  toggleTask,
  updateTask,
  deleteTask,
  clearCompleted,
  subscribe,
  clearState
} from '../../src/offline/state-manager.mjs';
import { idb, STORES } from '../../src/offline/idb.mjs';

describe('StateManager', () => {
  beforeEach(async () => {
    await idb.clear(STORES.TASKS);
    localStorage.clear();
  });

  test('should initialize with default state', async () => {
    const state = await init();
    assert.ok(state);
    assert.strictEqual(state.theme, 'light');
    assert.ok(Array.isArray(state.tasks));
    assert.ok(state.categories.includes('General'));
  });

  test('should add a task', async () => {
    await init();
    const task = await addTask('Test task', 'Development');

    assert.strictEqual(task.text, 'Test task');
    assert.strictEqual(task.category, 'Development');
    assert.strictEqual(task.completed, false);

    const state = await getState();
    assert.strictEqual(state.tasks.length, 1);
    assert.strictEqual(state.tasks[0].text, 'Test task');
  });

  test('should toggle task completion', async () => {
    await init();
    const task = await addTask('Toggle me');

    assert.strictEqual(task.completed, false);

    await toggleTask(task.id);
    let state = await getState();
    assert.strictEqual(state.tasks[0].completed, true);

    await toggleTask(task.id);
    state = await getState();
    assert.strictEqual(state.tasks[0].completed, false);
  });

  test('should update a task', async () => {
    await init();
    const task = await addTask('Original', 'General');

    await updateTask(task.id, { text: 'Updated', category: 'Design' });
    const state = await getState();
    const updated = state.tasks.find(t => t.id === task.id);

    assert.strictEqual(updated.text, 'Updated');
    assert.strictEqual(updated.category, 'Design');
  });

  test('should delete a task', async () => {
    await init();
    const task = await addTask('Delete me');

    assert.strictEqual((await getState()).tasks.length, 1);

    await deleteTask(task.id);
    assert.strictEqual((await getState()).tasks.length, 0);
  });

  test('should clear completed tasks', async () => {
    await init();
    await addTask('Task 1', 'General');
    const task2 = await addTask('Task 2', 'General');
    await addTask('Task 3', 'General');

    await toggleTask(task2.id);

    await clearCompleted();
    const state = await getState();
    assert.strictEqual(state.tasks.length, 2);
    assert.strictEqual(state.tasks.find(t => t.id === task2.id), undefined);
  });

  test('should persist state across reloads', async () => {
    await init();
    await addTask('Persistent task', 'Ops');
    await addTask('Another task', 'Dev');

    // Simulate reload: close and reinitialize
    idb.close();
    await init();

    const state2 = await getState();
    assert.strictEqual(state2.tasks.length, 2);
    assert.ok(state2.tasks.some(t => t.text === 'Persistent task'));
  });

  test('should migrate legacy localStorage data', async () => {
    const legacyTasks = [
      { id: 100, text: 'Legacy task', completed: false, createdAt: new Date().toISOString() }
    ];
    localStorage.setItem('projectTasks', JSON.stringify(legacyTasks));

    await init();
    const state = await getState();
    assert.strictEqual(state.tasks.length, 1);
    assert.strictEqual(state.tasks[0].text, 'Legacy task');
  });

  test('should add new category to categories list', async () => {
    await init();
    let state = await getState();
    assert.ok(!state.categories.includes('NewCategory'));

    await addTask('Task with new category', 'NewCategory');
    state = await getState();
    assert.ok(state.categories.includes('NewCategory'));
  });

  test('should sanitize category names', async () => {
    await init();
    const task = await addTask('Test', '   Designs   ');
    assert.strictEqual(task.category, 'Designs');
  });
});
