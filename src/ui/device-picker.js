import { WebHIDElement } from './base.js';

export class WebHIDDevicePicker extends WebHIDElement {
  constructor() {
    super();
    this._boundManager = null;
    this._managerHandler = () => this.scheduleRefresh();
    this._hidHandler = () => this.scheduleRefresh();
    this._busy = false;
    this._selectedId = null;
    this._error = '';
  }

  set selectedId(value) {
    this._selectedId = value || null;
    if (this.isConnected) this.refresh();
  }

  get selectedId() {
    return this._selectedId;
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
      .list-item { cursor: pointer; }
      .list-item.selected { border-color: var(--wheel-accent, #38bdf8); box-shadow: inset 0 0 0 1px var(--wheel-accent, #38bdf8); }
      slot[name="extra"] { display: block; }
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
          <button type="button" data-action="copy" title="Copy diagnostic JSON">Copy</button>
          <button type="button" data-action="export" title="Download diagnostic JSON">Export</button>
        </div>
        <slot name="extra"></slot>
      </div>
    `;
  }

  bind() {
    const root = this.shadowRoot;
    root.querySelector('[data-action="connect"]').addEventListener('click', () => this._connect());
    root.querySelector('[data-action="disconnect-all"]').addEventListener('click', () => this._disconnectAll());
    root.querySelector('[data-action="copy"]').addEventListener('click', () => this.emit('webhid-copy', { sessions: this._connectedSessions() }));
    root.querySelector('[data-action="export"]').addEventListener('click', () => this.emit('webhid-export', { sessions: this._connectedSessions() }));
    root.querySelector('[data-role="list"]').addEventListener('click', (event) => {
      const remove = event.target.closest('[data-remove]');
      if (remove) {
        this._disconnect(remove.dataset.remove);
        return;
      }
      const row = event.target.closest('[data-select]');
      if (!row) return;
      this._selectedId = row.dataset.select;
      this.refresh();
      const entry = this.manager && this.manager.sessions ? this.manager.sessions.get(this._selectedId) : null;
      if (entry) this.emit('webhid-select', { session: entry });
    });
  }

  async _connect() {
    if (!this.manager || this._busy) return;
    this._busy = true;
    this._error = '';
    // Call requestDevice from the original gesture task, before touching the DOM.
    const pending = this.manager.connect();
    this.refresh();
    try {
      const session = await pending;
      if (session) {
        this._error = '';
        this.emit('webhid-connect', { session, device: session.device });
      } else {
        this._error = 'No device selected. Check the device connection and choose it in the browser prompt.';
        this.emit('webhid-authorization-required', {
          filters: (this.manager.options && this.manager.options.filters) || []
        });
      }
    } catch (error) {
      this._error = this._connectErrorMessage(error);
      this.emit('webhid-error', { error });
    } finally {
      this._busy = false;
      this.refresh();
    }
  }

  _connectErrorMessage(error) {
    const name = error && error.name;
    if (name === 'NotAllowedError' || name === 'SecurityError') {
      return 'Device selection was cancelled or permission was denied.';
    }
    if (name === 'NotSupportedError') {
      return 'WebHID device selection is not supported in this browser.';
    }
    return error && error.message ? error.message : String(error || 'Could not connect the device.');
  }

  async _disconnect(id) {
    if (!this.manager || this._busy) return;
    this._busy = true;
    this._error = '';
    this.refresh();
    try {
      await this.manager.disconnect(id);
    } catch (error) {
      this._error = this._connectErrorMessage(error);
      this.emit('webhid-error', { error });
    } finally {
      this._busy = false;
      this.refresh();
    }
  }

  async _disconnectAll() {
    if (!this.manager || this._busy) return;
    this._busy = true;
    this._error = '';
    this.refresh();
    try {
      await this.manager.disconnectAll();
    } catch (error) {
      this._error = this._connectErrorMessage(error);
      this.emit('webhid-error', { error });
    } finally {
      this._busy = false;
      this.refresh();
    }
  }

  _connectedSessions() {
    if (!this.manager) return [];
    return this.manager.sessionList.filter(entry => entry.session && entry.session.isConnected);
  }

  refresh() {
    if (!this.shadowRoot || !this.shadowRoot.querySelector('[data-role="status"]')) return;
    this._bindManager();

    const hid = typeof navigator !== 'undefined' ? navigator.hid : null;
    const available = !!hid;
    const canRequest = !!(hid && typeof hid.requestDevice === 'function');
    const list = this.shadowRoot.querySelector('[data-role="list"]');
    const status = this.shadowRoot.querySelector('[data-role="status"]');
    const state = this.shadowRoot.querySelector('[data-role="hid-state"]');
    const connect = this.shadowRoot.querySelector('[data-action="connect"]');
    const disconnectAll = this.shadowRoot.querySelector('[data-action="disconnect-all"]');
    const copy = this.shadowRoot.querySelector('[data-action="copy"]');
    const exportButton = this.shadowRoot.querySelector('[data-action="export"]');
    const sessions = this._connectedSessions();
    const connected = sessions;

    if (!this._selectedId || !sessions.some(entry => entry.id === this._selectedId)) {
      this._selectedId = sessions[0] ? sessions[0].id : null;
    }
    if (connected.length) this._error = '';

    state.textContent = available ? 'WebHID available' : 'WebHID unavailable';
    if (!this.manager) {
      status.textContent = 'No wheel manager configured.';
      status.className = 'status error';
    } else if (!available) {
      status.textContent = 'WebHID is not available in this browser. Use a Chromium browser with WebHID enabled (desktop Chrome/Edge or Chrome Beta) over HTTPS; keyboard, gamepad and touch input continue in the host app.';
      status.className = 'status error';
    } else if (!canRequest) {
      status.textContent = 'WebHID is available, but this browser build does not expose device selection (requestDevice).';
      status.className = 'status error';
    } else if (this._error) {
      status.textContent = this._error;
      status.className = 'status error';
    } else if (connected.length) {
      status.textContent = `${connected.length} device${connected.length === 1 ? '' : 's'} connected.`;
      status.className = 'status ready';
    } else {
      status.textContent = 'No devices connected. Connect from a user gesture to grant WebHID permission.';
      status.className = 'status';
    }

    connect.disabled = !this.manager || !canRequest || this._busy;
    connect.title = !available
      ? 'WebHID is not available in this browser build'
      : (canRequest ? 'Connect a WebHID device' : 'Device selection is not available in this browser build');
    connect.textContent = this._busy ? 'Connecting…' : 'Connect device';
    disconnectAll.disabled = !this.manager || !connected.length || this._busy;
    copy.disabled = !sessions.length || this._busy;
    exportButton.disabled = !sessions.length || this._busy;

    list.innerHTML = sessions.length
      ? sessions.map(entry => {
        const caps = entry.capabilities || {};
        const isConnected = !!(entry.session && entry.session.isConnected);
        return `
          <div class="list-item${entry.id === this._selectedId ? ' selected' : ''}" data-select="${escapeHtml(entry.id)}">
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
