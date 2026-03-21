#!/usr/bin/env python3
"""
system-improvement-engine.py

Executes a system improvement scan:
  1. Gathers current system state from dashboard APIs and local system
  2. Analyzes gaps, issues, and opportunities
  3. Creates approval-gated workflow runs for each actionable suggestion

Run standalone or triggered by dashboard workflow run.
"""

from __future__ import annotations

import json
import os
import sys
import urllib.error
import urllib.request
from datetime import datetime, timezone

API_BASE = os.environ.get("DASHBOARD_API_BASE", "http://127.0.0.1:3876").rstrip("/")


def api_get(path: str) -> dict | list:
    url = f"{API_BASE}{path}"
    try:
        req = urllib.request.Request(url)
        with urllib.request.urlopen(req, timeout=15) as resp:
            return json.loads(resp.read())
    except Exception as e:
        print(f"  [WARN] API GET {path} failed: {e}", file=sys.stderr)
        return {}


def api_post(path: str, body: dict) -> dict:
    url = f"{API_BASE}{path}"
    data = json.dumps(body).encode()
    try:
        req = urllib.request.Request(url, data=data, headers={"Content-Type": "application/json"})
        with urllib.request.urlopen(req, timeout=15) as resp:
            return json.loads(resp.read())
    except Exception as e:
        print(f"  [WARN] API POST {path} failed: {e}", file=sys.stderr)
        return {}


def gather_system_state() -> dict:
    """Collect current system state from all available sources."""
    state = {}

    # Workflow templates
    templates_data = api_get("/api/workflow-templates")
    templates = templates_data.get("templates", []) if isinstance(templates_data, dict) else templates_data
    state["templates"] = templates
    state["total_templates"] = len(templates)
    state["templates_with_contracts"] = sum(1 for t in templates if t.get("artifact_contract"))

    # Workflow runs
    runs_data = api_get("/api/workflow-runs?limit=200")
    runs = runs_data.get("workflow_runs", []) if isinstance(runs_data, dict) else runs_data
    state["total_runs"] = len(runs)
    state["runs_by_status"] = {}
    for r in runs:
        s = r.get("status", "unknown")
        state["runs_by_status"][s] = state["runs_by_status"].get(s, 0) + 1

    completed = [r for r in runs if r.get("status") == "completed"]
    state["completed_runs"] = len(completed)
    state["completed_with_artifacts"] = sum(1 for r in completed if (r.get("actual_artifact_count") or 0) > 0)
    state["completed_without_artifacts"] = len(completed) - state["completed_with_artifacts"]

    # Pending approvals
    approvals_data = api_get("/api/approvals/pending?limit=100")
    state["pending_approvals"] = len(approvals_data.get("approvals", []))

    # Stuck runs
    stuck_data = api_get("/api/workflow-runs/stuck")
    state["stuck_runs"] = stuck_data.get("workflow_runs", []) if isinstance(stuck_data, dict) else stuck_data

    # Active runs
    active_data = api_get("/api/workflow-runs/active?limit=50")
    state["active_runs"] = active_data.get("workflow_runs", []) if isinstance(active_data, dict) else active_data

    # Cron health (check log freshness)
    cron_logs = {
        "dashboard_health": "(path/to/openclaw)",
        "error_rate": "(path/to/openclaw)",
        "citation_improvement": "(path/to/openclaw)",
        "sync_gateway": "(path/to/openclaw)",
        "models_catalog": "(path/to/openclaw)",
    }
    import subprocess
    state["cron_health"] = {}
    for name, log_path in cron_logs.items():
        try:
            result = subprocess.run(
                ["stat", "-c", "%Y", log_path],
                capture_output=True, text=True, timeout=5
            )
            if result.returncode == 0:
                mtime = int(result.stdout.strip())
                age_hours = (datetime.now().timestamp() - mtime) / 3600
                state["cron_health"][name] = {
                    "log_exists": True,
                    "last_modified_hours_ago": round(age_hours, 1),
                    "healthy": age_hours < 2  # stale if > 2h
                }
            else:
                state["cron_health"][name] = {"log_exists": False, "healthy": False}
        except Exception:
            state["cron_health"][name] = {"log_exists": False, "healthy": False}

    # Templates without artifact contracts (improvement opportunity)
    state["templates_missing_contracts"] = [
        t["name"] for t in templates
        if not t.get("artifact_contract") and t.get("is_active", True)
    ]

    # Run type distribution
    state["runs_by_type"] = {}
    for r in runs:
        t = r.get("workflow_type", "unknown")
        state["runs_by_type"][t] = state["runs_by_type"].get(t, 0) + 1

    return state


def analyze_opportunities(state: dict) -> list[dict]:
    """Identify concrete improvement opportunities from system state."""
    suggestions = []

    # 1. Templates missing artifact contracts
    missing = state.get("templates_missing_contracts", [])
    if missing:
        suggestions.append({
            "category": "artifact_contracts",
            "priority": "low",
            "title": f"Add artifact contracts to {len(missing)} workflow templates",
            "description": (
                f"Templates without artifact_contract: {', '.join(missing[:5])}"
                f"{'...' if len(missing) > 5 else ''}. "
                f"Result: {state.get('completed_without_artifacts', 0)}/{state.get('completed_runs', 0)} "
                f"completed runs produced zero artifacts. Auto-extraction can't match outputs without contracts."
            ),
            "suggested_workflow": "code-change",
            "action_prompt": (
                "Review each template's steps and expected outputs. "
                "For each, define an artifact_contract with expected_outputs keys "
                "that map to URL fields the workflow produces (e.g. live_url, published_url). "
                "Update via PATCH /api/workflow-templates/:name."
            )
        })

    # 2. Failed runs
    failed = state.get("runs_by_status", {}).get("failed", 0)
    if failed > 0:
        suggestions.append({
            "category": "workflow_health",
            "priority": "high",
            "title": f"Investigate {failed} failed workflow run(s)",
            "description": f"There {'is' if failed == 1 else 'are'} {failed} failed run(s) that may need retry or root-cause analysis.",
            "suggested_workflow": "incident-investigation",
            "action_prompt": (
                "Fetch failed runs from /api/workflow-runs?status=failed. "
                "Review error output, determine if retryable, and create a fix plan."
            )
        })

    # 3. Stuck runs
    stuck = state.get("stuck_runs", [])
    if stuck:
        suggestions.append({
            "category": "workflow_health",
            "priority": "high",
            "title": f"Unblock {len(stuck)} stuck workflow run(s)",
            "description": f"Runs stuck or blocked: {json.dumps([{'id': r.get('id','?'), 'type': r.get('workflow_type','?'), 'blocker': r.get('blocker_description','')} for r in stuck[:3]])}",
            "suggested_workflow": "incident-investigation",
            "action_prompt": "Review blocker descriptions, determine if manual intervention or template fix is needed."
        })

    # 4. Cron health issues
    unhealthy_crons = [
        name for name, info in state.get("cron_health", {}).items()
        if not info.get("healthy", False)
    ]
    if unhealthy_crons:
        suggestions.append({
            "category": "cron_health",
            "priority": "medium",
            "title": f"Fix {len(unhealthy_crons)} stale/missing cron job(s)",
            "description": f"Cron jobs with stale logs (>2h) or missing logs: {', '.join(unhealthy_crons)}",
            "suggested_workflow": "host-hardening",
            "action_prompt": (
                f"Check crontab -l and verify each job runs. "
                f"Fix broken entries for: {', '.join(unhealthy_crons)}. "
                f"Check log files exist and are writable."
            )
        })

    # 5. High artifact-less completion rate
    total_completed = state.get("completed_runs", 0)
    no_art = state.get("completed_without_artifacts", 0)
    if total_completed > 3 and no_art / total_completed > 0.7:
        suggestions.append({
            "category": "workflow_output",
            "priority": "medium",
            "title": f"Improve artifact capture rate ({no_art}/{total_completed} runs with zero artifacts)",
            "description": (
                f"Most completed runs produce no artifacts. This means output_summary values "
                f"aren't being captured as trackable deliverables. Either: (a) agents need to return "
                f"URL values in their output, (b) artifact contracts need to be defined, or "
                f"(c) the auto-extraction logic needs to be broadened."
            ),
            "suggested_workflow": "code-change",
            "action_prompt": (
                "Audit recent completed runs' output_summary. Determine what values agents actually return. "
                "Update contracts and/or agent instructions to ensure URLs are included in output."
            )
        })

    # 6. Approval queue dry (system has no pending approvals but should)
    if state.get("pending_approvals", 0) == 0 and state.get("total_runs", 0) > 5:
        suggestions.append({
            "category": "approval_gaps",
            "priority": "low",
            "title": "Publishing and site-change runs bypass approval gates",
            "description": (
                "No pending approvals exist despite active workflow usage. "
                "Runs that modify websites (wordpress-publish, site-fix, code-change) "
                "should require operator approval before execution."
            ),
            "suggested_workflow": "code-change",
            "action_prompt": (
                "Review templates with required_approvals. Ensure wordpress-publish, site-fix, "
                "and code-change templates have approval steps. The system-improvement-scan "
                "template already creates approval-gated runs."
            )
        })

    return suggestions


def existing_approval_for(suggestion: dict) -> bool:
    """Check if a pending approval already exists for this suggestion category."""
    category = suggestion.get("category", "")
    title = suggestion.get("title", "")
    try:
        approvals = api_get("/api/approvals/pending?limit=100")
        existing = approvals.get("approvals", [])
        for a in existing:
            meta = a.get("metadata") or {}
            if meta.get("category") == category:
                return True
        # Also check runs with same workflow_type and waiting_for_approval status
        runs = api_get("/api/workflow-runs?limit=200")
        runs = runs.get("workflow_runs", []) if isinstance(runs, dict) else runs
        for r in runs:
            if r.get("status") == "waiting_for_approval":
                inp = r.get("inputPayload") or r.get("input_payload") or {}
                if inp.get("category") == category:
                    return True
    except Exception:
        pass
    return False


def create_approval_run(suggestion: dict, source_run_id: str = None) -> dict | None:
    """Create a workflow run with an approval gate for the suggestion."""
    # Dedup: skip if same category already has a pending approval
    if existing_approval_for(suggestion):
        print(f"  SKIP (duplicate): {suggestion['title']} — already pending")
        return None

    body = {
        "workflow_type": suggestion.get("suggested_workflow", "site-fix"),
        "title": suggestion["title"],
        "input_payload": {
            "source": "system-improvement-scan",
            "category": suggestion["category"],
            "priority": suggestion["priority"],
            "description": suggestion["description"],
            "action_prompt": suggestion["action_prompt"],
        },
        "priority": suggestion["priority"],
        "auto_start": False,  # Must be approved first
    }

    result = api_post("/api/workflow-runs", body)
    run_id = result.get("id")

    if not run_id:
        print(f"  [FAIL] Could not create run for: {suggestion['title']}", file=sys.stderr)
        return None

    # Create approval gate
    approval_body = {
        "step_name": "operator_review",
        "approver_id": "dashboard-operator",
        "requested_by": "system-improvement-scan",
        "approval_type": "improvement_suggestion",
        "metadata": {
            "category": suggestion["category"],
            "priority": suggestion["priority"],
            "suggested_workflow": suggestion.get("suggested_workflow"),
            "action_prompt": suggestion["action_prompt"],
        },
        "required_note": False,
    }
    approval = api_post(f"/api/workflow-runs/{run_id}/approvals", approval_body)

    print(f"  Created run {run_id} with approval gate: {suggestion['title']}")
    return result


def main():
    print("=" * 60)
    print(f"System Improvement Scan — {datetime.now(timezone.utc).isoformat()}")
    print("=" * 60)

    # Step 1: Gather state
    print("\n[1/3] Gathering system state...")
    state = gather_system_state()

    print(f"  Templates: {state['total_templates']} ({state['templates_with_contracts']} with artifact contracts)")
    print(f"  Runs: {state['total_runs']} total, {state['completed_runs']} completed")
    print(f"  Artifacts: {state['completed_with_artifacts']} with, {state['completed_without_artifacts']} without")
    print(f"  Pending approvals: {state['pending_approvals']}")
    print(f"  Stuck runs: {len(state.get('stuck_runs', []))}")

    # Step 2: Analyze
    print("\n[2/3] Analyzing opportunities...")
    suggestions = analyze_opportunities(state)
    print(f"  Found {len(suggestions)} suggestion(s)")

    for i, s in enumerate(suggestions, 1):
        print(f"    {i}. [{s['priority']}] {s['title']}")

    if not suggestions:
        print("\n  No actionable suggestions this scan. System looks healthy.")
        return

    # Step 3: Create approval-gated runs
    print("\n[3/3] Creating approval-gated runs...")
    created = 0
    for s in suggestions:
        result = create_approval_run(s)
        if result:
            created += 1

    print(f"\n  Created {created}/{len(suggestions)} approval-gated runs")
    print("  → Review in Dashboard Approvals view")
    print("=" * 60)

    # Return summary for workflow output
    summary = {
        "suggestions_count": len(suggestions),
        "approval_runs_created": created,
        "scan_summary": f"Scan complete: {len(suggestions)} suggestions, {created} approval runs created",
        "suggestions": [
            {"category": s["category"], "priority": s["priority"], "title": s["title"]}
            for s in suggestions
        ],
    }
    print(f"\nSUMMARY_JSON: {json.dumps(summary)}")


if __name__ == "__main__":
    main()
