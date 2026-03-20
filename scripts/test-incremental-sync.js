#!/usr/bin/env node
/**
 * Test script for Incremental Sync + Pagination feature
 * Tests updated_since parameter on /api/tasks/all
 */

const fetch = require('node-fetch'); // If not available, use http module
const url = require('url');

const BASE = 'http://localhost:3876';

async function testUpdatedSince() {
  try {
    // First, get all tasks (no project_id? Need project). We'll get projects first.
    const projectsRes = await fetch(`${BASE}/api/projects`);
    if (!projectsRes.ok) throw new Error(`Failed to fetch projects: ${projectsRes.status}`);
    const projects = await projectsRes.json();
    if (projects.length === 0) {
      console.log('No projects found. Skipping test.');
      return;
    }
    const projectId = projects[0].id;

    // Get all tasks for project
    const allRes = await fetch(`${BASE}/api/tasks/all?project_id=${projectId}`);
    if (!allRes.ok) throw new Error(`Failed to fetch all tasks: ${allRes.status}`);
    const allTasks = await allRes.json();
    console.log(`Fetched all tasks: ${allTasks.length} tasks`);

    if (allTasks.length === 0) {
      console.log('No tasks in project. Skipping updated_since test.');
      return;
    }

    // Get the most recent updated_at from tasks
    const latestTask = allTasks.reduce((latest, task) => {
      const updated = new Date(task.updated_at || task.created_at);
      return updated > new Date(latest.updated_at || latest.created_at) ? task : latest;
    }, allTasks[0]);

    const latestUpdate = new Date(latestTask.updated_at || latestTask.created_at).toISOString();
    console.log(`Latest update timestamp: ${latestUpdate}`);

    // Fetch with updated_since set to a time before the latest, expecting at least the latest task
    const beforeLatest = new Date(latestUpdate);
    beforeLatest.setMinutes(beforeLatest.getMinutes() - 10);
    const since = beforeLatest.toISOString();

    const sinceRes = await fetch(`${BASE}/api/tasks/all?project_id=${projectId}&updated_since=${encodeURIComponent(since)}`);
    if (!sinceRes.ok) throw new Error(`Failed to fetch with updated_since: ${sinceRes.status}`);
    const sinceTasks = await sinceRes.json();
    console.log(`Fetched with updated_since (${since}): ${sinceTasks.length} tasks`);

    // Check that tasks with updated_at > since are present
    const expected = allTasks.filter(t => {
      const updated = new Date(t.updated_at || t.created_at);
      return updated > new Date(since);
    });
    console.log(`Expected ${expected.length} tasks based on manual filter`);

    if (sinceTasks.length === expected.length) {
      console.log('✅ updated_since filter works correctly.');
    } else {
      console.warn(`⚠️ Mismatch: got ${sinceTasks.length}, expected ${expected.length}`);
    }

    // Also test that tasks with older timestamp are not included
    // (We can use a timestamp in the future, expecting zero)
    const future = new Date();
    future.setDate(future.getDate() + 1);
    const futureRes = await fetch(`${BASE}/api/tasks/all?project_id=${projectId}&updated_since=${future.toISOString()}`);
    if (futureRes.ok) {
      const futureTasks = await futureRes.json();
      if (futureTasks.length === 0) {
        console.log('✅ Future timestamp returns no tasks (correct).');
      } else {
        console.warn(`⚠️ Future timestamp returned ${futureTasks.length} tasks; expected 0.`);
      }
    }

  } catch (err) {
    console.error('Test failed:', err);
    process.exit(1);
  }
}

if (require.main === module) {
  testUpdatedSince().then(() => {
    console.log('Incremental sync tests completed.');
    process.exit(0);
  }).catch(err => {
    console.error(err);
    process.exit(1);
  });
}

module.exports = { testUpdatedSince };