export const PROFILE_KIND = 'webhid-wheel-profile';
export const PROFILE_STORE_KIND = 'webhid-wheel-profile-store';
export const PROFILE_SCHEMA_VERSION = 2;

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
  return Math.min(max, Math.max(min, value));
}

function booleanValue(value, path, fallback) {
  if (value === undefined || value === null) return fallback;
  if (typeof value !== 'boolean') fail(path, 'must be a boolean');
  return value;
}

function hardwareValue(raw, path = 'hardware') {
  if (!isObject(raw)) fail(path, 'is required');
  const vendorId = raw.vendorId;
  const productId = raw.productId;
  if (!Number.isInteger(vendorId) || vendorId < 0 || vendorId > 0xffff) {
    fail(`${path}.vendorId`, 'must be an integer in 0..65535');
  }
  if (!Number.isInteger(productId) || productId < 0 || productId > 0xffff) {
    fail(`${path}.productId`, 'must be an integer in 0..65535');
  }
  const productName = typeof raw.productName === 'string' ? raw.productName : '';
  const signature = typeof raw.signature === 'string' && raw.signature ? raw.signature : null;
  return { vendorId, productId, productName, signature };
}

function deviceValue(raw, path) {
  if (!isObject(raw)) fail(path, 'must be an object');
  const alias = typeof raw.alias === 'string' && raw.alias ? raw.alias : null;
  if (!alias) fail(`${path}.alias`, 'must be a non-empty string');
  const driver = raw.driver === 'generic' ? 'generic' : 'wheel';
  return {
    alias,
    driver,
    hardware: hardwareValue(raw.hardware, `${path}.hardware`)
  };
}

function aliasReference(value, path, aliases, fallback) {
  const alias = value === undefined || value === null || value === '' ? fallback : value;
  if (typeof alias !== 'string' || !aliases.has(alias)) {
    fail(path, `must reference one of: ${Array.from(aliases).join(', ')}`);
  }
  return alias;
}

function axisEntryValue(raw, path, aliases, fallbackAlias) {
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
    device: aliasReference(raw.device, `${path}.device`, aliases, fallbackAlias),
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

function buttonEntryValue(raw, path, aliases, fallbackAlias) {
  if (!isObject(raw)) fail(path, 'must be an object');
  if (raw.source !== 'button' && raw.source !== 'hat') {
    fail(`${path}.source`, 'must be "button" or "hat"');
  }
  if (!Number.isInteger(raw.index) || raw.index < 0) {
    fail(`${path}.index`, 'must be a non-negative integer');
  }
  const entry = {
    device: aliasReference(raw.device, `${path}.device`, aliases, fallbackAlias),
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

function mapEntries(raw, path, aliases, fallbackAlias, normalizeEntry) {
  if (raw === undefined || raw === null) return {};
  if (!isObject(raw)) fail(path, 'must be an object');
  const out = {};
  for (const [key, value] of Object.entries(raw)) {
    out[key] = normalizeEntry(value, `${path}.${key}`, aliases, fallbackAlias);
  }
  return out;
}

function steeringValue(raw, aliases, fallbackAlias) {
  const source = isObject(raw) ? raw : {};
  return {
    device: aliasReference(source.device, 'settings.steering.device', aliases, fallbackAlias),
    deadzone: numberValue(source.deadzone, 'settings.steering.deadzone', DEFAULT_STEERING.deadzone, 0, 0.5),
    saturation: numberValue(source.saturation, 'settings.steering.saturation', DEFAULT_STEERING.saturation, 0.05, 1),
    maxRotation: numberValue(source.maxRotation, 'settings.steering.maxRotation', DEFAULT_STEERING.maxRotation, 40, 1800),
    invert: booleanValue(source.invert, 'settings.steering.invert', DEFAULT_STEERING.invert)
  };
}

function ffbValue(raw, aliases, fallbackAlias) {
  const source = isObject(raw) ? raw : {};
  return {
    device: aliasReference(source.device, 'settings.ffb.device', aliases, fallbackAlias),
    gain: numberValue(source.gain, 'settings.ffb.gain', DEFAULT_FFB.gain, 0, 1),
    invert: booleanValue(source.invert, 'settings.ffb.invert', DEFAULT_FFB.invert)
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

function profileName(value) {
  const name = String(value.profileName || value.name || 'Imported profile').trim();
  if (!name) fail('profileName', 'must not be empty');
  return name;
}

function normalizeDevices(rawDevices) {
  if (!Array.isArray(rawDevices) || !rawDevices.length) {
    fail('devices', 'must be a non-empty array');
  }
  const devices = rawDevices.map((raw, index) => {
    if (!isObject(raw)) fail(`devices[${index}]`, 'must be an object');
    return deviceValue({
      ...raw,
      alias: raw.alias || `d${index + 1}`
    }, `devices[${index}]`);
  });
  const aliases = new Set();
  for (const device of devices) {
    if (aliases.has(device.alias)) fail('devices', `duplicate alias "${device.alias}"`);
    aliases.add(device.alias);
  }
  return { devices, aliases };
}

function normalizeModern(value, options = {}) {
  const { devices, aliases } = normalizeDevices(value.devices);
  const fallbackAlias = devices[0].alias;
  const settings = isObject(value.settings) ? value.settings : {};
  const profile = {
    kind: PROFILE_KIND,
    schemaVersion: PROFILE_SCHEMA_VERSION,
    profileName: profileName(value),
    devices,
    settings: {
      steering: steeringValue(settings.steering, aliases, fallbackAlias),
      ffb: ffbValue(settings.ffb, aliases, fallbackAlias),
      axes: mapEntries(settings.axes, 'settings.axes', aliases, fallbackAlias, axisEntryValue),
      buttons: mapEntries(settings.buttons, 'settings.buttons', aliases, fallbackAlias, buttonEntryValue)
    },
    metadata: metadataValue(value.metadata, value)
  };
  return profile;
}

function legacySettings(value) {
  return isObject(value.settings) ? value.settings : value;
}

function normalizeLegacy(value, options = {}) {
  const legacy = legacySettings(value);
  const settings = isObject(value.settings) ? value.settings : {};
  const hardwareSource = isObject(value.hardware) ? value.hardware : options.hardware;
  const alias = 'd1';
  const aliases = new Set([alias]);
  const devices = [{
    alias,
    driver: 'wheel',
    hardware: hardwareValue(hardwareSource)
  }];

  const oldMappings = isObject(value.mappings) ? value.mappings : {};
  const axesSource = (isObject(settings.axes) ? settings.axes : oldMappings.axes) || legacy.axes || {};
  const buttonsSource = (isObject(settings.buttons) ? settings.buttons : oldMappings.buttons) || legacy.buttons || {};
  const unbound = [];

  const bindLegacyEntries = (entries, path, normalize) => {
    const out = {};
    for (const [key, entry] of Object.entries(entries || {})) {
      if (!isObject(entry)) continue;
      const device = entry.device;
      if (device && device !== 'wheel' && !aliases.has(device)) {
        unbound.push({ channel: key, path, device });
        continue;
      }
      out[key] = normalize({ ...entry, device: alias }, `${path}.${key}`, aliases, alias);
    }
    return out;
  };

  const axes = bindLegacyEntries(axesSource, 'settings.axes', axisEntryValue);
  const buttons = bindLegacyEntries(buttonsSource, 'settings.buttons', buttonEntryValue);
  const metadata = metadataValue(value.metadata, legacy);
  if (unbound.length) metadata.legacyUnboundMappings = unbound;

  const v1Steering = isObject(settings.steering) ? settings.steering : {};
  const v1Ffb = isObject(settings.ffb) ? settings.ffb : {};
  return {
    kind: PROFILE_KIND,
    schemaVersion: PROFILE_SCHEMA_VERSION,
    profileName: profileName(value),
    devices,
    settings: {
      steering: steeringValue({
        deadzone: v1Steering.deadzone !== undefined ? v1Steering.deadzone : (legacy.deadzone !== undefined ? legacy.deadzone : legacy.steeringDeadzone),
        saturation: v1Steering.saturation !== undefined ? v1Steering.saturation : legacy.saturation,
        maxRotation: v1Steering.maxRotation !== undefined ? v1Steering.maxRotation : legacy.maxRotation,
        invert: v1Steering.invert !== undefined ? v1Steering.invert : (legacy.invertSteering !== undefined ? legacy.invertSteering : legacy.invert),
        device: alias
      }, aliases, alias),
      ffb: ffbValue({
        gain: v1Ffb.gain !== undefined ? v1Ffb.gain : (legacy.ffbGain !== undefined ? legacy.ffbGain : (legacy.strength !== undefined ? legacy.strength : legacy.ffbStrength)),
        invert: v1Ffb.invert !== undefined ? v1Ffb.invert : (legacy.invertForce !== undefined ? legacy.invertForce : legacy.invert),
        device: alias
      }, aliases, alias),
      axes,
      buttons
    },
    metadata
  };
}

export function normalizeProfile(value, options = {}) {
  if (!isObject(value)) fail('profile', 'must be an object');
  if (Array.isArray(value.devices)) return normalizeModern(value, options);
  return normalizeLegacy(value, options);
}

export function validateProfile(value, options = {}) {
  return normalizeProfile(value, options);
}

export function migrateProfile(value, options = {}) {
  if (isObject(value) && value.kind === PROFILE_KIND &&
      value.schemaVersion !== undefined && value.schemaVersion > PROFILE_SCHEMA_VERSION) {
    fail('schemaVersion', `unsupported profile version ${value.schemaVersion}`);
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
  return normalized.devices.map(device => ({
    vendorId: device.hardware.vendorId,
    productId: device.hardware.productId
  }));
}

function candidatesFor(device, devices) {
  const hardware = device.hardware;
  const candidates = (Array.isArray(devices) ? devices : []).filter(item =>
    item &&
    item.vendorId === hardware.vendorId &&
    item.productId === hardware.productId
  );
  if (hardware.signature) {
    return candidates.filter(item => item.signature === hardware.signature);
  }
  return candidates;
}

export function matchProfile(profile, devices) {
  const normalized = validateProfile(profile);
  const matches = {};
  const missing = [];
  const ambiguous = [];

  for (const device of normalized.devices) {
    const candidates = candidatesFor(device, devices);
    if (candidates.length === 0) {
      missing.push({ alias: device.alias, hardware: device.hardware });
    } else if (candidates.length === 1) {
      matches[device.alias] = candidates[0];
    } else {
      ambiguous.push({ alias: device.alias, candidates });
    }
  }

  let status = 'matched';
  if (ambiguous.length) status = 'ambiguous';
  else if (missing.length) status = Object.keys(matches).length ? 'partial' : 'authorization-required';

  return {
    status,
    matches,
    missing,
    ambiguous,
    filters: missing.map(item => ({
      vendorId: item.hardware.vendorId,
      productId: item.hardware.productId
    }))
  };
}

export async function reconnectProfile(manager, profile, options = {}) {
  const normalized = validateProfile(profile);
  const getDevices = options.getDevices;
  if (typeof getDevices !== 'function') throw new Error('getDevices function is required');

  let devices;
  try {
    devices = await getDevices();
  } catch (error) {
    return { status: 'error', error };
  }

  const result = matchProfile(normalized, devices);
  if (result.status === 'ambiguous') return result;

  try {
    for (const [alias, device] of Object.entries(result.matches)) {
      const profileDevice = normalized.devices.find(item => item.alias === alias);
      if (typeof manager.connect === 'function') {
        await manager.connect(device, profileDevice ? { driver: profileDevice.driver } : {});
      } else if (typeof manager.connectWheel === 'function') {
        await manager.connectWheel(device);
      }
    }
    if (typeof manager.applySetup === 'function') manager.applySetup(normalized);
    return { ...result, status: result.status === 'partial' ? 'partial' : 'connected' };
  } catch (error) {
    return { ...result, status: 'error', error };
  }
}

export function validateStore(value) {
  if (!isObject(value)) fail('store', 'must be an object');
  if (value.kind !== PROFILE_STORE_KIND) fail('store.kind', `must be "${PROFILE_STORE_KIND}"`);
  if (value.schemaVersion !== 1 && value.schemaVersion !== PROFILE_SCHEMA_VERSION) {
    fail('store.schemaVersion', `unsupported store version ${value.schemaVersion}`);
  }
  if (!Array.isArray(value.profiles)) fail('store.profiles', 'must be an array');

  const profiles = value.profiles.map(profile => validateProfile(profile));
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

  validate(value, options) { return validateProfile(value, options); }
  migrate(value, options) { return migrateProfile(value, options); }
  serialize(profile) { return serializeProfile(profile); }
  parse(text, options) { return parseProfile(text, options); }
  match(profile, devices) { return matchProfile(profile, devices); }
  reconnect(manager, profile, options) { return reconnectProfile(manager, profile, options); }
  validateStore(value) { return validateStore(value); }
  serializeStore(value) { return serializeStore(value); }
  parseStore(text) { return parseStore(text); }

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
