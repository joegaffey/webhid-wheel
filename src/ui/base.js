import { BASE_CSS } from './styles.js';

const HTMLElementBase = typeof HTMLElement !== 'undefined' ? HTMLElement : class {};

export class WebHIDElement extends HTMLElementBase {
  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    this._manager = null;
    this._profiles = null;
    this._renderQueued = false;
  }

  set manager(value) {
    if (this._manager === value) return;
    this._manager = value || null;
    if (this.isConnected) this.refresh();
  }

  get manager() {
    return this._manager;
  }

  set profiles(value) {
    this._profiles = value || null;
    if (this.isConnected) this.refresh();
  }

  get profiles() {
    return this._profiles;
  }

  connectedCallback() {
    this.render();
  }

  emit(type, detail) {
    this.dispatchEvent(new CustomEvent(type, {
      detail,
      bubbles: true,
      composed: true
    }));
  }

  scheduleRefresh() {
    if (this._renderQueued) return;
    this._renderQueued = true;
    const run = () => {
      this._renderQueued = false;
      this.refresh();
    };
    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(run);
    else setTimeout(run, 16);
  }

  render() {
    const css = typeof this.css === 'function' ? this.css() : '';
    this.shadowRoot.innerHTML = `<style>${BASE_CSS}${css}</style>${this.template()}`;
    this.bind();
    this.refresh();
  }

  css() {
    return '';
  }

  template() {
    return '';
  }

  bind() {}

  refresh() {}
}
