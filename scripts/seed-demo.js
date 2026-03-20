#!/usr/bin/env node
/**
 * Seed Demo Data
 * Populates the database with sample projects, tasks, and audit activity
 * for demo/development purposes.
 *
 * Usage: node scripts/seed-demo.js
 *
 * Requires POSTGRES_* env vars or defaults from .env.example
 */

const { Pool } = require('pg');

const DEFAULTS = {
  host: process.env.POSTGRES_HOST || 'localhost',
  port: parseInt(process.env.POSTGRES_PORT, 10) || 5432,
  database: process.env.POSTGRES_DB || 'openclaw_webos',
  user: process.env.POSTGRES_USER || 'openclaw',
  password: process.env.POSTGRES_PASSWORD || 'openclaw_password',
};

async function seed() {
  const pool = new Pool(DEFAULTS);

  console.log('🌱 Seeding demo data...\n');

  // Create default workflow
  const workflowStates = ['backlog', 'ready', 'in_progress', 'blocked', 'review', 'completed', 'archived'];
  const wfResult = await pool.query(`
    INSERT INTO workflows (name, states)
    VALUES ('Default Workflow', $1)
    ON CONFLICT (name) DO UPDATE SET states = EXCLUDED.states
    RETURNING id
  `, [workflowStates]);
  const workflowId = wfResult.rows[0].id;
  console.log(`  Workflow: Default Workflow (${workflowId})`);

  // Create departments
  const departments = [
    { name: 'Engineering', description: 'Platform development and infrastructure', color: '#3b82f6', icon: 'cpu' },
    { name: 'Design', description: 'UI/UX and visual design', color: '#a855f7', icon: 'palette' },
    { name: 'Content & Publishing', description: 'Blog content, SEO, and publishing pipeline', color: '#22c55e', icon: 'file-text' },
    { name: 'Operations', description: 'System operations and automation', color: '#f59e0b', icon: 'settings' },
  ];

  const deptIds = {};
  for (const dept of departments) {
    const r = await pool.query(
      `INSERT INTO departments (name, description, color, icon, sort_order)
       VALUES ($1, $2, $3, $4, $5) ON CONFLICT (name) DO NOTHING RETURNING id`,
      [dept.name, dept.description, dept.color, dept.icon, departments.indexOf(dept) * 10]
    );
    if (r.rows.length) {
      deptIds[dept.name] = r.rows[0].id;
      console.log(`  Department: ${dept.name}`);
    }
  }

  // Create projects
  const projects = [
    { name: 'WebOS Dashboard', department: 'Engineering', child_count: 0 },
    { name: 'API Gateway', department: 'Engineering', child_count: 0 },
    { name: 'Design System', department: 'Design', child_count: 0 },
    { name: 'Blog Pipeline', department: 'Content & Publishing', child_count: 2 },
    { name: 'SEO Automation', department: 'Content & Publishing', child_count: 0 },
    { name: 'Infrastructure', department: 'Operations', child_count: 0 },
  ];

  const projectIds = {};
  for (const proj of projects) {
    const deptId = deptIds[proj.department];
    const r = await pool.query(
      `INSERT INTO projects (name, default_workflow_id, department_id, child_count, project_path)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (name) DO UPDATE SET default_workflow_id = EXCLUDED.default_workflow_id, department_id = EXCLUDED.department_id
       RETURNING id`,
      [proj.name, workflowId, deptId, proj.child_count, proj.name]
    );
    projectIds[proj.name] = r.rows[0].id;
    console.log(`  Project: ${proj.name}`);
  }

  // Create sample tasks
  const tasks = [
    // WebOS Dashboard project
    { title: 'Implement window snapping', project: 'WebOS Dashboard', status: 'completed', priority: 'high', owner: 'alice', created: '2026-03-15', completed: '2026-03-17' },
    { title: 'Add drag-and-drop task cards', project: 'WebOS Dashboard', status: 'completed', priority: 'high', owner: 'alice', created: '2026-03-14', completed: '2026-03-16' },
    { title: 'Build start menu navigation', project: 'WebOS Dashboard', status: 'completed', priority: 'medium', owner: 'bob', created: '2026-03-13', completed: '2026-03-15' },
    { title: 'Create kanban board view', project: 'WebOS Dashboard', status: 'completed', priority: 'high', owner: 'alice', created: '2026-03-18', completed: '2026-03-20' },
    { title: 'Gantt timeline with zoom', project: 'WebOS Dashboard', status: 'completed', priority: 'medium', owner: 'bob', created: '2026-03-18', completed: '2026-03-19' },
    { title: 'Activity feed for handoffs', project: 'WebOS Dashboard', status: 'completed', priority: 'medium', owner: 'alice', created: '2026-03-19', completed: '2026-03-20' },
    { title: 'Runbooks from workflow templates', project: 'WebOS Dashboard', status: 'completed', priority: 'low', owner: 'bob', created: '2026-03-19', completed: '2026-03-20' },
    { title: 'Multi-monitor support', project: 'WebOS Dashboard', status: 'in_progress', priority: 'medium', owner: 'alice', created: '2026-03-20' },
    { title: 'Window resize handles', project: 'WebOS Dashboard', status: 'in_progress', priority: 'medium', owner: 'bob', created: '2026-03-20' },
    { title: 'Notification center panel', project: 'WebOS Dashboard', status: 'ready', priority: 'medium', owner: null, created: '2026-03-20' },
    { title: 'System tray with clock', project: 'WebOS Dashboard', status: 'ready', priority: 'low', owner: null, created: '2026-03-20' },
    { title: 'Dark mode refinements', project: 'WebOS Dashboard', status: 'backlog', priority: 'low', owner: null, created: '2026-03-20' },
    { title: 'Virtual desktop workspaces', project: 'WebOS Dashboard', status: 'backlog', priority: 'low', owner: null, created: '2026-03-20' },

    // API Gateway project
    { title: 'Rate limiting middleware', project: 'API Gateway', status: 'completed', priority: 'high', owner: 'charlie', created: '2026-03-10', completed: '2026-03-14' },
    { title: 'WebSocket connection pooling', project: 'API Gateway', status: 'completed', priority: 'high', owner: 'charlie', created: '2026-03-12', completed: '2026-03-15' },
    { title: 'Request tracing with correlation IDs', project: 'API Gateway', status: 'in_progress', priority: 'high', owner: 'charlie', created: '2026-03-16' },
    { title: 'Health check aggregation', project: 'API Gateway', status: 'review', priority: 'medium', owner: 'diana', created: '2026-03-15' },
    { title: 'API versioning v2 endpoints', project: 'API Gateway', status: 'ready', priority: 'medium', owner: null, created: '2026-03-18' },
    { title: 'Circuit breaker pattern', project: 'API Gateway', status: 'backlog', priority: 'medium', owner: null, created: '2026-03-19' },
    { title: 'Response caching layer', project: 'API Gateway', status: 'backlog', priority: 'low', owner: null, created: '2026-03-19' },

    // Design System project
    { title: 'Component token system', project: 'Design System', status: 'completed', priority: 'high', owner: 'diana', created: '2026-03-08', completed: '2026-03-12' },
    { title: 'Color palette generator', project: 'Design System', status: 'completed', priority: 'medium', owner: 'diana', created: '2026-03-10', completed: '2026-03-13' },
    { title: 'Typography scale system', project: 'Design System', status: 'in_progress', priority: 'medium', owner: 'diana', created: '2026-03-14' },
    { title: 'Icon library integration', project: 'Design System', status: 'backlog', priority: 'low', owner: null, created: '2026-03-16' },

    // Blog Pipeline project
    { title: 'Affiliate link validator', project: 'Blog Pipeline', status: 'completed', priority: 'high', owner: 'alice', created: '2026-03-05', completed: '2026-03-08' },
    { title: 'Content quality scorer', project: 'Blog Pipeline', status: 'review', priority: 'high', owner: 'alice', created: '2026-03-12' },
    { title: 'Auto-publish workflow', project: 'Blog Pipeline', status: 'in_progress', priority: 'medium', owner: 'bob', created: '2026-03-16' },
    { title: 'Image compression pipeline', project: 'Blog Pipeline', status: 'ready', priority: 'medium', owner: null, created: '2026-03-18' },

    // SEO Automation project
    { title: 'SERP position tracker', project: 'SEO Automation', status: 'completed', priority: 'high', owner: 'charlie', created: '2026-03-01', completed: '2026-03-07' },
    { title: 'Schema markup generator', project: 'SEO Automation', status: 'in_progress', priority: 'medium', owner: 'charlie', created: '2026-03-14' },
    { title: 'Keyword gap analysis tool', project: 'SEO Automation', status: 'backlog', priority: 'medium', owner: null, created: '2026-03-19' },

    // Infrastructure project
    { title: 'Kubernetes deployment configs', project: 'Infrastructure', status: 'completed', priority: 'high', owner: 'bob', created: '2026-03-02', completed: '2026-03-06' },
    { title: 'Monitoring dashboard setup', project: 'Infrastructure', status: 'completed', priority: 'high', owner: 'bob', created: '2026-03-08', completed: '2026-03-11' },
    { title: 'Automated backup rotation', project: 'Infrastructure', status: 'completed', priority: 'medium', owner: 'charlie', created: '2026-03-10', completed: '2026-03-13' },
    { title: 'SSL certificate automation', project: 'Infrastructure', status: 'completed', priority: 'medium', owner: 'charlie', created: '2026-03-14', completed: '2026-03-17' },
    { title: 'Disaster recovery runbook', project: 'Infrastructure', status: 'in_progress', priority: 'high', owner: 'bob', created: '2026-03-18' },
    { title: 'Cost optimization review', project: 'Infrastructure', status: 'backlog', priority: 'low', owner: null, created: '2026-03-20' },
  ];

  const taskIds = [];
  for (const t of tasks) {
    const projectId = projectIds[t.project];
    const completedAt = t.completed ? new Date(t.completed).toISOString() : null;
    const r = await pool.query(
      `INSERT INTO tasks (title, project_id, status, priority, owner, created_at, completed_at, description, workspace_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, '00000000-0000-0000-0000-000000000000')
       ON CONFLICT DO NOTHING
       RETURNING id`,
      [t.title, projectId, t.status, t.priority, t.owner, new Date(t.created).toISOString(), completedAt,
       `Sample task for ${t.project}: ${t.title}`]
    );
    if (r.rows.length) {
      taskIds.push({ id: r.rows[0].id, ...t });
      console.log(`  Task: [${t.status}] ${t.title}`);
    }
  }

  // Generate audit log entries for the activity feed
  console.log('\n  Generating audit log entries...');
  let auditCount = 0;

  for (const t of taskIds) {
    // Create event
    await pool.query(
      `INSERT INTO audit_log (task_id, actor, action, old_value, new_value, timestamp) VALUES ($1, $2, 'create', NULL, $3, $4)`,
      [t.id, t.owner || 'system', JSON.stringify({ title: t.title, owner: t.owner, status: 'backlog' }), new Date(t.created).toISOString()]
    );
    auditCount++;

    // Status change events
    if (t.status !== 'backlog' && t.status !== 'created') {
      const fromStatus = 'backlog';
      const toStatus = t.status;
      const timestamp = new Date(t.created).toISOString();
      // Set timestamp to midway between created and completed
      const midTime = t.completed
        ? new Date((new Date(t.created).getTime() + new Date(t.completed).getTime()) / 2).toISOString()
        : new Date(Date.now() - Math.random() * 86400000 * 3).toISOString();

      await pool.query(
        `INSERT INTO audit_log (task_id, actor, action, old_value, new_value, timestamp) VALUES ($1, $2, 'update', $3, $4, $5)`,
        [t.id, t.owner || 'system', JSON.stringify({ status: fromStatus }), JSON.stringify({ status: toStatus }), midTime]
      );
      auditCount++;
    }

    // Completed event
    if (t.completed) {
      await pool.query(
        `INSERT INTO audit_log (task_id, actor, action, old_value, new_value, timestamp) VALUES ($1, $2, 'update', $3, $4, $5)`,
        [t.id, t.owner || 'system', JSON.stringify({ status: t.status.replace('completed', 'in_progress') }), JSON.stringify({ status: 'completed' }), t.completed]
      );
      auditCount++;
    }
  }

  // Simulate some handoff events (owner changes)
  const handoffs = [
    { title: 'Implement window snapping', from: 'alice', to: 'bob', actor: 'alice' },
    { title: 'Build start menu navigation', from: 'bob', to: 'alice', actor: 'bob' },
    { title: 'Rate limiting middleware', from: 'charlie', to: 'diana', actor: 'charlie' },
    { title: 'Monitoring dashboard setup', from: 'bob', to: 'charlie', actor: 'bob' },
    { title: 'Content quality scorer', from: 'alice', to: 'diana', actor: 'alice' },
  ];

  for (const h of handoffs) {
    const task = taskIds.find(t => t.title === h.title);
    if (task) {
      await pool.query(
        `INSERT INTO audit_log (task_id, actor, action, old_value, new_value, timestamp) VALUES ($1, $2, 'update', $3, $4, $5)`,
        [task.id, h.actor, JSON.stringify({ owner: h.from }), JSON.stringify({ owner: h.to }),
         new Date(Date.now() - Math.random() * 86400000 * 5).toISOString()]
      );
      auditCount++;
      console.log(`  Handoff: ${h.title} (${h.from} → ${h.to})`);
    }
  }

  // Create workflow templates
  const templates = [
    { name: 'feature-development', display_name: 'Feature Development', category: 'development', description: 'Standard workflow for developing new features from design to deployment.', steps: ['planning', 'implementation', 'testing', 'review', 'deploy'], department: 'Engineering', owner: 'alice' },
    { name: 'bug-fix', display_name: 'Bug Fix', category: 'development', description: 'Triage, fix, and verify bug fixes.', steps: ['triage', 'investigation', 'fix', 'verification', 'close'], department: 'Engineering', owner: 'alice' },
    { name: 'content-publish', display_name: 'Content Publishing', category: 'content', description: 'End-to-end content creation and publishing workflow.', steps: ['research', 'drafting', 'review', 'seo-optimization', 'publish'], department: 'Content & Publishing', owner: 'alice' },
    { name: 'design-review', display_name: 'Design Review', category: 'design', description: 'Design critique and iteration workflow.', steps: ['submission', 'review', 'feedback', 'revision', 'approval'], department: 'Design', owner: 'diana' },
    { name: 'incident-response', display_name: 'Incident Response', category: 'operations', description: 'Structured incident investigation and resolution.', steps: ['detection', 'triage', 'investigation', 'remediation', 'postmortem'], department: 'Operations', owner: 'bob' },
  ];

  for (const t of templates) {
    const deptId = deptIds[t.department];
    const stepsJson = t.steps.map((s, i) => ({ name: s, display_name: s.replace(/-/g, ' '), required: true }));
    const r = await pool.query(
      `INSERT INTO workflow_templates (name, display_name, description, category, steps, department_id, default_owner_agent, is_active, default_workflow_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, true, $8)
       ON CONFLICT (name) DO NOTHING RETURNING id`,
      [t.name, t.display_name, t.description, t.category, JSON.stringify(stepsJson), deptId, t.owner, workflowId]
    );
    if (r.rows.length) {
      console.log(`  Template: ${t.display_name}`);
    }
  }

  await pool.end();

  console.log(`\n✅ Seeding complete!`);
  console.log(`   ${Object.keys(projectIds).length} projects`);
  console.log(`   ${tasks.length} tasks`);
  console.log(`   ${auditCount} audit log entries`);
  console.log(`   ${templates.length} workflow templates`);
  console.log(`\n   Start the server: node task-server.js`);
  console.log(`   Open: http://localhost:3876`);
}

seed().catch(err => {
  console.error('❌ Seed failed:', err.message);
  process.exit(1);
});
