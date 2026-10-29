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
    const manager = this._boundManager;
    if (typeof manager.off === 'function') {
      manager.off('input', this._managerHandler);
      manager.off('connect', this._managerHandler);
      manager.off('disconnect', this._managerHandler);
      manager.off('setup-applied', this._managerHandler);
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
      .mapping { display: grid; grid-template-columns: 72px minmax(70px, 1fr) 54px 40px auto; gap: 5px; align-items: center; margin: 5px 0; }
      .mapping input[type="number"] { width: 100%; }
      .live { font-variant-numeric: tabular-nums; color: var(--wheel-muted-color, #8f9bab); min-width: 40px; text-align: right; }
      .mapping.armed { outline: 1px solid var(--wheel-accent, #38bdf8); outline-offset: 2px; }
      .mapping .actions { justify-content: flex-end; }
      @media (max-width: 560px) {
        .mapping { grid-template-columns: minmax(60px, 1fr) 62px 40px; }
        .mapping > label { grid-column: 1 / -1; }
        .mapping .actions { grid-column: 1 / -1; justify-content: flex-start; }
      }
    `;
  }

  _roles() {
    const roles = ['wheel'];
    if (this.manager && this.manager.sessions) {
      for (const role of this.manager.sessions.keys()) {
        if (role !== 'wheel' && !roles.includes(role)) roles.push(role);
      }
    }
    return roles;
  }

  template() {
    const mapping = this.manager && typeof this.manager.getMapping === 'function'
      ? this.manager.getMapping().axes
      : (this._mappingOverride && (this._mappingOverride.axes || this._mappingOverride) || {});
    const roles = this._roles();
    const rows = CHANNELS.map(([channel, label]) => {
      const entry = mapping[channel] || {};
      const device = entry.device || 'wheel';
      const index = Number.isInteger(entry.index) ? entry.index : 0;
      const invert = !!entry.invert;
      return `
        <div class="mapping" data-channel="${channel}">
          <label title="${label}">${label}</label>
          <select data-field="device">${roles.map(role => `<option value="${escapeHtml(role)}"${role === device ? ' selected' : ''}>${escapeHtml(role)}</option>`).join('')}</select>
          <input data-field="index" type="number" min="0" step="1" value="${index}" aria-label="${label} axis index">
          <label class="check" title="Invert"><input data-field="invert" type="checkbox"${invert ? ' checked' : ''}></label>
          <div class="actions">
            <span class="live" data-live="0.00">0.00</span>
            <button type="button" data-action="set">Set</button>
            <button type="button" data-action="clear">Clear</button>
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
    const root = this.shadowRoot;
    for (const row of root.querySelectorAll('[data-channel]')) {
      for (const field of row.querySelectorAll('[data-field]')) {
        field.addEventListener('change', () => this._commit());
      }
      row.querySelector('[data-action="set"]').addEventListener('click', () => this._arm(row.dataset.channel));
      row.querySelector('[data-action="clear"]').addEventListener('click', () => {
        const mapping = this.manager && this.manager.getMapping ? this.manager.getMapping() : { axes: {}, buttons: {} };
        delete mapping.axes[row.dataset.channel];
        if (this.manager) this.manager.setMapping(mapping);
        this.emit('webhid-change', { mapping });
        this.refresh();
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
      mapping.axes[channel] = {
        device: row.querySelector('[data-field="device"]').value,
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
    const entry = {
      device: row.querySelector('[data-field="device"]').value,
      index: Math.max(0, Math.floor(Number(row.querySelector('[data-field="index"]').value) || 0))
    };
    const state = this._stateFor(entry.device);
    this._capture = {
      channel,
      device: entry.device,
      baseline: state && state.axes ? state.axes.slice() : [],
      started: Date.now()
    };
    row.classList.add('armed');
    row.querySelector('[data-action="set"]').textContent = 'Listening…';
  }

  _stateFor(role) {
    if (!this.manager) return null;
    const state = this.manager.state;
    if (role === 'wheel') return state.wheel;
    return state.devices && state.devices[role] ? state.devices[role] : null;
  }

  _updateLive() {
    if (!this.shadowRoot) return;
    const capture = this._capture;
    if (capture && Date.now() - capture.started > 10000) this._cancelCapture();

    for (const [channel] of CHANNELS) {
      const row = this._row(channel);
      if (!row) continue;
      const role = row.querySelector('[data-field="device"]').value;
      const index = Math.max(0, Math.floor(Number(row.querySelector('[data-field="index"]').value) || 0));
      const state = this._stateFor(role);
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
          this.emit('webhid-capture', { channel, device: role, source: 'axis', index: best });
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
