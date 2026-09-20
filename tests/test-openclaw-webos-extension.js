#!/usr/bin/env node
/**
 * DB-free packaging + contract checks for the in-repo openclaw-webos
 * Control UI tab extension (Phase 2). No gateway, no network, no install.
 *
 * Run: node tests/test-openclaw-webos-extension.js
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const EXT = path.join(ROOT, 'openclaw-webos');

let passed = 0;
let failed = 0;

function check(name, fn) {
  try {
    const r = fn();
    if (r instanceof Promise) {
      return r.then(() => { passed += 1; console.log(`  ✔ ${name}`); },
        (err) => { failed += 1; console.error(`  ✘ ${name}\n    ${err?.message || err}`); });
    }
    passed += 1;
    console.log(`  ✔ ${name}`);
    return Promise.resolve();
  } catch (err) {
    failed += 1;
    console.error(`  ✘ ${name}\n    ${err?.message || err}`);
    return Promise.resolve();
  }
}

function read(rel) {
  return fs.readFileSync(path.join(EXT, rel), 'utf8');
}

function walkFiles(dir, acc = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walkFiles(full, acc);
    else acc.push(full);
  }
  return acc;
}

function makeDocument() {
  const makeEl = (tag) => {
    const el = {
      tagName: String(tag).toUpperCase(),
      className: '',
      innerHTML: '',
      dataset: {},
      children: [],
      listeners: {},
      style: {},
      value: '',
      addEventListener(type, fn) {
        this.listeners[type] = this.listeners[type] || [];
        this.listeners[type].push(fn);
      },
      querySelector(sel) {
        if (sel.startsWith('[data-action=')) {
          const action = sel.match(/data-action="([^"]+)"/)?.[1];
          return this._find((n) => n.dataset.action === action);
        }
        if (sel.startsWith('[data-card-id]')) return this._find((n) => n.dataset.cardId);
        return null;
      },
      querySelectorAll(sel) {
        const out = [];
        const walk = (n) => {
          if (sel === '[data-card-id]' && n.dataset.cardId) out.push(n);
          for (const c of n.children) walk(c);
        };
        walk(this);
        return out;
      },
      _find(pred) {
        if (pred(this)) return this;
        for (const c of this.children) {
          const hit = c._find?.(pred);
          if (hit) return hit;
        }
        return null;
      },
      remove() {
        this.removed = true;
      },
    };
    return el;
  };

  return {
    createElement(tag) {
      const el = makeEl(tag);
      const origSetter = Object.getOwnPropertyDescriptor(el, 'innerHTML');
      Object.defineProperty(el, 'innerHTML', {
        get() { return this._html || ''; },
        set(html) {
          this._html = String(html);
          this.children = [];
          const actionRe = /data-action="([^"]+)"/g;
          let m;
          while ((m = actionRe.exec(this._html))) {
            const child = makeEl('button');
            child.dataset.action = m[1];
            this.children.push(child);
          }
          const cardRe = /data-card-id="([^"]+)"/g;
          while ((m = cardRe.exec(this._html))) {
            const child = makeEl('button');
            child.dataset.cardId = m[1];
            this.children.push(child);
          }
        },
      });
      return el;
    },
  };
}

(async () => {
  console.log('openclaw-webos: packaging + tab contract');

  const plugin = JSON.parse(read('openclaw.plugin.json'));
  const pkg = JSON.parse(read('package.json'));
  const entryRel = plugin.controlUi.entry;
  const stylesRel = plugin.controlUi.styles;
  const hashDir = path.dirname(entryRel);
  const CONTROL_UI_ENTRY_RE = /^dist\/(?:[\w-][\w.-]*\/)+[\w-][\w.-]*\.m?js$/;
  const CONTROL_UI_STYLE_RE = /^dist\/(?:[\w-][\w.-]*\/)+[\w-][\w.-]*\.css$/;

  await check('plugin id is openclaw-webos and disabled by default', () => {
    assert.strictEqual(plugin.id, 'openclaw-webos');
    assert.strictEqual(plugin.enabledByDefault, false);
    assert.strictEqual(plugin.name, 'OpenClaw WebOS');
  });

  await check('controlUi.entry matches workboard dist/control-ui/<hash>/index.js shape', () => {
    assert.ok(CONTROL_UI_ENTRY_RE.test(entryRel), `entry ${entryRel}`);
    assert.ok(entryRel.startsWith('dist/control-ui/'), entryRel);
    assert.ok(entryRel.endsWith('/index.js'), entryRel);
    const hash = entryRel.split('/')[2];
    assert.ok(/^[0-9a-f]{64}$/.test(hash), `hash ${hash}`);
    assert.ok(fs.existsSync(path.join(EXT, entryRel)), `missing ${entryRel}`);
  });

  await check('controlUi.styles live next to entry and are .css only', () => {
    assert.ok(Array.isArray(stylesRel) && stylesRel.length === 1);
    assert.ok(CONTROL_UI_STYLE_RE.test(stylesRel[0]), stylesRel[0]);
    assert.strictEqual(path.dirname(stylesRel[0]), hashDir);
    assert.ok(fs.existsSync(path.join(EXT, stylesRel[0])));
  });

  await check('plugin asset tree ships only .js/.css (no raw index.html)', () => {
    const dist = path.join(EXT, 'dist');
    const files = walkFiles(dist).map((f) => path.relative(dist, f));
    assert.ok(files.length >= 3, `expected js+css+view, got ${files.join(',')}`);
    for (const rel of files) {
      assert.ok(/\.(js|mjs|css)$/.test(rel), `illegal asset ${rel}`);
    }
    assert.ok(!fs.existsSync(path.join(EXT, 'index.html')));
    assert.ok(!fs.existsSync(path.join(EXT, 'dist', 'index.html')));
  });

  await check('package.json openclaw.extensions + controlUi point at hashed entry', () => {
    assert.deepStrictEqual(pkg.openclaw.extensions, ['./index.js']);
    assert.strictEqual(pkg.openclaw.controlUi, `./${entryRel}`);
    assert.strictEqual(pkg.type, 'module');
  });

  await check('runtime index.js registers surface:tab at route:desktop', () => {
    const src = read('index.js');
    assert.ok(src.includes("surface: 'tab'"));
    assert.ok(src.includes("id: 'desktop'"));
    assert.ok(src.includes("placement: 'route:desktop'"));
    assert.ok(src.includes('registerControlUiDescriptor'));
    assert.ok(src.includes('definePluginEntry'));
  });

  await check('Lit wrapper is a single module that mounts sibling vanilla view', () => {
    const src = read(entryRel);
    assert.ok(src.includes("from 'lit'"));
    assert.ok(src.includes('LitElement'));
    assert.ok(src.includes("surface: 'tab'"));
    assert.ok(src.includes('registerReplacement'));
    assert.ok(src.includes("id: 'desktop'"));
    assert.ok(src.includes('./webos-desktop-view.js'));
    assert.ok(src.includes('document.createElement'));
    assert.ok(!src.includes('<iframe'));
  });

  await check('wrapper activate() returns dispose and never mounts a URL', () => {
    const src = read(entryRel);
    const registrations = [];
    const fakeLit = {
      LitElement: class {
        static properties = {};
        static styles = null;
      },
      html: () => '',
      css: () => '',
    };
    const wrapped = src
      .replace("import { LitElement, html, css } from 'lit';",
        'const { LitElement, html, css } = __lit;')
      .replace("new URL('./webos-desktop-view.js', import.meta.url).href",
        "'file:///virtual/webos-desktop-view.js'")
      .replace('export default', 'module.exports =');
    const context = vm.createContext({
      customElements: { get: () => undefined, define: () => {} },
      document: { createElement: () => ({ host: null, signal: null, remove() {} }) },
      __lit: fakeLit,
      module: { exports: {} },
      exports: {},
      console,
    });
    vm.runInContext(wrapped, context, { filename: 'index.js' });
    const pluginMod = context.module.exports;
    assert.strictEqual(pluginMod.id, 'openclaw-webos');
    const host = {
      ui: {
        registerReplacement(desc) {
          registrations.push(desc);
          return () => {};
        },
      },
    };
    const dispose = pluginMod.activate(host);
    assert.strictEqual(typeof dispose, 'function');
    assert.strictEqual(registrations.length, 1);
    assert.strictEqual(registrations[0].surface, 'tab');
    assert.strictEqual(registrations[0].id, 'desktop');
    assert.strictEqual(typeof registrations[0].mount, 'function');
    assert.ok(!('url' in registrations[0]));
    dispose();
  });

  const viewPath = path.join(EXT, hashDir, 'webos-desktop-view.js');
  await check('vanilla view module exists next to hashed entry', () => {
    assert.ok(fs.existsSync(viewPath), viewPath);
  });

  const viewMod = await import(pathToFileURL(viewPath).href);

  await check('vanilla view render() lists cards via host.request', async () => {
    global.document = makeDocument();
    const calls = [];
    const host = {
      async request(method, params) {
        calls.push({ method, params });
        return {
          cards: [
            { id: 'c1', title: 'Alpha', status: 'ready', priority: 'high', agentId: 'coder', labels: ['site-webos'] },
            { id: 'c2', title: 'Beta', status: 'running', priority: 'normal', agentId: 'coder' },
          ],
          boards: [{ id: 'default', name: 'Default' }],
        };
      },
    };
    const container = { last: null, replaceChildren(node) { this.last = node; } };
    const cleanup = viewMod.render(container, { host, boardId: 'default' });
    await new Promise((r) => setImmediate(r));
    await new Promise((r) => setImmediate(r));
    assert.strictEqual(calls.length, 1);
    assert.strictEqual(calls[0].method, 'workboard.cards.list');
    assert.strictEqual(calls[0].params.boardId, 'default');
    const html = container.last.innerHTML;
    assert.ok(html.includes('Alpha'), html.slice(0, 200));
    assert.ok(html.includes('Beta'));
    assert.ok(html.includes('OpenClaw Workboard'));
    assert.strictEqual(typeof cleanup, 'function');
    cleanup();
    delete global.document;
  });

  await check('vanilla view degrades to gateway-unavailable on request failure', async () => {
    global.document = makeDocument();
    const host = {
      async request() {
        throw new Error('socket closed');
      },
    };
    const container = { last: null, replaceChildren(node) { this.last = node; } };
    const cleanup = viewMod.render(container, { host });
    await new Promise((r) => setImmediate(r));
    await new Promise((r) => setImmediate(r));
    const html = container.last.innerHTML;
    assert.ok(html.includes('data-state="gateway-unavailable"'), html.slice(0, 240));
    assert.ok(html.includes('socket closed'));
    cleanup();
    delete global.document;
  });

  await check('desktopTokenGate defaults off so other origins stay unchanged', () => {
    const gate = plugin.configSchema.properties.desktopTokenGate;
    assert.strictEqual(gate.type, 'boolean');
    assert.strictEqual(gate.default, false);
    const url = plugin.configSchema.properties.taskServerUrl.default;
    assert.ok(url.includes(':8120'), url);
  });

  await check('README documents owner-approval install gate and no-html contract', () => {
    const readme = read('README.md');
    assert.ok(readme.includes('does not install'));
    assert.ok(readme.includes('~/.openclaw/extensions/'));
    assert.ok(readme.includes('route:desktop'));
    assert.ok(readme.includes('no raw HTML') || readme.includes('No `index.html`'));
    assert.ok(readme.includes('workboard'));
  });

  console.log(`\n${passed}/${passed + failed} passed`);
  if (failed > 0) process.exit(1);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
