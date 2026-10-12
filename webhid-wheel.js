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
        const usage = (item.usages && item.usages[0]) || 0;
        const page = usage >>> 16;
        const id = usage & 0xffff;

        if (reportId === null && page === 0x01 && id === 0x30 && size >= 8) {
          steering = { offset, size, min: item.logicalMinimum, max: item.logicalMaximum };
          reportId = report.reportId;
        }
        if (page === 0x09 && size === 1) {
          for (let b = 0; b < count; b++) buttons.push({ offset: offset + b * size });
        }
        if (page === 0x01 && [0x30, 0x31, 0x32, 0x33, 0x34, 0x35].includes(id)) {
          axes.push({ offset, size, usage: id });
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
  const range = (s.max > s.min) ? (s.max - s.min) : ((1 << s.size) - 1);
  wheel.steering = readBits(data, s.offset, s.size);
  wheel.rotation = ((wheel.steering - s.min) / range - 0.5) * wheel.maxRotation;

  wheel.buttons = layout.buttons.map(b => readBits(data, b.offset, 1) === 1);
  wheel.axes = layout.axes.map(a => readBits(data, a.offset, a.size) / ((1 << a.size) - 1) * 255);
}

function buildPidFfb(device) {
  const reports = [];
  for (const c of device.collections) {
    for (const r of (c.outputReports || [])) {
      const fields = [];
      let offset = 0;
      for (const it of (r.items || [])) {
        const uids = (it.usages || []).map(u => ({ page: u >>> 16, id: u & 0xffff }));
        fields.push({ uids, offset, size: it.reportSize, count: it.reportCount });
        offset += it.reportSize * it.reportCount;
      }
      reports.push({ id: r.reportId, len: offset / 8, fields });
    }
  }
  const hasUsage = (f, id) => f.uids.some(u => u.page === 0x0f && u.id === id);
  const find = (r, id) => r.fields.find(f => hasUsage(f, id));
  const has = (r, id) => r.fields.some(f => hasUsage(f, id));

  const setEffect = reports.find(r => has(r, 0x34));
  const effectOp = reports.find(r => has(r, 0x79) || has(r, 0x7a));
  const setConstant = reports.find(r => has(r, 0x22) && has(r, 0x70) && !has(r, 0x71));
  if (!setEffect || !effectOp || !setConstant) return null;

  const seBlock = find(setEffect, 0x22) || setEffect.fields[0];
  const typeField = find(setEffect, 0x34);
  const gainField = find(setEffect, 0x52);
  const constBlock = find(setConstant, 0x22) || setConstant.fields[0];
  const magField = find(setConstant, 0x70);
  const opBlock = find(effectOp, 0x22) || effectOp.fields[0];
  const opField = find(effectOp, 0x7a) || find(effectOp, 0x79);
  if (!typeField || !magField || !opField) return null;

  const constantType = typeField.uids.some(u => u.id === 0x26) ? 0x26 : 1;

  const dispatch = async (device, value, wheel) => {
    const strength = (wheel && wheel.ffbStrength !== undefined) ? wheel.ffbStrength : 1;
    const mag = Math.max(-10000, Math.min(10000, Math.round(value * strength * 10000)));

    const se = new Uint8Array(setEffect.len);
    writeBits(se, seBlock.offset, seBlock.size, 1);
    writeBits(se, typeField.offset, typeField.size, constantType);
    if (gainField) writeBits(se, gainField.offset, gainField.size, 255);
    await device.sendReport(setEffect.id, se);

    const sc = new Uint8Array(setConstant.len);
    writeBits(sc, constBlock.offset, constBlock.size, 1);
    writeBits(sc, magField.offset, magField.size, mag);
    await device.sendReport(setConstant.id, sc);

    const eo = new Uint8Array(effectOp.len);
    writeBits(eo, opBlock.offset, opBlock.size, 1);
    writeBits(eo, opField.offset, opField.size, 1);
    await device.sendReport(effectOp.id, eo);
  };

  const stop = async (device) => {
    const eo = new Uint8Array(effectOp.len);
    writeBits(eo, opBlock.offset, opBlock.size, 1);
    writeBits(eo, opField.offset, opField.size, 3);
    await device.sendReport(effectOp.id, eo);
    const sc = new Uint8Array(setConstant.len);
    writeBits(sc, constBlock.offset, constBlock.size, 1);
    writeBits(sc, magField.offset, magField.size, 0);
    await device.sendReport(setConstant.id, sc);
  };

  return { constant: dispatch, stop, info: { setEffect: setEffect.id, setConstant: setConstant.id, effectOperation: effectOp.id, constantType } };
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
    if (this.profile && this.profile.ffb && this.profile.ffb.constant)
      return this.profile.ffb.constant(this.device, value, this);
    if (this.pidFfb)
      return this.pidFfb.constant(this.device, value, this);
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
