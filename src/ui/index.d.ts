import type {
  SetupProfile,
  SetupProfileDevice,
  SetupProfileHardware,
  SetupProfileManager,
  WheelManager,
  WheelManagerSession
} from '../../webhid-wheel.js';

export interface WebHIDChangeDetail {
  settings?: Record<string, unknown>;
  mapping?: Record<string, unknown>;
  profile?: SetupProfile;
}

export interface WebHIDConnectDetail {
  session: WheelManagerSession;
  device: HIDDevice;
}

export interface WebHIDAuthorizationDetail {
  filters: HIDDeviceFilter[];
  profile?: SetupProfile;
}

export interface WebHIDCaptureActionDetail {
  sessions: WheelManagerSession[];
}

export interface WebHIDSelectDetail {
  session: WheelManagerSession;
}

export interface WebHIDRemoveDeviceDetail {
  hardware: SetupProfileHardware;
  session?: WheelManagerSession;
  alias?: string;
}

export interface WebHIDTabDetail {
  tab: 'wheel' | 'axes' | 'buttons';
}

export declare class WebHIDDevicePicker extends HTMLElement {
  manager: WheelManager | null;
  filters: HIDDeviceFilter[] | null;
  selectedId: string | null;
  profileDevices: SetupProfileDevice[];
  refresh(): void;
}

export declare class WebHIDSteeringConfig extends HTMLElement {
  manager: WheelManager | null;
  settings: Record<string, unknown> | null;
  refresh(): void;
}

export declare class WebHIDAxisMapper extends HTMLElement {
  manager: WheelManager | null;
  mapping: Record<string, unknown> | null;
  refresh(): void;
}

export declare class WebHIDButtonMapper extends HTMLElement {
  manager: WheelManager | null;
  mapping: Record<string, unknown> | null;
  refresh(): void;
}

export declare class WebHIDConfigPanel extends HTMLElement {
  manager: WheelManager | null;
  profiles: SetupProfileManager | null;
  storageKey: string | null;
  tabbed: boolean;
  activeTab: 'wheel' | 'axes' | 'buttons';
  refresh(): void;
}

export declare function registerWebHIDElements(): void;

declare global {
  interface HTMLElementTagNameMap {
    'webhid-device-picker': WebHIDDevicePicker;
    'webhid-steering-config': WebHIDSteeringConfig;
    'webhid-axis-mapper': WebHIDAxisMapper;
    'webhid-button-mapper': WebHIDButtonMapper;
    'webhid-config-panel': WebHIDConfigPanel;
  }
}
