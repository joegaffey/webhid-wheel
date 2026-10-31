# Logitech, Thrustmaster and Fanatec FFB workarounds

Status: classic Logitech constant force is implemented for G29, Driving Force GT and G923 PlayStation, and HID++ `0x8123` constant force is implemented for G923 Xbox, RS50 and G Pro. None of these Logitech paths has been hardware-verified. Only CAMMUS C5 and FFBeast are hardware-verified. T248 direct WebHID is blocked on Windows; the PadForge bridge is documented in [PadForge wheel bridge for WebHID](./padforge-wheel-bridge.md). Fanatec remains a research note.

This document records what would be needed to support force feedback for Logitech, Thrustmaster and Fanatec wheelbases over WebHID. These vendors do not expose the standard USB HID PID path that CAMMUS and Moza expose, so the generic PID implementation will not provide FFB for them.

## Summary

| Vendor / family | Input | FFB | Work required |
| --- | --- | --- | --- |
| Logitech G25/G27/G29/DFGT/MOMO/DFP | Generic likely | Vendor FF protocol | G29/DFGT implemented but unverified; G25/G27/MOMO/DFP need a profile |
| Logitech G923 PS (`c266`, `c267`) | Generic likely | Vendor FF protocol + TrueForce | Implemented with the classic path; TrueForce extra |
| Logitech G923 Xbox (`c26d`, `c26e`) | Generic likely | HID++ `0x8123` | Implemented, not hardware-verified; unified input/HID++ interface |
| Logitech RS50 (`c276`, `c272` compat) | Generic likely | HID++ `0x8123` + interface-2 TrueForce stream | Implemented, not hardware-verified |
| Logitech G920 (`c262`) | Generic likely | HID++ `0x8123` | Can reuse the HID++ transport; not enabled yet |
| Logitech G Pro (`c268`, `c272`) | Generic likely | HID++ `0x8123` + interface-2 TrueForce stream | Implemented, not hardware-verified |
| Thrustmaster T248 | Generic | Vendor protocol, report `0x60` | Blocked in WebHID on Windows; use the PadForge bridge or Linux `hid-tmff2` |
| Fanatec CSL/DD/Podium/CSR | Generic or fixed-offset | Vendor protocol | Custom FFB profile ported from `hid-fanatecff` |

The common workaround is a per-device `ffb` profile with `init`, `constant`, and `stop` hooks that speak the vendor protocol directly. The generic USB-PID path should not be used for these devices.

## Thrustmaster T248

Direct T248 FFB over WebHID does not work on Windows:

- PC mode exposes `044f:b696`; PS4 mode exposes `044f:b66d`.
- The exposed output reports are `0x0A` (PC) and `0x05` (PS4), but the firmware ignores force commands sent through them.
- The real force channel is report `0x60`, a 64-byte interrupt-OUT frame. WebHID rejects `0x60` and report `0`.
- The T248 open command sent through the exposed reports resets/re-enumerates the wheel.

The current Windows workaround is to run PadForge with its HIDMaestro virtual HID-PID wheel and let PadForge drive the T248 through its native Thrustmaster writer. The bridge is not T248-specific; it applies to other wheels PadForge can read and drive. The full findings and configuration steps are in [PadForge wheel bridge for WebHID](./padforge-wheel-bridge.md).

On Linux, `hid-tmff2` can rewrite the descriptor to expose report `0x60`, which may make direct WebHID possible. That path has not yet been verified on hardware.

## Implemented, not hardware-verified: G29, Driving Force GT and G923 PS

The classic Logitech path is implemented for these wheels, but has not been
verified on hardware:

- Logitech G29 (`046d:c24f`, `046d:c260`)
- Logitech Driving Force GT (`046d:c29a`)
- Logitech G923 PlayStation/PC (`046d:c266`; `046d:c267` switches to PC mode)

On connect, the profile disables autocenter and sets the hardware range (clamped to 40–900°). Constant force uses the classic Download-and-Play report with one force byte, so `constantFast()` needs only one report per update. Stop sends the classic Stop Force command.

Implementation notes:

- Payloads are 7 bytes on report ID `0`.
- Constant force: `11 00 <level> 00 00 00 00`, where level 0 is full clockwise, 128 is neutral and 255 is full counter-clockwise.
- Stop force: `13 00 00 00 00 00 00`.
- Range: `f8 81 <lo> <hi> 00 00 00`.
- Autocenter off: `f5 00 00 00 00 00 00`.
- Do not use the compatibility-mode-switch commands during normal operation; they can detach and re-enumerate the wheel with a different product ID.
- G920 and G923 Xbox use HID++; G923 Xbox is covered by the next section.

## Implemented, not hardware-verified: G923 Xbox, RS50, G Pro / HID++

These wheels use HID++ feature `0x8123`, not the classic force protocol:

- Logitech G923 Xbox/PC: `046d:c26d`, `046d:c26e`
- Logitech RS50: `046d:c276`; also `046d:c272` in G Pro compatibility mode
- Logitech G Pro for PS/PC: `046d:c268`
- Logitech G Pro for Xbox/PC: `046d:c272`

Interface layouts differ:

- G923 Xbox exposes input and HID++ on the same interface, so the fixed profile
  uses that interface for both.
- RS50 and G Pro expose three interfaces: joystick input, HID++, and the
  dedicated 64-byte force/TrueForce stream. The library groups the first two
  into one session. The force endpoint is not used by the current
  constant-force implementation.
- G Pro and RS50 can also be switched to G923 compatibility mode. They then
  enumerate as `c26d`/`c26e` and use the G923 profile, including its force-sign
  correction and autostart behaviour.

Implementation notes:

- Feature discovery uses `IRoot.GetFeature(0x8123)`; the feature index is
  discovered rather than hardcoded and differs between models.
- Commands use HID++ output reports `0x10`/`0x11`/`0x12` when the descriptor
  exposes them; the G923 only exposes `0x11`/`0x12`. Responses usually arrive on
  report `0x12`.
- On connect the wheel is reset, a zero-gain autocentre spring is uploaded, and
  a constant-effect slot is allocated.
- Constant force uses `downloadEffect` function 2 with a signed 16-bit level at
  params 6-7 and infinite duration. The G923 ignores `setEffectState(PLAY)`, so
  the `AUTOSTART` bit is set on every download. `constantFast()` updates the
  allocated slot with one report per update.
- The G923 force sign is inverted relative to the G920 convention. The G923
  profile compensates for this internally.
- Stop writes a zero-force update before `setEffectState(STOP)`; disconnect
  destroys the effect slots and closes the interfaces.
- The aperture is set from `maxRotation` (clamped to 90-2700) through function 6.
  The G923 accepts the command but ignores it.
- `IRoot.GetProtocolVersion` is sent best-effort during init with a short timeout
  and never blocks FFB startup.
- If force still pulls the wrong way, use `ffbInvert`.

G920 (`046d:c262`) uses the same HID++ feature and transport, but is not enabled
yet because its gear-driven firmware may require periodic force refresh or
different autocentre handling. G923 PlayStation is a classic-protocol wheel and
is covered by the classic profile instead.

## Logitech

### Older FF protocol

Models such as the Driving Force GT, G25, G27, G29, and G923 PS edition use Logitech's force-feedback protocol. The public protocol document is:

- [Logitech Force Feedback Protocol v1.6](https://opensource.logitech.com/wiki/force_feedback/Logitech_Force_Feedback_Protocol_V1.6.pdf)

The Linux `new-lg4ff` driver is a practical reference:

- https://github.com/berarma/new-lg4ff

Implementation notes:

- Commands are sent as vendor HID output reports. In `new-lg4ff`, the driver fills a 7-byte command array and calls `HID_REQ_SET_REPORT`.
- WebHID can send the same data with `device.sendReport(reportId, data)`. The report ID is passed separately, so the payload layout must be adjusted from the kernel driver.
- Constant force is implemented by managing effect slots and updating the relevant slot command.
- Some models need a compatibility/native mode switch. These use hidden `0xf8 ...` vendor commands.
- A mode switch may cause the device to disconnect and re-enumerate with a different PID. The app/config page must handle reconnect and allow re-selection or auto-rematching.

### HID++ models

The G920, G923 Xbox/PC edition, RS50, and G Pro use Logitech HID++ rather than the older FF protocol. The implemented G923 Xbox, RS50 and G Pro path provides the reusable transport:

- HID++ feature discovery through `IRoot.GetFeature`.
- Output reports `0x10`/`0x11`/`0x12`; responses usually arrive on `0x12`.
- `0x8123` effect allocation, constant force updates, stop and teardown.
- TrueForce remains a separate later phase.

G920 uses the same `0x8123` feature and can reuse the transport, but its gear-driven firmware may need periodic force refresh or different autocentre handling. G923 Xbox already uses this path; its input and HID++ reports share one interface.

### Practical Logitech steps

1. Close G HUB while testing.
2. Select the correct HID interface.
3. Add a Logitech device profile with `ffb.constant` and `ffb.stop`.
4. Implement initialization and mode selection if required.
5. Send constant-force updates through the vendor output report.
6. Add reconnect handling for mode-switch re-enumeration.
7. Add fixed-offset input parsing only if the generic descriptor parser fails.

## Fanatec

Fanatec wheelbases use a vendor-specific HID protocol. The community Linux driver is the main reference:

- https://github.com/gotzl/hid-fanatecff

The driver notes that the wheelbase must be in **PC mode** (for CSL Elite/DD, the red LED state) for the vendor protocol to be selected.

Implementation notes from `hid-fanatecff`:

- The driver sends vendor output/feature reports, not standard PID effects.
- Initialization uses vendor commands such as `0xf8 0x09 0x01 0x06 0xff 0x01 0x00`, followed by variants that set load/range behavior.
- Some paths use `hid_hw_output_report` with an 8-byte buffer, and others use `HID_REQ_SET_REPORT`.
- For WebHID, the report ID is passed separately from the payload; kernel buffers that include the report ID must be adjusted.
- Different families may need different initialization and effect encodings: CSL Elite, CSL DD/DD Pro/ClubSport DD, Podium DD1/DD2, CSR Elite, Porsche wheels.
- Force updates may need to be sent periodically depending on the effect and firmware.

### Practical Fanatec steps

1. Put the base in PC mode.
2. Close FanaLab and other software that may claim the device.
3. Select the wheelbase HID interface.
4. Add a Fanatec device profile with vendor `init`, `constant`, and `stop`.
5. Port the constant-force path from `hid-fanatecff`, starting with one model family.
6. Add reconnect and teardown handling.
7. Add fixed-offset input parsing only if needed.

## Shared library requirements

These workarounds need small additions to the library/profile model:

- `ffb.init(device, wheel)` for vendor initialization and mode selection.
- `ffb.constant`, `ffb.constantFast`, `ffb.stop` and `ffb.dispose` speak vendor reports directly.
- Optional periodic update hook for protocols that require repeated writes.
- Cleanup/stop when the device disconnects.
- Multi-interface grouping so input, HID++ and force endpoints become one session.
- Reconnect handling when a mode switch changes the PID.
- Report-level diagnostics: log output/feature reports and errors for troubleshooting.
- Multi-device support for bases, rims, pedals, and shifters that enumerate separately.
- Force limits, inversion, and an explicit emergency stop while developing.

## Browser constraints

- WebHID exposes HID input/output/feature reports, but not arbitrary USB control transfers.
- Both Logitech and Fanatec constant-force paths appear to use HID reports, so they are plausible in the browser.
- The T248 is a counterexample: its force channel is report `0x60`, which the device descriptor exposed to WebHID as `0x0A`/`0x05`, so the browser cannot address it even though the wire path is HID.
- If any required vendor path uses a control transfer or a report ID that is not exposed to HID clients, WebHID cannot implement it.
- WebHID permission is per origin. Vendor software and the browser may compete for the device; close vendor software during testing.
- A mode switch that re-enumerates the device requires handling `navigator.hid` connect/disconnect events and re-opening the new device.

## Suggested order

1. Hardware-verify the implemented G923 Xbox, RS50 and G Pro HID++ path, plus the classic G923 PS/G29/DFGT path.
2. Fanatec CSL DD/DD Pro constant force using `hid-fanatecff` as a reference.
3. G920 `0x8123` using the same HID++ transport, with periodic-refresh testing.
4. Additional Logitech models and Fanatec families.
5. Full effects, LEDs, displays, and TrueForce.

## References

- Logitech FF protocol: https://opensource.logitech.com/wiki/force_feedback/Logitech_Force_Feedback_Protocol_V1.6.pdf
- `new-lg4ff`: https://github.com/berarma/new-lg4ff
- `hid-fanatecff`: https://github.com/gotzl/hid-fanatecff
- `universal-pidff` (standard PID devices such as CAMMUS/Moza): https://github.com/JacKeTUs/universal-pidff
- Linux steering wheel compatibility list: https://github.com/JacKeTUs/linux-steering-wheels
