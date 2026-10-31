import test from 'node:test';
import assert from 'node:assert/strict';
import {
  LogitechTestDriver,
  LOGITECH_TEST_DRIVER_VERSION
} from '../src/core/logitech-test-driver.js';

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

class FakeInputDevice {
  constructor() {
    this.vendorId = 0x046d;
    this.productId = 0xc276;
    this.productName = 'RS50 Base';
    this.collections = [{
      usagePage: 0x01,
      usage: 0x04,
      inputReports: [{
        reportId: 1,
        items: [
          item([usage(0x01, 0x30)], 16, 1, { max: 65535 }),
          item([usage(0x09, 0x01)], 1, 16, { max: 1, range: true }),
          item([usage(0x01, 0x39)], 4, 1, { max: 7 })
        ]
      }],
      outputReports: [],
      featureReports: []
    }];
    this.opened = false;
    this.oninputreport = null;
  }

  async open() { this.opened = true; }
  async close() { this.opened = false; }
}

class FakeHidppDevice {
  constructor() {
    this.vendorId = 0x046d;
    this.productId = 0xc276;
    this.productName = 'RS50 Base';
    this.collections = [{
      usagePage: 0xff43,
      usage: 0x0701,
      inputReports: [{ reportId: 0x12, items: [] }],
      outputReports: [
        { reportId: 0x10, items: [] },
        { reportId: 0x11, items: [] },
        { reportId: 0x12, items: [] }
      ],
      featureReports: []
    }];
    this.featureIndex = 16;
    this.nextSlot = 1;
    this.opened = false;
    this.sent = [];
    this.listeners = {};
  }

  addEventListener(type, fn) {
    (this.listeners[type] = this.listeners[type] || []).push(fn);
  }

  removeEventListener(type, fn) {
    this.listeners[type] = (this.listeners[type] || []).filter(item => item !== fn);
  }

  _emit(event) {
    for (const fn of (this.listeners.inputreport || []).slice()) fn(event);
  }

  _respond(data) {
    const feature = data[1];
    const funcSw = data[2];
    const fn = funcSw >> 4;
    let params = [];
    if (feature === 0 && fn === 0) params = [this.featureIndex];
    else if (feature === 0 && fn === 1) params = [4, 2, 0x5a];
    else if (feature === this.featureIndex) {
      if (fn === 0) params = [64, 1];
      else if (fn === 2) {
        let slot = data[3];
        if (!slot) slot = this.nextSlot++;
        params = [slot];
      } else if (fn === 3) params = [data[3], data[4]];
      else if (fn === 5) params = [0x03, 0x84];
      else if (fn === 6) params = [data[3], data[4]];
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

test('dedicated Logitech driver initializes and runs update strategies', async () => {
  const input = new FakeInputDevice();
  const hidpp = new FakeHidppDevice();
  const logs = [];
  const driver = new LogitechTestDriver({
    onLog: entry => logs.push(entry),
    config: { strength: 0.5, forceSign: 1 }
  });

  assert.equal(driver.version, LOGITECH_TEST_DRIVER_VERSION);
  await driver.connect([input, hidpp]);
  assert.equal(driver.inputDevice, input);
  assert.equal(driver.ffbDevice, hidpp);
  assert.equal(driver.interfaces.length, 2);

  await driver.initialize();
  assert.equal(driver.featureIndex, 16);
  assert.equal(driver.slotCount, 64);
  assert.equal(driver.autocenterSlot, 1);
  assert.deepEqual(driver.protocolVersion, { major: 4, minor: 2, ping: 0x5a });

  await driver.allocate(0.5);
  assert.equal(driver.slot, 2);
  const allocation = sentFor(hidpp, 16, 2).slice(-1)[0];
  assert.equal(allocation.data[4], 0x80);
  assert.equal((allocation.data[9] << 8) | allocation.data[10], 8192);

  await driver.setForce(0.25);
  const update = sentFor(hidpp, 16, 2).slice(-1)[0];
  assert.equal(update.data[3], 2);
  assert.equal(update.data[4], 0x00);
  assert.equal((update.data[9] << 8) | update.data[10], 4096);

  await driver.stop();
  const zero = sentFor(hidpp, 16, 2).slice(-1)[0];
  assert.equal(zero.data[4], 0x00);
  assert.equal((zero.data[9] << 8) | zero.data[10], 0);
  assert.equal(driver.playing, false);

  await driver.resume(0.5);
  const resume = sentFor(hidpp, 16, 2).slice(-1)[0];
  assert.equal(resume.data[4], 0x80);
  assert.equal(driver.playing, true);

  driver.configure({ autostartUpdate: true });
  await driver.setForce(0.5);
  const autostart = sentFor(hidpp, 16, 2).slice(-1)[0];
  assert.equal(autostart.data[4], 0x80);

  driver.configure({ forceSign: -1 });
  await driver.allocate(0.5);
  const inverted = sentFor(hidpp, 16, 2).slice(-1)[0];
  assert.equal((inverted.data[9] << 8) | inverted.data[10], 0xe000);

  await driver.destroySlot();
  assert.equal(driver.slot, 0);

  await driver.disconnect();
  assert.equal(input.opened, false);
  assert.equal(hidpp.opened, false);
  assert.ok(logs.some(entry => entry.dir === 'tx'));
  assert.ok(logs.some(entry => entry.dir === 'rx'));
});
