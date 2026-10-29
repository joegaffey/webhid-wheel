# Package, setup profiles and Lapster integration plan

Status: implemented through 0.4.38 on `feature/core-ui-package` (2026-10-29).
The dev preview is deployed; hardware acceptance is still pending. Supersedes
the downloaded `webhid_integration_task_spec.md`. This document is the working
contract for splitting `webhid-wheel` into a core package and a UI package,
adding portable setup profiles, and replacing Lapster's vendored copy.

Related documents:

- [Component integration guide](./component-integration.md) — canonical
  consumer contract for humans and coding agents.
- [HID device mapping and capture](./device-config-and-rigs.md)
- [Logitech, Thrustmaster and Fanatec FFB workarounds](./vendor-ffb-workarounds.md)
- [PadForge wheel bridge for WebHID](./padforge-wheel-bridge.md)

## 1. Objectives

- Keep `WebHIDWheel`, `WebHIDDevice`, `mapChannels` and `isForceFeedbackWheel`
  working for existing consumers.
- Expose a headless core at `webhid-wheel` with no DOM dependency at import
  time. `WheelManager` construction is also DOM-free; `WebHIDWheel` keeps its
  current WebHID feature check.
- Expose optional custom elements at `webhid-wheel/ui`.
- Add portable setup profiles: named settings plus hardware match data, with
  validation, versioning and lazy reconnection.
- Add per-axis calibration, including deadzone, saturation and inversion.
- Move Lapster off its stale vendored copy and onto a pinned package revision.
- Preserve Lapster's existing wheel feel, FFB watchdog, SAB mailbox and 200 Hz
  output path.

## 2. Non-goals

- No HID worker migration in this work. Lapster CP6.5 stays on the main thread;
  CP7 remains the worker migration checkpoint.
- No rename of the existing device-protocol profiles (`registerProfile`,
  `defaultProfiles`). Setup profiles are a separate concept.
- No full rewrite of the demo page. The demo keeps working while components are
  introduced.
- No new vendor FFB protocols, no periodic effects, no cloud sync, and no
  cross-origin profile sharing.
- No iframe or `postMessage` path for HID or FFB. A future worker uses the
  existing SAB mailbox, not message serialization on the hot path.

## 3. Decisions locked by this plan

| Topic | Decision |
| --- | --- |
| Core manager name | `WheelManager`; `WebHIDWheel` remains the low-level wheel driver, but the manager has no primary-wheel role |
| Device model | Sessions keyed by ID. Driver (`wheel`/`generic`) and capabilities are properties, not UI roles |
| Steering | A mapping source bound to a steering-capable session, not global manager state |
| FFB | A selectable output binding to one FFB-capable session |
| Profile schema | Multi-device v2: a device list with aliases plus per-channel bindings |
| Setup profile name | `SetupProfileManager` is the canonical class; export `ProfileManager` as an alias for the requested import style |
| Protocol profiles | Existing `registerProfile` / `WebHIDWheel.registerProfile` keep their current meaning |
| Units | All normalized settings are `0..1`. `ffbGain: 0.8` means 80%. The original `ffbGain: 80` example is not used |
| Hardware match | `vendorId` + `productId` are required; `productName` is display-only; an optional descriptor `signature` disambiguates identical devices |
| Reconnection | Only already-granted devices can reconnect automatically via `getDevices()`. `requestDevice()` is always triggered by a user gesture |
| Threading | Main thread for this work. Core must remain worker-compatible for Lapster CP7 |
| FFB rate | Keep Lapster's current 5 ms (200 Hz) loop. Do not reduce it to 100 Hz |
| Lapster dev dependency | `file:../../webhid-wheel` in `lapster/web/package.json`; CI and release pin a git commit or tag |
| Storage | Demo uses `webhid-wheel:v3:profiles`; v1/v2 stores migrate on load. Lapster uses its own key and migration |
| Integration point | Lapster's `#assists-dialog` controls tab, replacing `setupWheelControls`, not a new settings modal |

## 4. Current state and gaps

| Area | Current state | Target |
| --- | --- | --- |
| Package | One root ESM file, one export, no build or `dist` | `dist/core` and `dist/ui`, typed subpath exports |
| Core API | `WebHIDWheel`, `WebHIDDevice`, `mapChannels` | Same plus `WheelManager`, `SetupProfileManager` / `ProfileManager` |
| Calibration | Deadzone on wheel rotation only | Shared deadzone, saturation and inversion for wheel and axes |
| Profiles | Demo persists loose v1 keys; no portable profile document | Versioned, validated setup profiles with export/import and matching |
| UI | Demo logic lives in `script.js`; Lapster has `wheel-panel.ts` | Compound custom elements in `webhid-wheel/ui` |
| Lapster HID | Vendored copy under `web/src/vendor/webhid-wheel` | Package import from `webhid-wheel` |
| Lapster UI | `setupWheelControls` in `#assists-dialog` | `<webhid-config-panel>` with a slot for app-specific feel controls |
| FFB | Main-thread adapter, SAB mailbox, 200 Hz | Unchanged in this work |
| Tests | Node tests only | Node tests, package tests, DOM component tests, Lapster Playwright tests |

The vendored copy is already behind the current library: it lacks the generic
axis/hat layout, `report7`, and other recent changes. Removing it is required,
not optional.

## 5. Package layout

```text
webhid-wheel/
├── webhid-wheel.js              # compatibility shim; re-exports src/core
├── webhid-wheel.d.ts            # compatibility core types
├── src/
│   ├── core/
│   │   ├── index.js             # public core entry
│   │   ├── index.d.ts
│   │   ├── drivers.js           # WebHIDWheel, WebHIDDevice, mapChannels, profiles
│   │   ├── calibration.js       # deadzone, saturation, invert
│   │   ├── profiles.js          # schema, validation, migration, matching
│   │   └── manager.js           # WheelManager orchestration
│   └── ui/
│       ├── index.js             # registers custom elements
│       ├── index.d.ts
│       ├── device-picker.js
│       ├── steering-config.js
│       ├── axis-mapper.js
│       ├── button-mapper.js
│       ├── config-panel.js
│       └── styles.js
├── dist/
│   ├── core/                    # build output copied from src/core
│   └── ui/                      # build output copied from src/ui
└── test/
    ├── *.test.js                # existing Node tests
    ├── profiles.test.js
    ├── calibration.test.js
    └── ui.spec.js               # browser component tests
```

The build is a copy with validation, not a bundler. Both entries stay native
ESM, so `dist/ui/index.js` can import `../core/index.js` without duplicating the
core. Keep a source tree layout under `src/` that mirrors `dist/`.

`webhid-wheel.js` remains as a source-compatible shim:

```js
export * from './src/core/index.js';
export { default } from './src/core/index.js';
```

Keep `webhid-wheel.d.ts` as the matching compatibility type shim, re-exporting
`./src/core/index.d.ts`. Add `src/ui/index.d.ts` for the UI entry.

`package.json` target:

```json
{
  "name": "webhid-wheel",
  "version": "0.4.38",
  "type": "module",
  "main": "./dist/core/index.js",
  "module": "./dist/core/index.js",
  "types": "./dist/core/index.d.ts",
  "exports": {
    ".": {
      "types": "./dist/core/index.d.ts",
      "import": "./dist/core/index.js",
      "default": "./dist/core/index.js"
    },
    "./ui": {
      "types": "./dist/ui/index.d.ts",
      "import": "./dist/ui/index.js",
      "default": "./dist/ui/index.js"
    },
    "./webhid-wheel.js": {
      "types": "./webhid-wheel.d.ts",
      "import": "./webhid-wheel.js",
      "default": "./webhid-wheel.js"
    },
    "./package.json": "./package.json"
  },
  "sideEffects": [
    "./dist/ui/index.js"
  ],
  "files": [
    "dist",
    "src",
    "webhid-wheel.js",
    "webhid-wheel.d.ts",
    "readme.md"
  ],
  "scripts": {
    "build": "node scripts/build.js",
    "test": "node --test",
    "test:ui": "playwright test test/ui.spec.js",
    "prepare": "npm run build"
  }
}
```

Requirements:

- `sideEffects` must include the UI entry. Otherwise bundlers may drop
  `import 'webhid-wheel/ui'`, because registration is a side effect.
- `prepare` must build `dist` so GitHub installs and `file:` installs work.
- `npm pack` must be tested; a published tarball without `dist` is a release
  blocker.
- The package version becomes `0.4.38` because the package gains subpath exports
  while retaining the old API.
- Add `@playwright/test` as a devDependency for the browser component tests.
  Runtime dependencies stay at zero.

## 6. Core API

### 6.1 Compatibility

These exports remain and keep their current behavior:

```js
import {
  WebHIDWheel,
  WebHIDDevice,
  mapChannels,
  isForceFeedbackWheel
} from 'webhid-wheel';
```

The default export remains `WebHIDWheel`.

### 6.2 `WheelManager`

`WheelManager` is the headless orchestrator used by the UI. It owns zero or more
independent HID sessions. It does not own DOM, storage or app telemetry.

```js
import { WheelManager } from 'webhid-wheel';

const manager = new WheelManager({ filters: [{ vendorId: 0x0eb7 }] });

manager.on('input', (state) => {});
manager.on('connect', ({ session, device }) => {});
manager.on('disconnect', ({ session, device }) => {});
manager.on('error', (error) => {});

const wheel = await manager.connect();      // user gesture
const pedals = await manager.connect();     // another device

manager.setCalibration({ device: wheel.id, deadzone: 0.02, maxRotation: 900 });
manager.setFfb({ device: wheel.id, gain: 0.8 });
manager.setMapping({
  steering: { device: wheel.id },
  axes: {
    throttle: { device: pedals.id, source: 'axis', index: 0 },
    brake: { device: pedals.id, source: 'axis', index: 1 }
  }
});

await manager.disconnect(pedals.id);
```

Required members:

- `sessions`: read-only map of session ID to `{ id, name, driver, capabilities,
  device, hardware, session }`.
- `sessionList`: array view of sessions.
- `connect(device?, { driver?, label?, id? })`: opens or requests a device,
  detects capabilities, and registers a session. Returns the session entry.
- `state`: `{ sessions, channels, steering, timestamp }`.
- Steering mapping: `{ device, deadzone, saturation, maxRotation, invert }`.
- FFB mapping: `{ device, gain, invert }`, where `device` is the selected force
  output.
- `setCalibration`, `getCalibration`, `setFfb`, `getFfb`, `setMapping`,
  `getMapping`.
- `applySetup(profile)`: resolves profile device aliases against connected
  sessions, applies matched bindings, and records missing/ambiguous aliases.
- `toSetup({ profileName, metadata })`: emits a multi-device v2 profile.
- `constant`, `constantFast`, `stop`: target the selected FFB session.
- Legacy `connectWheel` and `addDevice` remain as compatibility wrappers, but
  the UI does not use them and there is no `wheel` role.

Construction must not touch `document` or throw in Node. Feature detection for
`navigator.hid` happens when a connection is attempted. `WebHIDWheel` keeps its
API; its constructor requires only `navigator.hid`, so an authorized device can
be opened in a worker where `requestDevice()` is unavailable. Calling
`connect()` without a device still requires `requestDevice()` and must run on the
main thread.

`WheelManager` must not call `localStorage`, `requestAnimationFrame`,
`performance`-driven rendering, or DOM APIs. It may use the existing
`performance.now()` timestamps from HID reports.

### 6.3 `SetupProfileManager` / `ProfileManager`

```js
import { SetupProfileManager, ProfileManager } from 'webhid-wheel';

const profiles = new SetupProfileManager();
const profileDocument = manager.toSetup({ profileName: 'Pro GT Setup' });
const text = profiles.serialize(profileDocument);
const result = profiles.match(profileDocument, await navigator.hid.getDevices());
```

Required members:

- `validate(value)`: parse, validate, migrate and return a normalized v2 profile.
- `serialize(profile)`, `parse(text)`.
- `toProfile(manager, { profileName })`: snapshot the current rig.
- `match(profile, devices)`: pure multi-device matching. Returns
  `{ status, matches, missing, ambiguous, filters }` where `matches` maps profile
  aliases to devices.
- `migrate(value)`: accept v1 profiles and return schema v2.
- `reconnect(manager, profile, { getDevices })`: connects matched devices,
  applies the profile, and returns the match result. It never calls
  `requestDevice()`.

`ProfileManager` is an alias of `SetupProfileManager`. The UI owns storage. If a
storage adapter is provided, it must be injected; `localStorage` is never
referenced inside core.

## 7. Profile schema

Canonical schema version 2:

```json
{
  "kind": "webhid-wheel-profile",
  "schemaVersion": 2,
  "profileName": "Pro GT Setup",
  "devices": [
    {
      "alias": "d1",
      "driver": "wheel",
      "hardware": {
        "vendorId": 1133,
        "productId": 49739,
        "productName": "Logitech G29 Racing Wheel",
        "signature": null
      }
    },
    {
      "alias": "d2",
      "driver": "generic",
      "hardware": {
        "vendorId": 1133,
        "productId": 49740,
        "productName": "Button box",
        "signature": null
      }
    }
  ],
  "settings": {
    "steering": {
      "device": "d1",
      "deadzone": 0.05,
      "saturation": 1,
      "maxRotation": 900,
      "invert": false
    },
    "ffb": {
      "device": "d1",
      "gain": 0.8,
      "invert": false
    },
    "axes": {
      "throttle": { "device": "d2", "source": "axis", "index": 0 }
    },
    "buttons": {
      "shiftUp": { "device": "d1", "source": "button", "index": 4 }
    }
  },
  "metadata": {
    "lapster": { "rearLightening": 0.4 }
  }
}
```

Rules:

- `devices` is non-empty; aliases are unique, stable within the profile.
- Each device requires `vendorId` and `productId`; `productName` is display-only;
  an optional descriptor `signature` disambiguates identical hardware.
- `settings.steering`, `settings.ffb`, and every axis/button binding reference a
  device alias.
- `settings.ffb.device` is the selectable force-output session. It is not a
  primary-wheel role.
- Normalized values are `0..1`; `ffb.gain: 0.8` means 80%.
- `metadata` is app-owned and round-trips untouched.
- Unknown top-level keys are rejected; app data belongs under `metadata`.

V1 migration:

- `hardware` becomes device alias `d1`.
- `settings.steering`, `settings.ffb`, and `device: "wheel"` mappings target `d1`.
- Other role-based mapping references cannot recover hardware from v1; they are
  removed from active bindings and recorded under
  `metadata.legacyUnboundMappings`.

## 8. Calibration semantics

All public calibration values are normalized to `0..1` or `-1..1` as noted.

Steering:

1. Convert wheel rotation to `v` in `-1..1` using `maxRotation`.
2. If `invert`, `v = -v`.
3. Apply symmetric deadzone `d` and saturation `s`:
   `out = sign(v) * clamp((abs(v) - d) / max(1e-6, s - d), 0, 1)`.
4. Clamp to `-1..1`.

Axes:

1. Read the device axis as normalized `0..1` (the existing generic device
   layer already does this).
2. If `invert`, `x = 1 - x`.
3. Map `min..max` linearly to `0..1`; if `center` is provided, use piecewise
   `min -> 0`, `center -> 0.5`, `max -> 1`.
4. Apply low-end deadzone and saturation:
   `out = clamp((x - d) / max(1e-6, s - d), 0, 1)`.
5. Clamp to `0..1`.

Validation must reject `saturation <= deadzone`. Tests must cover
neutral-at-rest pedals, inverted pedals, center-detented axes, and steering
full lock.

The existing `WebHIDWheel.deadzone` option remains supported and maps to
`steering.deadzone`. `ffbStrength` remains the internal FFB scale; `ffb.gain`
maps onto it at the adapter boundary.

## 9. UI package

### 9.1 Registration

`import 'webhid-wheel/ui'` registers the elements once. Registration is guarded
so importing the module in Node or in a non-DOM test does not throw:

```js
if (typeof customElements !== 'undefined' && !customElements.get('webhid-device-picker')) {
  customElements.define('webhid-device-picker', WebHIDDevicePicker);
}
```

No `navigator.hid`, `document` or `localStorage` access at module top level.

### 9.2 Components

| Element | Purpose | Properties | Events |
| --- | --- | --- | --- |
| `<webhid-device-picker>` | Add one device, list sessions, remove, hot-plug, authorization, optional diagnostics | `manager`, `profiles`, `filters`, `selectedId`, `profileDevices`, `diagnostics` | `webhid-connect`, `webhid-select`, `webhid-remove-device`, `webhid-authorization-required`, `webhid-copy`, `webhid-export`, `webhid-error` |
| `<webhid-steering-config>` | Steering source, force output, deadzone, saturation, rotation, invert, FFB gain | `manager`, `profiles`, `settings` | `webhid-change` |
| `<webhid-axis-mapper>` | Throttle, brake, clutch, handbrake assignment and telemetry, bound to a session | `manager`, `profiles`, `mapping` | `webhid-capture`, `webhid-change` |
| `<webhid-button-mapper>` | Shift, paddle, UI action mapping, bound to a session | `manager`, `profiles`, `mapping` | `webhid-capture`, `webhid-change` |
| `<webhid-config-panel>` | Composite panel and profile import/export/delete; optional tabs and diagnostics | `manager`, `profiles`, `storageKey`, `tabbed`, `diagnostics`, `activeTab` | `webhid-tab-change`, `webhid-profile-change`, `webhid-error` |

All events are `bubbles: true` and `composed: true`. Event `detail` objects are
plain data except `webhid-error`, which contains an `Error`. The panel does not
emit `webhid-ready`; use the manager lifecycle events and `webhid-connect` on
the picker. `webhid-profile-change` currently fires on import only. The full
event and detail contract is in the
[component integration guide](./component-integration.md#8-events).

`<webhid-device-picker>` subscribes to `navigator.hid` `connect` and `disconnect`
events and updates status. It shows active sessions plus profile device slots that
are currently offline. Remove disconnects and removes the device from the working
list; the stored profile changes only when Save is clicked. It never shows a
synthetic device.

`<webhid-config-panel>` owns the default `WheelManager` only when a `manager`
property is not supplied by the app. It must accept an app-owned manager so
Lapster can keep its `WheelFfb` adapter as the source of truth.

### 9.3 Styling

- Shadow DOM for every element.
- No global selectors and no styles outside the shadow root.
- CSS custom properties inherit through the shadow boundary:
  `--wheel-bg-color`, `--wheel-fg-color`, `--wheel-muted-color`,
  `--wheel-accent`, `--wheel-border-color`, `--wheel-radius`, `--wheel-font`,
  `--wheel-success`, `--wheel-danger`.
- Theme through CSS variables and slots. No `part` hooks are exposed yet.
- Use `:host([hidden]) { display: none; }` and never set layout on `:host`
  beyond `display`.

### 9.4 Slots and app extensions

`<webhid-config-panel>` provides:

- `header`: optional heading/actions.
- `device-extra`: status or extra app controls rendered under the device list.
- `diagnostics`: raw input or developer diagnostics, rendered inside a closed
  Diagnostics disclosure when `diagnostics` is enabled.
- `steering-visual`: optional visual placed at the top of the steering card.
- `steering-extra`: optional app controls placed after the force-feedback
  settings.
- `extra-settings`: other app-specific controls. Rendered in the Wheel tab when
  `tabbed`, or after the mapping sections otherwise. Lapster puts its feel mixer
  here so `rearLightening`, `frontShudder`, `roadNoise`, `roughness`, and related
  settings are not lost.
- `footer`: status or diagnostics.

If an optional slot is absent, the panel renders only library settings.

With `tabbed` set, the panel keeps Devices (and the optional Diagnostics
disclosure) visible, then shows `Wheel`, `Pedals & axes` and `Buttons` tabs.
Setup profile and footer remain visible below the tabs. Without `tabbed`, all
sections render in the original single-scroll order.

### 9.5 Accessibility and fallback

- Every control has a visible label and an accessible name.
- Status uses `aria-live="polite"`.
- Buttons are keyboard reachable; focus is visible.
- Offline, unsupported WebHID, and authorization-needed states are explicit; the
  panel never renders a dead Add button without explanation.
- If WebHID is unavailable, the panel renders an unavailable state and Lapster's
  keyboard/touch input continues to work.

### 9.6 Rendering budget

- Do not re-render the panel on every HID report.
- Subscribe to `input` only for telemetry widgets and throttle updates to
  `requestAnimationFrame`.
- Never perform storage writes on the input path.
- FFB and input paths must not depend on component rendering.

## 10. Lapster integration

### 10.1 Dependency

Add to `lapster/web/package.json`:

```json
{
  "dependencies": {
    "webhid-wheel": "file:../../webhid-wheel"
  }
}
```

From `lapster/web`, the correct path to the sibling repository is
`../../webhid-wheel`. The original `file:../webhid-wheel` resolves to
`lapster/webhid-wheel` and is wrong. Lapster has no root `package.json`, so the
dependency must live in `web/package.json`.

For CI and release:

- Pin a commit or tag, for example
  `github:joegaffey/webhid-wheel#<sha>` or a published `0.4.38`.
- Record the revision in Lapster's `THIRD_PARTY_NOTICES.md`.
- Ensure `dist` is built before Lapster's esbuild run. Prefer the package
  `prepare` script; if the CI install mode skips it, run `npm --prefix
  ../../webhid-wheel run build` in the Lapster build script.
- Commit the lockfile update.

### 10.2 Remove the vendored copy

- Delete `lapster/web/src/vendor/webhid-wheel/`.
- Change `lapster/web/src/input/wheel-ffb.ts` to import from `webhid-wheel`.
- Search for remaining relative imports and direct vendor paths.
- Run the existing wheel tests after the swap. The vendored copy is older and
  the current library changes generic axis/hat behavior, so a behavior diff is
  expected; verify it is the intended one.

### 10.3 Keep the app adapter

`WheelFfb` remains in Lapster. It owns:

- telemetry to torque mapping;
- the feel mixer;
- the 50 ms stale-torque watchdog;
- SAB FFB mailbox reads;
- stop on hide, pause, disconnect and error;
- the 5 ms output loop.

The library must not absorb these. `WheelFfb` may wrap `WheelManager` or expose
its manager to the panel; the components must not know about Lapster telemetry.

### 10.4 Replace the controls panel

- The current integration point is `#assists-dialog` with `#wheel-controls`,
  wired by `setupWheelControls()` in `lapster/web/src/ui/wheel-panel.ts`.
- Render `<webhid-config-panel>` inside `#wheel-controls`.
- Pass Lapster's manager and storage key.
- Move the existing feel sliders into the `extra-settings` slot.
- Keep the existing panel behind a feature flag (`?wheelui=1` or dev channel)
  until hardware and Playwright checks pass, then make it the default.
- Preserve Add, Remove, strength, invert, deadzone, test force, stop,
  status and reset behavior.

### 10.5 Storage

- Use `lapster.wheel.v3` for the new panel.
- Migrate `lapster.wheel.v2` values on first load.
- Keep `metadata.lapster` for feel settings.
- Never delete legacy values automatically; mark them migrated after a
  successful write.
- Profile import/export is file-based in the panel; no server.

### 10.6 Threading and performance

- This work stays on the main thread and preserves the current 200 Hz FFB loop.
- The core remains worker-compatible for CP7: no DOM, no top-level
  `navigator` access, and `connectWheel(device)` accepts an already-authorized
  device.
- Do not add `postMessage` or iframe hops. A future HID worker uses the SAB
  mailbox already present in Lapster.
- Measure, do not assume:
  - p95 FFB write interval at or below 10 ms during normal driving;
  - no long task over 50 ms attributable to the panel;
  - no dropped frames during connect, profile import or theme changes;
  - input-to-FFB added latency under 2 ms on the main thread.

## 11. Delivery plan

Timeboxes are indicative for one focused developer.

### Phase 0: Baseline and fixtures (1-2 days)

- Record the current public API and demo behavior.
- Add regression tests for existing `WebHIDWheel`, `WebHIDDevice`,
  `mapChannels`, fast constant force and Logitech FFB.
- Add profile fixtures: valid, invalid, legacy v1 demo, legacy Lapster v2,
  duplicate VID/PID, missing hardware.
- Add a no-DOM import test for the core entry.

Exit criteria: baseline tests pass; fixtures cover all reconnect cases.

Fail action: do not restructure the package until the existing behavior is
captured by tests.

### Phase 1: Core extraction and calibration (2-3 days)

- Move the implementation into `src/core/` and keep `webhid-wheel.js` as a shim.
- Add `WheelManager` as a wrapper over the existing wheel and device classes.
- Add `calibration.js` and apply it to wheel steering and generic axes.
- Keep all existing exports and default export.

Exit criteria: old tests pass unchanged; new calibration tests pass; core can
be imported in Node without `document` or `navigator`.

Fail action: if `WheelManager` requires changes to `WebHIDWheel` semantics, stop
and narrow the wrapper instead of changing the old class.

### Phase 2: Setup profiles and lazy reconnect (2-3 days)

- Implement schema v1, validation, serialization and migration.
- Implement pure matching and the injected storage adapter.
- Implement `reconnect()` using `getDevices()` only.
- Add fixtures and tests for authorized match, unmatched device, unauthorized
  device and duplicate VID/PID.

Exit criteria: round-trip equality, stable serialization, migration from demo
v1 and Lapster v2, and no `requestDevice()` call in core.

Fail action: do not add UI until matching behavior is deterministic.

### Phase 3: Build and dual exports (1-2 days)

- Add `scripts/build.js` to copy `src/core`, `src/ui` and types into `dist`.
- Update `package.json` exports, `files`, `sideEffects`, `main`, `types` and
  `prepare`.
- Add a tarball smoke test: pack, install into a temp directory, import the
  core and the UI entry.
- Update README and type declarations.

Exit criteria: `npm pack` contains both entries and types; core import has no
DOM side effects; UI import registers in a browser and does not throw in Node.

Fail action: do not publish or point Lapster at the package until the tarball
test passes.

### Phase 4: UI components (4-6 days)

- Extract pure mapping/capture helpers from the demo.
- Implement the five elements with Shadow DOM, events, slots and CSS variables.
- Add browser tests for registration, event flow, theming isolation, no-WebHID
  state, and panel layout in `#assists-dialog`.
- Keep the demo page on its existing UI until the components pass parity; then
  migrate the demo or document the remaining difference.

Exit criteria: components render without global CSS, keyboard and screen-reader
basics work, and no input-path rendering or storage writes occur.

Fail action: if component extraction requires changing core semantics, stop and
move the missing behavior into core with tests first.

### Phase 5: Lapster swap (2-3 days)

- Add the `webhid-wheel` dependency, remove the vendored copy and update the
  import.
- Mount `<webhid-config-panel>` in `#assists-dialog`; keep feel settings in
  `extra-settings`.
- Add the storage migration and profile import/export.
- Update `THIRD_PARTY_NOTICES.md` and the Lapster plan/spec references.
- Run Node, Playwright and fallback tests.

Exit criteria: no vendored code, no behavioral regression, profile import works
for authorized and unauthorized hardware, and all existing wheel controls are
still available.

Fail action: keep the old panel behind the flag and fix parity before switching
the default.

### Phase 6: Hardware and release (1-2 days)

- Manual CAMMUS C5 check: steering, constant FFB, stop, watchdog, profile
  reconnect, panel controls.
- FFBeast is the other hardware-verified FFB baseline.
- Best-effort C12 check if hardware is available; it is implemented but not
  hardware-verified.
- Verify Chromium, WebHID-unavailable fallback, and Lapster's mobile layout.
- Tag `webhid-wheel@0.4.38`, pin the revision in Lapster, update docs.

Exit criteria: hardware checklist passes; release notes list the new subpath,
setup profiles and compatibility guarantees.

## 12. Acceptance criteria

- `import { WebHIDWheel, WheelManager, ProfileManager } from 'webhid-wheel'`
  works in Node with no DOM globals and does not create a device.
- `import 'webhid-wheel/ui'` registers all five elements in a browser and does
  not throw in Node.
- The package tarball includes `dist/core`, `dist/ui` and both type entries.
- Existing tests and README examples using `WebHIDWheel`, `WebHIDDevice`,
  `mapChannels` and `registerProfile` still pass.
- A profile exports and re-imports byte-for-byte after normalization, including
  unknown `metadata`.
- Reconnect cases behave as specified:
  - authorized matching device: binds automatically;
  - granted but ambiguous devices: asks the user to choose;
  - no granted match: shows authorization needed without calling
    `requestDevice()`;
  - user clicks Authorize: calls `requestDevice()` from the gesture.
- Calibration tests cover deadzone, saturation, inversion, center detents and
  full lock.
- `<webhid-config-panel>` renders in Lapster's `#assists-dialog` at desktop and
  mobile widths with no CSS leakage.
- Lapster no longer contains `src/vendor/webhid-wheel`.
- Lapster keeps its feel mixer, watchdog, SAB mailbox and 200 Hz FFB output.
- Lapster fallback without WebHID boots, hides or disables the panel, and keeps
  keyboard/touch input working.
- Measured: p95 FFB write interval <= 10 ms; no panel-attributable long task
  over 50 ms; no dropped frames during panel interactions.

## 13. Risks and mitigations

| Risk | Mitigation |
| --- | --- |
| Breaking existing consumers | Keep all old exports, root shim, and regression tests; release as 0.4.38 |
| `dist` missing from installs | `prepare` build, tarball test, CI build step before Lapster build |
| `file:` dependency breaks CI | Use file only for local dev; pin a git commit or tag for CI/release |
| Stale vendored copy silently returns | Delete vendor directory and add an import check in review |
| Main-thread FFB jitter | Preserve current 200 Hz loop and measure; keep core worker-compatible for CP7 |
| Profile schema drift | `schemaVersion`, validation, migration tests, app-owned `metadata` |
| Setup/profile naming confusion | `SetupProfileManager` canonical; protocol profiles unchanged |
| Duplicate identical devices | Require a descriptor signature or explicit picker selection; never bind first silently |
| CSS leakage into Lapster | Shadow DOM, no global selectors, Playwright layout test |
| Loss of Lapster feel settings | `extra-settings` slot and `metadata.lapster` round-trip |
| Auto-authorization is impossible | Document the user-gesture requirement and show an explicit Authorize action |

## 15. Follow-up: unified input mapper

Status: follow-up, outside the current package/UI implementation.

Lapster needs one input model across browser APIs, not just WebHID. Gamepad API,
keyboard, mouse and touch are currently app-level fallbacks; they are not part
of the `webhid-wheel` package and are not covered by setup profiles.

The follow-up should introduce an app-level `InputSource` abstraction in
Lapster and a single normalized snapshot:

```ts
{
  sourceId,
  kind: "webhid" | "gamepad" | "keyboard" | "touch",
  timestamp,
  axes: { steering, throttle, brake, clutch, handbrake },
  buttons: { shiftUp, shiftDown, ... },
  hats: {},
  capabilities: { ffb, axes, buttons, hats }
}
```

Requirements:

- `InputManager` composes sources, polls gamepad/keyboard/touch once per tick,
  subscribes to WebHID events, applies staleness and precedence, and exposes
  one mapping document.
- Mapping entries are source-qualified: `{ sourceId, kind, index, invert }`.
  Do not force gamepad or keyboard bindings into the WebHID setup-profile schema.
- Precedence: fresh WebHID wheel input > Gamepad API > keyboard/touch. Mouse
  remains UI/camera-only and is not a driving input.
- FFB stays separate from the generic mapper. Only WebHID sources, and Gamepad
  vibration where supported, produce force output.
- Permissions and hot-plug differ by API: WebHID needs a user gesture and
  `requestDevice()`; Gamepad API only exposes devices after user interaction;
  keyboard/touch are immediate.
- The current WebHID panel must coexist without interference: no global key
  handlers, no gamepad polling, no pointer capture outside its Shadow DOM, and
  no preventDefault on driving keys.
- Tests must cover no-WebHID gamepad-only, keyboard-only, touch-only, panel open
  while driving, permission denial, hot-plug, precedence, and mapping
  round-trips.

Implement this first in `lapster/web/src/input`; extract a reusable package only
after the interface is stable.

## 16. Deferred decisions

- Resolved: the demo now uses the components. Raw capture, export and the wheel
  visual remain demo-shell features.
- Whether to publish `0.4.38` to npm or use a pinned GitHub commit. Either is
  acceptable if Lapster's lockfile and `THIRD_PARTY_NOTICES.md` record it.
- The first hardware acceptance remains the CAMMUS C5 with optional external
  pedals/buttons; multi-device profile v2 is implemented in the library.
- HID worker migration remains Lapster CP7 and is not part of this plan.
