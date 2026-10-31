# WebHID Wheel

Read a USB HID steering wheel directly in the browser over the [WebHID](https://developer.mozilla.org/en-US/docs/Web/API/WebHID_API) API — no drivers. You get normalized steering, buttons and pedals, plus force feedback on supported wheels.

**Live demo:** [webhid-wheel demo](https://joegaffey.com/webhid-wheel/)

Plug devices in over USB, click **Add device**, and pick one from the browser's device list. Requires a WebHID-capable browser and a secure context (https or `localhost`).

## Features

- **Input** — steering, axes, buttons and POV hats from any HID wheel, gamepad, pedal set or button box, using a small profile registry with a generic **HID-descriptor fallback** for unknown devices.
- **Force feedback** — constant force where the device supports it: built-in CAMMUS C5/C12, FFBeast and classic Logitech (G29 / Driving Force GT) profiles, plus automatic **USB-PID** detection for compliant devices. `constantFast()` reuses the running effect for high-rate updates. Includes force inversion and is safe by default (low strength, explicit stop).
- **Mapping and capture** — combine multiple HID devices, map axes/buttons/hats to semantic channels, and copy/download raw device captures for known-device profiles. Mapping rows start unbound with **Select device**; choose a device to enable **Set**, which toggles to **Cancel** while listening. **Clear** removes the mapping and resets the row.
- **Setup profiles** — multi-device profile schema with hardware matching, validation, v1 migration, and reconnect to already-authorized devices. Offline profile devices stay visible as offline; Remove affects the working device list, and Save persists the change to the profile. Profiles can also be deleted.
- **Web components** — drop-in `<webhid-config-panel>` with device picker, steering/FFB controls, axis and button mapping. Shadow DOM, CSS custom properties and app extension slots.

## Multi-device mapping

The demo page adds multiple HID devices, shows wheel/FFB capability, and maps:

- steering, deadzone, saturation and FFB in the steering section
- throttle, brake, clutch and handbrake in the axis section
- fixed button actions and shifters in the button section
- setup profiles in the profile bar

Mappings, profile settings and metadata persist in localStorage. Raw capture data is kept in memory and included in the Copy/Export diagnostic export. `WebHIDWheel` remains the low-level wheel driver; `WebHIDDevice` handles generic HID. `WheelManager` composes independent device sessions; devices are not assigned a synthetic "wheel" role. Steering source and force output are explicit bindings.

The library does not poll the Gamepad API or capture keyboard/touch input. Those remain app-level fallbacks; the planned unified mapper is described in the [integration plan](./docs/lapster-integration-plan.md#15-follow-up-unified-input-mapper).

See [Device Config page and optional rigs](./docs/device-config-and-rigs.md) for the data model and [PadForge wheel bridge](./docs/padforge-wheel-bridge.md) for the Windows vendor-wheel workaround.

## Library

Plain ESM, zero runtime dependencies. The core entry is DOM-free; the optional UI entry uses Web Components.

```sh
npm i github:joegaffey/webhid-wheel
npm run build      # when working from a source checkout
```

Dual entry points:

```js
import { WheelManager, SetupProfileManager } from 'webhid-wheel';
import 'webhid-wheel/ui';        // registers <webhid-config-panel> and friends
```

or import the module directly:

```js
import { WebHIDWheel } from './webhid-wheel.js';

const wheel = new WebHIDWheel({ maxRotation: 900, ffbStrength: 0.25, ffbInvert: false, deadzone: 0.02 });

wheel.on('input', s => { /* s.steering, s.rotation, s.buttons[], s.axes[] */ });
wheel.on('connect', dev => {});
wheel.on('disconnect', dev => {});
wheel.on('error', e => {});

await wheel.connect();            // call from a user gesture
wheel.isConnected;                // boolean
wheel.ffb.supported;              // { constant, periodic, any }
wheel.ffbInvert = true;           // flip force direction if the wheel pulls the wrong way
await wheel.ffb.constant(0.3);    // -1..1, strength applied internally
await wheel.ffb.constantFast(0.4); // reuse the running effect for high-rate updates
await wheel.ffb.stop();

await wheel.disconnect();
```

Other HID devices use `WebHIDDevice`, and `mapChannels` turns axes, buttons and hats into semantic channels:

```js
import { WebHIDDevice, mapChannels } from './webhid-wheel.js';

const pedals = new WebHIDDevice();
await pedals.connect();           // call from a user gesture

const channels = mapChannels(pedals.state, {
  throttle: { source: 'axis', index: 0 },
  brake: { source: 'axis', index: 1 },
  clutch: { source: 'axis', index: 2 },
  gearUp: { source: 'hat', index: 0, direction: 'up' }
});
```

TypeScript typings ship for both entries: [`webhid-wheel.d.ts`](./webhid-wheel.d.ts) for the core and `webhid-wheel/ui` for the elements.

### Manager and setup profiles

```js
import { WheelManager, SetupProfileManager } from 'webhid-wheel';

const manager = new WheelManager({ maxRotation: 900 });
manager.on('input', state => { /* state.sessions, state.channels, state.steering */ });

const wheel = await manager.connect();   // user gesture
const pedals = await manager.connect();  // another device

manager.setCalibration({ device: wheel.id, deadzone: 0.02, maxRotation: 900 });
manager.setFfb({ device: wheel.id, gain: 0.8 });
manager.setMapping({
  steering: { device: wheel.id },
  axes: {
    throttle: { device: pedals.id, source: 'axis', index: 0 },
    brake: { device: pedals.id, source: 'axis', index: 1 }
  }
});

const profiles = new SetupProfileManager();
const profile = manager.toSetup({ profileName: 'Pro GT Setup' });
const text = profiles.serialize(profile);
const reimported = profiles.parse(text);
const devices = await navigator.hid.getDevices(); // already authorized only
const match = profiles.match(reimported, devices);
if (match.status === 'matched') {
  for (const device of Object.values(match.matches)) await manager.connect(device);
  manager.applySetup(reimported);
}
```

Some wheels expose input and force feedback on separate HID interfaces. The
Logitech G Pro uses a joystick interface plus a HID++ interface. `connect()`
accepts either one `HIDDevice` or an interface array and groups the interfaces
into one session; `session.interfaces` lists them and `wheel.ffbDevice` is the
auxiliary force-feedback interface.

Profiles use the multi-device v2 schema: a device list with hardware
descriptors, plus steering/FFB/axis/button bindings that reference device
aliases. V1 single-device profiles are migrated on import.

`requestDevice()` is never called by profile reconnection. Authorization always
needs a user gesture.

### Web components

```html
<webhid-config-panel storage-key="my-app:wheel-profiles" tabbed>
  <div slot="extra-settings"><!-- app-specific controls --></div>
</webhid-config-panel>

<script type="module">
  import { WheelManager } from 'webhid-wheel';
  import 'webhid-wheel/ui';

  const panel = document.querySelector('webhid-config-panel');
  panel.manager = new WheelManager();
</script>
```

`tabbed` is opt-in. It keeps Devices and the optional Diagnostics disclosure
visible, then shows Wheel, Pedals & axes and Buttons tabs while Setup profile
stays below. Without `tabbed`, all sections render in one scroll. `diagnostics`
is also opt-in: it adds a closed Diagnostics disclosure with Copy/Download
actions and the `diagnostics` slot, which the demo uses for raw input.

The panel is themed with `--wheel-bg-color`, `--wheel-fg-color`,
`--wheel-muted-color`, `--wheel-accent`, `--wheel-border-color`,
`--wheel-radius`, `--wheel-font`, `--wheel-success` and `--wheel-danger`.

### Component integration

The canonical setup, properties, slots, events, profile storage, theming and
troubleshooting contract is in the
[component integration guide](./docs/component-integration.md). It is written
for application developers and coding agents. The package architecture and the
Lapster migration are in the
[package and Lapster integration plan](./docs/lapster-integration-plan.md).

### Custom wheel profiles

```js
WebHIDWheel.registerProfile({
  name: 'My wheel',
  match: /my wheel/i,          // or vendorId / productId
  parse: (data, wheel) => { /* map the raw report onto wheel state */ },
  ffb: { constant: async (device, value, wheel) => {}, stop: async device => {} }
});
```

## Supported wheels

| Wheel | Input | FFB | Verified |
| --- | --- | --- | --- |
| Thrustmaster T248 | steering, buttons, axes (generic) | — direct WebHID; [PadForge bridge](./docs/padforge-wheel-bridge.md) on Windows | No |
| Thrustmaster T300RS | steering, buttons | — | No |
| Logitech G29 (`c24f`, `c260`) | steering, buttons, axes | constant force (classic Logitech) | No |
| Logitech Driving Force GT | steering, buttons | constant force (classic Logitech) | No |
| Logitech G923 PlayStation/PC (`c266`, `c267`) | steering, buttons, axes | constant force (classic Logitech) | No |
| Logitech G923 Xbox/PC (`c26d`, `c26e`) | steering, buttons, axes | constant force (HID++ `0x8123`) | No |
| Logitech RS50 (`c276`) | steering, buttons, axes | constant force (HID++ `0x8123`) | No |
| Logitech G Pro Racing Wheel (`c268`, `c272`) | steering, buttons, axes | constant force (HID++ `0x8123`) | No |
| CAMMUS C5 | steering, buttons, axes | constant force (USB-PID) | **Yes** (Windows 11, Chrome) |
| CAMMUS C12 | steering, buttons, axes | constant force (USB-PID) | No |
| FFBeast | steering | constant force | **Yes** (Windows 11, Chrome) |
| Any other HID wheel with a wheel-like product name | steering/axes/buttons (generic) | — | No |
| Any USB-PID FFB device | — | constant force (auto-detected) | No |

Only **CAMMUS C5** and **FFBeast** have been verified on hardware, both on
Windows 11 with Chrome. Other rows are implemented or expected but have not
been hardware-verified. If force pulls the wrong way, tick **Invert Force**
in the demo or set `ffbInvert: true`.

G29, Driving Force GT and the G923 PlayStation edition use Logitech's classic force-feedback protocol. The G923 Xbox edition, RS50 and G Pro use Logitech HID++ feature `0x8123`. HID++ wheels may expose input and FFB on separate HID interfaces or on one unified interface; the library groups them into one session either way. RS50 and G Pro also work in G923 compatibility mode via the G923 HID++ profile. G920 and Fanatec wheels still need separate profiles; see [Logitech, Thrustmaster and Fanatec FFB workarounds](./docs/vendor-ffb-workarounds.md).

The T248 exposes force feedback on a vendor report that WebHID cannot send. On Windows, PadForge can expose a virtual HID-PID wheel and forward its force feedback to the T248. The same bridge pattern works for other native-FFB wheels PadForge can drive; see [PadForge wheel bridge for WebHID](./docs/padforge-wheel-bridge.md).

Got an unsupported wheel? Open the demo, add it, open **Diagnostics** in the device panel, click **Record all inputs**, turn full-lock and press every button, then click **Stop recording** and use **Copy diagnostic JSON** or **Download JSON** to attach the capture.

## Run locally

```sh
npx serve
# then open the URL it prints (e.g. http://localhost:3000)
```

For Logitech HID++ bring-up, open `logitech-wizard.html` for the guided,
non-technical test flow and downloadable report, or `logitech-test.html` for the
advanced bench with configurable autostart/update/stop strategies, update-rate
presets, raw HID++ logging and force-stream safety limits.

## Built with webhid-wheel

- **[Lapster](https://joegaffey.com/lapster/)** — a web-native vehicle simulation engine with a browser racing demo, Rust/Wasm physics, and wgpu rendering ([source](https://github.com/joegaffey/lapster)).
- **[Magnetar](https://joegaffey.com/magnetar/)** — a one-axis survival game: catch iron orbs on a rotating magnet before they spiral into the black hole ([source](https://github.com/joegaffey/magnetar)).
- **[Ghost Driver](https://joegaffey.com/ghost-driver/)** — **experimental** pure-browser replay that drives a force-feedback wheel from racing telemetry ([source](https://github.com/joegaffey/ghost-driver)).

## License

MIT
