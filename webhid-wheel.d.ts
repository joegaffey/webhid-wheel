/**
 * Normalized wheel state emitted on the `input` event.
 */
export interface WheelState {
  /** Raw steering value from the device (if known). */
  steering?: number;
  /** Steering angle in degrees, already scaled by `maxRotation`. */
  rotation?: number;
  /** Button pressed flags. */
  buttons: boolean[];
  /** Analog axes normalized to 0-255. */
  axes: number[];
}

export interface FfbCapabilities {
  constant: boolean;
  periodic: boolean;
  any: boolean;
}

export interface WheelFfb {
  /** Which effects this wheel supports. */
  supported: FfbCapabilities;
  /**
   * Apply a constant force.
   * @param value normalized force in the range -1 to +1.
   */
  constant(value: number): Promise<void>;
  /** Stop all force feedback effects. */
  stop(): Promise<void>;
}

export interface WheelFfbProfile {
  constant?: (device: HIDDevice, value: number, wheel: WebHIDWheel) => Promise<void>;
  periodic?: (device: HIDDevice, value: number, wheel: WebHIDWheel) => Promise<void>;
  stop?: (device: HIDDevice, wheel: WebHIDWheel) => Promise<void>;
}

export interface WheelProfile {
  /** Human readable name, shown in the UI. */
  name: string;
  /** Matched against `device.productName`. */
  match?: RegExp;
  /** Matched against `device.vendorId`. */
  vendorId?: number;
  /** Optional, alongside `vendorId`. */
  productId?: number;
  /** Default lock-to-lock range for this wheel, unless `maxRotation` is passed to the constructor. */
  maxRotation?: number;
  /** Maps a raw input report onto `wheel` state. */
  parse?: (data: DataView, wheel: WebHIDWheel) => void;
  /** Optional custom force-feedback implementation for this wheel. */
  ffb?: WheelFfbProfile;
}

export interface WebHIDWheelOptions {
  /** Full lock-to-lock range in degrees used to scale steering. Default 900. */
  maxRotation?: number;
  /** Default force scale (0-1) applied to commanded FFB. Default 0.25. */
  ffbStrength?: number;
  /** Invert constant force direction. Default false. */
  ffbInvert?: boolean;
  /** Steering deadzone as a fraction of half-range (0-1). Default 0. */
  deadzone?: number;
  /** Filters passed to `navigator.hid.requestDevice`. */
  filters?: HIDDeviceFilter[];
}

export type WebHIDWheelEvent = 'input' | 'connect' | 'disconnect' | 'error';

export declare class WebHIDWheel {
  /** Register a custom wheel profile for all instances. */
  static registerProfile(profile: WheelProfile): WheelProfile;

  constructor(options?: WebHIDWheelOptions);

  on(event: 'input', fn: (state: WheelState) => void): this;
  on(event: 'connect', fn: (device: HIDDevice) => void): this;
  on(event: 'disconnect', fn: (device: HIDDevice) => void): this;
  on(event: 'error', fn: (error: unknown) => void): this;
  on(event: string, fn: (...args: unknown[]) => void): this;

  off(event: string, fn: (...args: unknown[]) => void): this;

  /**
   * Requests (if no device is passed) and opens a wheel, then selects a profile.
   * Must be called from a user gesture.
   */
  connect(device?: HIDDevice): Promise<HIDDevice | null>;

  /** Closes the current device. */
  disconnect(): Promise<void>;

  /** True while a device is open. */
  readonly isConnected: boolean;

  /** Latest normalized state. */
  readonly state: WheelState;

  /** The currently open HID device, if any. */
  device: HIDDevice | null;

  /** Matched wheel name (from a profile) or the device product name. */
  name?: string;
  /** Name of the selected profile or the generic descriptor fallback. */
  parserName?: string | null;
  /** The matched profile, if any. */
  profile?: WheelProfile | null;
  /** Force-feedback capabilities of the connected wheel. */
  ffbCaps?: FfbCapabilities;
  /** Force-feedback handle (available after `connect`). */
  ffb?: WheelFfb;

  maxRotation: number;
  ffbStrength: number;
  ffbInvert: boolean;
  deadzone: number;

  setConstantForce(value: number): Promise<void>;
  stopEffects(): Promise<void>;
}

export default WebHIDWheel;
