import {
  LogitechTestDriver,
  LOGITECH_TEST_DRIVER_VERSION
} from './src/core/logitech-test-driver.js';

const $ = id => document.getElementById(id);
const logEl = $('log');
const stateText = $('stateText');
const statsEl = $('stats');
const interfacesEl = $('interfaces');
const statusEl = $('status');
const tooltipEl = $('tooltip');
let tooltipTarget = null;

function positionTooltip() {
  if (!tooltipTarget) return;
  const rect = tooltipTarget.getBoundingClientRect();
  const tip = tooltipEl.getBoundingClientRect();
  let left = rect.left + rect.width / 2 - tip.width / 2;
  let top = rect.bottom + 8;
  if (top + tip.height > window.innerHeight - 8) top = rect.top - tip.height - 8;
  left = Math.max(8, Math.min(window.innerWidth - tip.width - 8, left));
  top = Math.max(8, top);
  tooltipEl.style.left = `${left}px`;
  tooltipEl.style.top = `${top}px`;
}

function helpTargetFor(node) {
  if (!node || !node.closest) return null;
  const explicit = node.closest('[data-help]');
  if (explicit) return explicit;
  const label = node.closest('label');
  if (label && label.control && label.control.hasAttribute('data-help')) return label.control;
  return null;
}

function showTooltip(target) {
  const text = target && target.getAttribute('data-help');
  if (!text) return;
  if (tooltipTarget && tooltipTarget !== target) tooltipTarget.removeAttribute('aria-describedby');
  tooltipTarget = target;
  tooltipEl.textContent = text;
  tooltipEl.classList.add('show');
  target.setAttribute('aria-describedby', 'tooltip');
  positionTooltip();
}

function hideTooltip() {
  if (!tooltipTarget) return;
  tooltipTarget.removeAttribute('aria-describedby');
  tooltipTarget = null;
  tooltipEl.classList.remove('show');
}

document.addEventListener('pointerover', event => {
  const target = helpTargetFor(event.target);
  if (target) showTooltip(target);
  else hideTooltip();
});

document.addEventListener('pointerout', event => {
  if (!tooltipTarget) return;
  const target = helpTargetFor(event.target);
  if (!target || target !== tooltipTarget) return;
  const next = event.relatedTarget;
  if (next && tooltipTarget.contains(next)) return;
  hideTooltip();
});

document.addEventListener('focusin', event => {
  const target = helpTargetFor(event.target);
  if (target) showTooltip(target);
});

document.addEventListener('focusout', event => {
  const target = helpTargetFor(event.target);
  if (target && target === tooltipTarget) hideTooltip();
});

window.addEventListener('scroll', () => {
  if (tooltipTarget) positionTooltip();
}, true);
window.addEventListener('resize', () => {
  if (tooltipTarget) positionTooltip();
});

const checkboxIds = [
  'invert',
  'modulate',
  'autostartAllocate',
  'autostartUpdate',
  'autostartResume',
  'playAfterAllocate',
  'playAfterUpdate',
  'playAfterResume',
  'recreateOnResume',
  'destroyOnStop',
  'disableAutocenter',
  'resetAll',
  'protocolVersion',
  'setAperture'
];

let streamTimer = null;
let streamStartedAt = 0;
let streamDeadline = 0;
let streamSkipped = 0;
let streamSent = 0;
let lastState = null;
let requestPending = false;

$('driverVersion').textContent = LOGITECH_TEST_DRIVER_VERSION;

function logEntry(entry) {
  const row = document.createElement('div');
  row.className = `entry ${entry.dir}`;
  const prefix = entry.dir === 'tx' ? '→' : entry.dir === 'rx' ? '←' : entry.dir === 'error' ? '!' : '·';
  row.textContent = `${entry.time} ${prefix} ${entry.label}${entry.hex ? ` :: ${entry.hex}` : ''}${entry.text ? ` ${entry.text}` : ''}`;
  logEl.appendChild(row);
  while (logEl.children.length > 400) logEl.removeChild(logEl.firstChild);
  logEl.scrollTop = logEl.scrollHeight;
}

function readConfig() {
  return {
    strength: Number($('strength').value),
    forceSign: $('invert').checked ? -1 : 1,
    autostartAllocate: $('autostartAllocate').checked,
    autostartUpdate: $('autostartUpdate').checked,
    autostartResume: $('autostartResume').checked,
    playAfterAllocate: $('playAfterAllocate').checked,
    playAfterUpdate: $('playAfterUpdate').checked,
    playAfterResume: $('playAfterResume').checked,
    recreateOnResume: $('recreateOnResume').checked,
    destroyOnStop: $('destroyOnStop').checked,
    disableAutocenter: $('disableAutocenter').checked,
    resetAll: $('resetAll').checked,
    protocolVersion: $('protocolVersion').checked,
    setAperture: $('setAperture').checked,
    aperture: Number($('aperture').value)
  };
}

function applyConfigToDriver() {
  if (driver) driver.configure(readConfig());
}

function syncControlsFromConfig(config) {
  $('strength').value = String(config.strength);
  $('strengthValue').textContent = Number(config.strength).toFixed(2);
  $('invert').checked = config.forceSign < 0;
  $('autostartAllocate').checked = config.autostartAllocate;
  $('autostartUpdate').checked = config.autostartUpdate;
  $('autostartResume').checked = config.autostartResume;
  $('playAfterAllocate').checked = config.playAfterAllocate;
  $('playAfterUpdate').checked = config.playAfterUpdate;
  $('playAfterResume').checked = config.playAfterResume;
  $('recreateOnResume').checked = config.recreateOnResume;
  $('destroyOnStop').checked = config.destroyOnStop;
  $('disableAutocenter').checked = config.disableAutocenter;
  $('resetAll').checked = config.resetAll;
  $('protocolVersion').checked = config.protocolVersion;
  $('setAperture').checked = config.setAperture;
  if (config.aperture) $('aperture').value = String(config.aperture);
}

function renderState(state) {
  lastState = state;
  const playing = state.playing ? 'playing' : 'stopped';
  const connected = state.connected ? 'connected' : 'not connected';
  const initialized = state.initialized ? 'initialized' : 'not initialized';
  statusEl.innerHTML = [
    `<span class="pill ${state.connected ? 'ok' : ''}">${connected}</span>`,
    `<span class="pill ${state.initialized ? 'ok' : 'warn'}">${initialized}</span>`,
    `<span class="pill ${state.playing ? 'ok' : ''}">${playing}</span>`,
    `<span class="pill ${state.protocolVersion ? 'ok' : ''}">HID++ ${state.protocolVersion ? `${state.protocolVersion.major}.${state.protocolVersion.minor}` : '—'}</span>`,
    `<span class="pill ${state.errors ? 'bad' : ''}">${state.errors} errors</span>`
  ].join('');

  interfacesEl.innerHTML = state.interfaces.map(item => {
    const collections = item.collections.map(collection =>
      `${collection.usagePage.toString(16)}:${collection.usage.toString(16)} ` +
      `in[${collection.input.join(',')}] out[${collection.output.join(',')}]`
    ).join(' · ');
    return `<div class="iface"><b>${item.name || 'HID interface'}</b> <span>${item.opened ? 'open' : 'closed'} · ${collections}</span></div>`;
  }).join('');

  const values = [
    ['feature', state.featureIndex ? `0x${state.featureIndex.toString(16)}` : '—'],
    ['slots', state.slotCount || '—'],
    ['autocenter', state.autocenterSlot || '—'],
    ['slot', state.slot || '—'],
    ['playing', state.playing ? 'yes' : 'no'],
    ['level', state.lastLevel],
    ['queued', driver?.transport?.queue?.length ?? 0],
    ['stream sent', streamSent],
    ['stream skipped', streamSkipped],
    ['tx', state.sent],
    ['rx', state.received],
    ['errors', state.errors]
  ];
  statsEl.innerHTML = values.map(([label, value]) =>
    `<div class="stat"><b>${label}</b><span>${value}</span></div>`
  ).join('');

  stateText.value = JSON.stringify({
    ...state,
    stream: {
      startedAt: streamStartedAt || null,
      deadline: streamDeadline || null,
      sent: streamSent,
      skipped: streamSkipped,
      active: streamTimer !== null
    }
  }, null, 2);

  const isConnected = state.connected;
  $('connect').disabled = isConnected || requestPending;
  $('initialize').disabled = !isConnected;
  $('disconnect').disabled = !isConnected;
  $('allocate').disabled = !state.initialized;
  $('single').disabled = !state.initialized;
  $('start').disabled = !state.initialized || streamTimer !== null;
  $('stopStream').disabled = streamTimer === null;
  $('stop').disabled = !state.initialized;
  $('resume').disabled = !state.initialized;
  $('destroy').disabled = !state.initialized;
  $('reset').disabled = !state.initialized;
  $('readAperture').disabled = !state.initialized;
  $('applyAperture').disabled = !state.initialized;
}

function renderLog(entry) {
  logEntry(entry);
}

const driver = new LogitechTestDriver({
  onLog: renderLog,
  onState: renderState
});

function forceValue() {
  return Number($('force').value);
}

function updateForceLabel() {
  $('forceValue').textContent = forceValue().toFixed(2);
}

$('force').addEventListener('input', updateForceLabel);
$('strength').addEventListener('input', () => {
  $('strengthValue').textContent = Number($('strength').value).toFixed(2);
  applyConfigToDriver();
});

for (const id of checkboxIds) {
  $(id).addEventListener('change', applyConfigToDriver);
}

$('aperture').addEventListener('change', applyConfigToDriver);
$('rate').addEventListener('change', () => {
  if (streamTimer !== null) {
    stopStream(true);
    startStream();
  }
});

$('connect').addEventListener('click', async () => {
  if (requestPending) return;
  requestPending = true;
  renderState(driver.getState());
  try {
    const devices = await navigator.hid.requestDevice({ filters: [{ vendorId: 0x046d }] });
    if (!devices.length) return;
    await driver.connect(devices);
    applyConfigToDriver();
    await driver.initialize();
  } catch (error) {
    logEntry({ time: new Date().toISOString().slice(11, 23), dir: 'error', label: 'connect', text: String(error) });
    renderState(driver.getState());
  } finally {
    requestPending = false;
    renderState(driver.getState());
  }
});

$('initialize').addEventListener('click', async () => {
  try {
    applyConfigToDriver();
    await driver.initialize();
  } catch (error) {
    logEntry({ time: new Date().toISOString().slice(11, 23), dir: 'error', label: 'initialize', text: String(error) });
  }
});

$('disconnect').addEventListener('click', async () => {
  stopStream(true);
  await driver.disconnect();
});

$('allocate').addEventListener('click', async () => {
  try {
    applyConfigToDriver();
    await driver.allocate(forceValue());
  } catch (error) {
    logEntry({ time: new Date().toISOString().slice(11, 23), dir: 'error', label: 'allocate', text: String(error) });
  }
});

$('single').addEventListener('click', async () => {
  try {
    applyConfigToDriver();
    if (!driver.slot) await driver.allocate(forceValue());
    else await driver.setForce(forceValue());
  } catch (error) {
    logEntry({ time: new Date().toISOString().slice(11, 23), dir: 'error', label: 'single', text: String(error) });
  }
});

function nextStreamValue(now) {
  const base = forceValue();
  if (!$('modulate').checked) return base;
  const t = (now - streamStartedAt) / 1000;
  return Math.max(-1, Math.min(1, base + Math.sin(t * Math.PI * 2 * 0.5) * 0.15));
}

function streamTick() {
  const now = performance.now();
  if (now >= streamDeadline) {
    logEntry({ time: new Date().toISOString().slice(11, 23), dir: 'info', label: 'stream', text: '10 s safety limit reached' });
    stopStream(true);
    return;
  }
  const transport = driver.transport;
  if (transport && (transport.pending || transport.queue.length > 2)) {
    streamSkipped += 1;
    return;
  }
  const value = nextStreamValue(now);
  streamSent += 1;
  void driver.setForce(value).catch(error => {
    logEntry({ time: new Date().toISOString().slice(11, 23), dir: 'error', label: 'stream force', text: String(error) });
    stopStream(true);
  });
}

function startStream() {
  if (!driver.initialized) return;
  applyConfigToDriver();
  const interval = Math.max(4, Number($('rate').value) || 30);
  streamStartedAt = performance.now();
  streamDeadline = streamStartedAt + 10000;
  streamSkipped = 0;
  streamSent = 0;
  $('streamStatus').textContent = `Streaming every ${interval} ms. Safety stop after 10 s.`;
  streamTimer = window.setInterval(streamTick, interval);
  renderState(driver.getState());
}

function stopStream(stopEffect = false) {
  if (streamTimer !== null) {
    window.clearInterval(streamTimer);
    streamTimer = null;
  }
  $('streamStatus').textContent = 'Stream idle.';
  if (stopEffect && driver.initialized) {
    void driver.stop().catch(error => {
      logEntry({ time: new Date().toISOString().slice(11, 23), dir: 'error', label: 'stop', text: String(error) });
    });
  }
  renderState(driver.getState());
}

$('start').addEventListener('click', () => {
  if (streamTimer === null) startStream();
});

$('stopStream').addEventListener('click', () => stopStream(true));

$('stop').addEventListener('click', async () => {
  try {
    await driver.stop();
  } catch (error) {
    logEntry({ time: new Date().toISOString().slice(11, 23), dir: 'error', label: 'stop', text: String(error) });
  }
});

$('resume').addEventListener('click', async () => {
  try {
    applyConfigToDriver();
    await driver.resume(forceValue());
  } catch (error) {
    logEntry({ time: new Date().toISOString().slice(11, 23), dir: 'error', label: 'resume', text: String(error) });
  }
});

$('destroy').addEventListener('click', async () => {
  try {
    await driver.destroySlot();
  } catch (error) {
    logEntry({ time: new Date().toISOString().slice(11, 23), dir: 'error', label: 'destroy', text: String(error) });
  }
});

$('reset').addEventListener('click', async () => {
  try {
    await driver.resetAll();
  } catch (error) {
    logEntry({ time: new Date().toISOString().slice(11, 23), dir: 'error', label: 'reset', text: String(error) });
  }
});

$('readAperture').addEventListener('click', async () => {
  try {
    const degrees = await driver.getAperture();
    $('aperture').value = String(degrees);
    logEntry({ time: new Date().toISOString().slice(11, 23), dir: 'info', label: 'aperture', text: `${degrees}°` });
  } catch (error) {
    logEntry({ time: new Date().toISOString().slice(11, 23), dir: 'error', label: 'aperture', text: String(error) });
  }
});

$('applyAperture').addEventListener('click', async () => {
  try {
    const degrees = await driver.setAperture(Number($('aperture').value));
    logEntry({ time: new Date().toISOString().slice(11, 23), dir: 'info', label: 'aperture', text: `${degrees}°` });
  } catch (error) {
    logEntry({ time: new Date().toISOString().slice(11, 23), dir: 'error', label: 'aperture', text: String(error) });
  }
});

$('clearLog').addEventListener('click', () => {
  logEl.innerHTML = '';
});

$('copyLog').addEventListener('click', async () => {
  await navigator.clipboard.writeText(logEl.innerText);
});

$('copyState').addEventListener('click', async () => {
  await navigator.clipboard.writeText(stateText.value);
});

const presets = {
  single: async () => {
    syncControlsFromConfig({
      ...driver.config,
      autostartAllocate: true,
      autostartUpdate: false,
      playAfterAllocate: true,
      playAfterUpdate: false,
      forceSign: 1
    });
    $('rate').value = '30';
    $('force').value = '0.5';
    updateForceLabel();
    applyConfigToDriver();
    await driver.allocate(forceValue());
  },
  'lapster-old': async () => {
    syncControlsFromConfig({
      ...driver.config,
      autostartAllocate: true,
      autostartUpdate: true,
      playAfterAllocate: false,
      playAfterUpdate: false,
      forceSign: 1
    });
    $('rate').value = '5';
    $('force').value = '0.35';
    updateForceLabel();
    applyConfigToDriver();
    startStream();
  },
  'lapster-new': async () => {
    syncControlsFromConfig({
      ...driver.config,
      autostartAllocate: true,
      autostartUpdate: false,
      playAfterAllocate: false,
      playAfterUpdate: false,
      forceSign: 1
    });
    $('rate').value = '5';
    $('force').value = '0.35';
    updateForceLabel();
    applyConfigToDriver();
    startStream();
  },
  rs50: async () => {
    syncControlsFromConfig({
      ...driver.config,
      autostartAllocate: true,
      autostartUpdate: false,
      playAfterAllocate: false,
      playAfterUpdate: false,
      forceSign: 1
    });
    $('rate').value = '30';
    $('force').value = '0.35';
    updateForceLabel();
    applyConfigToDriver();
    startStream();
  },
  g923: async () => {
    syncControlsFromConfig({
      ...driver.config,
      autostartAllocate: true,
      autostartUpdate: true,
      playAfterAllocate: false,
      playAfterUpdate: false,
      forceSign: -1
    });
    $('rate').value = '30';
    $('force').value = '0.35';
    updateForceLabel();
    applyConfigToDriver();
    startStream();
  },
  resume: async () => {
    syncControlsFromConfig({
      ...driver.config,
      autostartAllocate: true,
      autostartUpdate: false,
      autostartResume: true,
      playAfterAllocate: true,
      playAfterUpdate: false,
      playAfterResume: true,
      forceSign: 1
    });
    $('force').value = '0.35';
    updateForceLabel();
    applyConfigToDriver();
    await driver.allocate(forceValue());
    await new Promise(resolve => setTimeout(resolve, 800));
    await driver.stop();
    await new Promise(resolve => setTimeout(resolve, 800));
    await driver.resume(forceValue());
  }
};

for (const button of document.querySelectorAll('[data-preset]')) {
  button.addEventListener('click', async () => {
    try {
      await presets[button.dataset.preset]();
    } catch (error) {
      logEntry({ time: new Date().toISOString().slice(11, 23), dir: 'error', label: button.dataset.preset, text: String(error) });
    }
  });
}

window.addEventListener('pagehide', () => {
  stopStream(true);
  if (driver.connected) void driver.disconnect();
});

document.addEventListener('visibilitychange', () => {
  if (document.hidden) stopStream(true);
});

updateForceLabel();
renderState(driver.getState());
logEntry({ time: new Date().toISOString().slice(11, 23), dir: 'info', label: 'driver', text: LOGITECH_TEST_DRIVER_VERSION });
