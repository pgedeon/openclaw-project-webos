const isAbsoluteUrl = (value) => /^https?:\/\//i.test(String(value || ''));

const buildQueryString = (params = {}) => {
  const searchParams = new URLSearchParams();

  Object.entries(params || {}).forEach(([key, rawValue]) => {
    if (rawValue == null || rawValue === '') {
      return;
    }

    if (Array.isArray(rawValue)) {
      rawValue.forEach((entry) => {
        if (entry != null && entry !== '') {
          searchParams.append(key, entry);
        }
      });
      return;
    }

    searchParams.append(key, rawValue);
  });

  const query = searchParams.toString();
  return query ? `?${query}` : '';
};

const normalizePath = (baseURL, path = '') => {
  const value = String(path || '');

  if (!value) {
    return baseURL;
  }

  if (isAbsoluteUrl(value) || value.startsWith('/api')) {
    return value;
  }

  if (value.startsWith('/')) {
    return `${baseURL}${value}`;
  }

  return `${baseURL}/${value.replace(/^\/+/, '')}`;
};

const parseErrorPayload = async (response) => {
  const contentType = response.headers.get('content-type') || '';
  try {
    if (contentType.includes('application/json')) {
      const payload = await response.clone().json();
      return payload?.error || payload?.message || JSON.stringify(payload);
    }

    const text = await response.clone().text();
    return text || response.statusText;
  } catch (error) {
    return response.statusText || `HTTP ${response.status}`;
  }
};

const parseBody = async (response) => {
  if (response.status === 204) {
    return null;
  }

  const contentType = response.headers.get('content-type') || '';
  if (contentType.includes('application/json')) {
    return response.json();
  }

  return response.text();
};

const normalizeCronFieldValue = (value, isDayOfWeek = false) => {
  const parsed = Number(value);
  if (!Number.isInteger(parsed)) {
    return null;
  }

  if (isDayOfWeek && parsed === 7) {
    return 0;
  }

  return parsed;
};

const parseCronField = (field, min, max, { isDayOfWeek = false } = {}) => {
  const raw = String(field || '').trim();
  if (!raw || raw === '*') {
    return null;
  }

  const values = new Set();
  raw.split(',').forEach((segment) => {
    const trimmedSegment = segment.trim();
    if (!trimmedSegment) {
      return;
    }

    const [rangeSegment, stepSegment] = trimmedSegment.split('/');
    const step = Math.max(1, Number.parseInt(stepSegment || '1', 10) || 1);

    let start = min;
    let end = max;
    if (rangeSegment && rangeSegment !== '*') {
      if (rangeSegment.includes('-')) {
        const [rawStart, rawEnd] = rangeSegment.split('-');
        start = normalizeCronFieldValue(rawStart, isDayOfWeek);
        end = normalizeCronFieldValue(rawEnd, isDayOfWeek);
      } else {
        start = normalizeCronFieldValue(rangeSegment, isDayOfWeek);
        end = start;
      }
    }

    if (!Number.isInteger(start) || !Number.isInteger(end)) {
      return;
    }

    for (let value = start; value <= end; value += step) {
      const normalizedValue = normalizeCronFieldValue(value, isDayOfWeek);
      if (normalizedValue == null || normalizedValue < min || normalizedValue > max) {
        continue;
      }
      values.add(normalizedValue);
    }
  });

  return values.size > 0 ? values : null;
};

const cronFieldMatches = (allowedValues, value) => allowedValues === null || allowedValues.has(value);

const estimateNextCronRun = (schedule, fromDate = new Date(), maxMinutesAhead = 60 * 24 * 31) => {
  const parts = String(schedule || '').trim().split(/\s+/);
  if (parts.length !== 5) {
    return null;
  }

  const minuteValues = parseCronField(parts[0], 0, 59);
  const hourValues = parseCronField(parts[1], 0, 23);
  const dayOfMonthValues = parseCronField(parts[2], 1, 31);
  const monthValues = parseCronField(parts[3], 1, 12);
  const dayOfWeekValues = parseCronField(parts[4], 0, 6, { isDayOfWeek: true });
  const cursor = new Date(fromDate);
  cursor.setSeconds(0, 0);
  cursor.setMinutes(cursor.getMinutes() + 1);

  for (let offset = 0; offset < maxMinutesAhead; offset += 1) {
    if (
      cronFieldMatches(minuteValues, cursor.getMinutes())
      && cronFieldMatches(hourValues, cursor.getHours())
      && cronFieldMatches(dayOfMonthValues, cursor.getDate())
      && cronFieldMatches(monthValues, cursor.getMonth() + 1)
      && cronFieldMatches(dayOfWeekValues, cursor.getDay())
    ) {
      return new Date(cursor);
    }
    cursor.setMinutes(cursor.getMinutes() + 1);
  }

  return null;
};

const summarizeCronJobs = (payload) => {
  const jobs = Array.isArray(payload?.jobs) ? payload.jobs : Array.isArray(payload) ? payload : [];
  const now = Date.now();

  const normalizedJobs = jobs.map((job) => {
    const explicitNextRun = job?.nextRun || job?.next_run || null;
    const nextRunDate = explicitNextRun ? new Date(explicitNextRun) : estimateNextCronRun(job?.schedule);
    const nextRunAt = nextRunDate instanceof Date && !Number.isNaN(nextRunDate.getTime())
      ? nextRunDate.toISOString()
      : null;

    return {
      ...job,
      nextRunAt,
      next_run: nextRunAt,
      nextRunInMs: nextRunAt ? Math.max(0, new Date(nextRunAt).getTime() - now) : null,
    };
  });

  const runningCount = normalizedJobs.filter((job) => {
    const status = String(job?.status || '').toLowerCase();
    return job?.running === true || status === 'running';
  }).length;

  const nextRunAt = normalizedJobs
    .map((job) => job.nextRunAt)
    .filter(Boolean)
    .sort()[0] || null;

  return {
    jobs: normalizedJobs,
    runningCount,
    totalJobs: normalizedJobs.length,
    total: normalizedJobs.length,
    nextRunAt,
    nextRunInMs: nextRunAt ? Math.max(0, new Date(nextRunAt).getTime() - now) : null,
  };
};

export class APIClientError extends Error {
  constructor(message, { status = 500, url = '', payload = null } = {}) {
    super(message);
    this.name = 'APIClientError';
    this.status = status;
    this.url = url;
    this.payload = payload;
  }
}

export function createAPIClient(baseURL = '/api', options = {}) {
  const nativeFetch = options.fetchImpl || globalThis.fetch?.bind(globalThis);
  if (typeof nativeFetch !== 'function') {
    throw new Error('createAPIClient requires a fetch implementation.');
  }

  const inflightGets = new Map();

  const raw = async (path, init = {}) => {
    const method = String(init.method || 'GET').toUpperCase();
    const url = normalizePath(baseURL, path);
    const requestInit = { ...init, method };
    const isDedupable = method === 'GET' && !requestInit.body;

    if (isDedupable && inflightGets.has(url)) {
      return inflightGets.get(url).then((response) => response.clone());
    }

    const promise = nativeFetch(url, requestInit)
      .then((response) => response)
      .finally(() => {
        if (isDedupable) {
          inflightGets.delete(url);
        }
      });

    if (isDedupable) {
      inflightGets.set(url, promise);
      return promise.then((response) => response.clone());
    }

    return promise;
  };

  const request = async (path, init = {}) => {
    const url = normalizePath(baseURL, path);
    const headers = new Headers(init.headers || {});
    if (init.body && !headers.has('Content-Type') && typeof init.body === 'string') {
      headers.set('Content-Type', 'application/json');
    }

    const response = await raw(url, { ...init, headers });
    if (!response.ok) {
      const message = await parseErrorPayload(response);
      throw new APIClientError(message || `Request failed with status ${response.status}`, {
        status: response.status,
        url,
      });
    }

    return parseBody(response);
  };

  const jsonRequest = (path, init = {}) => request(path, {
    ...init,
    body: init.body && typeof init.body !== 'string' ? JSON.stringify(init.body) : init.body,
  });

  const pathWithQuery = (path, params) => `${path}${buildQueryString(params)}`;

  const client = {
    baseURL,
    raw,
    fetch: raw,
    request,
    json: jsonRequest,
    requestText(path, init = {}) {
      return raw(path, init).then(async (response) => {
        if (!response.ok) {
          const message = await parseErrorPayload(response);
          throw new APIClientError(message || `Request failed with status ${response.status}`, {
            status: response.status,
            url: normalizePath(baseURL, path),
          });
        }

        return response.text();
      });
    },
    tasks: {
      list(params = {}) {
        return request(pathWithQuery('/tasks/all', params));
      },
      get(id, params = {}) {
        return request(pathWithQuery(`/tasks/${encodeURIComponent(id)}`, params));
      },
      create(data) {
        return jsonRequest('/tasks', { method: 'POST', body: data });
      },
      update(id, data) {
        return jsonRequest(`/tasks/${encodeURIComponent(id)}`, { method: 'PATCH', body: data });
      },
      remove(id) {
        return request(`/tasks/${encodeURIComponent(id)}`, { method: 'DELETE' });
      },
      archive(id) {
        return jsonRequest(`/tasks/${encodeURIComponent(id)}/archive`, { method: 'POST', body: {} });
      },
      restore(id) {
        return jsonRequest(`/tasks/${encodeURIComponent(id)}/restore`, { method: 'POST', body: {} });
      },
      history(id) {
        return request(`/tasks/${encodeURIComponent(id)}/history`);
      },
      async dependencies(id) {
        const payload = await request(pathWithQuery(`/tasks/${encodeURIComponent(id)}`, { includeGraph: true }));
        return payload?.dependencies || payload?.dependency_ids || [];
      },
      move(id, status) {
        return jsonRequest(`/tasks/${encodeURIComponent(id)}/move`, { method: 'POST', body: { status } });
      },
    },
    projects: {
      list(params = {}) {
        return request(pathWithQuery('/projects', params));
      },
      getDefault(params = { status: 'active' }) {
        return request(pathWithQuery('/projects/default', params));
      },
      get(id) {
        return request(`/projects/${encodeURIComponent(id)}`);
      },
    },
    org: {
      departments: {
        list() {
          return request('/org/departments');
        },
        operatingView(id) {
          return request(`/org/departments/${encodeURIComponent(id)}/operating-view`);
        },
      },
      agents: {
        list(params = {}) {
          return request(pathWithQuery('/org/agents', params));
        },
      },
      summary() {
        return request('/org/summary');
      },
    },
    health: {
      check() {
        return request('/health');
      },
      status() {
        return request('/health-status');
      },
    },
    stats() {
      return request('/stats');
    },
    cron: {
      jobs() {
        return request('/cron/jobs');
      },
      async status() {
        const payload = await request('/cron/jobs');
        return summarizeCronJobs(payload);
      },
      runJob(id) {
        return jsonRequest(`/cron/jobs/${encodeURIComponent(id)}/run`, { method: 'POST', body: {} });
      },
      runs(id) {
        return request(`/cron/jobs/${encodeURIComponent(id)}/runs`);
      },
    },
    audit: {
      list(params = {}) {
        return request(pathWithQuery('/audit', params));
      },
    },
    workflows: {
      runs(params = {}) {
        return request(pathWithQuery('/workflow-runs', params));
      },
      get(id) {
        return request(`/workflow-runs/${encodeURIComponent(id)}`);
      },
      create(data) {
        return jsonRequest('/workflow-runs', { method: 'POST', body: data });
      },
      update(id, data) {
        return jsonRequest(`/workflow-runs/${encodeURIComponent(id)}`, { method: 'PATCH', body: data });
      },
      start(id, data = {}) {
        return jsonRequest(`/workflow-runs/${encodeURIComponent(id)}/start`, { method: 'POST', body: data });
      },
      templates() {
        return request('/workflow-templates');
      },
      template(name) {
        return request(`/workflow-templates/${encodeURIComponent(name)}`);
      },
      active(params = {}) {
        return request(pathWithQuery('/workflow-runs/active', params));
      },
      stuck(params = {}) {
        return request(pathWithQuery('/workflow-runs/stuck', params));
      },
      action(id, action, data = {}) {
        return jsonRequest(`/workflow-runs/${encodeURIComponent(id)}/${encodeURIComponent(action)}`, {
          method: 'POST',
          body: data,
        });
      },
    },
    catalog: {
      all() {
        return request('/catalog');
      },
      skillsTools() {
        return request('/catalog/skills-tools');
      },
    },
    metrics: {
      org(params = {}) {
        return request(pathWithQuery('/metrics/org', params));
      },
      departments(params = {}) {
        return request(pathWithQuery('/metrics/departments', params));
      },
      department(id, params = {}) {
        return request(pathWithQuery(`/metrics/departments/${encodeURIComponent(id)}`, params));
      },
      agents(params = {}) {
        return request(pathWithQuery('/metrics/agents', params));
      },
      services(params = {}) {
        return request(pathWithQuery('/metrics/services', params));
      },
      sites(params = {}) {
        return request(pathWithQuery('/metrics/sites', params));
      },
    },
    agents: {
      list(params = {}) {
        return request(pathWithQuery('/agents', params));
      },
      status() {
        return request('/agents/status');
      },
      heartbeat(data) {
        return jsonRequest('/agents/heartbeat', { method: 'POST', body: data });
      },
    },
    blockers: {
      list(params = {}) {
        return request(pathWithQuery('/blockers', params));
      },
      summary(params = {}) {
        return request(pathWithQuery('/blockers/summary', params));
      },
    },
    artifacts: {
      list(params = {}) {
        return request(pathWithQuery('/artifacts', params));
      },
    },
    approvals: {
      pending(params = {}) {
        return request(pathWithQuery('/approvals/pending', params));
      },
      act(id, action, data = {}) {
        return jsonRequest(`/approvals/${encodeURIComponent(id)}${action ? `/${encodeURIComponent(action)}` : ''}`, {
          method: action ? 'POST' : 'PATCH',
          body: data,
        });
      },
    },
    views: {
      board(projectId, params = {}) {
        return request(pathWithQuery('/views/board', { project_id: projectId, ...params }));
      },
      timeline(projectId, params = {}) {
        return request(pathWithQuery('/views/timeline', { project_id: projectId, ...params }));
      },
      agent(params = {}) {
        return request(pathWithQuery('/views/agent', params));
      },
    },
    services: {
      list() {
        return request('/services');
      },
      requests(params = {}) {
        return request(pathWithQuery('/service-requests', params));
      },
      createRequest(data) {
        return jsonRequest('/service-requests', { method: 'POST', body: data });
      },
      routeRequest(id, data) {
        return jsonRequest(`/service-requests/${encodeURIComponent(id)}/route`, { method: 'POST', body: data });
      },
      launchRequest(id, data) {
        return jsonRequest(`/service-requests/${encodeURIComponent(id)}/launch`, { method: 'POST', body: data });
      },
    },
  };

  return client;
}

export default createAPIClient;
