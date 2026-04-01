#!/usr/bin/env node

const assert = require('assert');
const fs = require('fs');
const path = require('path');

function run() {
  const htmlPath = path.resolve(__dirname, '../dashboard.html');
  const jsPath = path.resolve(__dirname, '../src/dashboard-integration-optimized.mjs');
  const modulePath = path.resolve(__dirname, '../src/views/skills-tools-view.mjs');

  const html = fs.readFileSync(htmlPath, 'utf8');
  const js = fs.readFileSync(jsPath, 'utf8');
  const moduleSource = fs.readFileSync(modulePath, 'utf8');

  assert.ok(
    html.includes('data-view="skills-tools"'),
    'dashboard toolbar should expose the skills-tools view button'
  );
  assert.ok(
    js.includes("'skills-tools': { render: renderSkillsToolsView }"),
    'dashboard integration should register the skills-tools view in the view registry'
  );
  assert.ok(
    js.includes("import { renderSkillsToolsView as renderSkillsToolsViewModule } from './views/skills-tools-view.mjs';"),
    'dashboard integration should import the extracted skills-tools module'
  );
  assert.ok(
    js.includes('return renderSkillsToolsViewModule({'),
    'dashboard integration should delegate skills-tools rendering to the extracted module'
  );
  assert.ok(
    moduleSource.includes("fetchImpl('/api/catalog/skills-tools'"),
    'skills-tools renderer should load the combined catalog endpoint'
  );
  ['Catalog Summary', 'Skill Inventory', 'Tool Inventory', 'Agent Tool Access', 'Subagent Tool Baseline'].forEach((heading) => {
    assert.ok(
      moduleSource.includes(heading),
      `skills-tools renderer should include the "${heading}" section`
    );
  });

  console.log('PASS: skills-tools view wiring');
}

try {
  run();
} catch (error) {
  console.error('FAIL: skills-tools view wiring');
  console.error(error);
  process.exit(1);
}
