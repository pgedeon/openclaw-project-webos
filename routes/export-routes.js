/**
 * Export / Import routes
 *
 * Allows exporting all dashboard data (tasks, projects, workflows, settings)
 * as a JSON bundle and re-importing it.
 */

function registerExportRoutes(router, deps, settingsStore) {
  const getPool = () => deps?.pool || deps;
  const _ensurePool = (res, ctx) => { if (!getPool()) { ctx.sendJSON(res, 503, { error: 'Database not available (running in JSON snapshot mode)' }); return false; } return true; };

  // GET /api/export — export everything as a JSON bundle
  router.add('GET', '/api/export', async (req, res, ctx) => {
    try {
      if (!_ensurePool(res, ctx)) return;
      if (!_ensurePool(res, ctx)) return;
      const pool = getPool();
      const [projects, tasks, workflows, audit] = await Promise.all([
        pool.query('SELECT * FROM projects ORDER BY created_at'),
        pool.query('SELECT * FROM tasks ORDER BY created_at'),
        pool.query('SELECT * FROM workflows ORDER BY created_at'),
        pool.query('SELECT * FROM audit_log ORDER BY timestamp DESC LIMIT 500'),
      ]);

      let settings = {};
      try { settings = settingsStore?.getAll?.() || {}; } catch {}

      const bundle = {
        version: 1,
        exportedAt: new Date().toISOString(),
        projects: projects.rows,
        tasks: tasks.rows,
        workflows: workflows.rows,
        auditLog: audit.rows,
        settings,
      };

      ctx.sendJSON(res, 200, bundle);
    } catch (err) {
      ctx.sendJSON(res, 500, { error: err.message });
    }
  });

  // POST /api/import/preview — preview what would be imported
  router.add('POST', '/api/import/preview', async (req, res, ctx) => {
    try {
      let body;
      try {
        body = await new Promise((resolve, reject) => {
          let data = '';
          req.on('data', chunk => data += chunk);
          req.on('end', () => resolve(JSON.parse(data)));
          req.on('error', reject);
        });
      } catch { return ctx.sendJSON(res, 400, { error: 'Invalid JSON body' }); }

      if (!body.version) return ctx.sendJSON(res, 400, { error: 'Missing bundle version' });

      ctx.sendJSON(res, 200, {
        version: body.version,
        projects: (body.projects || []).length,
        tasks: (body.tasks || []).length,
        workflows: (body.workflows || []).length,
        auditLog: (body.auditLog || []).length,
        hasSettings: !!(body.settings && Object.keys(body.settings).length > 0),
        projectNames: (body.projects || []).map(p => p.name),
      });
    } catch (err) {
      ctx.sendJSON(res, 500, { error: err.message });
    }
  });

  // POST /api/import — import a bundle
  router.add('POST', '/api/import', async (req, res, ctx) => {
    if (!_ensurePool(res, ctx)) return;
      if (!_ensurePool(res, ctx)) return;
      const pool = getPool();
      const client = await pool.connect();
    try {
      let body;
      try {
        body = await new Promise((resolve, reject) => {
          let data = '';
          req.on('data', chunk => data += chunk);
          req.on('end', () => resolve(JSON.parse(data)));
          req.on('error', reject);
        });
      } catch { return ctx.sendJSON(res, 400, { error: 'Invalid JSON body' }); }

      if (!body.version) return ctx.sendJSON(res, 400, { error: 'Missing bundle version' });

      const mode = body.mode || 'merge'; // merge | replace
      const counts = { projects: 0, tasks: 0, workflows: 0, auditLog: 0 };

      await client.query('BEGIN');

      if (mode === 'replace') {
        await client.query('DELETE FROM audit_log');
        await client.query('DELETE FROM tasks');
        await client.query('DELETE FROM workflows WHERE is_default = false');
        await client.query('DELETE FROM projects');
      }

      // Import workflows first (referenced by projects)
      for (const wf of (body.workflows || [])) {
        const exists = await client.query('SELECT id FROM workflows WHERE id = $1', [wf.id]);
        if (exists.rows.length === 0) {
          await client.query(
            `INSERT INTO workflows (id, name, states, is_default, project_id, created_at, updated_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7)
             ON CONFLICT (id) DO NOTHING`,
            [wf.id, wf.name, wf.states || [], wf.is_default || false, wf.project_id, wf.created_at || new Date(), wf.updated_at || new Date()]
          );
          counts.workflows++;
        }
      }

      // Import projects
      for (const proj of (body.projects || [])) {
        const exists = await client.query('SELECT id FROM projects WHERE id = $1', [proj.id]);
        if (exists.rows.length === 0 || mode === 'replace') {
          await client.query(
            `INSERT INTO projects (id, name, description, status, tags, default_workflow_id, metadata, qmd_project_namespace, created_at, updated_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
             ON CONFLICT (id) DO UPDATE SET name = $2, description = $3, status = $4, tags = $5, metadata = $7, updated_at = $10`,
            [proj.id, proj.name, proj.description || '', proj.status || 'active', proj.tags || [],
             proj.default_workflow_id, proj.metadata || {}, proj.qmd_project_namespace, proj.created_at || new Date(), new Date()]
          );
          counts.projects++;
        }
      }

      // Import tasks
      for (const task of (body.tasks || [])) {
        await client.query(
          `INSERT INTO tasks (id, project_id, title, description, status, priority, owner, due_date, start_date,
            estimated_effort, actual_effort, parent_task_id, dependency_ids, labels, created_at, updated_at,
            completed_at, recurrence_rule, metadata, execution_lock, execution_locked_by)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21)
           ON CONFLICT (id) DO UPDATE SET title = $3, description = $4, status = $5, priority = $6,
            owner = $7, updated_at = $16, metadata = $19`,
          [task.id, task.project_id, task.title, task.description || '', task.status || 'backlog',
           task.priority || 'medium', task.owner, task.due_date, task.start_date,
           task.estimated_effort, task.actual_effort, task.parent_task_id, task.dependency_ids || [],
           task.labels || [], task.created_at || new Date(), new Date(), task.completed_at,
           task.recurrence_rule, task.metadata || {}, task.execution_lock, task.execution_locked_by]
        );
        counts.tasks++;
      }

      // Import audit log
      for (const entry of (body.auditLog || [])) {
        await client.query(
          `INSERT INTO audit_log (id, task_id, actor, action, old_value, new_value, timestamp)
           VALUES ($1, $2, $3, $4, $5, $6, $7)
           ON CONFLICT (id) DO NOTHING`,
          [entry.id, entry.task_id, entry.actor, entry.action, entry.old_value, entry.new_value, entry.timestamp]
        );
        counts.auditLog++;
      }

      // Import settings
      if (body.settings && settingsStore) {
        try {
          for (const [key, value] of Object.entries(body.settings)) {
            await settingsStore.set(key, value);
          }
        } catch {}
      }

      await client.query('COMMIT');

      // Record audit entry for the import operation
      try {
        const pool = getPool();
        await pool.query(
          `INSERT INTO audit_log (task_id, actor, action, old_value, new_value, timestamp)
           VALUES (NULL, $1, $2, $3, $4, NOW())`,
          ['dashboard-import', 'import', null, JSON.stringify({ mode, counts })]
        );
        await pool.query(
          `INSERT INTO state_snapshots (entity_type, entity_id, action, state, actor)
           VALUES ('system', 'import', 'import', $1, $2)`,
          [JSON.stringify({ mode, counts, timestamp: new Date().toISOString() }), 'dashboard-import']
        );
      } catch (_) {}

      ctx.sendJSON(res, 200, { imported: counts, mode });
    } catch (err) {
      await client.query('ROLLBACK');
      ctx.sendJSON(res, 500, { error: err.message });
    } finally {
      client.release();
    }
  });
}

module.exports = { registerExportRoutes };
