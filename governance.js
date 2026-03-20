/**
 * Governance policy helpers for workflow actions, audit classification, and
 * operator-safety UI surfaces.
 */

const { getAgentProfileById } = require('./org-bootstrap.js');

const GOVERNANCE_ACTION_RULES = {
  launch_workflow: {
    label: 'Launch workflow',
    roles: ['orchestrator', 'pipeline', 'specialist', 'operator'],
    capabilities: ['orchestration', 'automation', 'workflows', 'quality', 'auditing']
  },
  approve: {
    label: 'Approve',
    roles: ['orchestrator', 'operator'],
    capabilities: ['quality', 'auditing', 'management'],
    allowAssignedApprover: true
  },
  reject: {
    label: 'Reject',
    roles: ['orchestrator', 'operator'],
    capabilities: ['quality', 'auditing', 'management'],
    allowAssignedApprover: true
  },
  cancel_run: {
    label: 'Cancel run',
    roles: ['orchestrator', 'operator'],
    capabilities: ['orchestration', 'management']
  },
  override_failure: {
    label: 'Override failure',
    roles: ['orchestrator', 'operator'],
    capabilities: ['orchestration', 'management', 'repair', 'diagnostics']
  },
  reassign_owner: {
    label: 'Reassign owner',
    roles: ['orchestrator', 'operator', 'pipeline'],
    capabilities: ['orchestration', 'management']
  },
  escalate_run: {
    label: 'Escalate run',
    roles: ['orchestrator', 'operator', 'pipeline'],
    capabilities: ['orchestration', 'management']
  },
  escalate_approval: {
    label: 'Escalate approval',
    roles: ['orchestrator', 'operator', 'pipeline'],
    capabilities: ['orchestration', 'management', 'quality', 'auditing']
  },
  pause_run: {
    label: 'Pause run',
    roles: ['orchestrator', 'operator', 'pipeline'],
    capabilities: ['orchestration', 'management']
  },
  resume_run: {
    label: 'Resume run',
    roles: ['orchestrator', 'operator', 'pipeline'],
    capabilities: ['orchestration', 'management']
  }
};

function normalizeCapabilities(value) {
  if (Array.isArray(value)) {
    return value.map((item) => String(item || '').trim()).filter(Boolean);
  }
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      if (Array.isArray(parsed)) {
        return parsed.map((item) => String(item || '').trim()).filter(Boolean);
      }
    } catch (_) {
      return value.split(',').map((item) => item.trim()).filter(Boolean);
    }
  }
  return [];
}

function normalizeActorContext(actorId, profile = null) {
  const normalizedId = String(actorId || '').trim() || 'system';
  if (['system', 'dashboard-operator', 'openclaw'].includes(normalizedId)) {
    return {
      id: normalizedId,
      displayName: normalizedId === 'dashboard-operator' ? 'Dashboard Operator' : normalizedId,
      role: 'operator',
      capabilities: ['orchestration', 'management', 'quality', 'auditing'],
      source: 'system',
      isPrivileged: true
    };
  }

  if (/^(ops[-_].+|.+[-_](operator|controller|director))$/i.test(normalizedId)) {
    return {
      id: normalizedId,
      displayName: normalizedId,
      role: 'operator',
      capabilities: ['orchestration', 'management', 'quality', 'auditing'],
      source: 'derived',
      isPrivileged: true
    };
  }

  const bootstrapProfile = getAgentProfileById(normalizedId);
  const resolvedProfile = profile || bootstrapProfile || {};
  const role = String(resolvedProfile.role || 'external').trim() || 'external';
  const capabilities = normalizeCapabilities(resolvedProfile.capabilities);

  return {
    id: normalizedId,
    displayName: resolvedProfile.displayName || resolvedProfile.display_name || bootstrapProfile?.displayName || normalizedId,
    role,
    capabilities,
    source: profile ? 'database' : bootstrapProfile ? 'bootstrap' : 'derived',
    isPrivileged: role === 'orchestrator' || role === 'operator'
  };
}

function getGovernancePolicy(action) {
  return GOVERNANCE_ACTION_RULES[action] || null;
}

function buildGovernancePolicySummary(actions = []) {
  return actions
    .map((action) => {
      const policy = getGovernancePolicy(action);
      if (!policy) return null;
      return {
        action,
        label: policy.label,
        roles: [...policy.roles],
        capabilities: [...policy.capabilities],
        allowAssignedApprover: Boolean(policy.allowAssignedApprover)
      };
    })
    .filter(Boolean);
}

function evaluateGovernanceAction(action, actor, options = {}) {
  const policy = getGovernancePolicy(action);
  if (!policy) {
    return { allowed: false, reason: `Unknown governance action: ${action}` };
  }

  const actorContext = normalizeActorContext(actor?.id || actor, actor && typeof actor === 'object' ? actor : null);
  if (actorContext.isPrivileged) {
    return { allowed: true, actor: actorContext, policy };
  }

  if (policy.allowAssignedApprover && options.approverId && actorContext.id === options.approverId) {
    return { allowed: true, actor: actorContext, policy };
  }

  if (policy.roles.includes(actorContext.role)) {
    return { allowed: true, actor: actorContext, policy };
  }

  if (actorContext.capabilities.some((capability) => policy.capabilities.includes(capability))) {
    return { allowed: true, actor: actorContext, policy };
  }

  return {
    allowed: false,
    actor: actorContext,
    policy,
    reason: `${actorContext.id} is not allowed to ${policy.label.toLowerCase()}`
  };
}

function isGovernanceAction(action) {
  return /^(run_|approval_)/.test(String(action || ''));
}

function classifyAuditEntity(action) {
  return isGovernanceAction(action) ? 'workflow' : 'task';
}

module.exports = {
  GOVERNANCE_ACTION_RULES,
  buildGovernancePolicySummary,
  classifyAuditEntity,
  evaluateGovernanceAction,
  getGovernancePolicy,
  isGovernanceAction,
  normalizeActorContext
};
