import test from 'node:test';
import assert from 'node:assert/strict';
import {
  PROFILE_KIND,
  PROFILE_SCHEMA_VERSION,
  SetupProfileManager,
  ProfileManager,
  matchProfile,
  parseProfile,
  reconnectProfile,
  serializeProfile,
  validateProfile,
  validateStore
} from '../src/core/profiles.js';

const hardware = {
  vendorId: 0x046d,
  productId: 0xc24f,
  productName: 'Logitech G29'
};

function validProfile(overrides = {}) {
  return {
    kind: PROFILE_KIND,
    schemaVersion: PROFILE_SCHEMA_VERSION,
    profileName: 'Pro GT Setup',
    hardware,
    settings: {
      steering: { deadzone: 0.05, saturation: 1, maxRotation: 900, invert: false },
      ffb: { gain: 0.8, invert: false },
      axes: {
        throttle: { device: 'wheel', source: 'axis', index: 0 },
        brake: { device: 'pedals', source: 'axis', index: 1, invert: true, deadzone: 0.1 }
      },
      buttons: {
        shiftUp: { device: 'wheel', source: 'button', index: 4 },
        gear1: { device: 'wheel', source: 'hat', index: 0, direction: 'up' }
      }
    },
    metadata: { lapster: { rearLightening: 0.4 } },
    ...overrides
  };
}

test('profile validation fills defaults and round-trips stably', () => {
  const profile = validateProfile(validProfile());
  assert.equal(profile.settings.steering.deadzone, 0.05);
  assert.equal(profile.settings.axes.throttle.min, 0);
  assert.equal(profile.settings.axes.throttle.saturation, 1);
  assert.equal(profile.settings.axes.brake.invert, true);

  const text = serializeProfile(profile);
  const parsed = parseProfile(text);
  assert.deepEqual(parsed, profile);
  assert.equal(serializeProfile(parsed), text);
});

test('legacy profile shape migrates percentages and mappings', () => {
  const legacy = {
    profileName: 'Legacy GT',
    hardware,
    settings: {
      steeringDeadzone: 0.1,
      ffbGain: 80,
      axes: { throttle: { source: 'axis', index: 2 } },
      buttons: { shiftUp: { source: 'button', index: 1 } }
    }
  };
  const profile = validateProfile(legacy);
  assert.equal(profile.settings.steering.deadzone, 0.1);
  assert.equal(profile.settings.ffb.gain, 0.8);
  assert.equal(profile.settings.axes.throttle.index, 2);
  assert.equal(profile.settings.buttons.shiftUp.index, 1);
});

test('flat demo settings migrate feel values into metadata', () => {
  const legacy = {
    strength: 0.6,
    invertForce: true,
    invertSteering: true,
    deadzone: 0.02,
    rearLightening: 0.3,
    roadNoise: 0.7
  };
  const profile = validateProfile(legacy, { hardware });
  assert.equal(profile.settings.ffb.gain, 0.6);
  assert.equal(profile.settings.ffb.invert, true);
  assert.equal(profile.settings.steering.invert, true);
  assert.equal(profile.settings.steering.deadzone, 0.02);
  assert.equal(profile.metadata.lapster.rearLightening, 0.3);
  assert.equal(profile.metadata.lapster.roadNoise, 0.7);
});

test('invalid profiles fail with a useful path', () => {
  assert.throws(() => validateProfile({ profileName: 'x' }), /hardware/);
  assert.throws(
    () => validateProfile(validProfile({ hardware: { vendorId: 1, productId: 999999 } })),
    /hardware.productId/
  );
  assert.throws(
    () => validateProfile(validProfile({
      settings: {
        ...validProfile().settings,
        steering: { deadzone: 0.5, saturation: 0.4 }
      }
    })),
    /settings.steering.saturation/
  );
  assert.throws(
    () => validateProfile(validProfile({
      settings: {
        ...validProfile().settings,
        axes: { throttle: { source: 'axis', index: -1 } }
      }
    })),
    /settings.axes.throttle.index/
  );
});

test('matching handles single, ambiguous and unauthorized devices', () => {
  const profile = validProfile();
  const first = { vendorId: 0x046d, productId: 0xc24f, productName: 'G29 A' };
  const second = { vendorId: 0x046d, productId: 0xc24f, productName: 'G29 B' };

  assert.equal(matchProfile(profile, [first]).status, 'matched');
  assert.equal(matchProfile(profile, []).status, 'authorization-required');
  const ambiguous = matchProfile(profile, [first, second]);
  assert.equal(ambiguous.status, 'ambiguous');
  assert.equal(ambiguous.candidates.length, 2);

  const signed = validProfile({
    hardware: { ...hardware, signature: 'usb-port-2' }
  });
  const signedMatch = matchProfile(signed, [
    { ...first, signature: 'usb-port-1' },
    { ...second, signature: 'usb-port-2' }
  ]);
  assert.equal(signedMatch.status, 'matched');
  assert.equal(signedMatch.device.productName, 'G29 B');
});

test('reconnect only uses getDevices and reports authorization required', async () => {
  const profile = validProfile();
  const calls = [];
  const manager = {
    async connectWheel(device) { calls.push(device); return device; }
  };
  const getDevices = async () => [];
  const result = await reconnectProfile(manager, profile, { getDevices });
  assert.equal(result.status, 'authorization-required');
  assert.equal(calls.length, 0);

  const device = { vendorId: 0x046d, productId: 0xc24f };
  const connected = await reconnectProfile(manager, profile, {
    getDevices: async () => [device]
  });
  assert.equal(connected.status, 'connected');
  assert.equal(calls[0], device);
});

test('store validation rejects duplicate names and bad active profile', () => {
  const profile = validateProfile(validProfile());
  const store = {
    kind: 'webhid-wheel-profile-store',
    schemaVersion: 1,
    activeProfile: 'Pro GT Setup',
    profiles: [profile]
  };
  assert.equal(validateStore(store).profiles.length, 1);

  assert.throws(
    () => validateStore({ ...store, profiles: [profile, profile] }),
    /duplicate profile name/
  );
  assert.throws(
    () => validateStore({ ...store, activeProfile: 'Missing' }),
    /activeProfile/
  );
});

test('SetupProfileManager exposes the compatibility ProfileManager alias', () => {
  assert.equal(ProfileManager, SetupProfileManager);
  const manager = new SetupProfileManager();
  assert.equal(manager.parse(manager.serialize(validProfile())).profileName, 'Pro GT Setup');
});
