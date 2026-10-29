import test from 'node:test';
import assert from 'node:assert/strict';
import { WheelManager } from '../src/core/manager.js';
import { validateProfile } from '../src/core/profiles.js';

globalThis.navigator.hid = { requestDevice: async () => [] };

const usage = (page, id) => (page << 16) | id;

function item(usages, reportSize, reportCount = 1, logicalMinimum = 0, logicalMaximum = (1 << reportSize) - 1) {
  return { usages, reportSize, reportCount, logicalMinimum, logicalMaximum };
}

function wheelDescriptor() {
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

function pedalDescriptor() {
  return [{
    usagePage: 0x01,
    usage: 0x05,
    inputReports: [{
      reportId: 2,
      items: [
        item([usage(0x01, 0x31)], 8, 1, 0, 255),
        item([usage(0x01, 0x32)], 8, 1, 0, 255),
        item([usage(0x01, 0x33)], 8, 1, 0, 255)
      ]
    }],
    outputReports: [],
    featureReports: []
  }];
}

class FakeDevice {
  constructor(name, descriptor, vendorId = 0xffff, productId = 0xffff) {
    this.collections = descriptor;
    this.productName = name;
    this.vendorId = vendorId;
    this.productId = productId;
    this.opened = false;
    this.oninputreport = null;
  }

  async open() { this.opened = true; }
  async close() { this.opened = false; }
  async sendReport() {}
}

function report(reportId, bytes) {
  const data = new DataView(Uint8Array.from(bytes).buffer);
  return { data, timeStamp: 1, reportId };
}

test('WheelManager connects a device and exposes sessions without a synthetic wheel role', async () => {
  const manager = new WheelManager({ maxRotation: 900 });
  assert.equal(manager.isConnected, false);
  assert.equal(manager.sessionList.length, 0);

  const device = new FakeDevice('Fake Wheel', wheelDescriptor(), 0x1234, 0x5678);
  const entry = await manager.connect(device);
  assert.equal(entry.device, device);
  assert.equal(manager.isConnected, true);
  assert.equal(manager.sessionList.length, 1);
  assert.equal(entry.capabilities.steering, true);
  assert.equal(entry.capabilities.ffb, false);
  assert.equal(manager.getCalibration().device, entry.id);
  assert.equal(manager.getFfb().device, null);

  device.oninputreport(report(1, [0xff, 0xff, 0xff, 0x00, 0x10]));
  assert.equal(manager.channels.steering, 1);
  assert.equal(manager.state.sessions[entry.id].name, 'Fake Wheel');

  await manager.disconnectAll();
  assert.equal(manager.isConnected, false);
});

test('manager input events identify the session that produced them', async () => {
  const manager = new WheelManager();
  const wheel = new FakeDevice('Source Wheel', wheelDescriptor(), 0x1010, 0x2020);
  const pedals = new FakeDevice('Source Pedals', pedalDescriptor(), 0x3030, 0x4040);
  const wheelEntry = await manager.connect(wheel);
  await manager.connect(pedals);
  let payload = null;
  manager.on('input', state => { payload = state; });

  wheel.oninputreport(report(1, [0x00, 0x80, 0x00, 0x00, 0x00]));
  assert.equal(payload.sessionId, wheelEntry.id);
  assert.ok(payload.sessions[wheelEntry.id]);
});

test('WheelManager applies steering calibration and selectable FFB settings', async () => {
  const manager = new WheelManager();
  const entry = await manager.connect(new FakeDevice('Cal Wheel', wheelDescriptor()));

  const calibration = manager.setCalibration({ deadzone: 0.1, saturation: 0.5, invert: true, maxRotation: 720 });
  assert.equal(calibration.deadzone, 0.1);
  assert.equal(calibration.maxRotation, 720);
  assert.equal(entry.session.deadzone, 0.1);
  assert.equal(entry.session.saturation, 0.5);
  assert.equal(entry.session.invertSteering, true);

  const ffb = manager.setFfb({ device: entry.id, gain: 0.75, invert: true });
  assert.deepEqual(ffb, { device: entry.id, gain: 0.75, invert: true });
  assert.equal(entry.session.ffbStrength, 0.75);
  assert.equal(entry.session.ffbInvert, true);
});

test('WheelManager maps multiple devices by session id', async () => {
  const manager = new WheelManager();
  const wheel = new FakeDevice('Wheel A', wheelDescriptor(), 0x1111, 0x2222);
  const pedals = new FakeDevice('Pedals B', pedalDescriptor(), 0x3333, 0x4444);
  const wheelEntry = await manager.connect(wheel);
  const pedalEntry = await manager.connect(pedals);

  assert.equal(wheelEntry.driver, 'wheel');
  assert.equal(pedalEntry.driver, 'generic');
  assert.equal(pedalEntry.capabilities.axes, 3);

  manager.setMapping({
    steering: { device: wheelEntry.id },
    axes: {
      throttle: { device: pedalEntry.id, source: 'axis', index: 0 },
      brake: { device: pedalEntry.id, source: 'axis', index: 1 }
    },
    buttons: {
      shiftUp: { device: wheelEntry.id, source: 'button', index: 4 }
    }
  });

  wheel.oninputreport(report(1, [0x80, 0x00, 0x00, 0x00, 0x10]));
  pedals.oninputreport(report(2, [0xff, 0x80, 0x00]));
  assert.equal(manager.channels.shiftUp, 1);
  assert.ok(Math.abs(manager.channels.throttle - 1) < 1e-9);
  assert.ok(Math.abs(manager.channels.brake - 0.5019607843137255) < 1e-9);
});

test('WheelManager snapshots and applies multi-device setup profiles', async () => {
  const manager = new WheelManager({ maxRotation: 900 });
  const wheel = await manager.connect(new FakeDevice('Profile Wheel', wheelDescriptor(), 0xaaaa, 0xbbbb));
  const pedals = await manager.connect(new FakeDevice('Profile Pedals', pedalDescriptor(), 0xcccc, 0xdddd));
  manager.setCalibration({ deadzone: 0.05, saturation: 0.9, invert: true, maxRotation: 800 });
  manager.setFfb({ device: wheel.id, gain: 0.4, invert: true });
  manager.setMapping({
    steering: { device: wheel.id },
    axes: { throttle: { device: pedals.id, source: 'axis', index: 0 } },
    buttons: { shiftUp: { device: wheel.id, source: 'button', index: 4 } }
  });

  const setup = manager.toSetup({ profileName: 'Profile Rig' });
  const profile = validateProfile(setup);
  assert.equal(profile.schemaVersion, 2);
  assert.equal(profile.devices.length, 2);
  assert.equal(profile.profileName, 'Profile Rig');
  assert.equal(profile.settings.steering.maxRotation, 800);
  assert.equal(profile.settings.ffb.gain, 0.4);

  manager.setCalibration({ deadzone: 0 });
  manager.setFfb({ device: null, gain: 0.1 });
  manager.applySetup(profile);
  assert.equal(manager.getCalibration().deadzone, 0.05);
  assert.equal(manager.getFfb().gain, 0.4);
  assert.equal(manager.getFfb().device, wheel.id);
  assert.equal(manager.getMapping().axes.throttle.device, pedals.id);
});

test('WheelManager connects an authorized device without requestDevice', async () => {
  const original = globalThis.navigator.hid;
  globalThis.navigator.hid = { getDevices: async () => [] };
  try {
    const manager = new WheelManager();
    const device = new FakeDevice('Worker Wheel', wheelDescriptor());
    const entry = await manager.connect(device);
    assert.equal(entry.device, device);
    assert.equal(manager.isConnected, true);
  } finally {
    globalThis.navigator.hid = original;
  }
});

test('a gamepad with an X axis is not classified as a wheel', async () => {
  const manager = new WheelManager();
  const gamepad = new FakeDevice('Xbox Wireless Controller', [{
    usagePage: 0x01,
    usage: 0x05,
    inputReports: [{
      reportId: 3,
      items: [
        item([usage(0x01, 0x30)], 16, 1, 0, 65535),
        item([usage(0x01, 0x31)], 16, 1, 0, 65535),
        item([usage(0x09, 0x01)], 1, 8, 0, 1)
      ]
    }],
    outputReports: [],
    featureReports: []
  }], 0x045e, 0x0b13);
  const entry = await manager.connect(gamepad);
  assert.equal(entry.driver, 'generic');
  assert.equal(entry.capabilities.steering, false);
  assert.equal(manager.getCalibration().device, null);
});

test('a joystick-like receiver without wheel naming is not classified as a wheel', async () => {
  const manager = new WheelManager();
  const receiver = new FakeDevice('Xbox 360 Wireless Receiver for Windows', [{
    usagePage: 0x01,
    usage: 0x04,
    inputReports: [{
      reportId: 1,
      items: [
        item([usage(0x01, 0x30)], 16, 1, 0, 65535),
        item([usage(0x09, 0x01)], 1, 8, 0, 1)
      ]
    }],
    outputReports: [],
    featureReports: []
  }], 0x045e, 0x028e);
  const entry = await manager.connect(receiver);
  assert.equal(entry.driver, 'generic');
  assert.equal(entry.capabilities.steering, false);
  assert.equal(manager.getCalibration().device, null);
});

test('an analog handbrake is not overwritten by a button handbrake mapping', async () => {
  const manager = new WheelManager();
  const device = new FakeDevice('Arduino', [{
    usagePage: 0x01,
    usage: 0x05,
    inputReports: [{
      reportId: 1,
      items: [
        item([usage(0x09, 0x01)], 1, 8, 0, 1),
        item([usage(0x01, 0x30)], 8, 1, 0, 255),
        item([usage(0x01, 0x31)], 8, 1, 0, 255)
      ]
    }],
    outputReports: [],
    featureReports: []
  }], 0x045e, 0x028e);
  const entry = await manager.connect(device);
  manager.setMapping({
    axes: { handbrake: { device: entry.id, source: 'axis', index: 1 } },
    buttons: { handbrake: { device: entry.id, source: 'button', index: 0 } }
  });

  device.oninputreport(report(1, [0x00, 0x00, 0x80]));
  assert.ok(Math.abs(manager.channels.handbrake - 128 / 255) < 1e-9);
});

test('WheelManager reuses a disconnected session by hardware signature', async () => {
  const manager = new WheelManager();
  const first = new FakeDevice('Reusable Wheel', wheelDescriptor(), 0x5151, 0x6161);
  const entry = await manager.connect(first);
  await manager.disconnect(entry.id);
  assert.equal(manager.isConnected, false);

  const second = new FakeDevice('Reusable Wheel', wheelDescriptor(), 0x5151, 0x6161);
  const reconnected = await manager.connect(second);
  assert.equal(reconnected.id, entry.id);
  assert.equal(reconnected.device, second);
  assert.equal(manager.isConnected, true);
  assert.equal(manager.sessionList.length, 1);
});
