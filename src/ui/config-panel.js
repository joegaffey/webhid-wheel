import { WebHIDElement } from './base.js';
import { createLocalStorageStore, legacyStorageSnapshot } from './storage.js';
import {
  SetupProfileManager,
  WheelManager,
  deviceSignature,
  parseProfile,
  parseStore,
  serializeProfile,
  validateProfile
} from '../core/index.js';

const DEFAULT_STORAGE_KEY = 'webhid-wheel:v3:profiles';
const LEGACY_STORE_KEY = 'webhid-wheel:v2:profiles';

export class WebHIDConfigPanel extends WebHIDElement {
  constructor() {
    super();
    this._storageKey = null;
    this._store = null;
    this._pendingProfile = null;
    this._removedAliases = new Set();
    this._boundManager = null;
    this._managerHandler = () => this.refresh();
    this._connectHandler = () => this._onConnect();
    this._activeTab = 'wheel';
  }

  static get observedAttributes() {
    return ['tabbed', 'diagnostics'];
  }

  attributeChangedCallback(name, oldValue, newValue) {
    if (name === 'tabbed' && oldValue !== newValue && this.isConnected) {
      this.render();
    } else if (name === 'diagnostics' && oldValue !== newValue && this.isConnected) {
      this._syncChildren();
    }
  }

  get tabbed() {
    return this.hasAttribute('tabbed');
  }

  set tabbed(value) {
    if (value) this.setAttribute('tabbed', '');
    else this.removeAttribute('tabbed');
  }

  get diagnostics() {
    return this.hasAttribute('diagnostics');
  }

  set diagnostics(value) {
    if (value) this.setAttribute('diagnostics', '');
    else this.removeAttribute('diagnostics');
  }

  get activeTab() {
    return this._activeTab;
  }

  set activeTab(value) {
    this._selectTab(value);
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
    const picker = this.shadowRoot.querySelector('webhid-device-picker');
    if (picker) picker.diagnostics = this.diagnostics;
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
      .profiles { display: grid; gap: 6px; padding-bottom: 8px; border-bottom: 1px solid var(--wheel-border-color, #2a303a); }
      .profiles .actions { align-items: center; }
      .profiles input[type="text"] { flex: 1 1 140px; min-width: 100px; }
      .profiles select { flex: 1 1 120px; min-width: 90px; }
      .tabs { display: flex; gap: 2px; border-bottom: 1px solid var(--wheel-border-color, #2a303a); margin: 2px 0 4px; }
      .tab {
        appearance: none;
        background: transparent;
        border: 0;
        border-bottom: 2px solid transparent;
        border-radius: 0;
        color: var(--wheel-muted-color, #8f9bab);
        cursor: pointer;
        font: inherit;
        padding: 6px 10px;
      }
      .tab:hover { color: var(--wheel-fg-color, #e6e8eb); }
      .tab[aria-selected="true"] { color: var(--wheel-accent, #38bdf8); border-bottom-color: var(--wheel-accent, #38bdf8); }
      .tab:focus-visible { outline: 1px solid var(--wheel-accent, #38bdf8); outline-offset: -1px; }
      .tab-panel[hidden] { display: none; }
    `;
  }

  template() {
    const device = `
      <webhid-device-picker>
        <slot name="device-extra" slot="extra"></slot>
        <slot name="diagnostics" slot="diagnostics"></slot>
      </webhid-device-picker>
    `;
    const steering = `
      <webhid-steering-config>
        <slot name="steering-visual" slot="visual"></slot>
        <slot name="steering-extra" slot="extra"></slot>
      </webhid-steering-config>
    `;
    const axes = '<webhid-axis-mapper></webhid-axis-mapper>';
    const buttons = '<webhid-button-mapper></webhid-button-mapper>';
    const extraSettings = '<slot name="extra-settings"></slot>';
    const profiles = `
      <div class="profiles">
        <h3>Setup profile</h3>
        <div class="actions">
          <input data-role="name" type="text" placeholder="Profile name" aria-label="Profile name">
          <select data-role="profile-select" aria-label="Stored setup profiles"></select>
          <button type="button" data-action="save">Save</button>
          <button type="button" data-action="delete-profile" class="danger">Delete</button>
          <button type="button" data-action="export">Export</button>
          <button type="button" data-action="import">Import</button>
          <input data-role="file" type="file" accept="application/json,.json" hidden>
        </div>
      </div>
    `;
    const footer = '<slot name="footer"></slot>';
    const head = `
      <div class="head">
        <slot name="header"><h3>Wheel configuration</h3></slot>
        <span class="badge" data-role="mode"></span>
      </div>
    `;

    if (!this.tabbed) {
      return `
        <div class="panel">
          ${head}
          ${profiles}
          ${device}
          ${steering}
          ${axes}
          ${buttons}
          ${extraSettings}
          ${footer}
        </div>
      `;
    }

    const tab = (name, label) => {
      const selected = this._activeTab === name;
      return `<button class="tab" type="button" role="tab" id="${name}-tab" aria-controls="${name}-panel" aria-selected="${selected}" tabindex="${selected ? '0' : '-1'}" data-tab="${name}">${label}</button>`;
    };

    return `
      <div class="panel">
        ${head}
        ${profiles}
        ${device}
        <div class="tabs" role="tablist" aria-label="Wheel configuration sections">
          ${tab('wheel', 'Wheel')}
          ${tab('axes', 'Pedals & axes')}
          ${tab('buttons', 'Buttons')}
        </div>
        <div class="tab-panel" id="wheel-panel" role="tabpanel" aria-labelledby="wheel-tab" data-panel="wheel"${this._activeTab === 'wheel' ? '' : ' hidden'}>
          ${steering}
          ${extraSettings}
        </div>
        <div class="tab-panel" id="axes-panel" role="tabpanel" aria-labelledby="axes-tab" data-panel="axes"${this._activeTab === 'axes' ? '' : ' hidden'}>
          ${axes}
        </div>
        <div class="tab-panel" id="buttons-panel" role="tabpanel" aria-labelledby="buttons-tab" data-panel="buttons"${this._activeTab === 'buttons' ? '' : ' hidden'}>
          ${buttons}
        </div>
        ${footer}
      </div>
    `;
  }

  bind() {
    const root = this.shadowRoot;
    root.querySelector('[data-action="save"]').addEventListener('click', () => this._save());
    root.querySelector('[data-action="export"]').addEventListener('click', () => this._export());
    root.querySelector('[data-action="delete-profile"]').addEventListener('click', () => this._deleteProfile());
    root.querySelector('[data-action="import"]').addEventListener('click', () => root.querySelector('[data-role="file"]').click());
    root.querySelector('[data-role="file"]').addEventListener('change', (event) => this._import(event));
    root.querySelector('[data-role="profile-select"]').addEventListener('change', (event) => this._selectProfile(event.target.value));
    root.addEventListener('webhid-connect', () => this._onConnect());
    root.addEventListener('webhid-remove-device', (event) => this._removeDevice(event.detail || {}));
    if (this.tabbed) {
      for (const tab of root.querySelectorAll('[role="tab"]')) {
        tab.addEventListener('click', () => this._selectTab(tab.dataset.tab));
      }
      const tablist = root.querySelector('[role="tablist"]');
      tablist.addEventListener('keydown', (event) => this._onTabKeydown(event));
    }
  }

  _selectTab(name, options = {}) {
    const valid = ['wheel', 'axes', 'buttons'];
    const next = valid.includes(name) ? name : 'wheel';
    this._activeTab = next;
    if (!this.shadowRoot) return;
    for (const tab of this.shadowRoot.querySelectorAll('[role="tab"]')) {
      const selected = tab.dataset.tab === next;
      tab.setAttribute('aria-selected', selected ? 'true' : 'false');
      tab.tabIndex = selected ? 0 : -1;
      if (selected && options.focus) tab.focus();
    }
    for (const panel of this.shadowRoot.querySelectorAll('[role="tabpanel"]')) {
      panel.hidden = panel.dataset.panel !== next;
    }
    if (options.emit) this.emit('webhid-tab-change', { tab: next });
  }

  _onTabKeydown(event) {
    const keys = ['ArrowRight', 'ArrowLeft', 'Home', 'End'];
    if (!keys.includes(event.key)) return;
    const tabs = Array.from(this.shadowRoot.querySelectorAll('[role="tab"]'));
    if (!tabs.length) return;
    const current = tabs.findIndex(tab => tab.dataset.tab === this._activeTab);
    let next = current;
    if (event.key === 'ArrowRight') next = (current + 1) % tabs.length;
    else if (event.key === 'ArrowLeft') next = (current - 1 + tabs.length) % tabs.length;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = tabs.length - 1;
    event.preventDefault();
    this._selectTab(tabs[next].dataset.tab, { focus: true, emit: true });
  }

  _onConnect() {
    if (this._pendingProfile) {
      this._apply(this._pendingProfile);
    } else if (!this._store) {
      this._migrateLegacy();
    }
    if (!this._store && this._manager &&
        this._manager.sessionList.some(entry => entry.session && entry.session.isConnected && entry.capabilities && entry.capabilities.steering)) {
      this._store = emptyStore();
    }
    this.refresh();
  }

  _activeProfile() {
    if (!this._store || !this._store.activeProfile) return null;
    return this._store.profiles.find(profile => profile.profileName === this._store.activeProfile) || null;
  }

  _syncDeviceProfile() {
    if (!this.shadowRoot) return;
    const picker = this.shadowRoot.querySelector('webhid-device-picker');
    const active = this._activeProfile();
    picker.profileDevices = active
      ? active.devices.filter(device => !this._removedAliases.has(device.alias))
      : [];
  }

  _profileWithoutRemoved(profile) {
    if (!profile || !this._removedAliases.size) return profile;
    const devices = profile.devices.filter(device => !this._removedAliases.has(device.alias));
    if (!devices.length) return null;
    const firstAlias = devices[0].alias;
    const settings = profile.settings;
    const axes = Object.fromEntries(
      Object.entries(settings.axes).filter(([, entry]) => !this._removedAliases.has(entry.device))
    );
    const buttons = Object.fromEntries(
      Object.entries(settings.buttons).filter(([, entry]) => !this._removedAliases.has(entry.device))
    );
    return {
      ...profile,
      devices,
      settings: {
        steering: {
          ...settings.steering,
          device: this._removedAliases.has(settings.steering.device) ? firstAlias : settings.steering.device
        },
        ffb: {
          ...settings.ffb,
          device: this._removedAliases.has(settings.ffb.device) ? firstAlias : settings.ffb.device
        },
        axes,
        buttons
      }
    };
  }

  async _removeDevice(detail) {
    const profile = this._activeProfile();
    if (!profile) {
      this.refresh();
      return;
    }
    const alias = detail.alias || (profile.devices.find(device =>
      hardwareMatches(detail.hardware, device.hardware)
    ) || {}).alias;
    if (!alias) {
      this.refresh();
      return;
    }
    this._removedAliases.add(alias);
    this.refresh();
  }

  async _loadProfileDevices(profile) {
    this._removedAliases.clear();
    if (!this._manager || typeof navigator === 'undefined' || !navigator.hid ||
        typeof navigator.hid.getDevices !== 'function') return false;
    let granted;
    try {
      granted = await navigator.hid.getDevices();
    } catch (error) {
      this._reportError(error);
      return false;
    }
    for (const device of granted) {
      try {
        if (!device.signature) device.signature = deviceSignature(device);
      } catch { /* ignore */ }
    }
    const result = this._profiles.match(profile, granted);
    if (result.status === 'ambiguous') {
      this._reportError(new Error(`Profile "${profile.profileName}" matches more than one device.`));
      return false;
    }
    const wanted = profile.devices.map(device => device.hardware);
    const keep = entry => wanted.some(hardware => {
      if (!entry.hardware) return false;
      if (entry.hardware.vendorId !== hardware.vendorId || entry.hardware.productId !== hardware.productId) return false;
      return !hardware.signature || entry.hardware.signature === hardware.signature;
    });
    for (const entry of this._manager.sessionList) {
      if (entry.session && entry.session.isConnected && !keep(entry)) {
        try { await this._manager.disconnect(entry.id); } catch { /* keep going */ }
      }
    }
    for (const device of Object.values(result.matches)) {
      try { await this._manager.connect(device); } catch { /* keep going */ }
    }
    return true;
  }

  async _loadProfile(profile) {
    await this._loadProfileDevices(profile);
    this._apply(profile);
    this._refreshChildren();
  }

  _apply(profile) {
    if (!this._manager) return false;
    const devices = this._manager.sessionList
      .filter(entry => entry.session && entry.session.isConnected)
      .map(entry => entry.device)
      .filter(Boolean);
    const result = this._profiles.match(profile, devices);
    const name = this.shadowRoot.querySelector('[data-role="name"]');
    if (name) name.value = profile.profileName;
    if (result.status === 'ambiguous') {
      this._reportError(new Error(`Profile "${profile.profileName}" matches more than one device.`));
      this._refreshChildren();
      return false;
    }
    this._manager.applySetup(profile);
    if (result.status === 'matched') {
      this._pendingProfile = null;
      return true;
    }
    this._pendingProfile = profile;
    this._refreshChildren();
    return false;
  }

  _loadStore() {
    if (!this._profiles) return;
    try {
      this._store = this._profiles.loadStore();
      if (!this._store && typeof localStorage !== 'undefined') {
        const legacy = localStorage.getItem(LEGACY_STORE_KEY);
        if (legacy) {
          this._store = parseStore(legacy);
          this._profiles.saveStore(this._store);
        }
      }
    } catch (error) {
      this._store = null;
      this._reportError(error);
    }
    if (this._store && this._store.activeProfile) {
      const active = this._store.profiles.find(profile => profile.profileName === this._store.activeProfile);
      if (active) {
        this._removedAliases.clear();
        this._pendingProfile = active;
        this._apply(active);
      }
    }
    this._refreshProfileSelect();
  }

  _migrateLegacy() {
    if (this._store) return;
    const snapshot = legacyStorageSnapshot();
    const entry = this._manager && this._manager.sessionList.find(item =>
      item.session && item.session.isConnected && item.capabilities && item.capabilities.steering
    );
    if (!snapshot || !entry || !entry.device) return;
    try {
      const profile = validateProfile({
        ...(snapshot.settings || {}),
        mappings: snapshot.mappings || {},
        name: `${entry.name || 'Device'} setup`
      }, {
        hardware: {
          vendorId: entry.device.vendorId,
          productId: entry.device.productId,
          productName: entry.device.productName || '',
          signature: entry.hardware && entry.hardware.signature ? entry.hardware.signature : null
        }
      });
      this._manager.applySetup(profile);
      this._store = {
        kind: 'webhid-wheel-profile-store',
        schemaVersion: 2,
        activeProfile: profile.profileName,
        profiles: [profile]
      };
      this._profiles.saveStore(this._store);
      this._refreshProfileSelect();
      this._refreshChildren();
    } catch (error) {
      this._reportError(error);
    }
  }

  _currentProfile() {
    const connected = this._manager
      ? this._manager.sessionList.filter(entry => entry.session && entry.session.isConnected)
      : [];
    if (!connected.length) return null;
    const nameInput = this.shadowRoot.querySelector('[data-role="name"]');
    const existing = this._store && this._store.activeProfile
      ? this._store.profiles.find(profile => profile.profileName === this._store.activeProfile)
      : null;
    const base = this._profileWithoutRemoved(existing);
    try {
      const first = connected[0];
      return validateProfile(this._manager.toSetup({
        profileName: (nameInput && nameInput.value.trim()) || (existing && existing.profileName) || `${first.name || 'Rig'} setup`,
        metadata: existing ? existing.metadata : {},
        baseProfile: base || undefined
      }));
    } catch (error) {
      this._reportError(error);
      return null;
    }
  }

  _save() {
    const profile = this._currentProfile();
    if (!profile) return;
    this._removedAliases.clear();
    const profiles = this._store ? this._store.profiles.slice() : [];
    const index = profiles.findIndex(item => item.profileName === profile.profileName);
    if (index >= 0) profiles[index] = profile;
    else profiles.push(profile);
    this._store = {
      kind: 'webhid-wheel-profile-store',
      schemaVersion: 2,
      activeProfile: profile.profileName,
      profiles
    };
    try {
      this._profiles.saveStore(this._store);
      this._refreshProfileSelect();
    } catch (error) {
      this._reportError(error);
    }
  }

  async _selectProfile(name) {
    if (!this._store) return;
    if (!name) {
      this._store.activeProfile = null;
      this._removedAliases.clear();
      this._pendingProfile = null;
      try { this._profiles.saveStore(this._store); } catch (error) { this._reportError(error); }
      const nameInput = this.shadowRoot.querySelector('[data-role="name"]');
      if (nameInput) nameInput.value = '';
      this._refreshProfileSelect();
      this.refresh();
      return;
    }
    const profile = this._store.profiles.find(item => item.profileName === name);
    if (!profile) return;
    this._removedAliases.clear();
    this._store.activeProfile = name;
    try { this._profiles.saveStore(this._store); } catch { /* storage may be unavailable */ }
    this._pendingProfile = profile;
    await this._loadProfile(profile);
    this._refreshProfileSelect();
  }

  _deleteProfile() {
    if (!this._store || !this._store.activeProfile) return;
    const name = this._store.activeProfile;
    const profiles = this._store.profiles.filter(profile => profile.profileName !== name);
    this._store = {
      ...this._store,
      activeProfile: null,
      profiles
    };
    this._removedAliases.clear();
    this._pendingProfile = null;
    try {
      this._profiles.saveStore(this._store);
    } catch (error) {
      this._reportError(error);
    }
    const nameInput = this.shadowRoot.querySelector('[data-role="name"]');
    if (nameInput) nameInput.value = '';
    this._refreshProfileSelect();
    this.refresh();
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
      this._removedAliases.clear();
      this._pendingProfile = profile;
      await this._loadProfile(profile);
      const profiles = this._store ? this._store.profiles.slice() : [];
      const index = profiles.findIndex(item => item.profileName === profile.profileName);
      if (index >= 0) profiles[index] = profile;
      else profiles.push(profile);
      this._store = {
        kind: 'webhid-wheel-profile-store',
        schemaVersion: 2,
        activeProfile: profile.profileName,
        profiles
      };
      this._profiles.saveStore(this._store);
      this._refreshProfileSelect();
      this.emit('webhid-profile-change', { profile, action: 'import' });
    } catch (error) {
      this._reportError(error);
    }
  }

  _refreshProfileSelect() {
    const select = this.shadowRoot.querySelector('[data-role="profile-select"]');
    if (!select) return;
    const profiles = this._store ? this._store.profiles : [];
    if (profiles.length) {
      select.innerHTML = [
        `<option value=""${this._store.activeProfile ? '' : ' selected'}>No profile</option>`,
        ...profiles.map(profile => `<option value="${escapeAttribute(profile.profileName)}"${this._store.activeProfile === profile.profileName ? ' selected' : ''}>${escapeHtml(profile.profileName)}</option>`)
      ].join('');
    } else {
      select.innerHTML = '<option value="">No stored profiles</option>';
    }
    select.disabled = !profiles.length;
    const deleteButton = this.shadowRoot.querySelector('[data-action="delete-profile"]');
    if (deleteButton) deleteButton.disabled = !this._store || !this._store.activeProfile;
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

  _reportError(error) {
    const normalized = error instanceof Error ? error : new Error(String(error));
    console.warn('webhid-wheel profile:', normalized);
    this.emit('webhid-error', { error: normalized });
  }

  refresh() {
    if (!this.shadowRoot || !this.shadowRoot.querySelector('[data-role="profile-select"]')) return;
    this._ensureManager();
    this._ensureProfiles();
    this._syncChildren();
    this._syncDeviceProfile();
    this._bindManager();
    this._refreshProfileSelect();
    const mode = this.shadowRoot.querySelector('[data-role="mode"]');
    if (mode) mode.textContent = 'WebHID';
    const connected = this._manager ? this._manager.sessionList.filter(entry => entry.session && entry.session.isConnected) : [];
    const save = this.shadowRoot.querySelector('[data-action="save"]');
    const exportButton = this.shadowRoot.querySelector('[data-action="export"]');
    if (save) save.disabled = !connected.length;
    if (exportButton) exportButton.disabled = !connected.length;
  }
}

function emptyStore() {
  return {
    kind: 'webhid-wheel-profile-store',
    schemaVersion: 2,
    activeProfile: null,
    profiles: []
  };
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, ch => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[ch]));
}

function escapeAttribute(value) {
  return escapeHtml(value);
}

function hardwareMatches(left, right) {
  if (!left || !right) return false;
  if (left.vendorId !== right.vendorId || left.productId !== right.productId) return false;
  return !left.signature || !right.signature || left.signature === right.signature;
}
