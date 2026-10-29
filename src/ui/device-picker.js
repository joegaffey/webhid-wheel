import { WebHIDElement } from './base.js';

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
    if (typeof this._boundManager.off === 'function') {
      this._boundManager.off('connect', this._managerHandler);
      this._boundManager.off('disconnect', this._managerHandler);
      this._boundManager.off('error', this._managerHandler);
      this._boundManager.off('input', this._managerHandler);
    }
    this._boundManager = null;
  }

  _bindManager() {
    if (!this._manager || this._boundManager === this._manager) return;
    this._unbindManager();
    if (typeof this._manager.on !== 'function') return;
    this._manager.on('connect', this._managerHandler);
    this._manager.on('disconnect', this._managerHandler);
    this._manager.on('error', this._managerHandler);
    this._manager.on('input', this._managerHandler);
    this._boundManager = this._manager;
  }

  css() {
    return `
      .head { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-bottom: 6px; }
      .device-name { color: var(--wheel-fg-color, #e6e8eb); }
      .device-id { color: var(--wheel-muted-color, #8f9bab); font-size: 10px; }
      .caps { display: flex; gap: 4px; flex-wrap: wrap; justify-content: flex-end; }
      .cap { font-size: 9px; border: 1px solid var(--wheel-border-color, #2a303a); border-radius: 999px; padding: 1px 5px; color: var(--wheel-muted-color, #8f9bab); }
      .cap.on { color: var(--wheel-success, #34d399); border-color: currentColor; }
      .remove { min-height: 22px; padding: 2px 6px; }
    `;
  }

  template() {
    return `
      <div class="panel">
        <div class="head">
          <h3>Devices</h3>
          <span class="badge" data-role="hid-state"></span>
        </div>
        <div class="status" data-role="status" aria-live="polite"></div>
        <div class="list" data-role="list"></div>
        <div class="actions">
          <button class="primary" type="button" data-action="connect">Connect device</button>
          <button type="button" data-action="disconnect-all">Disconnect all</button>
        </div>
      </div>
    `;
  }

  bind() {
    const root = this.shadowRoot;
    root.querySelector('[data-action="connect"]').addEventListener('click', () => this._connect());
    root.querySelector('[data-action="disconnect-all"]').addEventListener('click', () => this._disconnectAll());
    root.querySelector('[data-role="list"]').addEventListener('click', (event) => {
      const button = event.target.closest('[data-remove]');
      if (button) this._disconnect(button.dataset.remove);
    });
  }

  async _connect() {
    if (!this.manager || this._busy) return;
    this._busy = true;
    this.refresh();
    try {
      const session = await this.manager.connect();
      if (session) {
        this.emit('webhid-connect', { session, device: session.device });
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

  async _disconnect(id) {
    if (!this.manager || this._busy) return;
    this._busy = true;
    this.refresh();
    try {
      await this.manager.disconnect(id);
    } catch (error) {
      this.emit('webhid-error', { error });
    } finally {
      this._busy = false;
      this.refresh();
    }
  }

  async _disconnectAll() {
    if (!this.manager || this._busy) return;
    this._busy = true;
    this.refresh();
    try {
      await this.manager.disconnectAll();
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
    const list = this.shadowRoot.querySelector('[data-role="list"]');
    const status = this.shadowRoot.querySelector('[data-role="status"]');
    const state = this.shadowRoot.querySelector('[data-role="hid-state"]');
    const connect = this.shadowRoot.querySelector('[data-action="connect"]');
    const disconnectAll = this.shadowRoot.querySelector('[data-action="disconnect-all"]');
    const sessions = this.manager ? this.manager.sessionList : [];
    const connected = sessions.filter(entry => entry.session && entry.session.isConnected);

    state.textContent = available ? 'WebHID available' : 'WebHID unavailable';
    if (!this.manager) {
      status.textContent = 'No wheel manager configured.';
      status.className = 'status error';
    } else if (!available) {
      status.textContent = 'WebHID is not available in this browser. Keyboard, gamepad and touch input continue in the host app.';
      status.className = 'status error';
    } else if (connected.length) {
      status.textContent = `${connected.length} device${connected.length === 1 ? '' : 's'} connected.`;
      status.className = 'status ready';
    } else {
      status.textContent = 'No devices connected. Connect from a user gesture to grant WebHID permission.';
      status.className = 'status';
    }

    connect.disabled = !this.manager || !available || this._busy;
    connect.textContent = this._busy ? 'Connecting…' : 'Connect device';
    disconnectAll.disabled = !this.manager || !connected.length || this._busy;

    list.innerHTML = sessions.length
      ? sessions.map(entry => {
        const caps = entry.capabilities || {};
        const isConnected = !!(entry.session && entry.session.isConnected);
        return `
          <div class="list-item">
            <div>
              <div class="device-name">${escapeHtml(entry.name || entry.id)}</div>
              <div class="device-id">${escapeHtml(entry.id)} · ${escapeHtml(entry.driver)}</div>
            </div>
            <div class="caps">
              <span class="cap ${isConnected ? 'on' : ''}">${isConnected ? 'on' : 'off'}</span>
              <span class="cap ${caps.steering ? 'on' : ''}">steering</span>
              <span class="cap ${caps.ffb ? 'on' : ''}">FFB</span>
              <span class="cap ${caps.axes || caps.buttons || caps.hats ? 'on' : ''}">input</span>
              <button class="remove" type="button" data-remove="${escapeHtml(entry.id)}"${isConnected ? '' : ' disabled'}>Remove</button>
            </div>
          </div>
        `;
      }).join('')
      : '<div class="muted">No devices yet.</div>';
  }
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, ch => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[ch]));
}
