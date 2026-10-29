import { WebHIDElement } from './base.js';

export const BUTTON_ACTIONS = [
  ['reverse', 'Reverse'],
  ['neutral', 'Neutral'],
  ['gear1', 'Gear 1'],
  ['gear2', 'Gear 2'],
  ['gear3', 'Gear 3'],
  ['gear4', 'Gear 4'],
  ['gear5', 'Gear 5'],
  ['gear6', 'Gear 6'],
  ['gear7', 'Gear 7'],
  ['gear8', 'Gear 8'],
  ['gearUp', 'Shift up'],
  ['gearDown', 'Shift down'],
  ['handbrake', 'Handbrake']
];

const HAT_DIRECTIONS = ['up', 'up-right', 'right', 'down-right', 'down', 'down-left', 'left', 'up-left'];

export class WebHIDButtonMapper extends WebHIDElement {
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
      .mapping { display: grid; grid-template-columns: 76px minmax(100px, 1fr) 78px 54px 70px auto; gap: 5px; align-items: center; margin: 4px 0; }
      .mapping input[type="number"] { width: 100%; }
      .mapping.direction-hidden { grid-template-columns: 76px minmax(100px, 1fr) 78px 54px auto; }
      .mapping.direction-hidden select[data-field="direction"] { display: none; }
      .live { font-variant-numeric: tabular-nums; color: var(--wheel-muted-color, #8f9bab); min-width: 38px; text-align: right; }
      .mapping.armed { outline: 1px solid var(--wheel-accent, #38bdf8); outline-offset: 2px; }
      .mapping .actions { align-items: center; justify-content: flex-end; }
      .mapping .buttons { display: flex; gap: 6px; }
      @media (max-width: 560px) {
        .mapping, .mapping.direction-hidden {
          grid-template-columns: minmax(0, 1fr) 70px 70px;
          gap: 6px 8px;
          padding: 8px;
          margin: 8px 0;
          border: 1px solid var(--wheel-border-color, #2a303a);
          border-radius: 4px;
          background: rgba(255, 255, 255, .02);
        }
        .mapping > label { grid-column: 1; grid-row: 1; align-self: baseline; color: var(--wheel-fg-color, #e6e8eb); font-weight: 600; }
        .mapping .actions { display: contents; }
        .mapping .live { grid-column: 2 / -1; grid-row: 1; align-self: baseline; justify-self: end; text-align: right; line-height: inherit; }
        .mapping > select[data-field="device"] { grid-column: 1 / -1; grid-row: 2; min-width: 0; }
        .mapping > select[data-field="source"] { grid-column: 1; grid-row: 3; min-width: 0; }
        .mapping > input[data-field="index"] { grid-column: 2; grid-row: 3; width: 100%; }
        .mapping > select[data-field="direction"] { grid-column: 3; grid-row: 3; min-width: 0; }
        .mapping.direction-hidden > select[data-field="source"] { grid-column: 1 / 3; }
        .mapping.direction-hidden > input[data-field="index"] { grid-column: 3; }
        .mapping .actions .buttons { grid-column: 2 / -1; grid-row: 4; justify-self: end; }
      }
    `;
  }

  _devices() {
    if (!this.manager || !this.manager.sessionList) return [];
    return this.manager.sessionList.filter(entry =>
      entry.session && entry.session.isConnected &&
      entry.capabilities && (entry.capabilities.buttons > 0 || entry.capabilities.hats > 0)
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
      ? this.manager.getMapping().buttons
      : (this._mappingOverride && (this._mappingOverride.buttons || this._mappingOverride) || {});
    const devices = this._devices();
    const disabled = devices.length ? '' : ' disabled';
    const rows = BUTTON_ACTIONS.map(([channel, label]) => {
      const entry = mapping[channel] || {};
      const device = entry.device || (devices[0] && devices[0].id) || '';
      const source = entry.source === 'hat' ? 'hat' : 'button';
      const index = Number.isInteger(entry.index) ? entry.index : 0;
      const direction = entry.direction || 'up';
      return `
        <div class="mapping${source === 'hat' ? '' : ' direction-hidden'}" data-channel="${channel}">
          <label>${label}</label>
          <select data-field="device"${disabled}>${this._options(devices, device)}</select>
          <select data-field="source"${disabled}>
            <option value="button"${source === 'button' ? ' selected' : ''}>button</option>
            <option value="hat"${source === 'hat' ? ' selected' : ''}>hat</option>
          </select>
          <input data-field="index" type="number" min="0" step="1" value="${index}" aria-label="${label} index"${disabled}>
          <select data-field="direction"${disabled}>${HAT_DIRECTIONS.map(dir => `<option value="${dir}"${dir === direction ? ' selected' : ''}>${dir}</option>`).join('')}</select>
          <div class="actions">
            <span class="live" data-live="0.00">0.00</span>
            <div class="buttons">
              <button type="button" data-action="set"${disabled}>Set</button>
              <button type="button" data-action="clear"${disabled}>Clear</button>
            </div>
          </div>
        </div>
      `;
    }).join('');
    return `
      <div class="panel">
        <div class="row"><h3>Buttons and shifters</h3><span class="muted">Set, then press the input</span></div>
        <div data-role="rows">${rows}</div>
      </div>
    `;
  }

  bind() {
    for (const row of this.shadowRoot.querySelectorAll('[data-channel]')) {
      for (const field of row.querySelectorAll('[data-field]')) {
        field.addEventListener('change', () => {
          if (field.dataset.field === 'source') {
            row.classList.toggle('direction-hidden', field.value !== 'hat');
          }
          this._commit();
        });
      }
      row.querySelector('[data-action="set"]').addEventListener('click', () => this._arm(row.dataset.channel));
      row.querySelector('[data-action="clear"]').addEventListener('click', () => {
        const mapping = this.manager && this.manager.getMapping ? this.manager.getMapping() : { axes: {}, buttons: {} };
        delete mapping.buttons[row.dataset.channel];
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
    for (const [channel] of BUTTON_ACTIONS) {
      const row = this._row(channel);
      if (!row) continue;
      const device = row.querySelector('[data-field="device"]').value;
      if (!device) {
        delete mapping.buttons[channel];
        continue;
      }
      const source = row.querySelector('[data-field="source"]').value;
      const entry = {
        device,
        source,
        index: Math.max(0, Math.floor(Number(row.querySelector('[data-field="index"]').value) || 0))
      };
      if (source === 'hat') entry.direction = row.querySelector('[data-field="direction"]').value;
      mapping.buttons[channel] = entry;
    }
    this.manager.setMapping(mapping);
    this._updateLive();
    this.emit('webhid-change', { mapping });
  }

  _stateFor(id) {
    if (!this.manager || !this.manager.sessions) return null;
    const entry = this.manager.sessions.get(id);
    if (!entry) return null;
    return entry.driver === 'wheel'
      ? (entry.session.deviceState || entry.session.state)
      : entry.session.state;
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
      source: row.querySelector('[data-field="source"]').value,
      baselineButtons: state && state.buttons ? state.buttons.slice() : [],
      baselineHats: state && state.hats ? state.hats.map(hat => ({ ...hat })) : [],
      started: Date.now()
    };
    row.classList.add('armed');
    row.querySelector('[data-action="set"]').textContent = 'Listening…';
  }

  _updateLive() {
    if (!this.shadowRoot) return;
    const capture = this._capture;
    if (capture && Date.now() - capture.started > 10000) this._cancelCapture();

    for (const [channel] of BUTTON_ACTIONS) {
      const row = this._row(channel);
      if (!row) continue;
      const id = row.querySelector('[data-field="device"]').value;
      const source = row.querySelector('[data-field="source"]').value;
      const index = Math.max(0, Math.floor(Number(row.querySelector('[data-field="index"]').value) || 0));
      const direction = row.querySelector('[data-field="direction"]').value;
      const state = this._stateFor(id);
      let value = 0;
      if (source === 'button') {
        value = state && state.buttons && state.buttons[index] ? 1 : 0;
      } else {
        const hat = state && state.hats ? state.hats[index] : null;
        value = hat && hat.direction === direction ? 1 : 0;
      }
      row.querySelector('[data-live]').textContent = value ? 'pressed' : '0';

      if (capture && capture.channel === channel) {
        if (capture.source === 'button') {
          const buttons = state && state.buttons ? state.buttons : [];
          let best = -1;
          for (let i = 0; i < buttons.length; i += 1) {
            if (buttons[i] && !capture.baselineButtons[i]) { best = i; break; }
          }
          if (best >= 0) {
            row.querySelector('[data-field="index"]').value = String(best);
            this._cancelCapture();
            this._commit();
            this.emit('webhid-capture', { channel, device: id, source: 'button', index: best });
          }
        } else {
          const hats = state && state.hats ? state.hats : [];
          let best = -1;
          let bestDirection = null;
          for (let i = 0; i < hats.length; i += 1) {
            const before = capture.baselineHats[i] || {};
            if (hats[i] && hats[i].direction && hats[i].direction !== before.direction) {
              best = i;
              bestDirection = hats[i].direction;
              break;
            }
          }
          if (best >= 0) {
            row.querySelector('[data-field="index"]').value = String(best);
            row.querySelector('[data-field="direction"]').value = bestDirection;
            this._cancelCapture();
            this._commit();
            this.emit('webhid-capture', { channel, device: id, source: 'hat', index: best, direction: bestDirection });
          }
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
