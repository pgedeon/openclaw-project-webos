#!/usr/bin/env node
/**
 * Dashboard filter regression test.
 *
 * Verifies:
 * - project-scoped category options only show categories present in that project
 * - pending filter matches active workflow tasks
 * - archived filter only renders archived tasks after the archived-inclusive reload
 *
 * Run:
 *   node tests/test-filter-behavior.js
 *   DASHBOARD_BASE=http://localhost:3887 node tests/test-filter-behavior.js
 */

const assert = require('assert');
const { chromium } = require('@playwright/test');

const DASHBOARD_BASE = process.env.DASHBOARD_BASE || 'http://localhost:3876';
const WAIT_TIMEOUT_MS = 30000;
const PROJECTS = {
  legacy: 'c879b591-1daa-4339-890b-e0d3bed4ab0b',
  manufacturing: '19eeb159-6fa0-4276-b00c-27636ba68e89'
};

async function waitForProject(page, projectId, expectedTaskCount = null) {
  const deadline = Date.now() + WAIT_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const state = await page.evaluate(async () => window.dashboardDebug.getState());
    if (state && state.project_id === projectId) {
      if (expectedTaskCount === null || state.tasks.length === expectedTaskCount) {
        return;
      }
    }
    await page.waitForTimeout(200);
  }
  throw new Error(`Timed out waiting for project ${projectId}`);
}

async function getVisibleTaskCount(page) {
  return page.locator('#taskList .task-text').count();
}

async function waitForVisibleTaskCount(page, expectedCount, timeoutMs = WAIT_TIMEOUT_MS) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await getVisibleTaskCount(page) === expectedCount) {
      return;
    }
    await page.waitForTimeout(200);
  }
  throw new Error(`Timed out waiting for ${expectedCount} visible tasks`);
}

async function getExpectedVisibleCount(page, predicate) {
  return page.evaluate(async (predicateName) => {
    const state = await window.dashboardDebug.getState();

    function getTaskStatus(task) {
      if (!task) return 'backlog';
      if (task.archived || task.archived_at) return 'archived';
      if (typeof task.status === 'string' && task.status.trim()) return task.status.trim();
      return task.completed ? 'completed' : 'backlog';
    }

    function isTaskArchived(task) {
      return getTaskStatus(task) === 'archived' || !!task.archived || !!task.archived_at;
    }

    function isTaskCompleted(task) {
      return getTaskStatus(task) === 'completed';
    }

    function isTaskPending(task) {
      return !isTaskArchived(task) && !isTaskCompleted(task);
    }

    let filtered = state.tasks;
    if (predicateName === 'pending') {
      filtered = filtered.filter((task) => isTaskPending(task));
    } else if (predicateName === 'archived') {
      filtered = filtered.filter((task) => isTaskArchived(task));
    }

    if (state.categoryFilter !== 'all') {
      filtered = filtered.filter((task) => task.category === state.categoryFilter);
    }

    const autoExpand = Boolean(
      (state.filter && state.filter !== 'all') ||
      (state.search && state.search.trim()) ||
      (state.categoryFilter && state.categoryFilter !== 'all')
    );
    if (autoExpand) {
      return filtered.length;
    }

    const filteredIds = new Set(filtered.map((task) => task.id));
    return filtered.filter((task) => !task.parent_task_id || !filteredIds.has(task.parent_task_id)).length;
  }, predicate);
}

async function waitForState(page, predicate, timeoutMs = WAIT_TIMEOUT_MS) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const state = await page.evaluate(async () => window.dashboardDebug.getState());
    if (predicate(state)) return state;
    await page.waitForTimeout(200);
  }
  throw new Error('Timed out waiting for dashboard state');
}

async function run() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();

  try {
    await page.goto(DASHBOARD_BASE, { waitUntil: 'networkidle' });
    await page.waitForSelector('#projectSelect');
    await page.waitForFunction(() => typeof window.dashboardDebug?.getState === 'function');

    await page.selectOption('#projectSelect', PROJECTS.manufacturing);
    await waitForProject(page, PROJECTS.manufacturing, 3);
    await waitForState(page, (state) => Array.isArray(state.categories) && state.categories.includes('test'));
    await page.waitForFunction(
      () => Array.from(document.querySelectorAll('#categoryFilter option')).some((option) => option.value === 'test'),
      undefined,
      { timeout: WAIT_TIMEOUT_MS }
    );

    const categoryOptions = await page.locator('#categoryFilter option').evaluateAll(
      (options) => options.map((option) => option.value)
    );
    assert.deepStrictEqual(
      categoryOptions,
      ['all', 'test'],
      `expected only project-scoped categories for manufacturing project, got ${categoryOptions.join(', ')}`
    );

    await page.click('[data-filter="pending"]');
    await waitForState(page, (state) => state.filter === 'pending' && state.project_id === PROJECTS.manufacturing);
    await waitForVisibleTaskCount(page, await getExpectedVisibleCount(page, 'pending'));
    assert.strictEqual(
      await getVisibleTaskCount(page),
      await getExpectedVisibleCount(page, 'pending'),
      'pending filter should render the expected pending task roots'
    );

    await page.selectOption('#categoryFilter', 'test');
    await waitForState(page, (state) => state.categoryFilter === 'test' && state.project_id === PROJECTS.manufacturing);
    await waitForVisibleTaskCount(page, await getExpectedVisibleCount(page, 'pending'));
    assert.strictEqual(
      await getVisibleTaskCount(page),
      await getExpectedVisibleCount(page, 'pending'),
      'category filter should keep the expected test task roots visible'
    );

    await page.selectOption('#projectSelect', PROJECTS.legacy);
    await waitForProject(page, PROJECTS.legacy, 726);

    await page.click('[data-filter="archived"]');
    await waitForState(
      page,
      (state) => state.filter === 'archived' && state.project_id === PROJECTS.legacy && state.tasks.length > 726
    );
    await waitForVisibleTaskCount(page, await getExpectedVisibleCount(page, 'archived'));

    const archivedStateCount = await page.evaluate(async () => {
      const state = await window.dashboardDebug.getState();
      return state.tasks.filter((task) => task.archived || task.archived_at || task.status === 'archived').length;
    });
    assert.strictEqual(
      await getVisibleTaskCount(page),
      await getExpectedVisibleCount(page, 'archived'),
      'archived filter should render only archived tasks'
    );
    assert.ok(archivedStateCount > 0, 'legacy project should still have archived tasks to verify the filter');

    console.log('PASS: dashboard filter behavior');
  } finally {
    await context.close();
    await browser.close();
  }
}

run().catch((error) => {
  console.error('FAIL: dashboard filter behavior');
  console.error(error);
  process.exit(1);
});
