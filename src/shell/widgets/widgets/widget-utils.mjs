const DEFAULT_ESCAPE_MAP = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

export const ACTIVE_AGENT_STATUSES = new Set(['active', 'running', 'online', 'healthy']);
export const IDLE_AGENT_STATUSES = new Set(['idle', 'queued', 'waiting', 'ready']);

export function escapeHtmlFallback(value) {
  return String(value ?? '').replace(/[&<>"']/g, (match) => DEFAULT_ESCAPE_MAP[match] || match);
}

export function getEscape(ctx) {
  return typeof ctx?.helpers?.escapeHtml === 'function' ? ctx.helpers.escapeHtml : escapeHtmlFallback;
}

export function toNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

export function formatCount(value) {
  return Math.max(0, Math.round(toNumber(value, 0))).toLocaleString();
}

export function getArray(payload, key) {
  if (Array.isArray(payload?.[key])) {
    return payload[key];
  }

  if (Array.isArray(payload)) {
    return payload;
  }

  return [];
}

export function readStorageText(key, fallback = '') {
  try {
    const value = globalThis.localStorage?.getItem(key);
    return value == null ? fallback : String(value);
  } catch (_) {
    return fallback;
  }
}

export function writeStorageText(key, value) {
  try {
    globalThis.localStorage?.setItem(key, String(value ?? ''));
    return true;
  } catch (_) {
    return false;
  }
}

export function removeStorageValue(key) {
  try {
    globalThis.localStorage?.removeItem(key);
    return true;
  } catch (_) {
    return false;
  }
}

export function readStorageJson(key, fallback) {
  try {
    const raw = globalThis.localStorage?.getItem(key);
    if (!raw) {
      return fallback;
    }

    const parsed = JSON.parse(raw);
    return parsed == null ? fallback : parsed;
  } catch (_) {
    return fallback;
  }
}

export function writeStorageJson(key, value) {
  try {
    globalThis.localStorage?.setItem(key, JSON.stringify(value));
    return true;
  } catch (_) {
    return false;
  }
}

export function deriveQueueMetrics({ stats = {}, orgSummary = null } = {}) {
  const liveSummary = orgSummary?.liveSummary || {};
  const total = Math.max(0, toNumber(stats.tasks || stats.total_tasks || stats.task_count));
  const ready = Math.max(0, toNumber(liveSummary.readyTasks || stats.ready || stats.ready_tasks));
  const active = Math.max(0, toNumber(
    liveSummary.activeTasks
      || stats.active
      || stats.active_tasks
      || stats.in_progress
      || stats.inProgress,
  ));
  const blocked = Math.max(0, toNumber(liveSummary.blockedTasks || stats.blocked || stats.blocked_tasks));
  const explicitDone = Math.max(0, toNumber(
    stats.done
      || stats.completed
      || stats.completed_tasks
      || stats.tasks_completed
      || stats.completed_count,
  ));
  const inferredDone = total > 0 ? Math.max(total - ready - active - blocked, 0) : 0;
  const done = total > 0
    ? clamp(explicitDone || inferredDone, 0, total)
    : (explicitDone || inferredDone);

  return {
    total: total || ready + active + blocked + done,
    ready,
    active,
    blocked,
    done,
  };
}

export function classifyAgentStatus(status) {
  const normalized = String(status || '').toLowerCase();
  if (ACTIVE_AGENT_STATUSES.has(normalized)) {
    return 'active';
  }

  if (IDLE_AGENT_STATUSES.has(normalized)) {
    return 'idle';
  }

  return 'offline';
}

export function isOnlineAgentStatus(status) {
  const classification = classifyAgentStatus(status);
  return classification === 'active' || classification === 'idle';
}

export function formatDurationMmSs(totalSeconds) {
  const seconds = Math.max(0, Math.round(toNumber(totalSeconds)));
  const minutesPart = Math.floor(seconds / 60);
  const secondsPart = seconds % 60;
  return `${String(minutesPart).padStart(2, '0')}:${String(secondsPart).padStart(2, '0')}`;
}

export function formatDaysHoursMinutes(milliseconds) {
  const totalMinutes = Math.max(0, Math.floor(toNumber(milliseconds) / 60000));
  const days = Math.floor(totalMinutes / 1440);
  const hours = Math.floor((totalMinutes % 1440) / 60);
  const minutes = totalMinutes % 60;
  return `${days}d ${hours}h ${minutes}m`;
}

export default {
  ACTIVE_AGENT_STATUSES,
  IDLE_AGENT_STATUSES,
  escapeHtmlFallback,
  getEscape,
  toNumber,
  clamp,
  formatCount,
  getArray,
  readStorageText,
  writeStorageText,
  removeStorageValue,
  readStorageJson,
  writeStorageJson,
  deriveQueueMetrics,
  classifyAgentStatus,
  isOnlineAgentStatus,
  formatDurationMmSs,
  formatDaysHoursMinutes,
};
