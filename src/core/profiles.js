export const PROFILE_KIND = 'webhid-wheel-profile';
export const PROFILE_STORE_KIND = 'webhid-wheel-profile-store';
export const PROFILE_SCHEMA_VERSION = 1;

const DEFAULT_STEERING = {
  deadzone: 0,
  saturation: 1,
  maxRotation: 900,
  invert: false
};

const DEFAULT_FFB = {
  gain: 0.5,
  invert: false
};

const LAPSTER_FEEL_KEYS = [
  'rearLightening',
  'rearSlipThreshold',
  'frontShudder',
  'frontSlipThreshold',
  'shudderHz',
  'roadNoise',
  'roughness',
  'roughnessHz',
  'looseness',
  'looseSlipThreshold'
];

function isObject(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function fail(path, message) {
  throw new Error(`${path}: ${message}`);
}

function numberValue(value, path, fallback, min, max) {
  if (value === undefined || value === null) return fallback;
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    fail(path, 'must be a finite number');
  }
  const clamped = Math.min(max, Math.max(min, value));
  return clamped;
}

function booleanValue(value, path, fallback) {
  if (value === undefined || value === null) return fallback;
  if (typeof value !== 'boolean') fail(path, 'must be a boolean');
  return value;
}

function hardwareValue(raw) {
  if (!isObject(raw)) fail('hardware', 'is required');
  const vendorId = raw.vendorId;
  const productId = raw.productId;
  if (!Number.isInteger(vendorId) || vendorId < 0 || vendorId > 0xffff) {
    fail('hardware.vendorId', 'must be an integer in 0..65535');
  }
  if (!Number.isInteger(productId) || productId < 0 || productId > 0xffff) {
    fail('hardware.productId', 'must be an integer in 0..65535');
  }
  const productName = typeof raw.productName === 'string' ? raw.productName : '';
  const signature = typeof raw.signature === 'string' && raw.signature ? raw.signature : null;
  return { vendorId, productId, productName, signature };
}

function axisEntryValue(raw, path) {
  if (!isObject(raw)) fail(path, 'must be an object');
  if (raw.source !== 'axis') fail(`${path}.source`, 'must be "axis"');
  if (!Number.isInteger(raw.index) || raw.index < 0) {
    fail(`${path}.index`, 'must be a non-negative integer');
  }
  const min = numberValue(raw.min, `${path}.min`, 0, 0, 1);
  const max = numberValue(raw.max, `${path}.max`, 1, 0, 1);
  const center = raw.center === undefined || raw.center === null
    ? null
    : numberValue(raw.center, `${path}.center`, 0.5, 0, 1);
  if (max <= min) fail(`${path}.max`, 'must be greater than min');
  if (center !== null && (center <= min || center >= max)) {
    fail(`${path}.center`, 'must be between min and max');
  }
  const deadzone = numberValue(raw.deadzone, `${path}.deadzone`, 0, 0, 0.95);
  const saturation = numberValue(raw.saturation, `${path}.saturation`, 1, 0.05, 1);
  if (saturation <= deadzone) fail(`${path}.saturation`, 'must be greater than deadzone');
  return {
    device: typeof raw.device === 'string' && raw.device ? raw.device : 'wheel',
    source: 'axis',
    index: raw.index,
    invert: booleanValue(raw.invert, `${path}.invert`, false),
    min,
    center,
    max,
    deadzone,
    saturation
  };
}

function buttonEntryValue(raw, path) {
  if (!isObject(raw)) fail(path, 'must be an object');
  if (raw.source !== 'button' && raw.source !== 'hat') {
    fail(`${path}.source`, 'must be "button" or "hat"');
  }
  if (!Number.isInteger(raw.index) || raw.index < 0) {
    fail(`${path}.index`, 'must be a non-negative integer');
  }
  const entry = {
    device: typeof raw.device === 'string' && raw.device ? raw.device : 'wheel',
    source: raw.source,
    index: raw.index
  };
  if (raw.source === 'hat') {
    if (typeof raw.direction !== 'string' || !raw.direction) {
      fail(`${path}.direction`, 'is required for hat mappings');
    }
    entry.direction = raw.direction;
  }
  return entry;
}

function mapEntries(raw, path, normalizeEntry) {
  if (raw === undefined || raw === null) return {};
  if (!isObject(raw)) fail(path, 'must be an object');
  const out = {};
  for (const [key, value] of Object.entries(raw)) {
    out[key] = normalizeEntry(value, `${path}.${key}`);
  }
  return out;
}

function steeringValue(raw) {
  const source = isObject(raw) ? raw : {};
  const deadzone = numberValue(source.deadzone, 'settings.steering.deadzone', DEFAULT_STEERING.deadzone, 0, 0.5);
  const saturation = numberValue(source.saturation, 'settings.steering.saturation', DEFAULT_STEERING.saturation, 0.05, 1);
  if (saturation <= deadzone) {
    fail('settings.steering.saturation', 'must be greater than deadzone');
  }
  return {
    deadzone,
    saturation,
    maxRotation: numberValue(source.maxRotation, 'settings.steering.maxRotation', DEFAULT_STEERING.maxRotation, 40, 1800),
    invert: booleanValue(source.invert, 'settings.steering.invert', DEFAULT_STEERING.invert)
  };
}

function ffbValue(raw) {
  const source = isObject(raw) ? raw : {};
  let gain = source.gain;
  if (gain === undefined) gain = source.ffbGain;
  if (gain !== undefined && gain > 1) gain = gain / 100;
  if (gain === undefined) gain = source.strength;
  return {
    gain: numberValue(gain, 'settings.ffb.gain', DEFAULT_FFB.gain, 0, 1),
    invert: booleanValue(source.invert !== undefined ? source.invert : source.invertForce, 'settings.ffb.invert', DEFAULT_FFB.invert)
  };
}

function metadataValue(raw, legacy) {
  const metadata = isObject(raw) ? { ...raw } : {};
  if (isObject(legacy)) {
    const lapster = {};
    for (const key of LAPSTER_FEEL_KEYS) {
      if (typeof legacy[key] === 'number' && Number.isFinite(legacy[key])) {
        lapster[key] = legacy[key];
      }
    }
    if (Object.keys(lapster).length) {
      metadata.lapster = { ...(isObject(metadata.lapster) ? metadata.lapster : {}), ...lapster };
    }
  }
  return metadata;
}

function legacySettings(value) {
  return isObject(value.settings) ? value.settings : value;
}

export function normalizeProfile(value, options = {}) {
  if (!isObject(value)) fail('profile', 'must be an object');

  const legacy = legacySettings(value);
  const settings = isObject(value.settings) ? value.settings : {};
  const hasModernSettings = value.kind === PROFILE_KIND ||
    isObject(settings.steering) || isObject(settings.ffb);
  const hardwareSource = isObject(value.hardware) ? value.hardware : options.hardware;
  const hardware = hardwareValue(hardwareSource);

  const profileName = String(value.profileName || value.name || 'Imported profile').trim();
  if (!profileName) fail('profileName', 'must not be empty');

  const steeringSource = hasModernSettings
    ? settings.steering
    : {
        deadzone: legacy.deadzone !== undefined ? legacy.deadzone : legacy.steeringDeadzone,
        saturation: legacy.saturation,
        maxRotation: legacy.maxRotation,
        invert: legacy.invertSteering !== undefined ? legacy.invertSteering : legacy.invert
      };

  const ffbSource = hasModernSettings
    ? settings.ffb
    : {
        gain: legacy.ffbGain !== undefined ? legacy.ffbGain : (legacy.strength !== undefined ? legacy.strength : legacy.ffbStrength),
        invert: legacy.invertForce !== undefined ? legacy.invertForce : legacy.invert
      };

  const axesSource = hasModernSettings
    ? settings.axes
    : (value.mappings && value.mappings.axes) || legacy.axes;
  const buttonsSource = hasModernSettings
    ? settings.buttons
    : (value.mappings && value.mappings.buttons) || legacy.buttons;

  const normalized = {
    kind: PROFILE_KIND,
    schemaVersion: PROFILE_SCHEMA_VERSION,
    profileName,
    hardware,
    settings: {
      steering: steeringValue(steeringSource),
      ffb: ffbValue(ffbSource),
      axes: mapEntries(axesSource, 'settings.axes', axisEntryValue),
      buttons: mapEntries(buttonsSource, 'settings.buttons', buttonEntryValue)
    },
    metadata: metadataValue(value.metadata, legacy)
  };

  return normalized;
}

export function validateProfile(value, options = {}) {
  return normalizeProfile(value, options);
}

export function migrateProfile(value, options = {}) {
  if (isObject(value) && value.kind === PROFILE_KIND) {
    if (value.schemaVersion !== PROFILE_SCHEMA_VERSION) {
      fail('schemaVersion', `unsupported profile version ${value.schemaVersion}`);
    }
  }
  return normalizeProfile(value, options);
}

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (!isObject(value)) return value;
  const out = {};
  for (const key of Object.keys(value).sort()) out[key] = stableValue(value[key]);
  return out;
}

export function serializeProfile(value) {
  const profile = validateProfile(value);
  return JSON.stringify(stableValue(profile), null, 2);
}

export function parseProfile(text, options = {}) {
  let value;
  try {
    value = JSON.parse(text);
  } catch (error) {
    throw new Error(`profile is not valid JSON: ${error.message}`);
  }
  return validateProfile(value, options);
}

export function profileFilters(profile) {
  const normalized = validateProfile(profile);
  return [{
    vendorId: normalized.hardware.vendorId,
    productId: normalized.hardware.productId
  }];
}

export function matchProfile(profile, devices) {
  const normalized = validateProfile(profile);
  const candidates = (Array.isArray(devices) ? devices : []).filter(device =>
    device &&
    device.vendorId === normalized.hardware.vendorId &&
    device.productId === normalized.hardware.productId
  );

  if (!candidates.length) {
    return { status: 'authorization-required', filters: profileFilters(normalized) };
  }

  if (normalized.hardware.signature) {
    const exact = candidates.find(device => device.signature === normalized.hardware.signature);
    if (exact) return { status: 'matched', device: exact };
  }

  if (candidates.length === 1) {
    return { status: 'matched', device: candidates[0] };
  }

  return { status: 'ambiguous', candidates };
}

export async function reconnectProfile(manager, profile, options = {}) {
  const normalized = validateProfile(profile);
  const getDevices = options.getDevices;
  if (typeof getDevices !== 'function') {
    throw new Error('getDevices function is required');
  }

  let devices;
  try {
    devices = await getDevices();
  } catch (error) {
    return { status: 'error', error };
  }

  const result = matchProfile(normalized, devices);
  if (result.status !== 'matched') return result;

  try {
    if (typeof manager.connectWheel === 'function') {
      await manager.connectWheel(result.device);
    } else if (typeof manager.connect === 'function') {
      await manager.connect(result.device);
    } else {
      throw new Error('manager cannot connect a wheel');
    }
    return { status: 'connected', device: result.device };
  } catch (error) {
    return { status: 'error', error };
  }
}

export function validateStore(value) {
  if (!isObject(value)) fail('store', 'must be an object');
  if (value.kind !== PROFILE_STORE_KIND) fail('store.kind', `must be "${PROFILE_STORE_KIND}"`);
  if (value.schemaVersion !== PROFILE_SCHEMA_VERSION) {
    fail('store.schemaVersion', `unsupported store version ${value.schemaVersion}`);
  }
  if (!Array.isArray(value.profiles)) fail('store.profiles', 'must be an array');

  const profiles = value.profiles.map((profile, index) =>
    validateProfile(profile)
  );
  const names = new Set();
  for (const profile of profiles) {
    if (names.has(profile.profileName)) {
      fail('store.profiles', `duplicate profile name "${profile.profileName}"`);
    }
    names.add(profile.profileName);
  }

  const activeProfile = value.activeProfile === undefined || value.activeProfile === null
    ? (profiles[0] ? profiles[0].profileName : null)
    : String(value.activeProfile);
  if (activeProfile !== null && !names.has(activeProfile)) {
    fail('store.activeProfile', 'does not reference a stored profile');
  }

  return {
    kind: PROFILE_STORE_KIND,
    schemaVersion: PROFILE_SCHEMA_VERSION,
    activeProfile,
    profiles
  };
}

export function serializeStore(value) {
  return JSON.stringify(stableValue(validateStore(value)), null, 2);
}

export function parseStore(text) {
  let value;
  try {
    value = JSON.parse(text);
  } catch (error) {
    throw new Error(`profile store is not valid JSON: ${error.message}`);
  }
  return validateStore(value);
}

export class SetupProfileManager {
  constructor(options = {}) {
    this.store = options.store || null;
  }

  validate(value, options) {
    return validateProfile(value, options);
  }

  migrate(value, options) {
    return migrateProfile(value, options);
  }

  serialize(profile) {
    return serializeProfile(profile);
  }

  parse(text, options) {
    return parseProfile(text, options);
  }

  match(profile, devices) {
    return matchProfile(profile, devices);
  }

  reconnect(manager, profile, options) {
    return reconnectProfile(manager, profile, options);
  }

  validateStore(value) {
    return validateStore(value);
  }

  serializeStore(value) {
    return serializeStore(value);
  }

  parseStore(text) {
    return parseStore(text);
  }

  toProfile(manager, options = {}) {
    if (manager && typeof manager.toSetup === 'function') {
      return validateProfile(manager.toSetup(options));
    }
    throw new Error('manager does not expose toSetup()');
  }

  loadStore() {
    if (!this.store || typeof this.store.load !== 'function') return null;
    const text = this.store.load();
    return text ? parseStore(text) : null;
  }

  saveStore(value) {
    if (!this.store || typeof this.store.save !== 'function') {
      throw new Error('store does not support save()');
    }
    const text = serializeStore(value);
    this.store.save(text);
    return text;
  }
}

export const ProfileManager = SetupProfileManager;
