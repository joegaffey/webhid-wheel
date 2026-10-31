import {
  HidppTransport,
  findHidppInterface,
  hasAmbiguousInterfaceGroup,
  isHidppInterface,
  pickPrimaryInterface,
  samePhysicalDevice
} from './hidpp.js';

export const LOGITECH_TEST_DRIVER_VERSION = 'logitech-test-1';

const FORCE_FEEDBACK_FEATURE = 0x8123;
const EFFECT_CONSTANT = 0x00;
const EFFECT_SPRING = 0x06;
const EFFECT_AUTOSTART = 0x80;
const STATE_STOP = 0x01;
const STATE_PLAY = 0x02;
const FN_GET_INFO = 0;
const FN_RESET_ALL = 1;
const FN_DOWNLOAD_EFFECT = 2;
const FN_SET_EFFECT_STATE = 3;
const FN_DESTROY_EFFECT = 4;
const FN_GET_APERTURE = 5;
const FN_SET_APERTURE = 6;

const DEFAULT_CONFIG = {
  featureId: FORCE_FEEDBACK_FEATURE,
  strength: 0.5,
  forceSign: 1,
  protocolVersion: true,
  resetAll: true,
  disableAutocenter: true,
  setAperture: false,
  aperture: 900,
  autostartAllocate: true,
  autostartUpdate: false,
  autostartResume: true,
  playAfterAllocate: true,
  playAfterUpdate: false,
  playAfterResume: true,
  recreateOnResume: false,
  destroyOnStop: false
};

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function hex(bytes) {
  return Array.from(bytes || []).map(value => value.toString(16).padStart(2, '0')).join(' ');
}

function constantParams(effectId, level, autostart) {
  const params = new Uint8Array(14);
  params[0] = effectId;
  params[1] = EFFECT_CONSTANT | (autostart ? EFFECT_AUTOSTART : 0);
  params[6] = (level >> 8) & 0xff;
  params[7] = level & 0xff;
  return params;
}

export class LogitechTestDriver {
  constructor(options = {}) {
    this.version = LOGITECH_TEST_DRIVER_VERSION;
    this.onLog = options.onLog || (() => {});
    this.onState = options.onState || (() => {});
    this.config = { ...DEFAULT_CONFIG, ...(options.config || {}) };
    this.interfaces = [];
    this.inputDevice = null;
    this.ffbDevice = null;
    this.transport = null;
    this.featureIndex = 0;
    this.protocolVersion = null;
    this.slotCount = 0;
    this.autocenterSlot = 0;
    this.slot = 0;
    this.playing = false;
    this.lastLevel = 0;
    this.lastValue = 0;
    this.sent = 0;
    this.received = 0;
    this.errors = 0;
    this.connected = false;
    this.initialized = false;
  }

  configure(patch = {}) {
    this.config = { ...this.config, ...patch };
    this.emitState();
    return this.config;
  }

  log(dir, label, bytes, text = '') {
    this.onLog({
      time: new Date().toISOString().slice(11, 23),
      dir,
      label,
      hex: bytes ? hex(bytes) : '',
      text
    });
  }

  emitState(extra = {}) {
    this.onState(this.getState(extra));
  }

  getState(extra = {}) {
    return {
      version: this.version,
      connected: this.connected,
      initialized: this.initialized,
      inputDevice: this.inputDevice ? this.inputDevice.productName : null,
      ffbDevice: this.ffbDevice ? this.ffbDevice.productName : null,
      interfaces: this.interfaces.map(device => ({
        name: device.productName,
        opened: device.opened,
        collections: (device.collections || []).map(collection => ({
          usagePage: collection.usagePage,
          usage: collection.usage,
          input: (collection.inputReports || []).map(report => report.reportId),
          output: (collection.outputReports || []).map(report => report.reportId),
          feature: (collection.featureReports || []).map(report => report.reportId)
        }))
      })),
      protocolVersion: this.protocolVersion,
      featureIndex: this.featureIndex,
      slotCount: this.slotCount,
      autocenterSlot: this.autocenterSlot,
      slot: this.slot,
      playing: this.playing,
      lastLevel: this.lastLevel,
      lastValue: this.lastValue,
      lastInput: this.lastInput || null,
      sent: this.sent,
      received: this.received,
      errors: this.errors,
      config: { ...this.config },
      ...extra
    };
  }

  async connect(device) {
    if (this.connected) return this.getState();
    const selected = (Array.isArray(device) ? device : [device]).filter(Boolean);
    if (!selected.length) throw new Error('No HID device selected.');

    const interfaces = selected.slice();
    if (typeof navigator !== 'undefined' && navigator.hid &&
        typeof navigator.hid.getDevices === 'function') {
      try {
        const granted = await navigator.hid.getDevices();
        for (const candidate of granted || []) {
          if (!interfaces.includes(candidate) &&
              selected.some(item => samePhysicalDevice(item, candidate))) {
            interfaces.push(candidate);
          }
        }
      } catch { /* noop */ }
    }

    let primary = pickPrimaryInterface(interfaces) || selected[0];
    if (interfaces.length > 1 && hasAmbiguousInterfaceGroup(interfaces, primary) &&
        !primary.serialNumber) {
      interfaces.length = 0;
      interfaces.push(primary);
    } else {
      primary = pickPrimaryInterface(interfaces) || primary;
    }

    let ffbDevice = findHidppInterface(primary, interfaces);
    if (!ffbDevice && isHidppInterface(primary)) ffbDevice = primary;
    if (!ffbDevice) {
      throw new Error('No HID++ interface found. Is the wheel in native PC mode?');
    }

    await primary.open();
    if (ffbDevice !== primary) await ffbDevice.open();

    this.inputDevice = primary;
    this.ffbDevice = ffbDevice;
    this.interfaces = interfaces;
    this.connected = true;
    this.inputDevice.oninputreport = event => {
      this.lastInput = {
        reportId: event.reportId,
        bytes: hex(new Uint8Array(event.data.buffer, event.data.byteOffset, event.data.byteLength))
      };
      this.emitState();
    };

    this.log('info', 'connect', null,
      `${primary.productName || 'wheel'} input=${primary === ffbDevice ? 'unified' : 'split'} ` +
      `interfaces=${interfaces.length}`);
    this.emitState();
    return this.getState();
  }

  instrumentTransport(transport) {
    const send = transport.send.bind(transport);
    transport.send = async (featureIndex, functionId, params = [], options = {}) => {
      this.sent += 1;
      this.log('tx', `feature ${featureIndex.toString(16)} fn ${functionId}`, params);
      try {
        const response = await send(featureIndex, functionId, params, options);
        this.received += 1;
        this.log('rx', `feature ${response[1].toString(16)} fn ${(response[2] >> 4).toString(16)}`,
          response.slice(3));
        return response;
      } catch (error) {
        this.errors += 1;
        this.log('error', `feature ${featureIndex.toString(16)} fn ${functionId}`, null, String(error));
        throw error;
      }
    };
  }

  async initialize(overrides = {}) {
    if (!this.connected) throw new Error('Connect a wheel first.');
    this.configure(overrides);
    if (this.transport) {
      this.transport.close();
      this.transport = null;
    }
    this.slot = 0;
    this.playing = false;
    this.featureIndex = 0;
    this.protocolVersion = null;
    this.slotCount = 0;
    this.autocenterSlot = 0;

    const transport = new HidppTransport(this.ffbDevice, { timeout: 1000 });
    this.instrumentTransport(transport);
    this.transport = transport;

    if (this.config.protocolVersion) {
      try {
        this.protocolVersion = await transport.getProtocolVersion({ timeout: 400 });
        this.log('info', 'protocol', null,
          `HID++ ${this.protocolVersion.major}.${this.protocolVersion.minor}`);
      } catch (error) {
        this.log('error', 'protocol', null, String(error));
      }
    }

    this.featureIndex = await transport.getFeatureIndex(this.config.featureId);
    this.log('info', 'feature', null,
      `0x${this.config.featureId.toString(16)} -> index ${this.featureIndex}`);

    try {
      const info = await transport.send(this.featureIndex, FN_GET_INFO);
      this.slotCount = info[3] || 0;
    } catch (error) {
      this.log('error', 'getInfo', null, String(error));
    }

    if (this.config.resetAll) {
      try {
        await transport.send(this.featureIndex, FN_RESET_ALL);
        this.log('info', 'resetAll', null, 'ok');
      } catch (error) {
        this.log('error', 'resetAll', null, String(error));
      }
    }

    if (this.config.disableAutocenter) {
      const autocenter = new Uint8Array(18);
      autocenter[1] = EFFECT_SPRING | EFFECT_AUTOSTART;
      try {
        const response = await transport.send(this.featureIndex, FN_DOWNLOAD_EFFECT, autocenter);
        this.autocenterSlot = response[3] || 0;
        this.log('info', 'autocenter', null, `slot ${this.autocenterSlot}`);
      } catch (error) {
        this.log('error', 'autocenter', null, String(error));
      }
    }

    if (this.config.setAperture) {
      try {
        await this.setAperture(this.config.aperture);
      } catch (error) {
        this.log('error', 'aperture', null, String(error));
      }
    }

    this.initialized = true;
    this.emitState();
    return this.getState();
  }

  level(value) {
    const sign = this.config.forceSign < 0 ? -1 : 1;
    const force = clamp(Number(value) || 0, -1, 1) * this.config.strength * sign;
    return Math.round(clamp(force, -1, 1) * 32767);
  }

  async allocate(value = this.lastValue) {
    if (!this.transport) throw new Error('Initialize first.');
    if (this.slot) await this.destroySlot();
    const level = this.level(value);
    const response = await this.transport.send(
      this.featureIndex,
      FN_DOWNLOAD_EFFECT,
      constantParams(0, level, this.config.autostartAllocate)
    );
    this.slot = response[3] || 0;
    if (!this.slot) throw new Error('No effect slot allocated.');
    this.playing = this.config.autostartAllocate;
    if (this.config.playAfterAllocate) {
      try {
        await this.transport.send(this.featureIndex, FN_SET_EFFECT_STATE, [this.slot, STATE_PLAY]);
        this.playing = true;
      } catch (error) {
        this.log('error', 'play', null, String(error));
      }
    }
    this.lastLevel = level;
    this.lastValue = value;
    this.emitState();
    return this.slot;
  }

  async setForce(value) {
    if (!this.transport) throw new Error('Initialize first.');
    if (!this.slot) return this.allocate(value);
    const level = this.level(value);
    await this.transport.send(
      this.featureIndex,
      FN_DOWNLOAD_EFFECT,
      constantParams(this.slot, level, this.config.autostartUpdate)
    );
    if (this.config.playAfterUpdate) {
      await this.transport.send(this.featureIndex, FN_SET_EFFECT_STATE, [this.slot, STATE_PLAY]);
    }
    this.playing = this.playing || this.config.autostartUpdate || this.config.playAfterUpdate;
    this.lastLevel = level;
    this.lastValue = value;
    this.emitState();
  }

  async stop() {
    if (!this.transport || !this.slot) return;
    try {
      await this.transport.send(
        this.featureIndex,
        FN_DOWNLOAD_EFFECT,
        constantParams(this.slot, 0, false)
      );
    } catch (error) {
      this.log('error', 'stop force', null, String(error));
    }
    try {
      await this.transport.send(this.featureIndex, FN_SET_EFFECT_STATE, [this.slot, STATE_STOP]);
    } catch (error) {
      this.log('error', 'stop state', null, String(error));
    }
    this.playing = false;
    this.lastLevel = 0;
    if (this.config.destroyOnStop) await this.destroySlot();
    else this.emitState();
  }

  async resume(value = this.lastValue) {
    if (!this.transport) throw new Error('Initialize first.');
    if (!this.slot || this.config.recreateOnResume) return this.allocate(value);
    const level = this.level(value);
    await this.transport.send(
      this.featureIndex,
      FN_DOWNLOAD_EFFECT,
      constantParams(this.slot, level, this.config.autostartResume)
    );
    if (this.config.playAfterResume) {
      try {
        await this.transport.send(this.featureIndex, FN_SET_EFFECT_STATE, [this.slot, STATE_PLAY]);
      } catch (error) {
        this.log('error', 'resume play', null, String(error));
      }
    }
    this.playing = true;
    this.lastLevel = level;
    this.lastValue = value;
    this.emitState();
  }

  async destroySlot() {
    if (!this.transport || !this.slot) return;
    await this.transport.send(this.featureIndex, FN_DESTROY_EFFECT, [this.slot]);
    this.slot = 0;
    this.playing = false;
    this.lastLevel = 0;
    this.emitState();
  }

  async resetAll() {
    if (!this.transport) throw new Error('Initialize first.');
    await this.transport.send(this.featureIndex, FN_RESET_ALL);
    this.slot = 0;
    this.autocenterSlot = 0;
    this.playing = false;
    this.emitState();
  }

  async getAperture() {
    if (!this.transport) throw new Error('Initialize first.');
    const response = await this.transport.send(this.featureIndex, FN_GET_APERTURE);
    return (response[3] << 8) | response[4];
  }

  async setAperture(degrees) {
    if (!this.transport) throw new Error('Initialize first.');
    const range = Math.round(clamp(Number(degrees) || 900, 90, 2700));
    await this.transport.send(this.featureIndex, FN_SET_APERTURE, [
      (range >> 8) & 0xff,
      range & 0xff
    ]);
    this.emitState();
    return range;
  }

  async disconnect() {
    try {
      if (this.transport) {
        await this.stop();
        if (this.slot) await this.destroySlot();
      }
    } catch { /* noop */ }
    if (this.transport) this.transport.close();
    this.transport = null;
    const ffb = this.ffbDevice;
    const input = this.inputDevice;
    this.ffbDevice = null;
    this.inputDevice = null;
    this.interfaces = [];
    this.connected = false;
    this.initialized = false;
    this.slot = 0;
    this.playing = false;
    if (ffb && ffb !== input && ffb.opened) {
      try { await ffb.close(); } catch { /* noop */ }
    }
    if (input && input.opened) {
      try { await input.close(); } catch { /* noop */ }
    }
    this.emitState();
  }
}
