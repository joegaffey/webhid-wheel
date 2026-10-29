import test from 'node:test';
import assert from 'node:assert/strict';
import {
  applyAxisCalibration,
  applySteeringCalibration
} from '../src/core/calibration.js';

test('axis calibration passes normalized values through by default', () => {
  assert.equal(applyAxisCalibration(0), 0);
  assert.equal(applyAxisCalibration(0.5), 0.5);
  assert.equal(applyAxisCalibration(1), 1);
});

test('axis calibration applies inversion, range, deadzone and saturation', () => {
  assert.equal(applyAxisCalibration(0.25, { invert: true }), 0.75);
  assert.ok(Math.abs(applyAxisCalibration(0.5, { min: 0.2, max: 0.8 }) - 0.5) < 1e-9);
  assert.equal(applyAxisCalibration(0.1, { deadzone: 0.2 }), 0);
  assert.ok(Math.abs(applyAxisCalibration(0.6, { deadzone: 0.2, saturation: 0.8 }) - 2 / 3) < 1e-9);
  assert.equal(applyAxisCalibration(1, { deadzone: 0.2, saturation: 0.8 }), 1);
});

test('axis calibration maps a center detent piecewise', () => {
  assert.equal(applyAxisCalibration(0.25, { min: 0, center: 0.25, max: 1 }), 0.5);
  assert.equal(applyAxisCalibration(0.125, { min: 0, center: 0.25, max: 1 }), 0.25);
  assert.equal(applyAxisCalibration(0.625, { min: 0, center: 0.25, max: 1 }), 0.75);
});

test('steering calibration normalizes deadzone and saturation in degrees', () => {
  assert.equal(applySteeringCalibration(0, 900, { deadzone: 0.1, saturation: 1 }), 0);
  assert.equal(applySteeringCalibration(45, 900, { deadzone: 0.1, saturation: 1 }), 0);
  assert.equal(applySteeringCalibration(450, 900, { deadzone: 0, saturation: 1 }), 450);
  assert.equal(applySteeringCalibration(450, 900, { deadzone: 0, saturation: 0.5 }), 450);
  assert.equal(applySteeringCalibration(360, 900, { deadzone: 0.1, saturation: 0.5 }), 450);
});

test('steering calibration supports inversion and clamps beyond full lock', () => {
  assert.equal(applySteeringCalibration(450, 900, { invert: true }), -450);
  assert.equal(applySteeringCalibration(900, 900, {}), 450);
  assert.equal(applySteeringCalibration(-900, 900, {}), -450);
});
