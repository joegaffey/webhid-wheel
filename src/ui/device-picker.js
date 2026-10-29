import { WebHIDElement } from './base.js';

export class WebHIDDevicePicker extends WebHIDElement {
  constructor() {
    super();
    this._boundManager = null;
    this._managerHandler = () => this.scheduleRefresh();
    this._hidHandler = () => this.scheduleRefresh();
    this._busy = false;
    this._selectedId = null;
    this._connectTimer = null;
    this._profileDevices = [];
    this._removing = new Set();
    this._diagnostics = false;
  }

  set selectedId(value) {
    this._selectedId = value || null;
    if (this.isConnected) this.refresh();
  }

  get selectedId() {
    return this._selectedId;
  }

  set profileDevices(value) {
    this._profileDevices = Array.isArray(value) ? value : [];
    if (this.isConnected) this.refresh();
  }

  get profileDevices() {
    return this._profileDevices;
  }

  set diagnostics(value) {
    const next = !!value;
    if (this._diagnostics === next) return;
    this._diagnostics = next;
    if (this.isConnected) this.render();
  }

  get diagnostics() {
    return this._diagnostics;
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
    if (this._connectTimer) {
      clearTimeout(this._connectTimer);
      this._connectTimer = null;
    }
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
    this._boundManager = this._manager;
  }

  css() {
    return `
      .head { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-bottom: 6px; }
      .device-name { color: var(--wheel-fg-color, #e6e8eb); }
      .device-id { color: var(--wheel-muted-color, #8f9bab); font-size: 10px; }
      .caps { display: flex; gap: 4px; flex-wrap: wrap; justify-content: flex-end; align-items: center; }
      .cap { display: inline-flex; align-items: center; justify-content: center; line-height: 1; font-size: 9px; border: 1px solid var(--wheel-border-color, #2a303a); border-radius: 999px; padding: 2px 6px; color: var(--wheel-muted-color, #8f9bab); }
      .cap.on { color: var(--wheel-success, #34d399); border-color: currentColor; }
      .cap.off { color: var(--wheel-danger, #f87171); border-color: currentColor; }
      .remove, .device-action { min-height: 22px; padding: 2px 6px; }
      .list-item { cursor: pointer; }
      .list-item.selected { border-color: var(--wheel-accent, #38bdf8); box-shadow: inset 0 0 0 1px var(--wheel-accent, #38bdf8); }
      .list-item.offline { cursor: default; }
      slot[name="extra"] { display: block; }
      .diagnostics { margin-top: 8px; padding-top: 6px; border-top: 1px solid var(--wheel-border-color, #2a303a); }
      .diagnostics summary { color: var(--wheel-muted-color, #8f9bab); cursor: pointer; font-size: 10px; letter-spacing: .08em; text-transform: uppercase; }
      .diagnostics .actions { margin-top: 6px; }
    `;
  }

  template() {
    const diagnostics = this._diagnostics ? `
      <details class="diagnostics">
        <summary>Diagnostics</summary>
        <slot name="diagnostics"></slot>
        <div class="actions">
          <button type="button" data-action="copy" title="Copy diagnostic JSON">Copy diagnostic JSON</button>
          <button type="button" data-action="export" title="Download diagnostic JSON">Download JSON</button>
        </div>
      </details>
    ` : '';
    return `
      <div class="panel">
        <div class="head">
          <h3>Devices</h3>
          <span class="badge" data-role="hid-state"></span>
        </div>
        <div class="list" data-role="list"></div>
        <div class="actions">
          <button class="primary" type="button" data-action="connect">Add device</button>
        </div>
        <slot name="extra"></slot>
        ${diagnostics}
      </div>
    `;
  }

  bind() {
    const root = this.shadowRoot;
    root.querySelector('[data-action="connect"]').addEventListener('click', () => this._connect());
    const copy = root.querySelector('[data-action="copy"]');
    if (copy) copy.addEventListener('click', () => this.emit('webhid-copy', { sessions: this._connectedSessions() }));
    const exportButton = root.querySelector('[data-action="export"]');
    if (exportButton) exportButton.addEventListener('click', () => this.emit('webhid-export', { sessions: this._connectedSessions() }));
    root.querySelector('[data-role="list"]').addEventListener('click', (event) => {
      const action = event.target.closest('[data-action]');
      if (action) {
        event.preventDefault();
        event.stopPropagation();
        this._handleAction(action.dataset.action, action.dataset);
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

  _handleAction(action, data) {
    if (action === 'remove-session') {
      this._removeSession(data.id);
    } else if (action === 'connect-profile') {
      this._connectProfileDevice(data.alias);
    } else if (action === 'remove-profile') {
      this._removeProfileDevice(data.alias);
    }
  }

  async _connect() {
    if (!this.manager || this._busy) return;
    this._busy = true;
    // Call requestDevice from the original gesture task, before touching the DOM.
    const pending = this.manager.connect();
    this.refresh();
    this._connectTimer = setTimeout(() => {
      this._connectTimer = null;
      if (!this._busy) return;
      this._busy = false;
      this.refresh();
      const error = new Error('Device selection timed out.');
      error.name = 'TimeoutError';
      this.emit('webhid-error', { error });
    }, 30000);
    try {
      const session = await pending;
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
      if (this._connectTimer) {
        clearTimeout(this._connectTimer);
        this._connectTimer = null;
      }
      this._busy = false;
      this.refresh();
    }
  }

  async _disconnect(id) {
    if (!this.manager || !id) return;
    try {
      await this.manager.disconnect(id);
    } catch (error) {
      this.emit('webhid-error', { error });
    } finally {
      this.refresh();
    }
  }

  async _removeSession(id) {
    if (!this.manager) return;
    const entry = this.manager.sessions.get(id);
    if (!entry) return;
    this._removing.add(id);
    this.refresh();
    this.emit('webhid-remove-device', { session: entry, hardware: entry.hardware });
    try {
      await this._disconnect(id);
    } finally {
      this._removing.delete(id);
      this.refresh();
    }
  }

  _removeProfileDevice(alias) {
    const device = this._profileDevices.find(item => item.alias === alias);
    if (!device) return;
    this.emit('webhid-remove-device', { hardware: device.hardware, alias });
  }

  async _connectProfileDevice(alias) {
    const device = this._profileDevices.find(item => item.alias === alias);
    if (!device || !this.manager || typeof navigator === 'undefined' || !navigator.hid) return;
    const hardware = device.hardware;
    try {
      const granted = await navigator.hid.getDevices();
      let match = granted.find(item => hardwareMatches(hardware, item));
      if (!match) {
        const filters = [{ vendorId: hardware.vendorId, productId: hardware.productId }];
        const picked = await navigator.hid.requestDevice({ filters });
        match = picked[0] || null;
      }
      if (match) await this.manager.connect(match);
    } catch (error) {
      this.emit('webhid-error', { error });
    } finally {
      this.refresh();
    }
  }

  _connectedSessions() {
    if (!this.manager) return [];
    return this.manager.sessionList.filter(entry =>
      entry.session && entry.session.isConnected && !this._removing.has(entry.id)
    );
  }

  _sessionForHardware(hardware) {
    return this._connectedSessions().find(entry => hardwareMatches(hardware, entry.hardware));
  }

  _meta(hardware, driver) {
    const signature = hardware && hardware.signature ? `#${hardware.signature.slice(0, 6)}` : null;
    return [
      `${hex(hardware && hardware.vendorId)}:${hex(hardware && hardware.productId)}`,
      driver === 'wheel' ? 'wheel' : 'HID device',
      signature
    ].filter(Boolean).join(' · ');
  }

  _sessionRow(entry) {
    const caps = entry.capabilities || {};
    const pills = [];
    if (caps.steering) pills.push('steering');
    if (caps.ffb) pills.push('FFB');
    if (caps.axes || caps.buttons || caps.hats) pills.push('input');
    return `
      <div class="list-item${entry.id === this._selectedId ? ' selected' : ''}" data-select="${escapeHtml(entry.id)}">
        <div>
          <div class="device-name">${escapeHtml(entry.name || entry.id)}</div>
          <div class="device-id">${escapeHtml(this._meta(entry.hardware, entry.driver))}</div>
        </div>
        <div class="caps">
          ${pills.map(label => `<span class="cap">${label}</span>`).join('')}
          <button class="remove" type="button" data-action="remove-session" data-id="${escapeHtml(entry.id)}">Remove</button>
        </div>
      </div>
    `;
  }

  _profileRow(device) {
    return `
      <div class="list-item offline">
        <div>
          <div class="device-name">${escapeHtml(device.hardware.productName || 'Offline device')}</div>
          <div class="device-id">${escapeHtml(this._meta(device.hardware, device.driver))}</div>
        </div>
        <div class="caps">
          <span class="cap off">offline</span>
          <button class="device-action" type="button" data-action="connect-profile" data-alias="${escapeHtml(device.alias)}">Add</button>
          <button class="remove" type="button" data-action="remove-profile" data-alias="${escapeHtml(device.alias)}">Remove</button>
        </div>
      </div>
    `;
  }

  refresh() {
    if (!this.shadowRoot || !this.shadowRoot.querySelector('[data-role="list"]')) return;
    this._bindManager();

    const hid = typeof navigator !== 'undefined' ? navigator.hid : null;
    const available = !!hid;
    const canRequest = !!(hid && typeof hid.requestDevice === 'function');
    const list = this.shadowRoot.querySelector('[data-role="list"]');
    const state = this.shadowRoot.querySelector('[data-role="hid-state"]');
    const connect = this.shadowRoot.querySelector('[data-action="connect"]');
    const copy = this.shadowRoot.querySelector('[data-action="copy"]');
    const exportButton = this.shadowRoot.querySelector('[data-action="export"]');
    const sessions = this._connectedSessions();
    const usedSessions = new Set();

    if (!this._selectedId || !sessions.some(entry => entry.id === this._selectedId)) {
      this._selectedId = sessions[0] ? sessions[0].id : null;
    }

    state.textContent = available ? 'WebHID available' : 'WebHID unavailable';
    connect.disabled = !this.manager || !canRequest || this._busy;
    connect.title = !available
      ? 'WebHID is not available in this browser build'
      : (canRequest ? 'Add a WebHID device' : 'Device selection is not available in this browser build');
    connect.textContent = this._busy ? 'Adding…' : 'Add device';
    if (copy) copy.disabled = !sessions.length || this._busy;
    if (exportButton) exportButton.disabled = !sessions.length || this._busy;

    const rows = [];
    for (const device of this._profileDevices) {
      const session = this._sessionForHardware(device.hardware);
      if (session) {
        usedSessions.add(session.id);
        rows.push(this._sessionRow(session));
      } else {
        rows.push(this._profileRow(device));
      }
    }
    for (const entry of sessions) {
      if (usedSessions.has(entry.id)) continue;
      rows.push(this._sessionRow(entry));
    }

    list.innerHTML = rows.length ? rows.join('') : '<div class="muted">No devices added</div>';
  }
}

function hardwareMatches(hardware, entryHardware) {
  if (!hardware || !entryHardware) return false;
  if (hardware.vendorId !== entryHardware.vendorId || hardware.productId !== entryHardware.productId) return false;
  return !hardware.signature || hardware.signature === entryHardware.signature;
}

function hex(value, width = 4) {
  if (value === undefined || value === null) return '----';
  return '0x' + Number(value).toString(16).toUpperCase().padStart(width, '0');
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, ch => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[ch]));
}
