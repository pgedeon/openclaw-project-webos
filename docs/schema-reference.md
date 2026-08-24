# Database Schema Reference

## Overview

The OpenClaw Dashboard uses PostgreSQL 13+ with the `uuid-ossp` extension. The schema is defined in `schema/openclaw-dashboard.sql` and extended through 21 migration files in `schema/migrations/`.

---

## Tables by Functional Area

### Core: Projects & Workflows

#### `workflows`

Defines the state machine (pipeline) for tasks.

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `id` | `UUID` | PK, default `uuid_generate_v4()` | |
| `name` | `TEXT` | NOT NULL | Workflow name |
| `states` | `TEXT[]` | NOT NULL | Ordered array of state names |
| `is_default` | `BOOLEAN` | NOT NULL, default `false` | Whether this is the default workflow |
| `project_id` | `UUID` | FK → `projects(id)` ON DELETE CASCADE, nullable | Project scope (NULL = global) |
| `created_at` | `TIMESTAMPTZ` | NOT NULL, default `NOW()` | |
| `updated_at` | `TIMESTAMPTZ` | NOT NULL, default `NOW()` | Auto-updated via trigger |

#### `projects`

Container for tasks with configuration.

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `id` | `UUID` | PK, default `uuid_generate_v4()` | |
| `name` | `TEXT` | NOT NULL | Project name |
| `description` | `TEXT` | NOT NULL, default `''` | |
| `status` | `TEXT` | NOT NULL, default `'active'` | `active`, `paused`, `archived` |
| `tags` | `TEXT[]` | NOT NULL, default `'{}'` | |
| `default_workflow_id` | `UUID` | FK → `workflows(id)`, NOT NULL | Default workflow for tasks |
| `metadata` | `JSONB` | NOT NULL, default `'{}'` | |
| `qmd_project_namespace` | `TEXT` | NOT NULL, UNIQUE | QMD namespace identifier |
| `created_at` | `TIMESTAMPTZ` | NOT NULL, default `NOW()` | |
| `updated_at` | `TIMESTAMPTZ` | NOT NULL, default `NOW()` | Auto-updated via trigger |

**Indexes:** GIN on `tags`, GIN on `metadata`

---

### Core: Tasks

#### `tasks`

The primary work items.

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `id` | `UUID` | PK, default `uuid_generate_v4()` | |
| `project_id` | `UUID` | FK → `projects(id)` ON DELETE CASCADE, NOT NULL | |
| `title` | `TEXT` | NOT NULL | Task title |
| `description` | `TEXT` | NOT NULL, default `''` | |
| `status` | `TEXT` | NOT NULL, default `'backlog'` | See status values below |
| `priority` | `TEXT` | NOT NULL, default `'medium'` | `low`, `medium`, `high`, `critical` |
| `owner` | `TEXT` | nullable | Agent name or human identifier |
| `due_date` | `DATE` | nullable | |
| `start_date` | `DATE` | nullable | |
| `estimated_effort` | `NUMERIC` | nullable | Hours or story points |
| `actual_effort` | `NUMERIC` | nullable | |
| `parent_task_id` | `UUID` | FK → `tasks(id)` ON DELETE CASCADE, nullable | Parent for subtasks |
| `dependency_ids` | `UUID[]` | NOT NULL, default `'{}'` | Array of blocking task IDs |
| `labels` | `TEXT[]` | NOT NULL, default `'{}'` | |
| `created_at` | `TIMESTAMPTZ` | NOT NULL, default `NOW()` | |
| `updated_at` | `TIMESTAMPTZ` | NOT NULL, default `NOW()` | Auto-updated via trigger |
| `completed_at` | `TIMESTAMPTZ` | nullable | |
| `recurrence_rule` | `TEXT` | nullable | Cron-like syntax |
| `metadata` | `JSONB` | NOT NULL, default `'{}'` | |
| `execution_lock` | `TIMESTAMPTZ` | nullable | Lock timestamp |
| `execution_locked_by` | `TEXT` | nullable | Agent holding lock |
| `blocker_type` | `TEXT` | nullable | *(004)* `waiting_on_agent`, `waiting_on_approval`, `waiting_on_external_service`, `content_failed_qa`, `other` |
| `blocker_description` | `TEXT` | nullable | *(004)* Free-text blocker details |
| `active_workflow_run_id` | `UUID` | FK → `workflow_runs(id)` ON DELETE SET NULL, nullable | *(001)* Linked workflow run |
| `archived_at` | `TIMESTAMPTZ` | nullable | *(20260216)* Soft archive timestamp |
| `deleted_at` | `TIMESTAMPTZ` | nullable | *(20260216)* Soft delete timestamp |
| `retry_count` | `INTEGER` | NOT NULL, default `0` | *(20260216)* Quick-access retry counter |

**Constraints:**

```sql
valid_priority    CHECK (priority IN ('low', 'medium', 'high', 'critical'))
tasks_status_check CHECK (status IN (
  -- Original
  'backlog', 'ready', 'archived', 'review', 'completed', 'in_progress', 'blocked',
  -- Content workflow queues (002)
  'topic_candidate', 'drafting', 'image_pending', 'image_ready',
  'qa_pending', 'ready_to_publish', 'published',
  -- Generic (002)
  'retrying', 'failed', 'cancelled'
))
```

**Indexes:**

| Index | Columns | Type |
|-------|---------|------|
| `idx_tasks_project_id` | `project_id` | B-tree |
| `idx_tasks_parent_task_id` | `parent_task_id` | B-tree |
| `idx_tasks_status` | `status` | B-tree |
| `idx_tasks_owner` | `owner` | B-tree |
| `idx_tasks_due_date` | `due_date` | B-tree |
| `idx_tasks_priority` | `priority` | B-tree |
| `idx_tasks_project_status` | `project_id, status` | B-tree |
| `idx_tasks_completed_at` | `completed_at` | B-tree |
| `idx_tasks_dependency_ids` | `dependency_ids` | GIN |
| `idx_tasks_labels` | `labels` | GIN |
| `idx_tasks_metadata` | `metadata` | GIN |
| `idx_tasks_active_workflow_run_id` | `active_workflow_run_id` | B-tree *(001)* |
| `idx_tasks_blocker_type` | `blocker_type` | B-tree *(004)* |
| `idx_tasks_status_archived` | `status, archived_at` | B-tree *(20260216)* |
| `idx_tasks_deleted_at` | `deleted_at` | B-tree *(20260216)* |
| `idx_tasks_updated_at` | `updated_at` | B-tree *(20260216)* |

---

### Audit

#### `audit_log`

Tracks all significant changes to tasks.

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `id` | `UUID` | PK, default `uuid_generate_v4()` | |
| `task_id` | `UUID` | FK → `tasks(id)` ON DELETE CASCADE, nullable | Nullable for system-level entries |
| `actor` | `TEXT` | NOT NULL | User or agent name |
| `action` | `TEXT` | NOT NULL | `create`, `update`, `delete`, `claim`, `release`, `move`, `import`, etc. |
| `old_value` | `JSONB` | nullable | Field snapshot before change |
| `new_value` | `JSONB` | nullable | Field snapshot after change |
| `timestamp` | `TIMESTAMPTZ` | NOT NULL, default `NOW()` | |
| `entity_type` | `TEXT` | default `'task'` | Entity type for non-task audit entries |
| `correlation_id` | `UUID` | nullable | Groups related changes |

**Indexes:** `task_id`, `timestamp`, `actor`, `action` *(20260216)*, `(actor, action)` *(20260216)*

---

### Workflow Engine

#### `workflow_runs`

Tracks execution instances of workflows.

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `id` | `UUID` | PK, default `uuid_generate_v4()` | |
| `board_id` | `UUID` | FK → `projects(id)` ON DELETE CASCADE, nullable | |
| `task_id` | `UUID` | FK → `tasks(id)` ON DELETE CASCADE, nullable | |
| `workflow_type` | `TEXT` | NOT NULL | e.g., `affiliate-article`, `code-change` |
| `owner_agent_id` | `TEXT` | NOT NULL | Agent name |
| `initiator` | `TEXT` | nullable | Who/what started the run |
| `status` | `TEXT` | NOT NULL, default `'queued'` | See status values below |
| `current_step` | `TEXT` | nullable | Current step name |
| `started_at` | `TIMESTAMPTZ` | nullable | |
| `finished_at` | `TIMESTAMPTZ` | nullable | |
| `last_heartbeat_at` | `TIMESTAMPTZ` | nullable | Agent heartbeat |
| `retry_count` | `INTEGER` | NOT NULL, default `0` | |
| `max_retries` | `INTEGER` | NOT NULL, default `3` | |
| `last_error` | `TEXT` | nullable | |
| `last_error_at` | `TIMESTAMPTZ` | nullable | |
| `input_payload` | `JSONB` | NOT NULL, default `'{}'` | Task parameters |
| `output_summary` | `JSONB` | NOT NULL, default `'{}'` | Results, artifacts, URLs |
| `gateway_session_id` | `TEXT` | nullable | Linked gateway session |
| `gateway_session_active` | `BOOLEAN` | NOT NULL, default `false` | |
| `created_at` | `TIMESTAMPTZ` | NOT NULL, default `NOW()` | |
| `updated_at` | `TIMESTAMPTZ` | NOT NULL, default `NOW()` | |
| `error_details` | `JSONB` | default `'{}'` | *(020)* Structured error info |
| `service_request_id` | `UUID` | FK → `service_requests(id)` ON DELETE SET NULL, nullable | *(011)* |
| `department_id` | `UUID` | FK → `departments(id)` ON DELETE SET NULL, nullable | *(011)* |
| `run_priority` | `TEXT` | nullable | *(011)* |
| `approval_state` | `TEXT` | nullable | *(011)* |
| `outcome_code` | `TEXT` | nullable | *(011)* |
| `operator_notes` | `TEXT` | nullable | *(011)* |
| `expected_artifact_count` | `INTEGER` | NOT NULL, default `0` | *(011)* |
| `actual_artifact_count` | `INTEGER` | NOT NULL, default `0` | *(011)* |
| `value_score` | `NUMERIC` | nullable | *(011)* |
| `customer_scope` | `TEXT` | nullable | *(011)* |
| `blocker_detected_at` | `TIMESTAMPTZ` | nullable | *(014)* |
| `blocker_source` | `TEXT` | nullable | *(014)* `manual`, `detector`, `operator` |
| `blocker_metadata` | `JSONB` | NOT NULL, default `'{}'` | *(014)* |
| `escalation_status` | `TEXT` | nullable | *(014)* `escalated`, `acknowledged`, `resolved` |
| `escalated_at` | `TIMESTAMPTZ` | nullable | *(014)* |
| `escalated_to` | `TEXT` | nullable | *(014)* |
| `escalation_reason` | `TEXT` | nullable | *(014)* |
| `paused_at` | `TIMESTAMPTZ` | nullable | *(014)* Operator pause |
| `paused_by` | `TEXT` | nullable | *(014)* |
| `pause_reason` | `TEXT` | nullable | *(014)* |
| `resumed_at` | `TIMESTAMPTZ` | nullable | *(014)* |
| `resumed_by` | `TEXT` | nullable | *(014)* |
| `dispatched_at` | `TIMESTAMPTZ` | nullable | *(021)* |
| `claimed_at` | `TIMESTAMPTZ` | nullable | *(021)* |
| `claimed_by` | `TEXT` | nullable | *(021)* |
| `claim_session_id` | `TEXT` | nullable | *(021)* |
| `dispatch_attempts` | `INTEGER` | NOT NULL, default `0` | *(021)* |
| `input_tokens` | `BIGINT` | nullable | *(022)* Prompt/input tokens consumed by the run |
| `output_tokens` | `BIGINT` | nullable | *(022)* Completion/output tokens produced by the run |
| `cached_tokens` | `BIGINT` | nullable | *(022)* Tokens served from cache (subset of input) |
| `model_id` | `TEXT` | nullable | *(022)* Primary model used for this run |
| `cost_estimate` | `NUMERIC(12,6)` | nullable | *(022)* Estimated cost of the run |
| `currency` | `TEXT` | default `'USD'` | *(022)* ISO 4217 currency code for `cost_estimate` |
| `reported_at` | `TIMESTAMPTZ` | nullable | *(022)* When usage/cost was last reported |
| `blocker_type` | `TEXT` | nullable | *(004)* |
| `blocker_description` | `TEXT` | nullable | *(004)* |

**Constraint:**

```sql
valid_workflow_run_status CHECK (status IN (
  'queued', 'dispatched', 'claimed', 'running',
  'waiting_for_approval', 'blocked', 'retrying',
  'completed', 'failed', 'cancelled', 'timed_out'
))
```

**Indexes:** `board_id`, `task_id`, `owner_agent_id`, `status`, `workflow_type`, `started_at`, `last_heartbeat_at`, `gateway_session_id`, GIN on `input_payload`, GIN on `output_summary`, GIN on `error_details`, `(status, dispatched_at)`, `(status, last_heartbeat_at)`, `claim_session_id`, `blocker_detected_at`, `escalation_status`, `escalated_to`, `paused_at`

#### `workflow_steps`

Individual steps within a workflow run.

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `id` | `UUID` | PK, default `uuid_generate_v4()` | |
| `workflow_run_id` | `UUID` | FK → `workflow_runs(id)` ON DELETE CASCADE, NOT NULL | |
| `step_name` | `TEXT` | NOT NULL | |
| `step_order` | `INTEGER` | NOT NULL | |
| `status` | `TEXT` | NOT NULL, default `'pending'` | `pending`, `in_progress`, `completed`, `failed`, `skipped` |
| `started_at` | `TIMESTAMPTZ` | nullable | |
| `finished_at` | `TIMESTAMPTZ` | nullable | |
| `output` | `JSONB` | NOT NULL, default `'{}'` | |
| `error_message` | `TEXT` | nullable | |
| `created_at` | `TIMESTAMPTZ` | NOT NULL, default `NOW()` | |
| `updated_at` | `TIMESTAMPTZ` | NOT NULL, default `NOW()` | |

**Indexes:** `workflow_run_id`, `status`, `step_order`

#### `workflow_templates`

Reusable workflow definitions.

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `id` | `UUID` | PK, default `uuid_generate_v4()` | |
| `name` | `TEXT` | UNIQUE, NOT NULL | e.g., `affiliate-article` |
| `display_name` | `TEXT` | NOT NULL | Human-readable name |
| `description` | `TEXT` | NOT NULL, default `''` | |
| `default_owner_agent` | `TEXT` | NOT NULL | Default agent for runs |
| `steps` | `JSONB` | NOT NULL, default `'[]'` | Ordered step definitions |
| `required_approvals` | `JSONB` | NOT NULL, default `'[]'` | Steps needing approval |
| `success_criteria` | `JSONB` | NOT NULL, default `'{}'` | Completion criteria |
| `category` | `TEXT` | NOT NULL, default `'general'` | `content`, `publishing`, `maintenance`, `incident`, `development`, `quality` |
| `is_active` | `BOOLEAN` | NOT NULL, default `true` | |
| `department_id` | `UUID` | FK → `departments(id)` ON DELETE SET NULL, nullable | *(011)* |
| `service_id` | `UUID` | FK → `service_catalog(id)` ON DELETE SET NULL, nullable | *(011)* |
| `input_schema` | `JSONB` | NOT NULL, default `'{}'` | *(011)* |
| `artifact_contract` | `JSONB` | NOT NULL, default `'{}'` | *(011)* |
| `blocker_policy` | `JSONB` | NOT NULL, default `'{}'` | *(011)* |
| `escalation_policy` | `JSONB` | NOT NULL, default `'{}'` | *(011)* |
| `runbook_ref` | `TEXT` | nullable | *(011)* |
| `ui_category` | `TEXT` | NOT NULL, default `'general'` | *(011)* |
| `created_at` | `TIMESTAMPTZ` | NOT NULL, default `NOW()` | |
| `updated_at` | `TIMESTAMPTZ` | NOT NULL, default `NOW()` | |

**Indexes:** `category`, `is_active`, `department_id`, `service_id`, `ui_category`

#### `workflow_artifacts`

Trackable deliverables produced by workflow runs.

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `id` | `UUID` | PK, default `uuid_generate_v4()` | |
| `workflow_run_id` | `UUID` | FK → `workflow_runs(id)` ON DELETE CASCADE, NOT NULL | |
| `task_id` | `UUID` | FK → `tasks(id)` ON DELETE SET NULL, nullable | |
| `artifact_type` | `TEXT` | NOT NULL | e.g., `image`, `published_url`, `draft` |
| `label` | `TEXT` | NOT NULL | |
| `uri` | `TEXT` | NOT NULL | URL or path |
| `mime_type` | `TEXT` | nullable | |
| `status` | `TEXT` | NOT NULL, default `'generated'` | `generated`, `attached`, `approved`, `rejected`, `archived` |
| `metadata` | `JSONB` | NOT NULL, default `'{}'` | |
| `created_by` | `TEXT` | nullable | |
| `created_at` | `TIMESTAMPTZ` | NOT NULL, default `NOW()` | |
| `updated_at` | `TIMESTAMPTZ` | NOT NULL, default `NOW()` | |

**Indexes:** `workflow_run_id`, `task_id`, `artifact_type`, `status`, `created_by`, `created_at DESC`

#### `workflow_approvals`

Approval gates for workflow steps.

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `id` | `UUID` | PK, default `uuid_generate_v4()` | |
| `workflow_run_id` | `UUID` | FK → `workflow_runs(id)` ON DELETE CASCADE, NOT NULL | |
| `step_name` | `TEXT` | NOT NULL | Workflow step requiring approval |
| `approver_id` | `TEXT` | NOT NULL | User or agent who should approve |
| `status` | `TEXT` | NOT NULL, default `'pending'` | `pending`, `approved`, `rejected`, `cancelled` |
| `decision` | `TEXT` | nullable | Notes from approver |
| `decided_at` | `TIMESTAMPTZ` | nullable | |
| `requested_by` | `TEXT` | NOT NULL | Requester |
| `requested_at` | `TIMESTAMPTZ` | NOT NULL, default `NOW()` | |
| `metadata` | `JSONB` | NOT NULL, default `'{}'` | |
| `approval_type` | `TEXT` | NOT NULL, default `'step_gate'` | *(013)* |
| `artifact_id` | `UUID` | FK → `workflow_artifacts(id)` ON DELETE SET NULL, nullable | *(013)* |
| `due_at` | `TIMESTAMPTZ` | nullable | *(013)* |
| `expires_at` | `TIMESTAMPTZ` | nullable | *(013)* |
| `escalated_at` | `TIMESTAMPTZ` | nullable | *(013)* |
| `escalated_to` | `TEXT` | nullable | *(013)* |
| `escalation_reason` | `TEXT` | nullable | *(013)* |
| `required_note` | `BOOLEAN` | NOT NULL, default `true` | *(013)* |
| `decided_by` | `TEXT` | nullable | *(013)* |
| `created_at` | `TIMESTAMPTZ` | NOT NULL, default `NOW()` | |
| `updated_at` | `TIMESTAMPTZ` | NOT NULL, default `NOW()` | |

**Indexes:** `workflow_run_id`, `status`, `approver_id`, `artifact_id`, `due_at`, `expires_at`, `escalated_to`

#### `workflow_agent_routing`

Maps workflow types to agents for dispatching. *(021)*

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `workflow_type` | `VARCHAR(100)` | PK | Workflow type name |
| `agent_id` | `VARCHAR(100)` | NOT NULL | Target agent |
| `priority` | `INTEGER` | NOT NULL, default `0` | Routing priority |
| `max_concurrent` | `INTEGER` | NOT NULL, default `1` | Concurrent run limit |
| `timeout_minutes` | `INTEGER` | NOT NULL, default `60` | Run timeout |
| `created_at` | `TIMESTAMPTZ` | NOT NULL, default `NOW()` | |

**Indexes:** `agent_id`, `priority DESC`

---

### Organization

#### `departments`

Organizational groups for agents and workflows. *(006)*

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `id` | `UUID` | PK, default `gen_random_uuid()` | |
| `name` | `VARCHAR(255)` | UNIQUE, NOT NULL | |
| `description` | `TEXT` | nullable | |
| `color` | `VARCHAR(7)` | default `'#6366f1'` | Hex color for UI |
| `icon` | `VARCHAR(50)` | default `'folder'` | Lucide icon name |
| `sort_order` | `INTEGER` | default `0` | |
| `is_active` | `BOOLEAN` | default `true` | |
| `metadata` | `JSONB` | default `'{}'` | |
| `created_at` | `TIMESTAMPTZ` | default `NOW()` | |
| `updated_at` | `TIMESTAMPTZ` | default `NOW()` | |

**Indexes:** `sort_order`, `is_active`

#### `agent_profiles`

Agent definitions linked to departments. *(007)*

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `id` | `UUID` | PK, default `gen_random_uuid()` | |
| `agent_id` | `VARCHAR(255)` | UNIQUE, NOT NULL | Matches `openclaw.json` agent.id |
| `department_id` | `UUID` | FK → `departments(id)` ON DELETE SET NULL, nullable | |
| `display_name` | `VARCHAR(255)` | NOT NULL | |
| `role` | `VARCHAR(100)` | nullable | `orchestrator`, `specialist`, `pipeline` |
| `model_primary` | `VARCHAR(255)` | nullable | Primary model from openclaw.json |
| `capabilities` | `JSONB` | default `'[]'` | e.g., `["coding", "vision"]` |
| `status` | `VARCHAR(50)` | default `'active'` | `active`, `inactive`, `deprecated` |
| `workspace_path` | `TEXT` | nullable | Agent workspace directory |
| `metadata` | `JSONB` | default `'{}'` | |
| `last_heartbeat` | `TIMESTAMPTZ` | nullable | |
| `created_at` | `TIMESTAMPTZ` | default `NOW()` | |
| `updated_at` | `TIMESTAMPTZ` | default `NOW()` | |

**Indexes:** `agent_id`, `department_id`, `status`

---

### Service Catalog

#### `service_catalog`

Available service types that can be requested. *(008)*

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `id` | `UUID` | PK, default `gen_random_uuid()` | |
| `name` | `VARCHAR(255)` | NOT NULL | |
| `slug` | `VARCHAR(100)` | UNIQUE, NOT NULL | URL-friendly identifier |
| `description` | `TEXT` | nullable | |
| `department_id` | `UUID` | FK → `departments(id)` ON DELETE SET NULL, nullable | |
| `default_agent_id` | `VARCHAR(255)` | nullable | |
| `workflow_template_id` | `UUID` | nullable | FK → `workflow_templates(id)` |
| `intake_fields` | `JSONB` | default `'[]'` | Form field definitions |
| `sla_hours` | `INTEGER` | default `72` | Service level agreement |
| `is_active` | `BOOLEAN` | default `true` | |
| `sort_order` | `INTEGER` | default `0` | |
| `metadata` | `JSONB` | default `'{}'` | |
| `created_at` | `TIMESTAMPTZ` | default `NOW()` | |
| `updated_at` | `TIMESTAMPTZ` | default `NOW()` | |

**Indexes:** `slug`, `department_id`, `is_active`

#### `service_requests`

Individual service requests. *(009)*

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `id` | `UUID` | PK, default `gen_random_uuid()` | |
| `service_id` | `UUID` | FK → `service_catalog(id)` ON DELETE CASCADE, NOT NULL | |
| `project_id` | `UUID` | FK → `projects(id)` ON DELETE SET NULL, nullable | |
| `task_id` | `UUID` | FK → `tasks(id)` ON DELETE SET NULL, nullable | |
| `requested_by` | `VARCHAR(255)` | NOT NULL | |
| `requested_for` | `VARCHAR(255)` | nullable | |
| `title` | `TEXT` | NOT NULL | |
| `description` | `TEXT` | default `''` | |
| `status` | `VARCHAR(50)` | NOT NULL, default `'new'` | `new`, `triaged`, `planned`, `running`, `waiting_for_approval`, `blocked`, `completed`, `failed`, `cancelled` |
| `priority` | `VARCHAR(50)` | NOT NULL, default `'medium'` | `low`, `medium`, `high`, `critical` |
| `target_department_id` | `UUID` | FK → `departments(id)` ON DELETE SET NULL, nullable | |
| `target_agent_id` | `VARCHAR(255)` | nullable | |
| `input_payload` | `JSONB` | default `'{}'` | |
| `routing_decision` | `JSONB` | default `'{}'` | |
| `created_at` | `TIMESTAMPTZ` | default `NOW()` | |
| `updated_at` | `TIMESTAMPTZ` | default `NOW()` | |

**Indexes:** `service_id`, `status`, `priority`, `target_department_id`, `target_agent_id`, `project_id`, `created_at DESC`

---

### Metrics

#### `department_daily_metrics`

Daily KPI snapshots per department. *(015)*

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `id` | `UUID` | PK, default `gen_random_uuid()` | |
| `department_id` | `UUID` | FK → `departments(id)` ON DELETE CASCADE, NOT NULL | |
| `metric_date` | `DATE` | NOT NULL | |
| `metrics` | `JSONB` | NOT NULL, default `'{}'` | Structured scorecard payload |
| `created_at` | `TIMESTAMPTZ` | NOT NULL, default `NOW()` | |
| `updated_at` | `TIMESTAMPTZ` | NOT NULL, default `NOW()` | |

**Unique:** `(department_id, metric_date)`
**Indexes:** `department_id`, `metric_date DESC`

---

### Observability

#### `agent_heartbeats`

Agent liveness tracking. *(20260216)*

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `agent_name` | `TEXT` | PK | |
| `last_seen_at` | `TIMESTAMPTZ` | NOT NULL, default `NOW()` | |
| `status` | `TEXT` | NOT NULL, default `'online'` | `online`, `offline`, `error` |
| `metadata` | `JSONB` | NOT NULL, default `'{}'` | |

**Index:** `last_seen_at`

#### `task_runs`

Execution attempt log for agent observability. *(20260216)*

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `id` | `UUID` | PK, default `uuid_generate_v4()` | |
| `task_id` | `UUID` | FK → `tasks(id)` ON DELETE CASCADE, NOT NULL | |
| `agent_name` | `TEXT` | NOT NULL | |
| `attempt_number` | `INTEGER` | NOT NULL | |
| `status` | `TEXT` | NOT NULL | `pending`, `running`, `success`, `failure` |
| `started_at` | `TIMESTAMPTZ` | NOT NULL, default `NOW()` | |
| `completed_at` | `TIMESTAMPTZ` | nullable | |
| `error_summary` | `TEXT` | nullable | |
| `output_summary` | `TEXT` | nullable | |

**Indexes:** `task_id`, `agent_name`, `started_at DESC`, `(task_id, agent_name, attempt_number)`

#### `cron_job_runs`

Cron job execution history. *(20260216)*

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `id` | `UUID` | PK, default `uuid_generate_v4()` | |
| `job_id` | `TEXT` | NOT NULL | |
| `started_at` | `TIMESTAMPTZ` | NOT NULL, default `NOW()` | |
| `finished_at` | `TIMESTAMPTZ` | nullable | |
| `exit_code` | `INTEGER` | nullable | |
| `output` | `TEXT` | nullable | |
| `status` | `TEXT` | NOT NULL, default `'running'` | `running`, `success`, `failure` |
| `duration_ms` | `INTEGER` | nullable | |
| `created_at` | `TIMESTAMPTZ` | NOT NULL, default `NOW()` | |

**Indexes:** `job_id`, `started_at DESC`, `status`

---

### Saved Views

#### `saved_views`

User-saved filter/sort combinations. *(20260216)*

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `id` | `UUID` | PK, default `uuid_generate_v4()` | |
| `project_id` | `UUID` | FK → `projects(id)` ON DELETE CASCADE, NOT NULL | |
| `name` | `TEXT` | NOT NULL | |
| `filters` | `JSONB` | NOT NULL, default `'{}'` | |
| `sort` | `TEXT` | nullable | |
| `created_by` | `TEXT` | NOT NULL | |
| `created_at` | `TIMESTAMPTZ` | NOT NULL, default `NOW()` | |
| `updated_at` | `TIMESTAMPTZ` | NOT NULL, default `NOW()` | |

**Indexes:** `project_id`, `created_by`

---

### Migration Tracking

#### `schema_migrations`

Records which migrations have been applied. *(005)*

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `id` | `SERIAL` | PK | |
| `migration_name` | `TEXT` | UNIQUE, NOT NULL | Migration file name |
| `applied_at` | `TIMESTAMPTZ` | NOT NULL, default `NOW()` | |
| `checksum` | `TEXT` | nullable | |

---

## Views

| View | Purpose |
|------|---------|
| `task_graph` | Tasks with project info, filtered to active projects |
| `blocked_tasks` | Tasks with unmet dependencies |
| `active_workflow_runs` | In-progress runs with task/project context and timing |
| `stuck_workflow_runs` | Runs that are stale, session-inactive, or max-retries-exceeded |

---

## Triggers

All tables with `updated_at` columns have auto-update triggers:

| Trigger | Table | Function |
|---------|-------|----------|
| `update_projects_updated_at` | `projects` | `update_updated_at_column()` |
| `update_tasks_updated_at` | `tasks` | `update_updated_at_column()` |
| `update_workflows_updated_at` | `workflows` | `update_updated_at_column()` |
| `update_workflow_runs_updated_at` | `workflow_runs` | `update_updated_at_column()` |
| `update_workflow_steps_updated_at` | `workflow_steps` | `update_updated_at_column()` |
| `update_workflow_templates_updated_at` | `workflow_templates` | `update_updated_at_column()` |
| `update_workflow_approvals_updated_at` | `workflow_approvals` | `update_updated_at_column()` |
| `update_workflow_artifacts_updated_at` | `workflow_artifacts` | `update_updated_at_column()` |
| `update_saved_views_updated_at` | `saved_views` | `update_saved_views_updated_at()` |
| `update_department_daily_metrics_updated_at` | `department_daily_metrics` | `update_department_daily_metrics_updated_at()` |

---

## Time Travel

#### `state_snapshots`

Records full entity state at each mutation for point-in-time recovery and undo.

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `id` | `UUID` | PK, default `uuid_generate_v4()` | |
| `entity_type` | `TEXT` | NOT NULL | `'task'`, `'project'`, `'workflow'`, `'view'`, `'setting'`, `'system'` |
| `entity_id` | `UUID` | NOT NULL | Entity UUID |
| `action` | `TEXT` | NOT NULL | `create`, `update`, `delete`, `move`, `archive`, `restore`, `revert`, `import` |
| `state` | `JSONB` | NOT NULL | Full entity state at this point |
| `actor` | `TEXT` | NOT NULL, default `'system'` | Who made the change |
| `correlation_id` | `UUID` | nullable | Links related snapshots |
| `created_at` | `TIMESTAMPTZ` | NOT NULL, default `NOW()` | |

**Indexes:** `(entity_type, entity_id)`, `created_at DESC`, `action`, `correlation_id`

---

## Spaces / Workspaces

#### `workspaces` (extended)

Multi-workspace support with per-space configuration.

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `id` | `UUID` | PK, default `gen_random_uuid()` | |
| `name` | `VARCHAR(255)` | NOT NULL | Display name |
| `slug` | `VARCHAR(100)` | NOT NULL, UNIQUE | URL-safe identifier |
| `icon` | `TEXT` | default `'📁'` | Emoji icon |
| `color` | `TEXT` | default `'#0078d4'` | Brand color |
| `description` | `TEXT` | default `''` | What the space is for |
| `settings` | `JSONB` | default `'{}'` | Per-space settings |
| `is_default` | `BOOLEAN` | default `false` | Cannot be deleted |
| `sort_order` | `INT` | default `0` | Display order |
| `created_at` | `TIMESTAMPTZ` | default `NOW()` | |
| `updated_at` | `TIMESTAMPTZ` | default `NOW()` | Auto-updated via trigger |

**Referenced by:** `tasks.workspace_id`, `cron_jobs.workspace_id`

---

## Migration History

| # | Migration | Date | Description |
|---|-----------|------|-------------|
| 001 | `001_add_workflow_runs.sql` | 2026-03-11 | Add `workflow_runs`, `workflow_steps`, `workflow_templates` tables, views, seed templates |
| 002 | `002_add_workflow_queues.sql` | 2026-03-11 | Extend task status constraint with workflow queue states |
| 003 | `003_add_approvals.sql` | 2026-03-11 | Add `workflow_approvals` table |
| 004 | `004_add_blocker_classification.sql` | 2026-03-11 | Add `blocker_type` and `blocker_description` to tasks and workflow_runs |
| 005 | `005_add_migration_tracking.sql` | — | Add `schema_migrations` table |
| 006 | `006_add_departments.sql` | — | Add `departments` table, seed 9 departments |
| 007 | `007_add_agent_profiles.sql` | — | Add `agent_profiles` table, seed 40+ agents |
| 008 | `008_add_service_catalog.sql` | — | Add `service_catalog` table, seed 8 services |
| 009 | `009_add_service_requests.sql` | — | Add `service_requests` table |
| 010 | `010_harmonize_service_catalog.sql` | — | Link services to workflow templates, add 8 more services |
| 011 | `011_extend_workflow_business_context.sql` | — | Add business context columns to templates and runs, backfill from services |
| 012 | `012_add_workflow_artifacts.sql` | — | Add `workflow_artifacts` table, backfill from output_summary URLs |
| 013 | `013_extend_workflow_approvals.sql` | — | Add due dates, escalation, artifact linking to approvals |
| 014 | `014_add_workflow_run_blocker_intelligence.sql` | — | Add blocker metadata and operator pause/resume to workflow_runs |
| 015 | `015_add_department_daily_metrics.sql` | — | Add `department_daily_metrics` table |
| 020 | `020_add_error_details_to_workflow_runs.sql` | 2026-03-21 | Add `error_details` JSONB column to workflow_runs |
| 021 | `021_add_workflow_agent_routing.sql` | 2026-03-22 | Add `workflow_agent_routing` table, dispatch/claim columns |
| 022 | `022_add_run_token_cost_tracking.sql` | 2026-08-23 | Add per-run token/cost tracking columns to `workflow_runs` (roadmap Phase 0) |
| 20260216a | `20260216_add_agent_observability.sql` | 2026-02-16 | Add `agent_heartbeats` and `task_runs` tables, `retry_count` on tasks |
| 20260216b | `20260216_add_archive_deleted_to_tasks.sql` | 2026-02-16 | Add `archived_at` and `deleted_at` to tasks |
| 20260216c | `20260216_add_audit_log_search_indexes.sql` | 2026-02-16 | Add `action` and `(actor, action)` indexes to audit_log |
| 20260428a | `20260428_add_state_snapshots.sql` | 2026-04-28 | Add `state_snapshots` table, extend `audit_log` with `entity_type`, `correlation_id` |
| 20260429a | `20260429_extend_workspaces.sql` | 2026-04-29 | Extend `workspaces` with `icon`, `color`, `description`, `is_default`, `sort_order` |
| 20260216d | `20260216_add_cron_job_runs.sql` | 2026-02-16 | Add `cron_job_runs` table |
| 20260216e | `20260216_add_saved_views.sql` | 2026-02-16 | Add `saved_views` table |
| 20260216f | `20260216_add_updated_at_index_to_tasks.sql` | 2026-02-16 | Add `updated_at` index to tasks for incremental sync |
| 20260429b | `20260429_spaces_constraints.sql` | 2026-04-29 | Enforce single default workspace via partial unique index on `workspaces.is_default` |
| 022 | `022_add_run_token_cost_tracking.sql` | 2026-08-23 | Add per-run token/cost tracking to `workflow_runs`: input_tokens, output_tokens, cached_tokens, model_id, cost_estimate, currency, reported_at |
| 023 | `023_add_budget_ledger.sql` | 2026-08-24 | Add `budgets` rules + `budget_events` append-only audit trail (budget ledger slice 1) |

---

## Budget Ledger Tables

### budgets *(023)*

Named spending rules; spend is derived from `workflow_runs` (migration 022) at evaluation time, never stored twice.

| Column | Type | Notes |
|--------|------|-------|
| `id` | `UUID` | PK, default `gen_random_uuid()` |
| `name` | `TEXT` | NOT NULL — operator-facing label |
| `scope` | `TEXT` | NOT NULL, CHECK: `agent` \| `department` \| `project` \| `fleet` |
| `scope_id` | `TEXT` | nullable — agent id / department id / workflow_type; NULL only for fleet |
| `period` | `TEXT` | NOT NULL, CHECK: `daily` \| `weekly` \| `monthly` |
| `cap_usd` | `NUMERIC(12,6)` | nullable — XOR with `cap_tokens` (table CHECK) |
| `cap_tokens` | `BIGINT` | nullable — over `input_tokens + output_tokens`; XOR with `cap_usd` |
| `action_on_exceed` | `TEXT` | NOT NULL, CHECK: `warn` \| `pause_new_runs` \| `hard_stop` |
| `active` | `BOOLEAN` | NOT NULL, default `true` |
| `created_at` | `TIMESTAMPTZ` | NOT NULL, default `now()` |

**Indexes:** partial unique `uq_budgets_active_scope_period (scope, COALESCE(scope_id, ''), period) WHERE active` — one active budget per scope+period; `idx_budgets_scope_period (scope, period, active)`.

### budget_events *(023)*

Append-only enforcement audit trail. `UNIQUE (budget_id, period_key, event_kind)` is the idempotency latch (`ON CONFLICT DO NOTHING`) so repeated dispatcher ticks never duplicate an event.

| Column | Type | Notes |
|--------|------|-------|
| `id` | `BIGSERIAL` | PK |
| `budget_id` | `UUID` | NOT NULL, FK → `budgets(id)` ON DELETE CASCADE |
| `period_key` | `TEXT` | NOT NULL — e.g. `2026-08-24` / `2026-W35` / `2026-08` |
| `event_kind` | `TEXT` | NOT NULL, CHECK: `warned` \| `paused` \| `hard_stopped` \| `recovered` |
| `detail` | `JSONB` | nullable — spend at breach, affected run ids, actor |
| `created_at` | `TIMESTAMPTZ` | NOT NULL, default `now()` |

**Indexes:** unique `(budget_id, period_key, event_kind)`; `idx_budget_events_budget_created (budget_id, created_at DESC)`.

---

## Seeded Data

### Workflow Templates (7)

| Name | Category | Default Agent |
|------|----------|---------------|
| `affiliate-article` | content | `affiliate-editorial` |
| `image-generation` | content | `comfyui-image-agent` |
| `wordpress-publish` | publishing | `3dput` |
| `site-fix` | maintenance | `3dput` |
| `incident-investigation` | incident | `main` |
| `code-change` | development | `coder` |
| `qa-review` | quality | `qa-auditor` |

### Departments (9)

Core Platform, Content & Publishing, Bug Fix Pipeline, Security Pipeline, Feature Development, Web Properties, Media & Vision, Research & Analysis, Automation.

### Service Catalog (16)

Bug Report, Security Issue, Feature Request, Content Creation, Data Research, Image Generation, Website Update, General Request, Affiliate Article, Image Pack, WordPress Publish, Site Fix, Incident Investigation, Code Change, QA Review, Topic Research.
