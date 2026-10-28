# HID device mapping and capture

Status: implemented on `feature/webhid-device-mapping` (2026-10-28).

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
5. **Apps** — compose one wheel session and zero or more generic sessions.

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

## Demo UI

Top of page:

- one Connect button
- device list with type and FFB badge
- Copy JSON / Download JSON

Tabs:

- **Wheel** — steering mapping, FFB test, strength, invert, max rotation
- **Other axes** — throttle, brake, clutch, handbrake
- **Buttons** — fixed actions and numbered default buttons

Raw capture data is shown in a raw-input panel and included in the export. It is
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

localStorage stores metadata only:

```text
webhid-wheel:v1:devices
webhid-wheel:v1:mappings
webhid-wheel:v1:settings
```

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
3. Reattach granted devices.
4. Show “needs permission” for saved devices that are not granted.

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
- Wheel / Other axes / Buttons tabs
- mapping capture with raw min/max/samples
- metadata-only localStorage
- unified Copy/Download JSON
- generic HID tests

Next:

- capture C5 base, C5 button hub and T3PM adapter on the rig
- add known-device profiles and default mappings
- integrate the sessions into Lapster
- add a reusable config web component later, using the same APIs

## Related documents

- [Logitech, Thrustmaster and Fanatec FFB workarounds](./vendor-ffb-workarounds.md)
- [PadForge wheel bridge for WebHID](./padforge-wheel-bridge.md)
