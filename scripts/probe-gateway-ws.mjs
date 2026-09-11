#!/usr/bin/env node
/**
 * scripts/probe-gateway-ws.mjs
 *
 * Read-only OpenClaw gateway WebSocket recon probe (Phase 1 spike, 2026-08-24).
 *
 * What it does:
 *  1. Reads local gateway config from ~/.openclaw/openclaw.json (port, auth,
 *     optional pinned TLS fingerprint).
 *  2. Probes the TLS certificate and verifies its SHA-256 fingerprint against
 *     `gateway.remote.tlsFingerprint` when configured (aborts on mismatch).
 *  3. Opens wss://127.0.0.1:<port>, waits for the `connect.challenge` event,
 *     and completes the protocol v4 handshake (`connect` -> `hello-ok`) using
 *     the shared gateway secret from config. Requests ONLY the read-only
 *     `operator.read` scope.
 *  4. Subscribes to session-index change events (`sessions.subscribe`) and
 *     issues two harmless read RPCs (`health`, `sessions.list`).
 *  5. Logs every inbound frame for an observation window (default 30s),
 *     prints sample message shapes + per-event counts, then closes.
 *
 * Read-only by construction:
 *  - scope requested is `operator.read` only (write methods fail scope checks)
 *  - no chat.send / agent / exec / config / pairing calls are sent
 *  - nothing about gateway state is mutated
 *
 * Usage:
 *   node scripts/probe-gateway-ws.mjs [--ms 30000] [--url wss://host:port]
 *                                     [--out FILE.jsonl] [--quiet]
 *
 * Exit codes: 0 handshake+window ok, 1 connect/auth/TLS failure, 2 usage/config error.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import tls from "node:tls";
import WebSocket from "ws";

// ---------- args ----------
const argv = process.argv.slice(2);
function argValue(flag, fallback) {
  const i = argv.indexOf(flag);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback;
}
const OBSERVE_MS = Math.max(1000, parseInt(argValue("--ms", "30000"), 10) || 30000);
const URL_OVERRIDE = argValue("--url", null);
const OUT_FILE = argValue("--out", null);
const QUIET = argv.includes("--quiet");

function log(msg) {
  if (!QUIET) process.stdout.write(msg + "\n");
}

// ---------- config ----------
function loadGatewayConfig() {
  const cfgPath = path.join(os.homedir(), ".openclaw", "openclaw.json");
  if (!fs.existsSync(cfgPath)) {
    console.error(`config not found: ${cfgPath}`);
    process.exit(2);
  }
  const cfg = JSON.parse(fs.readFileSync(cfgPath, "utf8"));
  const g = cfg.gateway || {};
  return {
    cfgPath,
    port: g.port || 18789,
    host: "127.0.0.1",
    authMode: g.auth?.mode || "none",
    password: g.auth?.password || null,
    token: g.auth?.token || null,
    pinnedFingerprint: (g.remote?.tlsFingerprint || "").replace(/:/g, "").toLowerCase(),
  };
}

// ---------- tls fingerprint pin ----------
function probeCertFingerprint(host, port) {
  return new Promise((resolve, reject) => {
    const sock = tls.connect(
      { host, port, rejectUnauthorized: false, servername: host },
      () => {
        const fp = (sock.getPeerCertificate()?.fingerprint256 || "").replace(/:/g, "").toLowerCase();
        sock.end();
        resolve(fp);
      }
    );
    sock.on("error", reject);
    sock.setTimeout(8000, () => sock.destroy(new Error("tls probe timeout")));
  });
}

// ---------- main ----------
async function main() {
  const cfg = loadGatewayConfig();
  const url = URL_OVERRIDE || `wss://${cfg.host}:${cfg.port}`;

  // TLS pin check (self-signed certs are expected; pinning is the trust anchor)
  let servedFp = null;
  try {
    servedFp = await probeCertFingerprint(cfg.host, cfg.port);
  } catch (e) {
    console.error(`TLS probe failed: ${e.message}`);
    process.exit(1);
  }
  const fpMatched = cfg.pinnedFingerprint ? servedFp === cfg.pinnedFingerprint : null;
  log(`[probe] url=${url} auth.mode=${cfg.authMode}`);
  log(`[probe] cert sha256=${servedFp} pinned=${cfg.pinnedFingerprint || "(none)"} match=${fpMatched}`);
  if (fpMatched === false) {
    console.error("FATAL: served certificate does not match gateway.remote.tlsFingerprint — aborting.");
    process.exit(1);
  }

  const ws = new WebSocket(url, { rejectUnauthorized: false }); // pin checked above
  const startedAt = Date.now();
  const frames = []; // {t, dir, json(truncated)}
  const counts = {}; // event name -> n
  let totalIn = 0;
  let challenge = null;
  let helloOk = null;
  const pendingRpcs = new Map(); // id -> name
  const rpcResults = {};

  const watchdog = setTimeout(() => {
    console.error("FATAL: overall watchdog fired");
    try { ws.terminate(); } catch {}
    process.exit(1);
  }, OBSERVE_MS + 15000);

  const SECRET_KEYS = new Set(["password", "token", "deviceToken", "secret"]);
  function redact(value) {
    if (typeof value === "string") return value;
    if (Array.isArray(value)) return value.map(redact);
    if (value && typeof value === "object") {
      const out = {};
      for (const [k, v] of Object.entries(value)) {
        out[k] = SECRET_KEYS.has(k) && typeof v === "string" && v.length > 0 ? "***" : redact(v);
      }
      return out;
    }
    return value;
  }

  function record(dir, obj, truncate = 1400) {
    totalIn += dir === "in" ? 1 : 0;
    let s;
    try { s = JSON.stringify(redact(obj)); } catch { s = String(obj); }
    if (dir === "in") {
      const evName =
        obj?.type === "event" ? `event:${obj.event}` :
        obj?.type === "res" ? `res:${pendingRpcs.get(obj.id) || obj.id}` :
        obj?.type || "unknown";
      counts[evName] = (counts[evName] || 0) + 1;
    }
    if (frames.length < 40) {
      frames.push({ t: Date.now() - startedAt, dir, json: s.length > truncate ? s.slice(0, truncate) + "…(truncated)" : s });
    }
    if (OUT_FILE) fs.appendFileSync(OUT_FILE, JSON.stringify({ t: Date.now() - startedAt, dir, raw: s }) + "\n");
  }

  function send(obj) {
    record("out", obj);
    ws.send(JSON.stringify(obj));
  }

  function rpc(method, params, name) {
    const id = `probe-${crypto.randomUUID()}`;
    pendingRpcs.set(id, name || method);
    send({ type: "req", id, method, params: params ?? {} });
  }

  ws.on("message", (data) => {
    let msg;
    try { msg = JSON.parse(data.toString()); } catch {
      record("in", { unparsable: String(data).slice(0, 200) });
      return;
    }
    record("in", msg);

    if (msg.type === "event" && msg.event === "connect.challenge") {
      challenge = msg.payload?.nonce || "(missing)";
      const authParam =
        cfg.authMode === "password" ? { password: cfg.password } :
        cfg.authMode === "token" ? { token: cfg.token } : {};
      send({
        type: "req",
        id: "probe-connect",
        method: "connect",
        params: {
          minProtocol: 4,
          maxProtocol: 4,
          client: { id: "gateway-client", version: "0.1.0-probe", platform: "linux", mode: "backend" },
          role: "operator",
          scopes: ["operator.read"],
          caps: [],
          commands: [],
          permissions: {},
          auth: authParam,
          locale: "en-US",
          userAgent: "webos-probe/0.1.0",
        },
      });
      return;
    }

    if (msg.type === "res" && msg.id === "probe-connect") {
      if (!msg.ok) {
        console.error(`FATAL: connect rejected: ${JSON.stringify(msg.error).slice(0, 600)}`);
        clearTimeout(watchdog);
        try { ws.close(); } catch {}
        process.exit(1);
      }
      helloOk = msg.payload;
      log(`[probe] hello-ok protocol=${helloOk?.protocol} server=${helloOk?.server?.version} connId=${helloOk?.server?.connId}`);
      log(`[probe] auth granted role=${helloOk?.auth?.role} scopes=${JSON.stringify(helloOk?.auth?.scopes)}`);
      log(`[probe] advertised methods=${helloOk?.features?.methods?.length ?? "?"} events=${helloOk?.features?.events?.length ?? "?"}`);
      log(`[probe] policy=${JSON.stringify(helloOk?.policy)}`);
      // harmless reads + subscription (all read-only)
      rpc("sessions.subscribe", {}, "sessions.subscribe");
      rpc("health", {}, "health");
      rpc("sessions.list", {}, "sessions.list");
      return;
    }

    if (msg.type === "res" && pendingRpcs.has(msg.id)) {
      const name = pendingRpcs.get(msg.id);
      pendingRpcs.delete(msg.id);
      let s;
      try { s = JSON.stringify(redact(msg.payload)); } catch { s = "(unserializable)"; }
      rpcResults[name] = { ok: msg.ok, bytes: s.length, preview: s.slice(0, 700) };
    }
  });

  ws.on("close", (code, reason) => log(`[probe] closed code=${code} reason=${reason?.toString?.() || ""}`));
  ws.on("error", (e) => log(`[probe] ws error: ${e.message}`));

  ws.on("open", () => log("[probe] socket open, waiting for connect.challenge…"));

  setTimeout(() => {
    log("[probe] observation window elapsed, closing");
    try { ws.close(1000, "probe-done"); } catch {}
    setTimeout(() => {
      const summary = {
        url,
        tls: { servedFingerprint: servedFp, pinnedMatch: fpMatched },
        challengeNonceReceived: Boolean(challenge),
        helloOk: helloOk && {
          protocol: helloOk.protocol,
          serverVersion: helloOk.server?.version,
          connId: helloOk.server?.connId,
          role: helloOk.auth?.role,
          scopesGranted: helloOk.auth?.scopes,
          methodsAdvertised: helloOk.features?.methods,
          eventsAdvertised: helloOk.features?.events,
          policy: helloOk.policy,
        },
        rpcResults,
        windowMs: Date.now() - startedAt,
        inboundTotal: totalIn,
        inboundByEvent: counts,
        sampleFrames: frames.slice(0, 40),
      };
      fs.writeFileSync("/tmp/gateway-ws-probe-summary.json", JSON.stringify(summary, null, 2));
      log("[probe] summary written to /tmp/gateway-ws-probe-summary.json");
      clearTimeout(watchdog);
      process.exit(0);
    }, 500);
  }, OBSERVE_MS);
}

main().catch((e) => {
  console.error(`FATAL: ${e.message}`);
  process.exit(1);
});
