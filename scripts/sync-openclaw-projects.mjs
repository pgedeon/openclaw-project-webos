#!/usr/bin/env node

const API_BASE = process.env.DASHBOARD_API_BASE || 'http://localhost:3876';

const PROJECT_DEFINITIONS = [
  {
    key: 'openclaw-system',
    name: 'OpenClaw System',
    description: 'Top-level folder for current OpenClaw platform work, with child boards for active systems.',
    metadata: {
      project_kind: 'folder',
      sort_order: 10,
      openclaw_scope: 'system',
      managed_by: 'sync-openclaw-projects'
    }
  },
  {
    key: 'dashboard-task-system',
    parentKey: 'openclaw-system',
    name: 'Dashboard & Task System',
    description: 'Dashboard UX, queue handling, project hierarchy, and operator workflows.',
    metadata: {
      sort_order: 10,
      openclaw_scope: 'dashboard',
      managed_by: 'sync-openclaw-projects'
    }
  },
  {
    key: 'memory-recall',
    parentKey: 'openclaw-system',
    name: 'Memory & Recall',
    description: 'Semantic recall quality, memory hygiene, indexing, and compact retrieval.',
    metadata: {
      sort_order: 20,
      openclaw_scope: 'memory',
      managed_by: 'sync-openclaw-projects'
    }
  },
  {
    key: 'models-providers',
    parentKey: 'openclaw-system',
    name: 'Models & Providers',
    description: 'Provider routing, timeouts, fallback policy, and model fit for each task type.',
    metadata: {
      sort_order: 30,
      openclaw_scope: 'models',
      managed_by: 'sync-openclaw-projects'
    }
  },
  {
    key: 'heartbeat-automation',
    parentKey: 'openclaw-system',
    name: 'Heartbeat & Automation',
    description: 'Heartbeat cadence, dashboard wake-up flow, queue claiming, and agent automation.',
    metadata: {
      sort_order: 40,
      openclaw_scope: 'automation',
      managed_by: 'sync-openclaw-projects'
    }
  },
  {
    key: 'facts-structured-data',
    parentKey: 'openclaw-system',
    name: 'Facts & Structured Data',
    description: 'Exact-data storage, facts.sqlite usage, and high-precision operational lookups.',
    metadata: {
      sort_order: 50,
      openclaw_scope: 'facts',
      managed_by: 'sync-openclaw-projects'
    }
  }
];

const TASK_DEFINITIONS = {
  'dashboard-task-system': [
    {
      title: 'Polish folder-style project UX in dashboard',
      description: 'Make parent projects feel like folders with clearer context, breadcrumbs, and aggregated child board views.',
      status: 'completed',
      priority: 'high',
      owner: 'main',
      labels: ['dashboard', 'ux', 'openclaw'],
      preferredModels: ['openrouter1/stepfun/step-3.5-flash:free']
    },
    {
      title: 'Add owner-based multi-agent routing from dashboard queue',
      description: 'Route runnable dashboard tasks to the correct OpenClaw subagent instead of only waking the default agent.',
      status: 'completed',
      priority: 'high',
      owner: 'main',
      labels: ['dashboard', 'routing', 'agents'],
      preferredModels: ['openrouter1/stepfun/step-3.5-flash:free']
    }
  ],
  'memory-recall': [
    {
      title: 'Expand recall benchmark coverage across agent workspaces',
      description: 'Turn the memory benchmark into a broader regression suite covering more workspaces and realistic recall prompts.',
      status: 'completed',
      priority: 'medium',
      owner: 'main',
      labels: ['memory', 'recall', 'benchmark'],
      preferredModels: ['zai/glm-5', 'zai/glm-4.7', 'openrouter1/stepfun/step-3.5-flash:free']
    },
    {
      title: 'Keep noisy notes out of memory index by default',
      description: 'Harden the guarded reindex workflow so transcript-like notes never land in the semantic index.',
      status: 'completed',
      priority: 'medium',
      owner: 'main',
      labels: ['memory', 'indexing', 'hygiene'],
      preferredModels: ['openrouter1/stepfun/step-3.5-flash:free']
    }
  ],
  'models-providers': [
    {
      title: 'Audit provider fallbacks and timeout policy',
      description: 'Review timeout, fallback, and preferred-model behavior so task routing stays cheap and predictable.',
      status: 'completed',
      priority: 'medium',
      owner: 'main',
      labels: ['models', 'providers', 'timeouts'],
      preferredModels: ['zai/glm-5', 'zai/glm-4.7', 'openrouter1/stepfun/step-3.5-flash:free']
    },
    {
      title: 'Validate z.ai GLM routing against compact prompts',
      description: 'Confirm the z.ai provider is only used where larger context or deeper reasoning is worth the token cost.',
      status: 'completed',
      priority: 'medium',
      owner: 'main',
      labels: ['models', 'z.ai', 'routing'],
      preferredModels: ['zai/glm-5', 'zai/glm-4.7']
    }
  ],
  'heartbeat-automation': [
    {
      title: 'Harden dashboard wake flow for main heartbeat',
      description: 'Make heartbeat-driven wakeups reliable while keeping the cadence low-noise and token-light.',
      status: 'completed',
      priority: 'high',
      owner: 'main',
      labels: ['heartbeat', 'automation', 'queue'],
      preferredModels: ['openrouter1/stepfun/step-3.5-flash:free']
    },
    {
      title: 'Promote owner-based wake support for subagents',
      description: 'Extend the dashboard bridge so owners beyond the default agent can be woken and claim their own queue items.',
      status: 'completed',
      priority: 'high',
      owner: 'main',
      labels: ['heartbeat', 'agents', 'routing'],
      preferredModels: ['openrouter1/stepfun/step-3.5-flash:free']
    }
  ],
  'facts-structured-data': [
    {
      title: 'Expand facts.sqlite coverage for exact system facts',
      description: 'Move exact configuration facts and operational identifiers out of semantic memory and into structured storage.',
      status: 'completed',
      priority: 'medium',
      owner: 'main',
      labels: ['facts', 'sqlite', 'precision'],
      preferredModels: ['openrouter1/stepfun/step-3.5-flash:free']
    }
  ]
};

const ARCHIVE_PATTERNS = [
  /^(SW|Content|Manufacturing) Project \d+$/i,
  /^Test Software Dev Project$/i,
  /^Ongoing Tasks$/i,
  /^Legacy Dashboard$/i
];

async function request(path, options = {}) {
  const response = await fetch(`${API_BASE}${path}`, {
    headers: {
      'Content-Type': 'application/json',
      ...(options.headers || {})
    },
    ...options
  });

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`${options.method || 'GET'} ${path} failed: ${response.status} ${detail}`);
  }

  if (response.status === 204) {
    return null;
  }

  return response.json();
}

function mergeMetadata(existingMetadata = {}, updates = {}) {
  const base = existingMetadata && typeof existingMetadata === 'object' && !Array.isArray(existingMetadata)
    ? existingMetadata
    : {};
  return {
    ...base,
    ...updates
  };
}

function choosePreferredModel(taskOptions, preferredModels = []) {
  const available = new Set(
    Array.isArray(taskOptions?.models)
      ? taskOptions.models.map((model) => model.id)
      : []
  );

  for (const candidate of preferredModels) {
    if (available.has(candidate)) {
      return candidate;
    }
  }

  return taskOptions?.defaults?.model || '';
}

async function getProjects() {
  return request('/api/projects?include_meta=true&include_test=true&limit=200');
}

async function getTasks(projectId) {
  return request(`/api/tasks/all?project_id=${encodeURIComponent(projectId)}&include_archived=true`);
}

async function main() {
  const [projectPayload, taskOptions] = await Promise.all([
    getProjects(),
    request('/api/task-options')
  ]);

  const projects = Array.isArray(projectPayload?.items) ? projectPayload.items : [];
  const projectByName = new Map(projects.map((project) => [project.name, project]));

  for (const project of projects) {
    if (project.status !== 'active') continue;
    if (!ARCHIVE_PATTERNS.some((pattern) => pattern.test(project.name))) continue;

    const metadata = mergeMetadata(project.metadata, {
      archived_reason: 'dashboard_cleanup',
      archived_by: 'sync-openclaw-projects'
    });

    await request(`/api/projects/${encodeURIComponent(project.id)}`, {
      method: 'PATCH',
      body: JSON.stringify({ status: 'archived', metadata })
    });
    projectByName.delete(project.name);
    console.log(`Archived stale project: ${project.name}`);
  }

  const ensuredProjects = new Map();

  for (const definition of PROJECT_DEFINITIONS) {
    const parentId = definition.parentKey ? ensuredProjects.get(definition.parentKey)?.id || null : null;
    const desiredMetadata = mergeMetadata(definition.metadata, parentId ? { parent_project_id: parentId } : {});
    const existing = projectByName.get(definition.name);

    if (!existing) {
      const created = await request('/api/projects', {
        method: 'POST',
        body: JSON.stringify({
          name: definition.name,
          description: definition.description,
          status: 'active',
          metadata: desiredMetadata
        })
      });
      ensuredProjects.set(definition.key, created);
      projectByName.set(created.name, created);
      console.log(`Created project: ${definition.name}`);
      continue;
    }

    const updated = await request(`/api/projects/${encodeURIComponent(existing.id)}`, {
      method: 'PATCH',
      body: JSON.stringify({
        name: definition.name,
        description: definition.description,
        status: 'active',
        metadata: mergeMetadata(existing.metadata, desiredMetadata)
      })
    });
    ensuredProjects.set(definition.key, updated);
    projectByName.set(updated.name, updated);
    console.log(`Updated project: ${definition.name}`);
  }

  for (const [projectKey, tasks] of Object.entries(TASK_DEFINITIONS)) {
    const project = ensuredProjects.get(projectKey);
    if (!project) continue;

    const existingTasks = await getTasks(project.id);
    const existingTaskByTitle = new Map(
      existingTasks
        .map((task) => [String(task.title || task.text || '').trim(), task])
        .filter(([title]) => title)
    );

    for (const task of tasks) {
      const desiredPreferredModel = choosePreferredModel(taskOptions, task.preferredModels);
      const desiredMetadata = {
        openclaw: {
          preferred_model: desiredPreferredModel
        },
        seeded_by: 'sync-openclaw-projects',
        seed_kind: 'historical_summary'
      };
      const existingTask = existingTaskByTitle.get(task.title);

      if (existingTask) {
        const currentMetadata = existingTask.metadata && typeof existingTask.metadata === 'object'
          ? existingTask.metadata
          : {};
        const currentOpenclaw = currentMetadata.openclaw && typeof currentMetadata.openclaw === 'object'
          ? currentMetadata.openclaw
          : {};
        const needsUpdate =
          existingTask.status !== task.status ||
          String(existingTask.description || '') !== task.description ||
          String(existingTask.priority || '') !== task.priority ||
          String(existingTask.owner || '') !== String(task.owner || '') ||
          JSON.stringify(existingTask.labels || []) !== JSON.stringify(task.labels || []) ||
          String(currentOpenclaw.preferred_model || '') !== desiredPreferredModel ||
          currentMetadata.seed_kind !== 'historical_summary' ||
          currentMetadata.seeded_by !== 'sync-openclaw-projects';

        if (needsUpdate) {
          await request(`/api/tasks/${encodeURIComponent(existingTask.id)}`, {
            method: 'PATCH',
            body: JSON.stringify({
              title: task.title,
              description: task.description,
              status: task.status,
              priority: task.priority,
              owner: task.owner,
              labels: task.labels,
              metadata: mergeMetadata(currentMetadata, desiredMetadata)
            })
          });
          console.log(`Updated task: ${project.name} -> ${task.title}`);
        }
        continue;
      }

      await request('/api/tasks', {
        method: 'POST',
        body: JSON.stringify({
          project_id: project.id,
          title: task.title,
          description: task.description,
          status: task.status,
          priority: task.priority,
          owner: task.owner,
          labels: task.labels,
          metadata: desiredMetadata
        })
      });
      console.log(`Created task: ${project.name} -> ${task.title}`);
    }
  }

  console.log('Project sync complete.');
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
