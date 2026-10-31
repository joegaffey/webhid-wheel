import { WheelManager, deviceSignature } from './src/core/index.js';
import './src/ui/index.js';

const STORAGE_KEY = 'webhid-wheel:v3:profiles';
const DISMISSED_KEY = 'webhid-wheel:dismissed:v1';
const manager = new WheelManager();
const dismissed = new Set(loadDismissed());

const els = {
  panel: document.querySelector('#configPanel'),
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
  exportText: document.querySelector('#exportText'),
  recordInputs: document.querySelector('#recordInputs'),
  stopRecording: document.querySelector('#stopRecording'),
  recordStatus: document.querySelector('#recordStatus')
};

els.panel.manager = manager;
els.panel.storageKey = STORAGE_KEY;

let inputQueued = false;
let selectedSessionId = null;
let lastReports = new Map();
let recording = null;
let recordingRunning = false;
let recordingEvents = 0;
let recordingTimer = null;

function escapeHtml(value) {
  return String(value == null ? '' : value).replace(/[&<>"']/g, ch => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[ch]));
}

function hex(value, width = 4) {
  if (value === undefined || value === null) return '----';
  return value.toString(16).padStart(width, '0');
}

function loadDismissed() {
  try {
    const value = JSON.parse(localStorage.getItem(DISMISSED_KEY) || '[]');
    return Array.isArray(value) ? value.filter(item => typeof item === 'string') : [];
  } catch {
    return [];
  }
}

function saveDismissed() {
  try {
    localStorage.setItem(DISMISSED_KEY, JSON.stringify([...dismissed]));
  } catch {
    // Storage may be unavailable in private or embedded contexts.
  }
}

function sessionSignature(entry) {
  if (!entry) return null;
  if (entry.hardware && entry.hardware.signature) return entry.hardware.signature;
  if (entry.device) {
    try { return deviceSignature(entry.device); } catch { return null; }
  }
  return null;
}

function dismissHardware(hardware) {
  if (!hardware || !hardware.signature) return;
  dismissed.add(hardware.signature);
  saveDismissed();
}

function undismissSession(entry) {
  const signature = sessionSignature(entry);
  if (!signature || !dismissed.has(signature)) return;
  dismissed.delete(signature);
  saveDismissed();
}

function looksLikeInput(device) {
  return (device && device.collections || []).some(collection =>
    (collection.inputReports || []).length > 0 ||
    (collection.outputReports || []).length > 0 ||
    (collection.featureReports || []).length > 0
  );
}

function sessionForDevice(device) {
  return manager.sessionList.find(entry =>
    entry.device === device ||
    (entry.interfaces || []).includes(device)
  ) || null;
}

function loadProfileStore() {
  try {
    return els.panel.profiles ? els.panel.profiles.loadStore() : null;
  } catch {
    return null;
  }
}

async function restoreGrantedDevices() {
  const hid = typeof navigator !== 'undefined' ? navigator.hid : null;
  if (!hid || typeof hid.getDevices !== 'function') return;
  let devices;
  try {
    devices = (await hid.getDevices()).filter(looksLikeInput);
  } catch (error) {
    console.warn('Could not restore granted devices:', error);
    return;
  }
  for (const device of devices) {
    try {
      if (!device.signature) device.signature = deviceSignature(device);
    } catch { /* ignore */ }
  }
  const store = loadProfileStore();
  const active = store && store.activeProfile
    ? store.profiles.find(profile => profile.profileName === store.activeProfile)
    : null;
  if (active) {
    try {
      const result = els.panel.profiles.match(active, devices);
      devices = Object.values(result.matches);
    } catch {
      devices = [];
    }
  }
  for (const device of devices) {
    if (sessionForDevice(device)) continue;
    let signature = device.signature || null;
    try {
      if (!signature) signature = deviceSignature(device);
    } catch { /* ignore */ }
    if (signature && dismissed.has(signature)) continue;
    try {
      await manager.connect(device);
    } catch {
      // Granted devices can disappear between enumeration and open.
    }
  }
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
  const steering = Number(manager.channels.steering) || 0;
  const maxRotation = manager.getCalibration().maxRotation || 900;
  const rotation = steering * maxRotation / 2;
  els.rim.setAttribute('transform', `rotate(${rotation + 180} 150 150)`);
  els.steerArc.setAttribute('d', arcPath(150, 150, 86, rotation));
  els.steerArc.style.opacity = Math.abs(rotation) < 0.5 ? '0' : '1';
  els.angleReadout.textContent = `${rotation >= 0 ? '+' : ''}${Math.round(rotation)}°`;

  const calibration = manager.getCalibration();
  const source = manager.sessions.get(calibration.device);
  const ffb = manager.getFfb();
  const target = manager.sessions.get(ffb.device);
  if (source && source.session && source.session.isConnected) {
    els.wheelHint.textContent = `${source.name} · steering source`;
  } else {
    els.wheelHint.textContent = 'Select a steering source in the panel.';
  }
  if (target && target.session && target.session.isConnected && target.capabilities.ffb) {
    els.ffbHint.textContent = `${target.name} · force output`;
    els.applyForce.disabled = false;
  } else {
    els.ffbHint.textContent = 'Add a force-feedback device and select a force output.';
    els.applyForce.disabled = true;
  }
}

function reportMap(entry) {
  const instance = entry.session;
  if (!instance) return {};
  if (entry.driver === 'wheel' && instance.deviceState && instance.deviceState.reports) {
    return instance.deviceState.reports;
  }
  return instance.state && instance.state.reports ? instance.state.reports : {};
}

function updateDebug() {
  let entry = selectedSessionId ? manager.sessions.get(selectedSessionId) : null;
  if (!entry || !entry.session || !entry.session.isConnected) {
    entry = manager.sessionList.find(item => item.session && item.session.isConnected) || null;
    selectedSessionId = entry ? entry.id : null;
  }
  if (!entry) {
    els.debug.innerHTML = '<div class="dbg-empty">No device selected</div>';
    return;
  }
  const reports = reportMap(entry);
  if (!Object.keys(reports).length) {
    els.debug.innerHTML = `<div class="dbg-empty">No input reports yet for ${escapeHtml(entry.name)}</div>`;
    return;
  }
  const parts = [];
  for (const [reportId, bytes] of Object.entries(reports)) {
    const key = `${entry.id}:${reportId}`;
    const previous = lastReports.get(key);
    const cells = (bytes || []).map((byte, index) => {
      const changed = !previous || previous[index] !== byte;
      return `<span class="dbg-byte${changed ? ' chg' : ''}">${byte.toString(16).padStart(2, '0')}</span>`;
    }).join('');
    parts.push(`<div class="dbg-head">${escapeHtml(entry.name)} · report 0x${Number(reportId).toString(16)}</div><div class="dbg-grid">${cells}</div>`);
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

function recordInput(state) {
  const id = state && state.sessionId;
  if (!recordingRunning || !id) return;
  const entry = manager.sessions.get(id);
  if (!entry) return;
  const inputState = entry.driver === 'wheel'
    ? (entry.session.deviceState || entry.session.state)
    : entry.session.state;
  const reportId = inputState && inputState.reportId;
  const reports = inputState && inputState.reports;
  const bytes = reports && reportId !== null && reportId !== undefined ? reports[reportId] : null;
  if (!Array.isArray(bytes)) return;
  const device = recording.devices[id] || (recording.devices[id] = {
    name: entry.name,
    driver: entry.driver,
    vendorId: entry.device ? entry.device.vendorId : null,
    productId: entry.device ? entry.device.productId : null,
    productName: entry.device ? entry.device.productName : null,
    signature: entry.hardware ? entry.hardware.signature : null,
    reports: {}
  });
  const key = String(reportId);
  const report = device.reports[key] || (device.reports[key] = {
    reportId,
    bytes: bytes.length,
    events: 0,
    min: new Array(bytes.length).fill(255),
    max: new Array(bytes.length).fill(0),
    last: []
  });
  report.events++;
  recordingEvents++;
  for (let i = 0; i < bytes.length; i += 1) {
    const value = bytes[i];
    if (value < report.min[i]) report.min[i] = value;
    if (value > report.max[i]) report.max[i] = value;
    report.last[i] = value;
  }
}

function updateRecordingStatus(done = false) {
  if (!els.recordStatus) return;
  if (!recording) {
    els.recordStatus.textContent = '';
    return;
  }
  const devices = Object.keys(recording.devices).length;
  const deviceLabel = devices === 1 ? 'device' : 'devices';
  const eventLabel = recordingEvents === 1 ? 'event' : 'events';
  els.recordStatus.textContent = done
    ? `Recorded ${recordingEvents} ${eventLabel} from ${devices} ${deviceLabel}.`
    : `Recording… ${recordingEvents} ${eventLabel} from ${devices} ${deviceLabel}.`;
}

function startRecording() {
  if (recordingRunning) return;
  recording = {
    startedAt: new Date().toISOString(),
    stoppedAt: null,
    devices: {}
  };
  recordingRunning = true;
  recordingEvents = 0;
  els.recordInputs.disabled = true;
  els.stopRecording.classList.remove('hidden');
  manager.on('input', recordInput);
  recordingTimer = setInterval(() => updateRecordingStatus(), 250);
  updateRecordingStatus();
}

function stopRecording() {
  if (!recordingRunning) return;
  recordingRunning = false;
  manager.off('input', recordInput);
  if (recordingTimer) {
    clearInterval(recordingTimer);
    recordingTimer = null;
  }
  if (recording) recording.stoppedAt = new Date().toISOString();
  els.recordInputs.disabled = false;
  els.stopRecording.classList.add('hidden');
  updateRecordingStatus(true);
}

function buildExport() {
  const store = loadProfileStore();
  return {
    kind: 'webhid-device-capture',
    schemaVersion: 3,
    generatedAt: new Date().toISOString(),
    userAgent: navigator.userAgent,
    devices: manager.sessionList
      .filter(entry => entry.session && entry.session.isConnected)
      .map(entry => ({
        id: entry.id,
        name: entry.name,
        driver: entry.driver,
        capabilities: entry.capabilities,
        vendorId: entry.device ? entry.device.vendorId : null,
        productId: entry.device ? entry.device.productId : null,
        productName: entry.device ? entry.device.productName : null,
        signature: entry.hardware ? entry.hardware.signature : null,
        ffb: !!entry.capabilities.ffb,
        collections: serializeCollections(entry.device),
        state: entry.session ? entry.session.state : null,
        genericState: entry.driver === 'wheel' && entry.session ? entry.session.deviceState : null,
        reports: reportMap(entry)
      })),
    profiles: store,
    mapping: manager.getMapping(),
    recording: recording ? {
      startedAt: recording.startedAt,
      stoppedAt: recording.stoppedAt,
      events: recordingEvents,
      devices: recording.devices
    } : null
  };
}

async function copyExport() {
  const json = JSON.stringify(buildExport(), null, 2);
  els.exportText.value = json;
  els.exportOutput.classList.remove('hidden');
  try {
    await navigator.clipboard.writeText(json);
  } catch (error) {
    console.warn('Copy failed; select the JSON box and copy manually.', error);
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
}

els.panel.addEventListener('webhid-copy', copyExport);
els.panel.addEventListener('webhid-export', downloadExport);
els.recordInputs.addEventListener('click', startRecording);
els.stopRecording.addEventListener('click', stopRecording);
els.panel.addEventListener('webhid-select', (event) => {
  selectedSessionId = event.detail && event.detail.session ? event.detail.session.id : null;
  updateDebug();
});

els.force.addEventListener('input', () => {
  els.forceValue.textContent = `${els.force.value}%`;
});

els.applyForce.addEventListener('click', async () => {
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
manager.on('connect', ({ session }) => {
  undismissSession(session);
  els.panel.refresh();
  scheduleInputUpdate();
});
manager.on('disconnect', () => {
  els.panel.refresh();
  scheduleInputUpdate();
});
manager.on('error', (error) => {
  console.warn('Wheel manager error:', error);
});
manager.on('setup-applied', () => {
  els.panel.refresh();
  scheduleInputUpdate();
});
els.panel.addEventListener('webhid-error', (event) => {
  const error = event.detail && event.detail.error;
  console.warn('Wheel UI error:', error || 'Unknown error');
});
els.panel.addEventListener('webhid-remove-device', (event) => {
  dismissHardware(event.detail && event.detail.hardware);
});

if (navigator.hid && typeof navigator.hid.addEventListener === 'function') {
  navigator.hid.addEventListener('connect', () => {
    setTimeout(restoreGrantedDevices, 50);
  });
  navigator.hid.addEventListener('disconnect', () => {
    els.panel.refresh();
    scheduleInputUpdate();
  });
}

updateWheelVisual();
setTimeout(restoreGrantedDevices, 0);
