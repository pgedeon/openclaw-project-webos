# Control Panel — Project Plan

**Created:** 2026-04-26
**Status:** Planning
**Target:** OpenClaw Desktop v1.0.0-rc.4

---

## Executive Summary

A Windows 11-style Control Panel app that centralizes all OpenClaw Desktop configuration into one place. Instead of editing `.env` files and restarting the server, users change settings through a tabbed UI that persists to disk and applies immediately where possible.

The Control Panel replaces scattered configuration with a unified interface covering server, gateway, database, theme, apps, security, integrations, and system diagnostics.

---

## Feature Categories

### 1. General Settings
| Setting | Type | Default | Source | Hot-reload |
|---------|------|---------|--------|------------|
| Server port | number | 3876 | `PORT` | ❌ (restart) |
| Auth token | password | (generated) | `DASHBOARD_AUTH_TOKEN` | ❌ (restart) |
| Require auth | toggle | true | `REQUIRE_AUTH` | ❌ (restart) |
| Workspace path | text | `~/.openclaw/workspace` | `OPENCLAW_WORKSPACE` | ❌ (restart) |
| FS root | text | `~/.openclaw` | `OPENCLAW_FS_ROOT` | ❌ (restart) |
| Storage type | select: postgres/json | postgres | `STORAGE_TYPE` | ❌ (restart) |

### 2. Database
| Setting | Type | Default | Source |
|---------|------|---------|--------|
| Host | text | localhost | `POSTGRES_HOST` |
| Port | number | 5432 | `POSTGRES_PORT` |
| Database | text | mission_control | `POSTGRES_DB` |
| User | text | postgres | `POSTGRES_USER` |
| Password | password | postgres | `POSTGRES_PASSWORD` |
| Connection test | button | — | — |
| Pool size | number | 10 | new |

### 3. Gateway Connection
| Setting | Type | Default | Source | Hot-reload |
|---------|------|---------|--------|------------|
| Gateway URL | text | ws://127.0.0.1:18789 | `OPENCLAW_GATEWAY_URL` | ✅ |
| Auth password | password | — | `OPENCLAW_GATEWAY_PASSWORD` | ✅ |
| Auth token | password | — | `OPENCLAW_GATEWAY_TOKEN` | ✅ |
| Auto-reconnect | toggle | true | new | ✅ |
| Reconnect backoff min (ms) | number | 800 | new | ✅ |
| Reconnect backoff max (ms) | number | 15000 | new | ✅ |
| Connection test | button | — | — | — |
| Connection status | read-only | — | runtime | live |

### 4. Appearance
| Setting | Type | Default | Storage |
|---------|------|---------|---------|
| Theme | select: dark/light | system | localStorage |
| Accent color | color picker | #60CDFF | localStorage |
| Wallpaper | select: none/gradient/custom | dark gradient | localStorage |
| Taskbar position | select: bottom | bottom | localStorage |
| Taskbar opacity | slider 0-100 | 95 | localStorage |
| Window snap | toggle | true | localStorage |
| Default window width | number | 900 | localStorage |
| Default window height | number | 600 | localStorage |
| Remember window positions | toggle | true | localStorage |
| Font size base (px) | number | 14 | localStorage |

### 5. Taskbar & Apps
| Setting | Type | Default | Storage |
|---------|------|---------|---------|
| Quick launch apps | multi-select checklist | tasks,agents,skills-tools,operations,workflows | config.json |
| Show clock | toggle | true | config.json |
| 24-hour clock | toggle | true | config.json |
| Show widgets panel | toggle | true | config.json |
| Enable/disable individual apps | toggle per app | all enabled | config.json |
| Custom app order | drag list | registry order | config.json |

### 6. Security
| Setting | Type | Default | Source |
|---------|------|---------|--------|
| Session timeout (min) | number | 0 (never) | new |
| Chat rate limit (per min) | number | 30 | runtime |
| Max message length | number | 10000 | runtime |
| CORS allowed origins | text list | localhost | new |
| Allowed hosts | text list | (empty = all) | new |
| API log level | select: none/error/all | error | new |

### 7. Integrations
| Setting | Type | Default | Source |
|---------|------|---------|--------|
| Bing API key | password | — | `BING_WEBMASTER_API_KEY` |
| Bing default site URL | text | https://3dput.com | config.json |
| OpenClaw binary path | text | openclaw | `OPENCLAW_BIN` |
| OpenClaw config file | text | ~/.openclaw/openclaw.json | `OPENCLAW_CONFIG_FILE` |

### 8. SSE & Real-time
| Setting | Type | Default | Source | Hot-reload |
|---------|------|---------|--------|------------|
| Heartbeat interval (s) | number | 30 | runtime | ✅ |
| Max SSE clients | number | 50 | new | ✅ |
| Message pagination limit | number | 30 | runtime | ✅ |
| Session message filter | select: all/messages | messages | runtime | ✅ |

### 9. System Info (read-only dashboard)
| Field | Source |
|-------|--------|
| Version | package.json |
| Uptime | process.uptime() |
| Node.js version | process.version |
| Platform | process.platform |
| Memory usage | process.memoryUsage() |
| Active SSE connections | runtime counter |
| Gateway status | gatewayClient.connected |
| Database status | pool query |
| Registered apps count | APP_REGISTRY.length |
| Open windows count | window manager state |
| Last restart | stored on startup |

---

## Architecture

### Backend

**New files:**
```
routes/settings-routes.js    — CRUD for all settings
lib/settings-store.js        — persistence layer (reads/writes .env + config.json)
```

**Settings Store Strategy:**
- **Sensitive/infra settings** (DB creds, auth token, ports) → read/write `.env` file
- **UI preferences** (theme, layout, app order) → read/write `dashboard-config.json`
- **Runtime-only** (rate limits, heartbeat) → in-memory with optional config.json persistence

**`lib/settings-store.js` responsibilities:**
1. Read `.env` on startup → parse into settings schema
2. Read `dashboard-config.json` on startup → merge with defaults
3. `get(key)` — return current value
4. `set(key, value)` — update in-memory + write to appropriate file
5. `getAll()` — return complete settings object for the frontend
6. `getSchema()` — return schema with types, defaults, and hot-reload flags
7. `.env` writes preserve comments and formatting using line-by-line replacement
8. `config.json` writes are atomic (write to temp, rename)

**`routes/settings-routes.js` endpoints:**
```
GET  /api/settings                    — all settings grouped by category
GET  /api/settings/:category          — settings for one category
GET  /api/settings/schema             — schema (types, defaults, options)
PUT  /api/settings/:category          — update multiple settings in a category
PUT  /api/settings/:key               — update a single setting
POST /api/settings/test-db            — test database connection
POST /api/settings/test-gateway       — test gateway connection
GET  /api/settings/system-info        — runtime system info
POST /api/settings/reload             — reload settings from disk
POST /api/settings/export             — export all settings as JSON
POST /api/settings/import             — import settings from JSON
GET  /api/settings/restart-required   — check if restart is needed
```

### Frontend

**New file:** `src/shell/native-views/settings-view.mjs`

**Layout:** Tabbed control panel, Windows 11 style
```
┌──────────────────────────────────────────────────┐
│ ⚙️ Settings                            [×] ─ □ ✕ │
├──────────┬───────────────────────────────────────┤
│ General  │                                       │
│ Database │  Server Port          [3876      ]    │
│ Gateway  │  Auth Token           [••••••••••]    │
│ Appear.  │  Workspace Path  [~/.openclaw/... ]   │
│ Apps     │  Storage Type         [postgres  ▼]   │
│ Security │                                       │
│ Integ.   │  ⚠️ Changes to these settings         │
│ SSE      │  require a server restart              │
│ System   │                                       │
│          │  [Test Connection]  [Save & Restart]  │
└──────────┴───────────────────────────────────────┘
```

**Tab structure:**
1. **General** — server config, workspace, storage type
2. **Database** — PostgreSQL connection, test button
3. **Gateway** — WebSocket connection, test button, reconnect controls
4. **Appearance** — theme, accent color, wallpaper, window defaults
5. **Apps** — enable/disable apps, quick launch config, ordering
6. **Security** — auth, rate limits, CORS, logging
7. **Integrations** — Bing, OpenClaw binary/config paths
8. **SSE & Realtime** — heartbeat, pagination, limits
9. **System Info** — version, uptime, memory, connections (read-only)

**UI Components:**
- `SettingsTab` — sidebar tab button with icon and label
- `SettingsGroup` — card with title and grouped fields
- `SettingsField` — label + input (auto-detects type from schema)
- `SettingsToggle` — switch for boolean settings
- `SettingsSelect` — dropdown for enum settings
- `SettingsColorPicker` — color input for accent color
- `SettingsButton` — action button (test, save, restart)
- `SettingsBadge` — status indicator (connected/disconnected)
- `RestartBanner` — top banner showing "restart required" when settings change

---

## Phased Roadmap

### Phase 1: MVP — Read & Display Settings
**Goal:** Show all current settings in the Control Panel. Allow reading but not editing yet. System info tab fully functional.

**Files to create:**
- `lib/settings-store.js` — read-only mode, parses `.env` and config
- `routes/settings-routes.js` — GET endpoints only
- `src/shell/native-views/settings-view.mjs` — all 9 tabs, read-only

**Files to modify:**
- `task-server.js` — import and register settings routes
- `src/shell/app-registry.mjs` — register settings app

**API endpoints:**
- `GET /api/settings` — all settings grouped
- `GET /api/settings/schema` — schema with types
- `GET /api/settings/system-info` — runtime info

**Estimated effort:** 4-6 hours

---

### Phase 2: Edit & Persist Settings
**Goal:** Allow editing all settings. Save to `.env` and `config.json`. Detect which changes require restart. Test buttons for DB and gateway connections.

**Files to create:**
- Complete `lib/settings-store.js` — full read/write with `.env` preservation

**Files to modify:**
- `routes/settings-routes.js` — add PUT endpoints
- `settings-view.mjs` — make fields editable, add save/restart buttons

**API endpoints added:**
- `PUT /api/settings/:category` — update settings group
- `PUT /api/settings/:key` — update single setting
- `POST /api/settings/test-db` — test database connection
- `POST /api/settings/test-gateway` — test gateway connection
- `GET /api/settings/restart-required` — check pending changes
- `POST /api/settings/export` — export settings JSON
- `POST /api/settings/import` — import settings JSON

**Key implementation:**
```javascript
// lib/settings-store.js — .env writer
function writeEnvFile(envPath, updates) {
  const lines = fs.readFileSync(envPath, 'utf8').split('\n');
  const updated = new Set(Object.keys(updates));

  const result = lines.map(line => {
    const match = line.match(/^([A-Z_]+)=(.*)$/);
    if (match && updated.has(match[1])) {
      return `${match[1]}=${updates[match[1]]}`;
    }
    return line;
  });

  // Add new keys that weren't in the file
  for (const [key, value] of Object.entries(updates)) {
    if (!lines.some(l => l.startsWith(`${key}=`))) {
      result.push(`${key}=${value}`);
    }
  }

  fs.writeFileSync(envPath, result.join('\n'));
}
```

**Estimated effort:** 6-8 hours

---

### Phase 3: Hot-reload & Advanced Features
**Goal:** Hot-reload settings that can change at runtime (gateway reconnect, rate limits, heartbeat interval, theme). App enable/disable. Appearance customization.

**Hot-reloadable settings:**
- Gateway URL/password → reconnect gateway client
- Rate limits → update in-memory values
- Heartbeat interval → restart heartbeat timer
- Theme → broadcast theme change via SSE
- Accent color → broadcast via SSE
- App enabled/disabled → broadcast app registry update via SSE

**New features:**
- `POST /api/settings/reload` — reload all settings from disk without restart
- Appearance tab with live preview
- App management: drag-to-reorder, show/hide
- Export/import settings as JSON file (backup/restore)
- Graceful server restart from UI: `POST /api/settings/restart` → `process.exit(0)` (with systemd/pm2 auto-restart)

**Files to modify:**
- `lib/gateway-client.js` — add `reconnect(newOpts)` method
- `routes/sse-routes.js` — accept heartbeat interval from settings
- `routes/chat-routes.js` — read rate limits from settings store
- `shell-main.mjs` — listen for SSE theme changes
- `settings-view.mjs` — live preview, app management

**Estimated effort:** 8-10 hours

---

## Complete Test Plan

### Unit Tests — Settings Store (`lib/settings-store.js`)

#### T1: Parse .env file
- **Verifies:** `.env` file is correctly parsed into key-value pairs
- **Steps:** Call `loadEnvFile()` with a test `.env` containing `PORT=3876`, `STORAGE_TYPE=postgres`, comment lines, and blank lines
- **Expected:** Returns `{ PORT: '3876', STORAGE_TYPE: 'postgres' }`, skips comments and blanks
- **Edge cases:** Missing `.env` file → returns empty object. `.env` with values containing `=` signs → splits on first `=` only. Values with quotes → strips surrounding quotes.

#### T2: Write .env file preserving comments
- **Verifies:** Writing updates preserves the file structure
- **Steps:** Parse a `.env` with comments, update `PORT` to `4000`, write back
- **Expected:** File contains updated `PORT=4000`, original comments remain intact, line order preserved
- **Edge cases:** New key added → appended to end of file. Key removed → line deleted. Empty file → creates new file.

#### T3: Parse dashboard-config.json
- **Verifies:** Config JSON is loaded with defaults merged
- **Steps:** Create config.json with `{ "theme": "light", "quickLaunchApps": ["tasks"] }`, load with defaults
- **Expected:** Missing keys filled from defaults, present keys override defaults
- **Edge cases:** Malformed JSON → fallback to defaults. Empty file → all defaults. Unknown keys → preserved but not exposed.

#### T4: Get all settings
- **Verifies:** `getAll()` returns merged settings from both .env and config.json
- **Steps:** Set up both files with overlapping and unique keys
- **Expected:** Returns complete settings object grouped by category

#### T5: Set single setting — .env type
- **Verifies:** Updating a PORT value writes to .env and updates in-memory
- **Steps:** `set('PORT', '4000')`
- **Expected:** `.env` file updated, `get('PORT')` returns `'4000'`
- **Edge cases:** Invalid port number → validation error. Non-existent key → creates new entry.

#### T6: Set single setting — config type
- **Verifies:** Updating theme writes to config.json
- **Steps:** `set('theme', 'light')`
- **Expected:** `config.json` updated, in-memory updated

#### T7: Set multiple settings — category
- **Verifies:** `setCategory('database', { host: 'newhost', port: '5433' })` updates all keys
- **Steps:** Update database category with 2 changed keys
- **Expected:** Both keys updated in .env, other keys unchanged

#### T8: Detect restart-required
- **Verifies:** Settings marked as non-hot-reloadable flag a restart requirement
- **Steps:** Change `PORT` (requires restart) vs change rate limit (hot-reloadable)
- **Expected:** `isRestartRequired()` returns true after PORT change, false after rate limit change

#### T9: Validation
- **Verifies:** Invalid values are rejected
- **Steps:** Set PORT to "abc", set theme to "invalid", set rate limit to -1
- **Expected:** Each returns a validation error with message. Original value unchanged.

#### T10: Atomic config.json write
- **Verifies:** Config write is crash-safe
- **Steps:** Write config, check file exists and is valid JSON
- **Expected:** No partial writes. If write fails, original file intact.

### API Route Tests (`routes/settings-routes.js`)

#### T11: GET /api/settings — auth required
- **Verifies:** Unauthenticated requests are rejected
- **Steps:** GET /api/settings without Authorization header
- **Expected:** 401 Unauthorized

#### T12: GET /api/settings — returns all categories
- **Verifies:** Authenticated request returns grouped settings
- **Steps:** GET /api/settings with valid Bearer token
- **Expected:** 200 with `{ general: {...}, database: {...}, gateway: {...}, ... }`

#### T13: GET /api/settings/general — single category
- **Verifies:** Single category returns only that section
- **Steps:** GET /api/settings/general
- **Expected:** 200 with general settings only

#### T14: GET /api/settings/schema — returns schema
- **Verifies:** Schema describes all settings with types and defaults
- **Steps:** GET /api/settings/schema
- **Expected:** 200 with schema including type, default, options, hotReload for each key

#### T15: PUT /api/settings/general — update multiple
- **Verifies:** Batch update works
- **Steps:** PUT /api/settings/general with `{ REQUIRE_AUTH: 'false' }`
- **Expected:** 200, setting updated, restart-required flag set

#### T16: PUT /api/settings/:key — update single
- **Verifies:** Single key update
- **Steps:** PUT /api/settings/PORT with value 4000
- **Expected:** 200, PORT updated in .env

#### T17: PUT /api/settings/:key — validation error
- **Verifies:** Invalid values are rejected with helpful message
- **Steps:** PUT /api/settings/PORT with value "not-a-number"
- **Expected:** 400 with `{ error: "PORT must be a number" }`

#### T18: POST /api/settings/test-db — success
- **Verifies:** Database connection test succeeds
- **Steps:** POST /api/settings/test-db with current credentials
- **Expected:** 200 with `{ ok: true, latency: <number>ms }`

#### T19: POST /api/settings/test-db — failure
- **Verifies:** Bad credentials return meaningful error
- **Steps:** POST /api/settings/test-db with wrong password
- **Expected:** 200 with `{ ok: false, error: "authentication failed" }`

#### T20: POST /api/settings/test-gateway — success
- **Verifies:** Gateway connection test
- **Steps:** POST /api/settings/test-gateway
- **Expected:** 200 with `{ ok: true, url: "ws://..." }`

#### T21: POST /api/settings/test-gateway — failure
- **Verifies:** Gateway down returns error
- **Steps:** Test with gateway stopped
- **Expected:** 200 with `{ ok: false, error: "..." }`

#### T22: GET /api/settings/system-info
- **Verifies:** Runtime info is returned
- **Steps:** GET /api/settings/system-info
- **Expected:** 200 with version, uptime, memory, connections, gateway status

#### T23: GET /api/settings/restart-required — no changes
- **Verifies:** Returns false when no restart-pending changes
- **Steps:** GET /api/settings/restart-required after fresh load
- **Expected:** 200 with `{ restartRequired: false }`

#### T24: GET /api/settings/restart-required — changes pending
- **Verifies:** Returns true after non-hot-reloadable change
- **Steps:** Change PORT, then check restart-required
- **Expected:** `{ restartRequired: true, pendingKeys: ['PORT'] }`

#### T25: POST /api/settings/export
- **Verifies:** Export produces valid JSON with all settings
- **Steps:** POST /api/settings/export
- **Expected:** 200 with complete JSON, no passwords in plaintext (masked)

#### T26: POST /api/settings/import — valid import
- **Verifies:** Import applies settings from JSON
- **Steps:** POST /api/settings/import with valid JSON
- **Expected:** 200, settings applied, restart-required updated

#### T27: POST /api/settings/import — invalid JSON
- **Verifies:** Bad import is rejected safely
- **Steps:** POST /api/settings/import with malformed JSON
- **Expected:** 400 with error message, no settings changed

### Frontend Tests (`settings-view.mjs`)

#### T28: Settings app opens from Start Menu
- **Verifies:** App launches and renders all tabs
- **Steps:** Open Start Menu → click Settings
- **Expected:** Window opens with 9 tabs in sidebar, "General" tab active by default

#### T29: General tab displays current values
- **Verifies:** All general settings show correct current values
- **Steps:** Open Settings → General tab
- **Expected:** PORT shows "3876", storage type shows "postgres", workspace path filled

#### T30: Database tab — test connection
- **Verifies:** Test button works and shows result
- **Steps:** Open Database tab → click "Test Connection"
- **Expected:** Button shows spinner, then green "✓ Connected (12ms)" or red error

#### T31: Gateway tab — test connection
- **Verifies:** Gateway test shows status
- **Steps:** Open Gateway tab → click "Test Connection"
- **Expected:** Shows gateway URL, connection status, and test result

#### T32: Appearance tab — theme toggle
- **Verifies:** Changing theme applies immediately
- **Steps:** Switch theme from dark to light
- **Expected:** Desktop theme changes instantly, setting persists on reload

#### T33: Appearance tab — accent color
- **Verifies:** Color picker changes accent
- **Steps:** Pick a new accent color
- **Expected:** CSS variable updates across all open windows

#### T34: Apps tab — enable/disable app
- **Verifies:** Toggling an app hides it from Start Menu
- **Steps:** Disable "Departments" app in settings
- **Expected:** Departments disappears from Start Menu, other apps unaffected

#### T35: Apps tab — quick launch reorder
- **Verifies:** Changing quick launch apps updates taskbar
- **Steps:** Add "bing" to quick launch, remove "workflows"
- **Expected:** Taskbar updates immediately

#### T36: Security tab — rate limit change
- **Verifies:** Rate limit change applies without restart
- **Steps:** Change chat rate limit from 30 to 60
- **Expected:** No restart banner, new limit effective immediately

#### T37: System Info tab — shows live data
- **Verifies:** All system info fields populated
- **Steps:** Open System Info tab
- **Expected:** Version, uptime > 0, memory values, SSE client count, gateway status, app count

#### T38: System Info tab — auto-refreshes
- **Verifies:** Values update periodically
- **Steps:** Wait 5 seconds on System Info tab
- **Expected:** Uptime value increases, memory usage may change

#### T39: Restart banner appears when needed
- **Verifies:** Changing non-hot-reloadable setting shows banner
- **Steps:** Change server port
- **Expected:** Yellow banner at top: "⚠️ Restart required for changes to take effect"

#### T40: Save button works
- **Verifies:** Save persists changes
- **Steps:** Edit a setting → click Save
- **Expected:** Success toast/notification, setting persisted

#### T41: Export/Import roundtrip
- **Verifies:** Export → Import preserves settings
- **Steps:** Export settings → change something → Import exported file
- **Expected:** All settings restored to exported values

#### T42: Invalid input validation
- **Verifies:** Invalid values show inline errors
- **Steps:** Enter "abc" in port field
- **Expected:** Red border on input, error message below, Save button disabled

### Integration Tests

#### T43: Full cycle — change, save, verify
- **Steps:** Change theme to light → Save → Reload page → Open Settings
- **Expected:** Theme still light, setting persisted across page reload

#### T44: Full cycle — restart-required change
- **Steps:** Change PORT → Save → Check restart banner → Restart server → Verify new port
- **Expected:** Server starts on new port after restart

#### T45: Hot-reload gateway reconnect
- **Steps:** Change gateway password → Save → Verify gateway reconnects
- **Expected:** Gateway client disconnects and reconnects with new password

#### T46: Concurrent settings access
- **Steps:** Open settings in 2 browser tabs, change different settings in each
- **Expected:** Both changes saved, last-write-wins for same key, no data corruption

#### T47: Settings survive server restart
- **Steps:** Change settings → Restart server → Load settings
- **Expected:** All changes persisted correctly in .env and config.json

#### T48: Import settings from fresh install
- **Steps:** Start with default settings → Import JSON with custom values
- **Expected:** All imported values applied, defaults used for missing keys

---

## Security Considerations

1. **Password masking** — All password-type settings are masked in GET responses (`••••••`), only sent as plaintext in PUT requests over HTTPS
2. **Auth required** — All settings endpoints require Bearer token auth (same as existing API)
3. **No credential exposure** — Export function masks passwords. Import requires explicit password fields.
4. **Validation** — All inputs validated server-side before writing to files
5. **File permissions** — Settings store only writes to `.env` and `dashboard-config.json`, never to other files
6. **Path traversal** — File paths (workspace, config) validated to prevent directory escape
7. **Rate limiting** — Settings changes are rate-limited to prevent abuse (10 writes/minute)
8. **Restart confirmation** — Destructive changes (restart, import) require explicit confirmation
9. **Audit log** — All settings changes logged with timestamp and which key was changed

---

## File Structure Summary

```
dashboard/
├── lib/
│   ├── settings-store.js          (NEW — read/write .env + config.json)
│   ├── gateway-client.js          (MODIFY — add reconnect method)
│   └── ...
├── routes/
│   ├── settings-routes.js         (NEW — settings CRUD + test endpoints)
│   ├── sse-routes.js              (MODIFY — configurable heartbeat)
│   ├── chat-routes.js             (MODIFY — configurable rate limits)
│   └── ...
├── src/shell/
│   ├── native-views/
│   │   ├── settings-view.mjs      (NEW — Control Panel UI)
│   │   └── ...
│   ├── app-registry.mjs           (MODIFY — add settings entry)
│   └── shell-main.mjs             (MODIFY — listen for theme SSE events)
├── dashboard-config.json           (NEW — UI/runtime preferences)
├── task-server.js                  (MODIFY — register settings routes)
└── .env                            (EXISTING — infra settings)
```

---

## Migration Strategy

No migration needed. The settings store reads existing `.env` on first load and creates `dashboard-config.json` with defaults. Existing installations continue to work without changes. The Control Panel is additive.

**On first load:**
1. Parse `.env` → extract all known keys into settings schema
2. Check for `dashboard-config.json` → if missing, create with defaults
3. Merge both sources into unified settings object
4. Any keys in `.env` not in the schema are preserved but not exposed

**On subsequent loads:**
1. Re-parse `.env` (may have been edited manually)
2. Load `dashboard-config.json`
3. Merge and serve

---

## Mockup — Tab Layout

```
┌──────────────────────────────────────────────────────────┐
│ ⚙️ Settings                                    [×] ─ □ ✕ │
├───────────┬──────────────────────────────────────────────┤
│           │                                              │
│ ⚙ General │  Server Configuration                       │
│ 🗄 Database│  ┌──────────────────────────────────────┐  │
│ 🔌 Gateway│  │ Port          [3876              ]    │  │
│ 🎨 Appear.│  │ Auth Token    [••••••••••••••••••]    │  │
│ 📱 Apps   │  │ Workspace  [/root/.openclaw/...  ]    │  │
│ 🔒 Security│  │ Storage Type  [postgres          ▼]    │  │
│ 🔗 Integ. │  └──────────────────────────────────────┘  │
│ 📡 SSE    │                                              │
│ ℹ️ System │  ⚠️ Restart required for some changes       │
│           │                                              │
│           │  [Test Connection]  [Save]  [Save & Restart]│
└───────────┴──────────────────────────────────────────────┘
```

---

## Total Test Count: 48

| Category | Count |
|----------|-------|
| Settings Store unit tests | 10 |
| API route tests | 17 |
| Frontend UI tests | 15 |
| Integration tests | 6 |
| **Total** | **48** |
