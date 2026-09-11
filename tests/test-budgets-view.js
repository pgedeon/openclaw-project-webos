#!/usr/bin/env node
/**
 * Focused tests for the budgets management view's pure helpers
 * (src/shell/native-views/budgets-view.mjs, budget-ledger brief §6 slice 4):
 *   - validateBudgetForm — client-side mirror of routes/budget-routes.js
 *     validateCreatePayload() enum/XOR/scope_id rules over the form shape
 *   - spendPercent       — mirror of lib/budget-eval.js pctOfCap() over the
 *                          list payload's derived current_spend block
 *   - budgetTone         — Mission Control bar semantics (amber >75%, red
 *                          at >=100% or status 'breached')
 *   - describeSpend      — human spend-vs-cap fragment
 *   - module smoke       — default export + MC threshold parity
 *
 * Run: node tests/test-budgets-view.js
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
  const viewPath = path.join(__dirname, '..', 'src', 'shell', 'native-views', 'budgets-view.mjs');
  const mod = await import(pathToFileURL(viewPath).href);
  const {
    validateBudgetForm, spendPercent, budgetTone, describeSpend,
    BUDGET_WARN_FRACTION, BUDGET_BREACH_FRACTION,
    BUDGET_SCOPES, BUDGET_PERIODS, BUDGET_ACTIONS,
    renderBudgetsView,
  } = mod;

  console.log('budgets-view: validateBudgetForm (API mirror)');

  await check('happy path: agent scope + USD cap builds the POST payload', () => {
    const v = validateBudgetForm({
      name: '  coder daily usd  ', scope: 'agent', scope_id: ' coder ', period: 'daily',
      cap_unit: 'usd', cap_value: '25', action_on_exceed: 'warn',
    });
    assert.strictEqual(v.ok, true);
    assert.deepStrictEqual(v.payload, {
      name: 'coder daily usd', scope: 'agent', scope_id: 'coder', period: 'daily',
      cap_usd: 25, cap_tokens: null, action_on_exceed: 'warn',
    });
  });

  await check('fleet budget forces scope_id NULL and keeps token cap', () => {
    const v = validateBudgetForm({
      name: 'fleet monthly tokens', scope: 'fleet', scope_id: 'ignored', period: 'monthly',
      cap_unit: 'tokens', cap_value: '5000000', action_on_exceed: 'hard_stop',
    });
    assert.strictEqual(v.ok, true);
    assert.strictEqual(v.payload.scope_id, null);
    assert.strictEqual(v.payload.cap_tokens, 5000000);
    assert.strictEqual(v.payload.cap_usd, null);
  });

  await check('missing/blank name rejected with API wording', () => {
    for (const name of ['', '   ', null, undefined]) {
      const v = validateBudgetForm({ name, scope: 'agent', scope_id: 'coder', period: 'daily', cap_unit: 'usd', cap_value: '5', action_on_exceed: 'warn' });
      assert.strictEqual(v.ok, false);
      assert.ok(v.errors.some(e => e === 'name is required'), `blank ${JSON.stringify(name)} → name is required`);
    }
  });

  await check('enum violations rejected per field (scope/period/action)', () => {
    const base = { name: 'x', scope: 'agent', scope_id: 'coder', period: 'daily', cap_unit: 'usd', cap_value: '5', action_on_exceed: 'warn' };
    let v = validateBudgetForm({ ...base, scope: 'world' });
    assert.ok(v.errors.some(e => e.includes('scope must be one of')));
    v = validateBudgetForm({ ...base, period: 'hourly' });
    assert.ok(v.errors.some(e => e.includes('period must be one of')));
    v = validateBudgetForm({ ...base, action_on_exceed: 'nuke' });
    assert.ok(v.errors.some(e => e.includes('action_on_exceed must be one of')));
  });

  await check('non-fleet scope without scope_id rejected; fleet never requires one', () => {
    const base = { name: 'x', period: 'daily', cap_unit: 'usd', cap_value: '5', action_on_exceed: 'warn' };
    for (const scope of ['agent', 'department', 'project']) {
      const v = validateBudgetForm({ ...base, scope, scope_id: '   ' });
      assert.strictEqual(v.ok, false);
      assert.ok(v.errors.some(e => e === 'scope_id is required for non-fleet scopes'), `${scope} needs scope_id`);
    }
    const fleet = validateBudgetForm({ ...base, scope: 'fleet' });
    assert.strictEqual(fleet.ok, true);
  });

  await check('cap XOR surfaced client-side: empty value rejected with API wording', () => {
    const base = { name: 'x', scope: 'agent', scope_id: 'coder', period: 'daily', action_on_exceed: 'warn' };
    for (const cap_value of ['', '   ', null, undefined]) {
      const v = validateBudgetForm({ ...base, cap_unit: 'usd', cap_value });
      assert.strictEqual(v.ok, false);
      assert.ok(v.errors.some(e => e === 'exactly one of cap_usd / cap_tokens is required (XOR)'), `empty ${JSON.stringify(cap_value)} → XOR message`);
    }
  });

  await check('cap unit rules mirror the server: usd finite>0, tokens positive integer', () => {
    const base = { name: 'x', scope: 'agent', scope_id: 'coder', period: 'daily', action_on_exceed: 'warn' };
    let v = validateBudgetForm({ ...base, cap_unit: 'usd', cap_value: '0' });
    assert.ok(v.errors.some(e => e === 'cap_usd must be a positive number'));
    v = validateBudgetForm({ ...base, cap_unit: 'usd', cap_value: '-5' });
    assert.ok(v.errors.some(e => e === 'cap_usd must be a positive number'));
    v = validateBudgetForm({ ...base, cap_unit: 'usd', cap_value: 'abc' });
    assert.ok(v.errors.some(e => e === 'cap_usd must be a positive number'));
    v = validateBudgetForm({ ...base, cap_unit: 'tokens', cap_value: '10.5' });
    assert.ok(v.errors.some(e => e === 'cap_tokens must be a positive integer'));
    v = validateBudgetForm({ ...base, cap_unit: 'tokens', cap_value: '0' });
    assert.ok(v.errors.some(e => e === 'cap_tokens must be a positive integer'));
    // Fractional USD is legal.
    v = validateBudgetForm({ ...base, cap_unit: 'usd', cap_value: '12.5' });
    assert.strictEqual(v.ok, true);
    assert.strictEqual(v.payload.cap_usd, 12.5);
  });

  await check('multiple violations accumulate (name + scope + cap together)', () => {
    const v = validateBudgetForm({ name: '', scope: 'nope', period: 'daily', cap_unit: 'usd', cap_value: '', action_on_exceed: 'warn' });
    assert.strictEqual(v.ok, false);
    assert.ok(v.errors.length >= 3, `got ${v.errors.length}: ${v.errors.join('; ')}`);
  });

  console.log('budgets-view: spendPercent (pctOfCap mirror)');

  await check('USD cap math rounds to 2 decimals like the API payload', () => {
    assert.strictEqual(spendPercent({ cap_usd: 10, cap_tokens: null, current_spend: { usd: 4.1234, tokens: 0 } }), 41.23);
    assert.strictEqual(spendPercent({ cap_usd: 5, cap_tokens: null, current_spend: { usd: 5, tokens: 0 } }), 100);
    assert.strictEqual(spendPercent({ cap_usd: 5, cap_tokens: null, current_spend: { usd: 7.5, tokens: 0 } }), 150);
  });

  await check('token cap uses spend.tokens; zero-cap/null guards return null', () => {
    assert.strictEqual(spendPercent({ cap_usd: null, cap_tokens: 1000, current_spend: { usd: 0, tokens: 88000 } }), 8800);
    assert.strictEqual(spendPercent({ cap_usd: null, cap_tokens: 1000, current_spend: { usd: 3, tokens: 0 } }), 0);
    assert.strictEqual(spendPercent({ cap_usd: null, cap_tokens: null, current_spend: { usd: 1, tokens: 1 } }), null);
    assert.strictEqual(spendPercent({}), null);
    assert.strictEqual(spendPercent(null), null);
  });

  await check('missing current_spend block degrades to 0-based pct, not NaN', () => {
    assert.strictEqual(spendPercent({ cap_usd: 10, cap_tokens: null }), 0);
    assert.strictEqual(spendPercent({ cap_usd: 10, current_spend: null }), 0);
  });

  console.log('budgets-view: budgetTone (MC bar semantics)');

  await check('boundaries: >75% amber, >=100% red, exactly-75% green', () => {
    assert.strictEqual(budgetTone(74.99, 'under'), 'ok');
    assert.strictEqual(budgetTone(75, 'under'), 'ok');          // strictly greater-than warn fraction
    assert.strictEqual(budgetTone(75.01, 'under'), 'warn');
    assert.strictEqual(budgetTone(99.99, 'under'), 'warn');
    assert.strictEqual(budgetTone(100, 'under'), 'error');      // exactly-at-cap IS a breach
    assert.strictEqual(budgetTone(140, 'under'), 'error');
  });

  await check("status 'breached' forces red even with a low/NaN pct", () => {
    assert.strictEqual(budgetTone(10, 'breached'), 'error');
    assert.strictEqual(budgetTone(null, 'breached'), 'error');
    assert.strictEqual(budgetTone(NaN, 'breached'), 'error');
  });

  await check('non-finite pct without breach renders green (uncapped cannot breach)', () => {
    assert.strictEqual(budgetTone(null, 'under'), 'ok');
    assert.strictEqual(budgetTone(undefined, undefined), 'ok');
  });

  console.log('budgets-view: describeSpend');

  await check('USD vs token fragments match the flag wording family', () => {
    assert.strictEqual(describeSpend({ cap_usd: 10, current_spend: { usd: 12.5, tokens: 0 } }), '$12.50 of $10.00 cap');
    assert.strictEqual(describeSpend({ cap_tokens: 100000, current_spend: { usd: 0, tokens: 88000 } }), '88,000 of 100,000 tokens');
    assert.strictEqual(describeSpend({}, ), 'spend $0.00');
  });

  console.log('budgets-view: module contract');

  await check('threshold constants stay in lockstep with Mission Control', () => {
    // mission-control-view.mjs defines the same pair; the operator color
    // contract splits if these drift apart.
    assert.strictEqual(BUDGET_WARN_FRACTION, 0.75);
    assert.strictEqual(BUDGET_BREACH_FRACTION, 1);
  });

  await check('enum tables mirror routes/budget-routes.js verbatim', () => {
    const routeSrc = require('fs').readFileSync(path.join(__dirname, '..', 'routes', 'budget-routes.js'), 'utf8');
    assert.match(routeSrc, /SCOPES = \['agent', 'department', 'project', 'fleet'\]/);
    assert.match(routeSrc, /PERIODS = \['daily', 'weekly', 'monthly'\]/);
    assert.match(routeSrc, /ACTIONS = \['warn', 'pause_new_runs', 'hard_stop'\]/);
    assert.deepStrictEqual(BUDGET_SCOPES, ['agent', 'department', 'project', 'fleet']);
    assert.deepStrictEqual(BUDGET_PERIODS, ['daily', 'weekly', 'monthly']);
    assert.deepStrictEqual(BUDGET_ACTIONS, ['warn', 'pause_new_runs', 'hard_stop']);
  });

  await check('default export is the render function (view-adapter resolution)', () => {
    assert.strictEqual(typeof renderBudgetsView, 'function');
    assert.strictEqual(typeof mod.default, 'function');
  });

  const summary = `\n${passed} passed, ${failed} failed`;
  console.log(summary);
  if (failed > 0) process.exit(1);
})().catch(err => {
  console.error('❌ test crashed:', err);
  process.exit(1);
});
