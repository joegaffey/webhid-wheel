import { WebHIDElement } from './base.js';
import { isForceFeedbackWheel } from '../core/index.js';

export class WebHIDDevicePicker extends WebHIDElement {
  constructor() {
    super();
    this._boundManager = null;
    this._managerHandler = () => this.scheduleRefresh();
    this._hidHandler = () => this.scheduleRefresh();
    this._busy = false;
  }

  connectedCallback() {
    super.connectedCallback();
    const hid = typeof navigator !== 'undefined' ? navigator.hid : null;
    if (hid && typeof hid.addEventListener === 'function') {
      hid.addEventListener('connect', this._hidHandler);
      hid.addEventListener('disconnect', this._hidHandler);
    }
  }

  disconnectedCallback() {
    const hid = typeof navigator !== 'undefined' ? navigator.hid : null;
    if (hid && typeof hid.removeEventListener === 'function') {
      hid.removeEventListener('connect', this._hidHandler);
      hid.removeEventListener('disconnect', this._hidHandler);
    }
    this._unbindManager();
  }

  set manager(value) {
    const next = value || null;
    if (this._manager === next) return;
    this._unbindManager();
    this._manager = next;
    if (this.isConnected) this.refresh();
  }

  get manager() {
    return this._manager;
  }

  _unbindManager() {
    if (!this._boundManager) return;
    const manager = this._boundManager;
    if (typeof manager.off === 'function') {
      manager.off('connect', this._managerHandler);
      manager.off('disconnect', this._managerHandler);
      manager.off('error', this._managerHandler);
      manager.off('input', this._managerHandler);
    }
    this._boundManager = null;
  }

  _bindManager() {
    if (!this._manager || this._boundManager === this._manager) return;
    this._unbindManager();
    const manager = this._manager;
    if (typeof manager.on === 'function') {
      manager.on('connect', this._managerHandler);
      manager.on('disconnect', this._managerHandler);
      manager.on('error', this._managerHandler);
      manager.on('input', this._managerHandler);
      this._boundManager = manager;
    }
  }

  css() {
    return `
      .head { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-bottom: 6px; }
      .device-name { color: var(--wheel-fg-color, #e6e8eb); }
      .role { color: var(--wheel-muted-color, #8f9bab); font-size: 10px; text-transform: uppercase; letter-spacing: .06em; }
    `;
  }

  template() {
    return `
      <div class="panel">
        <div class="head">
          <h3>Wheel device</h3>
          <span class="badge" data-role="hid-state"></span>
        </div>
        <div class="status" data-role="status" aria-live="polite"></div>
        <div class="list" data-role="list"></div>
        <div class="actions">
          <button class="primary" type="button" data-action="connect">Connect wheel</button>
          <button type="button" data-action="disconnect">Disconnect</button>
        </div>
      </div>
    `;
  }

  bind() {
    const root = this.shadowRoot;
    root.querySelector('[data-action="connect"]').addEventListener('click', () => this._connect());
    root.querySelector('[data-action="disconnect"]').addEventListener('click', () => this._disconnect());
  }

  async _connect() {
    if (!this.manager || this._busy) return;
    this._busy = true;
    this.refresh();
    try {
      const device = await this.manager.connectWheel();
      if (device) {
        this.emit('webhid-connect', { role: 'wheel', device });
      } else {
        this.emit('webhid-authorization-required', {
          filters: (this.manager.options && this.manager.options.filters) || []
        });
      }
    } catch (error) {
      this.emit('webhid-error', { error });
    } finally {
      this._busy = false;
      this.refresh();
    }
  }

  async _disconnect() {
    if (!this.manager || this._busy) return;
    this._busy = true;
    this.refresh();
    try {
      await this.manager.disconnect('wheel');
    } catch (error) {
      this.emit('webhid-error', { error });
    } finally {
      this._busy = false;
      this.refresh();
    }
  }

  refresh() {
    if (!this.shadowRoot || !this.shadowRoot.querySelector('[data-role="status"]')) return;
    this._bindManager();

    const hid = typeof navigator !== 'undefined' ? navigator.hid : null;
    const available = !!(hid && typeof hid.requestDevice === 'function');
    const connected = !!(this.manager && this.manager.isConnected);
    const status = this.shadowRoot.querySelector('[data-role="status"]');
    const state = this.shadowRoot.querySelector('[data-role="hid-state"]');
    const list = this.shadowRoot.querySelector('[data-role="list"]');
    const connect = this.shadowRoot.querySelector('[data-action="connect"]');
    const disconnect = this.shadowRoot.querySelector('[data-action="disconnect"]');

    state.textContent = available ? 'WebHID available' : 'WebHID unavailable';
    state.classList.toggle('ready', available);

    if (!this.manager) {
      status.textContent = 'No wheel manager configured.';
      status.className = 'status error';
    } else if (!available) {
      status.textContent = 'WebHID is not available in this browser. Keyboard, gamepad and touch input continue in the host app.';
      status.className = 'status error';
    } else if (connected) {
      const wheel = this.manager.wheel;
      const language = wheel && wheel.ffbCaps && wheel.ffbCaps.any ? 'Force feedback available.' : 'Input only; no force feedback reported.';
      status.textContent = `${wheel && wheel.name ? wheel.name : 'Wheel connected'}\n${language}`;
      status.className = 'status ready';
    } else {
      status.textContent = 'No wheel connected. Connect from a user gesture to grant WebHID permission.';
      status.className = 'status';
    }

    connect.disabled = !this.manager || !available || connected || this._busy;
    connect.textContent = this._busy ? 'Connecting…' : 'Connect wheel';
    disconnect.disabled = !this.manager || !connected || this._busy;

    const items = [];
    const sessions = this.manager ? this.manager.sessions : new Map();
    for (const [role, entry] of sessions) {
      const session = entry.session;
      const active = !!(session && session.isConnected);
      const name = session && session.name ? session.name : 'Not connected';
      const ffb = active && session && session.device ? isForceFeedbackWheel(session.device) : false;
      items.push(`
        <div class="list-item">
          <div>
            <div class="role">${escapeHtml(role)}</div>
            <div class="device-name">${escapeHtml(name)}</div>
          </div>
          <span class="badge">${active ? (ffb ? 'FFB' : 'input') : 'offline'}</span>
        </div>
      `);
    }
    list.innerHTML = items.length ? items.join('') : '<div class="muted">No sessions yet.</div>';
  }
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, ch => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[ch]));
}
