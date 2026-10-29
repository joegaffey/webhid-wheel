import { WebHIDDevicePicker } from './device-picker.js';
import { WebHIDSteeringConfig } from './steering-config.js';
import { WebHIDAxisMapper } from './axis-mapper.js';
import { WebHIDButtonMapper } from './button-mapper.js';
import { WebHIDConfigPanel } from './config-panel.js';

export {
  WebHIDDevicePicker,
  WebHIDSteeringConfig,
  WebHIDAxisMapper,
  WebHIDButtonMapper,
  WebHIDConfigPanel
};

const ELEMENTS = [
  ['webhid-device-picker', WebHIDDevicePicker],
  ['webhid-steering-config', WebHIDSteeringConfig],
  ['webhid-axis-mapper', WebHIDAxisMapper],
  ['webhid-button-mapper', WebHIDButtonMapper],
  ['webhid-config-panel', WebHIDConfigPanel]
];

export function registerWebHIDElements() {
  if (typeof customElements === 'undefined') return;
  for (const [name, constructor] of ELEMENTS) {
    if (!customElements.get(name)) customElements.define(name, constructor);
  }
}

registerWebHIDElements();
