declare global {
  interface HIDDeviceFilter {
    vendorId?: number;
    productId?: number;
    usagePage?: number;
    usage?: number;
  }

  interface HIDDevice {
    readonly collections: any[];
    readonly opened: boolean;
    readonly vendorId: number;
    readonly productId: number;
    readonly productName: string;
    readonly serialNumber?: string;
    oninputreport: ((this: HIDDevice, event: any) => any) | null;
    open(): Promise<void>;
    close(): Promise<void>;
    sendReport(reportId: number, data: BufferSource): Promise<void>;
    sendFeatureReport(reportId: number, data: BufferSource): Promise<void>;
    receiveFeatureReport(reportId: number): Promise<DataView>;
    addEventListener(type: string, listener: (...args: any[]) => void): void;
    removeEventListener(type: string, listener: (...args: any[]) => void): void;
  }
}

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
  /** Hat/POV state, when the device exposes one. */
  hats?: DeviceHat[];
}

export interface DeviceAxis {
  value: number;
  raw: number;
}

export interface DeviceHat {
  raw: number | null;
  x: number;
  y: number;
  direction: string | null;
}

export interface DeviceState {
  /** Axes normalized to 0-1. */
  axes: number[];
  /** Raw axis values. */
  rawAxes: number[];
  buttons: boolean[];
  hats: DeviceHat[];
  reports: Record<number, number[]>;
  timestamp: number;
  reportId: number | null;
}

export interface DeviceLayoutAxis {
  index: number;
  reportId: number;
  offset: number;
  size: number;
  min?: number;
  max?: number;
  usage: number;
}

export interface DeviceLayoutButton {
  index: number;
  reportId: number;
  offset: number;
  usage: number;
}

export interface DeviceLayoutHat extends DeviceLayoutAxis {}

export interface DeviceLayout {
  reports: Array<{ id: number; len: number; fields: unknown[] }>;
  axes: DeviceLayoutAxis[];
  buttons: DeviceLayoutButton[];
  hats: DeviceLayoutHat[];
}

export interface AxisCalibration {
  /** Normalized low end of the usable range. Default 0. */
  min?: number;
  /** Optional center detent, normalized. */
  center?: number | null;
  /** Normalized high end of the usable range. Default 1. */
  max?: number;
  invert?: boolean;
  /** Low-end deadzone, 0-1. */
  deadzone?: number;
  /** Saturation point, 0-1 and greater than deadzone. */
  saturation?: number;
}

export interface InputMapping extends AxisCalibration {
  source: 'axis' | 'button' | 'hat';
  index: number;
  direction?: string;
}

export interface DeviceChannelMapping {
  [channel: string]: InputMapping | null | undefined;
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
   * Apply a constant force. Sets up the effect on every call.
   * @param value normalized force in the range -1 to +1.
   */
  constant(value: number): Promise<void>;
  /**
   * Apply a constant force, reusing the running effect after the first call.
   * Falls back to full setup when no fast path is available.
   * @param value normalized force in the range -1 to +1.
   */
  constantFast(value: number): Promise<void>;
  /** Stop all force feedback effects. */
  stop(): Promise<void>;
}

export interface WheelFfbProfile {
  /** Optional one-time device setup after connect. */
  init?: (device: HIDDevice, wheel: WebHIDWheel) => Promise<void>;
  constant?: (device: HIDDevice, value: number, wheel: WebHIDWheel) => Promise<void>;
  constantFast?: (device: HIDDevice, value: number, wheel: WebHIDWheel) => Promise<void>;
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
  /** Optional product IDs matched alongside `vendorId`. */
  productIds?: number[];
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
  /** Steering saturation, 0-1. Default 1. */
  saturation?: number;
  /** Invert steering direction. Default false. */
  invertSteering?: boolean;
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
  /** Descriptor-derived signature used to disambiguate identical devices. */
  signature?: string;
  /** Name of the selected profile or the generic descriptor fallback. */
  parserName?: string | null;
  /** The matched profile, if any. */
  profile?: WheelProfile | null;
  /** Force-feedback capabilities of the connected wheel. */
  ffbCaps?: FfbCapabilities;
  /** Force-feedback handle (available after `connect`). */
  ffb?: WheelFfb;
  /** Generic input layout for this device. */
  inputLayout?: DeviceLayout;
  /** Generic axes/buttons/hats state for this device. */
  deviceState?: DeviceState;

  maxRotation: number;
  ffbStrength: number;
  ffbInvert: boolean;
  deadzone: number;
  saturation: number;
  invertSteering: boolean;

  setConstantForce(value: number): Promise<void>;
  setConstantForceFast(value: number): Promise<void>;
  stopEffects(): Promise<void>;
}


export interface WebHIDDeviceOptions {
  /** Filters passed to `navigator.hid.requestDevice`. */
  filters?: HIDDeviceFilter[];
}

export declare class WebHIDDevice {
  constructor(options?: WebHIDDeviceOptions);

  on(event: 'input', fn: (state: DeviceState) => void): this;
  on(event: 'connect', fn: (device: HIDDevice) => void): this;
  on(event: 'disconnect', fn: (device: HIDDevice) => void): this;
  on(event: 'error', fn: (error: unknown) => void): this;
  on(event: string, fn: (...args: unknown[]) => void): this;

  off(event: string, fn: (...args: unknown[]) => void): this;

  connect(device?: HIDDevice): Promise<HIDDevice | null>;
  disconnect(): Promise<void>;

  readonly isConnected: boolean;
  readonly state: DeviceState;

  device: HIDDevice | null;
  name?: string;
  vendorId?: number;
  productId?: number;
  signature?: string;
  inputLayout: DeviceLayout;
}

export declare function mapChannels(
  state: DeviceState,
  mapping: DeviceChannelMapping
): Record<string, number>;

export declare function isForceFeedbackWheel(device: HIDDevice): boolean;
export declare function deviceSignature(device: HIDDevice): string;

export interface DeviceCapabilities {
  steering: boolean;
  ffb: boolean;
  axes: number;
  buttons: number;
  hats: number;
  driver: 'wheel' | 'generic';
  profile: string | null;
}

export declare function detectDeviceCapabilities(device: HIDDevice): DeviceCapabilities;

export default WebHIDWheel;

export declare const PROFILE_KIND: 'webhid-wheel-profile';
export declare const PROFILE_STORE_KIND: 'webhid-wheel-profile-store';
export declare const PROFILE_SCHEMA_VERSION: number;

export interface SetupProfileHardware {
  vendorId: number;
  productId: number;
  productName?: string;
  signature?: string | null;
}

export interface SetupProfileDevice {
  alias: string;
  driver: 'wheel' | 'generic';
  hardware: SetupProfileHardware;
}

export interface ProfileAxisMapping {
  device: string;
  source: 'axis';
  index: number;
  invert?: boolean;
  min?: number;
  center?: number | null;
  max?: number;
  deadzone?: number;
  saturation?: number;
}

export interface ProfileButtonMapping {
  device: string;
  source: 'button' | 'hat';
  index: number;
  direction?: string;
}

export interface ProfileSteeringMapping {
  device: string;
  deadzone: number;
  saturation: number;
  maxRotation: number;
  invert: boolean;
}

export interface ProfileFfbMapping {
  device: string;
  gain: number;
  invert: boolean;
}

export interface SetupProfileSettings {
  steering: ProfileSteeringMapping;
  ffb: ProfileFfbMapping;
  axes: Record<string, ProfileAxisMapping>;
  buttons: Record<string, ProfileButtonMapping>;
}

export interface SetupProfile {
  kind: typeof PROFILE_KIND;
  schemaVersion: number;
  profileName: string;
  devices: SetupProfileDevice[];
  settings: SetupProfileSettings;
  metadata?: Record<string, unknown>;
}

export interface ProfileStore {
  kind: typeof PROFILE_STORE_KIND;
  schemaVersion: number;
  activeProfile: string | null;
  profiles: SetupProfile[];
}

export interface ProfileStoreAdapter {
  load(): string | null;
  save(text: string): void;
}

export interface ProfileMatchResult {
  status: 'matched' | 'partial' | 'ambiguous' | 'authorization-required' | 'connected' | 'error';
  matches: Record<string, HIDDevice>;
  missing: Array<{ alias: string; hardware: SetupProfileHardware }>;
  ambiguous: Array<{ alias: string; candidates: HIDDevice[] }>;
  filters: HIDDeviceFilter[];
  error?: unknown;
}

export interface SetupProfileManagerOptions {
  store?: ProfileStoreAdapter | null;
}

export declare function validateProfile(value: unknown, options?: { hardware?: SetupProfileHardware }): SetupProfile;
export declare function migrateProfile(value: unknown, options?: { hardware?: SetupProfileHardware }): SetupProfile;
export declare function serializeProfile(value: unknown): string;
export declare function parseProfile(text: string, options?: { hardware?: SetupProfileHardware }): SetupProfile;
export declare function profileFilters(profile: unknown): HIDDeviceFilter[];
export declare function matchProfile(profile: unknown, devices: HIDDevice[]): ProfileMatchResult;
export declare function reconnectProfile(
  manager: WheelManager | WebHIDWheel,
  profile: unknown,
  options: { getDevices: () => Promise<HIDDevice[]> }
): Promise<ProfileMatchResult>;
export declare function validateStore(value: unknown): ProfileStore;
export declare function serializeStore(value: unknown): string;
export declare function parseStore(text: string): ProfileStore;

export declare class SetupProfileManager {
  constructor(options?: SetupProfileManagerOptions);
  validate(value: unknown, options?: { hardware?: SetupProfileHardware }): SetupProfile;
  migrate(value: unknown, options?: { hardware?: SetupProfileHardware }): SetupProfile;
  serialize(profile: unknown): string;
  parse(text: string, options?: { hardware?: SetupProfileHardware }): SetupProfile;
  match(profile: unknown, devices: HIDDevice[]): ProfileMatchResult;
  reconnect(manager: WheelManager | WebHIDWheel, profile: unknown, options: { getDevices: () => Promise<HIDDevice[]> }): Promise<ProfileMatchResult>;
  validateStore(value: unknown): ProfileStore;
  serializeStore(value: unknown): string;
  parseStore(text: string): ProfileStore;
  toProfile(manager: WheelManager, options?: { profileName?: string; metadata?: Record<string, unknown> }): SetupProfile;
  loadStore(): ProfileStore | null;
  saveStore(value: unknown): string;
}

export { SetupProfileManager as ProfileManager };

export interface WheelManagerOptions extends WebHIDWheelOptions {
  saturation?: number;
  invertSteering?: boolean;
  mapping?: {
    steering?: Partial<ProfileSteeringMapping>;
    ffb?: Partial<ProfileFfbMapping>;
    axes?: Record<string, ProfileAxisMapping>;
    buttons?: Record<string, ProfileButtonMapping>;
  };
  wheelOptions?: WebHIDWheelOptions;
  deviceOptions?: WebHIDDeviceOptions;
  metadata?: Record<string, unknown>;
}

export interface WheelManagerSessionState {
  id: string;
  name: string;
  driver: 'wheel' | 'generic';
  capabilities: DeviceCapabilities;
  connected: boolean;
  state: WheelState | DeviceState | null;
}

export interface WheelManagerState {
  sessions: Record<string, WheelManagerSessionState>;
  channels: Record<string, number>;
  steering: number;
  timestamp: number;
}

export interface WheelManagerSession {
  id: string;
  name: string;
  driver: 'wheel' | 'generic';
  capabilities: DeviceCapabilities;
  device: HIDDevice;
  hardware: SetupProfileHardware;
  label: string | null;
  session: WebHIDWheel | WebHIDDevice;
}

export declare class WheelManager {
  constructor(options?: WheelManagerOptions);

  on(event: 'input', fn: (state: WheelManagerState) => void): this;
  on(event: 'connect', fn: (payload: { session: WheelManagerSession; device: HIDDevice }) => void): this;
  on(event: 'disconnect', fn: (payload: { session: WheelManagerSession; device: HIDDevice }) => void): this;
  on(event: 'error', fn: (error: unknown) => void): this;
  on(event: 'setup-applied', fn: (payload: { profile: SetupProfile; matches: Record<string, string>; missing: string[] }) => void): this;
  on(event: string, fn: (...args: unknown[]) => void): this;
  off(event: string, fn: (...args: unknown[]) => void): this;
  emit(event: string, payload?: unknown): void;

  readonly wheel: WebHIDWheel | null;
  readonly sessions: Map<string, WheelManagerSession>;
  readonly sessionList: WheelManagerSession[];
  readonly isConnected: boolean;
  readonly channels: Record<string, number>;
  readonly state: WheelManagerState;

  connect(device?: HIDDevice, options?: { driver?: 'wheel' | 'generic'; label?: string; id?: string }): Promise<WheelManagerSession | null>;
  connectWheel(device?: HIDDevice): Promise<HIDDevice | null>;
  addDevice(roleOrDevice?: string | HIDDevice, device?: HIDDevice): Promise<HIDDevice | null>;
  disconnect(id?: string): Promise<void>;
  disconnectAll(): Promise<void>;

  maxRotation: number;
  ffbStrength: number;
  ffbInvert: boolean;

  setCalibration(calibration?: { device?: string | null; deadzone?: number; saturation?: number; invert?: boolean; maxRotation?: number }): { device: string | null; deadzone: number; saturation: number; invert: boolean; maxRotation: number };
  getCalibration(): { device: string | null; deadzone: number; saturation: number; invert: boolean; maxRotation: number };
  setFfb(ffb?: { device?: string | null; gain?: number; invert?: boolean }): { device: string | null; gain: number; invert: boolean };
  getFfb(): { device: string | null; gain: number; invert: boolean };
  setMapping(mapping?: WheelManagerOptions['mapping']): SetupProfileSettings;
  getMapping(): SetupProfileSettings;
  applySetup(profile: unknown): SetupProfile;
  toSetup(options?: { profileName?: string; metadata?: Record<string, unknown> }): SetupProfile;

  constant(value: number): Promise<void>;
  constantFast(value: number): Promise<void>;
  stop(): Promise<void>;
}

export declare function clamp(value: number, min: number, max: number): number;
export declare function applySignedCalibration(value: number, deadzone?: number, saturation?: number): number;
export declare function applyAxisCalibration(value: number, entry?: AxisCalibration): number;
export declare function applySteeringCalibration(rotation: number, maxRotation?: number, options?: { deadzone?: number; saturation?: number; invert?: boolean }): number;
