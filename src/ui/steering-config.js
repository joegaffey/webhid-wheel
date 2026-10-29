import { WebHIDElement } from './base.js';

const DEFAULTS = { maxRotation: 900, deadzone: 0, saturation: 1, invertSteering: false, gain: 0.25, invertForce: false };

export class WebHIDSteeringConfig extends WebHIDElement {
  constructor() {
    super();
    this._sync = false;
    this._settingsOverride = null;
  }

  set settings(value) {
    this._settingsOverride = value || null;
    if (this.isConnected) this.refresh();
  }

  get settings() {
    return this._settingsOverride;
  }

  css() {
    return `
      .section + .section { margin-top: 10px; padding-top: 8px; border-top: 1px solid var(--wheel-border-color, #2a303a); }
      .check { display: flex; align-items: center; gap: 6px; margin: 6px 0; }
    `;
  }

  template() {
    return `
      <div class="panel">
        <div class="section">
          <h3>Steering</h3>
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
      </div>
    `;
  }

  bind() {
    for (const input of this.shadowRoot.querySelectorAll('[data-setting]')) {
      input.addEventListener('input', () => this._apply());
      input.addEventListener('change', () => this._apply());
    }
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
    out('max-rotation').textContent = `${Math.round(values.maxRotation)}°`;
    out('deadzone').textContent = `${Math.round(values.deadzone * 100)}%`;
    out('saturation').textContent = `${Math.round(values.saturation * 100)}%`;
    out('gain').textContent = `${Math.round(values.gain * 100)}%`;
  }

  _apply() {
    if (this._sync) return;
    const values = this._read();
    this._outputs(values);
    if (this.manager) {
      this.manager.setCalibration({
        deadzone: values.deadzone,
        saturation: values.saturation,
        invert: values.invertSteering
      });
      this.manager.setFfb({ gain: values.gain, invert: values.invertForce });
      if (this.manager.wheel) this.manager.wheel.maxRotation = values.maxRotation;
      this.manager.maxRotation = values.maxRotation;
    }
    this.emit('webhid-change', { settings: values });
  }

  refresh() {
    if (!this.shadowRoot || !this.shadowRoot.querySelector('[data-setting="maxRotation"]')) return;
    const manager = this.manager;
    const override = this._settingsOverride || {};
    const calibration = manager && typeof manager.getCalibration === 'function' ? manager.getCalibration() : {};
    const ffb = manager && typeof manager.getFfb === 'function' ? manager.getFfb() : {};
    const values = {
      maxRotation: manager && manager.maxRotation !== undefined ? manager.maxRotation : (override.maxRotation !== undefined ? override.maxRotation : DEFAULTS.maxRotation),
      deadzone: calibration.deadzone !== undefined ? calibration.deadzone : (override.deadzone !== undefined ? override.deadzone : DEFAULTS.deadzone),
      saturation: calibration.saturation !== undefined ? calibration.saturation : (override.saturation !== undefined ? override.saturation : DEFAULTS.saturation),
      invertSteering: calibration.invert !== undefined ? calibration.invert : (override.invertSteering !== undefined ? override.invertSteering : DEFAULTS.invertSteering),
      gain: ffb.gain !== undefined ? ffb.gain : (override.gain !== undefined ? override.gain : DEFAULTS.gain),
      invertForce: ffb.invert !== undefined ? ffb.invert : (override.invertForce !== undefined ? override.invertForce : DEFAULTS.invertForce)
    };
    this._sync = true;
    this._write(values);
    this._sync = false;
  }
}
