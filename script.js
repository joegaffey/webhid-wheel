import { WebHIDWheel, WebHIDDevice, isForceFeedbackWheel } from './webhid-wheel.js';

const STORAGE = {
  devices: 'webhid-wheel:v1:devices',
  mappings: 'webhid-wheel:v1:mappings',
  settings: 'webhid-wheel:v1:settings'
};

const AXIS_ROWS = [
  { key: 'throttle', label: 'Throttle' },
  { key: 'brake', label: 'Brake' },
  { key: 'clutch', label: 'Clutch' },
  { key: 'handbrake', label: 'Handbrake' }
];

const BUTTON_ACTIONS = [
  'gearUp',
  'gearDown',
  'reverse',
  'neutral',
  ...Array.from({ length: 8 }, (_, index) => `gear${index + 1}`),
  'handbrake'
];

const TAB_KEYS = ['wheel', 'axes', 'buttons'];

function emptyState() {
  return { axes: [], rawAxes: [], buttons: [], hats: [], reports: {}, timestamp: 0, reportId: null };
}

function defaultMapping() {
  return {
    wheel: { steering: null },
    axes: Object.fromEntries(AXIS_ROWS.map(row => [row.key, null])),
    buttons: Object.fromEntries(BUTTON_ACTIONS.map(key => [key, null]))
  };
}

function defaultSettings() {
  return { ffbStrength: 0.25, ffbInvert: false, maxRotation: 900 };
}

function loadJson(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function saveJson(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* quota or disabled */ }
}

function mergeMapping(saved) {
  const base = defaultMapping();
  if (!saved || typeof saved !== 'object') return base;
  if (saved.wheel) base.wheel = { ...base.wheel, ...saved.wheel };
  if (saved.axes) base.axes = { ...base.axes, ...saved.axes };
  if (saved.buttons) base.buttons = { ...base.buttons, ...saved.buttons };
  return base;
}

const els = {
  connect: document.getElementById('connectButton'),
  export: document.getElementById('exportButton'),
  download: document.getElementById('downloadButton'),
  status: document.getElementById('statusText'),
  deviceList: document.getElementById('deviceList'),
  deviceHint: document.getElementById('deviceHint'),
  tabs: document.getElementById('tabs'),
  wheelMappings: document.getElementById('wheelMappings'),
  axesMappings: document.getElementById('axesMappings'),
  buttonMappings: document.getElementById('buttonMappings'),
  defaultButtons: document.getElementById('defaultButtons'),
  wheelHint: document.getElementById('wheelHint'),
  maxRotation: document.getElementById('maxRotation'),
  maxRotationValue: document.getElementById('maxRotationValue'),
  strength: document.getElementById('strength'),
  strengthValue: document.getElementById('strengthValue'),
  force: document.getElementById('force'),
  forceValue: document.getElementById('forceValue'),
  invertFfb: document.getElementById('invertFfb'),
  stopFfb: document.getElementById('stopFfb'),
  debug: document.getElementById('debug'),
  exportOutput: document.getElementById('exportOutput'),
  exportText: document.getElementById('exportText'),
  rim: document.getElementById('rim'),
  steerArc: document.getElementById('steerArc'),
  angleReadout: document.getElementById('angleReadout')
};

let savedDevices = loadJson(STORAGE.devices, []);
let mapping = mergeMapping(loadJson(STORAGE.mappings, null));
let settings = { ...defaultSettings(), ...(loadJson(STORAGE.settings, {}) || {}) };
let sessions = [];
let captures = [];
let activeId = null;
let activeTab = 'wheel';
let armed = null;
let nextId = 1;
let lastDebugKey = '';
let lastDebugValues = null;

function setStatus(text, tone = '') {
  els.status.textContent = text;
  els.status.className = tone;
}

function deviceMeta(session) {
  return {
    vendorId: session.vendorId,
    productId: session.productId,
    productName: session.name,
    signature: session.signature,
    kind: session.kind,
    ffb: session.ffb
  };
}

function sameDeviceMeta(a, b) {
  if (!a || !b) return false;
  if (a.vendorId !== b.vendorId || a.productId !== b.productId || a.productName !== b.productName) return false;
  if (a.signature && b.signature) return a.signature === b.signature;
  return true;
}

function upsertSaved(meta) {
  savedDevices = savedDevices.filter(item => !sameDeviceMeta(item, meta));
  savedDevices.push(meta);
  saveJson(STORAGE.devices, savedDevices);
}

function saveMappings() {
  saveJson(STORAGE.mappings, mapping);
}

function saveSettings() {
  saveJson(STORAGE.settings, settings);
}

function activeSession() {
  return sessions.find(session => session.id === activeId) || null;
}

function activeWheel() {
  const active = activeSession();
  if (active && active.kind === 'wheel') return active;
  return sessions.find(session => session.kind === 'wheel') || null;
}

function sessionLayout(session) {
  if (!session) return { axes: [], buttons: [], hats: [] };
  return session.kind === 'wheel'
    ? session.wheel.inputLayout || { axes: [], buttons: [], hats: [] }
    : session.generic.inputLayout || { axes: [], buttons: [], hats: [] };
}

function sessionState(session) {
  if (!session) return emptyState();
  if (session.kind === 'wheel') return session.wheel.deviceState || emptyState();
  return session.generic.state;
}

function hex(value, width = 4) {
  return '0x' + Number(value || 0).toString(16).toUpperCase().padStart(width, '0');
}

function hashString(text) {
  let hash = 2166136261;
  for (let index = 0; index < text.length; index++) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

function deviceSignature(device) {
  const parts = [];
  for (const collection of device.collections || []) {
    parts.push(`c:${collection.usagePage}:${collection.usage}`);
    for (const [kind, list] of [
      ['i', collection.inputReports],
      ['o', collection.outputReports],
      ['f', collection.featureReports]
    ]) {
      for (const report of list || []) {
        parts.push(`${kind}:${report.reportId}`);
        for (const item of report.items || []) {
          const usages = (item.usages || []).map(value => value.toString(16)).join(',');
          parts.push(`${item.reportSize}x${item.reportCount}:${item.logicalMinimum}:${item.logicalMaximum}:${usages}:${item.isConstant ? 1 : 0}:${item.isRange ? 1 : 0}:${item.isArray ? 1 : 0}`);
        }
      }
    }
  }
  return hashString(parts.join('|'));
}

function deviceMatchesMeta(device, meta) {
  if (!device || !meta) return false;
  if (device.vendorId !== meta.vendorId || device.productId !== meta.productId) return false;
  if ((device.productName || '') !== (meta.productName || '')) return false;
  if (meta.signature && deviceSignature(device) !== meta.signature) return false;
  return true;
}

function actionLabel(key) {
  if (key.startsWith('gear') && /^\d+$/.test(key.slice(4))) return `Gear ${key.slice(4)}`;
  if (key === 'gearUp') return 'Gear up';
  if (key === 'gearDown') return 'Gear down';
  if (key === 'handbrake') return 'Handbrake';
  if (key === 'reverse') return 'Reverse';
  if (key === 'neutral') return 'Neutral';
  if (key.startsWith('button')) return `Button ${key.slice(6)}`;
  return key;
}

function sourceLabel(entry) {
  if (!entry) return '';
  if (entry.source === 'axis') return `Axis ${entry.index + 1}${entry.invert ? ' (inverted)' : ''}`;
  if (entry.source === 'button') return `Button ${entry.index + 1}`;
  if (entry.source === 'hat') return `Hat ${entry.index + 1} ${entry.direction}`;
  return entry.source;
}

function entryLabel(entry) {
  if (!entry) return 'Not set';
  const name = entry.device?.productName || 'Device';
  const suffix = entry.device?.signature ? ` #${entry.device.signature.slice(0, 6)}` : '';
  return `${name}${suffix} · ${sourceLabel(entry)}`;
}

async function addDevice(device, options = {}) {
  const { save = true, activate = true } = options;
  const existing = sessions.find(session => session.device === device);
  if (existing) {
    if (activate) activeId = existing.id;
    renderAll();
    return existing;
  }

  const kind = isForceFeedbackWheel(device) ? 'wheel' : 'device';
  const session = {
    id: `dev${nextId++}`,
    device,
    kind,
    vendorId: device.vendorId,
    productId: device.productId,
    name: device.productName || 'HID device',
    signature: deviceSignature(device),
    wheel: null,
    generic: null,
    ffb: false
  };

  try {
    if (kind === 'wheel') {
      session.wheel = new WebHIDWheel({
        maxRotation: settings.maxRotation,
        ffbStrength: settings.ffbStrength,
        ffbInvert: settings.ffbInvert
      });
      await session.wheel.connect(device);
      session.ffb = session.wheel.ffbCaps?.constant === true || session.wheel.ffbCaps?.periodic === true;
      session.wheel.on('input', () => handleSessionInput(session));
      session.wheel.on('disconnect', () => handleDeviceDisconnect(session));
      session.wheel.on('error', error => setStatus(String(error?.message || error), 'warn'));
    } else {
      session.generic = new WebHIDDevice();
      await session.generic.connect(device);
      session.generic.on('input', () => handleSessionInput(session));
      session.generic.on('disconnect', () => handleDeviceDisconnect(session));
      session.generic.on('error', error => setStatus(String(error?.message || error), 'warn'));
    }
  } catch (error) {
    setStatus(`Failed to open ${session.name}: ${error?.message || error}`, 'warn');
    return null;
  }

  sessions.push(session);
  if (save) upsertSaved(deviceMeta(session));
  if (activate || !activeId) activeId = session.id;
  setStatus(`Connected ${session.name}`, 'ok');
  renderAll();
  return session;
}

function handleDeviceDisconnect(session) {
  if (!sessions.includes(session)) return;
  sessions = sessions.filter(item => item !== session);
  if (activeId === session.id) activeId = sessions[0]?.id ?? null;
  if (armed && armed.sessionId === session.id) cancelCapture('Device disconnected');
  renderAll();
}

async function removeSession(session, keepSaved = false) {
  sessions = sessions.filter(item => item !== session);
  if (!keepSaved) {
    savedDevices = savedDevices.filter(item => !sameDeviceMeta(item, deviceMeta(session)));
    saveJson(STORAGE.devices, savedDevices);
  }
  if (activeId === session.id) activeId = sessions[0]?.id ?? null;
  if (armed && armed.sessionId === session.id) cancelCapture('Device removed');
  try {
    if (session.wheel) await session.wheel.disconnect();
    if (session.generic) await session.generic.disconnect();
  } catch { /* noop */ }
  renderAll();
}

function handleSessionInput(session) {
  if (!sessions.includes(session)) return;
  if (activeId === session.id) {
    renderDebug(session);
    renderWheelStatus();
    renderWheelVisual();
  }
  if (armed && armed.sessionId === session.id) processCapture(session);
  flashDevice(session);
  updateLiveInputs();
}

function flashDevice(session) {
  const dot = session._activityDot;
  if (!dot) return;
  const now = performance.now();
  if (session._activityAt && now - session._activityAt < 100) return;
  session._activityAt = now;
  dot.classList.add('on');
  clearTimeout(session._activityTimer);
  session._activityTimer = setTimeout(() => dot.classList.remove('on'), 250);
}

function beginCapture(scope, key, allowed, rowEl) {
  if (armed && armed.scope === scope && armed.key === key) {
    cancelCapture('Cancelled');
    return;
  }
  if (armed) cancelCapture('');
  const session = scope === 'wheel' ? activeWheel() : activeSession();
  if (!session) { setStatus('Select a connected device first.', 'warn'); return; }
  const layout = sessionLayout(session);
  if (allowed.includes('axis') && !layout.axes.length) {
    setStatus(`${session.name} exposes no axes.`, 'warn');
    return;
  }
  if (allowed.includes('button') && !layout.buttons.length && !layout.hats.length) {
    setStatus(`${session.name} exposes no buttons or hats.`, 'warn');
    return;
  }
  armed = {
    sessionId: session.id,
    scope,
    key,
    allowed,
    rowEl,
    baseline: sessionState(session),
    lastButtons: sessionState(session).buttons.slice(),
    lastHats: sessionState(session).hats.map(hat => hat.direction),
    lastAxes: sessionState(session).axes.slice(),
    lastRawAxes: sessionState(session).rawAxes.slice(),
    axisIndex: null,
    rawMin: Infinity,
    rawMax: -Infinity,
    samples: [],
    result: null,
    timer: null,
    timeout: setTimeout(() => cancelCapture('No axis or button movement detected'), 15000)
  };
  rowEl?.classList.add('armed');
  setStatus(`Listening on ${session.name}. Move or press the input for ${scope === 'wheel' ? 'steering' : actionLabel(key)}.`);
}

function processCapture(session) {
  if (!armed || armed.sessionId !== session.id) return;
  const state = sessionState(session);
  const baseline = armed.baseline;

  if (armed.allowed.includes('button')) {
    for (let index = 0; index < state.buttons.length; index++) {
      if (state.buttons[index] && !armed.lastButtons[index]) {
        finishCapture({ source: 'button', index });
        return;
      }
    }
    for (let index = 0; index < state.hats.length; index++) {
      const direction = state.hats[index]?.direction;
      if (direction && direction !== armed.lastHats[index]) {
        finishCapture({ source: 'hat', index, direction, raw: state.hats[index].raw });
        return;
      }
    }
    armed.lastButtons = state.buttons.slice();
    armed.lastHats = state.hats.map(hat => hat.direction);
  }

  if (!armed.allowed.includes('axis')) return;

  let changed = false;
  for (let index = 0; index < state.rawAxes.length; index++) {
    if (state.rawAxes[index] !== armed.lastRawAxes[index]) { changed = true; break; }
  }
  armed.lastAxes = state.axes.slice();
  armed.lastRawAxes = state.rawAxes.slice();
  if (!changed) return;

  let bestIndex = -1;
  let bestDelta = 0;
  for (let index = 0; index < state.axes.length; index++) {
    const delta = Math.abs((state.axes[index] ?? 0) - (baseline.axes[index] ?? 0));
    if (delta > bestDelta) { bestDelta = delta; bestIndex = index; }
  }
  if (bestIndex < 0 || bestDelta < 0.0005) return;

  if (armed.axisIndex !== bestIndex) {
    armed.axisIndex = bestIndex;
    armed.rawMin = Infinity;
    armed.rawMax = -Infinity;
    armed.samples = [];
    setStatus(`Detected Axis ${bestIndex + 1} on ${session.name}. Release the input to finish.`, 'ok');
  }
  const raw = state.rawAxes[bestIndex];
  armed.rawMin = Math.min(armed.rawMin, raw);
  armed.rawMax = Math.max(armed.rawMax, raw);
  if (!armed.samples.includes(raw)) armed.samples.push(raw);
  if (armed.timer) clearTimeout(armed.timer);
  armed.timer = setTimeout(() => finishCapture(), 1200);
}

function finishCapture(result = null) {
  if (!armed) return;
  const session = sessions.find(item => item.id === armed.sessionId);
  if (!session) { cancelCapture('Device unavailable'); return; }
  const source = result || (armed.axisIndex !== null
    ? { source: 'axis', index: armed.axisIndex }
    : null);
  if (!source) { cancelCapture('No input detected'); return; }

  const layout = sessionLayout(session);
  const entry = {
    device: deviceMeta(session),
    sessionId: session.id,
    source: source.source,
    index: source.index,
    invert: false
  };
  if (source.source === 'axis') {
    const axis = layout.axes[source.index];
    entry.usage = axis?.usage;
    entry.rawMin = armed.rawMin;
    entry.rawMax = armed.rawMax;
  } else if (source.source === 'hat') {
    entry.direction = source.direction;
    entry.raw = source.raw;
  }

  if (armed.scope === 'wheel') mapping.wheel[armed.key] = entry;
  else if (armed.scope === 'axes') mapping.axes[armed.key] = entry;
  else mapping.buttons[armed.key] = entry;

  captures = captures.filter(item => !(item.scope === armed.scope && item.key === armed.key));
  captures.push({
    scope: armed.scope,
    key: armed.key,
    ...entry,
    samples: source.source === 'axis' ? armed.samples.slice(0, 24) : []
  });
  saveMappings();
  const label = armed.scope === 'wheel' ? 'Steering' : actionLabel(armed.key);
  clearArmed();
  setStatus(`Mapped ${label} to ${sourceLabel(entry)} on ${session.name}.`, 'ok');
  renderAll();
}

function clearArmed() {
  if (!armed) return;
  clearTimeout(armed.timeout);
  if (armed.timer) clearTimeout(armed.timer);
  armed.rowEl?.classList.remove('armed');
  armed = null;
}

function cancelCapture(message) {
  clearArmed();
  if (message) setStatus(message);
}

function clearMapping(scope, key) {
  mapping[scope][key] = null;
  captures = captures.filter(item => !(item.scope === scope && item.key === key));
  saveMappings();
  renderAll();
}

function setInvert(scope, key, invert) {
  const entry = mapping[scope][key];
  if (!entry) return;
  entry.invert = !!invert;
  const capture = captures.find(item => item.scope === scope && item.key === key);
  if (capture) capture.invert = !!invert;
  saveMappings();
}

function findEntrySession(entry) {
  if (!entry) return null;
  if (entry.sessionId) {
    const byId = sessions.find(session => session.id === entry.sessionId);
    if (byId) return byId;
  }
  return sessions.find(session => sameDeviceMeta(deviceMeta(session), entry.device)) || null;
}

function entryIsPressed(entry, state) {
  if (!entry || !state) return false;
  if (entry.source === 'button') return !!state.buttons[entry.index];
  if (entry.source === 'hat') return state.hats[entry.index]?.direction === entry.direction;
  return false;
}

function updateLiveInputs() {
  document.querySelectorAll('.mapping-row').forEach(row => {
    const [scope, key] = row.dataset.key.split(':');
    const entry = mapping[scope]?.[key];
    const stateEl = row.querySelector('.mapping-state');
    if (stateEl) {
      const session = findEntrySession(entry);
      stateEl.classList.toggle('on', entryIsPressed(entry, session ? sessionState(session) : null));
    }
    const slider = row.querySelector('.live-axis');
    if (!slider) return;
    const valueEl = row.querySelector('.live-axis-value');
    const session = findEntrySession(entry);
    if (!entry || !session || entry.source !== 'axis') {
      slider.value = 0;
      slider.disabled = true;
      if (valueEl) valueEl.textContent = '—';
      return;
    }
    const state = sessionState(session);
    let value = state.axes[entry.index] ?? 0;
    if (entry.invert) value = 1 - value;
    slider.disabled = false;
    slider.value = String(Math.max(0, Math.min(1, value)));
    if (valueEl) valueEl.textContent = `${Math.round(Math.max(0, Math.min(1, value)) * 100)}%`;
  });
}

function mappingRow(scope, key, label, allowed, options = {}) {
  const row = document.createElement('div');
  row.className = 'mapping-row';
  row.dataset.key = `${scope}:${key}`;

  const labelEl = document.createElement('div');
  labelEl.className = 'mapping-label';
  labelEl.textContent = label;

  const targetEl = document.createElement('div');
  targetEl.className = 'mapping-target';
  const entry = mapping[scope]?.[key] || null;
  targetEl.textContent = entryLabel(entry);
  if (entry) targetEl.classList.add('set');

  const setButton = document.createElement('button');
  setButton.className = 'ghost';
  setButton.type = 'button';
  setButton.textContent = 'Set';
  setButton.addEventListener('click', () => beginCapture(scope, key, allowed, row));

  const clearButton = document.createElement('button');
  clearButton.className = 'ghost';
  clearButton.type = 'button';
  clearButton.textContent = 'Clear';
  clearButton.disabled = !entry;
  clearButton.addEventListener('click', () => clearMapping(scope, key));

  row.append(labelEl, targetEl, setButton, clearButton);

  if (entry && entry.source !== 'axis') {
    const stateEl = document.createElement('span');
    stateEl.className = 'mapping-state';
    stateEl.title = 'Mapped input';
    row.append(stateEl);
  }

  if (options.pickAxis) {
    const session = scope === 'wheel' ? activeWheel() : activeSession();
    const layout = sessionLayout(session);
    if (session && layout.axes.length) {
      const select = document.createElement('select');
      select.className = 'axis-pick';
      select.title = 'Pick an axis directly';
      const placeholder = document.createElement('option');
      placeholder.value = '';
      placeholder.textContent = 'Pick axis…';
      select.append(placeholder);
      layout.axes.forEach((axis, index) => {
        const option = document.createElement('option');
        option.value = String(index);
        option.textContent = `Axis ${index + 1} · ${hex(axis.usage, 5)}`;
        select.append(option);
      });
      if (entry && entry.source === 'axis') select.value = String(entry.index);
      select.addEventListener('change', () => {
        if (select.value === '') return;
        const index = Number(select.value);
        const axis = layout.axes[index];
        mapping[scope][key] = {
          device: deviceMeta(session),
          sessionId: session.id,
          source: 'axis',
          index,
          usage: axis?.usage,
          invert: entry?.invert || false
        };
        captures = captures.filter(item => !(item.scope === scope && item.key === key));
        saveMappings();
        renderAll();
      });
      row.append(select);
    }
  }

  if (options.invertable && entry && entry.source === 'axis') {
    const invertWrap = document.createElement('label');
    invertWrap.className = 'hint';
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.className = 'invert';
    input.checked = !!entry.invert;
    input.addEventListener('change', () => setInvert(scope, key, input.checked));
    invertWrap.append(input, ' Invert');
    row.append(invertWrap);
  }

  if (entry && entry.source === 'axis') {
    const live = document.createElement('div');
    live.className = 'mapping-live';
    const slider = document.createElement('input');
    slider.type = 'range';
    slider.className = 'live-axis';
    slider.min = '0';
    slider.max = '1';
    slider.step = '0.001';
    slider.value = '0';
    slider.disabled = true;
    slider.setAttribute('aria-label', `${label} live value`);
    const value = document.createElement('span');
    value.className = 'live-axis-value';
    value.textContent = '—';
    live.append(slider, value);
    row.append(live);
  }
  return row;
}

function renderDeviceList() {
  els.deviceList.replaceChildren();
  for (const session of sessions) {
    const card = document.createElement('div');
    card.className = 'device-card' + (session.id === activeId ? ' active' : '');
    const text = document.createElement('div');
    const name = document.createElement('div');
    name.className = 'device-name';
    name.textContent = session.name;
    const meta = document.createElement('div');
    meta.className = 'device-meta';
    meta.textContent = `${hex(session.vendorId)}:${hex(session.productId)} · ${session.kind === 'wheel' ? 'wheel' : 'HID device'} · #${session.signature.slice(0, 6)}`;
    text.append(name, meta);
    card.dataset.sessionId = session.id;

    const badges = document.createElement('div');
    badges.className = 'device-badges';
    if (session.kind === 'wheel') {
      const wheelBadge = document.createElement('span');
      wheelBadge.className = 'badge';
      wheelBadge.textContent = 'Wheel';
      badges.append(wheelBadge);
    }
    if (session.ffb) {
      const ffbBadge = document.createElement('span');
      ffbBadge.className = 'badge ffb';
      ffbBadge.textContent = 'FFB';
      badges.append(ffbBadge);
    }
    const activity = document.createElement('span');
    activity.className = 'device-activity';
    activity.title = 'Receiving input';
    badges.append(activity);
    session._activityDot = activity;

    const remove = document.createElement('button');
    remove.className = 'device-remove';
    remove.type = 'button';
    remove.textContent = 'Remove';
    remove.addEventListener('click', event => {
      event.stopPropagation();
      removeSession(session);
    });

    card.append(text, badges, remove);
    card.addEventListener('click', () => {
      activeId = session.id;
      if (armed) cancelCapture('Device changed');
      renderAll();
    });
    els.deviceList.append(card);
  }

  const savedOnly = savedDevices.filter(meta => !sessions.some(session => sameDeviceMeta(deviceMeta(session), meta)));
  for (const meta of savedOnly) {
    const card = document.createElement('div');
    card.className = 'device-card';
    const text = document.createElement('div');
    const name = document.createElement('div');
    name.className = 'device-name';
    name.textContent = meta.productName || 'Saved device';
    const info = document.createElement('div');
    info.className = 'device-meta';
    info.textContent = `${hex(meta.vendorId)}:${hex(meta.productId)} · saved`;
    text.append(name, info);
    const badge = document.createElement('span');
    badge.className = 'badge warn';
    badge.textContent = 'Needs permission';
    card.append(text, badge);
    els.deviceList.append(card);
  }

  els.deviceHint.className = 'hint';
  if (!sessions.length) {
    els.deviceHint.textContent = savedOnly.length
      ? 'Saved devices need permission. Use Connect device to grant access again.'
      : 'Connect a wheel, pedals, button box or handbrake. Each Connect adds one device.';
  } else {
    els.deviceHint.textContent = `${sessions.length} device${sessions.length === 1 ? '' : 's'} connected. Select a device, then use the tabs below.`;
  }
  els.export.disabled = sessions.length === 0;
  els.download.disabled = sessions.length === 0;
}

function renderWheelMappings() {
  els.wheelMappings.replaceChildren();
  const wheel = activeWheel();
  els.wheelHint.className = 'hint';
  if (!wheel) {
    els.wheelHint.textContent = 'No wheel connected. Connect a wheel or select one in the device list.';
    const empty = document.createElement('p');
    empty.className = 'hint';
    empty.textContent = 'Steering mapping appears when a wheel is active.';
    els.wheelMappings.append(empty);
    return;
  }
  els.wheelHint.textContent = `${wheel.name}${wheel.ffb ? ' · force feedback available' : ' · no force feedback'}`;
  els.wheelMappings.append(mappingRow('wheel', 'steering', 'Steering', ['axis'], { invertable: false, pickAxis: true }));
}

function renderAxesMappings() {
  els.axesMappings.replaceChildren();
  for (const row of AXIS_ROWS) {
    els.axesMappings.append(mappingRow('axes', row.key, row.label, ['axis'], { invertable: true, pickAxis: true }));
  }
}

function renderButtonMappings() {
  els.buttonMappings.replaceChildren();
  for (const key of BUTTON_ACTIONS) {
    els.buttonMappings.append(mappingRow('buttons', key, actionLabel(key), ['button', 'hat']));
  }
}

function renderDefaultButtons() {
  els.defaultButtons.replaceChildren();
  const session = activeSession();
  if (!session) {
    const hint = document.createElement('p');
    hint.className = 'hint';
    hint.textContent = 'Select a device to see its numbered buttons.';
    els.defaultButtons.append(hint);
    return;
  }
  const layout = sessionLayout(session);
  const count = Math.min(layout.buttons.length, 32);
  if (!count) {
    const hint = document.createElement('p');
    hint.className = 'hint';
    hint.textContent = 'The active device exposes no buttons.';
    els.defaultButtons.append(hint);
    return;
  }
  for (let index = 0; index < count; index++) {
    const key = `button${index + 1}`;
    if (!(key in mapping.buttons)) mapping.buttons[key] = null;
    els.defaultButtons.append(mappingRow('buttons', key, `Button ${index + 1}`, ['button', 'hat']));
  }
}

function renderWheelStatus() {
  const wheel = activeWheel();
  if (!wheel) {
    els.strength.disabled = true;
    els.strengthValue.textContent = '25%';
    els.force.disabled = true;
    els.forceValue.textContent = '0%';
    els.invertFfb.disabled = true;
    els.stopFfb.disabled = true;
    return;
  }
  els.maxRotation.disabled = false;
  els.maxRotation.value = Math.round(wheel.wheel.maxRotation ?? settings.maxRotation);
  els.maxRotationValue.textContent = `${els.maxRotation.value}°`;
  els.strength.disabled = false;
  els.force.disabled = !wheel.ffb;
  els.invertFfb.disabled = !wheel.ffb;
  els.stopFfb.disabled = !wheel.ffb;
  els.strength.value = Math.round((wheel.wheel.ffbStrength ?? settings.ffbStrength) * 100);
  els.strengthValue.textContent = `${els.strength.value}%`;
  els.invertFfb.checked = !!wheel.wheel.ffbInvert;
}

function renderTab() {
  els.tabs.querySelectorAll('.tab').forEach(tab => {
    tab.classList.toggle('active', tab.dataset.tab === activeTab);
  });
  document.querySelectorAll('[data-panel]').forEach(panel => {
    panel.classList.toggle('hidden', panel.dataset.panel !== activeTab);
  });
}

function renderDebug(session) {
  const state = sessionState(session);
  const reportId = state.reportId;
  const bytes = reportId === null ? null : state.reports[reportId];
  if (!bytes) {
    if (lastDebugKey !== 'empty') {
      els.debug.innerHTML = '<div class="dbg-empty">No data</div>';
      lastDebugKey = 'empty';
      lastDebugValues = null;
    }
    return;
  }
  const key = `${session.id}:${reportId}:${bytes.join(',')}`;
  if (key === lastDebugKey) return;
  const cells = bytes.map((byte, index) => {
    const changed = lastDebugValues && lastDebugValues[index] !== byte ? ' chg' : '';
    return `<span class="dbg-byte${changed}" title="byte ${index} = ${byte} (0x${byte.toString(16).padStart(2, '0')})">${byte.toString(16).padStart(2, '0')}</span>`;
  }).join('');
  els.debug.innerHTML = `<div class="dbg-head">report ${reportId} · ${bytes.length} bytes</div><div class="dbg-grid">${cells}</div>`;
  lastDebugKey = key;
  lastDebugValues = bytes.slice();
}

function renderAll() {
  renderDeviceList();
  renderTab();
  renderWheelMappings();
  renderAxesMappings();
  renderButtonMappings();
  renderDefaultButtons();
  renderWheelStatus();
  renderWheelVisual();
  const active = activeSession();
  if (active) renderDebug(active);
  else {
    els.debug.innerHTML = '<div class="dbg-empty">No data</div>';
    lastDebugKey = 'empty';
    lastDebugValues = null;
  }
  updateLiveInputs();
}

function polar(cx, cy, r, deg) {
  const angle = (deg - 90) * Math.PI / 180;
  return { x: +(cx + r * Math.cos(angle)).toFixed(2), y: +(cy + r * Math.sin(angle)).toFixed(2) };
}

function arcPath(cx, cy, r, deg) {
  if (Math.abs(deg) < 0.5) return '';
  const start = polar(cx, cy, r, 0);
  const end = polar(cx, cy, r, deg);
  const large = Math.abs(deg) > 180 ? 1 : 0;
  const sweep = deg > 0 ? 1 : 0;
  return `M ${start.x} ${start.y} A ${r} ${r} 0 ${large} ${sweep} ${end.x} ${end.y}`;
}

function renderWheelVisual() {
  const wheel = activeWheel();
  const rotation = wheel?.wheel?.rotation;
  if (rotation === undefined) {
    els.rim.setAttribute('transform', 'rotate(180 150 150)');
    els.steerArc.setAttribute('d', '');
    els.angleReadout.textContent = 'No wheel';
    return;
  }
  els.rim.setAttribute('transform', `rotate(${rotation + 180} 150 150)`);
  els.steerArc.setAttribute('d', arcPath(150, 150, 86, Math.max(-360, Math.min(360, rotation))));
  els.steerArc.style.opacity = Math.abs(rotation) < 0.5 ? 0 : 1;
  els.angleReadout.textContent = `${rotation >= 0 ? '+' : ''}${Math.round(rotation)}°`;
}

function serializeCollections(device) {
  const item = source => ({
    usages: (source.usages || []).map(value => '0x' + (value >>> 0).toString(16)),
    size: source.reportSize,
    count: source.reportCount,
    logicalMin: source.logicalMinimum,
    logicalMax: source.logicalMaximum,
    isConstant: source.isConstant,
    isRange: source.isRange,
    isArray: source.isArray
  });
  const reports = list => list.map(report => ({ id: report.reportId, items: (report.items || []).map(item) }));
  return device.collections.map(collection => ({
    usagePage: collection.usagePage,
    usage: collection.usage,
    input: reports(collection.inputReports || []),
    output: reports(collection.outputReports || []),
    feature: reports(collection.featureReports || [])
  }));
}

function buildExport() {
  return {
    kind: 'webhid-device-capture',
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    userAgent: navigator.userAgent,
    devices: sessions.map(session => ({
      captureId: session.id,
      vendorId: session.vendorId,
      productId: session.productId,
      productName: session.name,
      signature: session.signature,
      kind: session.kind,
      ffb: session.ffb,
      collections: serializeCollections(session.device),
      layout: sessionLayout(session)
    })),
    captures,
    mappings: mapping
  };
}

async function copyExport() {
  const json = JSON.stringify(buildExport(), null, 2);
  els.exportText.value = json;
  els.exportOutput.classList.remove('hidden');
  try {
    await navigator.clipboard.writeText(json);
    setStatus('JSON copied to clipboard.', 'ok');
  } catch {
    setStatus('Copy failed; select the JSON box and copy manually.', 'warn');
  }
}

function downloadExport() {
  const json = JSON.stringify(buildExport(), null, 2);
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `webhid-capture-${Date.now()}.json`;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  setStatus('JSON downloaded.', 'ok');
}

async function restoreSavedDevices() {
  if (!savedDevices.length || !navigator.hid?.getDevices) return;
  let devices = [];
  try { devices = await navigator.hid.getDevices(); } catch { return; }
  for (const meta of savedDevices) {
    const device = devices.find(item =>
      deviceMatchesMeta(item, meta) &&
      !sessions.some(session => session.device === item));
    if (device) {
      try { await addDevice(device, { save: false, activate: false }); } catch { /* noop */ }
    }
  }
  renderAll();
}

function applyWheelSettings() {
  const wheel = activeWheel();
  if (!wheel) return;
  wheel.wheel.maxRotation = settings.maxRotation;
  wheel.wheel.ffbStrength = settings.ffbStrength;
  wheel.wheel.ffbInvert = settings.ffbInvert;
}

els.connect.addEventListener('click', async () => {
  try {
    const devices = await navigator.hid.requestDevice({ filters: [] });
    if (!devices.length) return;
    await addDevice(devices[0]);
  } catch (error) {
    setStatus(`Connect failed: ${error?.message || error}`, 'warn');
  }
});

els.export.addEventListener('click', copyExport);
els.download.addEventListener('click', downloadExport);

els.tabs.addEventListener('click', event => {
  const tab = event.target.closest('.tab');
  if (!tab) return;
  activeTab = tab.dataset.tab;
  if (armed) cancelCapture('Tab changed');
  renderTab();
});

els.maxRotation.addEventListener('input', () => {
  settings.maxRotation = Number(els.maxRotation.value);
  els.maxRotationValue.textContent = `${els.maxRotation.value}°`;
  const wheel = activeWheel();
  if (wheel) wheel.wheel.maxRotation = settings.maxRotation;
  saveSettings();
});

els.strength.addEventListener('input', () => {
  settings.ffbStrength = Number(els.strength.value) / 100;
  els.strengthValue.textContent = `${els.strength.value}%`;
  const wheel = activeWheel();
  if (wheel) wheel.wheel.ffbStrength = settings.ffbStrength;
  saveSettings();
});

els.invertFfb.addEventListener('change', () => {
  settings.ffbInvert = els.invertFfb.checked;
  const wheel = activeWheel();
  if (wheel) wheel.wheel.ffbInvert = settings.ffbInvert;
  saveSettings();
});

els.force.addEventListener('input', () => {
  const value = Number(els.force.value) / 100;
  els.forceValue.textContent = `${els.force.value}%`;
  const wheel = activeWheel();
  if (wheel?.wheel?.ffb) wheel.wheel.ffb.constantFast(value).catch(error => setStatus(String(error?.message || error), 'warn'));
});

els.stopFfb.addEventListener('click', () => {
  const wheel = activeWheel();
  els.force.value = 0;
  els.forceValue.textContent = '0%';
  if (wheel?.wheel?.ffb) wheel.wheel.ffb.stop().catch(error => setStatus(String(error?.message || error), 'warn'));
});

navigator.hid?.addEventListener('disconnect', event => {
  const session = sessions.find(item => item.device === event.device);
  if (session) handleDeviceDisconnect(session);
});

window.addEventListener('beforeunload', () => {
  const wheel = activeWheel();
  if (wheel?.wheel?.ffb) wheel.wheel.ffb.stop().catch(() => {});
});

(async () => {
  renderAll();
  await restoreSavedDevices();
  if (!sessions.length) setStatus('No device connected');
  applyWheelSettings();
})();
