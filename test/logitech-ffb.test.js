import test from 'node:test';
import assert from 'node:assert/strict';
import { WebHIDWheel } from '../webhid-wheel.js';

globalThis.navigator.hid = { requestDevice: async () => [] };

class FakeDevice {
  constructor(vendorId, productId, productName) {
    this.vendorId = vendorId;
    this.productId = productId;
    this.productName = productName;
    this.collections = [];
    this.opened = false;
    this.sent = [];
    this.oninputreport = null;
  }

  async open() {
    this.opened = true;
  }

  async close() {
    this.opened = false;
  }

  async sendReport(reportId, data) {
    this.sent.push({ reportId, data: Uint8Array.from(data) });
  }
}

async function connectWheel(productId, productName, options) {
  const wheel = new WebHIDWheel(options);
  const device = new FakeDevice(0x046d, productId, productName);
  await wheel.connect(device);
  return { wheel, device };
}

const bytes = report => Array.from(report.data);

test('G29 profiles initialize autocenter and range for both product IDs', async () => {
  for (const productId of [0xc24f, 0xc260]) {
    const { wheel, device } = await connectWheel(productId, 'G29 Driving Force Racing Wheel');

    assert.equal(wheel.profile.name, 'Logitech G29 Driving Force');
    assert.equal(wheel.ffbCaps.constant, true);
    assert.deepEqual(device.sent.map(report => report.reportId), [0, 0]);
    assert.deepEqual(bytes(device.sent[0]), [0xf5, 0, 0, 0, 0, 0, 0]);
    assert.deepEqual(bytes(device.sent[1]), [0xf8, 0x81, 0x84, 0x03, 0, 0, 0]);
  }
});

test('G29 range is clamped to the hardware limits', async () => {
  const low = await connectWheel(0xc24f, 'G29 Driving Force Racing Wheel', { maxRotation: 10 });
  assert.deepEqual(bytes(low.device.sent[1]), [0xf8, 0x81, 0x28, 0x00, 0, 0, 0]);

  const high = await connectWheel(0xc24f, 'G29 Driving Force Racing Wheel', { maxRotation: 1080 });
  assert.deepEqual(bytes(high.device.sent[1]), [0xf8, 0x81, 0x84, 0x03, 0, 0, 0]);
});

test('G29 constant and fast constant send one force report', async () => {
  const { wheel, device } = await connectWheel(0xc24f, 'G29 Driving Force Racing Wheel');
  device.sent.length = 0;

  await wheel.setConstantForce(0.5);
  assert.deepEqual(device.sent.map(report => report.reportId), [0]);
  assert.deepEqual(bytes(device.sent[0]), [0x11, 0x00, 143, 0, 0, 0, 0]);

  device.sent.length = 0;
  await wheel.setConstantForceFast(0.5);
  assert.deepEqual(device.sent.map(report => report.reportId), [0]);
  assert.deepEqual(bytes(device.sent[0]), [0x11, 0x00, 143, 0, 0, 0, 0]);
});

test('G29 force respects strength, inversion and clamping', async () => {
  const { wheel, device } = await connectWheel(0xc24f, 'G29 Driving Force Racing Wheel', {
    ffbStrength: 0.5,
    ffbInvert: true
  });
  device.sent.length = 0;

  await wheel.setConstantForce(0.5);
  assert.equal(bytes(device.sent[0])[2], 96);

  device.sent.length = 0;
  await wheel.setConstantForce(5);
  assert.equal(bytes(device.sent[0])[2], 0);

  device.sent.length = 0;
  await wheel.setConstantForce(-5);
  assert.equal(bytes(device.sent[0])[2], 255);
});

test('G29 stop and disconnect send the stop-force report', async () => {
  const { wheel, device } = await connectWheel(0xc24f, 'G29 Driving Force Racing Wheel');

  await wheel.setConstantForce(0.2);
  device.sent.length = 0;
  await wheel.stopEffects();
  assert.deepEqual(bytes(device.sent[0]), [0x13, 0, 0, 0, 0, 0, 0]);

  await wheel.setConstantForce(0.2);
  device.sent.length = 0;
  await wheel.disconnect();
  assert.deepEqual(bytes(device.sent[0]), [0x13, 0, 0, 0, 0, 0, 0]);
  assert.equal(device.opened, false);
});

test('Driving Force GT uses the classic Logitech force path', async () => {
  const { wheel, device } = await connectWheel(0xc29a, 'Logitech Driving Force GT');

  assert.equal(wheel.profile.name, 'Logitech Driving Force GT');
  assert.equal(wheel.ffbCaps.constant, true);
  assert.deepEqual(bytes(device.sent[0]), [0xf5, 0, 0, 0, 0, 0, 0]);
  assert.deepEqual(bytes(device.sent[1]), [0xf8, 0x81, 0x84, 0x03, 0, 0, 0]);

  device.sent.length = 0;
  await wheel.setConstantForceFast(0);
  assert.deepEqual(bytes(device.sent[0]), [0x11, 0x00, 128, 0, 0, 0, 0]);
});

test('G920 is not captured by the G29 product IDs', async () => {
  const { wheel, device } = await connectWheel(0xc262, 'Logitech G920 Driving Force Racing Wheel');

  assert.equal(wheel.profile, null);
  assert.equal(wheel.ffbCaps.constant, false);
  assert.deepEqual(device.sent, []);
});
