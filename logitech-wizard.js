import {
  LogitechTestDriver,
  LOGITECH_TEST_DRIVER_VERSION
} from './src/core/logitech-test-driver.js';

const $ = id => document.getElementById(id);
const FORCE = 0.3;
const DRIVER_VERSION = LOGITECH_TEST_DRIVER_VERSION;

const state = {
  driver: null,
  connected: false,
  initialized: false,
  connecting: false,
  stepIndex: 0,
  steps: [],
  tests: [],
  answers: {},
  notes: {},
  skipped: new Set(),
  status: {},
  errors: {},
  configs: {},
  frames: {},
  states: {},
  logs: [],
  runningTest: null,
  stopRequested: false,
  reportObject: null
};

const tests = [
  {
    id: 'basic',
    title: 'Basic pull',
    rateMs: 0,
    description: 'The wheel will pull in one direction for about 1.5 seconds. This checks that a single force command reaches the wheel.',
    config: { autostartUpdate: false, playAfterAllocate: true },
    run: async () => {
      await driver.allocate(FORCE);
      await wait(1500);
      await driver.stop();
    },
    questions: [
      { id: 'felt', label: 'Did you feel the wheel pull?', options: ['Yes', 'No', 'Not sure'] },
      { id: 'direction', label: 'Which way did it pull?', options: ['Left', 'Right', 'Not sure'] }
    ]
  },
  {
    id: 'steady',
    title: 'Steady updates',
    rateMs: 33,
    description: 'The wheel will pull for about 5 seconds while the driver sends steady updates. This is the normal RS50-style path.',
    config: { autostartUpdate: false, playAfterAllocate: false, autostartResume: true },
    run: async () => {
      await driver.allocate(FORCE);
      await stream(FORCE, 5000, 33);
    },
    questions: [
      { id: 'outcome', label: 'What happened during the 5 seconds?', options: ['Pulled for the whole test', 'Stopped before the end', 'Never pulled', 'Not sure'] }
    ]
  },
  {
    id: 'fast',
    title: 'Fast updates',
    rateMs: 5,
    description: 'The wheel will pull for about 5 seconds while updates arrive very quickly. This reproduces the old Lapster update path.',
    config: { autostartUpdate: true, playAfterAllocate: false },
    run: async () => {
      await driver.allocate(FORCE);
      await stream(FORCE, 5000, 5);
    },
    questions: [
      { id: 'outcome', label: 'What happened during the 5 seconds?', options: ['Pulled for the whole test', 'Stopped before the end', 'Never pulled', 'Not sure'] }
    ]
  },
  {
    id: 'resume',
    title: 'Stop and resume',
    rateMs: 33,
    description: 'The wheel will pull, stop for a moment, then try to start again.',
    config: {
      autostartUpdate: false,
      autostartResume: true,
      playAfterResume: true,
      recreateOnResume: false
    },
    run: async () => {
      await driver.allocate(FORCE);
      await stream(FORCE, 2000, 33);
      await wait(800);
      if (state.stopRequested) return;
      await driver.resume(FORCE);
      await stream(FORCE, 2500, 33);
    },
    questions: [
      { id: 'resumed', label: 'Did the pull come back after the pause?', options: ['Yes', 'No', 'Not sure'] }
    ]
  },
  {
    id: 'fresh',
    title: 'Fresh restart',
    rateMs: 33,
    description: 'The wheel will stop, discard the old force effect, and allocate a brand-new one. This is the fallback if resume does not work.',
    config: {
      autostartUpdate: false,
      autostartResume: true,
      playAfterResume: true,
      recreateOnResume: true
    },
    run: async () => {
      await driver.allocate(FORCE);
      await stream(FORCE, 2000, 33);
      await wait(800);
      if (state.stopRequested) return;
      await driver.resume(FORCE);
      await stream(FORCE, 2500, 33);
    },
    questions: [
      { id: 'resumed', label: 'Did the pull come back after the pause?', options: ['Yes', 'No', 'Not sure'] }
    ]
  },
  {
    id: 'directions',
    title: 'Opposite directions',
    rateMs: 0,
    description: 'The wheel will pull one way, then pull the other way. This checks the force-direction convention.',
    config: { autostartUpdate: false, playAfterAllocate: true },
    run: async () => {
      await driver.allocate(FORCE);
      await wait(1200);
      await driver.stop();
      await driver.destroySlot();
      await wait(500);
      if (state.stopRequested) return;
      await driver.allocate(-FORCE);
      await wait(1200);
      await driver.stop();
    },
    questions: [
      { id: 'opposite', label: 'Did the two pulls go in opposite directions?', options: ['Yes', 'No, both went the same way', 'Only one pull was felt', 'Not sure'] },
      { id: 'first', label: 'Which way did the first pull go?', options: ['Left', 'Right', 'Not sure'] }
    ]
  }
];

let driver = null;

function initDriver() {
  driver = new LogitechTestDriver({
    onLog: entry => {
      state.logs.push({ ...entry, testId: state.runningTest });
      while (state.logs.length > 500) state.logs.shift();
    },
    onState: () => {}
  });
  state.driver = driver;
}

function wait(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function stream(value, durationMs, intervalMs) {
  const started = performance.now();
  while (performance.now() - started < durationMs) {
    if (state.stopRequested) break;
    await driver.setForce(value);
    await wait(intervalMs);
  }
  await driver.stop();
}

function isG923(productId) {
  return productId === 0xc26d || productId === 0xc26e;
}

function baselineConfig() {
  const productId = driver?.inputDevice?.productId;
  const g923 = isG923(productId);
  return {
    strength: 0.5,
    forceSign: g923 ? -1 : 1,
    protocolVersion: true,
    resetAll: true,
    disableAutocenter: true,
    setAperture: false,
    autostartAllocate: true,
    autostartUpdate: false,
    autostartResume: true,
    playAfterAllocate: !g923,
    playAfterUpdate: false,
    playAfterResume: !g923,
    recreateOnResume: false,
    destroyOnStop: false
  };
}

async function prepareTest(test) {
  state.stopRequested = false;
  try { await driver.stop(); } catch { /* noop */ }
  try { if (driver.slot) await driver.destroySlot(); } catch { /* noop */ }
  driver.configure({ ...baselineConfig(), ...(test.config || {}) });
  state.configs[test.id] = { ...driver.config };
}

function testStepId(testId) {
  return `test-${testId}`;
}

function testComplete(test) {
  if (state.skipped.has(test.id)) return true;
  if (state.status[test.id] !== 'done') return false;
  const answers = state.answers[test.id] || {};
  return test.questions.every(question => !!answers[question.id]);
}

function renderTests() {
  const container = $('testSteps');
  container.innerHTML = '';
  tests.forEach((test, index) => {
    const section = document.createElement('section');
    section.className = 'step hidden';
    section.dataset.step = testStepId(test.id);
    section.innerHTML = `
      <h2>Test ${index + 1}: ${test.title}</h2>
      <p>${test.description}</p>
      <div class="notice"><strong>Keep clear:</strong> the wheel moves during this test. Press <b>Stop force now</b> at any time.</div>
      <div class="row">
        <button type="button" class="primary" data-run="${test.id}">Start test</button>
      </div>
      <div class="test-status" data-status="${test.id}">Not started.</div>
      <div data-questions="${test.id}" class="hidden"></div>
      <div class="field">
        <label for="note-${test.id}">Anything to add? (optional)</label>
        <textarea id="note-${test.id}" data-note="${test.id}" placeholder="For example: the pull was weak, it stopped after two seconds, the wheel felt notchy."></textarea>
      </div>
    `;
    container.appendChild(section);
    section.querySelector(`[data-run="${test.id}"]`).addEventListener('click', () => runTest(test));
    section.querySelector(`[data-note="${test.id}"]`).addEventListener('input', event => {
      state.notes[test.id] = event.target.value;
    });
  });
}

function renderQuestions(test) {
  const container = document.querySelector(`[data-questions="${test.id}"]`);
  if (!container) return;
  container.innerHTML = '';
  for (const question of test.questions) {
    const block = document.createElement('div');
    block.className = 'question';
    const name = `${test.id}:${question.id}`;
    const choices = question.options.map(option => `
      <label class="choice">
        <input type="radio" name="${name}" value="${option}" />
        ${option}
      </label>
    `).join('');
    block.innerHTML = `<p>${question.label}</p><div class="choices">${choices}</div>`;
    container.appendChild(block);
    for (const input of block.querySelectorAll('input[type="radio"]')) {
      input.addEventListener('change', event => {
        state.answers[test.id] = state.answers[test.id] || {};
        state.answers[test.id][question.id] = event.target.value;
        updateNavigation();
      });
    }
  }
  container.classList.remove('hidden');
}

function setStatus(testId, kind, text) {
  const el = document.querySelector(`[data-status="${testId}"]`);
  if (!el) return;
  el.className = `test-status ${kind}`;
  el.textContent = text;
}

async function runTest(test) {
  if (state.runningTest) return;
  state.runningTest = test.id;
  state.stopRequested = false;
  state.errors[test.id] = null;
  setStatus(test.id, 'running', 'Running. Keep clear of the wheel...');
  const runButton = document.querySelector(`[data-run="${test.id}"]`);
  if (runButton) runButton.disabled = true;
  updateNavigation();

  const before = driver.getState();
  const startedAt = Date.now();
  try {
    await prepareTest(test);
    await test.run();
    state.frames[test.id] = {
      sent: driver.sent - before.sent,
      received: driver.received - before.received,
      errors: driver.errors - before.errors,
      durationMs: Date.now() - startedAt
    };
    state.states[test.id] = driver.getState();
    state.status[test.id] = 'done';
    state.answers[test.id] = {};
    setStatus(test.id, 'done', 'Test complete. Answer the questions below.');
    renderQuestions(test);
  } catch (error) {
    state.status[test.id] = 'error';
    state.errors[test.id] = String(error);
    setStatus(test.id, 'error', `The test could not run: ${error}`);
  } finally {
    state.runningTest = null;
    if (runButton) runButton.disabled = false;
    try { await driver.stop(); } catch { /* noop */ }
    updateNavigation();
  }
}

function connectStatus(kind, text) {
  $('connectStatus').innerHTML = `<span class="pill ${kind}">${text}</span>`;
}

function updateDeviceInfo() {
  const input = driver?.inputDevice;
  const ffb = driver?.ffbDevice;
  const mode = $('mode').value;
  const modeText = mode === 'g923' ? 'G923 / compatibility' : mode === 'native' ? 'Native' : 'Not sure';
  $('deviceInfo').innerHTML = `
    <div><b>Wheel</b><span>${input?.productName || 'Unknown'}</span></div>
    <div><b>USB ID</b><span>${input ? `${input.vendorId.toString(16)}:${input.productId.toString(16)}` : 'Unknown'}</span></div>
    <div><b>Mode</b><span>${modeText}</span></div>
    <div><b>Interfaces</b><span>${driver?.interfaces?.length || 0}</span></div>
    <div><b>HID++</b><span>${driver?.protocolVersion ? `${driver.protocolVersion.major}.${driver.protocolVersion.minor}` : 'Unknown'}</span></div>
    <div><b>FFB feature</b><span>${driver?.featureIndex ? `found (index ${driver.featureIndex})` : 'not found'}</span></div>
    <div><b>Force correction</b><span>${isG923(input?.productId) ? 'G923 inversion on' : 'native sign'}</span></div>
  `;
}

async function connectWheel() {
  if (state.connecting) return;
  state.connecting = true;
  $('connect').disabled = true;
  connectStatus('warn', 'connecting...');
  $('connectHelp').textContent = '';
  try {
    if (!navigator.hid || !navigator.hid.requestDevice) {
      throw new Error('This browser does not support WebHID. Use Chrome or Edge on desktop.');
    }
    if (!driver.connected) {
      const devices = await navigator.hid.requestDevice({ filters: [{ vendorId: 0x046d }] });
      if (!devices.length) {
        connectStatus('', 'not connected');
        $('connectHelp').textContent = 'No device was selected. Click Connect wheel and choose the Logitech wheel.';
        return;
      }
      await driver.connect(devices);
      state.connected = true;
    }
    await driver.initialize(baselineConfig());
    state.initialized = true;
    driver.configure({ forceSign: isG923(driver.inputDevice?.productId) ? -1 : 1 });
    connectStatus('ok', 'ready');
    $('connectHelp').textContent = 'Wheel connected. Continue to the tests.';
    $('connect').disabled = true;
    $('connect').textContent = 'Connected';
  } catch (error) {
    state.initialized = false;
    state.connected = !!driver?.connected;
    connectStatus('bad', 'not ready');
    $('connectHelp').textContent = `Could not start the tests: ${error}. Close G HUB, check the wheel mode, reconnect the USB cable, then try again.`;
    $('connect').disabled = false;
    $('connect').textContent = driver?.connected ? 'Retry initialization' : 'Connect wheel';
  } finally {
    state.connecting = false;
    updateDeviceInfo();
    updateNavigation();
  }
}

function stepIndexFor(stepId) {
  return state.steps.indexOf(stepId);
}

function updateNavigation() {
  const stepId = state.steps[state.stepIndex];
  const test = tests.find(item => testStepId(item.id) === stepId);
  const isTest = !!test;
  const isReport = stepId === 'report';
  $('back').classList.toggle('hidden', state.stepIndex === 0);
  $('next').classList.toggle('hidden', isReport);
  $('skipTest').classList.toggle('hidden', !isTest || state.skipped.has(test?.id) || state.runningTest === test?.id || testComplete(test));
  $('next').disabled = stepId === 'connect' ? !state.initialized : isTest ? !testComplete(test) : false;
  if (isTest) {
    $('next').textContent = testComplete(test) ? 'Continue' : 'Answer the questions';
  } else {
    $('next').textContent = 'Continue';
  }
}

function showStep(index) {
  state.stepIndex = Math.max(0, Math.min(state.steps.length - 1, index));
  const stepId = state.steps[state.stepIndex];
  for (const section of document.querySelectorAll('.step')) {
    section.classList.toggle('hidden', section.dataset.step !== stepId);
  }
  const stepName = stepId === 'connect' ? 'Welcome'
    : stepId === 'details' ? 'Your wheel'
      : stepId === 'report' ? 'Report'
        : tests.find(item => testStepId(item.id) === stepId)?.title || '';
  $('stepLabel').textContent = `Step ${state.stepIndex + 1} of ${state.steps.length}`;
  $('stepName').textContent = stepName;
  $('progressFill').style.width = `${(state.stepIndex / (state.steps.length - 1)) * 100}%`;
  if (stepId === 'details') updateDeviceInfo();
  if (stepId === 'report') generateReport();
  updateNavigation();
}

function answerSummary() {
  const container = $('answerSummary');
  container.innerHTML = '';
  for (const test of tests) {
    const row = document.createElement('div');
    row.className = 'summary-row';
    const answers = state.answers[test.id] || {};
    const parts = test.questions
      .map(question => `${question.label} <b>${answers[question.id] || 'not answered'}</b>`)
      .join('<br>');
    const skipped = state.skipped.has(test.id) ? 'Skipped.' : parts;
    row.innerHTML = `<b>${test.title}</b>${skipped}`;
    container.appendChild(row);
  }
}

function buildReport() {
  const input = driver?.inputDevice;
  const ffb = driver?.ffbDevice;
  return {
    kind: 'webhid-wheel-logitech-test-report',
    schemaVersion: 1,
    createdAt: new Date().toISOString(),
    page: 'logitech-wizard',
    driverVersion: DRIVER_VERSION,
    userAgent: navigator.userAgent,
    language: navigator.language,
    mode: $('mode').value,
    wheelNotes: $('wheelNotes').value,
    finalNotes: $('finalNotes').value,
    device: {
      productName: input?.productName || null,
      vendorId: input?.vendorId ?? null,
      productId: input?.productId ?? null,
      serialNumber: input?.serialNumber || null,
      interfaces: driver?.interfaces?.map(device => ({
        productName: device.productName,
        vendorId: device.vendorId,
        productId: device.productId,
        collections: (device.collections || []).map(collection => ({
          usagePage: collection.usagePage,
          usage: collection.usage,
          input: (collection.inputReports || []).map(report => report.reportId),
          output: (collection.outputReports || []).map(report => report.reportId),
          feature: (collection.featureReports || []).map(report => report.reportId)
        }))
      })) || [],
      inputInterface: input?.productName || null,
      ffbInterface: ffb?.productName || null
    },
    driver: driver ? driver.getState() : null,
    tests: tests.map(test => ({
      id: test.id,
      title: test.title,
      rateMs: test.rateMs || 0,
      status: state.skipped.has(test.id) ? 'skipped' : state.status[test.id] || 'not-run',
      answers: state.answers[test.id] || {},
      notes: state.notes[test.id] || '',
      error: state.errors[test.id] || null,
      config: state.configs[test.id] || null,
      frames: state.frames[test.id] || null,
      stateAfter: state.states[test.id] || null
    })),
    log: state.logs.slice(-500)
  };
}

function hexId(value) {
  return typeof value === 'number' ? value.toString(16).padStart(4, '0') : 'unknown';
}

function modeLabel(mode) {
  if (mode === 'g923') return 'G923 / compatibility mode';
  if (mode === 'native') return 'native RS50 / G Pro mode';
  return 'not sure';
}

function statusLabel(status) {
  if (status === 'done') return 'completed';
  if (status === 'skipped') return 'skipped';
  if (status === 'error') return 'error';
  return 'not run';
}

function questionLabel(testId, questionId) {
  const test = tests.find(item => item.id === testId);
  return test?.questions.find(question => question.id === questionId)?.label || questionId;
}

function interfaceLabel(iface, page) {
  if (!iface) return null;
  const collection = (iface.collections || []).find(item => item.usagePage === page);
  if (!collection) return iface.productName;
  return `${iface.productName} [${hexId(collection.usagePage)}:${hexId(collection.usage)}]`;
}

function configLine(config) {
  if (!config) return 'unknown';
  const enabled = [
    ['autostart allocate', config.autostartAllocate],
    ['autostart update', config.autostartUpdate],
    ['autostart resume', config.autostartResume],
    ['play allocate', config.playAfterAllocate],
    ['play update', config.playAfterUpdate],
    ['play resume', config.playAfterResume],
    ['recreate resume', config.recreateOnResume],
    ['destroy stop', config.destroyOnStop]
  ].filter(([, value]) => value).map(([name]) => name);
  return enabled.length ? enabled.join(', ') : 'none';
}

function buildMessage(report) {
  const lines = [];
  const device = report.device;
  const drv = report.driver || {};
  lines.push('Logitech wheel test report');
  lines.push(`Created: ${report.createdAt}`);
  lines.push(`Wheel: ${device.productName || 'Unknown'} (${hexId(device.vendorId)}:${hexId(device.productId)})`);
  lines.push(`Mode: ${modeLabel(report.mode)}`);
  lines.push(`Interfaces: ${device.interfaces.length}`);
  const inputInterface = device.interfaces.find(item =>
    (item.collections || []).some(collection => collection.usagePage === 0x01)
  );
  const ffbInterface = device.interfaces.find(item =>
    (item.collections || []).some(collection => collection.usagePage === 0xff43)
  );
  const inputLabel = interfaceLabel(inputInterface, 0x01);
  const ffbLabel = interfaceLabel(ffbInterface, 0xff43);
  if (inputLabel) lines.push(`Input interface: ${inputLabel}`);
  if (ffbLabel) lines.push(`FFB interface: ${ffbLabel}`);
  if (drv.protocolVersion) {
    lines.push(`HID++: ${drv.protocolVersion.major}.${drv.protocolVersion.minor}`);
  }
  if (drv.featureIndex) {
    lines.push(`FFB feature: 0x8123 at index ${drv.featureIndex}`);
  } else {
    lines.push('FFB feature: not found');
  }
  if (drv.slotCount) lines.push(`Force slots: ${drv.slotCount}; autocenter slot: ${drv.autocenterSlot}`);
  if (drv.config) lines.push(`Force sign: ${drv.config.forceSign < 0 ? 'G923 inversion' : 'native'}`);
  lines.push(`Browser: ${report.userAgent}`);
  lines.push('');
  lines.push('Tests:');

  report.tests.forEach((test, index) => {
    lines.push(`${index + 1}. ${test.title} - ${statusLabel(test.status)}`);
    if (test.rateMs) lines.push(`   Update interval: ${test.rateMs} ms`);
    if (test.config) lines.push(`   Strategy: ${configLine(test.config)}`);
    const answers = test.answers || {};
    for (const [questionId, value] of Object.entries(answers)) {
      lines.push(`   ${questionLabel(test.id, questionId)} ${value}`);
    }
    if (test.notes) lines.push(`   Notes: ${test.notes}`);
    if (test.error) lines.push(`   Error: ${test.error}`);
    if (test.frames) {
      lines.push(`   Frames: ${test.frames.sent} sent, ${test.frames.received} received, ${test.frames.errors} errors in ${test.frames.durationMs} ms`);
    }
    lines.push('');
  });

  if (report.wheelNotes) {
    lines.push(`Wheel notes: ${report.wheelNotes}`);
    lines.push('');
  }
  if (report.finalNotes) {
    lines.push(`Other notes: ${report.finalNotes}`);
    lines.push('');
  }

  const errors = (report.log || []).filter(entry => entry.dir === 'error').slice(-10);
  if (errors.length) {
    lines.push('Recent HID++ errors:');
    for (const error of errors) {
      lines.push(`- ${error.label}${error.text ? `: ${error.text}` : ''}`);
    }
    lines.push('');
  }

  lines.push('A full JSON report is available if needed.');
  return lines.join('\n');
}

function generateReport() {
  answerSummary();
  state.reportObject = buildReport();
  const json = JSON.stringify(state.reportObject, null, 2);
  const message = buildMessage(state.reportObject);
  $('reportText').value = json;
  $('messageText').value = message;
  $('reportStatus').textContent = `Message ready (${message.length} characters). Copy it or download the .txt file, then send it back.`;
}

function reportFilename() {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  return `logitech-wheel-report-${stamp}.json`;
}

function downloadReport() {
  if (!state.reportObject) generateReport();
  const blob = new Blob([$('reportText').value], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = reportFilename();
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function downloadMessage() {
  if (!state.reportObject) generateReport();
  const blob = new Blob([$('messageText').value], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = reportFilename().replace(/\.json$/, '.txt');
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function copyMessage() {
  if (!state.reportObject) generateReport();
  try {
    await navigator.clipboard.writeText($('messageText').value);
    $('reportStatus').textContent = 'Message copied. Paste it into an email or WhatsApp.';
  } catch {
    $('reportStatus').textContent = 'Could not copy. Use Download message instead.';
  }
}

async function copyReport() {
  if (!state.reportObject) generateReport();
  try {
    await navigator.clipboard.writeText($('reportText').value);
    $('reportStatus').textContent = 'JSON report copied to the clipboard.';
  } catch {
    $('reportStatus').textContent = 'Could not copy. Use Download JSON instead.';
  }
}

function stopNow() {
  state.stopRequested = true;
  if (driver) void driver.stop().catch(() => undefined);
}

function initSteps() {
  renderTests();
  state.steps = ['connect', 'details', ...tests.map(test => testStepId(test.id)), 'report'];
  showStep(0);
}

$('safety').addEventListener('change', () => {
  $('connect').disabled = !$('safety').checked || state.initialized;
});

$('connect').addEventListener('click', connectWheel);
$('next').addEventListener('click', () => showStep(state.stepIndex + 1));
$('back').addEventListener('click', () => showStep(state.stepIndex - 1));
$('stopNow').addEventListener('click', stopNow);
$('restart').addEventListener('click', () => location.reload());
$('downloadReport').addEventListener('click', downloadReport);
$('downloadMessage').addEventListener('click', downloadMessage);
$('copyReport').addEventListener('click', () => void copyReport());
$('copyMessage').addEventListener('click', () => void copyMessage());
$('mode').addEventListener('change', updateDeviceInfo);
$('wheelNotes').addEventListener('input', () => {});
$('finalNotes').addEventListener('input', generateReport);

$('skipTest').addEventListener('click', () => {
  const stepId = state.steps[state.stepIndex];
  const test = tests.find(item => testStepId(item.id) === stepId);
  if (!test) return;
  state.skipped.add(test.id);
  state.status[test.id] = 'skipped';
  setStatus(test.id, '', 'Skipped.');
  updateNavigation();
});

window.addEventListener('pagehide', () => {
  stopNow();
  if (driver?.connected) void driver.disconnect();
});

document.addEventListener('visibilitychange', () => {
  if (document.hidden) stopNow();
});

initDriver();
initSteps();
