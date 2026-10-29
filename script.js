import { isForceFeedbackWheel, WheelManager } from './src/core/index.js';
import './src/ui/index.js';

const STORAGE_KEY = 'webhid-wheel:v2:profiles';
const manager = new WheelManager({ maxRotation: 900, ffbStrength: 0.25 });

const els = {
  panel: document.querySelector('#configPanel'),
  connectWheel: document.querySelector('#connectWheelButton'),
  connectDevice: document.querySelector('#connectDeviceButton'),
  disconnectAll: document.querySelector('#disconnectAllButton'),
  export: document.querySelector('#exportButton'),
  download: document.querySelector('#downloadButton'),
  status: document.querySelector('#statusText'),
  deviceList: document.querySelector('#deviceList'),
  deviceHint: document.querySelector('#deviceHint'),
  force: document.querySelector('#force'),
  forceValue: document.querySelector('#forceValue'),
  applyForce: document.querySelector('#applyForce'),
  stopFfb: document.querySelector('#stopFfb'),
  ffbHint: document.querySelector('#ffbHint'),
  rim: document.querySelector('#rim'),
  steerArc: document.querySelector('#steerArc'),
  angleReadout: document.querySelector('#angleReadout'),
  wheelHint: document.querySelector('#wheelHint'),
  debug: document.querySelector('#debug'),
  exportOutput: document.querySelector('#exportOutput'),
  exportText: document.querySelector('#exportText')
};

els.panel.manager = manager;
els.panel.storageKey = STORAGE_KEY;

let nextDevice = 2;
let inputQueued = false;
let lastReports = new Map();

function setStatus(text, tone = '') {
  els.status.textContent = text;
  els.status.className = tone;
}

function escapeHtml(value) {
  return String(value == null ? '' : value).replace(/[&<>"']/g, ch => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[ch]));
}

function hex(value, width = 4) {
  if (value === undefined || value === null) return '----';
  return value.toString(16).padStart(width, '0');
}

function slug(value) {
  return String(value || 'device').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'device';
}

function nextRoleFor(device) {
  const base = slug(device && device.productName);
  let role = base;
  let suffix = 2;
  while (manager.sessions.has(role) || role === 'wheel') {
    role = `${base}-${suffix++}`;
  }
  return role;
}

function roleForConnection(prefix) {
  let role = `${prefix}${nextDevice++}`;
  while (manager.sessions.has(role) || role === 'wheel') role = `${prefix}${nextDevice++}`;
  return role;
}

function looksLikeInput(device) {
  return (device && device.collections || []).some(collection =>
    (collection.usagePage === 0x01 && [0x04, 0x05, 0x08].includes(collection.usage)) ||
    collection.usagePage === 0x02
  );
}

function sessionForDevice(device) {
  for (const entry of manager.sessions.values()) {
    if (entry.session && entry.session.device === device) return entry;
  }
  return null;
}

async function connectWheel() {
  els.connectWheel.disabled = true;
  try {
    const device = await manager.connectWheel();
    if (device) setStatus(`Connected ${device.productName || 'wheel'}.`, 'ok');
  } catch (error) {
    setStatus(error instanceof Error ? error.message : String(error), 'warn');
  } finally {
    els.connectWheel.disabled = false;
    renderDevices();
  }
}

async function connectAdditional() {
  els.connectDevice.disabled = true;
  try {
    const role = roleForConnection('device');
    const device = await manager.addDevice(role);
    if (device) setStatus(`Connected ${role}.`, 'ok');
  } catch (error) {
    setStatus(error instanceof Error ? error.message : String(error), 'warn');
  } finally {
    els.connectDevice.disabled = false;
    renderDevices();
  }
}

async function restoreGrantedDevices() {
  const hid = typeof navigator !== 'undefined' ? navigator.hid : null;
  if (!hid || typeof hid.getDevices !== 'function') return;
  let devices;
  try {
    devices = (await hid.getDevices()).filter(looksLikeInput);
  } catch (error) {
    setStatus(`Could not restore granted devices: ${error.message}`, 'warn');
    return;
  }
  if (!devices.length) return;

  const store = safeLoadStore();
  const active = store && store.activeProfile
    ? store.profiles.find(profile => profile.profileName === store.activeProfile)
    : null;

  let wheelDevice = null;
  if (active) {
    wheelDevice = devices.find(device =>
      device.vendorId === active.hardware.vendorId &&
      device.productId === active.hardware.productId
    ) || null;
  }
  if (!wheelDevice) {
    wheelDevice = devices.find(device => isForceFeedbackWheel(device)) ||
      devices.find(device => /wheel|racing|force|thrustmaster|logitech|fanatec/i.test(device.productName || '')) ||
      null;
  }

  if (wheelDevice) {
    try {
      await manager.connectWheel(wheelDevice);
      setStatus(`Restored ${wheelDevice.productName || 'wheel'}.`, 'ok');
    } catch (error) {
      setStatus(`Could not restore wheel: ${error.message}`, 'warn');
    }
  }

  for (const device of devices) {
    if (device === wheelDevice || sessionForDevice(device)) continue;
    try {
      await manager.addDevice(nextRoleFor(device), device);
    } catch {
      // Granted devices can disappear between enumeration and open.
    }
  }
  renderDevices();
}

function safeLoadStore() {
  try {
    return els.panel.profiles ? els.panel.profiles.loadStore() : null;
  } catch {
    return null;
  }
}

function renderDevices() {
  const items = [];
  for (const [role, entry] of manager.sessions) {
    const session = entry.session;
    const connected = !!(session && session.isConnected);
    const device = session && session.device;
    const ffb = connected && device ? isForceFeedbackWheel(device) : false;
    const name = (session && session.name) || 'Not connected';
    items.push(`
      <div class="device-card">
        <div>
          <div class="device-name">${escapeHtml(name)}</div>
          <div class="device-meta">${escapeHtml(role)} · ${device ? `0x${hex(device.vendorId)}:0x${hex(device.productId)}` : 'no device'}</div>
        </div>
        <div class="device-badges">
          <span class="badge ${connected ? (ffb ? 'ffb' : '') : 'off'}">${connected ? (ffb ? 'FFB' : 'input') : 'offline'}</span>
          <button class="device-remove" type="button" data-role="${escapeHtml(role)}">Remove</button>
        </div>
      </div>
    `);
  }
  els.deviceList.innerHTML = items.length ? items.join('') : '<p class="hint">No devices connected yet.</p>';
  for (const button of els.deviceList.querySelectorAll('[data-role]')) {
    button.addEventListener('click', async () => {
      await manager.disconnect(button.dataset.role);
      renderDevices();
    });
  }
  const hasSessions = manager.sessions.size > 0;
  els.export.disabled = !hasSessions;
  els.download.disabled = !hasSessions;
  els.disconnectAll.disabled = !hasSessions;
  els.deviceHint.textContent = hasSessions
    ? 'Connect another device to map pedals, button boxes or handbrakes.'
    : 'Connect a wheel or an additional pedal/button device. Each Connect adds one device.';
}

function polar(cx, cy, r, degrees) {
  const radians = (degrees - 90) * Math.PI / 180;
  return [cx + r * Math.cos(radians), cy + r * Math.sin(radians)];
}

function arcPath(cx, cy, r, degrees) {
  const start = polar(cx, cy, r, 0);
  const end = polar(cx, cy, r, Math.max(-360, Math.min(360, degrees)));
  const large = Math.abs(degrees) > 180 ? 1 : 0;
  const sweep = degrees >= 0 ? 1 : 0;
  return `M ${start[0]} ${start[1]} A ${r} ${r} 0 ${large} ${sweep} ${end[0]} ${end[1]}`;
}

function scheduleInputUpdate() {
  if (inputQueued) return;
  inputQueued = true;
  requestAnimationFrame(() => {
    inputQueued = false;
    updateWheelVisual();
    updateDebug();
  });
}

function updateWheelVisual() {
  const wheel = manager.state.wheel;
  const rotation = wheel && Number.isFinite(wheel.rotation) ? wheel.rotation : 0;
  els.rim.setAttribute('transform', `rotate(${rotation + 180} 150 150)`);
  els.steerArc.setAttribute('d', arcPath(150, 150, 86, rotation));
  els.steerArc.style.opacity = Math.abs(rotation) < 0.5 ? '0' : '1';
  els.angleReadout.textContent = `${rotation >= 0 ? '+' : ''}${Math.round(rotation)}°`;

  const session = manager.wheel;
  if (session && session.isConnected) {
    const ffb = session.ffbCaps && session.ffbCaps.constant;
    els.wheelHint.textContent = `${session.name || 'Wheel'} · ${ffb ? 'constant force feedback' : 'input only'}`;
    els.ffbHint.textContent = ffb ? 'Apply a low test force first.' : 'This device does not report constant force support.';
    els.applyForce.disabled = !ffb;
  } else {
    els.wheelHint.textContent = 'Select a wheel from the panel above.';
    els.ffbHint.textContent = 'Connect a force-feedback wheel to test output.';
    els.applyForce.disabled = true;
  }
}

function sessionReports(session, role) {
  if (role === 'wheel' && session.deviceState && session.deviceState.reports) {
    return session.deviceState.reports;
  }
  const state = session.state;
  return state && state.reports ? state.reports : {};
}

function updateDebug() {
  const wheelEntry = manager.sessions.get('wheel');
  if (!wheelEntry) {
    els.debug.innerHTML = '<div class="dbg-empty">No data</div>';
    return;
  }
  const reports = sessionReports(wheelEntry.session, 'wheel');
  const parts = [];
  for (const [reportId, bytes] of Object.entries(reports)) {
    const key = `wheel:${reportId}`;
    const previous = lastReports.get(key);
    const cells = (bytes || []).map((byte, index) => {
      const changed = !previous || previous[index] !== byte;
      return `<span class="dbg-byte${changed ? ' chg' : ''}">${byte.toString(16).padStart(2, '0')}</span>`;
    }).join('');
    parts.push(`<div class="dbg-head">report 0x${Number(reportId).toString(16)}</div><div class="dbg-grid">${cells}</div>`);
    lastReports.set(key, Array.from(bytes || []));
  }
  els.debug.innerHTML = parts.length ? parts.join('') : '<div class="dbg-empty">No input reports yet</div>';
}

function serializeCollections(device) {
  if (!device) return [];
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
  const reports = list => (list || []).map(report => ({ id: report.reportId, items: (report.items || []).map(item) }));
  return (device.collections || []).map(collection => ({
    usagePage: collection.usagePage,
    usage: collection.usage,
    input: reports(collection.inputReports),
    output: reports(collection.outputReports),
    feature: reports(collection.featureReports)
  }));
}

function sessionState(session, role) {
  const state = session.state || {};
  return {
    axes: state.axes || [],
    rawAxes: state.rawAxes || (session.deviceState && session.deviceState.rawAxes) || [],
    buttons: state.buttons || [],
    hats: state.hats || [],
    reports: sessionReports(session, role),
    timestamp: state.timestamp || session.timestamp || null
  };
}

function buildExport() {
  const store = safeLoadStore();
  return {
    kind: 'webhid-device-capture',
    schemaVersion: 2,
    generatedAt: new Date().toISOString(),
    userAgent: navigator.userAgent,
    devices: Array.from(manager.sessions.entries()).map(([role, entry]) => {
      const session = entry.session;
      const device = session.device;
      return {
        role,
        vendorId: device ? device.vendorId : null,
        productId: device ? device.productId : null,
        productName: session.name || null,
        signature: device && device.signature ? device.signature : null,
        ffb: !!(device && isForceFeedbackWheel(device)),
        collections: serializeCollections(device),
        state: sessionState(session, role)
      };
    }),
    profiles: store,
    mappings: manager.getMapping()
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

els.connectWheel.addEventListener('click', connectWheel);
els.connectDevice.addEventListener('click', connectAdditional);
els.disconnectAll.addEventListener('click', async () => {
  await manager.disconnectAll();
  renderDevices();
  setStatus('All devices disconnected.', '');
});
els.export.addEventListener('click', copyExport);
els.download.addEventListener('click', downloadExport);

els.force.addEventListener('input', () => {
  els.forceValue.textContent = `${els.force.value}%`;
});

els.applyForce.addEventListener('click', async () => {
  const wheel = manager.wheel;
  if (!wheel || !wheel.ffb || !wheel.ffbCaps || !wheel.ffbCaps.constant) {
    els.ffbHint.textContent = 'No constant force feedback available.';
    return;
  }
  try {
    await manager.constantFast(Number(els.force.value) / 100);
    els.ffbHint.textContent = 'Test force applied. Stop if the wheel pulls unexpectedly.';
  } catch (error) {
    els.ffbHint.textContent = error instanceof Error ? error.message : String(error);
  }
});

els.stopFfb.addEventListener('click', async () => {
  await manager.stop();
  els.ffbHint.textContent = 'Force feedback stopped.';
});

window.__webhidDemo = { manager, panel: els.panel };

manager.on('input', scheduleInputUpdate);
manager.on('connect', () => {
  renderDevices();
  els.panel.refresh();
  scheduleInputUpdate();
});
manager.on('disconnect', () => {
  renderDevices();
  els.panel.refresh();
  scheduleInputUpdate();
});
manager.on('error', (error) => {
  setStatus(error instanceof Error ? error.message : String(error), 'warn');
});
manager.on('setup-applied', () => {
  els.panel.refresh();
  scheduleInputUpdate();
});
els.panel.addEventListener('webhid-error', (event) => {
  const error = event.detail && event.detail.error;
  setStatus(error instanceof Error ? error.message : String(error || 'Unknown error'), 'warn');
});

if (navigator.hid && typeof navigator.hid.addEventListener === 'function') {
  navigator.hid.addEventListener('connect', () => {
    setTimeout(restoreGrantedDevices, 50);
  });
  navigator.hid.addEventListener('disconnect', () => {
    renderDevices();
    els.panel.refresh();
    scheduleInputUpdate();
  });
}

renderDevices();
updateWheelVisual();
setTimeout(restoreGrantedDevices, 0);
