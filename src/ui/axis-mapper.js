import { WebHIDElement } from './base.js';

const CHANNELS = [
  ['throttle', 'Throttle'],
  ['brake', 'Brake'],
  ['clutch', 'Clutch'],
  ['handbrake', 'Handbrake']
];

export class WebHIDAxisMapper extends WebHIDElement {
  constructor() {
    super();
    this._boundManager = null;
    this._liveQueued = false;
    this._capture = null;
    this._mappingOverride = null;
  }

  set mapping(value) {
    this._mappingOverride = value || null;
    if (this.isConnected) this.render();
  }

  get mapping() {
    return this._mappingOverride;
  }

  connectedCallback() {
    super.connectedCallback();
    this._bindManager();
  }

  disconnectedCallback() {
    this._unbindManager();
  }

  set manager(value) {
    if (this._manager === (value || null)) return;
    this._unbindManager();
    this._manager = value || null;
    if (this.isConnected) this.render();
  }

  get manager() {
    return this._manager;
  }

  _unbindManager() {
    if (!this._boundManager) return;
    if (typeof this._boundManager.off === 'function') {
      this._boundManager.off('input', this._managerHandler);
      this._boundManager.off('connect', this._rolesHandler);
      this._boundManager.off('disconnect', this._rolesHandler);
      this._boundManager.off('setup-applied', this._managerHandler);
    }
    this._boundManager = null;
  }

  _bindManager() {
    if (!this._manager || this._boundManager === this._manager) return;
    this._unbindManager();
    if (typeof this._manager.on !== 'function') return;
    this._managerHandler = () => this.scheduleLive();
    this._rolesHandler = () => this.render();
    this._manager.on('input', this._managerHandler);
    this._manager.on('connect', this._rolesHandler);
    this._manager.on('disconnect', this._rolesHandler);
    this._manager.on('setup-applied', this._managerHandler);
    this._boundManager = this._manager;
  }

  scheduleLive() {
    if (this._liveQueued) return;
    this._liveQueued = true;
    const run = () => {
      this._liveQueued = false;
      this._updateLive();
    };
    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(run);
    else setTimeout(run, 16);
  }

  css() {
    return `
      .mapping { display: grid; grid-template-columns: 72px minmax(100px, 1fr) 54px 40px auto; gap: 5px; align-items: center; margin: 5px 0; }
      .mapping input[type="number"] { width: 100%; }
      .live { font-variant-numeric: tabular-nums; color: var(--wheel-muted-color, #8f9bab); min-width: 40px; text-align: right; }
      .mapping.armed { outline: 1px solid var(--wheel-accent, #38bdf8); outline-offset: 2px; }
      .mapping .actions { align-items: center; justify-content: flex-end; }
      .mapping .check span { display: none; }
      @media (max-width: 560px) {
        .mapping {
          grid-template-columns: minmax(0, 1fr) 56px 40px;
          gap: 6px 8px;
          padding: 8px;
          margin: 8px 0;
          border: 1px solid var(--wheel-border-color, #2a303a);
          border-radius: 4px;
          background: rgba(255, 255, 255, .02);
        }
        .mapping > label:not(.check) { grid-column: 1; grid-row: 1; align-self: baseline; color: var(--wheel-fg-color, #e6e8eb); font-weight: 600; }
        .mapping .actions { display: contents; }
        .mapping .live { grid-column: 2 / -1; grid-row: 1; align-self: baseline; justify-self: end; text-align: right; line-height: inherit; }
        .mapping > select[data-field="device"] { grid-column: 1 / 3; grid-row: 2; min-width: 0; }
        .mapping > input[data-field="index"] { grid-column: 3; grid-row: 2; width: 100%; }
        .mapping > .check { grid-column: 1; grid-row: 3; margin: 0; }
        .mapping > .check span { display: inline; }
        .mapping .actions [data-action="set"] { grid-column: 2; grid-row: 3; justify-self: start; }
        .mapping .actions [data-action="clear"] { grid-column: 3; grid-row: 3; justify-self: end; }
      }
    `;
  }

  _devices() {
    if (!this.manager || !this.manager.sessionList) return [];
    return this.manager.sessionList.filter(entry =>
      entry.session && entry.session.isConnected &&
      entry.capabilities && entry.capabilities.axes > 0
    );
  }

  _options(devices, current) {
    const options = devices.map(device => {
      const label = device.name || device.id;
      return `<option value="${escapeHtml(device.id)}"${device.id === current ? ' selected' : ''}>${escapeHtml(label)}</option>`;
    });
    if (current && !devices.some(device => device.id === current)) {
      options.unshift(`<option value="${escapeHtml(current)}" selected>Missing device (${escapeHtml(current)})</option>`);
    }
    if (!options.length) options.push('<option value="">No devices</option>');
    return options.join('');
  }

  template() {
    const mapping = this.manager && typeof this.manager.getMapping === 'function'
      ? this.manager.getMapping().axes
      : (this._mappingOverride && (this._mappingOverride.axes || this._mappingOverride) || {});
    const devices = this._devices();
    const disabled = devices.length ? '' : ' disabled';
    const rows = CHANNELS.map(([channel, label]) => {
      const entry = mapping[channel] || {};
      const device = entry.device || (devices[0] && devices[0].id) || '';
      const index = Number.isInteger(entry.index) ? entry.index : 0;
      const invert = !!entry.invert;
      return `
        <div class="mapping" data-channel="${channel}">
          <label title="${label}">${label}</label>
          <select data-field="device"${disabled}>${this._options(devices, device)}</select>
          <input data-field="index" type="number" min="0" step="1" value="${index}" aria-label="${label} axis index"${disabled}>
          <label class="check" title="Invert"><input data-field="invert" type="checkbox"${invert ? ' checked' : ''}${disabled}><span>Invert</span></label>
          <div class="actions">
            <span class="live" data-live="0.00">0.00</span>
            <button type="button" data-action="set"${disabled}>Set</button>
            <button type="button" data-action="clear"${disabled}>Clear</button>
          </div>
        </div>
      `;
    }).join('');
    return `
      <div class="panel">
        <div class="row"><h3>Pedals and axes</h3><span class="muted">Set, then move the input</span></div>
        <div data-role="rows">${rows}</div>
      </div>
    `;
  }

  bind() {
    for (const row of this.shadowRoot.querySelectorAll('[data-channel]')) {
      for (const field of row.querySelectorAll('[data-field]')) {
        field.addEventListener('change', () => this._commit());
      }
      row.querySelector('[data-action="set"]').addEventListener('click', () => this._arm(row.dataset.channel));
      row.querySelector('[data-action="clear"]').addEventListener('click', () => {
        const mapping = this.manager && this.manager.getMapping ? this.manager.getMapping() : { axes: {}, buttons: {} };
        delete mapping.axes[row.dataset.channel];
        if (this.manager) this.manager.setMapping(mapping);
        this.emit('webhid-change', { mapping });
        this._updateLive();
      });
    }
  }

  _row(channel) {
    return this.shadowRoot.querySelector(`[data-channel="${channel}"]`);
  }

  _commit() {
    if (!this.manager || typeof this.manager.setMapping !== 'function') return;
    const mapping = this.manager.getMapping();
    for (const [channel] of CHANNELS) {
      const row = this._row(channel);
      if (!row) continue;
      const device = row.querySelector('[data-field="device"]').value;
      if (!device) {
        delete mapping.axes[channel];
        continue;
      }
      mapping.axes[channel] = {
        device,
        source: 'axis',
        index: Math.max(0, Math.floor(Number(row.querySelector('[data-field="index"]').value) || 0)),
        invert: row.querySelector('[data-field="invert"]').checked
      };
    }
    this.manager.setMapping(mapping);
    this._updateLive();
    this.emit('webhid-change', { mapping });
  }

  _arm(channel) {
    const row = this._row(channel);
    if (!row) return;
    const device = row.querySelector('[data-field="device"]').value;
    if (!device) return;
    const state = this._stateFor(device);
    this._capture = {
      channel,
      device,
      baseline: state && state.axes ? state.axes.slice() : [],
      started: Date.now()
    };
    row.classList.add('armed');
    row.querySelector('[data-action="set"]').textContent = 'Listening…';
  }

  _stateFor(id) {
    if (!this.manager || !this.manager.sessions) return null;
    const entry = this.manager.sessions.get(id);
    if (!entry) return null;
    return entry.driver === 'wheel'
      ? (entry.session.deviceState || entry.session.state)
      : entry.session.state;
  }

  _updateLive() {
    if (!this.shadowRoot) return;
    const capture = this._capture;
    if (capture && Date.now() - capture.started > 10000) this._cancelCapture();

    for (const [channel] of CHANNELS) {
      const row = this._row(channel);
      if (!row) continue;
      const id = row.querySelector('[data-field="device"]').value;
      const index = Math.max(0, Math.floor(Number(row.querySelector('[data-field="index"]').value) || 0));
      const state = this._stateFor(id);
      const raw = state && state.axes ? Number(state.axes[index]) : 0;
      const mapped = this.manager && this.manager.channels ? Number(this.manager.channels[channel]) : raw;
      row.querySelector('[data-live]').textContent = Number.isFinite(mapped) ? mapped.toFixed(2) : '0.00';

      if (capture && capture.channel === channel) {
        const axes = state && state.axes ? state.axes : [];
        let best = -1;
        let bestDelta = 0.1;
        for (let i = 0; i < axes.length; i += 1) {
          const base = capture.baseline[i] === undefined ? 0 : capture.baseline[i];
          const delta = Math.abs(Number(axes[i]) - Number(base));
          if (delta > bestDelta) { bestDelta = delta; best = i; }
        }
        if (best >= 0) {
          row.querySelector('[data-field="index"]').value = String(best);
          this._cancelCapture();
          this._commit();
          this.emit('webhid-capture', { channel, device: id, source: 'axis', index: best });
        }
      }
    }
  }

  _cancelCapture() {
    if (!this._capture) return;
    const row = this._row(this._capture.channel);
    if (row) {
      row.classList.remove('armed');
      row.querySelector('[data-action="set"]').textContent = 'Set';
    }
    this._capture = null;
  }

  refresh() {
    if (!this.shadowRoot || !this.shadowRoot.querySelector('[data-role="rows"]')) return;
    this._bindManager();
    this._updateLive();
  }
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, ch => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[ch]));
}
