# PIDAL wheel bridge for WebHID

Status: recommended Windows workaround. PIDAL's bridge and GUI are verified on
Windows 11; `webhid-wheel` drives the virtual PID wheel through the generic
USB-PID path. PadForge remains available as an alternative.

Some force-feedback wheels do not expose a usable standard USB HID PID
interface to WebHID, or expose their force feedback on a vendor report that
WebHID cannot address. [PIDAL](https://github.com/joegaffey/pidal) (PID
Abstraction Layer) bridges those wheels: it presents a standard HID PID 1.0
virtual wheel to the browser and drives the physical wheel through DirectInput.

This is the primary workaround for wheels that need a Windows bridge. The
[PadForge bridge](./padforge-wheel-bridge.md) remains an alternative, especially
when PadForge is already part of the rig or is needed for its broader input
mapping.

## Architecture

```text
Browser / WebHID
    -> PIDAL Virtual Wheel (HIDMaestro, UMDF2)
    -> PIDAL PID parser
    -> PIDAL DirectInput backend
    -> physical wheel
```

The browser talks only to the virtual wheel. PIDAL parses the standard PID
effects and renders the active constant force on the physical wheel.

PIDAL is independent of `webhid-wheel`; any standard HID PID client can use it.
It currently supports constant force. Other PID effect types are ignored by the
first DirectInput backend.

## Virtual device

PIDAL creates a distinct HIDMaestro device:

| Field | Value |
| --- | --- |
| Product | `PIDAL Virtual Wheel` |
| VID:PID | `0xBEEF:0xF001` |
| Type | Joystick / wheel |
| Input | Standard wheel axes, buttons and hat |
| FFB | HID PID 1.0 constant force |

Do not confuse it with PadForge's `PadForge Game Controller`
(`0xBEEF:0xF000`). Both virtual devices can coexist, and the browser can tell
them apart by name and product ID.

## Requirements

- Windows 10/11 x64.
- PIDAL, including the HIDMaestro driver it installs.
- Administrator elevation when starting the bridge. PIDAL creates a virtual
  device and installs or shares the HIDMaestro UMDF2 driver.
- A physical wheel that exposes a DirectInput constant-force effect.
- The wheel in its normal PC/native mode.
- Vendor control software, games, PadForge and other force-feedback apps
  closed while testing. PIDAL acquires the physical wheel exclusively.

## Setup

1. Close vendor software, racing games and PadForge.
2. Start PIDAL elevated and select the physical wheel.
3. Start the bridge. `PIDAL Virtual Wheel` should appear in Windows and in the
   browser's WebHID picker.
4. Open the `webhid-wheel` demo, click **Add device**, and select
   **PIDAL Virtual Wheel**.
5. Confirm that the device reports constant force, then apply a low test force.
   The physical wheel should move; **Stop FFB** should release it.

If the physical wheel does not move, test PIDAL's own direct force test first.
That confirms the DirectInput path before troubleshooting WebHID.

## CLI examples

```powershell
# List DirectInput devices and force-feedback capability
Pidal.App.exe --list

# Start the bridge with a physical wheel selected by name
Pidal.App.exe --device "G920" --verbose

# Bypass the virtual wheel and test the physical DirectInput path
Pidal.App.exe --device "G920" --test-force 3000 --test-force-ms 2000
```

The GUI provides the same workflow with wheel selection, bridge status, a direct
force slider, gain, inversion, watchdog settings and logging.

## Compatibility with `webhid-wheel`

Current `webhid-wheel` sorts PID usage arrays before mapping Effect Operation
and Device Control values. This makes Start/Stop and Reset/StopAll/Enable work
regardless of the order Chromium returns from the descriptor.

Current PIDAL builds auto-detect the older reversed sequence sent by previous
`webhid-wheel` releases. With a fixed `webhid-wheel`, PIDAL stays in its standard
mapping. If force still behaves as though Start and Stop are swapped, update
PIDAL or set its **PID usage order** to **Standard**. Older PIDAL builds without
the compatibility mapping also work with the fixed `webhid-wheel`.

## PadForge alternative

[PadForge](./padforge-wheel-bridge.md) also uses HIDMaestro and can expose a
virtual HID-PID wheel (`PadForge Game Controller`, `0xBEEF:0xF000`). Choose it
when:

- PadForge is already being used to map the rig.
- Its device support or writer path fits the wheel better.
- You need a single tool for virtual controllers beyond WebHID FFB.

PIDAL and PadForge can be installed and run together, but only one process can
acquire a given physical wheel at a time. Do not assign the same physical wheel
to both.

## Troubleshooting

| Symptom | Check |
| --- | --- |
| `PIDAL Virtual Wheel` is not listed in WebHID | Confirm PIDAL is running and the HIDMaestro driver is installed; reconnect. |
| Virtual wheel is visible but force does nothing | Run PIDAL's direct force test; confirm the wheel is in PC/native mode and no other app owns it. |
| Physical wheel is in use | Close PadForge, games and vendor software; PIDAL acquires the wheel exclusively. |
| Force direction is wrong | Use PIDAL gain/invert settings, or `ffbInvert` in `webhid-wheel`. |
| Apply stops the effect or Stop nudges the wheel | Update `webhid-wheel` and PIDAL; confirm PIDAL's PID usage order is **Auto** or **Standard**. |
| Force stops after a few seconds | PIDAL's stale-output watchdog stopped it; keep force updates flowing or adjust the watchdog. |

## Safety

PIDAL stops constant force on process exit, device control stop/disable/reset,
physical disconnect, and when no PID output report arrives within its watchdog
window. This is a motor-control path: start with low force and keep clear of the
wheel.
