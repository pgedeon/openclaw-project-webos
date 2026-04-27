/**
 * Settings Store — reads/writes OpenClaw Desktop configuration
 *
 * Persistence strategy:
 *   - Infrastructure settings → .env file (preserves comments)
 *   - UI/runtime preferences  → dashboard-config.json
 *   - In-memory cache with dirty tracking
 */

const fs = require('fs');
const path = require('path');

const DASHBOARD_ROOT = path.resolve(__dirname, '..');

// ── Settings Schema ─────────────────────────────
// type: string|number|boolean|select|password|color|toggle
// source: env|config|runtime
// hotReload: true = no restart needed

const SCHEMA = {
  // General
  PORT: { type: 'number', default: 3876, source: 'env', category: 'general', label: 'Server Port', hotReload: false },
  DASHBOARD_AUTH_TOKEN: { type: 'password', default: '', source: 'env', category: 'general', label: 'Auth Token', hotReload: false },
  REQUIRE_AUTH: { type: 'toggle', default: true, source: 'env', category: 'general', label: 'Require Authentication', hotReload: false },
  OPENCLAW_WORKSPACE: { type: 'string', default: '', source: 'env', category: 'general', label: 'Workspace Path', hotReload: false },
  OPENCLAW_FS_ROOT: { type: 'string', default: '', source: 'env', category: 'general', label: 'Filesystem Root', hotReload: false },
  STORAGE_TYPE: { type: 'select', options: ['postgres', 'json'], default: 'postgres', source: 'env', category: 'general', label: 'Storage Type', hotReload: false },
  FILESYSTEM_API_PORT: { type: 'number', default: 3880, source: 'env', category: 'general', label: 'Filesystem API Port', hotReload: false },

  // Database
  POSTGRES_HOST: { type: 'string', default: 'localhost', source: 'env', category: 'database', label: 'Host', hotReload: false },
  POSTGRES_PORT: { type: 'number', default: 5432, source: 'env', category: 'database', label: 'Port', hotReload: false },
  POSTGRES_DB: { type: 'string', default: 'mission_control', source: 'env', category: 'database', label: 'Database', hotReload: false },
  POSTGRES_USER: { type: 'string', default: 'postgres', source: 'env', category: 'database', label: 'User', hotReload: false },
  POSTGRES_PASSWORD: { type: 'password', default: 'postgres', source: 'env', category: 'database', label: 'Password', hotReload: false },

  // Gateway
  OPENCLAW_GATEWAY_URL: { type: 'string', default: 'ws://127.0.0.1:18789', source: 'env', category: 'gateway', label: 'Gateway URL', hotReload: true },
  OPENCLAW_GATEWAY_PASSWORD: { type: 'password', default: '', source: 'env', category: 'gateway', label: 'Gateway Password', hotReload: true },
  OPENCLAW_GATEWAY_TOKEN: { type: 'password', default: '', source: 'env', category: 'gateway', label: 'Gateway Token', hotReload: true },

  // Integrations
  BING_WEBMASTER_API_KEY: { type: 'password', default: '', source: 'env', category: 'integrations', label: 'Bing Webmaster API Key', hotReload: true },
  OPENCLAW_BIN: { type: 'string', default: 'openclaw', source: 'env', category: 'integrations', label: 'OpenClaw Binary Path', hotReload: false },
  OPENCLAW_CONFIG_FILE: { type: 'string', default: '', source: 'env', category: 'integrations', label: 'OpenClaw Config File', hotReload: false },

  // Security
  CHAT_RATE_LIMIT: { type: 'number', default: 30, source: 'config', category: 'security', label: 'Chat Rate Limit (per min)', hotReload: true },
  MAX_MESSAGE_LENGTH: { type: 'number', default: 10000, source: 'config', category: 'security', label: 'Max Message Length', hotReload: true },
  SSE_MAX_CLIENTS: { type: 'number', default: 50, source: 'config', category: 'security', label: 'Max SSE Clients', hotReload: true },
  API_LOG_LEVEL: { type: 'select', options: ['none', 'error', 'all'], default: 'error', source: 'config', category: 'security', label: 'API Log Level', hotReload: true },

  // SSE & Realtime
  SSE_HEARTBEAT_INTERVAL: { type: 'number', default: 30, source: 'config', category: 'sse', label: 'Heartbeat Interval (sec)', hotReload: true },
  MESSAGE_PAGINATION_LIMIT: { type: 'number', default: 30, source: 'config', category: 'sse', label: 'Message Pagination Limit', hotReload: true },

  // Appearance (config)
  theme: { type: 'select', options: ['dark', 'light', 'system'], default: 'system', source: 'config', category: 'appearance', label: 'Theme', hotReload: true },
  accentColor: { type: 'string', default: '#60CDFF', source: 'config', category: 'appearance', label: 'Accent Color', hotReload: true },
  wallpaper: { type: 'string', default: 'dark-gradient', source: 'config', category: 'appearance', label: 'Wallpaper', hotReload: true },
  windowSnap: { type: 'toggle', default: true, source: 'config', category: 'appearance', label: 'Window Snap', hotReload: true },
  rememberWindowPositions: { type: 'toggle', default: true, source: 'config', category: 'appearance', label: 'Remember Window Positions', hotReload: true },
  fontSizeBase: { type: 'number', default: 14, source: 'config', category: 'appearance', label: 'Base Font Size (px)', hotReload: true },
  showClock: { type: 'toggle', default: true, source: 'config', category: 'appearance', label: 'Show Clock', hotReload: true },
  clock24h: { type: 'toggle', default: true, source: 'config', category: 'appearance', label: '24-hour Clock', hotReload: true },
  showWidgets: { type: 'toggle', default: true, source: 'config', category: 'appearance', label: 'Show Widgets Panel', hotReload: true },
  taskbarOpacity: { type: 'number', default: 95, source: 'config', category: 'appearance', label: 'Taskbar Opacity (%)', hotReload: true },

  // Apps (config)
  disabledApps: { type: 'string', default: '', source: 'config', category: 'apps', label: 'Disabled Apps (comma-separated IDs)', hotReload: true },
  quickLaunchApps: { type: 'string', default: 'tasks,agents,skills-tools,operations,workflows', source: 'config', category: 'apps', label: 'Quick Launch Apps (comma-separated IDs)', hotReload: true },
};

const CONFIG_DEFAULTS = {};
for (const [key, schema] of Object.entries(SCHEMA)) {
  if (schema.source === 'config') {
    CONFIG_DEFAULTS[key] = schema.default;
  }
}

class SettingsStore {
  constructor(opts = {}) {
    this.envPath = opts.envPath || path.join(DASHBOARD_ROOT, '.env');
    this.configPath = opts.configPath || path.join(DASHBOARD_ROOT, 'dashboard-config.json');
    this.values = {};
    this.pendingRestartKeys = new Set();
    this.changeLog = []; // { timestamp, key, oldValue, newValue }
    this._loaded = false;
  }

  load() {
    this.values = {};

    // Load .env
    this._loadEnv();

    // Load config.json
    this._loadConfig();

    // Ensure all schema keys have values
    for (const [key, schema] of Object.entries(SCHEMA)) {
      if (!(key in this.values)) {
        this.values[key] = schema.default;
      }
    }

    this._loaded = true;
    this.pendingRestartKeys.clear();
    return this.values;
  }

  // ── Public API ────────────────────────────────

  get(key) {
    if (!this._loaded) this.load();
    return this.values[key];
  }

  getAll() {
    if (!this._loaded) this.load();
    const grouped = {};
    for (const [key, schema] of Object.entries(SCHEMA)) {
      const cat = schema.category;
      if (!grouped[cat]) grouped[cat] = {};
      grouped[cat][key] = {
        value: this.values[key],
        ...schema,
      };
    }
    return grouped;
  }

  getSchema() {
    return { ...SCHEMA };
  }

  getSystemInfo(extra = {}) {
    const pkg = this._getPackageJson();
    return {
      version: pkg.version || 'unknown',
      nodeVersion: process.version,
      platform: process.platform,
      arch: process.arch,
      pid: process.pid,
      uptime: Math.floor(process.uptime()),
      uptimeHuman: this._formatUptime(process.uptime()),
      memory: {
        rss: this._formatBytes(process.memoryUsage().rss),
        heapUsed: this._formatBytes(process.memoryUsage().heapUsed),
        heapTotal: this._formatBytes(process.memoryUsage().heapTotal),
        external: this._formatBytes(process.memoryUsage().external),
      },
      startedAt: extra.startedAt || null,
      sseClients: extra.sseClients || 0,
      gatewayConnected: extra.gatewayConnected || false,
      gatewayUrl: this.values.OPENCLAW_GATEWAY_URL || 'ws://127.0.0.1:18789',
      registeredApps: extra.registeredApps || 0,
      openWindows: extra.openWindows || 0,
      dashboardRoot: DASHBOARD_ROOT,
    };
  }

  set(key, value) {
    if (!SCHEMA[key]) throw new Error(`Unknown setting: ${key}`);
    const schema = SCHEMA[key];

    // Validate
    const validated = this._validate(key, value, schema);

    const oldValue = this.values[key];
    this.values[key] = validated;

    // Track change
    this.changeLog.push({ timestamp: Date.now(), key, oldValue, newValue: validated });

    // Persist
    if (schema.source === 'env') {
      this._writeEnv(key, validated);
    } else {
      this._writeConfig();
    }

    // Track restart requirement
    if (!schema.hotReload) {
      this.pendingRestartKeys.add(key);
    }

    return { key, oldValue, newValue: validated, hotReload: schema.hotReload };
  }

  setCategory(category, updates) {
    const results = [];
    for (const [key, value] of Object.entries(updates)) {
      const schema = SCHEMA[key];
      if (!schema || schema.category !== category) continue;
      results.push(this.set(key, value));
    }
    return results;
  }

  isRestartRequired() {
    return {
      restartRequired: this.pendingRestartKeys.size > 0,
      pendingKeys: [...this.pendingRestartKeys],
    };
  }

  clearRestartFlag() {
    this.pendingRestartKeys.clear();
  }

  getChangeLog(limit = 50) {
    return this.changeLog.slice(-limit).reverse().map(entry => ({
      ...entry,
      time: new Date(entry.timestamp).toISOString(),
      schema: SCHEMA[entry.key] ? SCHEMA[entry.key].category : "unknown",
    }));
  }

  exportSettings() {
    if (!this._loaded) this.load();
    const exported = {};
    for (const [key, schema] of Object.entries(SCHEMA)) {
      if (schema.type === 'password') {
        exported[key] = '••••••••';
      } else {
        exported[key] = this.values[key];
      }
    }
    return exported;
  }

  importSettings(data) {
    const results = [];
    for (const [key, value] of Object.entries(data)) {
      if (!SCHEMA[key]) continue;
      if (value === '••••••••') continue; // Skip masked passwords
      results.push(this.set(key, value));
    }
    return results;
  }

  // ── Private ───────────────────────────────────

  _loadEnv() {
    if (!fs.existsSync(this.envPath)) return;
    const content = fs.readFileSync(this.envPath, 'utf8');
    for (const line of content.split('\n')) {
      const match = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
      if (match) {
        let value = match[2];
        // Strip surrounding quotes
        if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
          value = value.slice(1, -1);
        }
        if (SCHEMA[match[1]]) {
          this.values[match[1]] = this._coerceType(value, SCHEMA[match[1]]);
        }
      }
    }
  }

  _loadConfig() {
    if (!fs.existsSync(this.configPath)) {
      // Create with defaults
      this._writeConfigRaw(CONFIG_DEFAULTS);
      Object.assign(this.values, CONFIG_DEFAULTS);
      return;
    }
    try {
      const data = JSON.parse(fs.readFileSync(this.configPath, 'utf8'));
      for (const [key, value] of Object.entries(data)) {
        if (SCHEMA[key]) {
          this.values[key] = this._coerceType(value, SCHEMA[key]);
        }
      }
    } catch {
      Object.assign(this.values, CONFIG_DEFAULTS);
    }
  }

  _writeEnv(key, value) {
    let content = '';
    if (fs.existsSync(this.envPath)) {
      content = fs.readFileSync(this.envPath, 'utf8');
    }

    const lines = content.split('\n');
    let found = false;

    const result = lines.map(line => {
      const match = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
      if (match && match[1] === key) {
        found = true;
        return `${key}=${value}`;
      }
      return line;
    });

    if (!found) {
      result.push(`${key}=${value}`);
    }

    fs.writeFileSync(this.envPath, result.join('\n'));
  }

  _writeConfig() {
    const config = {};
    for (const [key, schema] of Object.entries(SCHEMA)) {
      if (schema.source === 'config') {
        config[key] = this.values[key];
      }
    }
    this._writeConfigRaw(config);
  }

  _writeConfigRaw(config) {
    const tmpPath = this.configPath + '.tmp';
    fs.writeFileSync(tmpPath, JSON.stringify(config, null, 2));
    fs.renameSync(tmpPath, this.configPath);
  }

  _coerceType(value, schema) {
    if (schema.type === 'number') {
      const n = Number(value);
      return isNaN(n) ? schema.default : n;
    }
    if (schema.type === 'toggle' || schema.type === 'boolean') {
      if (typeof value === 'boolean') return value;
      return value === 'true' || value === '1';
    }
    return String(value);
  }

  _validate(key, value, schema) {
    if (schema.type === 'number') {
      const n = Number(value);
      if (isNaN(n)) throw new Error(`${key} must be a number`);
      if (schema.min !== undefined && n < schema.min) throw new Error(`${key} must be >= ${schema.min}`);
      if (schema.max !== undefined && n > schema.max) throw new Error(`${key} must be <= ${schema.max}`);
      return n;
    }
    if (schema.type === 'toggle') {
      return Boolean(value);
    }
    if (schema.type === 'select') {
      if (schema.options && !schema.options.includes(value)) {
        throw new Error(`${key} must be one of: ${schema.options.join(', ')}`);
      }
      return String(value);
    }
    if (schema.type === 'password') {
      return String(value);
    }
    return String(value);
  }

  _getPackageJson() {
    try {
      return JSON.parse(fs.readFileSync(path.join(DASHBOARD_ROOT, 'package.json'), 'utf8'));
    } catch {
      return {};
    }
  }

  _formatBytes(bytes) {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  _formatUptime(seconds) {
    const d = Math.floor(seconds / 86400);
    const h = Math.floor((seconds % 86400) / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    if (d > 0) return `${d}d ${h}h ${m}m`;
    if (h > 0) return `${h}h ${m}m`;
    return `${m}m`;
  }
}

module.exports = SettingsStore;
