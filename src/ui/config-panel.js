import { WebHIDElement } from './base.js';
import { createLocalStorageStore, legacyStorageSnapshot } from './storage.js';
import {
  SetupProfileManager,
  WheelManager,
  parseProfile,
  serializeProfile,
  validateProfile
} from '../core/index.js';

const DEFAULT_STORAGE_KEY = 'webhid-wheel:v2:profiles';

export class WebHIDConfigPanel extends WebHIDElement {
  constructor() {
    super();
    this._storageKey = null;
    this._store = null;
    this._pendingProfile = null;
    this._boundManager = null;
    this._saveTimer = null;
    this._managerHandler = () => this.refresh();
    this._connectHandler = () => this._onConnect();
  }

  connectedCallback() {
    super.connectedCallback();
    this._ensureManager();
    this._ensureProfiles();
    this._syncChildren();
    this._bindManager();
    this._loadStore();
    this.refresh();
  }

  disconnectedCallback() {
    this._unbindManager();
    if (this._saveTimer) clearTimeout(this._saveTimer);
  }

  set storageKey(value) {
    this._storageKey = value || null;
    if (this.isConnected) {
      this._profiles = null;
      this._ensureProfiles();
      this._syncChildren();
      this._loadStore();
      this.refresh();
    }
  }

  get storageKey() {
    return this._storageKey || this.getAttribute('storage-key') || DEFAULT_STORAGE_KEY;
  }

  set manager(value) {
    if (this._manager === (value || null)) return;
    this._unbindManager();
    this._manager = value || null;
    if (this.isConnected) {
      this._syncChildren();
      this._bindManager();
      this._loadStore();
      this.refresh();
    }
  }

  get manager() {
    return this._manager;
  }

  set profiles(value) {
    if (this._profiles === (value || null)) return;
    this._profiles = value || null;
    if (this.isConnected) {
      this._syncChildren();
      this._loadStore();
      this.refresh();
    }
  }

  get profiles() {
    return this._profiles;
  }

  _ensureManager() {
    if (!this._manager) this._manager = new WheelManager();
  }

  _ensureProfiles() {
    if (!this._profiles) {
      this._profiles = new SetupProfileManager({
        store: createLocalStorageStore(this.storageKey)
      });
    }
  }

  _syncChildren() {
    if (!this.shadowRoot) return;
    for (const selector of ['webhid-device-picker', 'webhid-steering-config', 'webhid-axis-mapper', 'webhid-button-mapper']) {
      const child = this.shadowRoot.querySelector(selector);
      if (!child) continue;
      child.manager = this._manager;
      child.profiles = this._profiles;
    }
  }

  _bindManager() {
    if (!this._manager || this._boundManager === this._manager) return;
    this._unbindManager();
    if (typeof this._manager.on !== 'function') return;
    this._manager.on('connect', this._connectHandler);
    this._manager.on('disconnect', this._managerHandler);
    this._manager.on('error', this._managerHandler);
    this._manager.on('setup-applied', this._managerHandler);
    this._boundManager = this._manager;
  }

  _unbindManager() {
    if (!this._boundManager) return;
    if (typeof this._boundManager.off === 'function') {
      this._boundManager.off('connect', this._connectHandler);
      this._boundManager.off('disconnect', this._managerHandler);
      this._boundManager.off('error', this._managerHandler);
      this._boundManager.off('setup-applied', this._managerHandler);
    }
    this._boundManager = null;
  }

  css() {
    return `
      .panel { display: grid; gap: 8px; }
      .head { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
      .profiles { display: grid; gap: 6px; padding-top: 8px; border-top: 1px solid var(--wheel-border-color, #2a303a); }
      .profiles .actions { align-items: center; }
      .profiles input[type="text"] { flex: 1 1 140px; min-width: 100px; }
      .profiles select { flex: 1 1 120px; min-width: 90px; }
      .empty { color: var(--wheel-muted-color, #8f9bab); }
      .hidden { display: none; }
    `;
  }

  template() {
    return `
      <div class="panel">
        <div class="head">
          <slot name="header"><h3>Wheel configuration</h3></slot>
          <span class="badge" data-role="mode"></span>
        </div>
        <div class="status" data-role="status" aria-live="polite"></div>
        <webhid-device-picker></webhid-device-picker>
        <webhid-steering-config></webhid-steering-config>
        <webhid-axis-mapper></webhid-axis-mapper>
        <webhid-button-mapper></webhid-button-mapper>
        <slot name="extra-settings"></slot>
        <div class="profiles">
          <h3>Setup profile</h3>
          <div class="actions">
            <input data-role="name" type="text" placeholder="Profile name" aria-label="Profile name">
            <select data-role="profile-select" aria-label="Stored setup profiles"></select>
            <button type="button" data-action="save">Save</button>
            <button type="button" data-action="export">Export</button>
            <button type="button" data-action="import">Import</button>
            <input data-role="file" type="file" accept="application/json,.json" hidden>
          </div>
        </div>
        <slot name="footer"></slot>
      </div>
    `;
  }

  bind() {
    const root = this.shadowRoot;
    root.querySelector('[data-action="save"]').addEventListener('click', () => this._save());
    root.querySelector('[data-action="export"]').addEventListener('click', () => this._export());
    root.querySelector('[data-action="import"]').addEventListener('click', () => root.querySelector('[data-role="file"]').click());
    root.querySelector('[data-role="file"]').addEventListener('change', (event) => this._import(event));
    root.querySelector('[data-role="profile-select"]').addEventListener('change', (event) => this._selectProfile(event.target.value));
    root.querySelector('[data-role="name"]').addEventListener('change', () => this._scheduleSave());
    root.addEventListener('webhid-error', (event) => {
      this._status(String(event.detail && event.detail.error ? event.detail.error.message || event.detail.error : 'Unknown error'), 'error');
    });
    root.addEventListener('webhid-change', () => this._scheduleSave());
    root.addEventListener('webhid-connect', () => this._onConnect());
  }

  _onConnect() {
    if (this._pendingProfile && this._matches(this._pendingProfile)) {
      this._apply(this._pendingProfile);
      this._pendingProfile = null;
    } else if (!this._store) {
      this._migrateLegacy();
    }
    if (!this._store && this._manager && this._manager.wheel) {
      this._store = {
        kind: 'webhid-wheel-profile-store',
        schemaVersion: 1,
        activeProfile: null,
        profiles: []
      };
    }
    this.refresh();
  }

  _matches(profile) {
    const device = this._manager && this._manager.wheel && this._manager.wheel.device;
    return !!(device &&
      device.vendorId === profile.hardware.vendorId &&
      device.productId === profile.hardware.productId &&
      (!profile.hardware.signature ||
        device.signature === profile.hardware.signature ||
        (this._manager.wheel && this._manager.wheel.signature === profile.hardware.signature)));
  }

  _apply(profile) {
    if (!this._manager) return false;
    if (!this._matches(profile)) {
      this._pendingProfile = profile;
      this._status(`Profile "${profile.profileName}" needs its matching device.`, '');
      return false;
    }
    this._manager.applySetup(profile);
    const name = this.shadowRoot.querySelector('[data-role="name"]');
    if (name) name.value = profile.profileName;
    this._status(`Applied "${profile.profileName}".`, 'ready');
    this._refreshChildren();
    return true;
  }

  _loadStore() {
    if (!this._profiles) return;
    try {
      this._store = this._profiles.loadStore();
    } catch (error) {
      this._store = null;
      this._status(`Stored profiles could not be loaded: ${error.message}`, 'error');
    }
    if (this._store && this._store.activeProfile) {
      const active = this._store.profiles.find(profile => profile.profileName === this._store.activeProfile);
      if (active) {
        this._pendingProfile = active;
        this._apply(active);
      }
    }
    this._refreshProfileSelect();
  }

  _migrateLegacy() {
    if (this._store) return;
    const snapshot = legacyStorageSnapshot();
    if (!snapshot || !this._manager || !this._manager.wheel || !this._manager.wheel.device) return;
    const device = this._manager.wheel.device;
    try {
      const profile = validateProfile({
        ...(snapshot.settings || {}),
        mappings: snapshot.mappings || {},
        name: `${device.productName || 'Wheel'} setup`
      }, {
        hardware: {
          vendorId: device.vendorId,
          productId: device.productId,
          productName: device.productName || '',
          signature: device.signature || null
        }
      });
      this._manager.applySetup(profile);
      this._store = {
        kind: 'webhid-wheel-profile-store',
        schemaVersion: 1,
        activeProfile: profile.profileName,
        profiles: [profile]
      };
      this._profiles.saveStore(this._store);
      this._status(`Migrated saved wheel settings to "${profile.profileName}".`, 'ready');
      this._refreshProfileSelect();
      this._refreshChildren();
    } catch (error) {
      this._status(`Could not migrate saved settings: ${error.message}`, 'error');
    }
  }

  _currentProfile() {
    if (!this._manager || !this._manager.wheel || !this._manager.wheel.device) {
      this._status('Connect a wheel before saving or exporting a profile.', 'error');
      return null;
    }
    const nameInput = this.shadowRoot.querySelector('[data-role="name"]');
    const existing = this._store && this._store.activeProfile
      ? this._store.profiles.find(profile => profile.profileName === this._store.activeProfile)
      : null;
    try {
      return validateProfile(this._manager.toSetup({
        profileName: (nameInput && nameInput.value.trim()) || (existing && existing.profileName) || `${this._manager.wheel.name || 'Wheel'} setup`,
        metadata: existing ? existing.metadata : {}
      }));
    } catch (error) {
      this._status(error.message, 'error');
      return null;
    }
  }

  _save() {
    const profile = this._currentProfile();
    if (!profile) return;
    const profiles = this._store ? this._store.profiles.slice() : [];
    const index = profiles.findIndex(item => item.profileName === profile.profileName);
    if (index >= 0) profiles[index] = profile;
    else profiles.push(profile);
    this._store = {
      kind: 'webhid-wheel-profile-store',
      schemaVersion: 1,
      activeProfile: profile.profileName,
      profiles
    };
    try {
      this._profiles.saveStore(this._store);
      this._status(`Saved "${profile.profileName}".`, 'ready');
      this._refreshProfileSelect();
    } catch (error) {
      this._status(`Could not save profile: ${error.message}`, 'error');
    }
  }

  _scheduleSave() {
    if (this._saveTimer) clearTimeout(this._saveTimer);
    this._saveTimer = setTimeout(() => {
      this._saveTimer = null;
      if (this._store && this._manager && this._manager.isConnected) this._save();
    }, 500);
  }

  _selectProfile(name) {
    if (!this._store) return;
    const profile = this._store.profiles.find(item => item.profileName === name);
    if (!profile) return;
    this._store.activeProfile = name;
    try { this._profiles.saveStore(this._store); } catch { /* storage may be unavailable */ }
    this._pendingProfile = profile;
    this._apply(profile);
    this._refreshProfileSelect();
  }

  _export() {
    const profile = this._currentProfile();
    if (!profile) return;
    const blob = new Blob([serializeProfile(profile)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `${profile.profileName.replace(/[^\w.-]+/g, '-')}.json`;
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  async _import(event) {
    const file = event.target.files && event.target.files[0];
    event.target.value = '';
    if (!file) return;
    try {
      const profile = parseProfile(await file.text());
      this._pendingProfile = profile;
      if (!this._apply(profile)) {
        this._status(`Imported "${profile.profileName}". Connect its matching device to apply it.`, '');
      }
      const profiles = this._store ? this._store.profiles.slice() : [];
      const index = profiles.findIndex(item => item.profileName === profile.profileName);
      if (index >= 0) profiles[index] = profile;
      else profiles.push(profile);
      this._store = {
        kind: 'webhid-wheel-profile-store',
        schemaVersion: 1,
        activeProfile: profile.profileName,
        profiles
      };
      this._profiles.saveStore(this._store);
      this._refreshProfileSelect();
      this.emit('webhid-profile-change', { profile, action: 'import' });
    } catch (error) {
      this._status(`Could not import profile: ${error.message}`, 'error');
    }
  }

  _refreshProfileSelect() {
    const select = this.shadowRoot.querySelector('[data-role="profile-select"]');
    if (!select) return;
    const profiles = this._store ? this._store.profiles : [];
    select.innerHTML = profiles.length
      ? profiles.map(profile => `<option value="${escapeAttribute(profile.profileName)}"${this._store.activeProfile === profile.profileName ? ' selected' : ''}>${escapeHtml(profile.profileName)}</option>`).join('')
      : '<option value="">No stored profiles</option>';
    select.disabled = !profiles.length;
    const name = this.shadowRoot.querySelector('[data-role="name"]');
    if (name && !name.value && this._store && this._store.activeProfile) {
      name.value = this._store.activeProfile;
    }
  }

  _refreshChildren() {
    if (!this.shadowRoot) return;
    for (const selector of ['webhid-device-picker', 'webhid-steering-config', 'webhid-axis-mapper', 'webhid-button-mapper']) {
      const child = this.shadowRoot.querySelector(selector);
      if (child && typeof child.refresh === 'function') child.refresh();
    }
  }

  _status(text, tone = '') {
    const status = this.shadowRoot && this.shadowRoot.querySelector('[data-role="status"]');
    if (!status) return;
    status.textContent = text;
    status.className = `status ${tone}`.trim();
  }

  refresh() {
    if (!this.shadowRoot || !this.shadowRoot.querySelector('[data-role="status"]')) return;
    this._ensureManager();
    this._ensureProfiles();
    this._syncChildren();
    this._bindManager();
    this._refreshProfileSelect();
    const mode = this.shadowRoot.querySelector('[data-role="mode"]');
    if (mode) mode.textContent = 'WebHID';
    if (this._manager && this._manager.isConnected) {
      const wheel = this._manager.wheel;
      this._status(`${wheel && wheel.name ? wheel.name : 'Wheel connected'}. Settings save to this browser.`, 'ready');
    } else if (this._pendingProfile) {
      this._status(`Profile "${this._pendingProfile.profileName}" loaded. Connect its matching device.`, '');
    }
  }
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, ch => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[ch]));
}

function escapeAttribute(value) {
  return escapeHtml(value);
}
