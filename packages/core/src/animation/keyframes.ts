import type { AnimatableProp, Keyframe, Keyframes, Transform } from '../model/schema.js';
import { applyEasing, type Easing } from './easing.js';

const KEYFRAME_TIME_EPSILON = 1e-3;

export function sortKeyframes(list: Keyframe[]): Keyframe[] {
  return [...list].sort((a, b) => a.time - b.time);
}

/** Interpolates a sorted keyframe list at `time` (seconds relative to the clip start). */
export function interpolateKeyframes(list: readonly Keyframe[], time: number): number {
  const first = list[0];
  if (!first) return 0;
  if (time <= first.time) return first.value;
  const last = list[list.length - 1]!;
  if (time >= last.time) return last.value;
  // Binary search for the segment containing `time`.
  let lo = 0;
  let hi = list.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (list[mid]!.time <= time) lo = mid;
    else hi = mid;
  }
  const a = list[lo]!;
  const b = list[hi]!;
  const span = b.time - a.time;
  if (span <= 0) return b.value;
  const t = applyEasing(a.easing, (time - a.time) / span);
  return a.value + (b.value - a.value) * t;
}

export function hasKeyframes(keyframes: Keyframes, prop: AnimatableProp): boolean {
  return (keyframes[prop]?.length ?? 0) > 0;
}

export function hasAnyKeyframes(keyframes: Keyframes): boolean {
  return Object.values(keyframes).some((list) => (list?.length ?? 0) > 0);
}

/** Returns the property value at `time`, using keyframes when present and the static value otherwise. */
export function evaluateProp(
  transform: Transform,
  keyframes: Keyframes,
  prop: AnimatableProp,
  time: number,
): number {
  const list = keyframes[prop];
  if (list && list.length > 0) return interpolateKeyframes(list, time);
  return transform[prop];
}

export function findKeyframeAt(
  list: readonly Keyframe[] | undefined,
  time: number,
  epsilon = KEYFRAME_TIME_EPSILON,
): number {
  if (!list) return -1;
  return list.findIndex((k) => Math.abs(k.time - time) <= epsilon);
}

/**
 * Sets (or inserts) a keyframe at `time`, keeping the list sorted. Returns the new list.
 * `epsilon` controls how close an existing keyframe must be to be replaced.
 */
export function upsertKeyframe(
  list: readonly Keyframe[] | undefined,
  time: number,
  value: number,
  easing: Easing = 'easeInOut',
  epsilon = KEYFRAME_TIME_EPSILON,
): Keyframe[] {
  const next = [...(list ?? [])];
  const index = findKeyframeAt(next, time, epsilon);
  if (index >= 0) next[index] = { ...next[index]!, value };
  else next.push({ time: Math.max(0, time), value, easing });
  return sortKeyframes(next);
}

export function removeKeyframeAt(
  list: readonly Keyframe[] | undefined,
  time: number,
  epsilon = KEYFRAME_TIME_EPSILON,
): Keyframe[] {
  return (list ?? []).filter((k) => Math.abs(k.time - time) > epsilon);
}

export const ANIMATABLE_PROP_LIST: AnimatableProp[] = ['x', 'y', 'scale', 'rotation', 'opacity'];

/**
 * Re-bases keyframes after the clip's start moves by `offset` seconds (content stays anchored).
 * Keyframes that would land before the new start are replaced by an interpolated keyframe at 0.
 */
export function shiftKeyframes(keyframes: Keyframes, offset: number): Keyframes {
  const result: Keyframes = {};
  for (const prop of ANIMATABLE_PROP_LIST) {
    const list = keyframes[prop];
    if (!list || list.length === 0) continue;
    const sorted = sortKeyframes(list);
    const valueAtNewStart = interpolateKeyframes(sorted, offset);
    const shifted = sorted
      .map((k) => ({ ...k, time: k.time - offset }))
      .filter((k) => k.time >= -KEYFRAME_TIME_EPSILON)
      .map((k) => ({ ...k, time: Math.max(0, k.time) }));
    const droppedAny = shifted.length < sorted.length;
    if (droppedAny && findKeyframeAt(shifted, 0) < 0) {
      const droppedBefore = sorted.filter((k) => k.time - offset < -KEYFRAME_TIME_EPSILON);
      const easing = droppedBefore[droppedBefore.length - 1]?.easing ?? 'linear';
      shifted.unshift({ time: 0, value: valueAtNewStart, easing });
    }
    result[prop] = shifted;
  }
  return result;
}

/** Keeps keyframes up to `duration`, adding an interpolated keyframe at the cut when needed. */
export function truncateKeyframes(keyframes: Keyframes, duration: number): Keyframes {
  const result: Keyframes = {};
  for (const prop of ANIMATABLE_PROP_LIST) {
    const list = keyframes[prop];
    if (!list || list.length === 0) continue;
    const sorted = sortKeyframes(list);
    const kept = sorted.filter((k) => k.time <= duration + KEYFRAME_TIME_EPSILON);
    if (kept.length < sorted.length && findKeyframeAt(kept, duration) < 0) {
      kept.push({
        time: duration,
        value: interpolateKeyframes(sorted, duration),
        easing: 'linear',
      });
    }
    result[prop] = kept;
  }
  return result;
}

export function scaleKeyframeTimes(keyframes: Keyframes, factor: number): Keyframes {
  const result: Keyframes = {};
  for (const prop of ANIMATABLE_PROP_LIST) {
    const list = keyframes[prop];
    if (!list || list.length === 0) continue;
    result[prop] = list.map((k) => ({ ...k, time: k.time * factor }));
  }
  return result;
}

/** All distinct keyframe times of a clip (for timeline display and navigation). */
export function collectKeyframeTimes(keyframes: Keyframes): number[] {
  const times: number[] = [];
  for (const prop of ANIMATABLE_PROP_LIST) {
    for (const k of keyframes[prop] ?? []) {
      if (!times.some((t) => Math.abs(t - k.time) <= KEYFRAME_TIME_EPSILON)) times.push(k.time);
    }
  }
  return times.sort((a, b) => a - b);
}
