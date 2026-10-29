import { WebHIDElement } from './base.js';

const DEFAULTS = { maxRotation: 900, deadzone: 0, saturation: 1, invertSteering: false, gain: 0.25, invertForce: false };

export class WebHIDSteeringConfig extends WebHIDElement {
  constructor() {
    super();
    this._sync = false;
    this._settingsOverride = null;
    this._boundManager = null;
    this._managerHandler = () => this.refresh();
  }

  connectedCallback() {
    super.connectedCallback();
    this._bindManager();
  }

  disconnectedCallback() {
    this._unbindManager();
  }

  set settings(value) {
    this._settingsOverride = value || null;
    if (this.isConnected) this.refresh();
  }

  get settings() {
    return this._settingsOverride;
  }

  set manager(value) {
    if (this._manager === (value || null)) return;
    this._unbindManager();
    this._manager = value || null;
    if (this.isConnected) {
      this._bindManager();
      this.refresh();
    }
  }

  get manager() {
    return this._manager;
  }

  _bindManager() {
    if (!this._manager || this._boundManager === this._manager) return;
    this._unbindManager();
    if (typeof this._manager.on !== 'function') return;
    this._manager.on('connect', this._managerHandler);
    this._manager.on('disconnect', this._managerHandler);
    this._manager.on('setup-applied', this._managerHandler);
    this._boundManager = this._manager;
  }

  _unbindManager() {
    if (!this._boundManager) return;
    if (typeof this._boundManager.off === 'function') {
      this._boundManager.off('connect', this._managerHandler);
      this._boundManager.off('disconnect', this._managerHandler);
      this._boundManager.off('setup-applied', this._managerHandler);
    }
    this._boundManager = null;
  }

  css() {
    return `
      .section + .section { margin-top: 10px; padding-top: 8px; border-top: 1px solid var(--wheel-border-color, #2a303a); }
      .check { display: flex; align-items: center; gap: 6px; margin: 6px 0; }
      .device-field { display: grid; grid-template-columns: 1fr minmax(120px, 1.4fr); gap: 4px 8px; align-items: center; margin: 6px 0; }
      .device-field label { color: var(--wheel-muted-color, #8f9bab); }
      ::slotted(*) { display: block; }
    `;
  }

  template() {
    return `
      <div class="panel">
        <slot name="visual"></slot>
        <div class="section">
          <h3>Steering</h3>
          <div class="device-field">
            <label for="steering-source">Steering source</label>
            <select id="steering-source" data-role="steering-source"></select>
          </div>
          <div class="field">
            <label for="max-rotation">Rotation range</label>
            <output data-out="max-rotation">900°</output>
            <input id="max-rotation" data-setting="maxRotation" type="range" min="40" max="1800" step="10">
          </div>
          <div class="field">
            <label for="deadzone">Deadzone</label>
            <output data-out="deadzone">0%</output>
            <input id="deadzone" data-setting="deadzone" type="range" min="0" max="0.5" step="0.01">
          </div>
          <div class="field">
            <label for="saturation">Saturation</label>
            <output data-out="saturation">100%</output>
            <input id="saturation" data-setting="saturation" type="range" min="0.05" max="1" step="0.01">
          </div>
          <label class="check"><input data-setting="invertSteering" type="checkbox"> Invert steering</label>
        </div>
        <div class="section">
          <h3>Force feedback</h3>
          <div class="device-field">
            <label for="ffb-target">Force output</label>
            <select id="ffb-target" data-role="ffb-target"></select>
          </div>
          <div class="field">
            <label for="gain">Force gain</label>
            <output data-out="gain">25%</output>
            <input id="gain" data-setting="gain" type="range" min="0" max="1" step="0.01">
          </div>
          <label class="check"><input data-setting="invertForce" type="checkbox"> Invert force</label>
          <div class="actions">
            <button type="button" data-action="stop">Stop FFB</button>
            <button type="button" data-action="reset">Reset</button>
          </div>
        </div>
        <slot name="extra"></slot>
      </div>
    `;
  }

  bind() {
    for (const input of this.shadowRoot.querySelectorAll('[data-setting]')) {
      input.addEventListener('input', () => this._apply());
      input.addEventListener('change', () => this._apply());
    }
    this.shadowRoot.querySelector('[data-role="steering-source"]').addEventListener('change', (event) => {
      if (!this.manager || typeof this.manager.setMapping !== 'function') return;
      this.manager.setMapping({ steering: { device: event.target.value || null } });
      this.refresh();
      this.emit('webhid-change', { settings: this.manager.getCalibration() });
    });
    this.shadowRoot.querySelector('[data-role="ffb-target"]').addEventListener('change', (event) => {
      if (!this.manager || typeof this.manager.setFfb !== 'function') return;
      this.manager.setFfb({ device: event.target.value || null });
      this.refresh();
      this.emit('webhid-change', { settings: this.manager.getFfb() });
    });
    this.shadowRoot.querySelector('[data-action="stop"]').addEventListener('click', () => {
      if (this.manager && typeof this.manager.stop === 'function') this.manager.stop();
    });
    this.shadowRoot.querySelector('[data-action="reset"]').addEventListener('click', () => {
      this._write(DEFAULTS);
      this._apply();
    });
  }

  _read() {
    const root = this.shadowRoot;
    return {
      maxRotation: Number(root.querySelector('[data-setting="maxRotation"]').value),
      deadzone: Number(root.querySelector('[data-setting="deadzone"]').value),
      saturation: Number(root.querySelector('[data-setting="saturation"]').value),
      invertSteering: root.querySelector('[data-setting="invertSteering"]').checked,
      gain: Number(root.querySelector('[data-setting="gain"]').value),
      invertForce: root.querySelector('[data-setting="invertForce"]').checked
    };
  }

  _write(values) {
    if (!this.shadowRoot) return;
    const root = this.shadowRoot;
    const set = (name, value) => {
      const input = root.querySelector(`[data-setting="${name}"]`);
      if (!input) return;
      if (input.type === 'checkbox') input.checked = !!value;
      else input.value = String(value);
    };
    set('maxRotation', values.maxRotation);
    set('deadzone', values.deadzone);
    set('saturation', values.saturation);
    set('invertSteering', values.invertSteering);
    set('gain', values.gain);
    set('invertForce', values.invertForce);
    this._outputs(values);
  }

  _outputs(values) {
    const root = this.shadowRoot;
    if (!root) return;
    const out = (name) => root.querySelector(`[data-out="${name}"]`);
    const maxRotation = out('max-rotation');
    const deadzone = out('deadzone');
    const saturation = out('saturation');
    const gain = out('gain');
    if (maxRotation) maxRotation.textContent = `${Math.round(values.maxRotation)}°`;
    if (deadzone) deadzone.textContent = `${Math.round(values.deadzone * 100)}%`;
    if (saturation) saturation.textContent = `${Math.round(values.saturation * 100)}%`;
    if (gain) gain.textContent = `${Math.round(values.gain * 100)}%`;
  }

  _apply() {
    if (this._sync) return;
    const values = this._read();
    this._outputs(values);
    if (this.manager) {
      this.manager.setCalibration({
        deadzone: values.deadzone,
        saturation: values.saturation,
        invert: values.invertSteering,
        maxRotation: values.maxRotation
      });
      this.manager.setFfb({ gain: values.gain, invert: values.invertForce });
    }
    this.emit('webhid-change', { settings: values });
  }

  _devices(predicate) {
    const devices = [];
    if (!this.manager || !this.manager.sessionList) return devices;
    for (const entry of this.manager.sessionList) {
      if (entry.session && entry.session.isConnected && predicate(entry)) devices.push(entry);
    }
    return devices;
  }

  _fillSelect(select, devices, current, placeholder) {
    if (!select) return;
    const options = devices.map(device => `<option value="${escapeHtml(device.id)}"${device.id === current ? ' selected' : ''}>${escapeHtml(device.name || device.id)}</option>`);
    if (current && !devices.some(device => device.id === current)) {
      options.unshift(`<option value="${escapeHtml(current)}" selected>Missing device (${escapeHtml(current)})</option>`);
    }
    select.innerHTML = `<option value=""${current ? '' : ' selected'}>${placeholder}</option>${options.join('')}`;
  }

  refresh() {
    if (!this.shadowRoot || !this.shadowRoot.querySelector('[data-setting="maxRotation"]')) return;
    this._bindManager();
    const manager = this.manager;
    const calibration = manager && typeof manager.getCalibration === 'function' ? manager.getCalibration() : {};
    const ffb = manager && typeof manager.getFfb === 'function' ? manager.getFfb() : {};
    const override = this._settingsOverride || {};
    const values = {
      maxRotation: calibration.maxRotation !== undefined ? calibration.maxRotation : (override.maxRotation !== undefined ? override.maxRotation : DEFAULTS.maxRotation),
      deadzone: calibration.deadzone !== undefined ? calibration.deadzone : (override.deadzone !== undefined ? override.deadzone : DEFAULTS.deadzone),
      saturation: calibration.saturation !== undefined ? calibration.saturation : (override.saturation !== undefined ? override.saturation : DEFAULTS.saturation),
      invertSteering: calibration.invert !== undefined ? calibration.invert : (override.invertSteering !== undefined ? override.invertSteering : DEFAULTS.invertSteering),
      gain: ffb.gain !== undefined ? ffb.gain : (override.gain !== undefined ? override.gain : DEFAULTS.gain),
      invertForce: ffb.invert !== undefined ? ffb.invert : (override.invertForce !== undefined ? override.invertForce : DEFAULTS.invertForce)
    };

    this._fillSelect(
      this.shadowRoot.querySelector('[data-role="steering-source"]'),
      this._devices(entry => entry.capabilities && entry.capabilities.steering),
      calibration.device || null,
      'No steering device'
    );
    this._fillSelect(
      this.shadowRoot.querySelector('[data-role="ffb-target"]'),
      this._devices(entry => entry.capabilities && entry.capabilities.ffb),
      ffb.device || null,
      'No force-feedback device'
    );

    this._sync = true;
    this._write(values);
    this._sync = false;
  }
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, ch => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[ch]));
}
