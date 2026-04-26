# OpenClaw Desktop — Full App Test Plan
**Created:** 2026-04-26
**Total Apps:** 26 (+ Settings = 27)
**Total API Endpoints:** 60+

---

## Testing Strategy

Each app gets tested across 4 layers:
1. **API** — Backend endpoints (HTTP requests, responses, error handling)
2. **Static Analysis** — File exists, exports correct function, CSS classes present
3. **Browser UI** — Puppeteer: opens from Start Menu, renders content, tabs/buttons work
4. **Edge Cases** — Empty data, special characters, concurrent access, error states

## Groupings for Sub-Agents

### Batch 1: Work Apps (8 apps)
| # | App ID | Label | Key APIs | View Lines |
|---|--------|-------|----------|------------|
| 1 | tasks | Tasks | /api/tasks (CRUD, move, archive, restore, retry, subtasks, dependencies, history) | 1153 |
| 2 | board | Board | /api/views/board, /api/tasks | 608 |
| 3 | timeline | Timeline | /api/views/timeline, /api/tasks | 410 |
| 4 | agents | Agents | /api/agents, /api/oc/agents, /api/agent/claim/release/heartbeat | 553 |
| 5 | sessions | Sessions | /api/oc/sessions, /api/oc/sessions/:id/messages, /api/oc/chat/send/abort/status | 897 |
| 6 | requests | Requests | /api/tasks (filtered), /api/citation-queue/status | 233 |
| 7 | publish | Publish | /api/tasks (filtered) | 112 |
| 8 | approvals | Approvals | /api/tasks (filtered) | 460 |
| 9 | artifacts | Artifacts | /api/tasks (filtered) | 379 |

### Batch 2: Operations Apps (8 apps)
| # | App ID | Label | Key APIs | View Lines |
|---|--------|-------|----------|------------|
| 10 | dependencies | Dependencies | /api/tasks/:id/dependencies | 233 |
| 11 | health | Health | /api/health, /api/health-status | 147 |
| 12 | metrics | Metrics | /api/stats | 155 |
| 13 | runbooks | Runbooks | /api/tasks (filtered) | 392 |
| 14 | memory | Memory | filesystem reads | 664 |
| 15 | handoffs | Handoffs | /api/lead-handoffs | 408 |
| 16 | audit | Audit | /api/audit | 182 |
| 17 | cron | Cron | /api/cron/jobs, /api/cron/jobs/:id/runs, /api/cron/jobs/:id/run | 131 |
| 18 | diagnostics | Diagnostics | /api/health | 399 |

### Batch 3: Admin Apps (8 apps)
| # | App ID | Label | Key APIs | View Lines |
|---|--------|-------|----------|------------|
| 19 | departments | Departments | /api/tasks (grouped) | 196 |
| 20 | explorer | Explorer | filesystem API (port 3880) | 581 |
| 21 | notepad | Notepad | filesystem API | 364 |
| 22 | skills-tools | Skills & Tools | static data | 447 |
| 23 | workflows | Workflows | /api/tasks, /api/views | 413 |
| 24 | operations | Operations | composite dashboard | 532 |
| 25 | bing | Bing Webmaster | /api/bing/submit, submit-batch, indexnow, quota, status | 390 |
| 26 | settings | Settings | /api/settings/* (12 endpoints) | 571 |

---

## Test Template Per App

```
1. Static Analysis (file-level)
   - View module exists
   - Exports render function
   - Registered in app-registry.mjs with correct category
   - Imports helpers correctly

2. API Tests (backend)
   - All related endpoints return 200 with correct shape
   - Auth required
   - Error handling (404, 400, 500)
   - Data persistence (create → read → update → read → delete → confirm gone)
   - Edge cases (empty lists, special chars, concurrent access)

3. Browser UI Tests (Puppeteer)
   - App appears in Start Menu
   - App opens when clicked
   - Content renders (no blank window)
   - Interactive elements work (buttons, tabs, forms)
   - No console errors
   - Window can be closed

4. Integration Tests
   - App loads real data from API
   - Changes persist after page reload
   - App works alongside other open apps
```

---

## Execution Plan

- **3 sub-agents** run in parallel (one per batch)
- Each sub-agent tests ~9 apps
- Each writes results to `tests/reports/`
- Final summary compiled from all reports
- Estimated: ~10-15 minutes total
