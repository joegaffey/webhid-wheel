# Device Config page and optional rigs

Status: proposed / not implemented.

This document records the agreed direction for multi-device support, user-defined rig profiles, and the evolution of the current demo page into the device configuration page.

## Goals

- Keep `WebHIDWheel` simple for single-wheel apps.
- Support multi-device setups (wheelbase, button hub, pedals, shifter, handbrake, accessories) through an optional `WebHIDRig` layer.
- Let users define named rig profiles that work with any app using the library.
- Make the current page the central **Device Config** page that apps link to instead of implementing their own device management UI.
- Keep the library free of knowledge about consuming apps.

## Non-goals

- The library will not identify or store consuming app IDs.
- Apps will not need to implement device pickers, slot assignment, or channel mapping.
- Rigs are optional; a one-axis app such as Magnetar should be able to use `WebHIDWheel` without a rig profile.

## Architecture

Three layers:

1. **Library** — DOM-free profiles, device I/O, optional rig composition, stores.
2. **Device Config page** — user-facing device management, live preview, FFB testing, profile management, diagnostics.
3. **Apps** — link to the Device Config page and consume saved settings or rig profiles.

`WebHIDWheel` remains the single-device API. `WebHIDRig` composes multiple single-device readers and is used only when an app needs more than one device.

## Page evolution and hosting

The current page evolves into the Device Config page; it is not a separate demo. It keeps the live steering/button/axis preview and FFB test controls, and adds configuration management.

Apps link to the page. The page is centrally hosted rather than shipped as static assets for every app to host.

Consequences by origin:

- **Same origin** (for example `joegaffey.com/webhid-wheel/` and `joegaffey.com/magnetar/`): `localStorage` and WebHID permissions are shared, so configuration is seamless.
- **Different origin**: `localStorage` is not shared and WebHID permission is per origin. Profiles can be transferred with export/import, but the app origin must request device permission at least once.

Cross-origin flow for the initial implementation:

1. User configures devices on the Device Config page.
2. User exports the profile JSON.
3. App imports the profile.
4. App requests device permission once.
5. A config-popup `postMessage` handoff can remove the manual import later.

## Device modes

### Single device

Used by apps that only need a wheelbase (for example Magnetar).

- Select one device.
- Live input preview.
- FFB test, strength, inversion, max rotation.
- Optionally save settings keyed by device signature.
- No rig profile or slot model.

### Rig

Optional, user-defined, for multi-device setups.

- Create, rename, duplicate, delete, select, export, and import named rig profiles.
- Assign devices to slots grouped by type.
- Map inputs to standard semantic channels.
- Restore assigned devices with `navigator.hid.getDevices()`.

## Standard slot kinds and channels

The library defines the shared vocabulary. This is what lets the same rig profile work in different apps.

| Kind | Channels |
| --- | --- |
| `wheel` | `steering`, `rotation`, `buttons` |
| `pedals` | `throttle`, `brake`, `clutch` |
| `shifter` | `gearUp`, `gearDown`, `gear1..N`, `reverse` |
| `handbrake` | `axis` |
| `buttons` | numbered or named buttons |
| `aux` | free-form |

Device profiles provide default mappings where known. Users can override channel mappings in their rig profile.

## Profile model

### Device profiles

Owned by the library and hardware vendors. They match devices and describe parsing/FFB.

Planned additions:

- Stable IDs, for example `cammus/c5`, `logitech/dfgt`.
- Registry operations: register, register pack, get, list, unregister.
- Instance-scoped profile lists as well as the existing global registry.
- Declarative profiles for standard devices and trusted code modules for custom protocols.

### Rig profiles

Owned by the user, not by apps. They are portable across apps that use the library.

Example:

```json
{
  "schemaVersion": 1,
  "id": "rig_01HX...",
  "name": "My Cammus Rig",
  "slots": [
    {
      "id": "wheel",
      "kind": "wheel",
      "device": {
        "vendorId": 13334,
        "productId": 769,
        "productName": "CAMMUS C5 Base",
        "signature": "usage:1:5|input:1"
      },
      "channels": {
        "steering": "x",
        "buttons": "1-16"
      }
    },
    {
      "id": "pedals",
      "kind": "pedals",
      "device": {
        "vendorId": 13334,
        "productId": 4120,
        "productName": "CAMMUS CP5",
        "signature": "usage:1:4|input:1"
      },
      "channels": {
        "throttle": "x",
        "brake": "y",
        "clutch": "z"
      }
    }
  ]
}
```

Assignments store match descriptors only, never `HIDDevice` objects. WebHID does not expose a serial number; identical devices may require the user to resolve ambiguity.

## Storage

User-level, origin-scoped `localStorage` keys:

```text
webhid-wheel:v1:device:<signature>
webhid-wheel:v1:rigs:<rigId>
webhid-wheel:v1:rigs:<rigId>:slots:<slotId>
webhid-wheel:v1:activeRig
```

- No app namespace.
- Same-origin apps share profiles automatically.
- Per-slot keys reduce cross-tab overwrite conflicts.
- Cross-origin transfer uses export/import for now.
- Unavailable storage falls back to in-memory state.

## Device Config page structure

Tabs:

- **Device** — single-device setup, live preview, FFB test/settings.
- **Rig** — optional named rig profiles, slot assignment, channel mapping.
- **Diagnostics** — single-device or whole-rig capture.
- **About/Help** — browser and permission guidance, export/import.

Within the Rig area, devices are grouped by type:

- Wheel
- Wheel buttons
- Pedals
- Shifter
- Handbrake
- Accessories

Each slot shows the assigned device, connection status, and Assign/Replace/Remove actions. Each Assign click calls `requestDevice()` once because the browser chooser grants one device per call.

## App integration

Single-device app:

```js
import { WebHIDWheel } from 'webhid-wheel';

const wheel = new WebHIDWheel({ maxRotation, ffbInvert });
await wheel.connect();
```

Rig app:

```js
import { RigProfileStore, WebHIDRig } from 'webhid-wheel';

const store = new RigProfileStore();
const rig = new WebHIDRig({
  profileId: store.activeId(),
  store
});

await rig.restore();
rig.on('input', state => {
  state.inputs.wheel.rotation;
  state.inputs.pedals.channels.throttle;
});
```

App flow:

1. Load the saved device settings or active rig profile.
2. If none exists, link the user to the Device Config page.
3. On focus, visibility change, or `storage` event, reload configuration.
4. A minimal rig selector in-app is acceptable, but device assignment and channel mapping stay on the config page.

Consuming apps:

- **Magnetar** — single-axis game; uses `WebHIDWheel` without a rig profile.
- **Ghost Driver (experimental)** — capability-based playback that drives an FFB wheel from racing telemetry; consumes wheel state and force commands without app-side model branching.

## Merged state

Keep per-slot state and provide stable aggregates:

```js
rig.state.inputs.wheel.rotation
rig.state.inputs.pedals.axes
rig.state.inputs.pedals.channels.throttle
rig.state.buttons      // merged in configured slot order
rig.state.axes         // merged in configured slot order
rig.ffb.constant(0.3)  // delegated to the FFB-capable wheel slot
```

## Diagnostics

- Capture one device or all assigned devices.
- Emit a JSON document with a `devices` array containing role/kind, profile, capabilities, descriptor, and capture per device.
- Keep the existing wheel-report flow usable for single-device reports.

## Implementation phases

1. Evolve the current page into the Device Config page; keep the live preview.
2. Add single-device settings and optional persistence.
3. Add profile IDs and registry operations; expose profile packs.
4. Add optional rig profiles, standard kinds/channels, and validation.
5. Add `RigProfileStore` and optional `WebHIDRig` with slot assignment, restore, and merged state.
6. Add export/import and cross-origin guidance.
7. Update typings, README, and app-developer documentation.
8. Optional: config-popup `postMessage` handoff and cross-tab ownership lock via Web Locks.

## Related documents

- [Logitech, Thrustmaster and Fanatec FFB workarounds](./vendor-ffb-workarounds.md)
- [PadForge wheel bridge for WebHID](./padforge-wheel-bridge.md)

## Open questions

- Should single-device settings auto-apply by device signature, or only when an app explicitly reads them?
- Keep the Device Config page at the current root URL, or move it to a stable `/config/` path?
- For cross-origin apps, is export/import plus a one-time permission button acceptable, or should the `postMessage` handoff be planned sooner?
