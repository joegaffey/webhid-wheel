export function createLocalStorageStore(key, storage) {
  const target = storage || (typeof localStorage !== 'undefined' ? localStorage : null);
  return {
    load() {
      if (!target) return null;
      try { return target.getItem(key); } catch { return null; }
    },
    save(text) {
      if (!target) throw new Error('localStorage is not available');
      target.setItem(key, text);
    }
  };
}

export function legacyStorageSnapshot(prefix = 'webhid-wheel:v1') {
  if (typeof localStorage === 'undefined') return null;
  const read = (name, fallback) => {
    try {
      const text = localStorage.getItem(`${prefix}:${name}`);
      return text ? JSON.parse(text) : fallback;
    } catch {
      return fallback;
    }
  };
  const settings = read('settings', null);
  const mappings = read('mappings', null);
  const devices = read('devices', []);
  if (!settings && !mappings && !devices.length) return null;
  return { settings, mappings, devices };
}
