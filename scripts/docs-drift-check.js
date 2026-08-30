#!/usr/bin/env node
/**
 * docs-drift-check.js
 *
 * Validates that documentation matches the actual source code.
 * Run with: node scripts/docs-drift-check.js
 * Exit code 0 if clean, 1 if drift detected.
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
let errors = 0;
let warnings = 0;

function error(msg) {
  console.error(`❌ ${msg}`);
  errors++;
}

function warn(msg) {
  console.warn(`⚠️  ${msg}`);
  warnings++;
}

function ok(msg) {
  console.log(`✅ ${msg}`);
}

// ── 1. App Registry Count ──────────────────────────────────
console.log('\n=== App Registry ===');
try {
  const registrySrc = fs.readFileSync(path.join(ROOT, 'src/shell/app-registry.mjs'), 'utf8');
  const appIds = [...registrySrc.matchAll(/id:\s*'([^']+)'/g)].map(m => m[1]);
  const appCount = appIds.length;
  console.log(`  Source: ${appCount} apps registered`);

  // Check README
  const readme = fs.readFileSync(path.join(ROOT, 'README.md'), 'utf8');
  const readmeMatch = readme.match(/(\d+)\s+windowed\s+apps/);
  if (readmeMatch) {
    const readmeCount = parseInt(readmeMatch[1]);
    if (readmeCount === appCount) {
      ok(`README app count matches: ${appCount}`);
    } else {
      error(`README says ${readmeCount} apps, source has ${appCount}`);
    }
  }

  // Check views-reference
  const viewsRef = fs.readFileSync(path.join(ROOT, 'docs/views-reference.md'), 'utf8');
  const documentedApps = [];
  for (const id of appIds) {
    // Search for the app ID as a section or reference
    const kebabId = id.replace(/_/g, '-');
    const sectionPattern = new RegExp(`\\b${id}\\b|\\b${id.replace('-', '[\\s-]')}\\b`, 'i');
    if (sectionPattern.test(viewsRef)) {
      documentedApps.push(id);
    } else {
      warn(`App '${id}' not documented in views-reference.md`);
    }
  }

  if (documentedApps.length === appCount) {
    ok(`All ${appCount} apps documented in views-reference.md`);
  } else {
    error(`Only ${documentedApps.length}/${appCount} apps found in views-reference.md`);
  }
} catch (e) {
  error(`Failed to check app registry: ${e.message}`);
}

// ── 2. Widget Count ────────────────────────────────────────
console.log('\n=== Widget Registry ===');
try {
  const widgetSrc = fs.readFileSync(path.join(ROOT, 'src/shell/widgets/widget-registry.mjs'), 'utf8');
  const widgetIds = [...widgetSrc.matchAll(/id:\s*'([^']+)'/g)].map(m => m[1]);
  const widgetCount = widgetIds.length;
  console.log(`  Source: ${widgetCount} widgets registered`);

  // Check README
  const readme = fs.readFileSync(path.join(ROOT, 'README.md'), 'utf8');
  const readmeMatch = readme.match(/(\d+)\s+desktop\s+widgets/);
  if (readmeMatch) {
    const readmeCount = parseInt(readmeMatch[1]);
    if (readmeCount === widgetCount) {
      ok(`README widget count matches: ${widgetCount}`);
    } else {
      error(`README says ${readmeCount} widgets, source has ${widgetCount}`);
    }
  }

  // Check widget-catalog
  const widgetCatalog = fs.readFileSync(path.join(ROOT, 'docs/widget-catalog.md'), 'utf8');
  const catalogIds = [...widgetCatalog.matchAll(/###?\s+`?([\w-]+)`?\s/mg)].map(m => m[1]);
  const catalogWidgetIds = widgetIds.filter(id => widgetCatalog.includes(id));
  if (catalogWidgetIds.length === widgetCount) {
    ok(`All ${widgetCount} widgets documented in widget-catalog.md`);
  } else {
    const missing = widgetIds.filter(id => !widgetCatalog.includes(id));
    error(`Widget catalog has ${catalogWidgetIds.length}/${widgetCount} widgets. Missing: ${missing.join(', ')}`);
  }
} catch (e) {
  error(`Failed to check widget registry: ${e.message}`);
}

// ── 3. Route Coverage ──────────────────────────────────────

/**
 * Pure route-documentation matcher (exported for DB-free tests).
 *
 * Source routes captured from route files can carry template-string
 * interpolations (`/api/memory/file/${params.name}`) and query builders
 * (`/api/memory/context?${qs(req)}`), while docs reference either the clean
 * prefix, the `:param` form, or the parent path. This resolves ALL those
 * candidate forms against the concatenated docs corpus.
 */
function isRouteDocumented(route, allDocs) {
  const templateFree = route.replace(/\$\{[^}]*\}/g, '').replace(/\?[^/]*/g, '');
  const candidates = [route, templateFree];
  // A trailing slash means an interpolation consumed the final segment
  // (`/api/memory/file/${name}` → `/api/memory/file/`): docs may document the
  // parent at exactly that boundary. Guarded to multi-segment paths so a
  // bare `/api/` prefix can never match (it would match any API doc).
  const lastSegmentIndex = templateFree.lastIndexOf('/');
  // Guard: the parent prefix must be longer than `/api/` — anything shorter
  // would match virtually every API doc.
  const parentPrefix = templateFree.slice(0, lastSegmentIndex + 1);
  if (lastSegmentIndex > 0 && parentPrefix.length > '/api/'.length) {
    candidates.push(parentPrefix);
  }
  // Template params may be documented in `:param` form: `${params.name}` → `:name`
  const paramForm = route.replace(/\$\{(?:params\.)?(\w+)\}/g, ':$1');
  if (paramForm !== route) {
    candidates.push(paramForm);
    // And the `:name` variant with the trailing segment before it stripped
    const paramFormParent = paramForm.slice(0, paramForm.lastIndexOf('/'));
    if (paramFormParent.length > '/api/'.length) {
      candidates.push(paramFormParent);
    }
  }
  return candidates.some((c) => allDocs.includes(c));
}

console.log('\n=== Route Coverage ===');
try {
  // Collect route patterns from task-server + routes/
  const routeFiles = fs.readdirSync(path.join(ROOT, 'routes'))
    .filter(f => f.endsWith('-routes.js') || f.endsWith('-routes.mjs'))
    .map(f => path.join(ROOT, 'routes', f));

  const taskServer = fs.readFileSync(path.join(ROOT, 'task-server.js'), 'utf8');
  const allRouteSource = [taskServer];
  for (const f of routeFiles) {
    allRouteSource.push(fs.readFileSync(f, 'utf8'));
  }

  const combined = allRouteSource.join('\n');
  const routePatterns = [...combined.matchAll(/['"`](\/api\/[^'"`\s]+)['"`]/g)].map(m => m[1]);
  const uniqueRoutes = [...new Set(routePatterns)].sort();
  console.log(`  Found ${uniqueRoutes.length} unique route patterns`);

  // Check against API reference
  const apiRef = fs.readFileSync(path.join(ROOT, 'docs/api-reference-complete.md'), 'utf8');
  const apiMd = fs.readFileSync(path.join(ROOT, 'docs/api.md'), 'utf8');
  const allDocs = apiRef + '\n' + apiMd;

  let undocumented = 0;
  for (const route of uniqueRoutes) {
    // Skip parametric routes for now
    if (route.includes('/:')) continue;
    if (!isRouteDocumented(route, allDocs)) {
      // Only warn, not error — some routes are internal
      if (!route.includes('/oc/') && !route.includes('/events') && !route.includes('/auth/')) {
        warn(`Route ${route} may not be documented`);
        undocumented++;
      }
    }
  }
  if (undocumented === 0) {
    ok('All detected routes appear in API documentation');
  }
} catch (e) {
  warn(`Route coverage check failed: ${e.message}`);
}

// ── 4. Schema Migration Count ──────────────────────────────
console.log('\n=== Schema Migrations ===');
try {
  const migrationDir = path.join(ROOT, 'schema/migrations');
  if (fs.existsSync(migrationDir)) {
    const migrations = fs.readdirSync(migrationDir).filter(f => f.endsWith('.sql'));
    console.log(`  Found ${migrations.length} migration files`);

    const schemaRef = fs.readFileSync(path.join(ROOT, 'docs/schema-reference.md'), 'utf8');
    let documented = 0;
    for (const m of migrations) {
      if (schemaRef.includes(m)) documented++;
    }
    if (documented === migrations.length) {
      ok(`All ${migrations.length} migrations documented`);
    } else {
      warn(`${documented}/${migrations.length} migrations documented in schema-reference.md`);
    }
  }
} catch (e) {
  warn(`Schema check failed: ${e.message}`);
}

// ── Summary ────────────────────────────────────────────────
console.log('\n=== Summary ===');
console.log(`  Errors: ${errors}`);
console.log(`  Warnings: ${warnings}`);
if (errors > 0) {
  console.log('\n💥 Drift detected! Fix the errors above.');
} else if (warnings > 0) {
  console.log('\n⚠️  Some warnings found. Review recommended.');
} else {
  console.log('\n✨ All checks passed!');
}

// Exported for DB-free tests (test-docs-drift-check.js). Exit applies only
// when invoked as a script; requiring the module returns the matcher without
// affecting the parent's exit code.
module.exports = { isRouteDocumented };
if (require.main === module) {
  process.exit(errors > 0 ? 1 : 0);
}

