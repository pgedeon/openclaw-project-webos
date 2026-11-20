#!/usr/bin/env node
/**
 * DB-free tests for the staging deploy restart's process selection
 * (scripts/lib/staging-pids.sh::staging_select_pids).
 *
 * Defect being pinned (2026-11-20): the restart step filtered pgrep -f
 * candidates with `ps -o comm= -p $p == node`. Node 24 reports comm=MainThread,
 * so nothing matched, OLD stayed empty, no process was stopped, and the health
 * gate passed against the PREVIOUS server — a silent no-op restart that still
 * reported success. Selection is now argument-based with explicit self/ancestor
 * exclusion, and these checks feed synthetic `ps` snapshots (comm=MainThread)
 * through the real shell function.
 *
 * Run: node tests/test-staging-pids.js
 */

const assert = require('assert');
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const HELPER = path.join(ROOT, 'scripts', 'lib', 'staging-pids.sh');
const LAUNCHER = '/home/pgedeon/openclaw-dashboard-staging-server.js';

let passed = 0;
let failed = 0;

function check(name, fn) {
  try {
    fn();
    passed++;
    console.log(`  ✔ ${name}`);
  } catch (err) {
    failed++;
    console.error(`  ✘ ${name}\n    ${err?.message || err}`);
  }
}

// Feed a synthetic `ps -eo pid=,ppid=,comm=,args=` snapshot through the real
// shell function and return the selected PIDs as an array of numbers.
function select(snapshotLines, selfPid) {
  const script = [
    'set -euo pipefail',
    `. ${JSON.stringify(HELPER)}`,
    `staging_select_pids ${selfPid} ${JSON.stringify(LAUNCHER)}`,
    ''
  ].join('\n');
  const res = spawnSync('bash', ['-c', script], {
    cwd: ROOT,
    encoding: 'utf8',
    input: snapshotLines.join('\n') + '\n',
    timeout: 20000
  });
  assert.strictEqual(res.status, 0, `helper exited ${res.status}: ${res.stderr || ''}`);
  return res.stdout
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean)
    .map(Number);
}

console.log('staging-pids: staging_select_pids');

check('helper file exists and is sourceable', () => {
  assert.ok(fs.existsSync(HELPER), `${HELPER} missing`);
  const res = spawnSync('bash', ['-n', HELPER], { encoding: 'utf8' });
  assert.strictEqual(res.status, 0, `bash -n failed: ${res.stderr || ''}`);
});

check('Node 24 comm=MainThread server is selected (the reported defect)', () => {
  const snap = [
    '1 0 systemd /sbin/init',
    `100 1 MainThread node ${LAUNCHER}`,
    `101 100 MainThread /usr/local/node-v24.22.1-linux-x64/bin/node ${LAUNCHER}`
  ];
  assert.deepStrictEqual(select(snap, 500), [100, 101]);
});

check('candidate set is non-empty when a server exists', () => {
  const snap = ['1 0 systemd /sbin/init', `100 1 MainThread node ${LAUNCHER}`];
  assert.notStrictEqual(select(snap, 500).length, 0);
});

check('invoking shell and its ancestor chain are excluded', () => {
  const snap = [
    '1 0 systemd /sbin/init',
    `100 1 MainThread node ${LAUNCHER}`,
    `499 1 sshd-session sshd-session: pgedeon@notty`,
    `500 499 bash bash -c . /home/pgedeon/www/staging/openclaw-dashboard/scripts/lib/staging-pids.sh; nohup setsid node ${LAUNCHER} >> log 2>&1 &`
  ];
  assert.deepStrictEqual(select(snap, 500), [100]);
});

check('deeper ancestor chain (bash -> sshd -> sshd -> init) is excluded', () => {
  const snap = [
    '1 0 systemd /sbin/init',
    `100 1 MainThread node ${LAUNCHER}`,
    '900 899 bash bash -c ssh dev "nohup setsid node ' + LAUNCHER + ' &"',
    '899 898 sshd-session sshd-session: pgedeon@notty',
    '898 1 sshd sshd: pgedeon [priv]'
  ];
  assert.deepStrictEqual(select(snap, 900), [100]);
});

check('unrelated process carrying the launcher path is excluded (argv[0] not node)', () => {
  const snap = [
    '1 0 systemd /sbin/init',
    `100 1 MainThread node ${LAUNCHER}`,
    `600 1 MainThread grep ${LAUNCHER}`,
    `601 1 MainThread /bin/bash ${LAUNCHER}`,
    `602 1 MainThread tail -f ${LAUNCHER}.log`
  ];
  assert.deepStrictEqual(select(snap, 500), [100]);
});

check('legacy comm=node instance is still selected', () => {
  const snap = ['1 0 systemd /sbin/init', `700 1 node node ${LAUNCHER}`];
  assert.deepStrictEqual(select(snap, 500), [700]);
});

check('no server present yields an empty candidate set', () => {
  const snap = [
    '1 0 systemd /sbin/init',
    '500 499 bash bash -c echo hello',
    '499 1 sshd-session sshd-session: pgedeon@notty'
  ];
  assert.deepStrictEqual(select(snap, 500), []);
});

check('a process whose argv merely mentions the launcher as a substring is excluded', () => {
  const snap = [
    '1 0 systemd /sbin/init',
    `100 1 MainThread node ${LAUNCHER}`,
    `603 1 MainThread node /home/pgedeon/openclaw-dashboard-staging-server.js.bak`
  ];
  assert.deepStrictEqual(select(snap, 500), [100]);
});

check('selection is ascending and de-duplicated', () => {
  const snap = [
    '1 0 systemd /sbin/init',
    `101 100 MainThread /usr/local/node-v24.22.1-linux-x64/bin/node ${LAUNCHER}`,
    `100 1 MainThread node ${LAUNCHER}`
  ];
  assert.deepStrictEqual(select(snap, 500), [100, 101]);
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) {
  process.exit(1);
}