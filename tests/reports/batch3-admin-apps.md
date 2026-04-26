# Batch 3: Admin Apps Test Report

## Summary
- Apps tested: 8
- Total tests: 72
- Passed: 66
- Failed: 6

## Failures
- [App: Departments — Static Analysis] Departments: renders content: The expression evaluated to a falsy value:

  assert.ok(hasContent)

- [Explorer — Filesystem API] Explorer: no console errors: Failed to load resource: the server responded with a status of 401 (Unauthorized)

1 !== 0

- [App: Skills & Tools — Static Analysis] Skills & Tools: no console errors: Failed to load resource: the server responded with a status of 401 (Unauthorized)

1 !== 0

- [Workflows — API] GET /api/views → 200: Expected values to be strictly equal:

400 !== 200

- [Workflows — API] Workflows: renders content: The expression evaluated to a falsy value:

  assert.ok(hasContent)

- [Bing Webmaster — API] POST /api/bing/indexnow → validates: The expression evaluated to a falsy value:

  assert.ok(r.status === 200)


## Details

All 8 Admin apps tested: Departments, Explorer, Notepad, Skills & Tools, Workflows, Operations, Bing Webmaster, Settings.
