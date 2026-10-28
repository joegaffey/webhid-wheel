import test from 'node:test';
import assert from 'node:assert/strict';
import { WebHIDDevice, WebHIDWheel, mapChannels, isForceFeedbackWheel } from '../webhid-wheel.js';

globalThis.navigator.hid = { requestDevice: async () => [] };

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

function makeDescriptor() {
  return [{
    usagePage: 0x01,
    usage: 0x05,
    inputReports: [
      {
        reportId: 1,
        items: [
          item([usage(0x01, 0x30)], 16, 1, { max: 65535 }),
          item([usage(0x01, 0x31)], 8, 1, { max: 255 }),
          item([usage(0x01, 0x39)], 4, 1, { max: 7 }),
          item([usage(0x09, 0x01)], 1, 8, { max: 1, range: true })
        ]
      },
      {
        reportId: 2,
        items: [
          item([usage(0x01, 0x36)], 8, 1, { max: 255 })
        ]
      }
    ],
    outputReports: [],
    featureReports: []
  }];
}

class FakeDevice {
  constructor() {
    this.collections = makeDescriptor();
    this.productName = 'Fake Generic HID';
    this.vendorId = 0xffff;
    this.productId = 0xffff;
    this.opened = false;
    this.oninputreport = null;
  }

  async open() { this.opened = true; }
  async close() { this.opened = false; }
}

function report(id, bytes, timeStamp = 1) {
  const data = new Uint8Array(bytes);
  return { reportId: id, data: new DataView(data.buffer), timeStamp };
}

test('generic HID device parses axes, hats, buttons and multiple reports', async () => {
  const device = new FakeDevice();
  const input = new WebHIDDevice();
  await input.connect(device);

  assert.equal(input.inputLayout.axes.length, 3);
  assert.equal(input.inputLayout.buttons.length, 8);
  assert.equal(input.inputLayout.hats.length, 1);

  device.oninputreport(report(1, [0x00, 0x80, 0x80, 0x12, 0x00]));
  let state = input.state;
  assert.equal(state.rawAxes[0], 32768);
  assert.ok(Math.abs(state.axes[0] - 0.5) < 0.01);
  assert.ok(Math.abs(state.axes[1] - 128 / 255) < 0.01);
  assert.equal(state.hats[0].direction, 'right');
  assert.equal(state.buttons[0], true);
  assert.equal(state.buttons[1], false);
  assert.deepEqual(state.reports[1], [0x00, 0x80, 0x80, 0x12, 0]);

  device.oninputreport(report(2, [0xff]));
  state = input.state;
  assert.equal(state.rawAxes[2], 255);
  assert.equal(state.axes[2], 1);
});

test('channel mapping supports axes, buttons, hats and inversion', () => {
  const state = {
    axes: [0.25, 0.75, 1],
    rawAxes: [1, 2, 3],
    buttons: [true, false],
    hats: [{ raw: 2, x: 1, y: 0, direction: 'right' }],
    reports: {},
    timestamp: 0,
    reportId: 1
  };

  const channels = mapChannels(state, {
    throttle: { source: 'axis', index: 0 },
    brake: { source: 'axis', index: 1, invert: true },
    gearUp: { source: 'hat', index: 0, direction: 'right' },
    gearDown: { source: 'hat', index: 0, direction: 'left' },
    accept: { source: 'button', index: 0 },
    cancel: { source: 'button', index: 1 }
  });

  assert.equal(channels.throttle, 0.25);
  assert.equal(channels.brake, 0.25);
  assert.equal(channels.gearUp, 1);
  assert.equal(channels.gearDown, 0);
  assert.equal(channels.accept, 1);
  assert.equal(channels.cancel, 0);
});

test('a plain HID gamepad is not detected as a force-feedback wheel', () => {
  assert.equal(isForceFeedbackWheel(new FakeDevice()), false);
});

test('wheel sessions also expose generic axes, hats and raw reports', async () => {
  const device = new FakeDevice();
  const wheel = new WebHIDWheel({ maxRotation: 900 });
  await wheel.connect(device);

  device.oninputreport(report(1, [0x00, 0x80, 0x80, 0x12, 0x00]));
  assert.ok(Math.abs(wheel.rotation) < 0.01);
  assert.equal(wheel.deviceState.rawAxes[0], 32768);
  assert.equal(wheel.deviceState.hats[0].direction, 'right');
  assert.equal(wheel.deviceState.buttons[0], true);
  assert.deepEqual(wheel.state.hats, wheel.deviceState.hats);
});
