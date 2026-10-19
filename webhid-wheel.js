/////////////////////// Inspired by https://github.com/TheBITLINK/WebHID-DS4

function readBits(view, bitOffset, size) {
  let value = 0;
  for (let i = 0; i < size; i++) {
    const bit = bitOffset + i;
    value |= ((view.getUint8(bit >> 3) >> (bit & 7)) & 1) << i;
  }
  return value;
}

function writeBits(bytes, bitOffset, size, value) {
  for (let i = 0; i < size; i++) {
    const bit = bitOffset + i;
    const b = bit >> 3;
    const m = 1 << (bit & 7);
    if ((value >> i) & 1) bytes[b] |= m; else bytes[b] &= ~m;
  }
}

function readFieldValue(view, field) {
  const raw = readBits(view, field.offset, field.size);
  if (field.min < 0 && field.size < 32) {
    const sign = 1 << (field.size - 1);
    if (raw & sign) return raw - (1 << field.size);
  }
  return raw;
}

function normalizeField(value, field) {
  const min = field.min !== undefined ? field.min : 0;
  const max = field.max !== undefined ? field.max : (Math.pow(2, field.size) - 1);
  const range = max - min;
  return range > 0 ? (value - min) / range : 0;
}

function report64(bytes) {
  const b = new Uint8Array(64);
  for (let i = 0; i < bytes.length; i++) b[i] = bytes[i] & 0xff;
  return b;
}

function parseThrustmaster(data, wheel) {
  wheel.steering = data.getUint8(0) | (data.getUint8(1) << 8);
  wheel.rotation = (wheel.steering / 65535 - 0.5) * wheel.maxRotation;

  wheel.buttons = new Array(16).fill(false);
  for (let i = 0; i < 8; i++) {
    wheel.buttons[i] = (data.getUint8(14) & (1 << i)) !== 0;
    wheel.buttons[i + 8] = (data.getUint8(15) & (1 << i)) !== 0;
  }

  wheel.axes = new Array(5).fill(0);
  wheel.axes[0] = data.getUint8(0);
  wheel.axes[1] = data.getUint8(2);
  wheel.axes[2] = data.getUint8(4);
  wheel.axes[3] = data.getUint8(6);
}

function parseLogitechDFGT(data, wheel) {
  const buttonsData = data.getUint8(1);
  wheel.buttons = new Array(16).fill(false);

  const offset = data.getUint8(0);
  wheel.rotation = (offset / 255 * 90) + 90 * (buttonsData % 4);

  const buttonsNum = buttonsData - buttonsData % 4;
  if (buttonsNum === 4) { wheel.buttons[0] = true; }
  if (buttonsNum === 8) { wheel.buttons[1] = true; }
  if (buttonsNum === 16) { wheel.buttons[2] = true; }
  if (buttonsNum === 32) { wheel.buttons[3] = true; }
  if (buttonsNum === 64) { wheel.buttons[4] = true; }
  if (buttonsNum === 128) { wheel.buttons[5] = true; }

  const buttonsData1 = data.getUint8(2);
  if (buttonsData1 === 196) { wheel.buttons[6] = true; }
  if (buttonsData1 === 200) { wheel.buttons[7] = true; }
  if (buttonsData1 === 193) { wheel.buttons[8] = true; }
  if (buttonsData1 === 194) { wheel.buttons[9] = true; }
  if (buttonsData1 === 208) { wheel.buttons[10] = true; }
  if (buttonsData1 === 224) { wheel.buttons[11] = true; }

  const buttonsData2 = data.getUint8(4);
  if (buttonsData2 === 160) { wheel.buttons[12] = true; }
  if (buttonsData2 === 162) { wheel.buttons[13] = true; }
  if (buttonsData2 === 164) { wheel.buttons[14] = true; }
  if (buttonsData2 === 166) { wheel.buttons[15] = true; }

  wheel.axes = new Array(5).fill(0);
  wheel.axes[0] = 255 - data.getUint8(5);
  wheel.axes[1] = 255 - data.getUint8(6);
}

function buildDescriptorLayout(device) {
  let steering = null, reportId = null;
  const axes = [], buttons = [];

  for (const collection of device.collections) {
    for (const report of (collection.inputReports || [])) {
      let offset = 0;
      for (const item of (report.items || [])) {
        const size = item.reportSize;
        const count = item.reportCount;
        const usages = item.usages || [];
        const usage = usages[0] || 0;
        const page = usage >>> 16;
        const id = usage & 0xffff;

        if (reportId === null && page === 0x01 && id === 0x30 && size >= 8) {
          steering = { offset, size, min: item.logicalMinimum, max: item.logicalMaximum };
          reportId = report.reportId;
        }

        const isButtonPage = usages.some(u => (u >>> 16) === 0x09);
        const isButtonRange = !item.isConstant && size === 1 &&
          (isButtonPage || item.isRange || (!usages.length && count > 1));
        if (isButtonRange) {
          for (let b = 0; b < count; b++) buttons.push({ offset: offset + b * size });
        }

        if (page === 0x01 && [0x30, 0x31, 0x32, 0x33, 0x34, 0x35].includes(id)) {
          axes.push({ offset, size, usage: id, min: item.logicalMinimum, max: item.logicalMaximum });
        }

        offset += size * count;
      }
    }
  }

  return steering ? { reportId, steering, buttons, axes } : null;
}

function parseGeneric(data, wheel) {
  const layout = wheel.layout;
  if (wheel.reportId !== layout.reportId) return;

  const s = layout.steering;
  wheel.steering = readFieldValue(data, s);
  wheel.rotation = (normalizeField(wheel.steering, s) - 0.5) * wheel.maxRotation;

  wheel.buttons = layout.buttons.map(b => readBits(data, b.offset, 1) === 1);
  wheel.axes = layout.axes.map(a => {
    const value = normalizeField(readFieldValue(data, a), a) * 255;
    return Math.max(0, Math.min(255, value));
  });
}

function buildPidFfb(device) {
  const collect = (listName) => {
    const reports = [];
    for (const c of device.collections) {
      for (const r of (c[listName] || [])) {
        const fields = [];
        let offset = 0;
        for (const it of (r.items || [])) {
          const uids = (it.usages || []).map(u => ({ page: u >>> 16, id: u & 0xffff }));
          fields.push({
            uids, offset, size: it.reportSize, count: it.reportCount,
            min: it.logicalMinimum, max: it.logicalMaximum,
            array: !!it.isArray, constant: !!it.isConstant
          });
          offset += it.reportSize * it.reportCount;
        }
        reports.push({ id: r.reportId, len: Math.ceil(offset / 8), fields });
      }
    }
    return reports;
  };

  const outputs = collect('outputReports');
  const features = collect('featureReports');

  const hasUsage = (f, id) => f.uids.some(u => u.page === 0x0f && u.id === id);
  const find = (r, id) => r && r.fields.find(f => hasUsage(f, id));
  const has = (r, id) => !!(r && r.fields.some(f => hasUsage(f, id)));

  const setEffect = outputs.find(r => has(r, 0x26) && (has(r, 0x50) || has(r, 0x52)));
  const effectOp = outputs.find(r => has(r, 0x78) || has(r, 0x79) || has(r, 0x7a));
  const setConstant = outputs.find(r => has(r, 0x22) && has(r, 0x70) && !has(r, 0x71) && !has(r, 0x6f));
  if (!setEffect || !effectOp || !setConstant) return null;

  const seBlock = find(setEffect, 0x22) || setEffect.fields[0];
  const typeField = find(setEffect, 0x26);
  const durationField = find(setEffect, 0x50);
  const gainField = find(setEffect, 0x52);
  const directionEnableField = find(setEffect, 0x56);
  const axisXField = setEffect.fields.find(f => f.uids.some(u => u.page === 0x01 && u.id === 0x30));
  const constBlock = find(setConstant, 0x22) || setConstant.fields[0];
  const magField = find(setConstant, 0x70);
  const opBlock = find(effectOp, 0x22) || effectOp.fields[0];
  const opField = find(effectOp, 0x78) || find(effectOp, 0x79) || find(effectOp, 0x7a);
  const loopField = find(effectOp, 0x7c);
  if (!typeField || !magField || !opField) return null;

  const create = features.find(r => has(r, 0x26) && !has(r, 0x22));
  const createType = find(create, 0x26);
  const blockLoad = features.find(r => has(r, 0x22) && (has(r, 0x8c) || has(r, 0x8d) || has(r, 0x8e)));
  const blockField = find(blockLoad, 0x22);
  const statusField = find(blockLoad, 0x8c) || find(blockLoad, 0x8b);
  const control = outputs.find(r => has(r, 0x97) || has(r, 0x98) || has(r, 0x99));
  const gainOut = outputs.find(r => has(r, 0x7e));

  const usageIndex = (field, id, fallback) => {
    if (!field) return fallback;
    const index = field.uids.findIndex(u => u.page === 0x0f && u.id === id);
    return index >= 0 ? index + 1 : fallback;
  };

  const typeCandidates = [];
  const addType = (value) => {
    if (value > 0 && !typeCandidates.includes(value)) typeCandidates.push(value);
  };
  const webhidType = usageIndex(typeField, 0x26, 1);
  addType(1);
  addType(webhidType);
  if (typeField.uids.length > 1) addType(typeField.uids.length - webhidType + 1);
  let constantType = typeCandidates[0] || 1;

  const startValue = usageIndex(opField, 0x79, 1);
  const stopValue = usageIndex(opField, 0x7b, 3);
  const magMax = Math.max(Math.abs(magField.max || 0), Math.abs(magField.min || 0), 1);

  const sendControl = async (device, id) => {
    if (!control) return;
    const field = find(control, id);
    if (!field) return;
    const data = new Uint8Array(control.len);
    const value = (field.array && field.uids.length > 1) ? usageIndex(field, id, 1) : 1;
    writeBits(data, field.offset, field.size, value);
    await device.sendReport(control.id, data);
  };

  let effectId = 1;
  let ready = null;
  const info = {
    setEffect: setEffect.id,
    setConstant: setConstant.id,
    effectOperation: effectOp.id,
    constantType,
    effectBlock: effectId,
    typeCandidates: typeCandidates.slice()
  };

  const init = (device) => {
    if (ready) return ready;
    ready = (async () => {
      try {
        await sendControl(device, 0x9a);
        await sendControl(device, 0x99);
        await sendControl(device, 0x97);
      } catch (e) { /* noop */ }

      if (gainOut) {
        const field = find(gainOut, 0x7e);
        if (field) {
          try {
            const data = new Uint8Array(gainOut.len);
            writeBits(data, field.offset, field.size, field.max > 0 ? field.max : 255);
            await device.sendReport(gainOut.id, data);
          } catch (e) { /* noop */ }
        }
      }

      if (create && blockLoad && createType && blockField &&
          typeof device.sendFeatureReport === 'function' &&
          typeof device.receiveFeatureReport === 'function') {
        info.createAttempts = [];
        for (const candidate of typeCandidates) {
          try {
            const data = new Uint8Array(create.len);
            writeBits(data, createType.offset, createType.size, candidate);
            await device.sendFeatureReport(create.id, data);
            let id = 0, status = 0;
            for (let attempt = 0; attempt < 10; attempt++) {
              const reply = await device.receiveFeatureReport(blockLoad.id);
              id = readBits(reply, blockField.offset, blockField.size);
              status = statusField ? readBits(reply, statusField.offset, statusField.size) : 1;
              if (id > 0 && status === 1) break;
              if (status === 2 || status === 3) break;
              await new Promise(resolve => setTimeout(resolve, 10));
            }
            info.createAttempts.push({ type: candidate, block: id, status });
            if (id > 0 && status === 1) {
              constantType = candidate;
              effectId = id;
              info.constantType = candidate;
              info.effectBlock = id;
              break;
            }
          } catch (e) {
            info.createError = String(e && e.message ? e.message : e);
            break;
          }
        }
      }
    })();
    return ready;
  };

  const dispatch = async (device, value, wheel) => {
    try {
      await init(device);
      const strength = (wheel && wheel.ffbStrength !== undefined) ? wheel.ffbStrength : 1;
      const mag = Math.max(-magMax, Math.min(magMax, Math.round(value * strength * magMax)));

      const se = new Uint8Array(setEffect.len);
      writeBits(se, seBlock.offset, seBlock.size, effectId);
      writeBits(se, typeField.offset, typeField.size, constantType);
      if (durationField) writeBits(se, durationField.offset, durationField.size, Math.pow(2, durationField.size) - 1);
      if (gainField) writeBits(se, gainField.offset, gainField.size, gainField.max > 0 ? gainField.max : 255);
      if (directionEnableField) writeBits(se, directionEnableField.offset, directionEnableField.size, 1);
      if (axisXField) writeBits(se, axisXField.offset, axisXField.size, 1);
      await device.sendReport(setEffect.id, se);

      const sc = new Uint8Array(setConstant.len);
      writeBits(sc, constBlock.offset, constBlock.size, effectId);
      writeBits(sc, magField.offset, magField.size, mag);
      await device.sendReport(setConstant.id, sc);

      const eo = new Uint8Array(effectOp.len);
      writeBits(eo, opBlock.offset, opBlock.size, effectId);
      writeBits(eo, opField.offset, opField.size, startValue);
      if (loopField) writeBits(eo, loopField.offset, loopField.size, 1);
      await device.sendReport(effectOp.id, eo);
      info.lastValue = value;
      info.lastMagnitude = mag;
    } catch (e) {
      info.error = String(e && e.message ? e.message : e);
      throw e;
    }
  };

  const stop = async (device) => {
    if (!ready) return;
    await ready;
    const eo = new Uint8Array(effectOp.len);
    writeBits(eo, opBlock.offset, opBlock.size, effectId);
    writeBits(eo, opField.offset, opField.size, stopValue);
    await device.sendReport(effectOp.id, eo);
    const sc = new Uint8Array(setConstant.len);
    writeBits(sc, constBlock.offset, constBlock.size, effectId);
    writeBits(sc, magField.offset, magField.size, 0);
    await device.sendReport(setConstant.id, sc);
  };

  return { constant: dispatch, stop, info };
}

const defaultProfiles = [
  {
    name: 'Thrustmaster FFB wheel (T248 / T300RS)',
    match: /thrustmaster/i,
    parse: parseThrustmaster
  },
  {
    name: 'Logitech Driving Force GT',
    match: /driving force gt/i,
    parse: parseLogitechDFGT
  },
  {
    name: 'CAMMUS C5',
    vendorId: 0x3416,
    productId: 0x0301,
    maxRotation: 1080
  },
  {
    name: 'CAMMUS C12',
    vendorId: 0x3416,
    productId: 0x0302,
    maxRotation: 1080
  },
  {
    name: 'FFBeast',
    vendorId: 0x045b,
    ffb: {
      constant: async (device, value, wheel) => {
        const strength = (wheel && wheel.ffbStrength !== undefined) ? wheel.ffbStrength : 1;
        const mag = Math.max(-10000, Math.min(10000, Math.round(value * strength * 10000)));
        await device.sendReport(0x11, report64([1, 1, 0x2c, 0x01, 0, 0, 0, 0, 255, 0, 0x03]));
        await device.sendReport(0x15, report64([1, mag & 0xff, (mag >> 8) & 0xff]));
        await device.sendReport(0x1a, report64([1, 1, 0]));
      },
      stop: async (device) => {
        await device.sendReport(0x1a, report64([1, 3, 0]));
        await device.sendReport(0x15, report64([1, 0, 0]));
      }
    }
  }
];

const registeredProfiles = defaultProfiles.slice();

function profileMatches(profile, device) {
  if (profile.vendorId !== undefined && device.vendorId === profile.vendorId &&
      (profile.productId === undefined || device.productId === profile.productId)) {
    return true;
  }
  return !!(profile.match && profile.match.test(device.productName || ''));
}

export class WebHIDWheel {

  static registerProfile(profile) {
    if (profile && profile.name) registeredProfiles.push(profile);
    return profile;
  }

  constructor(options = {}) {
    if (typeof navigator === 'undefined' || !navigator.hid || !navigator.hid.requestDevice) {
      throw new Error('WebHID not supported by browser or not available.');
    }
    this.options = options;
    this.maxRotation = options.maxRotation !== undefined ? options.maxRotation : 900;
    this.ffbStrength = options.ffbStrength !== undefined ? options.ffbStrength : 0.25;
    this.ffbInvert = options.ffbInvert !== undefined ? options.ffbInvert : false;
    this.deadzone = options.deadzone !== undefined ? options.deadzone : 0;
    this._listeners = {};
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
    if (list) for (const fn of list.slice()) { try { fn(payload); } catch (e) { /* noop */ } }
  }

  get isConnected() {
    return !!(this.device && this.device.opened);
  }

  get state() {
    return {
      steering: this.steering,
      rotation: this.rotation,
      buttons: this.buttons || [],
      axes: this.axes || []
    };
  }

  /**
   * Requests (if needed) and opens a wheel, then selects a profile.
   * Must be called from a user gesture (e.g. a click handler).
   */
  async connect(device) {
    if (this.isConnected) return this.device;

    let dev = device;
    if (!dev) {
      const devices = await navigator.hid.requestDevice({ filters: this.options.filters || [] });
      dev = devices[0];
    }
    if (!dev) return null;

    this.device = dev;
    try {
      await dev.open();
    } catch (e) {
      if (!dev.opened) { this.emit('error', e); this.device = null; return null; }
    }

    this.name = dev.productName;
    this.profile = registeredProfiles.find(p => profileMatches(p, dev)) || null;
    if (this.profile && this.profile.maxRotation !== undefined && this.options.maxRotation === undefined) {
      this.maxRotation = this.profile.maxRotation;
    }
    this.layout = buildDescriptorLayout(dev);
    this.pidFfb = (this.profile && this.profile.ffb) ? null : buildPidFfb(dev);
    this.parserName = this.profile ? this.profile.name : (this.layout ? 'Generic (HID descriptor)' : null);

    const caps = { constant: false, periodic: false, any: false };
    if (this.profile && this.profile.ffb) {
      caps.constant = !!this.profile.ffb.constant;
      caps.periodic = !!this.profile.ffb.periodic;
    } else if (this.pidFfb) {
      caps.constant = true;
    }
    caps.any = caps.constant || caps.periodic;
    this.ffbCaps = caps;

    this.ffb = {
      supported: caps,
      constant: (value) => this.setConstantForce(value),
      stop: () => this.stopEffects()
    };

    this.device.oninputreport = (report) => this.processWheelReport(report);
    this.emit('connect', this.device);
    return this.device;
  }

  async disconnect() {
    const dev = this.device;
    if (dev && dev.opened) { try { await dev.close(); } catch (e) { /* noop */ } }
    this.device = null;
    if (dev) this.emit('disconnect', dev);
  }

  processWheelReport(report) {
    const { data } = report;
    this.lastReport = data.buffer;
    this.timestamp = report.timeStamp;
    this.reportId = report.reportId;
    this.updateState(data);
    this.emit('input', this.state);
  }

  updateState(data) {
    this.debug = new Uint8Array(data.buffer);

    if (this.profile && this.profile.parse) {
      this.profile.parse(data, this);
    } else if (this.layout) {
      parseGeneric(data, this);
    } else {
      this.steering = undefined;
      this.rotation = undefined;
      this.buttons = [];
      this.axes = [];
    }

    if (this.deadzone && this.rotation !== undefined) {
      const threshold = this.deadzone * (this.maxRotation / 2);
      if (Math.abs(this.rotation) < threshold) this.rotation = 0;
    }
  }

  async setConstantForce(value) {
    if (!this.device) return;
    const force = this.ffbInvert ? -value : value;
    if (this.profile && this.profile.ffb && this.profile.ffb.constant)
      return this.profile.ffb.constant(this.device, force, this);
    if (this.pidFfb)
      return this.pidFfb.constant(this.device, force, this);
  }

  async stopEffects() {
    if (!this.device) return;
    if (this.profile && this.profile.ffb && this.profile.ffb.stop)
      return this.profile.ffb.stop(this.device);
    if (this.pidFfb)
      return this.pidFfb.stop(this.device);
  }
}

export default WebHIDWheel;
