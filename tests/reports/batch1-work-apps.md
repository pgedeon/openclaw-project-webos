# Batch 1: Work Apps Test Report

## Summary
- Apps tested: 9
- Total tests: 77
- Passed: 67
- Failed: 10

## Failures
- [Tasks — API] GET /api/tasks → 200: The expression evaluated to a falsy value:

  assert.ok(Array.isArray(r.data))

- [Tasks — API] POST /api/tasks → creates task: Expected values to be strictly equal:

400 !== 200

- [Tasks — Browser UI] Tasks: renders content (not blank): Tasks window is blank
- [Board — API] GET /api/views/board → 200: Expected values to be strictly equal:

400 !== 200

- [Board — API] Board: no console errors: Errors: Failed to load resource: the server responded with a status of 401 (Unauthorized)

1 !== 0

- [Timeline — API] GET /api/views/timeline → 200: Expected values to be strictly equal:

400 !== 200

- [Timeline — API] Timeline: no console errors: Errors: Failed to load resource: the server responded with a status of 401 (Unauthorized)

1 !== 0

- [Agents — API] Agents: renders content (not blank): Agents window is blank
- [Sessions — API] GET /api/oc/sessions → 200: The expression evaluated to a falsy value:

  assert.ok(Array.isArray(r.data))

- [Approvals — API] Approvals: renders content (not blank): Approvals window is blank

## Details

All 9 Work apps tested: Tasks (full CRUD), Board, Timeline, Agents, Sessions, Requests, Publish, Approvals, Artifacts.
