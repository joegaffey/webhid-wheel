# Component integration guide

Status: current for `webhid-wheel` 0.4.39 (2026-10-29).

This is the canonical integration contract for `<webhid-config-panel>` and the
core package. It is written for application developers and for coding agents
that are wiring the package into an app. If code and this document disagree,
treat the code as a bug or update this document in the same change.

Related documents:

- [Project README](../readme.md) — overview and low-level examples.
- [Package, setup profiles and Lapster integration plan](./lapster-integration-plan.md)
  — design history and the current consumer migration.
- [HID device mapping and capture](./device-config-and-rigs.md) — data model.
- [FFB workarounds](./vendor-ffb-workarounds.md) and
  [PadForge bridge](./padforge-wheel-bridge.md) — unsupported wheels.

## 1. What you get

The package has two entries:

| Entry | Contents | DOM required |
| --- | --- | --- |
| `webhid-wheel` | `WheelManager`, `WebHIDWheel`, `WebHIDDevice`, `mapChannels`, `SetupProfileManager` / `ProfileManager`, calibration and profile helpers | No at import or construction time |
| `webhid-wheel/ui` | Registers five custom elements: `<webhid-config-panel>`, `<webhid-device-picker>`, `<webhid-steering-config>`, `<webhid-axis-mapper>`, `<webhid-button-mapper>` | Yes; registration is guarded in Node |

There are no runtime dependencies. `webhid-wheel/ui` must be imported for its
registration side effect; do not tree-shake it away.

## 2. Requirements

- A WebHID-capable browser. In practice this means current Chromium-based
  desktop Chrome or Edge. Firefox and Safari do not implement WebHID.
- A secure context: `https:` or `http://localhost`.
- A user gesture for `navigator.hid.requestDevice()` and `manager.connect()`
  without an already-authorized device.
- Node 18+ for the core package, tests and build tooling.

`navigator.hid.getDevices()` only returns devices the user has already
authorized for this origin. It never opens the browser picker and never grants
permission.

## 3. Install

For application work, pin a revision:

```sh
npm i github:joegaffey/webhid-wheel#<commit-or-tag>
```

For local development:

```sh
npm i file:../webhid-wheel
```

The package builds `dist/` through its `prepare` script on GitHub and `file:`
installs. If an installer skips lifecycle scripts, run this in the package
checkout first:

```sh
npm run build
```

The public exports are:

```js
import { WheelManager, SetupProfileManager } from 'webhid-wheel';
import 'webhid-wheel/ui';
```

Do not import files under `dist/` directly in app code. The only supported
subpath entries are `webhid-wheel`, `webhid-wheel/ui`,
`webhid-wheel/webhid-wheel.js` and `webhid-wheel/package.json`.

## 4. Minimal panel integration

```html
<webhid-config-panel storage-key="my-app:wheel-profiles" tabbed></webhid-config-panel>

<script type="module">
  import { WheelManager } from 'webhid-wheel';
  import 'webhid-wheel/ui';

  const panel = document.querySelector('webhid-config-panel');
  const manager = new WheelManager();

  panel.storageKey = 'my-app:wheel-profiles';
  panel.manager = manager;
</script>
```

Rules for this snippet:

- Import `webhid-wheel/ui` before assigning element properties. If you must set
  properties before the import runs, await
  `customElements.whenDefined('webhid-config-panel')` first.
- Keep one `WheelManager` alive for the lifetime of the panel. Do not create a
  new manager on every render.
- If no `manager` is supplied, the panel creates its own. Supplying one lets the
  app own connection state, telemetry and FFB.
- The panel's **Add device** button calls `manager.connect()` directly from the
  click handler. If the app connects devices itself, call `manager.connect()`
  from a user gesture as well.
- The panel does not disconnect devices when it is removed from the DOM. Call
  `manager.disconnect(id)` when the app tears down the rig.

Device rows show `VID:PID · wheel|HID device · signature` metadata. The `wheel`
label is reserved for a known wheel profile or a detected FFB wheel; generic
input devices remain `HID device`. Capability pills report `steering`, `FFB`,
and detected axis/button/hat counts such as `2 axes` or `12 buttons`.

The panel owns the default setup-profile store when `profiles` is not supplied.
Its default key is `webhid-wheel:v3:profiles`; always use an app-namespaced key
in production.

## 5. Loading and layout stability

Before the UI entry upgrades `<webhid-config-panel>`, its light DOM slot content
is ordinary page content and can paint unstyled. Hide it and keep the footer or
below-the-fold content from jumping:

```css
webhid-config-panel:not(:defined) { display: block; }
webhid-config-panel:not(:defined) > * { display: none; }
```

For a page with a footer, also reserve the panel area or hide the footer until
the element is defined, for example:

```css
#app:not(:has(webhid-config-panel:defined)) footer { visibility: hidden; }
```

The demo also keeps the vertical scrollbar stable with
`html { overflow-y: scroll; }`. Add a loading skeleton if the module load can be
slow; do not let the un-upgraded slot content dictate the first layout.

## 6. Panel properties and attributes

| Property | Attribute | Type | Notes |
| --- | --- | --- | --- |
| `manager` | — | `WheelManager` | Recommended. The panel subscribes to connect, disconnect, error and setup-applied events. |
| `profiles` | — | `SetupProfileManager` | Optional. Supply this to own profile persistence instead of `localStorage`. |
| `storageKey` | `storage-key` | string | Defaults to `webhid-wheel:v3:profiles`. Set the property if changing it after connection; the attribute is read when the store is created. |
| `tabbed` | `tabbed` | boolean | Opt-in tabs. Devices and setup profile stay visible; Wheel, Pedals & axes and Buttons are tabbed. |
| `diagnostics` | `diagnostics` | boolean | Opt-in diagnostic UI. Adds a closed **Diagnostics** disclosure with Copy/Download actions and the `diagnostics` slot. Off by default for embedded panels. |
| `activeTab` | — | `'wheel' \| 'axes' \| 'buttons'` | Property only. Setting it switches the visible tab; user tab changes also fire `webhid-tab-change`. |

The child elements (`webhid-device-picker`, `webhid-steering-config`,
`webhid-axis-mapper`, `webhid-button-mapper`) also accept `manager` and
`profiles` properties. They are usually used through the panel, not directly.

## 7. Slots

| Slot | Placement | Typical use |
| --- | --- | --- |
| `header` | Panel heading area; replaces the default heading | App title or actions. Keep an accessible heading. |
| `device-extra` | Inside the device picker, below its controls | Device status or extra app controls. |
| `diagnostics` | Inside the optional Diagnostics disclosure | Raw input, capture data or other developer diagnostics. Only rendered when `diagnostics` is enabled. |
| `steering-visual` | Top of the steering card | Wheel position visual. |
| `steering-extra` | After force-feedback controls | App-specific force or telemetry controls. |
| `extra-settings` | Wheel tab when `tabbed`; after the mapping sections otherwise | App feel settings such as road noise or rear lightening. |
| `footer` | Bottom of the panel | Status or diagnostics. |

If a slot is absent, the panel renders only library controls.

```html
<webhid-config-panel tabbed>
  <div slot="extra-settings">
    <label>Road noise <input id="road-noise" type="range" min="0" max="1" step="0.01"></label>
  </div>
</webhid-config-panel>
```

## 8. Events

All component events bubble and are composed, so they cross the shadow boundary.
Treat `detail` as plain data except where an `Error` is explicitly noted.

The device picker renders Copy/Download diagnostic actions only when
`diagnostics` is enabled; the demo enables it and puts raw input in the
`diagnostics` slot. Embedded consumer panels should leave it off unless they
want that tooling visible.

### Device picker

| Event | Detail | When |
| --- | --- | --- |
| `webhid-connect` | `{ session, device }` | A device was opened successfully. |
| `webhid-select` | `{ session }` | The user selected a connected device row. |
| `webhid-remove-device` | `{ session?, hardware, alias? }` | The user removed a connected or offline profile device. The panel uses this to update the pending profile. |
| `webhid-authorization-required` | `{ filters }` | `manager.connect()` returned without a session, for example after a cancelled picker or when authorization is still needed. |
| `webhid-copy` | `{ sessions }` | The user requested a text diagnostic copy. |
| `webhid-export` | `{ sessions }` | The user requested a diagnostic export. |
| `webhid-error` | `{ error: Error }` | Connection, authorization, removal or capture failure. |

### Steering, axis and button elements

| Event | Detail | When |
| --- | --- | --- |
| `webhid-change` | `{ settings }` | Steering/FFB settings or a steering/FFB source changed. |
| `webhid-change` | `{ mapping }` | An axis or button mapping changed or was cleared. |
| `webhid-capture` | `{ channel, device, source, index, direction? }` | A **Set** capture completed. `source` is `axis`, `button` or `hat`; `direction` is present for hats. |

### Config panel

| Event | Detail | When |
| --- | --- | --- |
| `webhid-tab-change` | `{ tab }` | The user changed tabs. Setting `activeTab` programmatically does not emit this event. |
| `webhid-profile-change` | `{ profile, action: 'import' }` | A profile file was imported and saved. Save, delete and select do not emit this event. |
| `webhid-error` | `{ error: Error }` | Profile load/save/import/delete or device-profile binding failed. |

Listen on the panel for bubbled child events:

```js
panel.addEventListener('webhid-error', event => {
  console.error('webhid-wheel', event.detail.error);
});

panel.addEventListener('webhid-profile-change', event => {
  console.log('imported', event.detail.profile.profileName);
});
```

### Mapping controls

Axis and button mapping rows start unbound with **Select device**. **Set** is
disabled until the row is bound to a connected device. While listening, **Set**
becomes **Cancel**; press it again to stop capture without changing the mapping.
**Clear** removes the mapping and resets the row to **Select device**. Button
telemetry is `0`/`1`; axis telemetry keeps decimal values.

## 9. Profiles and storage

The panel uses `SetupProfileManager` for portable setup profiles. The profile
schema is multi-device v2:

- each device has an alias, driver and hardware descriptor;
- steering, FFB, axis and button bindings reference device aliases;
- normalized settings use `0..1` (`gain: 0.8` means 80%);
- app-owned data belongs under `metadata` and is preserved on round-trip;
- profile devices that are not currently authorized remain visible as offline.

Default panel behaviour:

- **Save** snapshots the connected working devices and active mappings. It is
  disabled when no device is connected.
- **Remove** removes a device from the working list. The stored profile changes
  only when Save is clicked.
- **Delete** removes the active stored profile.
- **Export** downloads the current profile as JSON.
- **Import** validates a profile, applies it, saves it, and emits
  `webhid-profile-change`.
- The panel migrates the old demo `webhid-wheel:v2:profiles` store and the
  legacy v1 settings/mappings snapshot into the v3 store.

To own persistence, inject a store adapter:

```js
import { SetupProfileManager } from 'webhid-wheel';

const profiles = new SetupProfileManager({
  store: {
    load: () => window.localStorage.getItem('my-app:wheel-profiles'),
    save: text => window.localStorage.setItem('my-app:wheel-profiles', text)
  }
});

panel.profiles = profiles;
```

Programmatic profile flow:

```js
import { WheelManager, SetupProfileManager } from 'webhid-wheel';

const manager = new WheelManager();
const profiles = new SetupProfileManager();

const profile = manager.toSetup({ profileName: 'GT setup' });
const text = profiles.serialize(profile);
const reimported = profiles.parse(text);

const granted = await navigator.hid.getDevices();
const match = profiles.match(reimported, granted);
if (match.status === 'matched') {
  await profiles.reconnect(manager, reimported, {
    getDevices: () => navigator.hid.getDevices()
  });
}
```

`reconnect()` uses only already-authorized devices and never calls
`requestDevice()`. A user gesture is still required to authorize a device that
is not in `getDevices()`.

## 10. Theming

Every element uses Shadow DOM. There are no `part` hooks yet; theme with CSS
custom properties on the host or an ancestor:

| Variable | Default |
| --- | --- |
| `--wheel-bg-color` | `#0d1117` |
| `--wheel-fg-color` | `#e6e8eb` |
| `--wheel-muted-color` | `#8f9bab` |
| `--wheel-accent` | `#38bdf8` |
| `--wheel-border-color` | `#2a303a` |
| `--wheel-radius` | `4px` |
| `--wheel-font` | system sans-serif stack |
| `--wheel-success` | `#34d399` |
| `--wheel-danger` | `#f87171` |

```css
webhid-config-panel {
  --wheel-bg-color: #101418;
  --wheel-accent: #f59e0b;
  --wheel-font: "Inter", system-ui, sans-serif;
}
```

Do not target shadow internals from app CSS. Use the documented variables and
slots.

## 11. Core-only integration

If the app does not use the custom elements, use `WheelManager` directly. The
core entry is safe to import in Node and does not touch `document`,
`navigator.hid`, `localStorage` or animation frames at import or construction
time. Building a UI-less adapter for a worker is supported; `requestDevice()`
still requires the main thread and a user gesture.

```js
import { WheelManager } from 'webhid-wheel';

const manager = new WheelManager();
manager.on('input', state => {
  // state.sessions, state.channels, state.steering, state.timestamp
});
manager.on('connect', ({ session, device }) => {});
manager.on('disconnect', ({ session, device }) => {});
manager.on('error', error => {});

connectButton.addEventListener('click', async () => {
  await manager.connect();
});
```

Do not construct `WebHIDWheel` at server-render time; its constructor checks
`navigator.hid`. `WheelManager` construction is the DOM-free path.

## 12. Framework integration

Custom elements use DOM properties, not framework props.

- Import `webhid-wheel/ui` once in the client entry point.
- Keep the `WheelManager` outside reactive render state, or store it in a ref
  that survives re-renders.
- Set `panel.manager` after the element exists and after the UI import.
- In React, use a ref and `useEffect`; do not pass `manager` through a string
  attribute.
- In Vue, use a template ref and assign the property in `onMounted`.
- Remove event listeners and call `manager.disconnect()` for connected sessions
  when the owning view is destroyed.
- Do not server-render the custom elements; render the host element only on the
  client.

## 13. Agent integration contract

Use this checklist when an agent is wiring the package into another app:

1. Read this document and the target app's package manager and framework.
2. Pin `webhid-wheel` to a commit or tag; do not use an unpinned branch in CI.
3. Use `import 'webhid-wheel/ui'` for the components. Never import
   `dist/ui/index.js` directly from app code.
4. Import the UI entry or await `customElements.whenDefined()` before assigning
   `manager`, `profiles`, `storageKey` or `tabbed`.
5. Keep one stable `WheelManager`; pass it to the panel. Do not create it during
   render.
6. Call `manager.connect()` or `navigator.hid.requestDevice()` only from a
   click/keydown handler. Use `getDevices()` for passive reconnection.
7. Use an app-namespaced storage key. Do not reuse `webhid-wheel:v3:profiles`
   across unrelated apps on the same origin.
8. Preserve profile `metadata`; never drop unknown keys.
9. Theme with the documented CSS variables. Do not pierce the shadow root with
   app selectors.
10. Do not depend on `webhid-ready`; it is not emitted. Use the manager's
    `connect`, `disconnect` and `error` events plus `webhid-connect` on the
    picker.
11. Verify with `npm test`, `npm run test:ui`, and a real browser check of the
    WebHID-unavailable state.
12. If the API or component behavior changes, update this guide, the README,
    the Lapster plan status and the type declarations together.

## 14. Troubleshooting

| Symptom | Check |
| --- | --- |
| Panel is unstyled or `customElements.get('webhid-config-panel')` is undefined | Import `webhid-wheel/ui` in the client bundle; confirm the UI entry was not tree-shaken. |
| Add device does nothing | WebHID unavailable, insecure origin, permission dialog cancelled, or connect not called from a user gesture. |
| Devices list stays empty on reload | `getDevices()` returns only authorized devices; click Add to authorize again. |
| Profile devices show as offline | The hardware is not currently authorized. Use Connect on the offline row or reconnect with `getDevices()`. |
| Imported profile loses mappings | Mappings for unavailable devices are inactive; reconnect the matching hardware and reapply the profile. |
| Live mapping values stay at `0.00` | Select a connected device for that row and press Set, then move/press the input. |
| Dev preview looks stale | Hard-refresh; check `/version.txt` against the deployed commit. |
| No FFB | Confirm the selected force-output device reports FFB capability; try Invert force and a low gain; see the vendor workaround docs. |

## 15. Verification

From the package checkout:

```sh
npm run build
npm test
npm run test:ui
npm pack --pack-destination /tmp
```

The tarball must contain `dist/core`, `dist/ui`, both type entry points, the
README and this guide.
