import { WebHIDWheel } from './webhid-wheel.js';    

let wheelEl, rimEl, steerArcEl, angleReadoutEl, wheelNameEl, wheelProfileEl, debugEl, buttonShapes, axisShapes;
let ctrlStrengthEl, ctrlForceEl, ctrlRumbleEl, ctrlStopEl;
let wheel, maxRotation = 900, lastDebug = null;

const CX = 150, CY = 150, ARC_R = 86;

// The WebHID device can only be requested upon user interaction
document.getElementById('connectButton').addEventListener('click', async () => {
  
  wheel = new WebHIDWheel();
  
  // This will request the WebHID device and initialize the controller
  await wheel.connect();
  wheel.maxRotation = maxRotation;
  if (wheel.parserName) {
    wheelProfileEl.textContent = wheel.parserName;
    wheelProfileEl.classList.toggle('warn', !wheel.profile);
  } else {
    wheelProfileEl.textContent = 'Unknown wheel \u2014 raw report only';
    wheelProfileEl.classList.add('warn');
  }
  const caps = wheel.ffbCaps || {};
  updateFfbControls({ constant: !!caps.constant, periodic: !!caps.periodic, any: !!caps.any });
  
  function logInputs() {
    requestAnimationFrame(logInputs);   
    
    if(wheel.name)
      wheelNameEl.innerHTML = wheel.name;
    
    if(wheel.debug)
      renderDebug();
        
    if(wheel.rotation !== undefined) {
      rimEl.setAttribute('transform', `rotate(${wheel.rotation + 180} 150 150)`);
      const deg = Math.max(-360, Math.min(360, wheel.rotation));
      steerArcEl.setAttribute('d', arcPath(CX, CY, ARC_R, deg));
      steerArcEl.style.opacity = Math.abs(deg) < 0.5 ? 0 : 1;
      angleReadoutEl.textContent = (wheel.rotation >= 0 ? '+' : '') + Math.round(wheel.rotation) + '\u00b0';
    }
    if(wheel.buttons) {
      wheel.buttons.forEach((button, i) => {
        if (buttonShapes[i]) {
          button ? buttonShapes[i].setAttribute('fill', 'red') : buttonShapes[i].setAttribute('fill', 'none');
        }
      });
    }
    if(wheel.axes) {
      wheel.axes.forEach((axis, i) => {
        if (axisShapes[i]) axisShapes[i].setAttribute('height', axis / 255 * 50);
      });
    }
  }
  logInputs();  
  
  const rumbleInput = document.getElementById('rumble');
  rumbleInput.oninput = () => { wheel.rumble = rumbleInput.value; wheel.sendLocalState(); };
  const forceInput = document.getElementById('force');
  const forceValueEl = document.getElementById('forceValue');
  forceInput.oninput = () => {
    forceValueEl.textContent = forceInput.value;
    wheel.setConstantForce(parseInt(forceInput.value) / 100);
  };
  forceInput.onchange = () => {
    forceInput.value = 0;
    forceValueEl.textContent = '0';
    wheel.stopEffects();
  };
  const strengthInput = document.getElementById('strength');
  const strengthValueEl = document.getElementById('strengthValue');
  wheel.ffbStrength = parseInt(strengthInput.value) / 100;
  strengthInput.oninput = () => {
    wheel.ffbStrength = parseInt(strengthInput.value) / 100;
    strengthValueEl.textContent = strengthInput.value;
    wheel.setConstantForce(parseInt(forceInput.value) / 100);
  };
  const stopFfbButton = document.getElementById('stopFfb');
  stopFfbButton.onclick = () => {
    forceInput.value = 0;
    forceValueEl.textContent = '0';
    wheel.stopEffects();
  };
});

////////////////////////////////// Init SVGs 

window.onload =  () => { setupSVG(); setupRotationControl(); updateFfbControls({ constant: false, periodic: false, any: false }); setupDiagnostics(); };

function setupDiagnostics() {
  const gatherBtn = document.getElementById('gatherDiag');
  const stopBtn = document.getElementById('stopDiag');
  const copyBtn = document.getElementById('copyDiag');
  const issueLink = document.getElementById('reportDiag');
  const statusEl = document.getElementById('diagStatus');
  const outputEl = document.getElementById('diagOutput');

  let capturing = false, cap = null, onReport = null, timer = null, lastDiscover = 0;

  function startCapture() {
    if (!wheel || !wheel.device) { statusEl.textContent = 'Connect a wheel first.'; return; }
    const dev = wheel.device;
    cap = {};
    capturing = true;
    lastDiscover = 0;
    gatherBtn.disabled = true;
    stopBtn.classList.remove('hidden');
    copyBtn.classList.add('hidden');
    issueLink.classList.add('hidden');
    outputEl.classList.add('hidden');

    onReport = (e) => {
      const d = e.data, n = d.byteLength;
      let s = cap[e.reportId];
      if (!s) { s = cap[e.reportId] = { bytes: n, events: 0, min: new Array(n).fill(255), max: new Array(n).fill(0) }; lastDiscover = Date.now(); }
      s.events++;
      for (let i = 0; i < n; i++) {
        const v = d.getUint8(i);
        if (v < s.min[i]) { s.min[i] = v; lastDiscover = Date.now(); }
        if (v > s.max[i]) { s.max[i] = v; lastDiscover = Date.now(); }
      }
    };
    dev.addEventListener('inputreport', onReport);

    timer = setInterval(() => {
      const ids = Object.keys(cap);
      const events = ids.reduce((a, id) => a + cap[id].events, 0);
      const live = (Date.now() - lastDiscover) < 800;
      statusEl.textContent = (live ? '\u25cf new data \u2014 ' : '') + 'turn the wheel full-lock and press each button. reports: ' + ids.length + ' \u00b7 events: ' + events;
      statusEl.classList.toggle('live', live);
    }, 150);
  }

  function stopCapture() {
    if (!capturing) return;
    capturing = false;
    clearInterval(timer);
    wheel.device.removeEventListener('inputreport', onReport);
    gatherBtn.disabled = false;
    stopBtn.classList.add('hidden');
    statusEl.classList.remove('live');

    const dev = wheel.device;
    const item = (i) => ({ usages: (i.usages || []).map(u => '0x' + (u >>> 0).toString(16)), size: i.reportSize, count: i.reportCount, logicalMin: i.logicalMinimum, logicalMax: i.logicalMaximum });
    const reports = (list) => list.map(r => ({ id: r.reportId, items: r.items.map(item) }));
    const payload = {
      generatedAt: new Date().toISOString(),
      userAgent: navigator.userAgent,
      platform: navigator.platform,
      device: { name: dev.productName, vendorId: dev.vendorId, productId: dev.productId },
      matchedProfile: wheel.parserName || null,
      ffbCaps: wheel.ffbCaps || null,
      pidFfb: (wheel.pidFfb && wheel.pidFfb.info) || null,
      collections: dev.collections.map(c => ({ usagePage: c.usagePage, usage: c.usage, input: reports(c.inputReports || []), output: reports(c.outputReports || []), feature: reports(c.featureReports || []) })),
      capture: cap
    };
    outputEl.value = JSON.stringify(payload, null, 2);
    outputEl.classList.remove('hidden');
    copyBtn.classList.remove('hidden');
    issueLink.classList.remove('hidden');
    issueLink.href = 'https://github.com/joegaffey/webhid-wheel/issues/new?template=wheel-report.yml&title=' +
      encodeURIComponent('Wheel report: ' + (dev.productName || 'unknown'));
    statusEl.textContent = 'Stopped. Copy the JSON or open an issue.';
  }

  gatherBtn.onclick = startCapture;
  stopBtn.onclick = stopCapture;
  issueLink.onclick = async () => {
    try { await navigator.clipboard.writeText(outputEl.value); statusEl.textContent = 'JSON copied \u2014 paste it into the Diagnostics JSON field.'; }
    catch (e) { statusEl.textContent = 'Copy failed \u2014 select the JSON box and copy manually.'; }
  };
  copyBtn.onclick = async () => {
    try { await navigator.clipboard.writeText(outputEl.value); statusEl.textContent = 'Copied to clipboard.'; }
    catch (e) { statusEl.textContent = 'Copy failed \u2014 select the text and copy manually.'; }
  };
}

function updateFfbControls(caps) {
  ctrlStrengthEl.classList.toggle('hidden', !caps.constant);
  ctrlForceEl.classList.toggle('hidden', !caps.constant);
  ctrlRumbleEl.classList.toggle('hidden', !caps.periodic);
  ctrlStopEl.classList.toggle('hidden', !caps.any);
  document.getElementById('ffbHint').classList.toggle('hidden', !caps.any);
}

function setupSVG() {
  const inputsEl = document.getElementById('inputs');
  wheelEl = document.getElementById('wheel');  
  rimEl = document.getElementById('rim');  
  steerArcEl = document.getElementById('steerArc');  
  angleReadoutEl = document.getElementById('angleReadout');  
  wheelNameEl = document.getElementById('wheelName');  
  wheelProfileEl = document.getElementById('wheelProfile');  
  debugEl = document.getElementById('debug');
  ctrlStrengthEl = document.getElementById('ctrlStrength');
  ctrlForceEl = document.getElementById('ctrlForce');
  ctrlRumbleEl = document.getElementById('ctrlRumble');
  ctrlStopEl = document.getElementById('ctrlStop');
  buttonShapes = Array.from(inputsEl.getElementById('buttons').children);
  axisShapes = Array.from(inputsEl.getElementById('axes').children);
}

function setupRotationControl() {
  const input = document.getElementById('maxRotation');
  const valueEl = document.getElementById('maxRotationValue');
  maxRotation = parseInt(input.value);
  input.oninput = () => {
    maxRotation = parseInt(input.value);
    valueEl.textContent = maxRotation;
    if(wheel) wheel.maxRotation = maxRotation;
  };
}

function polar(cx, cy, r, deg) {
  const a = (deg - 90) * Math.PI / 180;
  return { x: +(cx + r * Math.cos(a)).toFixed(2), y: +(cy + r * Math.sin(a)).toFixed(2) };
}

function arcPath(cx, cy, r, deg) {
  if (Math.abs(deg) < 0.5) return '';
  const start = polar(cx, cy, r, 0);
  const end = polar(cx, cy, r, deg);
  const large = Math.abs(deg) > 180 ? 1 : 0;
  const sweep = deg > 0 ? 1 : 0;
  return `M ${start.x} ${start.y} A ${r} ${r} 0 ${large} ${sweep} ${end.x} ${end.y}`;
}

function renderDebug() {
  const bytes = wheel.debug;
  if (!bytes) return;

  let same = lastDebug && lastDebug.length === bytes.length;
  if (same) {
    for (let i = 0; i < bytes.length; i++) {
      if (bytes[i] !== lastDebug[i]) { same = false; break; }
    }
  }
  if (same) return;

  const cells = [];
  for (let i = 0; i < bytes.length; i++) {
    const hex = bytes[i].toString(16).padStart(2, '0');
    const changed = lastDebug && lastDebug[i] !== bytes[i] ? ' chg' : '';
    cells.push(`<span class="dbg-byte${changed}" title="byte ${i} = ${bytes[i]} (0x${hex})">${hex}</span>`);
  }
  debugEl.innerHTML = `<div class="dbg-head">report ${wheel.reportId} &middot; ${bytes.length} bytes</div><div class="dbg-grid">${cells.join('')}</div>`;
  lastDebug = Array.prototype.slice.call(bytes);
}
