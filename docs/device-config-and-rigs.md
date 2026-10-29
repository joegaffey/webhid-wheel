# HID device mapping and capture

Status: mapping implemented on `feature/webhid-device-mapping` (2026-10-28); setup profiles and config elements added on `feature/core-ui-package` (2026-10-29).

This document describes the current multi-device direction. The earlier
`WebHIDRig` proposal has been dropped: there is no mandatory rig object and no
cross-origin profile sharing. Apps compose device sessions themselves and reuse
the generic device and mapping code from this package.

## Goals

- Keep `WebHIDWheel` unchanged for single-wheel apps.
- Add `WebHIDDevice` for generic HID gamepads, pedals, button boxes and
  handbrakes.
- Support multiple devices in one page: wheel, pedals, buttons, shifter.
- Map raw axes, buttons and POV hats to stable semantic channels.
- Capture raw input evidence and export it for known-device profiles.
- Persist device metadata and mappings locally, not raw capture streams.
- Reuse the same device/mapping code in the demo and in apps.

## Non-goals

- No central Device Config page dependency.
- No cross-origin profile sharing or postMessage handoff.
- No mandatory `WebHIDRig` object.
- No cloud storage.
- No raw capture persistence in localStorage.

## Layers

1. **`WebHIDWheel`** — wheel steering and force feedback. Public API unchanged.
2. **`WebHIDDevice`** — generic HID input: axes, buttons, POV hats, multiple
   input reports, descriptor fallback.
3. **Mapping layer** — pure data plus `mapChannels()`, translating device state
   to semantic channels.
4. **Demo page** — device list, mapping tabs, FFB test, raw capture and export.
5. **Apps** — compose independent device sessions; steering source and force output are explicit bindings.

There is one session per physical `HIDDevice`. The demo never opens the same
device twice.

## Device topology

| Setup | Example | Sessions |
| --- | --- | --- |
| Integrated | G29 | One `WebHIDWheel` provides wheel, pedals and buttons |
| Split | C5 base + button hub + T3PM adapter | One `WebHIDWheel` plus generic `WebHIDDevice` sessions |
| Hybrid | C5 base + separate pedals + integrated rim buttons | Mixed |

Mapping rows reference a device and an input. The same device can provide
multiple channels.

## Device state

`WebHIDDevice.state`:

```js
{
  axes: [0..1],
  rawAxes: [...],
  buttons: [bool],
  hats: [{ raw, x, y, direction }],
  reports: { [reportId]: [bytes] },
  timestamp,
  reportId
}
```

Axes are read from the Generic Desktop page (`0x01`) and the Simulation
Controls page (`0x02`), which is used by some Arduino and pedal devices for
throttle, brake, clutch or handbrake fields.

`WebHIDWheel.deviceState` exposes the same generic input state for wheel
sessions. `WebHIDWheel.state` keeps the wheel-specific steering, rotation,
buttons, axes and hats.

## Mapping model

### Wheel

- `steering`

### Other axes

- `throttle`
- `brake`
- `clutch`
- `handbrake`

### Buttons

Fixed actions:

```text
reverse
neutral
gear1 .. gear8
gearUp
gearDown
handbrake
Button 1 .. Button N
```

Numbered `Button N` entries are available for unmapped physical buttons.
Hat/POV directions map to the same fixed actions.

Mapping entries are plain data:

```js
{
  device: { vendorId, productId, productName },
  source: 'axis' | 'button' | 'hat',
  index: number,
  invert?: boolean,
  direction?: string,
  usage?: number
}
```

## Setup profiles

The capture document above is raw input evidence and mapping metadata. Portable
user-facing setup profiles (name, hardware match, steering/FFB settings and
axis/button mappings) are a separate schema, specified in the
[Package, setup profiles and Lapster integration plan](./lapster-integration-plan.md#7-profile-schema).

Setup profiles:

- use the multi-device schema v2: a device list with hardware descriptors, and
  steering/FFB/axis/button bindings that reference device aliases;
- match each device by `vendorId` and `productId`, with an optional descriptor
  signature for otherwise identical devices;
- store all normalized settings in `0..1`;
- round-trip app-owned values under `metadata`;
- reconnect matched devices only through `navigator.hid.getDevices()`;
  authorization still requires a user gesture.

The existing `webhid-wheel:v1:*` settings and the `webhid-wheel:v2:profiles`
store are treated as legacy and migrated once into
`webhid-wheel:v3:profiles`. V1 profiles that referenced non-wheel roles cannot
recover those devices' hardware; those mappings are recorded under
`metadata.legacyUnboundMappings` for re-binding.

## Demo UI

The demo uses `<webhid-config-panel>` and its sub-elements:

- one **Connect device** action
- device list with capability badges and per-device disconnect
- steering source and force-output selection
- throttle, brake, clutch and handbrake mapping
- fixed button/shifter actions
- setup profile import/export
- Copy / Export diagnostic JSON

Devices are listed by name and session ID. There is no synthetic `wheel` role.
Raw input data is shown in a raw-input panel and included in the export. It is
not stored in localStorage.

## Capture flow

For each mapping row:

1. Select the active device.
2. Press **Set**.
3. Move or press the target input.
4. The page records the device, input type/index, usage, raw min/max and a small
   set of samples.
5. The mapping is saved.

The export is one unified document:

```json
{
  "kind": "webhid-device-capture",
  "schemaVersion": 1,
  "devices": [],
  "captures": [],
  "mappings": {
    "wheel": {},
    "axes": {},
    "buttons": {}
  }
}
```

Semantic labels exist only in `mappings`. `devices` and `captures` are raw
evidence for building known-device profiles.

## Storage

localStorage stores metadata only. Legacy demo keys:

```text
webhid-wheel:v1:devices
webhid-wheel:v1:mappings
webhid-wheel:v1:settings
```

The profile plan replaces the settings and mappings keys with a
`webhid-wheel:v3:profiles` store document that records the active profile. The
old `webhid-wheel:v2:profiles` store is migrated on load. See
[Setup profiles](./lapster-integration-plan.md#7-profile-schema).

Stored values:

- device match descriptors, names and FFB capability
- wheel/axis/button mappings
- wheel settings

Not stored:

- raw frames
- raw samples
- continuous report streams

On load:

1. Load metadata.
2. Call `navigator.hid.getDevices()`.
3. Reattach saved devices by VID/PID/name/signature.
4. Add any other granted joystick/gamepad devices, even if they were not mapped yet.
5. Show “needs permission” for saved devices that are not granted.

`HIDDevice` objects are never stored.

## App integration

Wheel-only app:

```js
import { WebHIDWheel } from 'webhid-wheel';

const wheel = new WebHIDWheel({ maxRotation: 900 });
await wheel.connect();
```

Wheel plus pedals/buttons:

```js
import { WebHIDWheel, WebHIDDevice, mapChannels } from 'webhid-wheel';

const wheel = new WebHIDWheel();
const pedals = new WebHIDDevice();
const buttons = new WebHIDDevice();

await wheel.connect(wheelDevice);
await pedals.connect(pedalDevice);
await buttons.connect(buttonDevice);

const channels = mapChannels(pedals.state, {
  throttle: { source: 'axis', index: 0 },
  brake: { source: 'axis', index: 1 },
  clutch: { source: 'axis', index: 2 }
});
```

Apps can persist their own metadata or reuse the demo's storage keys on the same
origin.

## First consumer

Lapster will use:

- `WebHIDWheel` for the CAMMUS C5 wheel and FFB
- `WebHIDDevice` for the C5 button hub
- `WebHIDDevice` for the T3PM adapter
- mapping for throttle, brake, clutch, gear actions and buttons

No rig object is involved.

## Implementation status

Done:

- generic HID descriptor parsing with axes, buttons, POV hats and multiple reports
- `WebHIDDevice`
- `mapChannels()`
- device list, FFB badge, unified Connect
- mapping capture with raw min/max/samples
- metadata-only localStorage and versioned setup profiles
- unified Copy/Export diagnostics
- generic HID tests
- `WheelManager` session model, calibration and capability detection
- multi-device setup-profile v2 validation/matching/migration
- `<webhid-config-panel>` and the device/steering/axis/button elements
- demo migrated to the UI package with one Connect device flow

Next:

- capture C5 base, C5 button hub and T3PM adapter on the rig
- add known-device profiles and default mappings
- integrate the sessions into Lapster
- add the unified gamepad/keyboard/touch mapper from the
  [follow-up plan](./lapster-integration-plan.md#15-follow-up-unified-input-mapper)

## Related documents

- [Package, setup profiles and Lapster integration plan](./lapster-integration-plan.md)
- [Logitech, Thrustmaster and Fanatec FFB workarounds](./vendor-ffb-workarounds.md)
- [PadForge wheel bridge for WebHID](./padforge-wheel-bridge.md)
