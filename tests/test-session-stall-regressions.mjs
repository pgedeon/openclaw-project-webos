#!/usr/bin/env node

import assert from 'assert';
import { readFileSync } from 'fs';
import { createRequire } from 'module';

import { buildTaskListParams } from '../src/shell/native-views/tasks-view.mjs';
import { requestNotepadOpen } from '../src/shell/native-views/explorer-view.mjs';

const require = createRequire(import.meta.url);
const { GatewayWorkflowDispatcher } = require('../gateway-workflow-dispatcher.js');
const AsanaStorage = require('../storage/asana.js');

function testBuildTaskListParams() {
  assert.deepStrictEqual(buildTaskListParams(null), {
    include_child_projects: 'true',
    include_archived: 'true',
  });

  assert.deepStrictEqual(buildTaskListParams('all'), {
    include_child_projects: 'true',
    include_archived: 'true',
  });

  assert.deepStrictEqual(buildTaskListParams('123e4567-e89b-12d3-a456-426614174000'), {
    project_id: '123e4567-e89b-12d3-a456-426614174000',
    include_child_projects: 'true',
    include_archived: 'true',
  });
}

async function testDispatcherUsesBoundTimeoutPlaceholder() {
  const calls = [];
  const pool = {
    async query(sql, values) {
      calls.push({ sql, values });
      return { rows: [] };
    },
  };
  const log = { log() {}, error() {} };
  const dispatcher = new GatewayWorkflowDispatcher(pool, log);

  await dispatcher.handleStaleRuns();

  assert.strictEqual(calls.length, 1, 'expected one query when no stale runs exist');
  assert.match(
    calls[0].sql,
    /> \$1/,
    'expected stale-run query to use a placeholder for the timeout threshold'
  );
  assert.deepStrictEqual(
    calls[0].values,
    [60],
    'expected stale-run query to bind the 60 minute timeout as a parameter'
  );
}

async function testListTasksTreatsAllAsGlobalFilter() {
  const options = {
    include_archived: true,
    include_deleted: true,
    updated_since: '2026-03-23T10:45:33.000Z',
  };
  const listAllCalls = [];
  const fakeStore = {
    async listAllTasks(receivedOptions) {
      listAllCalls.push(receivedOptions);
      return [{ id: 'task-1' }];
    },
  };

  const result = await AsanaStorage.prototype.listTasks.call(fakeStore, 'all', options);

  assert.deepStrictEqual(result, [{ id: 'task-1' }]);
  assert.deepStrictEqual(listAllCalls, [options]);
}

function testRequestNotepadOpenQueuesAndNavigates() {
  if (typeof globalThis.CustomEvent === 'undefined') {
    globalThis.CustomEvent = class CustomEvent {
      constructor(type, init = {}) {
        this.type = type;
        this.detail = init.detail;
      }
    };
  }

  const stateChanges = [];
  const events = [];
  const navigations = [];
  const path = 'workspace/dashboard/docs/file-explorer-notepad-implementation.md';
  const requestedAt = '2026-03-23T10:45:33.000Z';

  const request = requestNotepadOpen({
    path,
    requestedAt,
    stateStore: {
      setState(patch) {
        stateChanges.push(patch);
      },
    },
    eventTarget: {
      dispatchEvent(event) {
        events.push(event);
        return true;
      },
    },
    navigateToView(viewId, payload) {
      navigations.push({ viewId, payload });
    },
  });

  assert.deepStrictEqual(request, { path, requestedAt });
  assert.deepStrictEqual(stateChanges, [{ notepad: { openRequest: request } }]);
  assert.strictEqual(events.length, 1);
  assert.strictEqual(events[0].type, 'notepad:open-file');
  assert.deepStrictEqual(events[0].detail, request);
  assert.deepStrictEqual(navigations, [{ viewId: 'notepad', payload: request }]);
}

function testWindowManagerProvidesNativeViewNavigation() {
  const source = readFileSync(new URL('../src/shell/window-manager.mjs', import.meta.url), 'utf8');

  assert.match(
    source,
    /navigateToView:\s*\(viewId,\s*options = \{\}\)\s*=> this\.openWindow\(viewId,\s*options\)/,
    'window manager should provide native views with a navigateToView callback'
  );
}

function testNotepadHasVisibleSaveButton() {
  const source = readFileSync(new URL('../src/shell/native-views/notepad-view.mjs', import.meta.url), 'utf8');

  assert.match(
    source,
    /class="np-save-btn"/,
    'notepad should render a visible save button'
  );
  assert.match(
    source,
    /saveButton\.addEventListener\('click'/,
    'notepad save button should invoke the save flow'
  );
}

async function main() {
  testBuildTaskListParams();
  await testDispatcherUsesBoundTimeoutPlaceholder();
  await testListTasksTreatsAllAsGlobalFilter();
  testRequestNotepadOpenQueuesAndNavigates();
  testWindowManagerProvidesNativeViewNavigation();
  testNotepadHasVisibleSaveButton();
  console.log('PASS: session stall regressions');
}

main().catch((error) => {
  console.error('FAIL: session stall regressions');
  console.error(error);
  process.exit(1);
});
