#!/usr/bin/env node
/**
 * Update tasks.md to add Dashboard Integration task (16.9) and rename Testing to 16.10
 */

const fs = require('fs');
const path = require('path');

const tasksFile = path.join(__dirname, '..', 'tasks.md');

let content = fs.readFileSync(tasksFile, 'utf8');

// The new task block to insert before existing 16.9
const newTask16_9 = `  - [ ] **16.9: Dashboard Integration** #openclaw
    - [x] Create HTML dashboard (public/qmd-dashboard.html) with metrics display and admin actions ✅ 2026-02-15
    - [x] Integrate dashboard into QMD server (serve at '/' and '/dashboard') ✅ 2026-02-15
    - [x] Dashboard shows: ingest/archive file counts, sizes, growth rate, last scan info ✅ 2026-02-15
    - [x] Dashboard includes buttons to trigger compaction, retention, scan (admin token protected) ✅ 2026-02-15
    - [ ] Test dashboard rendering and data loading
    - [ ] Consider adding chart visualizations (optional)
    - [ ] Embed QMD dashboard into DashClaw or link from DashClaw UI
`;

// Find the line that marks the start of 16.9 Testing & Validation
const existing16_9Pattern = /([\s-]*- \[ \] \*\*16\.9: Testing & Validation\*\*)/;

// Insert new block before that line
const insertionPoint = content.search(existing16_9Pattern);
if (insertionPoint === -1) {
  console.error('Could not find existing 16.9 block in tasks.md');
  process.exit(1);
}

// Build new content: [before insertionPoint] + newTask + [original line changed to 16.10] + [rest of file]
const before = content.substring(0, insertionPoint);
const after = content.substring(insertionPoint);

// Rename 16.9 to 16.10 in the after string
const renamedAfter = after.replace('16.9: Testing & Validation', '16.10: Testing & Validation');

// Combine
const newContent = before + newTask16_9 + renamedAfter;

// Write back
fs.writeFileSync(tasksFile, newContent, 'utf8');
console.log('✅ Updated tasks.md: added 16.9 Dashboard Integration, renamed 16.9 Testing to 16.10');
