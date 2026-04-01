#!/usr/bin/env node

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { AsanaJsonSnapshotStorage, READ_ONLY_MESSAGE } = require('../storage/asana-json-snapshot');

async function run() {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'openclaw-asana-json-'));
  const snapshotPath = path.join(tempDir, 'asana-db.json');

  const snapshot = {
    version: '1.0',
    created_at: '2026-03-23T10:00:00.000Z',
    updated_at: '2026-03-23T10:05:00.000Z',
    projects: [
      {
        id: 'project-alpha',
        name: 'Alpha',
        status: 'active',
        default_workflow_id: 'workflow-default',
        created_at: '2026-03-23T10:00:00.000Z',
        updated_at: '2026-03-23T10:01:00.000Z',
      },
      {
        id: 'project-archive',
        name: 'Archive',
        status: 'archived',
        default_workflow_id: 'workflow-default',
        created_at: '2026-03-23T09:00:00.000Z',
        updated_at: '2026-03-23T09:01:00.000Z',
      }
    ],
    tasks: [
      {
        id: 'task-1',
        project_id: 'project-alpha',
        title: 'Ready task',
        status: 'ready',
        priority: 'high',
        labels: ['ops'],
        dependency_ids: [],
        owner: 'main',
        created_at: '2026-03-23T10:00:00.000Z',
        updated_at: '2026-03-23T10:00:00.000Z',
      },
      {
        id: 'task-2',
        project_id: 'project-alpha',
        title: 'Completed task',
        status: 'completed',
        priority: 'medium',
        labels: [],
        dependency_ids: ['task-1'],
        owner: 'main',
        created_at: '2026-03-23T10:02:00.000Z',
        updated_at: '2026-03-23T10:03:00.000Z',
        completed_at: '2026-03-23T10:03:00.000Z',
      },
      {
        id: 'task-3',
        project_id: 'project-archive',
        title: 'Archived task',
        status: 'archived',
        priority: 'low',
        labels: [],
        dependency_ids: [],
        owner: 'backup',
        created_at: '2026-03-23T09:00:00.000Z',
        updated_at: '2026-03-23T09:30:00.000Z',
      }
    ],
    workflows: [
      {
        id: 'workflow-default',
        name: 'Default Workflow',
        states: ['backlog', 'ready', 'in_progress', 'completed', 'archived'],
        is_default: true,
      }
    ],
    audit_log: [
      {
        id: 'audit-1',
        entity_type: 'task',
        entity_id: 'task-1',
        action: 'create',
        actor: 'system',
        timestamp: '2026-03-23T10:00:00.000Z',
      }
    ],
  };

  fs.writeFileSync(snapshotPath, JSON.stringify(snapshot, null, 2), 'utf8');

  try {
    const storage = new AsanaJsonSnapshotStorage(snapshotPath);
    await storage.init();

    const stats = await storage.stats();
    assert.equal(stats.projects, 2);
    assert.equal(stats.tasks, 3);
    assert.equal(stats.completed_tasks, 1);
    assert.equal(stats.storage_mode, 'json_snapshot');
    assert.equal(stats.read_only, true);

    const projects = await storage.listProjects();
    assert.equal(projects.length, 2);
    assert.equal(projects[0].id, 'project-alpha');
    assert.equal(projects[0].active_task_count, 1);
    assert.equal(projects[0].completed_task_count, 1);

    const defaultProject = await storage.getDefaultProject({ status: 'active' });
    assert.equal(defaultProject.id, 'project-alpha');

    const tasks = await storage.listAllTasks();
    assert.equal(tasks.length, 2, 'archived tasks should be hidden by default');
    assert.equal(tasks[0].project_name, 'Alpha');
    assert.equal(tasks[0].text, tasks[0].title);

    const archivedTasks = await storage.listAllTasks({ include_archived: true });
    assert.equal(archivedTasks.length, 3);

    const task = await storage.getTask('task-2', { includeGraph: true, include_archived: true });
    assert.equal(task.dependencies.length, 1);
    assert.equal(task.dependencies[0].id, 'task-1');

    const board = await storage.getBoardView('project-alpha');
    assert.equal(board.workflow.includes('ready'), true);
    assert.equal(board.columns.ready.length, 1);
    assert.equal(board.columns.completed.length, 1);
    assert.equal(board.read_only, true);

    const timeline = await storage.getTimelineView('project-alpha');
    assert.equal(Array.isArray(timeline.items), true);
    assert.equal(Array.isArray(timeline.unscheduled), true);

    const queue = await storage.getAgentQueue('main');
    assert.equal(queue.tasks.length, 1);
    assert.equal(queue.tasks[0].id, 'task-1');

    const audit = await storage.queryAuditLog({}, 10, 0);
    assert.equal(audit.total, 1);

    await assert.rejects(
      async () => storage.updateTask('task-1', { status: 'completed' }),
      (error) => error.message === READ_ONLY_MESSAGE
    );

    console.log('PASS: asana json snapshot storage');
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

run().catch((error) => {
  console.error('FAIL: asana json snapshot storage');
  console.error(error);
  process.exit(1);
});
