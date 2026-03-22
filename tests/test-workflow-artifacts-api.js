#!/usr/bin/env node

const assert = require('assert');
const { WorkflowRunsAPI } = require('../workflow-runs-api.js');

async function run() {
  const storedArtifacts = [];

  const pool = {
    async query(queryText, values = []) {
      if (queryText.includes('information_schema.tables')) {
        return { rows: [{ exists: true }] };
      }

      if (queryText.includes('SELECT id, task_id') && queryText.includes('FROM workflow_runs')) {
        return { rows: [{ id: 'run-1', task_id: 'task-1' }] };
      }

      if (queryText.includes('INSERT INTO workflow_artifacts')) {
        const created = {
          id: 'artifact-1',
          workflow_run_id: values[0],
          task_id: values[1],
          artifact_type: values[2],
          label: values[3],
          uri: values[4],
          mime_type: values[5],
          status: values[6],
          metadata: JSON.parse(values[7]),
          created_by: values[8],
          created_at: '2026-03-12T13:00:00.000Z'
        };
        storedArtifacts.push(created);
        return { rows: [created] };
      }

      if (queryText.includes('SELECT COUNT(*)::integer AS count') && queryText.includes('workflow_artifacts')) {
        return { rows: [{ count: storedArtifacts.length }] };
      }

      if (queryText.includes('UPDATE workflow_runs') && queryText.includes('actual_artifact_count')) {
        return { rows: [] };
      }

      if (queryText.includes('FROM workflow_artifacts wa')) {
        return {
          rows: storedArtifacts.map((artifact) => ({
            ...artifact,
            workflow_type: 'image-generation',
            owner_agent_id: 'comfyui-image-agent',
            service_request_id: 'request-1',
            customer_scope: '3dput.com',
            task_title: 'Generate hero image',
            board_name: 'Content Board'
          }))
        };
      }

      throw new Error(`Unexpected query: ${queryText} ${JSON.stringify(values)}`);
    }
  };

  const api = new WorkflowRunsAPI(pool);
  const artifact = await api.createWorkflowArtifact('run-1', {
    artifact_type: 'image',
    label: 'Hero image',
    uri: 'https://example.com/hero.png',
    mime_type: 'image/png',
    metadata: { width: 1600 },
    created_by: 'comfyui-image-agent'
  });

  assert.strictEqual(artifact.workflowRunId, 'run-1', 'artifact creation should link to the workflow run');
  assert.strictEqual(artifact.taskId, 'task-1', 'artifact creation should inherit the run task by default');
  assert.strictEqual(artifact.artifactType, 'image', 'artifact creation should normalize type');

  const artifacts = await api.listWorkflowArtifacts({ workflow_run_id: 'run-1' });
  assert.strictEqual(artifacts.length, 1, 'artifact listing should return created artifacts');
  assert.strictEqual(artifacts[0].customerScope, '3dput.com', 'artifact listing should include site context');

  console.log('PASS: workflow artifacts API');
}

run().catch((error) => {
  console.error('FAIL: workflow artifacts API');
  console.error(error);
  process.exit(1);
});
