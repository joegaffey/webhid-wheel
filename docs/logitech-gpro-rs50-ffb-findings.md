# Logitech G Pro and RS50 HID++ FFB findings

Date: 2026-10-31

Scope: WebHID force feedback for Logitech G Pro and RS50 wheels through HID++
feature `0x8123`.

Status: the RS50 can produce a single constant force and sustain manual updates
with `START=0` at roughly 30-33 Hz. Stop/resume behaviour is unresolved. G Pro
and G923 have not been hardware-tested. The library uses `AUTOSTART` for effect
allocation and `START=0` for normal updates; it does not impose an update-rate
throttle.

## Hardware tested

| Device | USB ID | Tested | Notes |
| --- | --- | --- | --- |
| Logitech RS50 Base for PlayStation/PC | `046d:c276` | Yes | Chromium WebHID |
| Logitech G Pro | `046d:c268`, `046d:c272` | No | Expected to share the RS50 HID++ path and interface layout |
| Logitech G923 Xbox/PC | `046d:c26d`, `046d:c26e` | No | Shares HID++ feature `0x8123`, but uses a unified input/HID++ interface |

Observed RS50 HID++ state after connect:

- HID++ protocol version: `4.2`
- Force-feedback feature: `0x8123`, discovered as feature index `16`
- Slot count: `64`
- Autocenter spring slot: `1`
- Constant-force effect slot: `2`
- Output reports exposed: `0x10`, `0x11`, `0x12`
- Responses arrive on report `0x12`
- Last force level observed while driving: up to roughly `11174/32767`

## RS50 interface layout

The RS50 exposes three separate HID devices with the same product ID:

| Interface | Collections | Reports | Purpose |
| --- | --- | --- | --- |
| Joystick input | usage page `0x01`, usage `0x04` | input `0` | Steering, pedals, buttons, hat |
| HID++ | usage page `0xff43`, usages `0x0701`, `0x0702`, `0x0704` | input/output `0x10`, `0x11`, `0x12` | HID++ feature transport, including `0x8123` |
| Force/TrueForce endpoint | usage page `0xfffd`, usage `0xfd01` | input/output `1` | Dedicated 64-byte force/TrueForce stream |

The library groups the first two interfaces into one wheel session. The third
interface is not opened by the current implementation.

The G Pro is documented to use the same three-interface layout. G923 Xbox uses
one unified interface for input and HID++, so its HID++ endpoint is the same
device as the input endpoint.

## Confirmed working behaviour

- Connecting the RS50 through Chromium WebHID succeeds on the RS50 profile.
- Capability detection reports steering and FFB, with profile
  `Logitech RS50 (HID++)`.
- A single constant-force download with `AUTOSTART` produces a felt pull.
- Manual direct transport updates with `START=0` at roughly 30-33 Hz sustained
  force for several seconds. The wheel pulled continuously and did not drop the
  effect.
- Manually allocating a fresh effect slot and then sending `START=0` updates
  worked even when an existing effect slot had been used before.
- Stop writes zero force and `setEffectState(STOP)` successfully.

## Observed issues and resolutions

### 1. Picker returned only the input interface

`WheelManager.connect()` with no device receives an array from
`navigator.hid.requestDevice()`. When Chromium returned only the joystick
interface, the HID++ interface was never opened, so no FFB endpoint existed.

Resolution: always merge granted sibling interfaces into the selected set,
including when the picker returns one or more interfaces.

### 2. Concurrent slot allocation created multiple HID++ effects

A high-rate force loop can issue several `constantFast()` calls before the first
`downloadEffect` response sets the active slot. Each call then allocated another
constant-effect slot, and updates targeted the wrong slot.

Resolution: serialize first-slot allocation with a shared `slotPromise`.

### 3. `AUTOSTART` on every download restarted the effect

Setting `EFFECT_AUTOSTART` on every `downloadEffect` starts the effect when it is
created, but repeated autostart downloads did not sustain force on the RS50.

Resolution: set `AUTOSTART` only when allocating the effect. Normal force updates
use `START=0` and update the existing slot. An explicit `autostartUpdates` option
is available for firmware that requires a different behaviour.

### 4. High-rate updates did not sustain force

Manual tests showed:

- A single force works.
- Repeated updates with `AUTOSTART` at 30-58 Hz did not sustain force.
- Updates with `START=0` at about 30-33 Hz sustained force.
- A faster update loop did not sustain force reliably.

The library does not impose an update-rate limit. Applications should choose a
safe update cadence for the connected wheel and verify it with the test tools.

### 5. Resume after `STOP` is unresolved

`stop()` sends a zero-force update and `setEffectState(STOP)`. After that, plain
`START=0` updates modify the effect but do not necessarily start it again.

No resume workaround is committed. The test wizard and advanced bench should be
used to determine whether the wheel needs `AUTOSTART` plus `PLAY`, a fresh-slot
allocation, or destroy/recreate on resume.

### 6. The dedicated force/TrueForce endpoint is unused

The third RS50 interface (`0xfffd:0xfd01`, report `1`) is not opened by the
current library. The HID++ feature `0x8123` path handles constant force, so this
endpoint is not required for the first working force. It may still matter for
TrueForce, high-rate streaming, or firmware variants.

## Ruled out

- The RS50 profile and capability detection are correct.
- The HID++ feature index and protocol version are correct.
- The HID++ transport sends and receives on the expected reports.
- The HID++ target is the `0xff43` interface, not the joystick or force endpoint.
- Force levels are nonzero while driving; the issue is not a zero gain or a zero
  torque calculation.
- WebHID permissions and device opening are working.
- G923 compatibility mode is not required to get a single force on RS50. It has
  not been tried.
- Closing vendor configuration software is still a required test precondition.

## Other observations

- Manager options override the profile's `maxRotation`. An application that
  passes `maxRotation: 900` will override the RS50/G Pro profile default of
  `1080`.
- The demo force test calls `manager.constantFast()` once. It does not exercise
  the sustained high-rate update path, so a working demo force test does not
  prove that repeated HID++ updates are safe.
- Chromium exposes all three RS50 HID devices under the same product name and
  product ID. Grouping must therefore rely on interface collections, not on
  product ID alone.
- The force endpoint uses report `1`, which is easy to confuse with the joystick
  input report `0`. The current grouping correctly excludes it from the input
  interface.

## Manual test sequence

Use the guided wizard for a repeatable report:

1. Open `https://joegaffey.com/webhid-wheel-dev/logitech-wizard.html` in
   Chromium.
2. Connect the RS50 in native mode, not G923 compatibility mode.
3. Run the basic-pull and steady-update tests.
4. For deeper diagnosis, open
   `https://joegaffey.com/webhid-wheel-dev/logitech-test.html`, connect, and run
   the `RS50: 33 Hz START=0` preset.
5. Confirm the HID++ interface is `0xff43`, the feature index is `16`, the slot
   count is `64`, and the autocenter slot is `1`.
6. Confirm repeated updates use the same effect slot with `START=0` and sustain
   force.
7. Test stop and resume separately. Do not assume the effect restarts.

Observed working result:

- Allocation returned a slot.
- Updates used effect ID equal to the slot.
- Force levels `12000` and `14745` both produced felt force.
- A stream duration of 3-5 seconds remained active.

## Operational notes

- Close vendor configuration software before testing; it can claim the device.
- WebHID permission is per origin. A device authorized for the deployed site is
  not automatically authorized for `localhost`.
- A HID interface can be opened by only one browser context at a time. Close the
  other page before testing, or disconnect in the app first.
- The RS50 can retain effect state across page reloads or browser restarts.
  `resetAll` on connect usually clears it. Power-cycle the wheelbase if a slot
  appears wedged.
- A stopped effect is not the same as a zero-force playing effect. A stopped
  effect requires an explicit restart before subsequent force updates take
  effect.
- Keep an explicit stop path for safety. The wheel should be zeroed on page
  hide, disconnect and manual stop.
