import { describe, expect, it } from 'vitest';
import {
  applyEasing,
  collectKeyframeTimes,
  evaluateClipState,
  interpolateKeyframes,
  removeKeyframeAt,
  shiftKeyframes,
  upsertKeyframe,
  type Keyframe,
} from '../src/index.js';
import { videoClip } from './helpers.js';

const frame = { width: 1920, height: 1080 };

describe('easing', () => {
  it('maps the endpoints to 0 and 1', () => {
    for (const e of ['linear', 'easeIn', 'easeOut', 'easeInOut'] as const) {
      expect(applyEasing(e, 0)).toBeCloseTo(0);
      expect(applyEasing(e, 1)).toBeCloseTo(1);
    }
    expect(applyEasing('hold', 0.9)).toBe(0);
  });
});

describe('keyframes', () => {
  const list: Keyframe[] = [
    { time: 1, value: 10, easing: 'linear' },
    { time: 3, value: 30, easing: 'hold' },
    { time: 5, value: 0, easing: 'linear' },
  ];

  it('interpolates, holds and clamps', () => {
    expect(interpolateKeyframes(list, 0)).toBe(10);
    expect(interpolateKeyframes(list, 2)).toBeCloseTo(20);
    expect(interpolateKeyframes(list, 4)).toBe(30);
    expect(interpolateKeyframes(list, 9)).toBe(0);
  });

  it('upserts and removes keyframes', () => {
    let next = upsertKeyframe(list, 2, 99);
    expect(next.map((k) => k.time)).toEqual([1, 2, 3, 5]);
    next = upsertKeyframe(next, 2, 50);
    expect(next.find((k) => k.time === 2)!.value).toBe(50);
    expect(removeKeyframeAt(next, 2)).toHaveLength(3);
  });

  it('re-bases keyframes when the clip start moves', () => {
    const shifted = shiftKeyframes({ x: list }, 2);
    expect(shifted.x![0]).toMatchObject({ time: 0, value: 20 });
    expect(shifted.x!.map((k) => k.time)).toEqual([0, 1, 3]);
  });

  it('collects distinct keyframe times', () => {
    expect(
      collectKeyframeTimes({ x: list, opacity: [{ time: 3, value: 1, easing: 'linear' }] }),
    ).toEqual([1, 3, 5]);
  });
});

describe('clip state', () => {
  it('uses the static transform without animations', () => {
    const clip = videoClip(0, 5);
    clip.transform.x = 12;
    expect(evaluateClipState(clip, 2, frame)).toMatchObject({ x: 12, y: 0, scale: 1, opacity: 1 });
  });

  it('fades in and out', () => {
    const clip = videoClip(0, 4, {
      animationIn: { type: 'fade', duration: 1 },
      animationOut: { type: 'fade', duration: 1 },
    });
    expect(evaluateClipState(clip, 0, frame).opacity).toBeCloseTo(0);
    expect(evaluateClipState(clip, 2, frame).opacity).toBeCloseTo(1);
    expect(evaluateClipState(clip, 4, frame).opacity).toBeCloseTo(0);
  });

  it('slides in from off-screen and settles at the transform', () => {
    const clip = videoClip(0, 4, { animationIn: { type: 'slideLeft', duration: 1 } });
    expect(evaluateClipState(clip, 0, frame).x).toBeCloseTo(1920);
    expect(evaluateClipState(clip, 1, frame).x).toBeCloseTo(0);
  });

  it('clamps local time to the clip so transitions hold the edge state', () => {
    const clip = videoClip(0, 4, { animationOut: { type: 'fade', duration: 1 } });
    expect(evaluateClipState(clip, 10, frame).opacity).toBeCloseTo(0);
  });

  it('applies Ken Burns zoom over the whole clip', () => {
    const clip = videoClip(0, 10, { loop: { type: 'kenBurnsIn', intensity: 1 } });
    expect(evaluateClipState(clip, 0, frame).scale).toBeCloseTo(1);
    expect(evaluateClipState(clip, 10, frame).scale).toBeCloseTo(1.15);
  });

  it('combines keyframes with animations', () => {
    const clip = videoClip(0, 4, { animationIn: { type: 'zoomIn', duration: 2 } });
    clip.keyframes.scale = [
      { time: 0, value: 2, easing: 'linear' },
      { time: 4, value: 2, easing: 'linear' },
    ];
    expect(evaluateClipState(clip, 0, frame).scale).toBeCloseTo(0.8);
    expect(evaluateClipState(clip, 3, frame).scale).toBeCloseTo(2);
  });
});
