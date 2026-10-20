# Logitech and Fanatec FFB workarounds

Status: research notes / not implemented.

This document records what would be needed to support force feedback for Logitech and Fanatec wheelbases over WebHID. Neither vendor uses the standard USB HID PID path that CAMMUS and Moza expose, so the generic PID implementation will not provide FFB for them.

## Summary

| Vendor / family | Input | FFB | Work required |
| --- | --- | --- | --- |
| Logitech G25/G27/G29/DFGT/MOMO/DFP | Generic likely | Vendor FF protocol | Custom FFB profile using vendor output reports |
| Logitech G923 PS | Generic likely | Vendor FF protocol + TrueForce | Custom FFB profile; TrueForce extra |
| Logitech G920/G923 Xbox/G Pro | Generic likely | HID++ | HID++ feature discovery and vendor reports |
| Fanatec CSL/DD/Podium/CSR | Generic or fixed-offset | Vendor protocol | Custom FFB profile ported from `hid-fanatecff` |

The common workaround is a per-device `ffb` profile with `init`, `constant`, and `stop` hooks that speak the vendor protocol directly. The generic USB-PID path should not be used for these devices.

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

The G920, G923 Xbox/PC edition, and G Pro use Logitech HID++ rather than the older FF protocol. These need:

- HID++ feature discovery.
- Feature-report reads/writes, not just output reports.
- A separate implementation for constant force and any TrueForce-specific behavior.

This is substantially more work than the older FF protocol and should be a later phase.

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
- `ffb.constant` and `ffb.stop` speak vendor reports directly.
- Optional periodic update hook for protocols that require repeated writes.
- Cleanup/stop when the device disconnects.
- Reconnect handling when a mode switch changes the PID.
- Report-level diagnostics: log output/feature reports and errors for troubleshooting.
- Multi-device support for bases, rims, pedals, and shifters that enumerate separately.
- Force limits, inversion, and an explicit emergency stop while developing.

## Browser constraints

- WebHID exposes HID input/output/feature reports, but not arbitrary USB control transfers.
- Both Logitech and Fanatec constant-force paths appear to use HID reports, so they are plausible in the browser.
- If any required vendor path uses a control transfer that is not exposed through HID reports, WebHID cannot implement it.
- WebHID permission is per origin. Vendor software and the browser may compete for the device; close vendor software during testing.
- A mode switch that re-enumerates the device requires handling `navigator.hid` connect/disconnect events and re-opening the new device.

## Suggested order

1. Logitech G29/G923 PS constant force using the public FF protocol.
2. Fanatec CSL DD/DD Pro constant force using `hid-fanatecff` as a reference.
3. Additional Logitech models and Fanatec families.
4. Logitech HID++ models (G920/G923 Xbox/G Pro).
5. Full effects, LEDs, displays, and TrueForce.

## References

- Logitech FF protocol: https://opensource.logitech.com/wiki/force_feedback/Logitech_Force_Feedback_Protocol_V1.6.pdf
- `new-lg4ff`: https://github.com/berarma/new-lg4ff
- `hid-fanatecff`: https://github.com/gotzl/hid-fanatecff
- `universal-pidff` (standard PID devices such as CAMMUS/Moza): https://github.com/JacKeTUs/universal-pidff
- Linux steering wheel compatibility list: https://github.com/JacKeTUs/linux-steering-wheels
