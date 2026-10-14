/** Tolerance used when comparing timeline times (seconds). */
export const TIME_EPSILON = 1e-4;

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

export function degToRad(deg: number): number {
  return (deg * Math.PI) / 180;
}

export function roundToFrame(time: number, fps: number): number {
  return Math.round(time * fps) / fps;
}

export function frameDuration(fps: number): number {
  return 1 / fps;
}

export function approxEqual(a: number, b: number, epsilon = TIME_EPSILON): boolean {
  return Math.abs(a - b) <= epsilon;
}

/** Rounds to a fixed number of decimals, avoiding float noise like 0.30000000000000004. */
export function roundTo(value: number, decimals = 4): number {
  const f = 10 ** decimals;
  return Math.round(value * f) / f;
}

/** Deterministic pseudo-random number in [0, 1) for a given integer seed (used for shake motion). */
export function hashNoise(seed: number): number {
  let x = Math.imul(seed ^ 0x9e3779b9, 0x85ebca6b);
  x ^= x >>> 13;
  x = Math.imul(x, 0xc2b2ae35);
  x ^= x >>> 16;
  return (x >>> 0) / 4294967296;
}

export function evenFloor(value: number): number {
  return Math.max(2, Math.floor(value / 2) * 2);
}

export function evenRound(value: number): number {
  return Math.max(2, Math.round(value / 2) * 2);
}
