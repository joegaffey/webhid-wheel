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

const pedalHardware = {
  vendorId: 0x046d,
  productId: 0xc24a,
  productName: 'Logitech Pedals'
};

function validProfile(overrides = {}) {
  return {
    kind: PROFILE_KIND,
    schemaVersion: PROFILE_SCHEMA_VERSION,
    profileName: 'Pro GT Setup',
    devices: [
      { alias: 'd1', driver: 'wheel', hardware },
      { alias: 'd2', driver: 'generic', hardware: pedalHardware }
    ],
    settings: {
      steering: { device: 'd1', deadzone: 0.05, saturation: 1, maxRotation: 900, invert: false },
      ffb: { device: 'd1', gain: 0.8, invert: false },
      axes: {
        throttle: { device: 'd2', source: 'axis', index: 0 },
        brake: { device: 'd2', source: 'axis', index: 1, invert: true, deadzone: 0.1 }
      },
      buttons: {
        shiftUp: { device: 'd1', source: 'button', index: 4 },
        gear1: { device: 'd1', source: 'hat', index: 0, direction: 'up' }
      }
    },
    metadata: { lapster: { rearLightening: 0.4 } },
    ...overrides
  };
}

test('v2 profile validation fills defaults and round-trips stably', () => {
  const profile = validateProfile(validProfile());
  assert.equal(profile.schemaVersion, 2);
  assert.equal(profile.devices.length, 2);
  assert.equal(profile.settings.axes.throttle.min, 0);
  assert.equal(profile.settings.axes.brake.invert, true);

  const text = serializeProfile(profile);
  const parsed = parseProfile(text);
  assert.deepEqual(parsed, profile);
  assert.equal(serializeProfile(parsed), text);
});

test('v1 profiles migrate to multi-device v2', () => {
  const legacy = {
    kind: PROFILE_KIND,
    schemaVersion: 1,
    profileName: 'Legacy GT',
    hardware,
    settings: {
      steering: { deadzone: 0.1, saturation: 1, maxRotation: 900, invert: false },
      ffb: { gain: 0.8, invert: false },
      axes: {
        throttle: { device: 'wheel', source: 'axis', index: 0 },
        brake: { device: 'pedals', source: 'axis', index: 1 }
      },
      buttons: {}
    }
  };
  const profile = validateProfile(legacy);
  assert.equal(profile.schemaVersion, 2);
  assert.equal(profile.devices.length, 1);
  assert.equal(profile.devices[0].alias, 'd1');
  assert.equal(profile.settings.steering.deadzone, 0.1);
  assert.equal(profile.settings.ffb.gain, 0.8);
  assert.equal(profile.settings.axes.throttle.device, 'd1');
  assert.equal(profile.settings.axes.brake, undefined);
  assert.deepEqual(profile.metadata.legacyUnboundMappings, [
    { channel: 'brake', path: 'settings.axes', device: 'pedals' }
  ]);
});

test('flat demo settings migrate into a v2 wheel profile', () => {
  const legacy = {
    strength: 0.6,
    invertForce: true,
    invertSteering: true,
    deadzone: 0.02,
    rearLightening: 0.3,
    roadNoise: 0.7
  };
  const profile = validateProfile(legacy, { hardware });
  assert.equal(profile.schemaVersion, 2);
  assert.equal(profile.devices[0].hardware.vendorId, hardware.vendorId);
  assert.equal(profile.settings.ffb.gain, 0.6);
  assert.equal(profile.settings.ffb.invert, true);
  assert.equal(profile.settings.steering.invert, true);
  assert.equal(profile.metadata.lapster.rearLightening, 0.3);
  assert.equal(profile.metadata.lapster.roadNoise, 0.7);
});

test('invalid profiles fail with a useful path', () => {
  assert.throws(() => validateProfile({ profileName: 'x' }), /hardware|devices/);
  assert.throws(
    () => validateProfile(validProfile({
      devices: [{ alias: 'd1', driver: 'wheel', hardware: { vendorId: 1, productId: 999999 } }]
    })),
    /devices\[0\]\.hardware\.productId/
  );
  assert.throws(
    () => validateProfile(validProfile({
      settings: {
        ...validProfile().settings,
        steering: { device: 'missing', deadzone: 0, saturation: 1, maxRotation: 900, invert: false }
      }
    })),
    /settings.steering.device/
  );
  assert.throws(
    () => validateProfile(validProfile({
      settings: {
        ...validProfile().settings,
        axes: { throttle: { device: 'd1', source: 'axis', index: -1 } }
      }
    })),
    /settings.axes.throttle.index/
  );
});

test('matching handles full, partial, ambiguous and missing devices', () => {
  const profile = validProfile();
  const wheel = { vendorId: hardware.vendorId, productId: hardware.productId, productName: 'G29 A' };
  const pedals = { vendorId: pedalHardware.vendorId, productId: pedalHardware.productId, productName: 'Pedals A' };

  const full = matchProfile(profile, [wheel, pedals]);
  assert.equal(full.status, 'matched');
  assert.equal(full.matches.d1, wheel);
  assert.equal(full.matches.d2, pedals);

  const partial = matchProfile(profile, [wheel]);
  assert.equal(partial.status, 'partial');
  assert.equal(partial.missing.length, 1);
  assert.equal(partial.missing[0].alias, 'd2');

  const none = matchProfile(profile, []);
  assert.equal(none.status, 'authorization-required');
  assert.equal(none.missing.length, 2);

  const ambiguous = matchProfile(profile, [
    wheel,
    { ...wheel, productName: 'G29 B' },
    pedals
  ]);
  assert.equal(ambiguous.status, 'ambiguous');
  assert.equal(ambiguous.ambiguous[0].candidates.length, 2);
});

test('reconnect connects matched devices and applies the profile', async () => {
  const profile = validProfile();
  const wheel = { vendorId: hardware.vendorId, productId: hardware.productId };
  const pedals = { vendorId: pedalHardware.vendorId, productId: pedalHardware.productId };
  const calls = [];
  const manager = {
    async connect(device) { calls.push(device); return device; },
    applySetup(value) { calls.push(value); }
  };
  const result = await reconnectProfile(manager, profile, { getDevices: async () => [wheel, pedals] });
  assert.equal(result.status, 'connected');
  assert.equal(calls.length, 3);
  assert.equal(calls[0], wheel);
  assert.equal(calls[1], pedals);
  assert.equal(calls[2].profileName, 'Pro GT Setup');
});

test('store validation migrates a v1 store and rejects bad active profile', () => {
  const profile = validateProfile(validProfile());
  const store = {
    kind: 'webhid-wheel-profile-store',
    schemaVersion: 1,
    activeProfile: 'Pro GT Setup',
    profiles: [profile]
  };
  const migrated = validateStore(store);
  assert.equal(migrated.schemaVersion, 2);
  assert.equal(migrated.profiles.length, 1);

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
