import test from 'node:test';
import assert from 'node:assert/strict';
import {
  WebHIDWheel,
  WheelManager,
  detectDeviceCapabilities,
  isForceFeedbackWheel
} from '../webhid-wheel.js';

globalThis.navigator.hid = {
  requestDevice: async () => [],
  getDevices: async () => []
};

const usage = (page, id) => (page << 16) | id;

function item(usages, reportSize, reportCount = 1, options = {}) {
  return {
    usages,
    reportSize,
    reportCount,
    logicalMinimum: options.min ?? 0,
    logicalMaximum: options.max ?? (1 << reportSize) - 1,
    isConstant: !!options.constant,
    isRange: !!options.range
  };
}

function inputCollections() {
  return [{
    usagePage: 0x01,
    usage: 0x04,
    inputReports: [{
      reportId: 1,
      items: [
        item([usage(0x01, 0x30)], 16, 1, { max: 65535 }),
        item([usage(0x01, 0x31)], 16, 1, { max: 65535 }),
        item([usage(0x01, 0x32)], 16, 1, { max: 65535 }),
        item([usage(0x01, 0x33)], 16, 1, { max: 65535 }),
        item([usage(0x09, 0x01)], 1, 16, { max: 1, range: true }),
        item([usage(0x01, 0x39)], 4, 1, { max: 7 })
      ]
    }],
    outputReports: [],
    featureReports: []
  }];
}

function hidppCollections({ short = true } = {}) {
  const outputReports = [
    { reportId: 0x11, items: [] },
    { reportId: 0x12, items: [] }
  ];
  if (short) outputReports.unshift({ reportId: 0x10, items: [] });
  return [{
    usagePage: 0xff43,
    usage: 0x0701,
    inputReports: [{ reportId: 0x12, items: [] }],
    outputReports,
    featureReports: []
  }];
}

class FakeInputDevice {
  constructor() {
    this.vendorId = 0x046d;
    this.productId = 0xc268;
    this.productName = 'PRO Racing Wheel';
    this.collections = inputCollections();
    this.opened = false;
    this.oninputreport = null;
    this.sent = [];
  }

  async open() { this.opened = true; }
  async close() { this.opened = false; }
  async sendReport(reportId, data) {
    this.sent.push({ reportId, data: Uint8Array.from(data) });
  }
}

class FakeHidppDevice {
  constructor() {
    this.vendorId = 0x046d;
    this.productId = 0xc268;
    this.productName = 'PRO Racing Wheel';
    this.collections = hidppCollections();
    this.opened = false;
    this.oninputreport = null;
    this.sent = [];
    this.listeners = {};
    this.featureIndex = 0x0e;
    this.nextSlot = 1;
    this.effects = new Map();
  }

  addEventListener(type, fn) {
    (this.listeners[type] = this.listeners[type] || []).push(fn);
  }

  removeEventListener(type, fn) {
    const list = this.listeners[type];
    if (list) this.listeners[type] = list.filter(item => item !== fn);
  }

  _emit(event) {
    if (this.oninputreport) this.oninputreport(event);
    for (const fn of (this.listeners.inputreport || []).slice()) fn(event);
  }

  _respond(data) {
    const feature = data[1];
    const funcSw = data[2];
    const fn = funcSw >> 4;
    let params = [];

    if (feature === 0 && fn === 0) {
      params = [this.featureIndex];
    } else if (feature === 0 && fn === 1) {
      params = [4, 2, 0x5a];
    } else if (feature === this.featureIndex) {
      if (fn === 0) params = [40, 1];
      else if (fn === 2) {
        let slot = data[3];
        if (!slot) slot = this.nextSlot++;
        this.effects.set(slot, Uint8Array.from(data.slice(3)));
        params = [slot];
      } else if (fn === 3) {
        params = [data[3], data[4]];
      } else if (fn === 5) {
        params = [0x04, 0x38];
      } else if (fn === 6 || fn === 8) {
        params = Array.from(data.slice(3, 7));
      }
    }

    const response = new Uint8Array(63);
    response[0] = data[0];
    response[1] = feature;
    response[2] = funcSw;
    response.set(params, 3);
    queueMicrotask(() => this._emit({ reportId: 0x12, data: response }));
  }

  async open() { this.opened = true; }
  async close() { this.opened = false; }

  async sendReport(reportId, data) {
    const bytes = Uint8Array.from(data);
    this.sent.push({ reportId, data: bytes });
    this._respond(bytes);
  }
}

function sentFor(device, feature, fn) {
  return device.sent.filter(report =>
    report.data[1] === feature && (report.data[2] >> 4) === fn
  );
}

function report(reportId, bytes) {
  const data = new DataView(Uint8Array.from(bytes).buffer);
  return { reportId, data, timeStamp: 1 };
}

test('G Pro profile requires the input interface and exposes HID++ FFB', async () => {
  const input = new FakeInputDevice();
  const hidpp = new FakeHidppDevice();
  const wheel = new WebHIDWheel();

  await wheel.connect(input, { interfaces: [hidpp, input] });

  assert.equal(wheel.device, input);
  assert.equal(wheel.ffbDevice, hidpp);
  assert.equal(wheel.profile.name, 'Logitech G Pro Racing Wheel (HID++)');
  assert.equal(wheel.ffbCaps.constant, true);
  assert.equal(hidpp.opened, true);
  assert.deepEqual(wheel.interfaces, [input, hidpp]);
});

test('HID++ FFB discovers the feature, allocates a slot and updates force', async () => {
  const input = new FakeInputDevice();
  const hidpp = new FakeHidppDevice();
  const wheel = new WebHIDWheel();

  await wheel.connect(input, { interfaces: [input, hidpp] });

  const discovery = sentFor(hidpp, 0, 0);
  assert.equal(discovery.length, 1);
  assert.equal(discovery[0].reportId, 0x10);
  assert.deepEqual(Array.from(discovery[0].data), [0xff, 0x00, 0x0a, 0x81, 0x23, 0]);

  const aperture = sentFor(hidpp, hidpp.featureIndex, 6);
  assert.equal(aperture.length, 1);
  assert.equal(aperture[0].reportId, 0x10);

  const autocenter = sentFor(hidpp, hidpp.featureIndex, 2)[0];
  assert.equal(autocenter.reportId, 0x12);
  assert.equal(autocenter.data[4], 0x86);

  await wheel.setConstantForce(0.5);
  const downloads = sentFor(hidpp, hidpp.featureIndex, 2);
  const constant = downloads[downloads.length - 1];
  assert.equal(constant.data[3], 0);
  assert.equal(constant.data[4], 0x80);
  assert.equal((constant.data[9] << 8) | constant.data[10], 4096);
  assert.equal(wheel._hidppFfb.slot, 2);
  assert.deepEqual(wheel._hidppFfb.protocolVersion, { major: 4, minor: 2, ping: 0x5a });

  const play = sentFor(hidpp, hidpp.featureIndex, 3).slice(-1)[0];
  assert.deepEqual(Array.from(play.data.slice(3, 5)), [2, 0x02]);

  await wheel.setConstantForceFast(-0.5);
  const updates = sentFor(hidpp, hidpp.featureIndex, 2);
  const update = updates[updates.length - 1];
  assert.equal(update.data[3], 2);
  assert.equal(update.data[4], 0x80);
  assert.equal((update.data[9] << 8) | update.data[10], 0xf000);

  await wheel.stopEffects();
  const zero = sentFor(hidpp, hidpp.featureIndex, 2).slice(-1)[0];
  assert.equal(zero.data[3], 2);
  assert.equal(zero.data[4], 0x80);
  assert.equal((zero.data[9] << 8) | zero.data[10], 0);
  const stop = sentFor(hidpp, hidpp.featureIndex, 3).slice(-1)[0];
  assert.deepEqual(Array.from(stop.data.slice(3, 5)), [2, 0x01]);

  await wheel.disconnect();
  assert.equal(hidpp.opened, false);
  assert.equal(input.opened, false);
});

test('G Pro input report drives steering, buttons and hat', async () => {
  const input = new FakeInputDevice();
  const hidpp = new FakeHidppDevice();
  const wheel = new WebHIDWheel();
  await wheel.connect(input, { interfaces: [input, hidpp] });

  input.oninputreport(report(1, [
    0x00, 0x80,
    0xff, 0xff,
    0x00, 0x00,
    0x00, 0x40,
    0x01, 0x00,
    0x02
  ]));

  assert.equal(wheel.steering, 0x8000);
  assert.ok(Math.abs(wheel.rotation) < 0.02);
  assert.equal(wheel.buttons[0], true);
  assert.equal(wheel.state.hats[0].direction, 'right');
  assert.ok(Math.abs(wheel.deviceState.axes[0] - 0.5) < 0.001);
  assert.ok(Math.abs(wheel.deviceState.axes[1] - 1) < 0.001);
});

test('HID++ configuration interface is not detected as a wheel', () => {
  const hidpp = new FakeHidppDevice();
  const caps = detectDeviceCapabilities(hidpp);
  assert.equal(caps.driver, 'generic');
  assert.equal(caps.steering, false);
  assert.equal(caps.ffb, false);
  assert.equal(isForceFeedbackWheel(hidpp), false);
});

test('WheelManager groups G Pro interfaces into one session', async () => {
  const input = new FakeInputDevice();
  const hidpp = new FakeHidppDevice();
  const granted = [hidpp, input];
  globalThis.navigator.hid = {
    requestDevice: async () => granted,
    getDevices: async () => granted
  };

  const manager = new WheelManager();
  const entry = await manager.connect();

  assert.equal(entry.device, input);
  assert.deepEqual(entry.interfaces, [input, hidpp]);
  assert.equal(entry.capabilities.ffb, true);
  assert.equal(manager.sessionList.length, 1);

  const sibling = await manager.connect(hidpp);
  assert.equal(sibling, entry);
  assert.equal(manager.sessionList.length, 1);
});

test('WheelManager finds sibling HID++ interfaces for an authorized input device', async () => {
  const input = new FakeInputDevice();
  const hidpp = new FakeHidppDevice();
  const granted = [hidpp, input];
  globalThis.navigator.hid = {
    requestDevice: async () => [],
    getDevices: async () => granted
  };

  const manager = new WheelManager();
  const entry = await manager.connect(input);

  assert.equal(entry.device, input);
  assert.deepEqual(entry.interfaces, [input, hidpp]);
  assert.equal(entry.capabilities.ffb, true);
});

test('WebHIDWheel selects the input interface when given a HID++ interface', async () => {
  const input = new FakeInputDevice();
  const hidpp = new FakeHidppDevice();
  globalThis.navigator.hid = {
    requestDevice: async () => [],
    getDevices: async () => [hidpp, input]
  };

  const wheel = new WebHIDWheel();
  await wheel.connect(hidpp);

  assert.equal(wheel.device, input);
  assert.equal(wheel.ffbDevice, hidpp);
  assert.equal(wheel.ffbCaps.constant, true);
});


test('G Pro without a HID++ sibling reports no FFB and sends no force', async () => {
  const input = new FakeInputDevice();
  globalThis.navigator.hid = {
    requestDevice: async () => [],
    getDevices: async () => [input]
  };

  const wheel = new WebHIDWheel();
  await wheel.connect(input);

  assert.equal(wheel.ffbDevice, null);
  assert.equal(wheel.ffbCaps.constant, false);
  await wheel.setConstantForce(0.5);
  assert.equal(input.sent.length, 0);
});

class FakeUnifiedWheel extends FakeHidppDevice {
  constructor(productId = 0xc26e, productName = 'G923 Racing Wheel') {
    super();
    this.productId = productId;
    this.productName = productName;
    this.collections = [...inputCollections(), ...hidppCollections({ short: false })];
  }
}

test('G923 Xbox uses HID++ on the same interface as input', async () => {
  const device = new FakeUnifiedWheel();
  globalThis.navigator.hid = {
    requestDevice: async () => [],
    getDevices: async () => [device]
  };

  const wheel = new WebHIDWheel();
  await wheel.connect(device);

  assert.equal(wheel.profile.name, 'Logitech G923 Racing Wheel (Xbox/PC)');
  assert.equal(wheel.device, device);
  assert.equal(wheel.ffbDevice, device);
  assert.deepEqual(wheel.interfaces, [device]);
  assert.equal(wheel.ffbCaps.constant, true);
  assert.equal(sentFor(device, 0, 0)[0].reportId, 0x11);

  await wheel.setConstantForce(0.5);
  const downloads = sentFor(device, device.featureIndex, 2);
  assert.equal(downloads.length, 2);
  assert.equal(downloads[1].data[4], 0x80);
  assert.equal((downloads[1].data[9] << 8) | downloads[1].data[10], 0xf000);

  device.oninputreport(report(1, [
    0x00, 0x80,
    0xff, 0xff,
    0x00, 0x00,
    0x00, 0x40,
    0x00, 0x00,
    0x08
  ]));
  assert.equal(wheel.steering, 0x8000);

  await wheel.disconnect();
  assert.equal(device.opened, false);
});

test('G923 PlayStation profile uses the classic force protocol', async () => {
  const device = new FakeInputDevice();
  device.productId = 0xc266;
  device.productName = 'G923 Racing Wheel';
  globalThis.navigator.hid = {
    requestDevice: async () => [],
    getDevices: async () => [device]
  };

  const wheel = new WebHIDWheel();
  await wheel.connect(device);

  assert.equal(wheel.profile.name, 'Logitech G923 Racing Wheel (PlayStation/PC)');
  assert.equal(wheel.ffbCaps.constant, true);
  assert.deepEqual(Array.from(device.sent[0].data), [0xf5, 0, 0, 0, 0, 0, 0]);

  await wheel.setConstantForce(0.5);
  assert.deepEqual(Array.from(device.sent[2].data), [0x11, 0x00, 143, 0, 0, 0, 0]);
});

test('RS50 profile uses the separate HID++ interface', async () => {
  const input = new FakeInputDevice();
  const hidpp = new FakeHidppDevice();
  for (const device of [input, hidpp]) {
    device.productId = 0xc276;
    device.productName = 'RS50 Base for PlayStation/PC';
  }
  globalThis.navigator.hid = {
    requestDevice: async () => [],
    getDevices: async () => [input, hidpp]
  };

  const wheel = new WebHIDWheel();
  await wheel.connect(input);

  assert.equal(wheel.profile.name, 'Logitech RS50 (HID++)');
  assert.equal(wheel.device, input);
  assert.equal(wheel.ffbDevice, hidpp);
  assert.equal(wheel.ffbCaps.constant, true);
});
