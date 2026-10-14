import type { ClipType, TrackKind } from '@vep/core';

export const HEADER_WIDTH = 196;
export const RULER_HEIGHT = 28;
export const NEW_TRACK_ZONE = 44;
export const SNAP_PX = 8;

export const TRACK_HEIGHT: Record<TrackKind, number> = {
  video: 64,
  audio: 52,
};

export const CLIP_COLORS: Record<ClipType, { bg: string; border: string; text: string }> = {
  video: { bg: 'bg-clip-video', border: 'border-[#7b7bf0]', text: 'text-indigo-100' },
  image: { bg: 'bg-clip-image', border: 'border-[#2bb3a6]', text: 'text-teal-50' },
  text: { bg: 'bg-clip-text', border: 'border-[#e09a2e]', text: 'text-amber-50' },
  shape: { bg: 'bg-clip-shape', border: 'border-[#e0559a]', text: 'text-pink-50' },
  audio: { bg: 'bg-clip-audio', border: 'border-[#2fb07f]', text: 'text-emerald-50' },
};

/** MIME type used when dragging library items onto the timeline. */
export const DRAG_MIME = 'application/x-cutroom-item';

export type DragPayload =
  | { kind: 'asset'; assetId: string }
  | { kind: 'text'; presetId: string }
  | { kind: 'shape'; presetId: string }
  | { kind: 'transition'; type: string };

let activePayload: DragPayload | null = null;

/** Browsers hide dataTransfer contents during dragover, so the payload is also kept here. */
export function setDragPayload(payload: DragPayload | null): void {
  activePayload = payload;
}

export function getDragPayload(): DragPayload | null {
  return activePayload;
}
