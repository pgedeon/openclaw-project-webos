#!/usr/bin/env node
/**
 * Dashboard Validation & Health Check
 * Validates data integrity, API correctness, and system health
 * For Phase 15.19: Testing & Validation
 */

const { Pool } = require('pg');
const http = require('http');
const { URL } = require('url');

const CONFIG = {
  postgres: {
    host: process.env.POSTGRES_HOST || 'localhost',
    port: parseInt(process.env.POSTGRES_PORT) || 5432,
    database: process.env.POSTGRES_DB || 'openclaw_dashboard',
    user: process.env.POSTGRES_USER || 'openclaw',
    password: process.env.POSTGRES_PASSWORD ,
  },
  apiBase: process.env.DASHBOARD_API_BASE || `http://localhost:${process.env.PORT || '3876'}`,
  maxIssues: 100
};

class ValidationRunner {
  constructor() {
    this.issues = [];
    this.passed = 0;
    this.failed = 0;
    this.warnings = 0;
  }

  log(msg, type = 'info') {
    const prefix = {
      'pass': '✅',
      'fail': '❌',
      'warn': '⚠️',
      'info': 'ℹ️'
    }[type] || '•';
    console.log(`${prefix} ${msg}`);
  }

  pass(check) {
    this.passed++;
    this.log(`PASS: ${check}`, 'pass');
  }

  fail(check, details) {
    this.failed++;
    const msg = `${check}${details ? ` - ${details}` : ''}`;
    this.log(msg, 'fail');
    this.issues.push({ check, details, severity: 'error' });
  }

  warn(msg) {
    this.warnings++;
    this.log(msg, 'warn');
    this.issues.push({ check: msg, severity: 'warning' });
  }

  async request(pathname) {
    const url = new URL(pathname, CONFIG.apiBase);
    return new Promise((resolve, reject) => {
      http.get(url, { timeout: 5000 }, (resp) => {
        let data = '';
        resp.on('data', chunk => data += chunk);
        resp.on('end', () => resolve({ status: resp.statusCode, body: data }));
        resp.on('error', reject);
      }).on('error', reject);
    });
  }

  async requestJson(pathname) {
    const res = await this.request(pathname);
    let json = null;
    if (res.body) {
      try {
        json = JSON.parse(res.body);
      } catch (err) {
        throw new Error(`Invalid JSON from ${pathname}: ${err.message}`);
      }
    }
    return { ...res, json };
  }

  async checkPostgresConnection() {
    try {
      const pool = new Pool(CONFIG.postgres);
      const res = await pool.query('SELECT 1 as ok');
      if (res.rows[0].ok === 1) {
        this.pass('PostgreSQL connection OK');
        return pool;
      } else {
        this.fail('PostgreSQL connection test', 'Unexpected response');
        return null;
      }
    } catch (err) {
      this.fail('PostgreSQL connection', err.message);
      return null;
    }
  }

  async checkSchema(pool) {
    try {
      const tables = ['projects', 'tasks', 'workflows', 'audit_log'];
      const res = await pool.query(`
        SELECT table_name FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name = ANY($1)
      `, [tables]);

      const found = res.rows.map(r => r.table_name);
      for (const tbl of tables) {
        if (found.includes(tbl)) {
          this.pass(`Table ${tbl} exists`);
        } else {
          this.fail(`Table ${tbl} missing`);
        }
      }
    } catch (err) {
      this.fail('Schema check', err.message);
    }
  }

  async checkDataIntegrity(pool) {
    // Count projects, tasks, workflows
    try {
      const counts = await pool.query(`
        SELECT
          (SELECT COUNT(*) FROM projects) as projects,
          (SELECT COUNT(*) FROM tasks) as tasks,
          (SELECT COUNT(*) FROM workflows) as workflows,
          (SELECT COUNT(*) FROM audit_log) as audit_log
      `);
      const row = counts.rows[0];
      this.log(`Database counts: ${JSON.stringify(row)}`, 'info');

      if (row.projects >= 1) this.pass('At least one project exists');
      if (row.tasks >= 1) this.pass('At least one task exists');
      if (row.workflows >= 1) this.pass('At least one workflow exists');
      if (row.audit_log >= row.tasks) this.pass('Audit log coverage >= task count');
    } catch (err) {
      this.fail('Data counts', err.message);
    }

    // Check for orphaned tasks (no project)
    try {
      const orphan = await pool.query(`
        SELECT COUNT(*) FROM tasks t
        LEFT JOIN projects p ON t.project_id = p.id
        WHERE p.id IS NULL
      `);
      const count = parseInt(orphan.rows[0].count);
      if (count === 0) {
        this.pass('No orphaned tasks');
      } else {
        this.fail(`Orphaned tasks found: ${count}`);
      }
    } catch (err) {
      this.fail('Orphan check', err.message);
    }

    // Check for tasks missing required fields
    try {
      const missing = await pool.query(`
        SELECT COUNT(*) FROM tasks
        WHERE title IS NULL OR title = ''
           OR status IS NULL OR status = ''
           OR priority IS NULL OR priority = ''
           OR project_id IS NULL
      `);
      const count = parseInt(missing.rows[0].count);
      if (count === 0) {
        this.pass('All tasks have required fields (title, status, priority, project_id)');
      } else {
        this.fail(`Tasks missing required fields: ${count}`);
      }
    } catch (err) {
      this.fail('Required fields check', err.message);
    }

    // Check dependency validity (pointing to non-existent tasks)
    try {
      const badDeps = await pool.query(`
        WITH deps AS (
          SELECT unnest(dependency_ids) as dep_id FROM tasks WHERE dependency_ids IS NOT NULL
        )
        SELECT COUNT(*) FROM deps d
        LEFT JOIN tasks t ON d.dep_id = t.id
        WHERE t.id IS NULL
      `);
      const count = parseInt(badDeps.rows[0].count);
      if (count === 0) {
        this.pass('All dependency references are valid');
      } else {
        this.fail(`Invalid dependency references: ${count}`);
      }
    } catch (err) {
      this.fail('Dependency validity check', err.message);
    }

    // Check for circular dependencies (simple depth-2 check)
    try {
      const circular = await pool.query(`
        SELECT COUNT(*) FROM tasks t1
        JOIN tasks t2 ON t2.id = ANY(t1.dependency_ids)
        WHERE t1.id = ANY(t2.dependency_ids)
      `);
      const count = parseInt(circular.rows[0].count);
      if (count === 0) {
        this.pass('No immediate circular dependencies (depth 2)');
      } else {
        this.warn(`Potential circular dependencies detected: ${count} pairs`);
      }
    } catch (err) {
      this.fail('Circular dependency check', err.message);
    }

    // Check for tasks in_progress with incomplete dependencies
    try {
      const blocked = await pool.query(`
        SELECT COUNT(*) FROM tasks t1
        WHERE t1.status = 'in_progress'
          AND EXISTS (
            SELECT 1 FROM unnest(t1.dependency_ids) as dep_id
            LEFT JOIN tasks t2 ON dep_id = t2.id
            WHERE t2.status != 'completed'
          )
      `);
      const count = parseInt(blocked.rows[0].count);
      if (count === 0) {
        this.pass('No in_progress tasks with incomplete dependencies');
      } else {
        this.warn(`in_progress tasks with unmet dependencies: ${count} (should be blocked)`);
      }
    } catch (err) {
      this.fail('Blocking check', err.message);
    }

    // Check parent-child relationships (parent exists, child exists)
    try {
      const orphanParents = await pool.query(`
        SELECT COUNT(*) FROM tasks t
        WHERE t.parent_task_id IS NOT NULL
          AND NOT EXISTS (SELECT 1 FROM tasks p WHERE p.id = t.parent_task_id)
      `);
      const count = parseInt(orphanParents.rows[0].count);
      if (count === 0) {
        this.pass('All parent_task_id references are valid');
      } else {
        this.fail(`Orphaned parent_task_id references: ${count}`);
      }
    } catch (err) {
      this.fail('Parent-child validity check', err.message);
    }

    // Check for completed tasks with incomplete children (should auto-complete rule)
    try {
      const parentIncomplete = await pool.query(`
        WITH parents AS (
          SELECT t.id FROM tasks t
          WHERE t.parent_task_id IS NULL
            AND t.status = 'completed'
        )
        SELECT COUNT(*) FROM parents p
        JOIN tasks c ON c.parent_task_id = p.id
        WHERE c.status != 'completed'
      `);
      const count = parseInt(parentIncomplete.rows[0].count);
      if (count === 0) {
        this.pass('No completed parents with incomplete children');
      } else {
        this.warn(`Completed parents with incomplete children: ${count}`);
      }
    } catch (err) {
      this.fail('Parent completion rule check', err.message);
    }

    // Check distribution of statuses
    try {
      const statusDist = await pool.query(`
        SELECT status, COUNT(*) FROM tasks GROUP BY status ORDER BY status
      `);
      this.log(`Status distribution: ${JSON.stringify(statusDist.rows)}`, 'info');
    } catch (err) {
      this.fail('Status distribution query', err.message);
    }

    // Check distribution of priorities
    try {
      const priorityDist = await pool.query(`
        SELECT priority, COUNT(*) FROM tasks GROUP BY priority ORDER BY priority
      `);
      this.log(`Priority distribution: ${JSON.stringify(priorityDist.rows)}`, 'info');
    } catch (err) {
      this.fail('Priority distribution query', err.message);
    }

    // Verify default workflow exists
    try {
      const wf = await pool.query('SELECT id FROM workflows WHERE is_default = true LIMIT 1');
      if (wf.rows.length > 0) {
        this.pass('Default workflow exists');
      } else {
        this.fail('No default workflow defined');
      }
    } catch (err) {
      this.fail('Default workflow check', err.message);
    }

    // Check that all projects have a workflow assigned
    try {
      const noWf = await pool.query(`
        SELECT COUNT(*) FROM projects
        WHERE default_workflow_id IS NULL
      `);
      const count = parseInt(noWf.rows[0].count);
      if (count === 0) {
        this.pass('All projects have a default workflow');
      } else {
        this.fail(`Projects without workflow: ${count}`);
      }
    } catch (err) {
      this.fail('Project workflow assignment', err.message);
    }
  }

  async checkAPIEndpoints() {
    const staticEndpoints = [
      '/api/health',
      '/api/stats',
      '/api/views/agent?agent_name=openclaw'
    ];

    for (const ep of staticEndpoints) {
      try {
        const res = await this.request(ep);

        if (res.status === 200) {
          this.pass(`API endpoint ${ep} returns 200`);
        } else if (res.status === 404) {
          this.warn(`API endpoint ${ep} returns 404 (not implemented?)`);
        } else {
          this.fail(`API endpoint ${ep} returns ${res.status}`);
        }
      } catch (err) {
        this.fail(`API endpoint ${ep} unreachable`, err.message);
      }
    }

    let defaultProject = null;

    try {
      const res = await this.requestJson('/api/projects/default?status=active');
      if (res.status !== 200 || !res.json?.id) {
        this.fail('API endpoint /api/projects/default returns default project', `status=${res.status}`);
      } else {
        defaultProject = res.json;
        this.pass('API endpoint /api/projects/default returns an active default project');
      }
    } catch (err) {
      this.fail('API endpoint /api/projects/default unreachable', err.message);
    }

    try {
      const res = await this.requestJson('/api/projects?status=active&include_meta=true&limit=5');
      if (res.status !== 200) {
        this.fail('Paginated /api/projects endpoint returns 200', `status=${res.status}`);
      } else if (!res.json || !Array.isArray(res.json.items)) {
        this.fail('Paginated /api/projects payload shape', 'missing items array');
      } else {
        this.pass('Paginated /api/projects payload shape is valid');
        if (res.json.items.length <= 5) {
          this.pass('Paginated /api/projects respects requested limit');
        } else {
          this.fail('Paginated /api/projects respects requested limit', `returned ${res.json.items.length} items`);
        }
      }
    } catch (err) {
      this.fail('Paginated /api/projects endpoint', err.message);
    }

    try {
      const res = await this.requestJson('/api/projects?status=active&include_meta=true&limit=500');
      if (res.status !== 200) {
        this.fail('Capped /api/projects endpoint returns 200', `status=${res.status}`);
      } else if (!res.json || !Array.isArray(res.json.items)) {
        this.fail('Capped /api/projects payload shape', 'missing items array');
      } else if (res.json.items.length <= 200 && Number(res.json.limit) <= 200) {
        this.pass('Paginated /api/projects caps oversized limits');
      } else {
        this.fail(
          'Paginated /api/projects caps oversized limits',
          `returned ${res.json.items.length} items with reported limit ${res.json.limit}`
        );
      }
    } catch (err) {
      this.fail('Capped /api/projects endpoint', err.message);
    }

    if (!defaultProject?.id) {
      this.warn('Skipping project-scoped API checks because no default project was resolved');
      return;
    }

    const projectEndpoints = [
      `/api/tasks/all?project_id=${encodeURIComponent(defaultProject.id)}`,
      `/api/views/board?project_id=${encodeURIComponent(defaultProject.id)}`,
      `/api/views/timeline?project_id=${encodeURIComponent(defaultProject.id)}`
    ];

    for (const ep of projectEndpoints) {
      try {
        const res = await this.request(ep);
        if (res.status === 200) {
          this.pass(`API endpoint ${ep} returns 200`);
        } else if (res.status === 404) {
          this.warn(`API endpoint ${ep} returns 404 (not implemented?)`);
        } else {
          this.fail(`API endpoint ${ep} returns ${res.status}`);
        }
      } catch (err) {
        this.fail(`API endpoint ${ep} unreachable`, err.message);
      }
    }
  }

  async checkQMDIntegration() {
    // Check that QMD directories exist
    const fs = require('fs');
    const path = require('path');
    const qmdDir = path.resolve(__dirname, '../../data/qmd');
    if (fs.existsSync(qmdDir)) {
      this.pass('QMD data directory exists');
    } else {
      this.warn('QMD data directory not found');
    }

    // Check that project namespaces are correctly set
    // We could query tasks to see if qmd_project_namespace is populated
    // Already done in data integrity
  }

  async run() {
    console.log('\n=== Dashboard Validation & Health Check ===\n');

    const pool = await this.checkPostgresConnection();
    if (!pool) {
      this.fail('Cannot proceed without database connection');
      process.exit(1);
    }

    await this.checkSchema(pool);
    await this.checkDataIntegrity(pool);
    await this.checkAPIEndpoints();
    await this.checkQMDIntegration();

    // Summary
    console.log('\n=== Validation Summary ===');
    console.log(`Passed: ${this.passed}`);
    console.log(`Failed: ${this.failed}`);
    console.log(`Warnings: ${this.warnings}`);
    console.log(`Total issues: ${this.issues.length}`);

    if (this.failed > 0) {
      console.log('\n❌ VALIDATION FAILED - Please review errors above.');
      process.exit(1);
    } else if (this.warnings > 0) {
      console.log('\n⚠️ VALIDATION PASSED WITH WARNINGS');
      process.exit(0);
    } else {
      console.log('\n✅ VALIDATION PASSED');
      process.exit(0);
    }
  }
}

const runner = new ValidationRunner();
runner.run().catch(err => {
  console.error('Validation runner crashed:', err);
  process.exit(1);
});
