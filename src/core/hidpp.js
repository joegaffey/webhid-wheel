const REPORT_ID_SHORT = 0x10;
const REPORT_ID_LONG = 0x11;
const REPORT_ID_VERY_LONG = 0x12;
const REPORT_SHORT_SIZE = 7;
const REPORT_LONG_SIZE = 20;
const REPORT_VERY_LONG_SIZE = 64;
const HIDPP_ERROR = 0x8f;
const DEFAULT_DEVICE_INDEX = 0xff;
const DEFAULT_SOFTWARE_ID = 0x0a;
const DEFAULT_TIMEOUT_MS = 1000;

function collections(device) {
  return (device && device.collections) || [];
}

function hasInputReports(device) {
  return collections(device).some(collection => (collection.inputReports || []).length > 0);
}

export function isHidppInterface(device) {
  return collections(device).some(collection => {
    if (collection.usagePage === 0xff43) return true;
    return (collection.outputReports || []).some(report =>
      report.reportId === REPORT_ID_SHORT ||
      report.reportId === REPORT_ID_LONG ||
      report.reportId === REPORT_ID_VERY_LONG
    );
  });
}

export function isFfbEndpointInterface(device) {
  return collections(device).some(collection =>
    collection.usagePage === 0xfffd && collection.usage === 0xfd01
  );
}

export function looksLikeInputInterface(device) {
  const inputCollection = collections(device).some(collection =>
    collection.usagePage === 0x01 &&
    (collection.usage === 0x04 || collection.usage === 0x05) &&
    (collection.inputReports || []).length > 0
  );
  if (inputCollection) return true;
  if (isHidppInterface(device) || isFfbEndpointInterface(device)) return false;
  return hasInputReports(device);
}

export function pickPrimaryInterface(devices) {
  const list = (Array.isArray(devices) ? devices : []).filter(Boolean);
  return list.find(looksLikeInputInterface) ||
    list.find(hasInputReports) ||
    list[0] ||
    null;
}

export function samePhysicalDevice(a, b) {
  if (!a || !b) return false;
  if (a.vendorId !== b.vendorId || a.productId !== b.productId) return false;
  if (a.serialNumber && b.serialNumber) return a.serialNumber === b.serialNumber;
  return (a.productName || '') === (b.productName || '');
}

export function hasAmbiguousInterfaceGroup(devices, device) {
  if (device && device.serialNumber) return false;
  const inputs = (devices || []).filter(looksLikeInputInterface).length;
  const hidpp = (devices || []).filter(isHidppInterface).length;
  return inputs > 1 || hidpp > 1;
}

export function findHidppInterface(primary, devices) {
  return (devices || []).find(device =>
    device !== primary &&
    samePhysicalDevice(device, primary) &&
    isHidppInterface(device)
  ) || null;
}

function bytesOf(value) {
  if (!value) return new Uint8Array(0);
  if (value instanceof Uint8Array) return value;
  if (ArrayBuffer.isView(value)) {
    return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  }
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  return Uint8Array.from(value);
}

function outputReportIds(device) {
  const ids = new Set();
  for (const collection of collections(device)) {
    for (const report of (collection.outputReports || [])) ids.add(report.reportId);
  }
  return ids;
}

function reportFor(paramsLength, supported) {
  const candidates = paramsLength <= 3
    ? [REPORT_ID_SHORT, REPORT_ID_LONG, REPORT_ID_VERY_LONG]
    : paramsLength <= 16
      ? [REPORT_ID_LONG, REPORT_ID_VERY_LONG]
      : [REPORT_ID_VERY_LONG];
  if (supported && supported.size) {
    const found = candidates.find(id => supported.has(id));
    if (found !== undefined) return found;
  }
  return candidates[0];
}

function reportSize(reportId) {
  if (reportId === REPORT_ID_SHORT) return REPORT_SHORT_SIZE;
  if (reportId === REPORT_ID_LONG) return REPORT_LONG_SIZE;
  return REPORT_VERY_LONG_SIZE;
}

export class HidppTransport {
  constructor(device, options = {}) {
    if (!device || typeof device.sendReport !== 'function') {
      throw new Error('HID++ transport requires a HID device with sendReport().');
    }
    this.device = device;
    this.deviceIndex = options.deviceIndex !== undefined ? options.deviceIndex : DEFAULT_DEVICE_INDEX;
    this.softwareId = options.softwareId !== undefined ? options.softwareId : DEFAULT_SOFTWARE_ID;
    this.timeout = options.timeout !== undefined ? options.timeout : DEFAULT_TIMEOUT_MS;
    this.supportedReports = outputReportIds(device);
    this.pending = null;
    this.queue = [];
    this.closed = false;
    this._usingListener = typeof device.addEventListener === 'function';
    this._onInputReport = event => this._handleReport(event);
    if (this._usingListener) {
      device.addEventListener('inputreport', this._onInputReport);
    } else {
      this._previousInputHandler = device.oninputreport || null;
      device.oninputreport = event => {
        if (this._previousInputHandler) {
          try { this._previousInputHandler.call(device, event); } catch { /* noop */ }
        }
        this._handleReport(event);
      };
    }
  }

  _handleReport(event) {
    if (this.closed || !event) return;
    const reportId = event.reportId;
    if (reportId !== REPORT_ID_SHORT &&
        reportId !== REPORT_ID_LONG &&
        reportId !== REPORT_ID_VERY_LONG) return;

    const data = bytesOf(event.data);
    if (data.length < 4 || data[0] !== this.deviceIndex) return;

    const pending = this.pending;
    if (!pending) return;

    if (data[1] === HIDPP_ERROR) {
      if (data[2] !== pending.featureIndex || data[3] !== pending.funcSw) return;
      const code = data[4] !== undefined ? data[4] : 0xff;
      const error = new Error(`HID++ error 0x${code.toString(16).padStart(2, '0')}`);
      error.code = code;
      this._finish(error, null);
      return;
    }

    if (data[1] !== pending.featureIndex || data[2] !== pending.funcSw) return;
    this._finish(null, data);
  }

  _finish(error, data) {
    const pending = this.pending;
    if (!pending) return;
    this.pending = null;
    if (pending.timer) clearTimeout(pending.timer);
    if (error) pending.reject(error);
    else pending.resolve(data);
    this._drain();
  }

  _drain() {
    if (this.pending || this.closed) return;
    const job = this.queue.shift();
    if (!job) return;

    const reportId = job.reportId || reportFor(job.params.length, this.supportedReports);
    const size = reportSize(reportId);
    const data = new Uint8Array(size - 1);
    data[0] = this.deviceIndex;
    data[1] = job.featureIndex;
    data[2] = ((job.functionId & 0x0f) << 4) | (this.softwareId & 0x0f);
    data.set(job.params.subarray(0, Math.max(0, size - 4)), 3);

    const pending = {
      featureIndex: job.featureIndex,
      funcSw: data[2],
      resolve: job.resolve,
      reject: job.reject,
      timer: null
    };
    this.pending = pending;
    pending.timer = setTimeout(() => {
      if (this.pending !== pending) return;
      this.pending = null;
      pending.reject(new Error('HID++ request timed out.'));
      this._drain();
    }, job.timeout || this.timeout);

    Promise.resolve()
      .then(() => this.device.sendReport(reportId, data))
      .catch(error => {
        if (this.pending !== pending) return;
        this.pending = null;
        if (pending.timer) clearTimeout(pending.timer);
        pending.reject(error);
        this._drain();
      });
  }

  send(featureIndex, functionId, params = [], options = {}) {
    const bytes = bytesOf(params);
    return new Promise((resolve, reject) => {
      if (this.closed) {
        reject(new Error('HID++ transport is closed.'));
        return;
      }
      this.queue.push({
        featureIndex,
        functionId,
        params: bytes,
        reportId: options.reportId,
        timeout: options.timeout,
        resolve,
        reject
      });
      this._drain();
    });
  }

  async getFeatureIndex(featureId) {
    const response = await this.send(0, 0, [featureId >>> 8, featureId & 0xff]);
    const index = response[3];
    if (!index) {
      throw new Error(`HID++ feature 0x${featureId.toString(16)} is not supported.`);
    }
    return index;
  }

  async getProtocolVersion(options = {}) {
    const response = await this.send(0, 1, [0x00, 0x00, 0x5a], {
      timeout: options.timeout
    });
    return {
      major: response[3],
      minor: response[4],
      ping: response[5]
    };
  }

  close() {
    if (this.closed) return;
    this.closed = true;
    for (const job of this.queue.splice(0)) {
      job.reject(new Error('HID++ transport is closed.'));
    }
    if (this.pending) {
      const pending = this.pending;
      this.pending = null;
      if (pending.timer) clearTimeout(pending.timer);
      pending.reject(new Error('HID++ transport is closed.'));
    }
    if (this._usingListener) {
      this.device.removeEventListener('inputreport', this._onInputReport);
    } else {
      this.device.oninputreport = this._previousInputHandler || null;
    }
  }
}
