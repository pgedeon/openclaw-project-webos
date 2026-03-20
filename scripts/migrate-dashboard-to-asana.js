#!/usr/bin/env node
/**
 * Migration Script: Convert legacy markdown tasks to Asana-style PostgreSQL
 *
 * Steps:
 * 1. Backup current tasks.md to tasks.md.backup
 * 2. Create "Legacy Dashboard" project (if not exists)
 * 3. Parse markdown tasks with nested checkboxes
 * 4. Insert tasks into PostgreSQL with proper hierarchy
 * 5. Map #openclaw tags to labels
 * 6. Validate and report
 */

const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

const WORKSPACE = process.env.OPENCLAW_WORKSPACE
  ? path.resolve(process.env.OPENCLAW_WORKSPACE)
  : path.resolve(__dirname, '..', '..');
const TASKS_FILE = path.join(WORKSPACE, 'tasks.md');
const BACKUP_FILE = path.join(WORKSPACE, 'tasks.md.backup');

// Import PostgreSQL storage
const AsanaStorage = require(path.join(__dirname, '..', 'storage', 'asana'));

async function main() {
  console.log('🚀 Starting migration from markdown to PostgreSQL...\n');

  // Check if tasks.md exists
  if (!fs.existsSync(TASKS_FILE)) {
    console.error(`❌ Tasks file not found: ${TASKS_FILE}`);
    process.exit(1);
  }

  // Step 1: Backup
  console.log('📋 Step 1: Backing up tasks.md...');
  fs.copyFileSync(TASKS_FILE, BACKUP_FILE);
  console.log(`✅ Backed up to ${BACKUP_FILE}\n`);

  // Read tasks.md
  const content = fs.readFileSync(TASKS_FILE, 'utf8');
  const lines = content.split('\n');

  // Step 2: Initialize storage
  console.log('📋 Step 2: Initializing PostgreSQL storage...');
  const storage = new AsanaStorage({
    host: process.env.POSTGRES_HOST || 'localhost',
    port: parseInt(process.env.POSTGRES_PORT) || 5432,
    database: process.env.POSTGRES_DB || 'openclaw_dashboard',
    user: process.env.POSTGRES_USER || 'openclaw',
    password: process.env.POSTGRES_PASSWORD || 'openclaw_password',
  });

  try {
    await storage.init();
    console.log('✅ Storage initialized\n');
  } catch (err) {
    console.error('❌ Failed to initialize storage:', err.message);
    process.exit(1);
  }

  // Step 3: Create or find "Legacy Dashboard" project
  console.log('📋 Step 3: Setting up "Legacy Dashboard" project...');

  // Find existing project
  let project;
  try {
    const projects = await storage.listProjects();
    project = projects.find(p => p.name === 'Legacy Dashboard');
    if (project) {
      console.log(`   Found existing project: ${project.id}`);
    } else {
      project = await storage.createProject({
        name: 'Legacy Dashboard',
        description: 'Migrated from legacy markdown tasks format',
        status: 'active',
        tags: ['legacy', 'migrated'],
        qmd_project_namespace: 'asana-tasks-legacy-dashboard'
      });
      console.log(`   Created new project: ${project.id}`);
    }
  } catch (err) {
    console.error('❌ Failed to create/find project:', err.message);
    process.exit(1);
  }

  // Step 4: Parse markdown tasks
  console.log('\n📋 Step 4: Parsing markdown tasks...');

  // Basic parser for:
  // - [ ] Task title #tag
  // - [x] Completed task
  //   - [ ] Subtask (indent with 2+ spaces)
  //   - [x] Completed subtask

  const tasks = [];
  const stack = []; // Track parent hierarchy by indentation level
  let rootLevel = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim()) continue;

    // Check for checkbox task
    const match = line.match(/^(\s*)- \[([ x])\] (.*?)(?:\s+#([^\s]+))?$/);
    if (!match) continue;

    const indent = match[1].length;
    const completed = match[2] === 'x';
    const title = match[3].trim();
    const tags = match[4] ? [match[4]] : [];

    // Determine parent based on indentation
    let parentTaskId = null;

    // Find the closest parent with less indentation
    while (stack.length > 0 && stack[stack.length - 1].indent >= indent) {
      stack.pop();
    }

    if (stack.length > 0) {
      parentTaskId = stack[stack.length - 1].taskId;
    }

    // Create task object
    const task = {
      title,
      completed,
      tags,
      parentTaskId,
      lineNumber: i + 1,
      indent
    };

    tasks.push(task);

    // Add to stack for potential children (use index i as temporary ID)
    stack.push({
      indent,
      taskId: i
    });
  }

  console.log(`   Found ${tasks.length} tasks in markdown file`);

  // Step 5: Insert tasks into database
  console.log('\n📋 Step 5: Inserting tasks into PostgreSQL...');

  let createdCount = 0;
  let errorCount = 0;

  // We need to insert in order so parent IDs are available for children
  // Use a map to track local task ID to DB ID
  const idMap = new Map();

  for (let i = 0; i < tasks.length; i++) {
    const task = tasks[i];

    // Determine status and completed_at
    let status = 'backlog';
    let completedAt = null;
    if (task.completed) {
      status = 'completed';
      completedAt = new Date().toISOString(); // We don't have original timestamp, use now
    }

    // Map tags to labels, set priority based on tags
    const labels = task.tags || [];
    let priority = 'medium';
    if (labels.includes('critical') || labels.includes('urgent')) {
      priority = 'critical';
    } else if (labels.includes('high')) {
      priority = 'high';
    } else if (labels.includes('low')) {
      priority = 'low';
    }

    // Determine parent_task_id from idMap
    let parentTaskId = null;
    if (task.parentTaskId) {
      parentTaskId = idMap.get(task.parentTaskId);
      if (!parentTaskId) {
        console.warn(`   ⚠️  Parent task ID not found for task at line ${task.lineNumber}, skipping parent link`);
      }
    }

    try {
      const dbTask = await storage.createTask({
        project_id: project.id,
        title: task.title,
        description: `Migrated from tasks.md line ${task.lineNumber}`,
        status,
        priority,
        owner: labels.includes('openclaw') ? 'openclaw' : null,
        labels: [...labels],
        parent_task_id: parentTaskId,
        completed_at: completedAt
      });

      // Map the simple sequential ID to DB UUID
      idMap.set(i, dbTask.id);
      createdCount++;

      if (createdCount % 100 === 0) {
        console.log(`   Progress: ${createdCount}/${tasks.length} tasks inserted...`);
      }
    } catch (err) {
      console.error(`   ❌ Error inserting task at line ${task.lineNumber}: ${err.message}`);
      errorCount++;
    }
  }

  console.log(`\n✅ Migration complete!`);
  console.log(`   Total tasks: ${tasks.length}`);
  console.log(`   Successfully inserted: ${createdCount}`);
  console.log(`   Errors: ${errorCount}`);

  // Step 6: Validation
  console.log('\n📋 Step 6: Validating data integrity...');

  // Count tasks in project
  const projectTasks = await storage.listTasks(project.id);
  console.log(`   Tasks in project "${project.name}": ${projectTasks.length}`);

  // Count parent-child relationships
  const tasksWithParents = projectTasks.filter(t => t.parent_task_id).length;
  console.log(`   Tasks with parents: ${tasksWithParents}`);

  // Count completed tasks
  const completedTasks = projectTasks.filter(t => t.status === 'completed').length;
  console.log(`   Completed tasks: ${completedTasks}`);

  // Validate integrity
  const integrity = await storage.validateIntegrity();
  if (!integrity.valid) {
    console.error('   ❌ Integrity check failed:');
    integrity.errors.forEach(err => console.error(`    - ${err}`));
  } else {
    console.log('   ✅ Integrity check passed');
  }

  // Get overall stats
  const stats = await storage.stats();
  console.log('\n📊 Database Statistics:');
  console.log(`   Projects: ${stats.projects}`);
  console.log(`   Tasks: ${stats.tasks}`);
  console.log(`   Workflows: ${stats.workflows}`);
  console.log(`   Audit entries: ${stats.audit_entries}`);

  console.log('\n✅ Migration completed successfully!');
  console.log('\nNext steps:');
  console.log('   1. Test the new API endpoints: http://localhost:3876/api/projects');
  console.log('   2. Test legacy endpoint still works: http://localhost:3876/api/tasks');
  console.log('   3. Update task-server.js to use STORAGE_TYPE=postgres (already default)');
  console.log('   4. Restart task-server if running');
  console.log('   5. Update openclaw-asana-style-dashboard-upgrade.md with completion status');

  await storage.close();
  process.exit(0);
}

// Run
main().catch(err => {
  console.error('❌ Migration failed:', err);
  process.exit(1);
});
