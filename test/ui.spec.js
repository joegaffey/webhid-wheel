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
    const status = picker?.shadowRoot?.querySelector('[data-role="status"]');
    return {
      hasHid: !!navigator.hid,
      connectDisabled: !!connect?.disabled,
      status: status?.textContent || ''
    };
  });
  if (!result.hasHid) {
    expect(result.connectDisabled).toBe(true);
    expect(result.status).toContain('WebHID is not available');
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

  await page.locator('webhid-config-panel').locator('webhid-device-picker').locator('[data-action="copy"]').click();
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

    const raw = document.querySelector('[slot="device-extra"]');
    return {
      wheelId: wheelEntry.id,
      pedalId: pedalEntry.id,
      rawText: document.querySelector('#debug').textContent,
      rawUnderDevices: !!picker.shadowRoot.querySelector('slot[name="extra"]'),
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

test('device picker reports cancelled and rejected connect attempts', async ({ page }) => {
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

    picker.shadowRoot.querySelector('[data-action="connect"]').click();
    await new Promise(resolve => setTimeout(resolve, 30));
    const cancelled = picker.shadowRoot.querySelector('[data-role="status"]').textContent;

    manager.connect = async () => {
      const error = new Error('Permission denied');
      error.name = 'NotAllowedError';
      throw error;
    };
    picker.shadowRoot.querySelector('[data-action="connect"]').click();
    await new Promise(resolve => setTimeout(resolve, 30));
    const rejected = picker.shadowRoot.querySelector('[data-role="status"]').textContent;

    return { cancelled, rejected };
  });

  expect(result.cancelled).toContain('No device selected');
  expect(result.rejected).toContain('cancelled or permission was denied');
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
    const status = picker?.shadowRoot?.querySelector('[data-role="status"]');
    return {
      disabled: !!connect?.disabled,
      title: connect?.title || '',
      status: status?.textContent || ''
    };
  });
  expect(result.disabled).toBe(true);
  expect(result.title).toContain('not available');
  expect(result.status).toContain('desktop Chrome/Edge or Chrome Beta');
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
    const status = picker?.shadowRoot?.querySelector('[data-role="status"]');
    const badge = picker?.shadowRoot?.querySelector('[data-role="hid-state"]');
    return {
      disabled: !!connect?.disabled,
      title: connect?.title || '',
      status: status?.textContent || '',
      badge: badge?.textContent || ''
    };
  });
  expect(result.disabled).toBe(true);
  expect(result.badge).toBe('WebHID available');
  expect(result.status).toContain('does not expose device selection');
  expect(result.title).toContain('Device selection is not available');
});
