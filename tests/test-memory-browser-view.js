#!/usr/bin/env node
/**
 * Focused tests for the memory browser 2.0 view's pure helpers
 * (src/shell/native-views/memory-browser-view.mjs):
 *   - extractMemoryEntries — deterministic dated-block parsing
 *   - groupTimelineByDay   — descending day buckets + Unknown tail
 *   - extractAgentRefs     — cross-agent link heuristic (@mentions, roster
 *                            names, shared run/task/session ids; email-safe)
 *   - filterTimeline       — agent + inclusive date-range filtering
 *   - withAgentRefs        — decoration pass
 *
 * Run: node tests/test-memory-browser-view.js
 */

const assert = require('assert');
const path = require('path');
const { pathToFileURL } = require('url');

let passed = 0;
let failed = 0;

function check(name, fn) {
  try {
    const r = fn();
    if (r instanceof Promise) {
      return r.then(() => { passed++; console.log(`  ✔ ${name}`); },
        (err) => { failed++; console.error(`  ✘ ${name}\n    ${err?.message || err}`); });
    }
    passed++;
    console.log(`  ✔ ${name}`);
    return Promise.resolve();
  } catch (err) {
    failed++;
    console.error(`  ✘ ${name}\n    ${err?.message || err}`);
    return Promise.resolve();
  }
}

(async () => {
  const viewPath = path.join(__dirname, '..', 'src', 'shell', 'native-views', 'memory-browser-view.mjs');
  const mod = await import(pathToFileURL(viewPath).href);
  const { extractMemoryEntries, groupTimelineByDay, extractAgentRefs, filterTimeline, withAgentRefs, ROW_HEIGHT, MAX_FILES } = mod;

  console.log('memory-browser-view: extractMemoryEntries');

  await check('daily file: headings become entries dated from the filename', () => {
    const entries = extractMemoryEntries([{
      name: '2026-08-24.md',
      modified: '2026-08-24T18:00:00Z',
      content: '# Morning\n\nshipped the gate\n\n## Afternoon\n\ndeploy went green\n',
    }]);
    assert.strictEqual(entries.length, 2);
    assert.strictEqual(entries[0].day, '2026-08-24');
    assert.strictEqual(entries[0].title, 'Morning');
    assert.match(entries[0].text, /shipped the gate/);
    assert.strictEqual(entries[1].title, 'Afternoon');
    assert.strictEqual(entries[0].line, 1);
    assert.strictEqual(entries[1].line, 5);
  });

  await check('dated bullets start blocks; undated lines join the current block', () => {
    const entries = extractMemoryEntries([{
      name: 'MEMORY.md',
      content: [
        '- 2026-08-23: fixed the proxy',
        '  follow-up note belongs here',
        '- 2026-08-20: earlier work',
        '',
        'stray paragraph after blank joins the 08-20 block',
      ].join('\n'),
    }]);
    assert.strictEqual(entries.length, 2);
    assert.strictEqual(entries[0].day, '2026-08-23');
    assert.match(entries[0].text, /follow-up note belongs here/);
    assert.strictEqual(entries[1].day, '2026-08-20');
    assert.match(entries[1].text, /stray paragraph/);
  });

  await check('heading containing a date wins over filename day', () => {
    const entries = extractMemoryEntries([{
      name: '2026-08-01.md',
      content: '## 2026-07-15 retro\n\nold notes kept under their own day\n',
    }]);
    assert.strictEqual(entries.length, 1);
    assert.strictEqual(entries[0].day, '2026-07-15');
  });

  await check('undated specialized file falls back to modified timestamp', () => {
    const entries = extractMemoryEntries([{
      name: 'DEPLOY-POLICY.md',
      modified: '2026-08-20T10:00:00Z',
      content: 'Rules for deploys.\nMore rules.\n',
    }]);
    assert.strictEqual(entries.length, 1);
    assert.strictEqual(entries[0].day, null);
    assert.strictEqual(entries[0].ts, Date.parse('2026-08-20T10:00:00Z'));
  });

  await check('no date anywhere → ts=0 and sorts last', () => {
    const entries = extractMemoryEntries([
      { name: 'a.md', content: 'no dates here' },
      { name: 'b.md', modified: '2026-08-24T10:00:00Z', content: 'dated by mtime' },
    ]);
    assert.strictEqual(entries[entries.length - 1].file, 'a.md');
    assert.strictEqual(entries[entries.length - 1].ts, 0);
  });

  await check('numbered-list dated variant parses', () => {
    const entries = extractMemoryEntries([{ name: 'x.md', content: '1. 2026-08-01 kickoff' }]);
    assert.strictEqual(entries.length, 1);
    assert.strictEqual(entries[0].day, '2026-08-01');
  });

  await check('empty/malformed inputs degrade to empty list', () => {
    assert.deepStrictEqual(extractMemoryEntries([]), []);
    assert.deepStrictEqual(extractMemoryEntries(null), []);
    assert.deepStrictEqual(extractMemoryEntries([{ name: 'e.md', content: '' }], ), []);
    assert.deepStrictEqual(extractMemoryEntries([{ name: 'e.md' }]), []);
  });

  await check('sort is newest-first across files', () => {
    const entries = extractMemoryEntries([
      { name: 'old.md', content: '- 2026-08-01 old' },
      { name: 'new.md', content: '- 2026-08-24 new' },
    ]);
    assert.strictEqual(entries[0].day, '2026-08-24');
  });

  console.log('memory-browser-view: groupTimelineByDay');

  await check('groups consecutive same-day entries into descending buckets', () => {
    const entries = extractMemoryEntries([
      { name: 'a.md', content: '- 2026-08-24 one\n- 2026-08-24 two\n- 2026-08-23 three' },
    ]);
    const groups = groupTimelineByDay(entries);
    assert.deepStrictEqual(groups.map((g) => g.day), ['2026-08-24', '2026-08-23']);
    assert.strictEqual(groups[0].entries.length, 2);
    assert.strictEqual(groups[1].entries.length, 1);
  });

  await check('null-day entries land in trailing Unknown bucket', () => {
    const groups = groupTimelineByDay([
      { id: 'b', ts: Date.parse('2026-08-24T12:00:00Z'), day: '2026-08-24' },
      { id: 'a', ts: 0, day: null },
    ]);
    assert.deepStrictEqual(groups.map((g) => g.day), ['2026-08-24', null]);
  });

  await check('empty input → no groups', () => {
    assert.deepStrictEqual(groupTimelineByDay([]), []);
    assert.deepStrictEqual(groupTimelineByDay(undefined), []);
  });

  console.log('memory-browser-view: extractAgentRefs');

  await check('@mentions are captured lowercased and deduped', () => {
    const refs = extractAgentRefs('Handed off to @QA-Auditor then @qa-auditor again.', []);
    assert.deepStrictEqual(refs.agents, ['qa-auditor']);
  });

  await check('roster names match on word boundaries case-insensitively', () => {
    const refs = extractAgentRefs('the qa-auditor signed off; not the qa-auditors team', ['qa-auditor']);
    assert.deepStrictEqual(refs.agents, ['qa-auditor']);
  });

  await check('email addresses do NOT count as mentions', () => {
    const refs = extractAgentRefs('ping peter@example.com about it', []);
    assert.deepStrictEqual(refs.agents, []);
  });

  await check('shared run/task/session/wf ids are extracted normalized', () => {
    const refs = extractAgentRefs('see run_1a2b3c and Task-42F0AB plus session ab12cd34ee', []);
    assert.deepStrictEqual(refs.ids.sort(), ['run:1a2b3c', 'session:ab12cd34ee', 'task:42f0ab']);
  });

  await check('non-id hex words are ignored', () => {
    const refs = extractAgentRefs('deadbeef cafe babe face', []);
    assert.deepStrictEqual(refs.ids, []);
  });

  await check('malformed inputs return empty ref sets', () => {
    assert.deepStrictEqual(extractAgentRefs(null, ['qa']), { agents: [], ids: [] });
    assert.deepStrictEqual(extractAgentRefs(42, undefined), { agents: [], ids: [] });
  });

  console.log('memory-browser-view: filterTimeline');

  function fixture() {
    return withAgentRefs(extractMemoryEntries([
      { name: 't.md', content: '- 2026-08-20 alpha @coder run_1a2b3c\n- 2026-08-23 beta @qa-auditor\n- 2026-08-25 gamma' },
      { name: 'u.md', content: 'undated orphan' },
    ]), ['coder', 'qa-auditor']);
  }

  await check('agent filter keeps only entries referencing that agent', () => {
    const rows = filterTimeline(fixture(), { agent: 'qa-auditor' });
    assert.strictEqual(rows.length, 1);
    assert.match(rows[0].title, /beta/);
  });
  await check('date range is inclusive on both ends', () => {
    const rows = filterTimeline(fixture(), { from: '2026-08-20', to: '2026-08-23' });
    assert.deepStrictEqual(rows.map((r) => r.title).sort(), ['alpha @coder run_1a2b3c', 'beta @qa-auditor']);
  });

  await check('undated entries are excluded once a range is set', () => {
    const all = filterTimeline(fixture(), {});
    assert.strictEqual(all.length, 4); // 3 dated + 1 undated
    const ranged = filterTimeline(fixture(), { from: '2026-08-01', to: '2026-08-30' });
    assert.strictEqual(ranged.length, 3);
  });

  await check('combined agent+range filters intersect', () => {
    const rows = filterTimeline(fixture(), { agent: 'coder', from: '2026-08-21', to: '2026-08-30' });
    assert.deepStrictEqual(rows, []);
  });

  await check('empty options return everything; bad input returns empty', () => {
    assert.strictEqual(filterTimeline(fixture(), {}).length, 4);
    assert.deepStrictEqual(filterTimeline(null, {}), []);
  });

  console.log('memory-browser-view: constants');

  await check('rail constants stay virtualization-safe', () => {
    assert.ok(Number.isFinite(ROW_HEIGHT) && ROW_HEIGHT > 0);
    assert.ok(Number.isInteger(MAX_FILES) && MAX_FILES > 0);
  });

  console.log(`\n${passed}/${passed + failed} checks passed`);
  if (failed > 0) process.exit(1);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
