#!/usr/bin/env node
/**
 * Skills and tools catalog API for the dashboard.
 *
 * Skills come from the live `openclaw skills list --json` registry.
 * Tools come from agent allowlists in openclaw.json so operators can see
 * which agents expose which tools today.
 */

const { execFile } = require('child_process');
const { promisify } = require('util');

const execFileAsync = promisify(execFile);
const SKILLS_CACHE_TTL_MS = 15 * 1000;

const TOOL_DESCRIPTIONS = {
  agents_list: 'List registered agents from the current OpenClaw installation.',
  browser: 'Browse websites and interactive docs from the runtime.',
  cron: 'Inspect and manage scheduled automation jobs.',
  exec: 'Run shell commands inside the agent workspace environment.',
  gateway: 'Use gateway operations and channel integrations.',
  memory_search: 'Search memory and workspace notes for prior decisions.',
  message: 'Send or route messages across configured channels.',
  read: 'Read workspace files and project artifacts.',
  sessions_history: 'Inspect prior session transcripts and tool traces.',
  sessions_list: 'List live and recent sessions.',
  sessions_send: 'Send input to an existing session.',
  sessions_spawn: 'Start a new runtime or background session.',
  subagents: 'Delegate work to allowed subagents.',
  web_search: 'Search the web for current external information.',
  write: 'Write or replace workspace files.'
};

let cachedSkillsPayload = null;

function uniqueStrings(items) {
  return Array.from(new Set(
    (Array.isArray(items) ? items : [])
      .map((item) => String(item || '').trim())
      .filter(Boolean)
  )).sort((left, right) => left.localeCompare(right, undefined, { sensitivity: 'base' }));
}

function formatTokenLabel(value) {
  return String(value || '')
    .replace(/[:/_-]+/g, ' ')
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function summarizeMissingRequirements(missing) {
  const payload = missing && typeof missing === 'object' && !Array.isArray(missing) ? missing : {};
  const labels = [];
  const pushIfAny = (key, label) => {
    const entries = uniqueStrings(payload[key]);
    if (!entries.length) return;
    labels.push(`${label}: ${entries.join(', ')}`);
  };

  pushIfAny('bins', 'Missing bins');
  pushIfAny('anyBins', 'Missing any-of bins');
  pushIfAny('env', 'Missing env');
  pushIfAny('config', 'Missing config');
  pushIfAny('os', 'OS restriction');

  return labels;
}

function normalizeSkill(skill) {
  const source = String(skill?.source || 'unknown');
  const ready = Boolean(skill?.eligible) && !skill?.disabled && !skill?.blockedByAllowlist;
  const locallyManaged = source === 'openclaw-managed' || source === 'openclaw-workspace';
  let status = 'unavailable';

  if (ready) {
    status = 'ready';
  } else if (skill?.disabled) {
    status = 'disabled';
  } else if (skill?.blockedByAllowlist) {
    status = 'blocked';
  }

  return {
    name: String(skill?.name || 'unknown-skill'),
    description: String(skill?.description || ''),
    emoji: skill?.emoji || null,
    source,
    bundled: Boolean(skill?.bundled),
    homepage: skill?.homepage || null,
    primaryEnv: skill?.primaryEnv || null,
    eligible: Boolean(skill?.eligible),
    disabled: Boolean(skill?.disabled),
    blockedByAllowlist: Boolean(skill?.blockedByAllowlist),
    locallyManaged,
    status,
    missingSummary: summarizeMissingRequirements(skill?.missing),
    missing: skill?.missing && typeof skill.missing === 'object' ? skill.missing : {}
  };
}

function compareSkills(left, right) {
  const statusOrder = {
    ready: 0,
    blocked: 1,
    unavailable: 2,
    disabled: 3
  };
  const statusDelta = (statusOrder[left.status] ?? 99) - (statusOrder[right.status] ?? 99);
  if (statusDelta !== 0) return statusDelta;
  if (left.locallyManaged !== right.locallyManaged) {
    return left.locallyManaged ? -1 : 1;
  }
  if (left.source !== right.source) {
    return left.source.localeCompare(right.source, undefined, { sensitivity: 'base' });
  }
  return left.name.localeCompare(right.name, undefined, { sensitivity: 'base' });
}

function normalizeSkillsPayload(payload) {
  const skills = Array.isArray(payload?.skills) ? payload.skills.map(normalizeSkill).sort(compareSkills) : [];
  return {
    workspaceDir: payload?.workspaceDir || null,
    managedSkillsDir: payload?.managedSkillsDir || null,
    skills
  };
}

async function loadSkillsCatalog(context) {
  if (typeof context.listSkills === 'function') {
    return normalizeSkillsPayload(await context.listSkills());
  }

  const openclawBin = context.openclawBin || 'openclaw';
  const now = Date.now();
  if (
    cachedSkillsPayload &&
    cachedSkillsPayload.bin === openclawBin &&
    cachedSkillsPayload.expiresAt > now
  ) {
    return cachedSkillsPayload.payload;
  }

  const { stdout } = await execFileAsync(openclawBin, ['skills', 'list', '--json'], {
    timeout: 10000,
    maxBuffer: 25 * 1024 * 1024
  });

  const payload = normalizeSkillsPayload(JSON.parse(stdout || '{}'));
  cachedSkillsPayload = {
    bin: openclawBin,
    expiresAt: now + SKILLS_CACHE_TTL_MS,
    payload
  };
  return payload;
}

function normalizeAgentCatalogEntry(agent) {
  return {
    id: String(agent?.id || agent?.name || '').trim(),
    name: String(agent?.name || agent?.id || 'Unnamed agent').trim(),
    default: Boolean(agent?.default),
    workspace: agent?.workspace || null,
    defaultModel: agent?.defaultModel || null,
    allowedTools: uniqueStrings(agent?.tools?.allow),
    deniedTools: uniqueStrings(agent?.tools?.deny),
    allowedSubagents: uniqueStrings(agent?.subagents?.allowAgents)
  };
}

function buildToolsCatalog(context) {
  const warnings = [];
  const config = typeof context.readOpenClawConfig === 'function' ? context.readOpenClawConfig() : null;
  const configuredAgents = Array.isArray(config?.agents?.list)
    ? config.agents.list.map(normalizeAgentCatalogEntry).filter((agent) => agent.id)
    : [];

  if (!configuredAgents.length) {
    warnings.push('OpenClaw agent config could not be read, so tool coverage is empty.');
  }

  const toolMap = new Map();
  configuredAgents.forEach((agent) => {
    agent.allowedTools.forEach((toolName) => {
      if (!toolMap.has(toolName)) {
        toolMap.set(toolName, {
          name: toolName,
          label: formatTokenLabel(toolName),
          description: TOOL_DESCRIPTIONS[toolName] || `Allowed tool: ${formatTokenLabel(toolName)}.`,
          agents: [],
          defaultAgents: []
        });
      }

      const record = toolMap.get(toolName);
      const agentSummary = {
        id: agent.id,
        name: agent.name,
        default: agent.default
      };
      record.agents.push(agentSummary);
      if (agent.default) {
        record.defaultAgents.push(agentSummary);
      }
    });
  });

  const tools = Array.from(toolMap.values())
    .map((tool) => ({
      ...tool,
      agentCount: tool.agents.length,
      defaultAgentCount: tool.defaultAgents.length
    }))
    .sort((left, right) => {
      if (right.agentCount !== left.agentCount) {
        return right.agentCount - left.agentCount;
      }
      return left.label.localeCompare(right.label, undefined, { sensitivity: 'base' });
    });

  const agents = configuredAgents.sort((left, right) => {
    if (left.default !== right.default) {
      return left.default ? -1 : 1;
    }
    return left.name.localeCompare(right.name, undefined, { sensitivity: 'base' });
  });

  const globalSubagentTools = {
    allow: uniqueStrings(config?.tools?.subagents?.tools?.allow),
    deny: uniqueStrings(config?.tools?.subagents?.tools?.deny)
  };

  return {
    tools,
    agents,
    globalSubagentTools,
    warnings
  };
}

async function buildCatalogPayload(context) {
  const warnings = [];
  let skillsCatalog = {
    workspaceDir: null,
    managedSkillsDir: null,
    skills: []
  };

  try {
    skillsCatalog = await loadSkillsCatalog(context);
  } catch (error) {
    warnings.push(`Skills registry unavailable: ${error.message}`);
  }

  const toolsCatalog = buildToolsCatalog(context);
  warnings.push(...toolsCatalog.warnings);

  const skills = skillsCatalog.skills;
  const tools = toolsCatalog.tools;
  const agents = toolsCatalog.agents;

  return {
    generatedAt: new Date().toISOString(),
    workspaceDir: skillsCatalog.workspaceDir,
    managedSkillsDir: skillsCatalog.managedSkillsDir,
    summary: {
      totalSkills: skills.length,
      readySkills: skills.filter((skill) => skill.status === 'ready').length,
      locallyManagedSkills: skills.filter((skill) => skill.locallyManaged).length,
      unavailableSkills: skills.filter((skill) => skill.status !== 'ready').length,
      distinctTools: tools.length,
      agentsWithToolPolicies: agents.filter((agent) => agent.allowedTools.length > 0).length,
      sharedTools: tools.filter((tool) => tool.agentCount > 1).length,
      exclusiveTools: tools.filter((tool) => tool.agentCount === 1).length
    },
    globalSubagentTools: toolsCatalog.globalSubagentTools,
    skills,
    tools,
    agents,
    warnings
  };
}

async function catalogAPI(req, res, url, method, requestBody, context) {
  const { sendJSON } = context;

  try {
    if (method !== 'GET') {
      return false;
    }

    if (url === '/api/catalog' || url === '/api/catalog/skills-tools') {
      const payload = await buildCatalogPayload(context);
      sendJSON(res, 200, payload);
      return true;
    }

    if (url === '/api/catalog/skills') {
      const payload = await buildCatalogPayload(context);
      sendJSON(res, 200, {
        generatedAt: payload.generatedAt,
        workspaceDir: payload.workspaceDir,
        managedSkillsDir: payload.managedSkillsDir,
        summary: payload.summary,
        skills: payload.skills,
        warnings: payload.warnings
      });
      return true;
    }

    if (url === '/api/catalog/tools') {
      const payload = await buildCatalogPayload(context);
      sendJSON(res, 200, {
        generatedAt: payload.generatedAt,
        summary: payload.summary,
        globalSubagentTools: payload.globalSubagentTools,
        tools: payload.tools,
        agents: payload.agents,
        warnings: payload.warnings
      });
      return true;
    }
  } catch (error) {
    console.error('[catalog-api] Request error:', error);
    sendJSON(res, 500, { error: 'Internal server error' });
    return true;
  }

  return false;
}

module.exports = {
  buildCatalogPayload,
  catalogAPI
};
