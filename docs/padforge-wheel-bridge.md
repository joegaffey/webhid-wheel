# PadForge wheel bridge for WebHID

Status: research and configuration notes. Last updated 2026-10-28.

Some force-feedback wheels expose a vendor report that WebHID cannot address, or
require a report ID that is not present in the descriptor shown to the browser.
PadForge can bridge those wheels by presenting a virtual HID-PID wheel to
WebHID and driving the physical wheel through its native (or generic) protocol.

This is not T248-specific. The same bridge applies to any wheel PadForge can
read and drive, including Logitech, Fanatec, Thrustmaster and other supported
bases. The T248 is included below as the current test case.

## Bridge architecture

```text
Browser / WebHID
    -> PadForge virtual HID-PID wheel
    -> PadForge force-feedback routing
    -> physical wheel driver or vendor writer
    -> physical wheel
```

The browser talks only to the virtual wheel. PadForge receives the virtual
wheel's HID-PID effects and forwards them to the physical wheel.

PadForge is built on HIDMaestro, which creates virtual HID controllers in user
mode through UMDF2. It installs a locally trusted self-signed certificate, with
no EV certificate and no `testsigning` boot mode. PadForge requires elevation.

## Virtual device findings

The virtual device was observed as:

```text
Product   PadForge Game Controller
VID:PID   0xBEEF:0xF000
Type      Joystick
Input     1 report, 7 bytes
Output    HID-PID reports 0x11-0x1E, 21 bytes
Feature   HID-PID report 0x11
```

This is a standard HID-PID 1.0 wheel descriptor. `webhid-wheel` detects it as a
generic PID device:

```js
ffbCaps  { constant: true, periodic: false, any: true }
pidInfo  { setEffect: 17, setConstant: 21, effectOperation: 26, ... }
```

The virtual side is verified. Whether force reaches the physical wheel depends
on PadForge's driver and writer path for that wheel.

## Case study: Thrustmaster T248

Direct T248 force feedback over WebHID is not currently possible on Windows.

| Mode | Product ID | Output report | Result |
| --- | --- | --- | --- |
| PC | `044f:b696` | `0x0A`, 63 bytes | Writes accepted, firmware ignored |
| PS4 | `044f:b66d` | `0x05`, 31 bytes | Writes accepted, firmware ignored |

The input reports are report `0x02` (63 bytes, vendor), report `0x07` (63 bytes,
joystick axes and buttons) and report `0x14` (63 bytes, vendor).

The force channel used by the Linux `hid-tmff2` driver, the macOS T300 driver
and PadForge is report **`0x60`**, sent as a 64-byte interrupt-OUT frame (`0x60`
plus 63 payload bytes). WebHID rejects `0x60` with `NotAllowedError`; report `0`
is rejected as well.

Sending vendor setup and force commands through reports `0x0A` or `0x05` does
not work. Range, autocenter and constant-effect frames are accepted by the OS
but produce no physical change. The T248 open command sent through `0x0A`
resets/re-enumerates the device and drops WebHID permission.

References:

- Linux `hid-tmff2`: T248 report `0x60`, setup/open commands, range and
  autocenter framing, constant/periodic effect encoding.
- macOS `thrustmaster_t300rs_gt_macos_driver`: confirms that the firmware
  ignores SET_REPORT and that the driver writes raw interrupt-OUT frames
  starting with `0x60`.
- `T248-to-PPM`: confirms the T248 uses the same 64-byte `0x60` frame shape.
- PadForge `ThrustmasterRawHidWriter`: T248 support for `0xB696`, report `0x60`,
  range/autocenter/LEDs and constant/periodic effects.

PadForge's T248 writer sends report `0x60` with `CreateFileW` + `WriteFile` and
pads the frame to the device's output report length. Its source notes that
Thrustmaster wheels enumerate first with a boot/init PID and that the official
Windows driver switches them to the active PID (`0xB696` for the T248). The
T248 already reported `0xB696`, but the descriptor still exposed output report
`0x0A`, not `0x60`. The likely missing piece is the official Thrustmaster
driver/switching path that exposes the active FFB descriptor.

In the current test configuration, PadForge's own **Apply Constant Force** test
did not move the T248. That points to the physical write path rather than
WebHID.

On Linux, `hid-tmff2` rewrites the HID descriptor to expose report `0x60` to
userspace. That may allow direct WebHID without a bridge after the kernel driver
is loaded. This has not been verified on the test rig.

## Setup

### Requirements

- Windows with Chrome or Edge
- PadForge, run elevated
- The physical wheel's vendor driver/software, where the native FFB path needs it
- The wheel in its normal PC/native mode
- Vendor control software closed while testing
- Optional: HidHide if games or other apps see both the physical and virtual wheel

### 1. Verify the physical wheel path first

Do this before testing the browser. If PadForge cannot make the physical wheel
move, WebHID cannot either.

1. Install and start PadForge.
2. Add an **Extended** virtual controller.
3. On the Devices page, select the physical wheel and assign it to the slot.
4. If the live axis bars do not move, enable **Force Raw Joystick Mode** on the
   device row.
5. Map the wheel with **Clone Device 1:1** (preferred) or the Mappings tab.
   Map All is button-oriented and is not the right first step for wheel axes.
6. Open the slot's **Wheel** tab:
   - Rotation Range: use the wheel's normal range (for example `900`)
   - Auto Centering Strength: `0`
   - Set Rotation Range: optional
   - RPM Shift LEDs: optional
7. Open the **Force Feedback** tab:
   - Overall Gain: `100`
   - Use **Apply Constant Force** and drag X slightly off center.

The physical wheel must move for this test. If it does not, stop and
troubleshoot the physical path:

- Confirm the wheel is in its PC/native mode.
- Install or repair the vendor driver, reconnect the wheel, and restart PadForge.
- Check PadForge **Settings -> Diagnostics**, enable logging, repeat the test,
  and inspect the log/snapshot for failed writes.
- Close other software that may hold the wheel open.

### 2. Connect the browser to the virtual wheel

1. Keep PadForge running with the physical wheel assigned to the slot.
2. Open the WebHID app.
3. Click Connect and select **PadForge Game Controller**
   (`0xBEEF:0xF000`), not the physical wheel.
4. Confirm the app reports constant force support.
5. Start with a low force value and increase gradually.

The browser talks only to the virtual PID wheel. PadForge is responsible for
driving the physical wheel.

### 3. Fallback

If PadForge's native path cannot be made to work:

- Use a platform where the kernel can expose the wheel's real FFB report to
  WebHID, such as Linux with `hid-tmff2` for supported Thrustmaster wheels.
- Use a physical USB bridge that presents a HID-PID wheel to Windows.
- Use a native helper that writes the vendor report itself; this abandons pure
  WebHID and needs a separate browser transport.

## Troubleshooting

| Symptom | Check |
| --- | --- |
| Physical wheel not listed in PadForge | Vendor driver, native mode, USB cable, close other HID apps |
| Listed but axes do not move | Enable **Force Raw Joystick Mode** |
| Wheel feels locked or has a very short range | Set a normal Wheel-tab range and auto-center to `0` |
| Virtual wheel not visible in WebHID | Confirm the PadForge slot is running and Force Feedback is checked; reconnect |
| WebHID sees the virtual wheel but no force | First make PadForge's own constant-force test move the physical wheel |
| PadForge constant-force test does nothing | Vendor driver/active descriptor, diagnostics log, vendor report write path |
| Force works only on another platform | That platform's kernel/driver is exposing a report ID Windows/WebHID does not |

## Limitations

- This is not a browser-only solution. It requires PadForge, elevation, the
  HIDMaestro driver/certificate, and any vendor driver the physical wheel needs.
- The browser sees a virtual wheel, not the physical wheel.
- Anti-cheat or other vendor software may object to virtual HID devices.
- `webhid-wheel` currently exposes constant force only. Periodic and mixed
  effects are future work even if the virtual device advertises them.
- PadForge's own settings must remain valid: overall gain above zero,
  auto-center at the desired value, and a sane rotation range.
