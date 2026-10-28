import test from 'node:test';
import assert from 'node:assert/strict';
import { WebHIDWheel } from '../webhid-wheel.js';

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
      reportId: 0x01,
      items: [item([usage(0x01, 0x30)], 16, 1, 0, 65535)]
    }],
    outputReports: [
      {
        reportId: 0x11,
        items: [
          item([usage(0x0f, 0x22)], 8),
          item([usage(0x0f, 0x26)], 8),
          item([usage(0x0f, 0x50)], 16),
          item([usage(0x0f, 0x52)], 8),
          item([usage(0x0f, 0x56)], 1),
          item([usage(0x01, 0x30)], 1)
        ]
      },
      {
        reportId: 0x12,
        items: [
          item([usage(0x0f, 0x22)], 8),
          item([usage(0x0f, 0x70)], 16, 1, -10000, 10000)
        ]
      },
      {
        reportId: 0x13,
        items: [
          item([usage(0x0f, 0x22)], 8),
          item([usage(0x0f, 0x79), usage(0x0f, 0x7a), usage(0x0f, 0x7b)], 8)
        ]
      }
    ],
    featureReports: []
  }];
}

class FakeDevice {
  constructor() {
    this.collections = makeDescriptor();
    this.productName = 'Fake PID Wheel';
    this.vendorId = 0xffff;
    this.productId = 0xffff;
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

function readSigned(data, bitOffset, size) {
  let value = 0;
  for (let i = 0; i < size; i++) {
    const bit = bitOffset + i;
    value |= ((data[bit >> 3] >> (bit & 7)) & 1) << i;
  }
  const sign = 1 << (size - 1);
  return value & sign ? value - (1 << size) : value;
}

async function setup(options) {
  const wheel = new WebHIDWheel(options);
  const device = new FakeDevice();
  await wheel.connect(device);
  return { wheel, device };
}

const reportIds = device => device.sent.map(report => report.reportId);

test('first fast update sets up the effect and later updates send only magnitude', async () => {
  const { wheel, device } = await setup();

  await wheel.ffb.constantFast(0.4);
  assert.deepEqual(reportIds(device), [0x11, 0x12, 0x13]);

  device.sent.length = 0;
  await wheel.setConstantForceFast(0.8);
  assert.deepEqual(reportIds(device), [0x12]);
  assert.equal(readSigned(device.sent[0].data, 8, 16), 2000);
});

test('fast updates apply strength, inversion and clamping to the magnitude', async () => {
  const { wheel, device } = await setup({ ffbStrength: 0.5, ffbInvert: true });

  await wheel.setConstantForceFast(0.5);
  assert.equal(readSigned(device.sent[1].data, 8, 16), -2500);

  device.sent.length = 0;
  await wheel.setConstantForceFast(4);
  assert.equal(readSigned(device.sent[0].data, 8, 16), -10000);
});

test('stop clears the active effect and the next fast update reinitializes', async () => {
  const { wheel, device } = await setup();

  await wheel.setConstantForceFast(0.2);
  device.sent.length = 0;
  await wheel.setConstantForceFast(0.4);
  assert.deepEqual(reportIds(device), [0x12]);

  device.sent.length = 0;
  await wheel.stopEffects();
  assert.deepEqual(reportIds(device), [0x13, 0x12]);
  assert.equal(readSigned(device.sent[1].data, 8, 16), 0);

  device.sent.length = 0;
  await wheel.setConstantForceFast(0.3);
  assert.deepEqual(reportIds(device), [0x11, 0x12, 0x13]);
});

test('stop before any effect sends nothing', async () => {
  const { wheel, device } = await setup();
  await wheel.stopEffects();
  assert.deepEqual(device.sent, []);
});

test('disconnect stops the effect before closing the device', async () => {
  const { wheel, device } = await setup();

  await wheel.setConstantForceFast(0.3);
  device.sent.length = 0;
  await wheel.disconnect();

  assert.deepEqual(reportIds(device), [0x13, 0x12]);
  assert.equal(readSigned(device.sent[1].data, 8, 16), 0);
  assert.equal(device.opened, false);
});

test('slow constant still performs full setup on every call', async () => {
  const { wheel, device } = await setup();

  await wheel.setConstantForce(0.2);
  assert.deepEqual(reportIds(device), [0x11, 0x12, 0x13]);

  device.sent.length = 0;
  await wheel.setConstantForce(0.4);
  assert.deepEqual(reportIds(device), [0x11, 0x12, 0x13]);
});

test('fast updates fall back to the full profile hook when one is not provided', async () => {
  const calls = [];
  WebHIDWheel.registerProfile({
    name: 'Fake profile without fast hook',
    vendorId: 0xabcd,
    productId: 0x1234,
    ffb: {
      constant: async (device, value) => { calls.push(value); }
    }
  });

  const wheel = new WebHIDWheel({ ffbInvert: true });
  const device = new FakeDevice();
  device.vendorId = 0xabcd;
  device.productId = 0x1234;
  await wheel.connect(device);

  await wheel.ffb.constantFast(0.25);
  assert.deepEqual(calls, [-0.25]);
});

test('queued fast updates are coalesced to the latest magnitude', async () => {
  const { wheel, device } = await setup();

  await Promise.all([
    wheel.setConstantForceFast(0.1),
    wheel.setConstantForceFast(0.2),
    wheel.setConstantForceFast(0.3)
  ]);

  assert.deepEqual(reportIds(device), [0x11, 0x12, 0x13, 0x12]);
  assert.equal(readSigned(device.sent[3].data, 8, 16), 750);
});

test('stop queued after fast updates runs last', async () => {
  const { wheel, device } = await setup();

  await Promise.all([
    wheel.setConstantForceFast(0.1),
    wheel.setConstantForceFast(0.2),
    wheel.stopEffects()
  ]);

  assert.deepEqual(reportIds(device).slice(-2), [0x13, 0x12]);
  assert.equal(readSigned(device.sent.at(-1).data, 8, 16), 0);
});
