#!/usr/bin/env node
/**
 * Phase 2.5 acceptance harness (dev gateway, headless Chrome over CDP).
 *
 * Proves, against the LIVE tab at /openclaw/desktop:
 *  1. baseline render shows the running card with an aged heartbeat
 *  2. a real heartbeat on that running card (no throwaway cards) appears
 *     WITHOUT clicking Refresh
 *  3. navigating away unmounts and stops the notify loop
 *  4. zero console errors
 *
 * Usage: node live-refresh-acceptance.mjs <browserUrl> <cardId> <outDir>
 */
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';

const [browserUrl, cardId, outDir] = process.argv.slice(2);
if (!browserUrl || !cardId || !outDir) {
  console.error('usage: node live-refresh-acceptance.mjs <browserUrl> <cardId> <outDir>');
  process.exit(2);
}
fs.mkdirSync(outDir, { recursive: true });

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function httpJson(url, method = 'GET') {
  const res = await fetch(url, { method });
  const text = await res.text();
  try { return JSON.parse(text); } catch { return text; }
}

class CDP {
  constructor(ws) {
    this.ws = ws;
    this.id = 0;
    this.pending = new Map();
    this.listeners = new Map();
    ws.addEventListener('message', (ev) => {
      const msg = JSON.parse(typeof ev.data === 'string' ? ev.data : ev.data.toString());
      if (msg.id && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        if (msg.error) reject(new Error(JSON.stringify(msg.error)));
        else resolve(msg.result);
      } else if (msg.method) {
        for (const fn of this.listeners.get(msg.method) || []) fn(msg.params);
      }
    });
  }
  send(method, params = {}) {
    const id = ++this.id;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }
  on(method, fn) {
    if (!this.listeners.has(method)) this.listeners.set(method, []);
    this.listeners.get(method).push(fn);
  }
  close() { try { this.ws.close(); } catch {} }
}

const consoleErrors = [];
const consoleAll = [];
const requests = [];

const target = await httpJson('http://127.0.0.1:9222/json/new?' + encodeURIComponent('about:blank'), 'PUT');
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((resolve, reject) => {
  ws.addEventListener('open', resolve, { once: true });
  ws.addEventListener('error', reject, { once: true });
});
const cdp = new CDP(ws);

cdp.on('Runtime.consoleAPICalled', (p) => {
  const text = (p.args || []).map((a) => a.value ?? a.description ?? '').join(' ');
  consoleAll.push(`${p.type}: ${text}`);
  if (p.type === 'error') consoleErrors.push(text);
});
cdp.on('Runtime.exceptionThrown', (p) => {
  consoleErrors.push(String(p.exceptionDetails?.exception?.description || p.exceptionDetails?.text));
});
cdp.on('Log.entryAdded', (p) => {
  if (p.entry?.level === 'error') consoleErrors.push(String(p.entry.text));
});
cdp.on('Network.requestWillBeSent', (p) => { requests.push({ url: p.request.url, at: Date.now() }); });
const failedResponses = [];
const wsFrames = [];
cdp.on('Network.webSocketFrameSent', (p) => {
  const payload = p.response?.payloadData || '';
  const method = /"method"\s*:\s*"([^"]+)"/.exec(payload)?.[1];
  if (method) wsFrames.push({ method, at: Date.now() });
});
cdp.on('Network.responseReceived', (p) => {
  if (p.response.status >= 400) failedResponses.push({ status: p.response.status, url: p.response.url });
});

await cdp.send('Runtime.enable');
await cdp.send('Page.enable');
await cdp.send('Log.enable');
await cdp.send('Network.enable');
await cdp.send('Page.setDownloadBehavior', { behavior: 'deny' }).catch(() => {});
// The gateway uses a self-signed cert on loopback.
await cdp.send('Security.setIgnoreCertificateErrors', { ignore: true }).catch(() => {});

const evalText = async (expression) => {
  const r = await cdp.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.text);
  return r.result?.value;
};
const shot = async (name) => {
  const { data } = await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  const file = path.join(outDir, name);
  fs.writeFileSync(file, Buffer.from(data, 'base64'));
  return file;
};

// 1) Authenticate: the bootstrap URL stores the gateway token, then the
//    Control UI redirects to its home page. 2) Navigate to the desktop tab.
await cdp.send('Page.navigate', { url: browserUrl });
await wait(6000);
const desktopUrl = new URL(browserUrl);
desktopUrl.hash = '';
desktopUrl.pathname = desktopUrl.pathname.replace(/\/$/, '') + '/desktop';
await cdp.send('Page.navigate', { url: desktopUrl.href });

// Wait for the mounted Workboard view (not just the shell).
let mounted = false;
for (let i = 0; i < 120; i += 1) {
  await wait(1000);
  const ok = await evalText("!!document.querySelector('[data-webos-view-root] .wb')").catch(() => false);
  if (ok) { mounted = true; break; }
}
if (!mounted) {
  const diag = await evalText(`JSON.stringify({
    url: location.href,
    title: document.title,
    hasRoot: !!document.querySelector('[data-webos-view-root]'),
    bodyStart: (document.body?.innerText || '').slice(0, 400),
    nav: [...document.querySelectorAll('a[href]')].map(a => a.getAttribute('href')).slice(0, 40),
  })`).catch((e) => String(e));
  fs.writeFileSync(path.join(outDir, 'mount-failure.json'), String(diag));
  await shot('00-mount-failure.png');
  throw new Error(`view did not mount within 120s: ${diag}`);
}
await wait(4000);

const cardExpr = (id) => `(() => {
  const b = document.querySelector('[data-card-id="${id}"]');
  return b ? b.innerText.replace(/\\s+/g, ' ').trim() : null;
})()`;

const baselineText = await evalText(cardExpr(cardId));
const baselineShot = await shot('01-baseline.png');
const liveChip = await evalText("document.querySelector('.wb-live')?.innerText || null");

console.log(JSON.stringify({ marker: 'READY_FOR_CHANGE', cardId, baselineText, liveChip, baselineShot }));

// Wait for the external heartbeat to show up. The view polls every 8s.
let observed = null;
const deadline = Date.now() + 90_000;
while (Date.now() < deadline) {
  await wait(2000);
  const text = await evalText(cardExpr(cardId));
  if (text && text !== baselineText) { observed = text; break; }
}

if (!observed) {
  const failShot = await shot('02-no-change.png');
  console.log(JSON.stringify({ marker: 'NO_CHANGE', baselineText, failShot, consoleErrors }));
  process.exit(3);
}

const changedShot = await shot('02-live-updated.png');
const observedAt = Date.now();
const chipAfterChange = await evalText("document.querySelector('.wb-live')?.dataset.live || null");
const chipTextAfterChange = await evalText("document.querySelector('.wb-live')?.innerText || null");

// Negative control: nothing else changes unless the gateway changes.
await wait(9000);
const stillText = await evalText(cardExpr(cardId));

// Unmount: navigate away from the tab and confirm the loop stops.
const reqBeforeLeave = requests.length;
const errorsBeforeLeave = consoleErrors.length;
const wsBeforeLeave = wsFrames.filter((f) => f.method === 'workboard.notifications.events').length;
await cdp.send('Page.navigate', { url: 'about:blank' });
await wait(6000);
const reqAfterLeave = requests.length;
await wait(10000);
const reqAfterIdle = requests.length;
const errorsAfterUnmount = consoleErrors.slice(errorsBeforeLeave);
const wsAfterLeave = wsFrames.filter((f) => f.method === 'workboard.notifications.events').length;
await wait(9000);
const wsAfterIdle = wsFrames.filter((f) => f.method === 'workboard.notifications.events').length;

const result = {
  marker: 'RESULT',
  cardId,
  baselineText,
  observedText: observed,
  stillText,
  liveChip,
  chipAfterChange,
  chipTextAfterChange,
  observedAtIso: new Date(observedAt).toISOString(),
  screenshots: { baselineShot, changedShot },
  requests: { beforeLeave: reqBeforeLeave, afterLeave: reqAfterLeave, afterIdle: reqAfterIdle },
  pollingStoppedAfterUnmount: reqAfterIdle === reqAfterLeave,
  consoleErrors,
  errorsAfterUnmount,
  notifyRpcFrames: {
    beforeLeave: wsBeforeLeave,
    afterLeave: wsAfterLeave,
    afterIdle: wsAfterIdle,
    methods: [...new Set(wsFrames.map((f) => f.method))].sort(),
  },
  failedResponses: failedResponses.filter((r) => !r.url.startsWith('data:')),
  consoleSample: consoleAll.slice(-40),
};
fs.writeFileSync(path.join(outDir, 'result.json'), JSON.stringify(result, null, 2));
console.log(JSON.stringify({ marker: 'RESULT_DONE', file: path.join(outDir, 'result.json'), pollingStoppedAfterUnmount: result.pollingStoppedAfterUnmount, consoleErrors }));
cdp.close();
process.exit(0);
