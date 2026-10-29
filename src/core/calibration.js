export function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

export function applySignedCalibration(value, deadzone = 0, saturation = 1) {
  const d = clamp(Number(deadzone) || 0, 0, 0.95);
  const s = clamp(Number(saturation) || 1, d + 1e-6, 1);
  const magnitude = Math.abs(value);
  if (magnitude <= d) return 0;
  const scaled = (magnitude - d) / Math.max(1e-6, s - d);
  return Math.sign(value) * clamp(scaled, 0, 1);
}

export function applyAxisCalibration(value, entry = {}) {
  let x = clamp(Number(value) || 0, 0, 1);
  if (entry.invert) x = 1 - x;

  const min = entry.min === undefined || entry.min === null ? 0 : entry.min;
  const max = entry.max === undefined || entry.max === null ? 1 : entry.max;
  const center = entry.center === undefined ? null : entry.center;

  if (max > min) {
    if (center !== null && center > min && center < max) {
      x = x <= center
        ? ((x - min) / (center - min)) * 0.5
        : 0.5 + ((x - center) / (max - center)) * 0.5;
    } else {
      x = (x - min) / (max - min);
    }
  } else {
    x = 0;
  }

  const d = clamp(Number(entry.deadzone) || 0, 0, 0.95);
  const s = clamp(Number(entry.saturation) || 1, d + 1e-6, 1);
  return clamp((x - d) / Math.max(1e-6, s - d), 0, 1);
}

export function applySteeringCalibration(rotation, maxRotation = 900, options = {}) {
  if (rotation === undefined || rotation === null || !Number.isFinite(rotation)) {
    return rotation;
  }
  const half = Math.max(1, Number(maxRotation) / 2);
  let value = clamp(rotation / half, -1, 1);
  if (options.invert) value = -value;
  value = applySignedCalibration(value, options.deadzone, options.saturation);
  return value * half;
}
