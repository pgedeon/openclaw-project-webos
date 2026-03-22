#!/usr/bin/env node

const assert = require('assert');
const fs = require('fs');
const path = require('path');

function run() {
  const htmlPath = path.resolve(__dirname, '../skills-tools.html');
  const pageModulePath = path.resolve(__dirname, '../src/skills-tools-page.mjs');
  const html = fs.readFileSync(htmlPath, 'utf8');
  const pageModule = fs.readFileSync(pageModulePath, 'utf8');

  assert.ok(
    html.includes('<title>Skills &amp; Tools</title>'),
    'standalone skills-tools page should set a dedicated document title'
  );
  assert.ok(
    html.includes('<a href="/skills-tools" aria-current="page">Skills &amp; Tools</a>'),
    'standalone skills-tools page should mark its nav entry as current'
  );
  assert.ok(
    html.includes('id="skillsToolsRoot"'),
    'standalone skills-tools page should provide a root mount node'
  );
  assert.ok(
    html.includes('src="/src/skills-tools-page.mjs"'),
    'standalone skills-tools page should boot the dedicated page module'
  );
  assert.ok(
    pageModule.includes("import { renderSkillsToolsView } from './views/skills-tools-view.mjs';"),
    'standalone skills-tools page module should reuse the extracted renderer'
  );
  assert.ok(
    pageModule.includes('await renderSkillsToolsView({'),
    'standalone skills-tools page module should render the skills-tools surface'
  );

  console.log('PASS: standalone skills-tools page wiring');
}

try {
  run();
} catch (error) {
  console.error('FAIL: standalone skills-tools page wiring');
  console.error(error);
  process.exit(1);
}
