import { HidppTransport } from './hidpp.js';

const FORCE_FEEDBACK_FEATURE = 0x8123;
const EFFECT_CONSTANT = 0x00;
const EFFECT_SPRING = 0x06;
const EFFECT_AUTOSTART = 0x80;
const STATE_STOP = 0x01;
const STATE_PLAY = 0x02;
const FN_GET_INFO = 0;
const FN_RESET_ALL = 1;
const FN_DOWNLOAD_EFFECT = 2;
const FN_SET_EFFECT_STATE = 3;
const FN_DESTROY_EFFECT = 4;
const FN_SET_APERTURE = 6;

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function forceLevel(value, wheel, options) {
  const strength = wheel && wheel.ffbStrength !== undefined ? wheel.ffbStrength : 1;
  const sign = options.invertForce ? -1 : 1;
  const force = clamp(Number(value) || 0, -1, 1) * strength * sign;
  return Math.round(clamp(force, -1, 1) * 32767);
}

function stateFor(wheel) {
  if (!wheel._hidppFfb) {
    wheel._hidppFfb = {
      transport: null,
      featureIndex: 0,
      protocolVersion: null,
      slotCount: 0,
      autocenterSlot: 0,
      slot: 0,
      playing: false,
      initialized: false,
      initPromise: null,
      lastLevel: 0,
      options: {}
    };
  }
  return wheel._hidppFfb;
}

function constantParams(effectId, level, options) {
  const params = new Uint8Array(14);
  params[0] = effectId;
  params[1] = EFFECT_CONSTANT | (options.autostart === false ? 0 : EFFECT_AUTOSTART);
  params[6] = (level >> 8) & 0xff;
  params[7] = level & 0xff;
  return params;
}

async function setAperture(state, wheel, options) {
  const min = options.minAperture !== undefined ? options.minAperture : 90;
  const max = options.maxAperture !== undefined ? options.maxAperture : 2700;
  const range = Math.round(clamp(Number(wheel.maxRotation) || 900, min, max));
  await state.transport.send(state.featureIndex, FN_SET_APERTURE, [
    (range >> 8) & 0xff,
    range & 0xff
  ]);
}

async function initialize(device, wheel, options, state) {
  if (!state.transport) {
    state.transport = new HidppTransport(device, options.transport || {});
  }
  if (options.protocolVersion !== false && !state.protocolVersion) {
    try {
      state.protocolVersion = await state.transport.getProtocolVersion({
        timeout: options.protocolTimeout !== undefined ? options.protocolTimeout : 300
      });
    } catch { /* noop */ }
  }
  if (!state.featureIndex) {
    state.featureIndex = options.featureIndex ||
      await state.transport.getFeatureIndex(options.featureId || FORCE_FEEDBACK_FEATURE);
  }

  try {
    const info = await state.transport.send(state.featureIndex, FN_GET_INFO);
    state.slotCount = info[3] || 0;
  } catch { /* noop */ }

  try {
    await state.transport.send(state.featureIndex, FN_RESET_ALL);
  } catch { /* noop */ }

  try {
    await setAperture(state, wheel, options);
  } catch { /* noop */ }

  const autocenter = new Uint8Array(18);
  autocenter[1] = EFFECT_SPRING | EFFECT_AUTOSTART;
  try {
    const response = await state.transport.send(state.featureIndex, FN_DOWNLOAD_EFFECT, autocenter);
    state.autocenterSlot = response[3] || 0;
  } catch { /* noop */ }

  return state;
}

async function ensureInitialized(device, wheel, options, state) {
  if (state.initialized) return state;
  if (!state.initPromise) {
    state.options = options;
    state.initPromise = initialize(device, wheel, options, state)
      .then(result => {
        result.initialized = true;
        return result;
      })
      .catch(error => {
        state.initPromise = null;
        throw error;
      });
  }
  return state.initPromise;
}

async function applyConstant(device, value, wheel, options) {
  const state = stateFor(wheel);
  await ensureInitialized(device, wheel, options, state);
  const level = forceLevel(value, wheel, options);

  if (!state.slot) {
    const response = await state.transport.send(
      state.featureIndex,
      FN_DOWNLOAD_EFFECT,
      constantParams(0, level, options)
    );
    const slot = response[3];
    if (!slot) throw new Error('Logitech HID++ did not allocate a force-feedback slot.');
    state.slot = slot;
    state.playing = true;
    try {
      await state.transport.send(state.featureIndex, FN_SET_EFFECT_STATE, [slot, STATE_PLAY]);
    } catch { /* autostart is the primary path */ }
  } else {
    await state.transport.send(
      state.featureIndex,
      FN_DOWNLOAD_EFFECT,
      constantParams(state.slot, level, options)
    );
    state.playing = true;
  }

  state.lastLevel = level;
}

async function stop(wheel) {
  const state = wheel && wheel._hidppFfb;
  if (!state || !state.transport || !state.slot) return;
  try {
    await state.transport.send(
      state.featureIndex,
      FN_DOWNLOAD_EFFECT,
      constantParams(state.slot, 0, state.options || {})
    );
  } catch { /* noop */ }
  try {
    await state.transport.send(state.featureIndex, FN_SET_EFFECT_STATE, [state.slot, STATE_STOP]);
  } catch { /* noop */ }
  state.playing = false;
  state.lastLevel = 0;
}

async function dispose(wheel) {
  const state = wheel && wheel._hidppFfb;
  if (!state) return;
  await stop(wheel);
  if (state.transport) {
    if (state.slot) {
      try {
        await state.transport.send(state.featureIndex, FN_DESTROY_EFFECT, [state.slot]);
      } catch { /* noop */ }
    }
    if (state.autocenterSlot) {
      try {
        await state.transport.send(state.featureIndex, FN_DESTROY_EFFECT, [state.autocenterSlot]);
      } catch { /* noop */ }
    }
    state.transport.close();
  }
  wheel._hidppFfb = null;
}

export function createHidppFfb(options = {}) {
  return {
    init: (device, wheel) => ensureInitialized(device, wheel, options, stateFor(wheel)),
    constant: (device, value, wheel) => applyConstant(device, value, wheel, options),
    constantFast: (device, value, wheel) => applyConstant(device, value, wheel, options),
    stop: (device, wheel) => stop(wheel),
    dispose: (device, wheel) => dispose(wheel)
  };
}
