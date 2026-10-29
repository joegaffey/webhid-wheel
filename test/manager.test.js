import test from 'node:test';
import assert from 'node:assert/strict';
import { WheelManager } from '../src/core/manager.js';
import { validateProfile } from '../src/core/profiles.js';

globalThis.navigator.hid = { requestDevice: async () => [] };

const usage = (page, id) => (page << 16) | id;

function item(usages, reportSize, reportCount = 1, logicalMinimum = 0, logicalMaximum = (1 << reportSize) - 1) {
  return { usages, reportSize, reportCount, logicalMinimum, logicalMaximum };
}

function makeDescriptor() {
  return [{
    usagePage: 0x01,
    usage: 0x04,
    inputReports: [{
      reportId: 1,
      items: [
        item([usage(0x01, 0x30)], 16, 1, 0, 65535),
        item([usage(0x01, 0x31)], 8, 1, 0, 255),
        item([usage(0x01, 0x32)], 8, 1, 0, 255),
        item([usage(0x09, 0x01)], 1, 8, 0, 1)
      ]
    }],
    outputReports: [],
    featureReports: []
  }];
}

class FakeDevice {
  constructor(name = 'Fake Wheel') {
    this.collections = makeDescriptor();
    this.productName = name;
    this.vendorId = 0xffff;
    this.productId = 0xffff;
    this.opened = false;
    this.oninputreport = null;
  }

  async open() { this.opened = true; }
  async close() { this.opened = false; }
  async sendReport() {}
}

function report(bytes) {
  const data = new DataView(Uint8Array.from(bytes).buffer);
  return { data, timeStamp: 1, reportId: 1 };
}

test('WheelManager constructs without a wheel and connects one on demand', async () => {
  const manager = new WheelManager({ maxRotation: 900 });
  assert.equal(manager.isConnected, false);
  assert.equal(manager.wheel, null);

  const device = new FakeDevice();
  const connected = await manager.connectWheel(device);
  assert.equal(connected, device);
  assert.equal(manager.isConnected, true);
  assert.ok(manager.state.wheel);

  await manager.disconnectAll();
  assert.equal(manager.isConnected, false);
});

test('WheelManager applies calibration and FFB settings to the wheel', async () => {
  const manager = new WheelManager();
  await manager.connectWheel(new FakeDevice());

  assert.deepEqual(manager.setCalibration({ deadzone: 0.1, saturation: 0.5, invert: true }), {
    deadzone: 0.1,
    saturation: 0.5,
    invert: true
  });
  assert.equal(manager.wheel.deadzone, 0.1);
  assert.equal(manager.wheel.saturation, 0.5);
  assert.equal(manager.wheel.invertSteering, true);

  assert.deepEqual(manager.setFfb({ gain: 0.75, invert: true }), { gain: 0.75, invert: true });
  assert.equal(manager.wheel.ffbStrength, 0.75);
  assert.equal(manager.wheel.ffbInvert, true);
});

test('WheelManager maps wheel and external device inputs into channels', async () => {
  const manager = new WheelManager();
  const wheelDevice = new FakeDevice();
  await manager.connectWheel(wheelDevice);

  const pedals = new FakeDevice('Fake Pedals');
  await manager.addDevice('pedals', pedals);

  manager.setMapping({
    axes: {
      throttle: { device: 'wheel', source: 'axis', index: 1 },
      brake: { device: 'pedals', source: 'axis', index: 2 }
    },
    buttons: {
      shiftUp: { device: 'wheel', source: 'button', index: 4 }
    }
  });

  wheelDevice.oninputreport(report([0x00, 0x80, 0xff, 0x00, 0x10]));
  assert.equal(manager.channels.throttle, 1);
  assert.equal(manager.channels.shiftUp, 1);

  wheelDevice.oninputreport(report([0x00, 0x80, 0x80, 0x00, 0x00]));
  assert.ok(Math.abs(manager.channels.throttle - 0.5) < 0.01);

  pedals.oninputreport(report([0x00, 0x80, 0x00, 0xff, 0x00]));
  assert.equal(manager.channels.brake, 1);
  assert.equal(manager.state.devices.pedals.axes[2], 1);
});

test('WheelManager snapshots and applies setup profiles', async () => {
  const manager = new WheelManager({ maxRotation: 900 });
  await manager.connectWheel(new FakeDevice('Profile Wheel'));
  manager.setCalibration({ deadzone: 0.05, saturation: 0.9, invert: true });
  manager.setFfb({ gain: 0.4, invert: true });
  manager.setMapping({
    axes: { throttle: { device: 'wheel', source: 'axis', index: 1 } },
    buttons: { shiftUp: { device: 'wheel', source: 'button', index: 4 } }
  });

  const setup = manager.toSetup({ profileName: 'Profile Wheel Setup' });
  const profile = validateProfile(setup);
  assert.equal(profile.profileName, 'Profile Wheel Setup');
  assert.equal(profile.hardware.vendorId, 0xffff);
  assert.equal(profile.settings.steering.deadzone, 0.05);
  assert.equal(profile.settings.ffb.gain, 0.4);
  assert.equal(profile.settings.axes.throttle.index, 1);

  manager.setCalibration({ deadzone: 0 });
  manager.applySetup(profile);
  assert.equal(manager.getCalibration().deadzone, 0.05);
  assert.equal(manager.getFfb().gain, 0.4);
  assert.equal(manager.getMapping().buttons.shiftUp.index, 4);
});

test('WheelManager connects an authorized device without requestDevice', async () => {
  const original = globalThis.navigator.hid;
  globalThis.navigator.hid = { getDevices: async () => [] };
  try {
    const manager = new WheelManager();
    const device = new FakeDevice('Worker Wheel');
    const connected = await manager.connectWheel(device);
    assert.equal(connected, device);
    assert.equal(manager.isConnected, true);
  } finally {
    globalThis.navigator.hid = original;
  }
});
