import {
  WebHIDWheel,
  WebHIDDevice,
  mapChannels,
  detectDeviceCapabilities,
  deviceSignature
} from './drivers.js';
import { clamp } from './calibration.js';
import {
  PROFILE_KIND,
  PROFILE_SCHEMA_VERSION,
  validateProfile,
  matchProfile
} from './profiles.js';

const DEFAULT_STEERING = {
  deadzone: 0,
  saturation: 1,
  maxRotation: 900,
  invert: false
};

const DEFAULT_FFB = {
  gain: 0.25,
  invert: false
};

function cloneEntry(entry) {
  return entry ? { ...entry } : entry;
}

export class WheelManager {
  constructor(options = {}) {
    this.options = { ...options };
    this._listeners = {};
    this._sessions = new Map();
    this._channels = {};
    this._nextId = 1;
    this._profile = null;
    this._missingAliases = [];
    this._mapping = {
      steering: {
        device: null,
        deadzone: options.deadzone !== undefined ? options.deadzone : DEFAULT_STEERING.deadzone,
        saturation: options.saturation !== undefined ? options.saturation : DEFAULT_STEERING.saturation,
        maxRotation: options.maxRotation !== undefined ? options.maxRotation : DEFAULT_STEERING.maxRotation,
        invert: options.invertSteering !== undefined ? options.invertSteering : DEFAULT_STEERING.invert
      },
      ffb: {
        device: null,
        gain: options.ffbStrength !== undefined ? options.ffbStrength : DEFAULT_FFB.gain,
        invert: options.ffbInvert !== undefined ? options.ffbInvert : DEFAULT_FFB.invert
      },
      axes: {},
      buttons: {}
    };
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

  get sessions() {
    return new Map(this._sessions);
  }

  get sessionList() {
    return Array.from(this._sessions.values());
  }

  get isConnected() {
    return this.sessionList.some(entry => entry.session && entry.session.isConnected);
  }

  get channels() {
    return { ...this._channels };
  }

  get wheel() {
    const steering = this._sessions.get(this._mapping.steering.device);
    if (steering && steering.driver === 'wheel') return steering.session;
    const ffb = this._sessions.get(this._mapping.ffb.device);
    if (ffb && ffb.driver === 'wheel') return ffb.session;
    const fallback = this.sessionList.find(entry => entry.driver === 'wheel');
    return fallback ? fallback.session : null;
  }

  get maxRotation() {
    return this._mapping.steering.maxRotation;
  }

  set maxRotation(value) {
    const maxRotation = Number(value);
    if (Number.isFinite(maxRotation)) {
      this._mapping.steering.maxRotation = clamp(maxRotation, 40, 1800);
      this._applySteeringSettings();
      this._recomputeChannels();
    }
  }

  get ffbStrength() {
    return this._mapping.ffb.gain;
  }

  set ffbStrength(value) {
    this.setFfb({ gain: value });
  }

  get ffbInvert() {
    return this._mapping.ffb.invert;
  }

  set ffbInvert(value) {
    this.setFfb({ invert: value });
  }

  get state() {
    const sessions = {};
    let timestamp = 0;
    for (const entry of this._sessions.values()) {
      const instance = entry.session;
      sessions[entry.id] = {
        id: entry.id,
        name: entry.name,
        driver: entry.driver,
        capabilities: entry.capabilities,
        connected: !!(instance && instance.isConnected),
        state: instance ? instance.state : null
      };
      if (instance && typeof instance.timestamp === 'number') {
        timestamp = Math.max(timestamp, instance.timestamp);
      }
    }
    return {
      sessions,
      channels: this.channels,
      steering: this._channels.steering || 0,
      timestamp
    };
  }

  _wheelOptions() {
    return {
      ...(this.options.wheelOptions || {}),
      filters: this.options.filters,
      maxRotation: this.maxRotation,
      ffbStrength: this._mapping.ffb.gain,
      ffbInvert: this._mapping.ffb.invert,
      deadzone: this._mapping.steering.deadzone,
      saturation: this._mapping.steering.saturation,
      invertSteering: this._mapping.steering.invert
    };
  }

  _deviceOptions() {
    return {
      ...(this.options.deviceOptions || {}),
      filters: this.options.filters
    };
  }

  _nextSessionId() {
    let id;
    do {
      id = `device-${this._nextId++}`;
    } while (this._sessions.has(id));
    return id;
  }

  _attach(id, metadata, instance) {
    const entry = {
      id,
      name: metadata.name || metadata.device.productName || id,
      driver: metadata.driver,
      capabilities: metadata.capabilities,
      device: metadata.device,
      hardware: metadata.hardware,
      label: metadata.label || null,
      session: instance
    };

    instance.on('input', () => {
      this._recomputeChannels();
      this.emit('input', { ...this.state, sessionId: entry.id });
    });
    instance.on('disconnect', (device) => {
      this._recomputeChannels();
      this.emit('disconnect', { session: entry, device });
    });
    instance.on('error', (error) => this.emit('error', error));

    this._sessions.set(id, entry);
    return entry;
  }

  _hardwareFor(device, instance) {
    return {
      vendorId: device.vendorId,
      productId: device.productId,
      productName: device.productName || instance.name || '',
      signature: device.signature || (instance && instance.signature) || deviceSignature(device)
    };
  }

  _capabilitiesFor(entry) {
    const instance = entry.session;
    const base = { ...entry.capabilities };
    if (entry.driver === 'wheel') {
      base.steering = !!(instance.layout || (instance.profile && instance.profile.parse));
      base.ffb = !!(instance.ffbCaps && instance.ffbCaps.constant);
      base.axes = instance.inputLayout && instance.inputLayout.axes ? instance.inputLayout.axes.length : base.axes || 0;
      base.buttons = instance.inputLayout && instance.inputLayout.buttons ? instance.inputLayout.buttons.length : base.buttons || 0;
      base.hats = instance.inputLayout && instance.inputLayout.hats ? instance.inputLayout.hats.length : base.hats || 0;
    } else {
      base.steering = false;
      base.ffb = false;
      base.axes = instance.inputLayout && instance.inputLayout.axes ? instance.inputLayout.axes.length : base.axes || 0;
      base.buttons = instance.inputLayout && instance.inputLayout.buttons ? instance.inputLayout.buttons.length : base.buttons || 0;
      base.hats = instance.inputLayout && instance.inputLayout.hats ? instance.inputLayout.hats.length : base.hats || 0;
    }
    return base;
  }

  async connect(device, options = {}) {
    if (typeof navigator === 'undefined' || !navigator.hid) {
      throw new Error('WebHID not supported by browser or not available.');
    }
    let dev = device;
    if (!dev) {
      if (!navigator.hid.requestDevice) {
        throw new Error('WebHID requestDevice is not available; pass an authorized device.');
      }
      const devices = await navigator.hid.requestDevice({ filters: this.options.filters || [] });
      dev = devices[0];
    }
    if (!dev) return null;

    const signature = deviceSignature(dev);
    const existing = this.sessionList.find(entry =>
      entry.device === dev ||
      (!entry.session.isConnected &&
        entry.hardware &&
        entry.hardware.vendorId === dev.vendorId &&
        entry.hardware.productId === dev.productId &&
        entry.hardware.signature === signature)
    );
    if (existing) {
      if (!existing.session.isConnected) {
        const connected = await existing.session.connect(dev);
        if (!connected) return null;
        existing.device = dev;
        existing.name = existing.label || existing.session.name || dev.productName || existing.id;
        existing.hardware = this._hardwareFor(dev, existing.session);
        existing.capabilities = this._capabilitiesFor(existing);
        this._applySteeringSettings();
        this._applyFfbSettings();
        if (this._profile && this._missingAliases.length) this.applySetup(this._profile);
        else this._ensureDefaultBindings(existing);
        this.emit('connect', { session: existing, device: dev });
      }
      this._recomputeChannels();
      return existing;
    }

    const detected = detectDeviceCapabilities(dev);
    const driver = options.driver || detected.driver;
    const capabilities = {
      ...detected,
      steering: driver === 'wheel' ? detected.steering : false,
      ffb: driver === 'wheel' ? detected.ffb : false
    };
    const instance = driver === 'wheel'
      ? new WebHIDWheel(this._wheelOptions())
      : new WebHIDDevice(this._deviceOptions());
    const id = options.id || this._nextSessionId();
    const entry = this._attach(id, {
      name: options.label || dev.productName || id,
      driver,
      capabilities,
      device: dev,
      hardware: this._hardwareFor(dev, instance),
      label: options.label || null
    }, instance);

    let connected = null;
    try {
      connected = await instance.connect(dev);
    } catch (error) {
      this._sessions.delete(id);
      throw error;
    }
    if (!connected) {
      this._sessions.delete(id);
      return null;
    }

    entry.name = options.label || instance.name || dev.productName || id;
    entry.hardware = this._hardwareFor(dev, instance);
    entry.capabilities = this._capabilitiesFor(entry);
    this._applySteeringSettings();
    this._applyFfbSettings();

    if (this._profile && this._missingAliases.length) {
      this.applySetup(this._profile);
    } else {
      this._ensureDefaultBindings(entry);
    }

    this._recomputeChannels();
    this.emit('connect', { session: entry, device: dev });
    return entry;
  }

  async connectWheel(device) {
    const entry = await this.connect(device, { driver: 'wheel' });
    return entry ? entry.device : null;
  }

  async addDevice(roleOrDevice, maybeDevice) {
    let device = maybeDevice;
    let label = null;
    if (maybeDevice !== undefined) {
      label = roleOrDevice ? String(roleOrDevice) : null;
    } else {
      device = roleOrDevice;
    }
    const entry = await this.connect(device, { driver: 'generic', label });
    return entry ? entry.device : null;
  }

  _ensureDefaultBindings(entry) {
    if (entry.capabilities.steering && !this._mapping.steering.device) {
      this._mapping.steering.device = entry.id;
      if (entry.session && entry.session.maxRotation) {
        this._mapping.steering.maxRotation = entry.session.maxRotation;
      }
    }
    if (entry.capabilities.ffb && !this._mapping.ffb.device) {
      this._mapping.ffb.device = entry.id;
    }
    this._applySteeringSettings();
    this._applyFfbSettings();
  }

  _applySteeringSettings() {
    const entry = this._sessions.get(this._mapping.steering.device);
    if (!entry || entry.driver !== 'wheel') return;
    const instance = entry.session;
    instance.maxRotation = this._mapping.steering.maxRotation;
    instance.deadzone = this._mapping.steering.deadzone;
    instance.saturation = this._mapping.steering.saturation;
    instance.invertSteering = this._mapping.steering.invert;
  }

  _applyFfbSettings() {
    const entry = this._sessions.get(this._mapping.ffb.device);
    if (!entry || entry.driver !== 'wheel') return;
    entry.session.ffbStrength = this._mapping.ffb.gain;
    entry.session.ffbInvert = this._mapping.ffb.invert;
  }

  _stateFor(entry) {
    if (!entry || !entry.device) return null;
    const sessionEntry = this._sessions.get(entry.device);
    if (!sessionEntry) return null;
    const instance = sessionEntry.session;
    return sessionEntry.driver === 'wheel'
      ? (instance.deviceState || instance.state)
      : instance.state;
  }

  _recomputeChannels() {
    const channels = {};
    const steeringEntry = this._sessions.get(this._mapping.steering.device);
    if (steeringEntry && steeringEntry.driver === 'wheel' && Number.isFinite(steeringEntry.session.rotation)) {
      const maxRotation = this._mapping.steering.maxRotation || steeringEntry.session.maxRotation || 900;
      channels.steering = clamp(steeringEntry.session.rotation / (maxRotation / 2), -1, 1);
    } else {
      channels.steering = 0;
    }

    for (const [channel, entry] of Object.entries(this._mapping.axes || {})) {
      const state = this._stateFor(entry);
      channels[channel] = state ? (mapChannels(state, { [channel]: entry })[channel] || 0) : 0;
    }
    for (const [channel, entry] of Object.entries(this._mapping.buttons || {})) {
      const state = this._stateFor(entry);
      channels[channel] = state ? (mapChannels(state, { [channel]: entry })[channel] || 0) : 0;
    }
    this._channels = channels;
  }

  async disconnect(id) {
    const entry = this._sessions.get(id) || (id === undefined ? this._sessions.get(this._mapping.steering.device) : null);
    if (!entry) return;
    await entry.session.disconnect();
    this._recomputeChannels();
  }

  async disconnectAll() {
    for (const entry of this.sessionList) {
      await entry.session.disconnect();
    }
    this._recomputeChannels();
  }

  setCalibration(calibration = {}) {
    if (calibration.device !== undefined) {
      this._mapping.steering.device = calibration.device || null;
    }
    if (calibration.deadzone !== undefined) {
      this._mapping.steering.deadzone = clamp(Number(calibration.deadzone) || 0, 0, 0.5);
    }
    if (calibration.saturation !== undefined) {
      this._mapping.steering.saturation = clamp(Number(calibration.saturation) || 1, 0.05, 1);
    }
    if (calibration.invert !== undefined) {
      this._mapping.steering.invert = !!calibration.invert;
    }
    if (calibration.maxRotation !== undefined) {
      this._mapping.steering.maxRotation = clamp(Number(calibration.maxRotation) || 900, 40, 1800);
    }
    if (this._mapping.steering.saturation <= this._mapping.steering.deadzone) {
      this._mapping.steering.saturation = Math.min(1, this._mapping.steering.deadzone + 0.05);
    }
    this._applySteeringSettings();
    this._recomputeChannels();
    return this.getCalibration();
  }

  getCalibration() {
    return {
      device: this._mapping.steering.device,
      deadzone: this._mapping.steering.deadzone,
      saturation: this._mapping.steering.saturation,
      invert: this._mapping.steering.invert,
      maxRotation: this._mapping.steering.maxRotation
    };
  }

  setFfb(ffb = {}) {
    if (ffb.device !== undefined) this._mapping.ffb.device = ffb.device || null;
    if (ffb.gain !== undefined) this._mapping.ffb.gain = clamp(Number(ffb.gain) || 0, 0, 1);
    if (ffb.invert !== undefined) this._mapping.ffb.invert = !!ffb.invert;
    this._applyFfbSettings();
    return this.getFfb();
  }

  getFfb() {
    return {
      device: this._mapping.ffb.device,
      gain: this._mapping.ffb.gain,
      invert: this._mapping.ffb.invert
    };
  }

  setMapping(mapping = {}) {
    if (mapping.steering) {
      this._mapping.steering = { ...this._mapping.steering, ...mapping.steering };
    }
    if (mapping.ffb) {
      this._mapping.ffb = { ...this._mapping.ffb, ...mapping.ffb };
    }
    if (mapping.axes) {
      this._mapping.axes = Object.fromEntries(
        Object.entries(mapping.axes).map(([key, entry]) => [key, cloneEntry(entry)])
      );
    }
    if (mapping.buttons) {
      this._mapping.buttons = Object.fromEntries(
        Object.entries(mapping.buttons).map(([key, entry]) => [key, cloneEntry(entry)])
      );
    }
    this._applySteeringSettings();
    this._applyFfbSettings();
    this._recomputeChannels();
    return this.getMapping();
  }

  getMapping() {
    return {
      steering: { ...this._mapping.steering },
      ffb: { ...this._mapping.ffb },
      axes: Object.fromEntries(
        Object.entries(this._mapping.axes).map(([key, entry]) => [key, cloneEntry(entry)])
      ),
      buttons: Object.fromEntries(
        Object.entries(this._mapping.buttons).map(([key, entry]) => [key, cloneEntry(entry)])
      )
    };
  }

  _deviceObjects() {
    return this.sessionList
      .filter(entry => entry.session && entry.session.isConnected)
      .map(entry => entry.device)
      .filter(Boolean);
  }

  applySetup(profile) {
    const normalized = validateProfile(profile);
    this._profile = normalized;
    const result = matchProfile(normalized, this._deviceObjects());
    const aliases = {};
    for (const [alias, device] of Object.entries(result.matches)) {
      const entry = this.sessionList.find(item => item.device === device);
      if (entry) aliases[alias] = entry.id;
    }
    const resolve = alias => aliases[alias] || null;
    const settings = normalized.settings;

    this._mapping.steering = { ...settings.steering, device: resolve(settings.steering.device) };
    this._mapping.ffb = { ...settings.ffb, device: resolve(settings.ffb.device) };
    this._mapping.axes = Object.fromEntries(
      Object.entries(settings.axes).map(([key, entry]) => [
        key,
        { ...entry, device: resolve(entry.device) }
      ])
    );
    this._mapping.buttons = Object.fromEntries(
      Object.entries(settings.buttons).map(([key, entry]) => [
        key,
        { ...entry, device: resolve(entry.device) }
      ])
    );

    this._missingAliases = [
      ...result.missing.map(item => item.alias),
      ...result.ambiguous.map(item => item.alias)
    ];

    this._applySteeringSettings();
    this._applyFfbSettings();
    this._recomputeChannels();
    this.emit('setup-applied', {
      profile: normalized,
      matches: aliases,
      missing: this._missingAliases,
      ambiguous: result.ambiguous
    });
    return normalized;
  }

  _mergeSetup(base, options) {
    const mapping = this.getMapping();
    const devices = base.devices.map(device => ({
      ...device,
      hardware: { ...device.hardware }
    }));
    const aliasForSession = new Map();
    let nextAlias = devices.length + 1;

    for (const entry of this.sessionList) {
      let device = devices.find(candidate => {
        if (!entry.hardware) return false;
        if (candidate.hardware.vendorId !== entry.hardware.vendorId ||
            candidate.hardware.productId !== entry.hardware.productId) return false;
        return !candidate.hardware.signature || candidate.hardware.signature === entry.hardware.signature;
      });
      if (!device) {
        if (!entry.session || !entry.session.isConnected) continue;
        device = {
          alias: `d${nextAlias++}`,
          driver: entry.driver,
          hardware: { ...entry.hardware }
        };
        devices.push(device);
      }
      aliasForSession.set(entry.id, device.alias);
    }

    const aliasFor = id => (id ? aliasForSession.get(id) || null : null);
    const connectedAliases = new Set();
    for (const entry of this.sessionList) {
      if (!entry.session || !entry.session.isConnected) continue;
      const alias = aliasForSession.get(entry.id);
      if (alias) connectedAliases.add(alias);
    }
    const firstAlias = devices[0] ? devices[0].alias : null;

    const axes = {};
    for (const [channel, entry] of Object.entries(base.settings.axes)) {
      if (!connectedAliases.has(entry.device)) axes[channel] = { ...entry };
    }
    for (const [channel, entry] of Object.entries(mapping.axes)) {
      const alias = aliasFor(entry.device);
      if (alias) axes[channel] = { ...entry, device: alias };
    }

    const buttons = {};
    for (const [channel, entry] of Object.entries(base.settings.buttons)) {
      if (!connectedAliases.has(entry.device)) buttons[channel] = { ...entry };
    }
    for (const [channel, entry] of Object.entries(mapping.buttons)) {
      const alias = aliasFor(entry.device);
      if (alias) buttons[channel] = { ...entry, device: alias };
    }

    return {
      kind: PROFILE_KIND,
      schemaVersion: PROFILE_SCHEMA_VERSION,
      profileName: options.profileName || base.profileName,
      devices,
      settings: {
        steering: {
          ...mapping.steering,
          device: aliasFor(mapping.steering.device) || base.settings.steering.device || firstAlias
        },
        ffb: {
          ...mapping.ffb,
          device: aliasFor(mapping.ffb.device) || base.settings.ffb.device || firstAlias
        },
        axes,
        buttons
      },
      metadata: options.metadata || base.metadata || {}
    };
  }

  toSetup(options = {}) {
    if (options.baseProfile) {
      return this._mergeSetup(validateProfile(options.baseProfile), options);
    }
    const mapping = this.getMapping();
    const referenced = [];
    const addRef = id => {
      if (id && !referenced.includes(id)) referenced.push(id);
    };
    addRef(mapping.steering.device);
    addRef(mapping.ffb.device);
    for (const entry of Object.values(mapping.axes)) addRef(entry && entry.device);
    for (const entry of Object.values(mapping.buttons)) addRef(entry && entry.device);

    if (!referenced.length) {
      for (const entry of this.sessionList) {
        if (entry.session && entry.session.isConnected) addRef(entry.id);
      }
    }
    if (!referenced.length) {
      throw new Error('connect a device before creating a setup profile');
    }

    const aliases = new Map();
    referenced.forEach((id, index) => aliases.set(id, `d${index + 1}`));
    const aliasFor = id => (id ? aliases.get(id) || null : null);

    const devices = referenced.map(id => {
      const entry = this._sessions.get(id);
      if (!entry || !entry.device) {
        throw new Error(`device ${id} is not available`);
      }
      return {
        alias: aliases.get(id),
        driver: entry.driver,
        hardware: entry.hardware
      };
    });

    const firstAlias = devices[0].alias;
    const convert = (entry, fallback) => ({
      ...entry,
      device: aliasFor(entry.device) || fallback
    });

    return {
      kind: PROFILE_KIND,
      schemaVersion: PROFILE_SCHEMA_VERSION,
      profileName: options.profileName || (this._profile && this._profile.profileName) || 'Wheel setup',
      devices,
      settings: {
        steering: {
          ...mapping.steering,
          device: aliasFor(mapping.steering.device) || firstAlias
        },
        ffb: {
          ...mapping.ffb,
          device: aliasFor(mapping.ffb.device) || firstAlias
        },
        axes: Object.fromEntries(
          Object.entries(mapping.axes).map(([key, entry]) => [key, convert(entry, firstAlias)])
        ),
        buttons: Object.fromEntries(
          Object.entries(mapping.buttons).map(([key, entry]) => [key, convert(entry, firstAlias)])
        )
      },
      metadata: options.metadata || (this._profile && this._profile.metadata) || {}
    };
  }

  constant(value) {
    const entry = this._sessions.get(this._mapping.ffb.device);
    if (!entry || entry.driver !== 'wheel' || !entry.session.ffb) return Promise.resolve();
    return entry.session.ffb.constant(value);
  }

  constantFast(value) {
    const entry = this._sessions.get(this._mapping.ffb.device);
    if (!entry || entry.driver !== 'wheel' || !entry.session.ffb) return Promise.resolve();
    return entry.session.ffb.constantFast(value);
  }

  stop() {
    const entry = this._sessions.get(this._mapping.ffb.device);
    if (!entry || entry.driver !== 'wheel' || !entry.session.ffb) return Promise.resolve();
    return entry.session.ffb.stop();
  }
}

export default WheelManager;
