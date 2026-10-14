import type { AnimationType, LoopType, VisualClip } from '../model/schema.js';
import { clamp, hashNoise, lerp } from '../util/math.js';
import { easeInBack, easeInCubic, easeOutBack, easeOutCubic } from './easing.js';
import { evaluateProp } from './keyframes.js';

export interface AnimationInfo {
  type: AnimationType;
  label: string;
  /** Text-only animations fall back to a fade on other clip types. */
  textOnly?: boolean;
}

export const ANIMATION_INFO: AnimationInfo[] = [
  { type: 'fade', label: 'Fade' },
  { type: 'slideLeft', label: 'Slide left' },
  { type: 'slideRight', label: 'Slide right' },
  { type: 'slideUp', label: 'Slide up' },
  { type: 'slideDown', label: 'Slide down' },
  { type: 'rise', label: 'Rise' },
  { type: 'zoomIn', label: 'Zoom in' },
  { type: 'zoomOut', label: 'Zoom out' },
  { type: 'pop', label: 'Pop' },
  { type: 'spin', label: 'Spin' },
  { type: 'blur', label: 'Blur' },
  { type: 'wipe', label: 'Wipe' },
  { type: 'typewriter', label: 'Typewriter', textOnly: true },
];

export const LOOP_INFO: Array<{ type: LoopType; label: string }> = [
  { type: 'kenBurnsIn', label: 'Ken Burns (zoom in)' },
  { type: 'kenBurnsOut', label: 'Ken Burns (zoom out)' },
  { type: 'pulse', label: 'Pulse' },
  { type: 'float', label: 'Float' },
  { type: 'shake', label: 'Shake' },
  { type: 'rotate', label: 'Rotate' },
];

/** Fully evaluated visual state of a clip at one moment. */
export interface ClipFrameState {
  x: number;
  y: number;
  scale: number;
  rotation: number;
  opacity: number;
  /** Additional blur (project pixels) from animations. */
  blur: number;
  /** Fraction of characters shown (typewriter). */
  textReveal: number;
  /** Visible horizontal portion of the clip box, as fractions (wipe). */
  wipeFrom: number;
  wipeTo: number;
}

function stringSeed(id: string): number {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function applyIn(
  state: ClipFrameState,
  type: AnimationType,
  p: number,
  frame: { width: number; height: number },
  isText: boolean,
): void {
  const e = easeOutCubic(p);
  switch (type) {
    case 'fade':
      state.opacity *= e;
      break;
    case 'slideLeft':
      state.x += (1 - e) * frame.width;
      break;
    case 'slideRight':
      state.x -= (1 - e) * frame.width;
      break;
    case 'slideUp':
      state.y += (1 - e) * frame.height;
      break;
    case 'slideDown':
      state.y -= (1 - e) * frame.height;
      break;
    case 'rise':
      state.y += (1 - e) * frame.height * 0.06;
      state.opacity *= e;
      break;
    case 'zoomIn':
      state.scale *= lerp(0.4, 1, e);
      state.opacity *= e;
      break;
    case 'zoomOut':
      state.scale *= lerp(1.6, 1, e);
      state.opacity *= e;
      break;
    case 'pop':
      state.scale *= Math.max(0, easeOutBack(p));
      state.opacity *= Math.min(1, p * 4);
      break;
    case 'spin':
      state.rotation -= (1 - e) * 180;
      state.scale *= lerp(0.2, 1, e);
      state.opacity *= e;
      break;
    case 'blur':
      state.blur += (1 - e) * frame.height * 0.025;
      state.opacity *= e;
      break;
    case 'wipe':
      state.wipeTo = Math.min(state.wipeTo, e);
      break;
    case 'typewriter':
      if (isText) state.textReveal = Math.min(state.textReveal, p);
      else state.opacity *= e;
      break;
  }
}

function applyOut(
  state: ClipFrameState,
  type: AnimationType,
  u: number,
  frame: { width: number; height: number },
  isText: boolean,
): void {
  // u goes 0 -> 1 across the exit; ease-in gives a gentle start that accelerates away.
  const e = easeInCubic(u);
  switch (type) {
    case 'fade':
      state.opacity *= 1 - e;
      break;
    case 'slideLeft':
      state.x -= e * frame.width;
      break;
    case 'slideRight':
      state.x += e * frame.width;
      break;
    case 'slideUp':
      state.y -= e * frame.height;
      break;
    case 'slideDown':
      state.y += e * frame.height;
      break;
    case 'rise':
      state.y -= e * frame.height * 0.06;
      state.opacity *= 1 - e;
      break;
    case 'zoomIn':
      state.scale *= lerp(1, 1.6, e);
      state.opacity *= 1 - e;
      break;
    case 'zoomOut':
      state.scale *= lerp(1, 0.4, e);
      state.opacity *= 1 - e;
      break;
    case 'pop':
      state.scale *= Math.max(0, 1 - easeInBack(u));
      state.opacity *= Math.min(1, (1 - u) * 4);
      break;
    case 'spin':
      state.rotation += e * 180;
      state.scale *= lerp(1, 0.2, e);
      state.opacity *= 1 - e;
      break;
    case 'blur':
      state.blur += e * frame.height * 0.025;
      state.opacity *= 1 - e;
      break;
    case 'wipe':
      state.wipeFrom = Math.max(state.wipeFrom, e);
      break;
    case 'typewriter':
      if (isText) state.textReveal = Math.min(state.textReveal, 1 - u);
      else state.opacity *= 1 - e;
      break;
  }
}

function applyLoop(
  state: ClipFrameState,
  type: LoopType,
  intensity: number,
  t: number,
  duration: number,
  frame: { width: number; height: number },
  seed: number,
): void {
  const progress = duration > 0 ? t / duration : 0;
  switch (type) {
    case 'kenBurnsIn':
      state.scale *= 1 + 0.15 * intensity * progress;
      break;
    case 'kenBurnsOut':
      state.scale *= 1 + 0.15 * intensity * (1 - progress);
      break;
    case 'pulse':
      state.scale *= 1 + 0.05 * intensity * Math.sin(2 * Math.PI * t);
      break;
    case 'float':
      state.y += frame.height * 0.02 * intensity * Math.sin((2 * Math.PI * t) / 3);
      break;
    case 'shake': {
      // Quantize to 24 Hz so preview and export agree regardless of frame rate.
      const step = Math.floor(t * 24);
      const amp = frame.height * 0.01 * intensity;
      state.x += (hashNoise(seed + step * 2) - 0.5) * 2 * amp;
      state.y += (hashNoise(seed + step * 2 + 1) - 0.5) * 2 * amp;
      break;
    }
    case 'rotate':
      state.rotation += 45 * intensity * t;
      break;
  }
}

/**
 * Evaluates keyframes, loop motion and in/out animations of a visual clip at `localTime`
 * (seconds since the clip start; values outside the clip are clamped to its edges).
 */
export function evaluateClipState(
  clip: VisualClip,
  localTime: number,
  frame: { width: number; height: number },
): ClipFrameState {
  const t = clamp(localTime, 0, clip.duration);
  const { transform, keyframes } = clip;
  const state: ClipFrameState = {
    x: evaluateProp(transform, keyframes, 'x', t),
    y: evaluateProp(transform, keyframes, 'y', t),
    scale: evaluateProp(transform, keyframes, 'scale', t),
    rotation: evaluateProp(transform, keyframes, 'rotation', t),
    opacity: clamp(evaluateProp(transform, keyframes, 'opacity', t), 0, 1),
    blur: 0,
    textReveal: 1,
    wipeFrom: 0,
    wipeTo: 1,
  };
  const isText = clip.type === 'text';

  if (clip.loop) {
    applyLoop(
      state,
      clip.loop.type,
      clip.loop.intensity,
      t,
      clip.duration,
      frame,
      stringSeed(clip.id),
    );
  }
  if (clip.animationIn) {
    const d = Math.min(clip.animationIn.duration, clip.duration);
    if (d > 0 && t < d) applyIn(state, clip.animationIn.type, t / d, frame, isText);
  }
  if (clip.animationOut) {
    const d = Math.min(clip.animationOut.duration, clip.duration);
    const remaining = clip.duration - t;
    if (d > 0 && remaining < d)
      applyOut(state, clip.animationOut.type, 1 - remaining / d, frame, isText);
  }
  state.opacity = clamp(state.opacity, 0, 1);
  state.scale = Math.max(0, state.scale);
  return state;
}
