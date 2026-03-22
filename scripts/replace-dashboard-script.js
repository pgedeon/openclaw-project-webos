#!/usr/bin/env node
/**
 * Replace the embedded script in project-dashboard.html with the new module-based script
 */

const fs = require('fs');
const path = require('path');

const htmlPath = path.join(__dirname, '..', 'dashboard.html');
const newScriptPath = path.join(__dirname, '..', 'src', 'dashboard-integration.js');

// Read files
const html = fs.readFileSync(htmlPath, 'utf8');
const integrationModule = fs.readFileSync(newScriptPath, 'utf8');

// Find the script block
const scriptStart = html.indexOf('<script>');
if (scriptStart === -1) {
  console.error('No <script> tag found');
  process.exit(1);
}
const scriptEnd = html.indexOf('</script>', scriptStart);
if (scriptEnd === -1) {
  console.error('No </script> closing tag');
  process.exit(1);
}

// Determine indentation of the script tag
const beforeScript = html.substring(0, scriptStart);
const linesBefore = beforeScript.split('\n');
const lastLine = linesBefore[linesBefore.length - 1];
const indent = lastLine.match(/^\s*/)[0];

// Construct new script block with same indentation
const newScriptBlock = `${indent}<script type="module">
${indent}  // Register Service Worker
${indent}  if ('serviceWorker' in navigator) {
${indent}    navigator.serviceWorker.register('/sw.js')
${indent}      .then(reg => console.log('SW registered:', reg))
${indent}      .catch(err => console.error('SW registration failed:', err));
${indent}  }
${indent}
${indent}  // Load dashboard integration
${indent}  import './src/dashboard-integration.js';
${indent}</script>`;

// Replace old script block with new one
const newHtml = html.substring(0, scriptStart) + newScriptBlock + html.substring(scriptEnd + 9);

// Write back
fs.writeFileSync(htmlPath, newHtml, 'utf8');
console.log('Successfully replaced script block');
