#!/usr/bin/env node
/**
 * perf-benchmark.mjs — D5 manual timing harness (roadmap debt D5).
 *
 * WHAT IT IS
 *   A Playwright-driven timing harness for the webos desktop shell, run
 *   MANUALLY per release (`npm run perf`). NOT a test file: playwright.config.ts
 *   has testDir './tests' + testMatch '**\/e2e.spec.ts', so nothing under
 *   scripts/ can ever auto-run in `npx playwright test`. NOT CI-blocking:
 *   perf numbers never gate anything; this script is not registered in
 *   scripts/ci-db-free-tests.js.
 *
 * WHAT IT MEASURES (median of 3 runs, cold per run = fresh browser context)
 *   1. boot-to-interactive — navigation start → shell taskbar present
 *      (start button visible) + pinned taskbar apps rendered + desktop ready
 *      (welcome widget visible, or a window if one is open). Predicate-based,
 *      no fixed sleeps. On a fresh context no window auto-opens
 *      (window-manager restoreFromStorage() finds no persisted state), so
 *      "first window list rendered" is reported separately as measurement 2.
 *   2. tasks-view first meaningful render — click the pinned Tasks taskbar
 *      button → #tvList shows row count > 0 OR the honest empty-state marker
 *      ("No tasks…"). First open in the context = cold dynamic import of
 *      tasks-view.mjs + API fetch + render.
 *   3. capped-list growth — click "load more" (#tvLoadMore) once → rows added
 *      + synchronous main-thread re-render wall time (the click handler is
 *      synchronous: growCap + innerHTML rebuild). Validates the 100-row cap
 *      machinery (src/shell/list-window.mjs cappedWindow/growCap) does not jank.
 *
 * STAGING SUBSTITUTIONS (honest, documented — review #3/#4 fix shape)
 *   - task-server.js resolves WORKSPACE from env: `process.env.OPENCLAW_WORKSPACE
 *     || '/root/.openclaw/workspace'` (task-server.js). CI's e2e job stages
 *     index.html + src into /root/.openclaw/workspace/dashboard via sudo. This
 *     harness instead sets OPENCLAW_WORKSPACE to a fresh temp dir and stages
 *     index.html + src into <tmp>/dashboard/ — the SAME server code path
 *     (DASHBOARD_ROOT = $WORKSPACE/dashboard), zero writes to /root/.openclaw.
 *   - The CI e2e job runs with NO snapshot file (empty json_snapshot → tasks
 *     view shows its honest empty state). Measurement 3 needs >100 tasks for
 *     the "load more" control to exist, so this harness seeds a SYNTHETIC
 *     snapshot (250 tasks) at <tmp>/data/asana-db.json (the ASANA_JSON_SNAPSHOT_PATH
 *     default under the temp WORKSPACE). The seed is a measurement fixture for
 *     the capped-render machinery, not a claim about real operator data; the
 *     seeded count is recorded in perf-results.json.
 *   - Asset staging parity with CI: only index.html + src are staged, so
 *     sw.js / manifest.webmanifest / models-catalog.json / icons 404 exactly
 *     as they do in the CI e2e job (all degrade gracefully by design).
 *     ONE addition beyond the CI staging set: lib/ — tasks-view.mjs imports
 *     ../../../lib/task-conversation.js, which resolves to /lib/ under the
 *     dashboard root; without it the Tasks window fails to open (the CI e2e
 *     smoke never opens windows, so it never hits this). Production staging
 *     (dashboard-staging-deploy.sh) rsyncs the whole repo, so lib/ is served
 *     there; staging it here matches the real deployment shape.
 *
 * TIMING METHOD
 *   In-page requestAnimationFrame waiter resolving with performance.now()
 *   (ms since navigation start = timeOrigin). No Node-side polling; detection
 *   granularity ≈ one frame.
 *
 * OUTPUT
 *   Human-readable table + `VERDICT: measured` line; JSON written to
 *   perf-results.json at the repo root (gitignored) with timestamp, node
 *   version, commit sha.
 *
 * EXIT CODES
 *   0 — measurements produced (perf numbers NEVER gate anything).
 *   1 — infrastructure failure only: server never became ready, Chromium
 *       could not launch, or the shell never became interactive.
 *
 * Run: npm run perf   (from the repo root; Chromium must be installed:
 *      npx playwright install chromium)
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import http from 'node:http';
import { spawn, execSync } from 'node:child_process';
import pw from '@playwright/test';

const { chromium } = pw;

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 13899; // work-order port; avoids any stray process on 3876
const HOST = '127.0.0.1';
const AUTH_TOKEN = 'perf-token';
const BASE_URL = `http://${HOST}:${PORT}`;
const RUNS = 3;
const SEEDED_TASKS = 250; // > LIST_INITIAL_CAP(100) + LIST_CAP_STEP(100) so one "load more" click is exercisable
const WAITER_TIMEOUT_MS = 30000;
const BOOT_FLAG_THRESHOLD_MS = 5000; // work order: flag pathological boot, do not optimize here

const results = {
  timestamp: new Date().toISOString(),
  node: process.version,
  commit: null,
  environment: { platform: `${os.platform()} ${os.arch()}`, hostname: os.hostname() },
  config: {
    port: PORT,
    storage_type: 'json_snapshot',
    seeded_tasks: SEEDED_TASKS,
    runs: RUNS,
    workspace_staging: 'OPENCLAW_WORKSPACE temp dir (task-server.js env override; CI stages /root/.openclaw/workspace/dashboard instead)',
  },
  metrics: {},
  notes: [],
};

function note(msg) {
  results.notes.push(msg);
  console.log(`  note: ${msg}`);
}

function median(values) {
  const s = [...values].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
}

function gitCommit() {
  try {
    return execSync('git rev-parse --short HEAD', { cwd: REPO_ROOT }).toString().trim();
  } catch {
    return 'unknown';
  }
}

// ── temp workspace staging (CI "Stage dashboard assets" shape) ─────────────

function stageWorkspace() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'webos-perf-'));
  const dashboard = path.join(tmp, 'dashboard');
  fs.mkdirSync(dashboard, { recursive: true });
  // Exactly the CI e2e job's staging set: index.html + src. Nothing else —
  // sw.js/manifest/models-catalog 404 in CI too and degrade by design.
  // PLUS lib/: tasks-view.mjs imports ../../../lib/task-conversation.js
  // (resolves to /lib/ under the dashboard root). CI's smoke never opens a
  // window so it never needs it; the real staging deploy rsyncs the whole
  // repo, so lib/ is served there. Without it the Tasks window cannot open.
  fs.cpSync(path.join(REPO_ROOT, 'index.html'), path.join(dashboard, 'index.html'));
  fs.cpSync(path.join(REPO_ROOT, 'src'), path.join(dashboard, 'src'), { recursive: true });
  fs.cpSync(path.join(REPO_ROOT, 'lib'), path.join(dashboard, 'lib'), { recursive: true });

  // Seed the json_snapshot fixture (see header: measurement fixture, not data
  // claims). ASANA_JSON_SNAPSHOT_PATH default = $WORKSPACE/data/asana-db.json.
  const dataDir = path.join(tmp, 'data');
  fs.mkdirSync(dataDir, { recursive: true });
  const now = Date.now();
  const statuses = ['backlog', 'ready', 'in_progress', 'review', 'blocked'];
  const priorities = ['low', 'medium', 'high', 'critical'];
  const tasks = [];
  for (let i = 0; i < SEEDED_TASKS; i++) {
    const created = new Date(now - i * 60_000).toISOString();
    tasks.push({
      id: `perf-task-${String(i + 1).padStart(4, '0')}`,
      title: `Perf seed task ${i + 1} — synthetic capped-list fixture row`,
      status: statuses[i % statuses.length],
      priority: priorities[i % priorities.length],
      project_id: null,
      created_at: created,
      updated_at: created,
    });
  }
  const snapshot = {
    version: '1.0',
    created_at: new Date(now).toISOString(),
    updated_at: new Date(now).toISOString(),
    projects: [],
    tasks,
    workflows: [],
    audit_log: [],
  };
  fs.writeFileSync(path.join(dataDir, 'asana-db.json'), JSON.stringify(snapshot));
  return tmp;
}

// ── server boot (CI e2e job "Start task-server" shape) ─────────────────────

function startServer(workspaceDir) {
  const log = [];
  const child = spawn('node', ['task-server.js'], {
    cwd: REPO_ROOT,
    env: {
      ...process.env,
      STORAGE_TYPE: 'json_snapshot',
      HOST,
      PORT: String(PORT),
      DASHBOARD_AUTH_TOKEN: AUTH_TOKEN,
      OPENCLAW_WORKSPACE: workspaceDir,
      ASANA_JSON_SNAPSHOT_PATH: path.join(workspaceDir, 'data', 'asana-db.json'),
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout.on('data', (d) => log.push(d.toString()));
  child.stderr.on('data', (d) => log.push(d.toString()));
  child.log = log;
  return child;
}

function waitForHealth(attempts = 30, intervalMs = 1000) {
  return new Promise((resolve) => {
    let attempt = 0;
    const tick = () => {
      attempt += 1;
      const req = http.get(`${BASE_URL}/api/health`, (res) => {
        let body = '';
        res.on('data', (c) => { body += c; });
        res.on('end', () => {
          if (res.statusCode === 200) {
            try {
              const parsed = JSON.parse(body);
              if (parsed.storage_type === 'json_snapshot') return resolve(true);
            } catch { /* fall through */ }
          }
          if (attempt >= attempts) return resolve(false);
          setTimeout(tick, intervalMs);
        });
      });
      req.on('error', () => {
        if (attempt >= attempts) return resolve(false);
        setTimeout(tick, intervalMs);
      });
    };
    tick();
  });
}

// ── measurement run ─────────────────────────────────────────────────────────

async function runOnce(browser, runIndex) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await context.newPage();
  const pageErrors = [];
  page.on('pageerror', (err) => pageErrors.push(String(err.message || err)));

  // Auth bootstrap parity with tests/e2e.spec.ts: token pre-seeded so the
  // shell boots without the manual gate (same localStorage key).
  await page.addInitScript(([key, token]) => {
    localStorage.setItem(key, token);
  }, ['openclaw.dashboardToken', AUTH_TOKEN]);

  // 1. boot-to-interactive: performance.now() at predicate flip = ms since
  //    navigation start (timeOrigin).
  await page.goto(`${BASE_URL}/index.html`, { waitUntil: 'domcontentloaded', timeout: 15000 });
  const bootMs = await page.evaluate(([timeout]) => new Promise((resolve) => {
    const vis = (el) => !!el && el.getBoundingClientRect().width > 0 && el.getBoundingClientRect().height > 0;
    const check = () => {
      if (vis(document.querySelector('.win11-taskbar [data-action="start"]'))
        && document.querySelectorAll('.win11-taskbar [data-app-id]').length > 0
        && (vis(document.querySelector('.win11-desktop__welcome')) || !!document.querySelector('.win11-window'))) {
        resolve(performance.now());
        return;
      }
      requestAnimationFrame(check);
    };
    check();
    setTimeout(() => resolve(null), timeout);
  }), [WAITER_TIMEOUT_MS]);

  // 2. tasks-view first meaningful render: click pinned Tasks button → list
  //    ready. First open in this context = cold dynamic import + fetch + render.
  const tasksMs = await page.evaluate(([timeout]) => new Promise((resolve) => {
    const btn = document.querySelector('.win11-taskbar [data-app-id="tasks"]');
    if (!btn) { resolve(null); return; }
    const t0 = performance.now();
    btn.click();
    const check = () => {
      const list = document.querySelector('#tvList');
      const ready = !!list && (
        list.querySelectorAll('.tv-task-row').length > 0
        || /No tasks/.test(list.textContent || '')
        || /No \S+ tasks\./.test(list.textContent || '')
      );
      if (ready) { resolve(performance.now() - t0); return; }
      requestAnimationFrame(check);
    };
    check();
    setTimeout(() => resolve(null), timeout);
  }), [WAITER_TIMEOUT_MS]);

  // 3. capped-list growth: one "load more" click. The handler is synchronous
  //    (growCap + innerHTML rebuild), so performance.now() around click()
  //    measures the main-thread re-render cost directly.
  const loadMore = await page.evaluate(() => {
    const btn = document.querySelector('#tvLoadMore');
    if (!btn) return { error: 'load-more control not present' };
    const before = document.querySelectorAll('.tv-task-row').length;
    const t0 = performance.now();
    btn.click();
    const ms = performance.now() - t0;
    const after = document.querySelectorAll('.tv-task-row').length;
    return { before, after, added: after - before, ms };
  });

  await context.close();
  return { run: runIndex, bootMs, tasksMs, loadMore, pageErrors };
}

// ── main ────────────────────────────────────────────────────────────────────

async function main() {
  results.commit = gitCommit();
  console.log('D5 perf harness — manual timing, not CI-blocking');
  console.log(`  repo: ${REPO_ROOT}`);
  console.log(`  commit: ${results.commit}  node: ${results.node}`);
  console.log(`  runs: ${RUNS} (cold per run = fresh browser context)  port: ${PORT}`);

  const workspaceDir = stageWorkspace();
  const server = startServer(workspaceDir);
  let browser = null;
  let exitCode = 0;

  try {
    const ready = await waitForHealth();
    if (!ready) {
      console.error('\nINFRASTRUCTURE FAILURE: task-server never became ready on ' + BASE_URL);
      console.error('--- task-server log tail ---');
      console.error(server.log.join('').split('\n').slice(-40).join('\n'));
      exitCode = 1;
      return;
    }
    console.log('  task-server ready (json_snapshot, temp OPENCLAW_WORKSPACE)');

    try {
      browser = await chromium.launch({ headless: true });
    } catch (err) {
      console.error('\nINFRASTRUCTURE FAILURE: Chromium could not launch.');
      console.error(String(err.message || err));
      console.error('Hint: npx playwright install chromium');
      exitCode = 1;
      return;
    }

    const runs = [];
    for (let i = 1; i <= RUNS; i++) {
      const r = await runOnce(browser, i);
      runs.push(r);
      const lm = r.loadMore && r.loadMore.added != null ? `load-more +${r.loadMore.added} rows in ${r.loadMore.ms.toFixed(1)}ms` : `load-more: ${r.loadMore && r.loadMore.error ? r.loadMore.error : 'n/a'}`;
      console.log(`  run ${i}: boot ${r.bootMs == null ? 'FAILED' : Math.round(r.bootMs) + 'ms'} · tasks-render ${r.tasksMs == null ? 'FAILED' : Math.round(r.tasksMs) + 'ms'} · ${lm}${r.pageErrors.length ? ` · pageerrors: ${r.pageErrors.length}` : ''}`);
    }

    const bootSamples = runs.map((r) => r.bootMs).filter((v) => v != null);
    const tasksSamples = runs.map((r) => r.tasksMs).filter((v) => v != null);
    const lmSamples = runs.filter((r) => r.loadMore && r.loadMore.added != null).map((r) => r.loadMore);
    const pageErrorTotal = runs.reduce((n, r) => n + r.pageErrors.length, 0);

    results.metrics.boot_to_interactive_ms = { samples: bootSamples.map((v) => Math.round(v * 10) / 10), median: bootSamples.length ? Math.round(median(bootSamples) * 10) / 10 : null };
    results.metrics.tasks_view_first_render_ms = { samples: tasksSamples.map((v) => Math.round(v * 10) / 10), median: tasksSamples.length ? Math.round(median(tasksSamples) * 10) / 10 : null };
    results.metrics.capped_list_load_more = {
      samples: lmSamples.map((s) => ({ rows_before: s.before, rows_after: s.after, rows_added: s.added, ms: Math.round(s.ms * 10) / 10 })),
      median_ms: lmSamples.length ? Math.round(median(lmSamples.map((s) => s.ms)) * 10) / 10 : null,
      rows_added_median: lmSamples.length ? median(lmSamples.map((s) => s.added)) : null,
    };
    results.page_errors_total = pageErrorTotal;

    if (!bootSamples.length) {
      console.error('\nINFRASTRUCTURE FAILURE: shell never became interactive in any run (server healthy).');
      exitCode = 1;
      return;
    }

    // Human-readable table
    const fmt = (v) => (v == null ? 'n/a' : `${Math.round(v)}ms`);
    console.log('\n──────────────────────────────────────────────────────────────────────');
    console.log('Metric                                                          median');
    console.log('──────────────────────────────────────────────────────────────────────');
    console.log(`boot-to-interactive (nav → taskbar + pinned apps + desktop ready)`);
    console.log(`  samples: ${runs.map((r) => fmt(r.bootMs)).join('  ')}  →  median ${fmt(results.metrics.boot_to_interactive_ms.median)}`);
    console.log(`tasks-view first meaningful render (click → rows>0 / empty-state)`);
    console.log(`  samples: ${runs.map((r) => fmt(r.tasksMs)).join('  ')}  →  median ${fmt(results.metrics.tasks_view_first_render_ms.median)}`);
    console.log(`capped-list growth (one "load more" click, sync re-render)`);
    console.log(`  samples: ${lmSamples.map((s) => `+${s.added} rows/${Math.round(s.ms)}ms`).join('  ') || 'n/a'}  →  median ${fmt(results.metrics.capped_list_load_more.median_ms)}`);
    console.log('──────────────────────────────────────────────────────────────────────');

    if (results.metrics.boot_to_interactive_ms.median != null && results.metrics.boot_to_interactive_ms.median > BOOT_FLAG_THRESHOLD_MS) {
      note(`PATHOLOGICAL: boot-to-interactive median ${results.metrics.boot_to_interactive_ms.median}ms > ${BOOT_FLAG_THRESHOLD_MS}ms threshold — recorded per D5 measure-only scope; optimization is a separate decision.`);
      console.log(`  ⚠ FLAG: boot-to-interactive median > ${BOOT_FLAG_THRESHOLD_MS}ms — recorded, NOT optimized here (D5 is measure-only).`);
    }
    if (tasksSamples.length < RUNS) note(`tasks-view render: ${tasksSamples.length}/${RUNS} runs produced a sample.`);
    if (lmSamples.length < RUNS) note(`load-more: ${lmSamples.length}/${RUNS} runs produced a sample (control absent or list empty).`);
    if (pageErrorTotal > 0) note(`${pageErrorTotal} uncaught page errors observed across runs (recorded in perf-results.json per-run).`);

    // JSON results (gitignored)
    const outPath = path.join(REPO_ROOT, 'perf-results.json');
    fs.writeFileSync(outPath, JSON.stringify(results, null, 2));
    console.log(`\nJSON results: ${outPath}`);
    console.log('VERDICT: measured');
  } finally {
    if (browser) { try { await browser.close(); } catch { /* already gone */ } }
    if (server && server.exitCode == null) {
      server.kill('SIGTERM');
      setTimeout(() => { if (server.exitCode == null) server.kill('SIGKILL'); }, 3000).unref();
    }
    try { fs.rmSync(workspaceDir, { recursive: true, force: true }); } catch { /* best effort */ }
  }

  process.exitCode = exitCode;
}

main().catch((err) => {
  console.error('INFRASTRUCTURE FAILURE:', err);
  process.exitCode = 1;
});
