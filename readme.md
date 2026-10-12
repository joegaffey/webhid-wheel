# WebHID Wheel

Read a USB HID steering wheel directly in the browser over the [WebHID](https://developer.mozilla.org/en-US/docs/Web/API/WebHID_API) API — no drivers. You get normalized steering, buttons and pedals, plus force feedback on supported wheels.

**Live demo:** https://joegaffey.github.io/webhid-wheel/

Plug the wheelbase in over USB, click **Connect**, and pick it from the browser's device list. Requires a WebHID-capable browser and a secure context (https or `localhost`).

## Features

- **Input** — steering, buttons and pedals from any HID wheel, using a small per-model profile registry with a generic **HID-descriptor fallback** for unknown wheels.
- **Force feedback** — constant force where the device supports it: a built-in profile for FFBeast, plus automatic **USB-PID** detection for compliant devices. Safe by default (low strength, explicit stop).
- **Diagnostics** — capture a wheel's descriptor + a guided input sweep and file a one-click **wheel report** to grow the registry.

## Library

Plain ESM, zero dependencies, DOM-free.

```sh
npm i github:joegaffey/webhid-wheel
```

or import the module directly:

```js
import { WebHIDWheel } from './webhid-wheel.js';

const wheel = new WebHIDWheel({ maxRotation: 900, ffbStrength: 0.25, deadzone: 0.02 });

wheel.on('input', s => { /* s.steering, s.rotation, s.buttons[], s.axes[] */ });
wheel.on('connect', dev => {});
wheel.on('disconnect', dev => {});
wheel.on('error', e => {});

await wheel.connect();            // call from a user gesture
wheel.isConnected;                // boolean
wheel.ffb.supported;              // { constant, periodic, any }
await wheel.ffb.constant(0.3);    // -1..1, strength applied internally
await wheel.ffb.stop();

await wheel.disconnect();
```

TypeScript typings ship in [`webhid-wheel.d.ts`](./webhid-wheel.d.ts).

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

| Wheel | Input | FFB |
| --- | --- | --- |
| Thrustmaster T248 / T300RS | steering, buttons | — |
| Logitech Driving Force GT | steering, buttons | — |
| FFBeast | steering | constant force |
| Any standard-descriptor HID wheel | steering/axes/buttons (generic) | — |
| Any USB-PID FFB device | — | constant force (auto-detected) |

Got an unsupported wheel? Open the demo, click **Gather diagnostics** (turn full-lock, press every button), then **Open issue** and paste the JSON.

## Run locally

```sh
python3 -m http.server 8000
# open http://127.0.0.1:8000/
```

## License

MIT
