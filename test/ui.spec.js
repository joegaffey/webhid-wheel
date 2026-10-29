import { test, expect } from '@playwright/test';

test('demo boots with the config panel and no page errors', async ({ page }) => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => {
    if (message.type() === 'error') errors.push(message.text());
  });

  await page.goto('/');
  await expect(page.locator('webhid-config-panel')).toBeVisible();
  await expect(page.locator('webhid-config-panel').locator('webhid-device-picker')).toBeVisible();
  await expect(page.locator('webhid-config-panel').locator('webhid-steering-config')).toBeVisible();
  await expect(page.locator('webhid-config-panel').locator('[role="tab"]')).toHaveCount(3);
  await expect(page.locator('webhid-config-panel').locator('[data-panel="wheel"]')).toBeVisible();
  await expect(page.locator('webhid-config-panel').locator('[data-panel="axes"]')).toBeHidden();
  await expect(page.locator('webhid-config-panel').locator('[data-panel="buttons"]')).toBeHidden();
  await expect(page.locator('#force')).toBeVisible();
  await expect(page.locator('webhid-config-panel').locator('[data-role="profile-select"]')).toBeVisible();

  const info = await page.evaluate(() => {
    const panel = document.querySelector('webhid-config-panel');
    return {
      panelDefined: !!customElements.get('webhid-config-panel'),
      manager: !!window.__webhidDemo?.manager,
      shadow: !!panel?.shadowRoot,
      devicePickerDefined: !!customElements.get('webhid-device-picker'),
      webhid: !!navigator.hid
    };
  });
  expect(info.panelDefined).toBe(true);
  expect(info.manager).toBe(true);
  expect(info.shadow).toBe(true);
  expect(info.devicePickerDefined).toBe(true);
  expect(errors).toEqual([]);
});

test('steering controls update the manager and stay inside shadow DOM', async ({ page }) => {
  await page.goto('/');
  const result = await page.evaluate(async () => {
    const { WheelManager } = await import('/src/core/index.js');
    const manager = new WheelManager();
    const element = document.createElement('webhid-steering-config');
    element.manager = manager;
    document.body.append(element);
    await new Promise(resolve => requestAnimationFrame(resolve));

    const root = element.shadowRoot;
    const deadzone = root.querySelector('[data-setting="deadzone"]');
    deadzone.value = '0.2';
    deadzone.dispatchEvent(new Event('input', { bubbles: true }));

    const gain = root.querySelector('[data-setting="gain"]');
    gain.value = '0.7';
    gain.dispatchEvent(new Event('input', { bubbles: true }));

    return {
      deadzone: manager.getCalibration().deadzone,
      gain: manager.getFfb().gain,
      isolated: !document.querySelector('[data-setting="deadzone"]'),
      shadow: !!root
    };
  });
  expect(result.deadzone).toBeCloseTo(0.2);
  expect(result.gain).toBeCloseTo(0.7);
  expect(result.isolated).toBe(true);
  expect(result.shadow).toBe(true);
});

test('axis and button mappers render their default rows', async ({ page }) => {
  await page.goto('/');
  const result = await page.evaluate(async () => {
    const { WheelManager } = await import('/src/core/index.js');
    const manager = new WheelManager();
    const axes = document.createElement('webhid-axis-mapper');
    const buttons = document.createElement('webhid-button-mapper');
    axes.manager = manager;
    buttons.manager = manager;
    document.body.append(axes, buttons);
    await new Promise(resolve => requestAnimationFrame(resolve));
    return {
      axisRows: axes.shadowRoot.querySelectorAll('[data-channel]').length,
      buttonRows: buttons.shadowRoot.querySelectorAll('[data-channel]').length,
      hasThrottle: !!axes.shadowRoot.querySelector('[data-channel="throttle"]'),
      hasShiftUp: !!buttons.shadowRoot.querySelector('[data-channel="gearUp"]')
    };
  });
  expect(result.axisRows).toBe(4);
  expect(result.buttonRows).toBe(13);
  expect(result.hasThrottle).toBe(true);
  expect(result.hasShiftUp).toBe(true);
});

test('device picker exposes the unavailable state without WebHID', async ({ page }) => {
  await page.goto('/');
  const result = await page.evaluate(() => {
    const picker = document.querySelector('webhid-config-panel')?.shadowRoot?.querySelector('webhid-device-picker');
    const connect = picker?.shadowRoot?.querySelector('[data-action="connect"]');
    const badge = picker?.shadowRoot?.querySelector('[data-role="hid-state"]');
    return {
      hasHid: !!navigator.hid,
      connectDisabled: !!connect?.disabled,
      badge: badge?.textContent || ''
    };
  });
  if (!result.hasHid) {
    expect(result.connectDisabled).toBe(true);
    expect(result.badge).toBe('WebHID unavailable');
  }
});

test('settings profile manager round-trips through the browser entry', async ({ page }) => {
  await page.goto('/');
  const result = await page.evaluate(async () => {
    const { SetupProfileManager } = await import('/src/core/index.js');
    const manager = new SetupProfileManager();
    const profile = {
      kind: 'webhid-wheel-profile',
      schemaVersion: 1,
      profileName: 'Browser Profile',
      hardware: { vendorId: 0x046d, productId: 0xc24f, productName: 'G29' },
      settings: {
        steering: { deadzone: 0.1, saturation: 1, maxRotation: 900, invert: false },
        ffb: { gain: 0.6, invert: false },
        axes: {},
        buttons: {}
      },
      metadata: { lapster: { roadNoise: 0.5 } }
    };
    const text = manager.serialize(profile);
    const parsed = manager.parse(text);
    return { text, parsed };
  });
  expect(result.parsed.profileName).toBe('Browser Profile');
  expect(result.parsed.settings.ffb.gain).toBe(0.6);
  expect(result.parsed.metadata.lapster.roadNoise).toBe(0.5);
  expect(JSON.stringify(result.parsed)).toContain('Browser Profile');
});

test('demo renders a connected wheel, input and a saved setup profile', async ({ page }) => {
  await page.goto('/');
  const connected = await page.evaluate(async () => {
    const manager = window.__webhidDemo.manager;
    const usage = (page, id) => (page << 16) | id;
    const item = (usages, reportSize, reportCount = 1, min = 0, max = (1 << reportSize) - 1) => ({
      usages, reportSize, reportCount, logicalMinimum: min, logicalMaximum: max
    });
    const fake = {
      collections: [{
        usagePage: 0x01,
        usage: 0x04,
        inputReports: [{
          reportId: 1,
          items: [
            item([usage(0x01, 0x30)], 16, 1, 0, 65535),
            item([usage(0x01, 0x31)], 8, 1, 0, 255),
            item([usage(0x01, 0x32)], 8, 1, 0, 255),
            item([usage(0x09, 0x01)], 1, 8, 0, 1)
          ]
        }],
        outputReports: [],
        featureReports: []
      }],
      productName: 'Fake Test Wheel',
      vendorId: 0x1234,
      productId: 0x5678,
      opened: false,
      oninputreport: null,
      async open() { this.opened = true; },
      async close() { this.opened = false; },
      async sendReport() {}
    };
    const entry = await manager.connect(fake);
    const data = new DataView(Uint8Array.from([0xff, 0xff, 0xff, 0x00, 0x10]).buffer);
    fake.oninputreport({ data, timeStamp: performance.now(), reportId: 1 });
    return {
      connected: manager.isConnected,
      name: entry && entry.name,
      steering: manager.channels.steering,
      deviceId: entry && entry.id
    };
  });

  expect(connected.connected).toBe(true);
  expect(connected.name).toBe('Fake Test Wheel');
  expect(connected.steering).toBe(1);
  expect(connected.deviceId).toBeTruthy();

  await expect(page.locator('webhid-config-panel').locator('webhid-device-picker')).toContainText('Fake Test Wheel');
  await expect(page.locator('#angleReadout')).toContainText('+450');
  await expect(page.locator('webhid-config-panel').locator('[data-action="save"]')).toBeEnabled();

  await page.locator('webhid-config-panel').locator('[data-role="name"]').fill('E2E Setup');
  await page.locator('webhid-config-panel').locator('[data-action="save"]').click();
  const stored = await page.evaluate(() => {
    const raw = localStorage.getItem('webhid-wheel:v3:profiles');
    return raw ? JSON.parse(raw) : null;
  });
  expect(stored.activeProfile).toBe('E2E Setup');
  expect(stored.schemaVersion).toBe(2);
  expect(stored.profiles[0].devices[0].hardware.vendorId).toBe(0x1234);
  expect(stored.profiles[0].settings.steering.maxRotation).toBe(900);

  const picker = page.locator('webhid-config-panel').locator('webhid-device-picker');
  await picker.locator('summary').click();
  await picker.locator('[data-action="copy"]').click();
  await expect(page.locator('#exportText')).toHaveValue(/Fake Test Wheel/);
});

test('mapping controls list connected device names and never a synthetic wheel role', async ({ page }) => {
  await page.goto('/');
  const result = await page.evaluate(async () => {
    const { WheelManager } = await import('/src/core/index.js');
    const usage = (page, id) => (page << 16) | id;
    const item = (usages, reportSize, reportCount = 1, min = 0, max = (1 << reportSize) - 1) => ({
      usages, reportSize, reportCount, logicalMinimum: min, logicalMaximum: max
    });
    const fake = (name, descriptor, vendorId, productId) => ({
      collections: descriptor,
      productName: name,
      vendorId,
      productId,
      opened: false,
      oninputreport: null,
      async open() { this.opened = true; },
      async close() { this.opened = false; },
      async sendReport() {}
    });
    const wheelDescriptor = [{
      usagePage: 1,
      usage: 4,
      inputReports: [{
        reportId: 1,
        items: [
          item([usage(1, 0x30)], 16, 1, 0, 65535),
          item([usage(1, 0x31)], 8, 1, 0, 255),
          item([usage(9, 1)], 1, 8, 0, 1)
        ]
      }],
      outputReports: [],
      featureReports: []
    }];
    const pedalDescriptor = [{
      usagePage: 1,
      usage: 5,
      inputReports: [{
        reportId: 2,
        items: [item([usage(1, 0x32)], 8, 1, 0, 255)]
      }],
      outputReports: [],
      featureReports: []
    }];

    const manager = new WheelManager();
    const wheel = await manager.connect(fake('Fake Wheel', wheelDescriptor, 0x1001, 0x2001));
    const pedals = await manager.connect(fake('Fake Pedals', pedalDescriptor, 0x1002, 0x2002));

    const axes = document.createElement('webhid-axis-mapper');
    const buttons = document.createElement('webhid-button-mapper');
    const steering = document.createElement('webhid-steering-config');
    axes.manager = manager;
    buttons.manager = manager;
    steering.manager = manager;
    document.body.append(axes, buttons, steering);
    await new Promise(resolve => requestAnimationFrame(resolve));

    const axisOptions = Array.from(axes.shadowRoot.querySelectorAll('[data-field="device"] option')).map(option => ({ value: option.value, text: option.textContent }));
    const buttonOptions = Array.from(buttons.shadowRoot.querySelectorAll('[data-field="device"] option')).map(option => ({ value: option.value, text: option.textContent }));
    const steeringOptions = Array.from(steering.shadowRoot.querySelectorAll('[data-role="steering-source"] option')).map(option => ({ value: option.value, text: option.textContent }));
    const ffbOptions = Array.from(steering.shadowRoot.querySelectorAll('[data-role="ffb-target"] option')).map(option => ({ value: option.value, text: option.textContent }));

    return {
      wheelId: wheel.id,
      pedalId: pedals.id,
      axisOptions,
      buttonOptions,
      steeringOptions,
      ffbOptions
    };
  });

  const allOptions = [...result.axisOptions, ...result.buttonOptions, ...result.steeringOptions, ...result.ffbOptions];
  expect(allOptions.some(option => option.value === 'wheel' || option.text === 'wheel')).toBe(false);
  expect(allOptions.some(option => option.text === 'Fake Wheel')).toBe(true);
  expect(allOptions.some(option => option.text === 'Fake Pedals')).toBe(true);
  expect(result.steeringOptions.find(option => option.text === 'Fake Wheel')?.value).toBe(result.wheelId);
  expect(result.axisOptions.find(option => option.text === 'Fake Pedals')?.value).toBe(result.pedalId);
});

test('raw input follows the selected device and lives under the device list', async ({ page }) => {
  await page.goto('/');
  const setup = await page.evaluate(async () => {
    const manager = window.__webhidDemo.manager;
    const usage = (page, id) => (page << 16) | id;
    const item = (usages, reportSize, reportCount = 1, min = 0, max = (1 << reportSize) - 1) => ({
      usages, reportSize, reportCount, logicalMinimum: min, logicalMaximum: max
    });
    const fake = (name, descriptor, vendorId, productId) => ({
      collections: descriptor,
      productName: name,
      vendorId,
      productId,
      opened: false,
      oninputreport: null,
      async open() { this.opened = true; },
      async close() { this.opened = false; },
      async sendReport() {}
    });
    const wheel = fake('Selected Wheel', [{
      usagePage: 1,
      usage: 4,
      inputReports: [{
        reportId: 1,
        items: [
          item([usage(1, 0x30)], 16, 1, 0, 65535),
          item([usage(1, 0x31)], 8, 1, 0, 255),
          item([usage(9, 1)], 1, 8, 0, 1)
        ]
      }],
      outputReports: [],
      featureReports: []
    }], 0x2001, 0x3001);
    const pedals = fake('Selected Pedals', [{
      usagePage: 1,
      usage: 5,
      inputReports: [{
        reportId: 2,
        items: [item([usage(1, 0x32)], 8, 1, 0, 255)]
      }],
      outputReports: [],
      featureReports: []
    }], 0x2002, 0x3002);

    const wheelEntry = await manager.connect(wheel);
    const pedalEntry = await manager.connect(pedals);
    wheel.oninputreport({ data: new DataView(Uint8Array.from([0x00, 0x80, 0x00, 0x00, 0x00]).buffer), timeStamp: 1, reportId: 1 });
    pedals.oninputreport({ data: new DataView(Uint8Array.from([0xff]).buffer), timeStamp: 1, reportId: 2 });

    await new Promise(resolve => requestAnimationFrame(resolve));
    await new Promise(resolve => setTimeout(resolve, 30));

    const panel = document.querySelector('webhid-config-panel');
    const picker = panel.shadowRoot.querySelector('webhid-device-picker');
    const row = [...picker.shadowRoot.querySelectorAll('[data-select]')]
      .find(item => item.textContent.includes('Selected Pedals'));
    row.click();
    await new Promise(resolve => setTimeout(resolve, 30));

    const raw = document.querySelector('[slot="diagnostics"]');
    return {
      wheelId: wheelEntry.id,
      pedalId: pedalEntry.id,
      rawText: document.querySelector('#debug').textContent,
      rawUnderDevices: !!picker.shadowRoot.querySelector('slot[name="diagnostics"]'),
      rawSlotChild: !!raw && !!raw.querySelector('#debug'),
      visualSlot: !!document.querySelector('#configPanel > [slot="steering-visual"] .wheel-svg'),
      ffbSlot: !!document.querySelector('#configPanel > [slot="steering-extra"] #force'),
      oldWheelCard: [...document.querySelectorAll('section.panel h2')].some(h2 => h2.textContent.trim() === 'Wheel')
    };
  });

  expect(setup.rawUnderDevices).toBe(true);
  expect(setup.rawSlotChild).toBe(true);
  expect(setup.rawText).toContain('Selected Pedals');
  expect(setup.visualSlot).toBe(true);
  expect(setup.ffbSlot).toBe(true);
  expect(setup.oldWheelCard).toBe(false);
});

test('device diagnostics are opt-in for embedded pickers', async ({ page }) => {
  await page.goto('/');
  const result = await page.evaluate(async () => {
    const { WheelManager } = await import('/src/core/index.js');
    const picker = document.createElement('webhid-device-picker');
    picker.manager = new WheelManager();
    document.body.append(picker);
    await new Promise(resolve => requestAnimationFrame(resolve));

    const read = element => ({
      details: !!element.shadowRoot.querySelector('details.diagnostics'),
      copy: !!element.shadowRoot.querySelector('[data-action="copy"]'),
      exportButton: !!element.shadowRoot.querySelector('[data-action="export"]')
    });

    const before = read(picker);
    picker.diagnostics = true;
    await new Promise(resolve => requestAnimationFrame(resolve));
    const after = read(picker);
    picker.remove();

    const defaultPanel = document.createElement('webhid-config-panel');
    document.body.append(defaultPanel);
    await new Promise(resolve => requestAnimationFrame(resolve));
    const embeddedDefault = read(defaultPanel.shadowRoot.querySelector('webhid-device-picker'));
    defaultPanel.remove();

    const panel = document.querySelector('webhid-config-panel');
    const demoPicker = panel.shadowRoot.querySelector('webhid-device-picker');
    return {
      before,
      after,
      embeddedDefault,
      demo: read(demoPicker),
      panelDiagnostics: panel.diagnostics
    };
  });

  expect(result.before).toEqual({ details: false, copy: false, exportButton: false });
  expect(result.after).toEqual({ details: true, copy: true, exportButton: true });
  expect(result.embeddedDefault).toEqual({ details: false, copy: false, exportButton: false });
  expect(result.demo).toEqual({ details: true, copy: true, exportButton: true });
  expect(result.panelDiagnostics).toBe(true);
});

test('disconnected devices leave the active UI and raw input falls back', async ({ page }) => {
  await page.goto('/');
  const result = await page.evaluate(async () => {
    const manager = window.__webhidDemo.manager;
    const usage = (page, id) => (page << 16) | id;
    const item = (usages, reportSize, reportCount = 1, min = 0, max = (1 << reportSize) - 1) => ({
      usages, reportSize, reportCount, logicalMinimum: min, logicalMaximum: max
    });
    const fake = (name, descriptor, vendorId, productId) => ({
      collections: descriptor,
      productName: name,
      vendorId,
      productId,
      opened: false,
      oninputreport: null,
      async open() { this.opened = true; },
      async close() { this.opened = false; },
      async sendReport() {}
    });
    const wheel = fake('Offline Wheel', [{
      usagePage: 1,
      usage: 4,
      inputReports: [{
        reportId: 1,
        items: [
          item([usage(1, 0x30)], 16, 1, 0, 65535),
          item([usage(1, 0x31)], 8, 1, 0, 255),
          item([usage(9, 1)], 1, 8, 0, 1)
        ]
      }],
      outputReports: [],
      featureReports: []
    }], 0x4001, 0x5001);
    const pedals = fake('Offline Pedals', [{
      usagePage: 1,
      usage: 5,
      inputReports: [{ reportId: 2, items: [item([usage(1, 0x32)], 8, 1, 0, 255)] }],
      outputReports: [],
      featureReports: []
    }], 0x4002, 0x5002);

    const wheelEntry = await manager.connect(wheel);
    const pedalEntry = await manager.connect(pedals);
    wheel.oninputreport({ data: new DataView(Uint8Array.from([0, 0x80, 0, 0, 0]).buffer), timeStamp: 1, reportId: 1 });
    pedals.oninputreport({ data: new DataView(Uint8Array.from([0x80]).buffer), timeStamp: 1, reportId: 2 });
    await new Promise(resolve => setTimeout(resolve, 30));

    const panel = document.querySelector('webhid-config-panel');
    const picker = panel.shadowRoot.querySelector('webhid-device-picker');
    const pedalRow = [...picker.shadowRoot.querySelectorAll('[data-select]')]
      .find(item => item.textContent.includes('Offline Pedals'));
    pedalRow.click();
    await new Promise(resolve => setTimeout(resolve, 20));
    const before = document.querySelector('#debug').textContent;

    await manager.disconnect(pedalEntry.id);
    await new Promise(resolve => setTimeout(resolve, 40));

    const rowsAfter = [...picker.shadowRoot.querySelectorAll('[data-select]')].map(row => row.textContent);
    const axes = panel.shadowRoot.querySelector('webhid-axis-mapper');
    const axisOptions = [...axes.shadowRoot.querySelectorAll('[data-field="device"] option')].map(option => option.textContent);
    return {
      before,
      rowsAfter,
      rawAfter: document.querySelector('#debug').textContent,
      axisOptions,
      wheelId: wheelEntry.id,
      pedalId: pedalEntry.id,
      sessionStillKnown: !!manager.sessions.get(pedalEntry.id)
    };
  });

  expect(result.before).toContain('Offline Pedals');
  expect(result.rowsAfter.some(text => text.includes('Offline Pedals'))).toBe(false);
  expect(result.rowsAfter.some(text => text.includes('Offline Wheel'))).toBe(true);
  expect(result.rawAfter).toContain('Offline Wheel');
  expect(result.axisOptions.some(text => text.includes('Offline Pedals'))).toBe(false);
  expect(result.sessionStillKnown).toBe(true);
});

test('tabbed config switches panels while devices and profiles stay visible', async ({ page }) => {
  await page.goto('/');
  const panel = page.locator('webhid-config-panel');
  const wheelTab = panel.getByRole('tab', { name: 'Wheel' });
  const axesTab = panel.getByRole('tab', { name: 'Pedals & axes' });
  const buttonsTab = panel.getByRole('tab', { name: 'Buttons' });

  await expect(wheelTab).toHaveAttribute('aria-selected', 'true');
  await expect(panel.locator('[data-panel="wheel"]')).toBeVisible();
  await expect(panel.locator('[data-panel="axes"]')).toBeHidden();
  const profileOrder = await panel.evaluate(element => {
    const root = element.shadowRoot;
    const profile = root.querySelector('[data-role="profile-select"]');
    const tabs = root.querySelector('[role="tablist"]');
    const devices = root.querySelector('webhid-device-picker');
    return {
      beforeTabs: !!(profile.compareDocumentPosition(tabs) & Node.DOCUMENT_POSITION_FOLLOWING),
      beforeDevices: !!(profile.compareDocumentPosition(devices) & Node.DOCUMENT_POSITION_FOLLOWING)
    };
  });
  expect(profileOrder.beforeTabs).toBe(true);
  expect(profileOrder.beforeDevices).toBe(true);

  await axesTab.click();
  await expect(axesTab).toHaveAttribute('aria-selected', 'true');
  await expect(wheelTab).toHaveAttribute('aria-selected', 'false');
  await expect(panel.locator('[data-panel="wheel"]')).toBeHidden();
  await expect(panel.locator('[data-panel="axes"]')).toBeVisible();
  await expect(panel.locator('webhid-device-picker')).toBeVisible();
  await expect(panel.locator('[data-role="profile-select"]')).toBeVisible();

  await buttonsTab.click();
  await expect(panel.locator('[data-panel="axes"]')).toBeHidden();
  await expect(panel.locator('[data-panel="buttons"]')).toBeVisible();

  await buttonsTab.focus();
  await page.keyboard.press('Home');
  await expect(wheelTab).toHaveAttribute('aria-selected', 'true');
  await page.keyboard.press('ArrowRight');
  await expect(axesTab).toHaveAttribute('aria-selected', 'true');
  await page.keyboard.press('End');
  await expect(buttonsTab).toHaveAttribute('aria-selected', 'true');
  await page.keyboard.press('ArrowLeft');
  await expect(axesTab).toHaveAttribute('aria-selected', 'true');
});

test('config panel keeps the single-scroll layout without the tabbed attribute', async ({ page }) => {
  await page.goto('/');
  const result = await page.evaluate(async () => {
    const panel = document.createElement('webhid-config-panel');
    document.body.append(panel);
    await new Promise(resolve => requestAnimationFrame(resolve));
    return {
      tabs: panel.shadowRoot.querySelectorAll('[role="tablist"]').length,
      steering: !!panel.shadowRoot.querySelector('webhid-steering-config'),
      axes: !!panel.shadowRoot.querySelector('webhid-axis-mapper'),
      buttons: !!panel.shadowRoot.querySelector('webhid-button-mapper')
    };
  });
  expect(result.tabs).toBe(0);
  expect(result.steering).toBe(true);
  expect(result.axes).toBe(true);
  expect(result.buttons).toBe(true);
});

test('config panel has no status banner and disables profile actions without a device', async ({ page }) => {
  await page.goto('/');
  const panel = page.locator('webhid-config-panel');
  const hasStatus = await page.evaluate(() =>
    !!document.querySelector('webhid-config-panel')?.shadowRoot?.querySelector('[data-role="status"]')
  );
  expect(hasStatus).toBe(false);
  await expect(panel.locator('[data-action="save"]')).toBeDisabled();
  await expect(panel.locator('.profiles [data-action="export"]')).toBeDisabled();

  await page.evaluate(async () => {
    const manager = window.__webhidDemo.manager;
    const usage = (page, id) => (page << 16) | id;
    const item = (usages, reportSize) => ({ usages, reportSize, reportCount: 1, logicalMinimum: 0, logicalMaximum: (1 << reportSize) - 1 });
    const fake = {
      collections: [{
        usagePage: 1,
        usage: 4,
        inputReports: [{ reportId: 1, items: [item([usage(1, 0x30)], 16), item([usage(9, 1)], 1)] }],
        outputReports: [],
        featureReports: []
      }],
      productName: 'Action Wheel',
      vendorId: 0x6001,
      productId: 0x7001,
      opened: false,
      oninputreport: null,
      async open() { this.opened = true; },
      async close() { this.opened = false; },
      async sendReport() {}
    };
    await manager.connect(fake);
  });

  await expect(panel.locator('[data-action="save"]')).toBeEnabled();
  await expect(panel.locator('.profiles [data-action="export"]')).toBeEnabled();
});

test('device picker uses a simple empty state without a status panel', async ({ page }) => {
  await page.goto('/');
  const result = await page.evaluate(async () => {
    const picker = document.createElement('webhid-device-picker');
    const manager = {
      sessionList: [],
      options: { filters: [] },
      on() {},
      off() {},
      connect: async () => null
    };
    picker.manager = manager;
    document.body.append(picker);
    await new Promise(resolve => requestAnimationFrame(resolve));
    const before = picker.shadowRoot.querySelector('[data-role="list"]').textContent.trim();
    let authorizationEvent = false;
    picker.addEventListener('webhid-authorization-required', () => { authorizationEvent = true; });
    picker.shadowRoot.querySelector('[data-action="connect"]').click();
    await new Promise(resolve => setTimeout(resolve, 30));
    return {
      before,
      after: picker.shadowRoot.querySelector('[data-role="list"]').textContent.trim(),
      statusPanel: !!picker.shadowRoot.querySelector('[data-role="status"]'),
      authorizationEvent
    };
  });
  expect(result.before).toBe('No devices added');
  expect(result.after).toBe('No devices added');
  expect(result.statusPanel).toBe(false);
  expect(result.authorizationEvent).toBe(true);
});

test('device picker explains the unsupported WebHID state', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'hid', { value: undefined, configurable: true });
  });
  await page.goto('/');
  const result = await page.evaluate(() => {
    const panel = document.querySelector('webhid-config-panel');
    const picker = panel?.shadowRoot?.querySelector('webhid-device-picker');
    const connect = picker?.shadowRoot?.querySelector('[data-action="connect"]');
    const badge = picker?.shadowRoot?.querySelector('[data-role="hid-state"]');
    const list = picker?.shadowRoot?.querySelector('[data-role="list"]');
    return {
      disabled: !!connect?.disabled,
      title: connect?.title || '',
      badge: badge?.textContent || '',
      list: list?.textContent.trim() || ''
    };
  });
  expect(result.disabled).toBe(true);
  expect(result.title).toContain('not available');
  expect(result.badge).toBe('WebHID unavailable');
  expect(result.list).toBe('No devices added');
});

test('device picker distinguishes WebHID from missing requestDevice', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'hid', {
      value: { getDevices: async () => [] },
      configurable: true
    });
  });
  await page.goto('/');
  const result = await page.evaluate(() => {
    const panel = document.querySelector('webhid-config-panel');
    const picker = panel?.shadowRoot?.querySelector('webhid-device-picker');
    const connect = picker?.shadowRoot?.querySelector('[data-action="connect"]');
    const badge = picker?.shadowRoot?.querySelector('[data-role="hid-state"]');
    const list = picker?.shadowRoot?.querySelector('[data-role="list"]');
    return {
      disabled: !!connect?.disabled,
      title: connect?.title || '',
      badge: badge?.textContent || '',
      list: list?.textContent.trim() || ''
    };
  });
  expect(result.disabled).toBe(true);
  expect(result.badge).toBe('WebHID available');
  expect(result.list).toBe('No devices added');
  expect(result.title).toContain('Device selection is not available');
});

test('device pills show only relevant capabilities and no connection state pill', async ({ page }) => {
  await page.goto('/');
  const result = await page.evaluate(async () => {
    const manager = window.__webhidDemo.manager;
    const usage = (page, id) => (page << 16) | id;
    const item = (usages, reportSize, reportCount = 1) => ({ usages, reportSize, reportCount, logicalMinimum: 0, logicalMaximum: (1 << reportSize) - 1 });
    const fake = (name, descriptor, vendorId, productId) => ({
      collections: descriptor,
      productName: name,
      vendorId,
      productId,
      opened: false,
      oninputreport: null,
      async open() { this.opened = true; },
      async close() { this.opened = false; },
      async sendReport() {}
    });
    await manager.connect(fake('Pill Wheel', [{
      usagePage: 1,
      usage: 4,
      inputReports: [{ reportId: 1, items: [item([usage(1, 0x30)], 16), item([usage(9, 1)], 1, 8)] }],
      outputReports: [],
      featureReports: []
    }], 0x8001, 0x9001));
    await manager.connect(fake('Pill Pedals', [{
      usagePage: 1,
      usage: 5,
      inputReports: [{ reportId: 2, items: [item([usage(1, 0x32)], 8)] }],
      outputReports: [],
      featureReports: []
    }], 0x8002, 0x9002));
    await new Promise(resolve => setTimeout(resolve, 40));

    const panel = document.querySelector('webhid-config-panel');
    const picker = panel.shadowRoot.querySelector('webhid-device-picker');
    const rows = [...picker.shadowRoot.querySelectorAll('[data-select]')];
    return rows.map(row => ({
      name: row.querySelector('.device-name').textContent,
      meta: row.querySelector('.device-id').textContent,
      pills: [...row.querySelectorAll('.cap')].map(pill => pill.textContent)
    }));
  });

  const wheel = result.find(row => row.name === 'Pill Wheel');
  const pedals = result.find(row => row.name === 'Pill Pedals');
  expect(wheel.pills).toEqual(['steering', 'input']);
  expect(pedals.pills).toEqual(['input']);
  expect(wheel.meta).toMatch(/^0x8001:0x9001 · wheel · #[0-9a-f]{6}$/);
  expect(pedals.meta).toMatch(/^0x8002:0x9002 · HID device · #[0-9a-f]{6}$/);
  expect(wheel.meta).not.toContain('device-');
  expect(result.flatMap(row => row.pills)).not.toContain('on');
  expect(result.flatMap(row => row.pills)).not.toContain('off');
});

test('remove works while a device selection is pending', async ({ page }) => {
  await page.goto('/');
  const result = await page.evaluate(async () => {
    const manager = window.__webhidDemo.manager;
    const usage = (page, id) => (page << 16) | id;
    const item = (usages, reportSize, reportCount = 1) => ({ usages, reportSize, reportCount, logicalMinimum: 0, logicalMaximum: (1 << reportSize) - 1 });
    const fake = {
      collections: [{
        usagePage: 1,
        usage: 4,
        inputReports: [{ reportId: 1, items: [item([usage(1, 0x30)], 16)] }],
        outputReports: [],
        featureReports: []
      }],
      productName: 'Pending Remove Wheel',
      vendorId: 0xa001,
      productId: 0xb001,
      opened: false,
      oninputreport: null,
      async open() { this.opened = true; },
      async close() { this.opened = false; },
      async sendReport() {}
    };
    await manager.connect(fake);
    await new Promise(resolve => setTimeout(resolve, 40));

    manager.connect = () => new Promise(() => {});
    const panel = document.querySelector('webhid-config-panel');
    const picker = panel.shadowRoot.querySelector('webhid-device-picker');
    picker.shadowRoot.querySelector('[data-action="connect"]').click();
    await new Promise(resolve => setTimeout(resolve, 20));

    const busyBefore = picker._busy;
    const remove = picker.shadowRoot.querySelector('[data-action="remove-session"]');
    const removeEnabled = !!remove && !remove.disabled;
    remove.click();
    await new Promise(resolve => setTimeout(resolve, 60));

    return {
      busyBefore,
      busyAfter: picker._busy,
      removeEnabled,
      list: picker.shadowRoot.querySelector('[data-role="list"]').textContent.trim(),
      connected: manager.isConnected
    };
  });

  expect(result.busyBefore).toBe(true);
  expect(result.removeEnabled).toBe(true);
  expect(result.list).toBe('No devices added');
  expect(result.connected).toBe(false);
});

test('remove hides the device immediately even if disconnect hangs', async ({ page }) => {
  await page.goto('/');
  const result = await page.evaluate(async () => {
    const manager = window.__webhidDemo.manager;
    const usage = (page, id) => (page << 16) | id;
    const item = (usages, reportSize, reportCount = 1) => ({ usages, reportSize, reportCount, logicalMinimum: 0, logicalMaximum: (1 << reportSize) - 1 });
    const fake = {
      collections: [{
        usagePage: 1,
        usage: 4,
        inputReports: [{ reportId: 1, items: [item([usage(1, 0x30)], 16)] }],
        outputReports: [],
        featureReports: []
      }],
      productName: 'Hung Disconnect Wheel',
      vendorId: 0xc001,
      productId: 0xd001,
      opened: false,
      oninputreport: null,
      async open() { this.opened = true; },
      async close() { this.opened = false; },
      async sendReport() {}
    };
    await manager.connect(fake);
    await new Promise(resolve => setTimeout(resolve, 40));
    manager.disconnect = () => new Promise(() => {});
    const panel = document.querySelector('webhid-config-panel');
    const picker = panel.shadowRoot.querySelector('webhid-device-picker');
    const remove = picker.shadowRoot.querySelector('[data-action="remove-session"]');
    remove.click();
    await new Promise(resolve => setTimeout(resolve, 40));
    return {
      list: picker.shadowRoot.querySelector('[data-role="list"]').textContent.trim(),
      removing: picker._removing.size
    };
  });
  expect(result.list).toBe('No devices added');
  expect(result.removing).toBe(1);
});

test('device list stays stable while input is flowing so Remove can be clicked', async ({ page }) => {
  await page.goto('/');
  const result = await page.evaluate(async () => {
    const manager = window.__webhidDemo.manager;
    const usage = (page, id) => (page << 16) | id;
    const item = (usages, reportSize, reportCount = 1) => ({ usages, reportSize, reportCount, logicalMinimum: 0, logicalMaximum: (1 << reportSize) - 1 });
    const fake = {
      collections: [{
        usagePage: 1,
        usage: 4,
        inputReports: [{ reportId: 1, items: [item([usage(1, 0x30)], 16), item([usage(9, 1)], 1, 8)] }],
        outputReports: [],
        featureReports: []
      }],
      productName: 'Streaming Wheel',
      vendorId: 0xe001,
      productId: 0xf001,
      opened: false,
      oninputreport: null,
      async open() { this.opened = true; },
      async close() { this.opened = false; },
      async sendReport() {}
    };
    await manager.connect(fake);
    await new Promise(resolve => setTimeout(resolve, 40));
    const panel = document.querySelector('webhid-config-panel');
    const picker = panel.shadowRoot.querySelector('webhid-device-picker');
    const before = picker.shadowRoot.querySelector('[data-action="remove-session"]');
    fake.oninputreport({ data: new DataView(Uint8Array.from([0, 128, 0, 0, 0]).buffer), timeStamp: 1, reportId: 1 });
    await new Promise(resolve => requestAnimationFrame(resolve));
    await new Promise(resolve => setTimeout(resolve, 20));
    const after = picker.shadowRoot.querySelector('[data-action="remove-session"]');
    after.click();
    await new Promise(resolve => setTimeout(resolve, 80));
    return {
      sameNode: before === after,
      list: picker.shadowRoot.querySelector('[data-role="list"]').textContent.trim(),
      connected: manager.isConnected
    };
  });
  expect(result.sameNode).toBe(true);
  expect(result.list).toBe('No devices added');
  expect(result.connected).toBe(false);
});

test('a dismissed device does not auto-restore after reload', async ({ page }) => {
  await page.addInitScript(() => {
    const usage = (page, id) => (page << 16) | id;
    const item = (usages, reportSize, reportCount = 1) => ({
      usages, reportSize, reportCount, logicalMinimum: 0, logicalMaximum: (1 << reportSize) - 1
    });
    const makeDevice = () => ({
      collections: [{
        usagePage: 1,
        usage: 4,
        inputReports: [{ reportId: 1, items: [item([usage(1, 0x30)], 16), item([usage(9, 1)], 1, 8)] }],
        outputReports: [],
        featureReports: []
      }],
      productName: 'Persisted Wheel',
      vendorId: 0x0e01,
      productId: 0x0f01,
      opened: false,
      oninputreport: null,
      async open() { this.opened = true; },
      async close() { this.opened = false; },
      async sendReport() {}
    });
    Object.defineProperty(navigator, 'hid', {
      configurable: true,
      value: {
        getDevices: async () => [makeDevice()],
        requestDevice: async () => [],
        addEventListener() {},
        removeEventListener() {}
      }
    });
  });

  await page.goto('/');
  await expect(page.locator('webhid-config-panel').locator('webhid-device-picker')).toContainText('Persisted Wheel');
  const dismissed = await page.evaluate(() => {
    const picker = document.querySelector('webhid-config-panel').shadowRoot.querySelector('webhid-device-picker');
    picker.shadowRoot.querySelector('[data-action="remove-session"]').click();
    return new Promise(resolve => setTimeout(() => {
      resolve(localStorage.getItem('webhid-wheel:dismissed:v1'));
    }, 80));
  });
  expect(dismissed).toBeTruthy();
  expect(JSON.parse(dismissed).length).toBeGreaterThan(0);

  await page.reload();
  await page.waitForTimeout(150);
  const afterReload = await page.evaluate(() => {
    const picker = document.querySelector('webhid-config-panel').shadowRoot.querySelector('webhid-device-picker');
    return {
      list: picker.shadowRoot.querySelector('[data-role="list"]').textContent.trim(),
      connected: window.__webhidDemo.manager.isConnected
    };
  });
  expect(afterReload.list).toBe('No devices added');
  expect(afterReload.connected).toBe(false);
});

test('settings are not saved until Save is clicked', async ({ page }) => {
  await page.goto('/');
  const result = await page.evaluate(async () => {
    localStorage.removeItem('webhid-wheel:v3:profiles');
    const manager = window.__webhidDemo.manager;
    const usage = (page, id) => (page << 16) | id;
    const item = (usages, reportSize, reportCount = 1) => ({ usages, reportSize, reportCount, logicalMinimum: 0, logicalMaximum: (1 << reportSize) - 1 });
    const fake = {
      collections: [{
        usagePage: 1,
        usage: 4,
        inputReports: [{ reportId: 1, items: [item([usage(1, 0x30)], 16), item([usage(9, 1)], 1, 8)] }],
        outputReports: [],
        featureReports: []
      }],
      productName: 'Auto Save Wheel',
      vendorId: 0x0b01,
      productId: 0x0c01,
      opened: false,
      oninputreport: null,
      async open() { this.opened = true; },
      async close() { this.opened = false; },
      async sendReport() {}
    };
    await manager.connect(fake);
    await new Promise(resolve => setTimeout(resolve, 50));
    const panel = document.querySelector('webhid-config-panel');
    const steering = panel.shadowRoot.querySelector('webhid-steering-config');
    const deadzone = steering.shadowRoot.querySelector('[data-setting="deadzone"]');
    deadzone.value = '0.2';
    deadzone.dispatchEvent(new Event('input', { bubbles: true }));
    await new Promise(resolve => setTimeout(resolve, 700));
    const beforeSave = localStorage.getItem('webhid-wheel:v3:profiles');
    panel.shadowRoot.querySelector('[data-action="save"]').click();
    await new Promise(resolve => setTimeout(resolve, 60));
    const raw = localStorage.getItem('webhid-wheel:v3:profiles');
    return { beforeSave, afterSave: raw ? JSON.parse(raw) : null };
  });
  expect(result.beforeSave).toBeNull();
  expect(result.afterSave).toBeTruthy();
  expect(result.afterSave.profiles[0].settings.steering.deadzone).toBeCloseTo(0.2);
});

test('all granted input devices restore on load', async ({ page }) => {
  await page.addInitScript(() => {
    const usage = (page, id) => (page << 16) | id;
    const item = (usages, reportSize, reportCount = 1) => ({ usages, reportSize, reportCount, logicalMinimum: 0, logicalMaximum: (1 << reportSize) - 1 });
    const base = (name, descriptor, vendorId, productId) => ({
      collections: descriptor,
      productName: name,
      vendorId,
      productId,
      opened: false,
      oninputreport: null,
      async open() { this.opened = true; },
      async close() { this.opened = false; },
      async sendReport() {}
    });
    Object.defineProperty(navigator, 'hid', {
      configurable: true,
      value: {
        getDevices: async () => [
          base('Restore Wheel', [{
            usagePage: 1,
            usage: 4,
            inputReports: [{ reportId: 1, items: [item([usage(1, 0x30)], 16)] }],
            outputReports: [],
            featureReports: []
          }], 0x1101, 0x1201),
          base('Restore Pedals', [{
            usagePage: 1,
            usage: 5,
            inputReports: [{ reportId: 2, items: [item([usage(1, 0x32)], 8)] }],
            outputReports: [],
            featureReports: []
          }], 0x1102, 0x1202),
          base('Restore Button Box', [{
            usagePage: 0xff00,
            usage: 1,
            inputReports: [{ reportId: 3, items: [item([usage(9, 1)], 1, 8)] }],
            outputReports: [],
            featureReports: []
          }], 0x1103, 0x1203)
        ],
        requestDevice: async () => [],
        addEventListener() {},
        removeEventListener() {}
      }
    });
  });
  await page.goto('/');
  await page.waitForTimeout(250);
  const names = await page.evaluate(() => {
    const picker = document.querySelector('webhid-config-panel').shadowRoot.querySelector('webhid-device-picker');
    return [...picker.shadowRoot.querySelectorAll('[data-select] .device-name')].map(node => node.textContent);
  });
  expect(names).toEqual(expect.arrayContaining(['Restore Wheel', 'Restore Pedals', 'Restore Button Box']));
  expect(names.length).toBe(3);
});

test('typing a profile name is not saved until Save is clicked', async ({ page }) => {
  await page.goto('/');
  const result = await page.evaluate(async () => {
    const manager = window.__webhidDemo.manager;
    const usage = (page, id) => (page << 16) | id;
    const item = (usages, reportSize, reportCount = 1) => ({ usages, reportSize, reportCount, logicalMinimum: 0, logicalMaximum: (1 << reportSize) - 1 });
    const fake = {
      collections: [{
        usagePage: 1,
        usage: 4,
        inputReports: [{ reportId: 1, items: [item([usage(1, 0x30)], 16)] }],
        outputReports: [],
        featureReports: []
      }],
      productName: 'Named Save Wheel',
      vendorId: 0x1301,
      productId: 0x1401,
      opened: false,
      oninputreport: null,
      async open() { this.opened = true; },
      async close() { this.opened = false; },
      async sendReport() {}
    };
    await manager.connect(fake);
    await new Promise(resolve => setTimeout(resolve, 40));
    const panel = document.querySelector('webhid-config-panel');
    const name = panel.shadowRoot.querySelector('[data-role="name"]');
    name.value = 'My Named Setup';
    name.dispatchEvent(new Event('input', { bubbles: true }));
    await new Promise(resolve => setTimeout(resolve, 700));
    const beforeSave = localStorage.getItem('webhid-wheel:v3:profiles');
    panel.shadowRoot.querySelector('[data-action="save"]').click();
    await new Promise(resolve => setTimeout(resolve, 60));
    const raw = localStorage.getItem('webhid-wheel:v3:profiles');
    const store = raw ? JSON.parse(raw) : null;
    return {
      beforeSave,
      active: store?.activeProfile,
      select: panel.shadowRoot.querySelector('[data-role="profile-select"]').value
    };
  });
  expect(result.beforeSave).toBeNull();
  expect(result.active).toBe('My Named Setup');
  expect(result.select).toBe('My Named Setup');
});

test('loading a profile replaces the device list with its devices', async ({ page }) => {
  await page.goto('/');
  const result = await page.evaluate(async () => {
    const manager = window.__webhidDemo.manager;
    const usage = (page, id) => (page << 16) | id;
    const item = (usages, reportSize, reportCount = 1) => ({ usages, reportSize, reportCount, logicalMinimum: 0, logicalMaximum: (1 << reportSize) - 1 });
    const fake = (name, descriptor, vendorId, productId) => ({
      collections: descriptor,
      productName: name,
      vendorId,
      productId,
      opened: false,
      oninputreport: null,
      async open() { this.opened = true; },
      async close() { this.opened = false; },
      async sendReport() {}
    });
    const wheel = fake('Replace Wheel', [{
      usagePage: 1,
      usage: 4,
      inputReports: [{ reportId: 1, items: [item([usage(1, 0x30)], 16)] }],
      outputReports: [],
      featureReports: []
    }], 0x1501, 0x1601);
    const pedals = fake('Replace Pedals', [{
      usagePage: 1,
      usage: 5,
      inputReports: [{ reportId: 2, items: [item([usage(1, 0x32)], 8)] }],
      outputReports: [],
      featureReports: []
    }], 0x1502, 0x1602);
    await manager.connect(wheel);
    await manager.connect(pedals);
    await new Promise(resolve => setTimeout(resolve, 40));

    const profile = manager.toSetup({ profileName: 'Wheel Only' });
    Object.defineProperty(navigator.hid, 'getDevices', {
      configurable: true,
      value: async () => [wheel, pedals]
    });

    const panel = document.querySelector('webhid-config-panel');
    const store = {
      kind: 'webhid-wheel-profile-store',
      schemaVersion: 2,
      activeProfile: 'Wheel Only',
      profiles: [profile]
    };
    panel.profiles.saveStore(store);
    panel._store = store;
    panel._refreshProfileSelect();
    await panel._selectProfile('Wheel Only');
    await new Promise(resolve => setTimeout(resolve, 80));

    const picker = panel.shadowRoot.querySelector('webhid-device-picker');
    return {
      connected: manager.sessionList.filter(entry => entry.session && entry.session.isConnected).map(entry => entry.name),
      list: picker.shadowRoot.querySelector('[data-role="list"]').textContent
    };
  });
  expect(result.connected).toEqual(['Replace Wheel']);
  expect(result.list).toContain('Replace Wheel');
  expect(result.list).not.toContain('Replace Pedals');
});

test('an active profile limits restore to its devices after reload', async ({ page }) => {
  await page.addInitScript(() => {
    const usage = (page, id) => (page << 16) | id;
    const item = (usages, reportSize, reportCount = 1) => ({ usages, reportSize, reportCount, logicalMinimum: 0, logicalMaximum: (1 << reportSize) - 1 });
    const base = (name, descriptor, vendorId, productId) => ({
      collections: descriptor,
      productName: name,
      vendorId,
      productId,
      opened: false,
      oninputreport: null,
      async open() { this.opened = true; },
      async close() { this.opened = false; },
      async sendReport() {}
    });
    Object.defineProperty(navigator, 'hid', {
      configurable: true,
      value: {
        getDevices: async () => [
          base('Profile Wheel', [{
            usagePage: 1,
            usage: 4,
            inputReports: [{ reportId: 1, items: [item([usage(1, 0x30)], 16)] }],
            outputReports: [],
            featureReports: []
          }], 0x1701, 0x1801),
          base('Profile Pedals', [{
            usagePage: 1,
            usage: 5,
            inputReports: [{ reportId: 2, items: [item([usage(1, 0x32)], 8)] }],
            outputReports: [],
            featureReports: []
          }], 0x1702, 0x1802)
        ],
        requestDevice: async () => [],
        addEventListener() {},
        removeEventListener() {}
      }
    });
  });

  await page.goto('/');
  await page.evaluate(() => {
    const profile = {
      kind: 'webhid-wheel-profile',
      schemaVersion: 2,
      profileName: 'Only Wheel',
      devices: [{
        alias: 'd1',
        driver: 'wheel',
        hardware: { vendorId: 0x1701, productId: 0x1801, productName: 'Profile Wheel', signature: null }
      }],
      settings: {
        steering: { device: 'd1', deadzone: 0, saturation: 1, maxRotation: 900, invert: false },
        ffb: { device: 'd1', gain: 0.25, invert: false },
        axes: {},
        buttons: {}
      },
      metadata: {}
    };
    localStorage.setItem('webhid-wheel:v3:profiles', JSON.stringify({
      kind: 'webhid-wheel-profile-store',
      schemaVersion: 2,
      activeProfile: 'Only Wheel',
      profiles: [profile]
    }));
  });
  await page.reload();
  await page.waitForTimeout(250);
  const result = await page.evaluate(() => {
    const manager = window.__webhidDemo.manager;
    const picker = document.querySelector('webhid-config-panel').shadowRoot.querySelector('webhid-device-picker');
    return {
      connected: manager.sessionList.filter(entry => entry.session && entry.session.isConnected).map(entry => entry.name),
      list: picker.shadowRoot.querySelector('[data-role="list"]').textContent
    };
  });
  expect(result.connected).toEqual(['Profile Wheel']);
  expect(result.list).toContain('Profile Wheel');
  expect(result.list).not.toContain('Profile Pedals');
});

test('a profile device that is offline remains listed after reload', async ({ page }) => {
  await page.addInitScript(() => {
    const usage = (page, id) => (page << 16) | id;
    const item = (usages, reportSize, reportCount = 1) => ({ usages, reportSize, reportCount, logicalMinimum: 0, logicalMaximum: (1 << reportSize) - 1 });
    const makeDevice = () => ({
      collections: [{
        usagePage: 1,
        usage: 4,
        inputReports: [{ reportId: 1, items: [item([usage(1, 0x30)], 16)] }],
        outputReports: [],
        featureReports: []
      }],
      productName: 'Offline Profile Wheel',
      vendorId: 0x2101,
      productId: 0x2201,
      opened: false,
      oninputreport: null,
      async open() { this.opened = true; },
      async close() { this.opened = false; },
      async sendReport() {}
    });
    Object.defineProperty(navigator, 'hid', {
      configurable: true,
      value: {
        getDevices: async () => localStorage.getItem('test-offline') === '1' ? [] : [makeDevice()],
        requestDevice: async () => [],
        addEventListener() {},
        removeEventListener() {}
      }
    });
  });

  await page.goto('/');
  await page.waitForTimeout(150);
  await page.evaluate(() => {
    const manager = window.__webhidDemo.manager;
    const profile = manager.toSetup({ profileName: 'Offline Profile' });
    localStorage.setItem('webhid-wheel:v3:profiles', JSON.stringify({
      kind: 'webhid-wheel-profile-store',
      schemaVersion: 2,
      activeProfile: profile.profileName,
      profiles: [profile]
    }));
    localStorage.setItem('test-offline', '1');
  });
  await page.reload();
  await page.waitForTimeout(200);
  const result = await page.evaluate(() => {
    const picker = document.querySelector('webhid-config-panel').shadowRoot.querySelector('webhid-device-picker');
    return {
      list: picker.shadowRoot.querySelector('[data-role="list"]').textContent,
      pills: [...picker.shadowRoot.querySelectorAll('.cap')].map(pill => pill.textContent),
      connected: window.__webhidDemo.manager.isConnected,
      hasConnect: !!picker.shadowRoot.querySelector('[data-action="connect-profile"]')
    };
  });
  expect(result.list).toContain('Offline Profile Wheel');
  expect(result.list).toContain('offline');
  expect(result.pills).toContain('offline');
  expect(result.connected).toBe(false);
  expect(result.hasConnect).toBe(true);
});

test('removing a device does not change the stored profile until Save', async ({ page }) => {
  await page.addInitScript(() => {
    const usage = (page, id) => (page << 16) | id;
    const item = (usages, reportSize, reportCount = 1) => ({ usages, reportSize, reportCount, logicalMinimum: 0, logicalMaximum: (1 << reportSize) - 1 });
    const make = (name, descriptor, vendorId, productId) => ({
      collections: descriptor,
      productName: name,
      vendorId,
      productId,
      opened: false,
      oninputreport: null,
      async open() { this.opened = true; },
      async close() { this.opened = false; },
      async sendReport() {}
    });
    Object.defineProperty(navigator, 'hid', {
      configurable: true,
      value: {
        getDevices: async () => [
          make('Keep Wheel', [{
            usagePage: 1,
            usage: 4,
            inputReports: [{ reportId: 1, items: [item([usage(1, 0x30)], 16)] }],
            outputReports: [],
            featureReports: []
          }], 0x2301, 0x2401),
          make('Remove Pedals', [{
            usagePage: 1,
            usage: 5,
            inputReports: [{ reportId: 2, items: [item([usage(1, 0x32)], 8)] }],
            outputReports: [],
            featureReports: []
          }], 0x2302, 0x2402)
        ],
        requestDevice: async () => [],
        addEventListener() {},
        removeEventListener() {}
      }
    });
  });

  await page.goto('/');
  await page.waitForTimeout(150);
  await page.evaluate(() => {
    const profile = {
      kind: 'webhid-wheel-profile',
      schemaVersion: 2,
      profileName: 'Remove Profile',
      devices: [
        { alias: 'd1', driver: 'wheel', hardware: { vendorId: 0x2301, productId: 0x2401, productName: 'Keep Wheel', signature: null } },
        { alias: 'd2', driver: 'generic', hardware: { vendorId: 0x2302, productId: 0x2402, productName: 'Remove Pedals', signature: null } }
      ],
      settings: {
        steering: { device: 'd1', deadzone: 0, saturation: 1, maxRotation: 900, invert: false },
        ffb: { device: 'd1', gain: 0.25, invert: false },
        axes: { throttle: { device: 'd2', source: 'axis', index: 0 } },
        buttons: {}
      },
      metadata: {}
    };
    localStorage.setItem('webhid-wheel:v3:profiles', JSON.stringify({
      kind: 'webhid-wheel-profile-store',
      schemaVersion: 2,
      activeProfile: profile.profileName,
      profiles: [profile]
    }));
  });
  await page.reload();
  await page.waitForTimeout(200);

  const beforeSave = await page.evaluate(async () => {
    const picker = document.querySelector('webhid-config-panel').shadowRoot.querySelector('webhid-device-picker');
    const row = [...picker.shadowRoot.querySelectorAll('[data-select]')].find(item => item.textContent.includes('Remove Pedals'));
    row.querySelector('[data-action="remove-session"]').click();
    await new Promise(resolve => setTimeout(resolve, 150));
    return {
      connected: window.__webhidDemo.manager.sessionList.filter(entry => entry.session.isConnected).map(entry => entry.name),
      list: picker.shadowRoot.querySelector('[data-role="list"]').textContent,
      store: JSON.parse(localStorage.getItem('webhid-wheel:v3:profiles'))
    };
  });
  expect(beforeSave.list).not.toContain('Remove Pedals');
  expect(beforeSave.store.profiles[0].devices.length).toBe(2);

  const afterSave = await page.evaluate(async () => {
    const panel = document.querySelector('webhid-config-panel');
    panel.shadowRoot.querySelector('[data-action="save"]').click();
    await new Promise(resolve => setTimeout(resolve, 100));
    return JSON.parse(localStorage.getItem('webhid-wheel:v3:profiles'));
  });
  expect(afterSave.profiles[0].devices.length).toBe(1);
  expect(afterSave.profiles[0].devices[0].hardware.productName).toBe('Keep Wheel');
  expect(afterSave.profiles[0].settings.axes.throttle).toBeUndefined();
});

test('Save keeps profile devices that are currently offline', async ({ page }) => {
  await page.addInitScript(() => {
    const usage = (page, id) => (page << 16) | id;
    const item = (usages, reportSize, reportCount = 1) => ({ usages, reportSize, reportCount, logicalMinimum: 0, logicalMaximum: (1 << reportSize) - 1 });
    const wheel = {
      collections: [{
        usagePage: 1,
        usage: 4,
        inputReports: [{ reportId: 1, items: [item([usage(1, 0x30)], 16)] }],
        outputReports: [],
        featureReports: []
      }],
      productName: 'Saved Wheel',
      vendorId: 0x2501,
      productId: 0x2601,
      opened: false,
      oninputreport: null,
      async open() { this.opened = true; },
      async close() { this.opened = false; },
      async sendReport() {}
    };
    Object.defineProperty(navigator, 'hid', {
      configurable: true,
      value: {
        getDevices: async () => [wheel],
        requestDevice: async () => [],
        addEventListener() {},
        removeEventListener() {}
      }
    });
  });

  await page.goto('/');
  await page.evaluate(() => {
    const profile = {
      kind: 'webhid-wheel-profile',
      schemaVersion: 2,
      profileName: 'Two Device Profile',
      devices: [
        { alias: 'd1', driver: 'wheel', hardware: { vendorId: 0x2501, productId: 0x2601, productName: 'Saved Wheel', signature: null } },
        { alias: 'd2', driver: 'generic', hardware: { vendorId: 0x2502, productId: 0x2602, productName: 'Saved Pedals', signature: null } }
      ],
      settings: {
        steering: { device: 'd1', deadzone: 0, saturation: 1, maxRotation: 900, invert: false },
        ffb: { device: 'd1', gain: 0.25, invert: false },
        axes: { throttle: { device: 'd2', source: 'axis', index: 0 } },
        buttons: {}
      },
      metadata: {}
    };
    localStorage.setItem('webhid-wheel:v3:profiles', JSON.stringify({
      kind: 'webhid-wheel-profile-store',
      schemaVersion: 2,
      activeProfile: profile.profileName,
      profiles: [profile]
    }));
  });
  await page.reload();
  await page.waitForTimeout(200);
  const result = await page.evaluate(async () => {
    const panel = document.querySelector('webhid-config-panel');
    panel.shadowRoot.querySelector('[data-action="save"]').click();
    await new Promise(resolve => setTimeout(resolve, 80));
    const store = JSON.parse(localStorage.getItem('webhid-wheel:v3:profiles'));
    return {
      devices: store.profiles[0].devices.map(device => device.hardware.productName),
      list: panel.shadowRoot.querySelector('webhid-device-picker').shadowRoot.querySelector('[data-role="list"]').textContent
    };
  });
  expect(result.devices).toEqual(expect.arrayContaining(['Saved Wheel', 'Saved Pedals']));
  expect(result.devices.length).toBe(2);
  expect(result.list).toContain('Saved Pedals');
  expect(result.list).toContain('offline');
});

test('delete removes the active profile from storage', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => {
    const profile = {
      kind: 'webhid-wheel-profile',
      schemaVersion: 2,
      profileName: 'Delete Me',
      devices: [{
        alias: 'd1',
        driver: 'wheel',
        hardware: { vendorId: 0x3101, productId: 0x3201, productName: 'Delete Wheel', signature: null }
      }],
      settings: {
        steering: { device: 'd1', deadzone: 0, saturation: 1, maxRotation: 900, invert: false },
        ffb: { device: 'd1', gain: 0.25, invert: false },
        axes: {},
        buttons: {}
      },
      metadata: {}
    };
    localStorage.setItem('webhid-wheel:v3:profiles', JSON.stringify({
      kind: 'webhid-wheel-profile-store',
      schemaVersion: 2,
      activeProfile: profile.profileName,
      profiles: [profile]
    }));
  });
  await page.reload();
  await page.waitForTimeout(150);
  const result = await page.evaluate(async () => {
    const panel = document.querySelector('webhid-config-panel');
    const selectBefore = panel.shadowRoot.querySelector('[data-role="profile-select"]').value;
    panel.shadowRoot.querySelector('[data-action="delete-profile"]').click();
    await new Promise(resolve => setTimeout(resolve, 80));
    return {
      selectBefore,
      store: JSON.parse(localStorage.getItem('webhid-wheel:v3:profiles')),
      selectAfter: panel.shadowRoot.querySelector('[data-role="profile-select"]').value,
      deleteDisabled: panel.shadowRoot.querySelector('[data-action="delete-profile"]').disabled
    };
  });
  expect(result.selectBefore).toBe('Delete Me');
  expect(result.store.profiles.length).toBe(0);
  expect(result.store.activeProfile).toBeNull();
  expect(result.selectAfter).toBe('');
  expect(result.deleteDisabled).toBe(true);
});

test('delete follows save and clearing the selected profile clears the name', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => {
    const profile = {
      kind: 'webhid-wheel-profile',
      schemaVersion: 2,
      profileName: 'Order Profile',
      devices: [{
        alias: 'd1',
        driver: 'wheel',
        hardware: { vendorId: 0x4101, productId: 0x4201, productName: 'Order Wheel', signature: null }
      }],
      settings: {
        steering: { device: 'd1', deadzone: 0, saturation: 1, maxRotation: 900, invert: false },
        ffb: { device: 'd1', gain: 0.25, invert: false },
        axes: {},
        buttons: {}
      },
      metadata: {}
    };
    localStorage.setItem('webhid-wheel:v3:profiles', JSON.stringify({
      kind: 'webhid-wheel-profile-store',
      schemaVersion: 2,
      activeProfile: profile.profileName,
      profiles: [profile]
    }));
  });
  await page.reload();
  await page.waitForTimeout(150);
  const result = await page.evaluate(async () => {
    const panel = document.querySelector('webhid-config-panel');
    const root = panel.shadowRoot;
    const buttons = [...root.querySelectorAll('.profiles .actions button')].map(button => button.textContent.trim());
    const name = root.querySelector('[data-role="name"]');
    const select = root.querySelector('[data-role="profile-select"]');
    const selectedName = name.value;
    name.value = 'Typed But Unsaved';
    select.value = '';
    select.dispatchEvent(new Event('change', { bubbles: true }));
    await new Promise(resolve => setTimeout(resolve, 40));
    return { buttons, selectedName, clearedName: name.value };
  });
  expect(result.buttons).toEqual(['Save', 'Delete', 'Export', 'Import']);
  expect(result.selectedName).toBe('Order Profile');
  expect(result.clearedName).toBe('');
});

test('constant force uses the same label/row layout as Force gain on mobile', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  const layout = await page.evaluate(() => {
    const input = document.querySelector('#force');
    const control = input.closest('.control');
    const label = control.querySelector('label');
    const value = control.querySelector('.val');
    const inputBox = input.getBoundingClientRect();
    const labelBox = label.getBoundingClientRect();
    const valueBox = value.getBoundingClientRect();
    const controlBox = control.getBoundingClientRect();
    return {
      inputWidth: inputBox.width,
      controlWidth: controlBox.width,
      labelAndValueSameRow: Math.abs(
        (labelBox.top + labelBox.bottom) / 2 - (valueBox.top + valueBox.bottom) / 2
      ) < 10,
      sliderBelow: inputBox.top >= labelBox.bottom
    };
  });
  expect(layout.labelAndValueSameRow).toBe(true);
  expect(layout.sliderBelow).toBe(true);
  expect(layout.inputWidth).toBeGreaterThan(layout.controlWidth * 0.9);
});

test('FFB test buttons match the component button style', async ({ page }) => {
  await page.goto('/');
  const styles = await page.evaluate(() => {
    const panel = document.querySelector('webhid-config-panel');
    const ffb = getComputedStyle(document.querySelector('#applyForce'));
    const save = getComputedStyle(panel.shadowRoot.querySelector('[data-action="save"]'));
    return {
      ffb: {
        borderRadius: ffb.borderRadius,
        fontSize: ffb.fontSize,
        minHeight: ffb.minHeight,
        padding: ffb.padding
      },
      save: {
        borderRadius: save.borderRadius,
        fontSize: save.fontSize,
        minHeight: save.minHeight,
        padding: save.padding
      }
    };
  });
  expect(styles.ffb).toEqual(styles.save);
});

test('mapping live values are centered inside desktop action rows', async ({ page }) => {
  await page.goto('/');
  const panel = page.locator('webhid-config-panel');
  const readRow = (mapperTag, selector) => panel.evaluate((element, [tag, rowSelector]) => {
    const mapper = element.shadowRoot.querySelector(tag);
    const row = mapper.shadowRoot.querySelector(rowSelector);
    const actions = row.querySelector('.actions');
    const live = row.querySelector('.live');
    const style = getComputedStyle(live);
    return {
      alignItems: getComputedStyle(actions).alignItems,
      liveHeight: live.getBoundingClientRect().height,
      lineHeight: parseFloat(style.lineHeight)
    };
  }, [mapperTag, selector]);

  const axis = await readRow('webhid-axis-mapper', '[data-channel="throttle"]');
  expect(axis.alignItems).toBe('center');
  expect(axis.liveHeight).toBeLessThanOrEqual(axis.lineHeight + 1);

  await panel.getByRole('tab', { name: 'Buttons' }).click();
  const button = await readRow('webhid-button-mapper', '[data-channel="reverse"]');
  expect(button.alignItems).toBe('center');
  expect(button.liveHeight).toBeLessThanOrEqual(button.lineHeight + 1);
});

test('mapping rows align labels and live values on mobile', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  const panel = page.locator('webhid-config-panel');
  const centerDelta = (a, b) => Math.abs((a.top + a.bottom) / 2 - (b.top + b.bottom) / 2);

  const axis = await panel.evaluate(element => {
    const mapper = element.shadowRoot.querySelector('webhid-axis-mapper');
    const row = mapper.shadowRoot.querySelector('[data-channel="throttle"]');
    const label = row.querySelector('label');
    const live = row.querySelector('.live');
    return {
      label: label.getBoundingClientRect().toJSON(),
      live: live.getBoundingClientRect().toJSON()
    };
  });
  expect(centerDelta(axis.label, axis.live)).toBeLessThan(3);

  await panel.getByRole('tab', { name: 'Buttons' }).click();
  const button = await panel.evaluate(element => {
    const mapper = element.shadowRoot.querySelector('webhid-button-mapper');
    const row = mapper.shadowRoot.querySelector('[data-channel="reverse"]');
    const label = row.querySelector('label');
    const live = row.querySelector('.live');
    return {
      label: label.getBoundingClientRect().toJSON(),
      live: live.getBoundingClientRect().toJSON()
    };
  });
  expect(centerDelta(button.label, button.live)).toBeLessThan(3);
});

test('Set and Clear stay grouped and right aligned on mobile mappings', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  const panel = page.locator('webhid-config-panel');
  const readActions = (mapperTag, selector) => panel.evaluate((element, [tag, rowSelector]) => {
    const mapper = element.shadowRoot.querySelector(tag);
    const row = mapper.shadowRoot.querySelector(rowSelector);
    const set = row.querySelector('[data-action="set"]').getBoundingClientRect();
    const clear = row.querySelector('[data-action="clear"]').getBoundingClientRect();
    const box = row.getBoundingClientRect();
    return {
      gap: clear.left - set.right,
      rightGap: box.right - clear.right
    };
  }, [mapperTag, selector]);

  const axis = await readActions('webhid-axis-mapper', '[data-channel="throttle"]');
  expect(axis.gap).toBeGreaterThanOrEqual(0);
  expect(axis.gap).toBeLessThan(12);
  expect(axis.rightGap).toBeLessThan(12);

  await panel.getByRole('tab', { name: 'Buttons' }).click();
  const button = await readActions('webhid-button-mapper', '[data-channel="reverse"]');
  expect(button.gap).toBeGreaterThanOrEqual(0);
  expect(button.gap).toBeLessThan(12);
  expect(button.rightGap).toBeLessThan(12);
});
