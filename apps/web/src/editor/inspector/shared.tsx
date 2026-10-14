import {
  clamp,
  collectKeyframeTimes,
  evaluateProp,
  findClip,
  findKeyframeAt,
  type AnimatableProp,
  type Clip,
  type ProjectDoc,
  type VisualClip,
} from '@vep/core';
import clsx from 'clsx';
import type { Draft } from 'immer';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { editor, useEditor } from '../store/editorStore';

/** Applies a recipe to one clip; `key` merges rapid changes (slider drags) into one undo step. */
export function updateClip(
  clipId: string,
  recipe: (clip: Draft<Clip>) => void,
  key?: string,
): void {
  editor.update(
    (draft) => {
      const loc = findClip(draft as ProjectDoc, clipId);
      if (loc) recipe(loc.clip as Draft<Clip>);
    },
    key ? { history: `${clipId}:${key}` } : {},
  );
}

function Diamond({ state }: { state: 'none' | 'animated' | 'key' }) {
  return (
    <svg width="11" height="11" viewBox="0 0 12 12" aria-hidden="true">
      <path
        d="M6 1 11 6 6 11 1 6Z"
        className={clsx(
          state === 'key' ? 'fill-yellow-300 stroke-yellow-300' : 'fill-none',
          state === 'animated' ? 'stroke-yellow-300' : state === 'none' ? 'stroke-dim' : '',
        )}
        strokeWidth="1.4"
      />
    </svg>
  );
}

/** Toggles a keyframe for an animatable property at the playhead. */
export function KeyframeButton({ clip, prop }: { clip: VisualClip; prop: AnimatableProp }) {
  const time = useEditor((s) => s.currentTime);
  const local = clamp(time - clip.start, 0, clip.duration);
  const list = clip.keyframes[prop];
  const animated = !!list && list.length > 0;
  const atKey = animated && findKeyframeAt(list, local) >= 0;
  const state = atKey ? 'key' : animated ? 'animated' : 'none';

  const toggle = () => {
    const value = evaluateProp(clip.transform, clip.keyframes, prop, local);
    updateClip(clip.id, (c) => {
      if (c.type === 'audio') return;
      const current = c.keyframes[prop];
      if (!current || current.length === 0) {
        c.keyframes[prop] = [{ time: local, value, easing: 'easeInOut' }];
        return;
      }
      const index = current.findIndex((k) => Math.abs(k.time - local) < 1e-3);
      if (index >= 0) {
        current.splice(index, 1);
        if (current.length === 0) {
          delete c.keyframes[prop];
          c.transform[prop] = value;
        }
      } else {
        current.push({ time: local, value, easing: 'easeInOut' });
        current.sort((a, b) => a.time - b.time);
      }
    });
  };

  return (
    <button
      type="button"
      onClick={toggle}
      className="flex h-6 w-6 shrink-0 items-center justify-center rounded hover:bg-panel-3"
      title={
        state === 'none'
          ? 'Animate this property (add keyframe)'
          : state === 'key'
            ? 'Remove keyframe at playhead'
            : 'Add keyframe at playhead'
      }
      aria-label={`Keyframe ${prop}`}
      data-testid={`keyframe-${prop}`}
    >
      <Diamond state={state} />
    </button>
  );
}

/** Jumps between a clip's keyframes. */
export function KeyframeNav({ clip }: { clip: VisualClip }) {
  const time = useEditor((s) => s.currentTime);
  const times = collectKeyframeTimes(clip.keyframes).map((t) => clip.start + t);
  if (times.length === 0) return null;
  const prev = [...times].reverse().find((t) => t < time - 1e-3);
  const next = times.find((t) => t > time + 1e-3);
  return (
    <div className="flex items-center">
      <button
        type="button"
        disabled={prev === undefined}
        onClick={() => prev !== undefined && editor.seek(prev)}
        className="rounded p-0.5 text-muted hover:text-fg disabled:opacity-30"
        title="Previous keyframe"
      >
        <ChevronLeft size={14} />
      </button>
      <span className="text-[10px] text-dim">{times.length}</span>
      <button
        type="button"
        disabled={next === undefined}
        onClick={() => next !== undefined && editor.seek(next)}
        className="rounded p-0.5 text-muted hover:text-fg disabled:opacity-30"
        title="Next keyframe"
      >
        <ChevronRight size={14} />
      </button>
    </div>
  );
}

/** Current (possibly animated) value of a transform property at the playhead. */
export function useAnimatedValue(clip: VisualClip, prop: AnimatableProp): number {
  const time = useEditor((s) => s.currentTime);
  return evaluateProp(
    clip.transform,
    clip.keyframes,
    prop,
    clamp(time - clip.start, 0, clip.duration),
  );
}
