/**
 * openclaw-webos — thin Lit ControlUiView wrapper (Phase 2).
 *
 * Single vanilla ES module. NO repo build step. Lit ships with the Gateway
 * Control UI runtime (`import { LitElement } from 'lit'`).
 *
 * Contract (OpenClaw 2026.9.4, Phase 0 findings §5):
 *  - surface:tab mounts a Lit ControlUiView (DOM mount), NOT a URL (mismatch #2).
 *  - Plugin asset route serves ONLY .js/.css (mismatch #1) — no raw index.html.
 *  - Packaging mirrors the in-tree workboard plugin: controlUi.entry =
 *    dist/control-ui/<hash>/index.js + styles (mismatch #5).
 *
 * The wrapper dynamically imports the sibling vanilla ES view module
 * (`webos-desktop-view.js`) and mounts it into light DOM. That is the
 * "thin wrapper that mounts existing vanilla ES modules" contract.
 */

import { LitElement, html, css } from 'lit';

const VIEW_MODULE_URL = new URL('./webos-desktop-view.js', import.meta.url).href;

class OpenclawWebosDesktopTab extends LitElement {
  static properties = {
    host: { attribute: false },
    signal: { attribute: false },
    error: { type: String },
  };

  static styles = css`
    :host {
      display: block;
      height: 100%;
      min-height: 0;
    }
    .wb-host {
      height: 100%;
      min-height: 0;
    }
    .wb-error {
      padding: 24px;
      color: #94a3b8;
      font-family: 'Segoe UI', system-ui, sans-serif;
      font-size: 0.85rem;
    }
  `;

  constructor() {
    super();
    this.host = null;
    this.signal = null;
    this.error = '';
    this._cleanup = null;
    this._generation = 0;
  }

  createRenderRoot() {
    return this;
  }

  connectedCallback() {
    super.connectedCallback();
    this._mountView();
  }

  disconnectedCallback() {
    this._teardown();
    super.disconnectedCallback();
  }

  async _mountView() {
    const generation = ++this._generation;
    this._teardown();
    try {
      const module = await import(VIEW_MODULE_URL);
      if (generation !== this._generation || this.signal?.aborted) return;
      const render = module.render || module.default;
      if (typeof render !== 'function') {
        throw new Error('webos-desktop-view.js must export render()');
      }
      const mountNode = this.querySelector('[data-webos-view-root]');
      if (!mountNode) return;
      this._cleanup = render(mountNode, { host: this.host, signal: this.signal });
    } catch (error) {
      if (generation !== this._generation) return;
      this.error = error?.message || String(error);
    }
  }

  _teardown() {
    if (typeof this._cleanup === 'function') {
      try { this._cleanup(); } catch { /* view already gone */ }
    }
    this._cleanup = null;
  }

  render() {
    if (this.error) {
      return html`<div class="wb-error" data-state="mount-error">${this.error}</div>`;
    }
    return html`<div class="wb-host" data-webos-view-root></div>`;
  }

  updated() {
    if (!this._cleanup && !this.error && this.isConnected) {
      this._mountView();
    }
  }
}

if (!customElements.get('openclaw-webos-desktop-tab')) {
  customElements.define('openclaw-webos-desktop-tab', OpenclawWebosDesktopTab);
}

/**
 * Control UI plugin entry. Gateway loads this file (controlUi.entry) and
 * calls `activate(host)`. Registers a `surface:tab` replacement whose mount
 * is a Lit ControlUiView (DOM mount, not a URL).
 */
export default {
  id: 'openclaw-webos',
  activate(host) {
    const mount = (container, context) => {
      const view = document.createElement('openclaw-webos-desktop-tab');
      view.host = context.host;
      view.signal = context.signal;
      container.replaceChildren(view);
      return {
        update(next) {
          view.host = next.host;
          view.signal = next.signal;
        },
        dispose() {
          view.remove();
        },
      };
    };

    const disposers = [
      host.ui.registerReplacement({
        id: 'desktop',
        label: 'OpenClaw Desktop',
        surface: 'tab',
        mount,
      }),
    ];

    return () => {
      for (const dispose of [...disposers].reverse()) dispose();
    };
  },
};
