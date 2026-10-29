import { WebHIDWheel, WebHIDDevice, mapChannels } from './drivers.js';
import { clamp } from './calibration.js';
import {
  PROFILE_KIND,
  PROFILE_SCHEMA_VERSION,
  validateProfile
} from './profiles.js';

const WHEEL_ROLE = 'wheel';

function cloneMapping(mapping) {
  return {
    axes: { ...(mapping && mapping.axes ? mapping.axes : {}) },
    buttons: { ...(mapping && mapping.buttons ? mapping.buttons : {}) }
  };
}

export class WheelManager {
  constructor(options = {}) {
    this.options = { ...options };
    this.maxRotation = options.maxRotation !== undefined ? options.maxRotation : 900;
    this.ffbStrength = options.ffbStrength !== undefined ? options.ffbStrength : 0.25;
    this.ffbInvert = options.ffbInvert !== undefined ? options.ffbInvert : false;
    this.calibration = {
      deadzone: options.deadzone !== undefined ? options.deadzone : 0,
      saturation: options.saturation !== undefined ? options.saturation : 1,
      invert: options.invertSteering !== undefined ? options.invertSteering : false
    };
    this.mapping = cloneMapping(options.mapping);
    this._listeners = {};
    this._sessions = new Map();
    this._channels = {};
    this._setup = null;
  }

  on(event, fn) {
    (this._listeners[event] = this._listeners[event] || []).push(fn);
    return this;
  }

  off(event, fn) {
    const list = this._listeners[event];
    if (list) this._listeners[event] = list.filter(f => f !== fn);
    return this;
  }

  emit(event, payload) {
    const list = this._listeners[event];
    if (list) {
      for (const fn of list.slice()) {
        try { fn(payload); } catch (e) { /* listeners must not break the manager */ }
      }
    }
  }

  get wheel() {
    const entry = this._sessions.get(WHEEL_ROLE);
    return entry ? entry.session : null;
  }

  get sessions() {
    return new Map(this._sessions);
  }

  get isConnected() {
    return !!(this.wheel && this.wheel.isConnected);
  }

  get channels() {
    return { ...this._channels };
  }

  get state() {
    const wheelState = this.wheel ? this.wheel.state : null;
    const devices = {};
    for (const [role, entry] of this._sessions) {
      if (role === WHEEL_ROLE) continue;
      devices[role] = entry.session.state;
    }
    return {
      wheel: wheelState,
      devices,
      channels: this.channels,
      timestamp: this.wheel && this.wheel.timestamp !== undefined
        ? this.wheel.timestamp
        : 0
    };
  }

  _wheelOptions() {
    return {
      ...(this.options.wheelOptions || {}),
      filters: this.options.filters,
      maxRotation: this.maxRotation,
      ffbStrength: this.ffbStrength,
      ffbInvert: this.ffbInvert,
      deadzone: this.calibration.deadzone,
      saturation: this.calibration.saturation,
      invertSteering: this.calibration.invert
    };
  }

  _deviceOptions() {
    return {
      ...(this.options.deviceOptions || {}),
      filters: this.options.filters
    };
  }

  _attach(role, session) {
    const entry = { role, session };
    session.on('input', () => {
      this._recomputeChannels();
      this.emit('input', this.state);
    });
    session.on('connect', (device) => {
      this.emit('connect', { role, device, session });
    });
    session.on('disconnect', (device) => {
      this._recomputeChannels();
      this.emit('disconnect', { role, device, session });
    });
    session.on('error', (error) => {
      this.emit('error', error);
    });
    this._sessions.set(role, entry);
    return entry;
  }

  async connectWheel(device) {
    let entry = this._sessions.get(WHEEL_ROLE);
    if (!entry) {
      entry = this._attach(WHEEL_ROLE, new WebHIDWheel(this._wheelOptions()));
    }
    const connected = await entry.session.connect(device);
    if (connected) {
      this._applyWheelSettings();
      this._recomputeChannels();
    }
    return connected;
  }

  async addDevice(role, device) {
    if (!role || role === WHEEL_ROLE) {
      throw new Error('role must be a non-empty name other than "wheel"');
    }
    let entry = this._sessions.get(role);
    if (entry && entry.session.isConnected) return entry.session.device;
    if (!entry) {
      entry = this._attach(role, new WebHIDDevice(this._deviceOptions()));
    }
    const connected = await entry.session.connect(device);
    if (connected) this._recomputeChannels();
    return connected;
  }

  async disconnect(role = WHEEL_ROLE) {
    const entry = this._sessions.get(role);
    if (!entry) return;
    await entry.session.disconnect();
    this._recomputeChannels();
  }

  async disconnectAll() {
    for (const role of Array.from(this._sessions.keys())) {
      await this.disconnect(role);
    }
  }

  _applyWheelSettings() {
    const wheel = this.wheel;
    if (!wheel) return;
    wheel.maxRotation = this.maxRotation;
    wheel.deadzone = this.calibration.deadzone;
    wheel.saturation = this.calibration.saturation;
    wheel.invertSteering = this.calibration.invert;
    wheel.ffbStrength = this.ffbStrength;
    wheel.ffbInvert = this.ffbInvert;
  }

  setCalibration(calibration = {}) {
    if (calibration.deadzone !== undefined) {
      this.calibration.deadzone = clamp(Number(calibration.deadzone) || 0, 0, 0.5);
    }
    if (calibration.saturation !== undefined) {
      this.calibration.saturation = clamp(Number(calibration.saturation) || 1, 0.05, 1);
    }
    if (calibration.invert !== undefined) {
      this.calibration.invert = !!calibration.invert;
    }
    if (this.calibration.saturation <= this.calibration.deadzone) {
      this.calibration.saturation = Math.min(1, this.calibration.deadzone + 0.05);
    }
    this._applyWheelSettings();
    this._recomputeChannels();
    return this.getCalibration();
  }

  getCalibration() {
    return { ...this.calibration };
  }

  setFfb(ffb = {}) {
    if (ffb.gain !== undefined) this.ffbStrength = clamp(Number(ffb.gain) || 0, 0, 1);
    if (ffb.invert !== undefined) this.ffbInvert = !!ffb.invert;
    this._applyWheelSettings();
    return this.getFfb();
  }

  getFfb() {
    return { gain: this.ffbStrength, invert: this.ffbInvert };
  }

  setMapping(mapping = {}) {
    this.mapping = cloneMapping(mapping);
    this._recomputeChannels();
    return { axes: { ...this.mapping.axes }, buttons: { ...this.mapping.buttons } };
  }

  getMapping() {
    return { axes: { ...this.mapping.axes }, buttons: { ...this.mapping.buttons } };
  }

  applySetup(profile) {
    const normalized = validateProfile(profile);
    this.maxRotation = normalized.settings.steering.maxRotation;
    this.calibration = {
      deadzone: normalized.settings.steering.deadzone,
      saturation: normalized.settings.steering.saturation,
      invert: normalized.settings.steering.invert
    };
    this.ffbStrength = normalized.settings.ffb.gain;
    this.ffbInvert = normalized.settings.ffb.invert;
    this.mapping = {
      axes: { ...normalized.settings.axes },
      buttons: { ...normalized.settings.buttons }
    };
    this._setup = normalized;
    this._applyWheelSettings();
    this._recomputeChannels();
    this.emit('setup-applied', normalized);
    return normalized;
  }

  _hardware() {
    const device = this.wheel && this.wheel.device;
    if (!device) return this.options.hardware || null;
    return {
      vendorId: device.vendorId,
      productId: device.productId,
      productName: device.productName || '',
      signature: device.signature || (this.wheel && this.wheel.signature) || null
    };
  }

  toSetup(options = {}) {
    const hardware = options.hardware || this._hardware();
    if (!hardware) {
      throw new Error('connect a wheel before creating a setup profile');
    }
    return {
      kind: PROFILE_KIND,
      schemaVersion: PROFILE_SCHEMA_VERSION,
      profileName: options.profileName || (this._setup && this._setup.profileName) || 'Wheel setup',
      hardware,
      settings: {
        steering: {
          deadzone: this.calibration.deadzone,
          saturation: this.calibration.saturation,
          maxRotation: this.maxRotation,
          invert: this.calibration.invert
        },
        ffb: {
          gain: this.ffbStrength,
          invert: this.ffbInvert
        },
        axes: { ...this.mapping.axes },
        buttons: { ...this.mapping.buttons }
      },
      metadata: options.metadata || (this._setup && this._setup.metadata) || {}
    };
  }

  _recomputeChannels() {
    const channels = {};
    const wheelState = this.wheel
      ? (this.wheel.deviceState || this.wheel.state)
      : null;

    const stateFor = (entry) => {
      if (!entry || entry.device === WHEEL_ROLE || !entry.device) return wheelState;
      const session = this._sessions.get(entry.device);
      return session ? session.session.state : null;
    };

    for (const [channel, entry] of Object.entries(this.mapping.axes || {})) {
      const state = stateFor(entry);
      channels[channel] = state ? (mapChannels(state, { [channel]: entry })[channel] || 0) : 0;
    }
    for (const [channel, entry] of Object.entries(this.mapping.buttons || {})) {
      const state = stateFor(entry);
      channels[channel] = state ? (mapChannels(state, { [channel]: entry })[channel] || 0) : 0;
    }
    this._channels = channels;
  }

  constant(value) {
    return this.wheel && this.wheel.ffb ? this.wheel.ffb.constant(value) : Promise.resolve();
  }

  constantFast(value) {
    return this.wheel && this.wheel.ffb ? this.wheel.ffb.constantFast(value) : Promise.resolve();
  }

  stop() {
    return this.wheel && this.wheel.ffb ? this.wheel.ffb.stop() : Promise.resolve();
  }
}

export default WheelManager;
