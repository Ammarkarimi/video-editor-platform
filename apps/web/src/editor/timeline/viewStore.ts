import { create } from 'zustand';
import { HEADER_WIDTH } from './constants';

interface TimelineView {
  scrollLeft: number;
  viewportWidth: number;
  /** Snap guide (timeline seconds) shown while dragging. */
  snapGuide: number | null;
  /** Highlighted drop target while dragging from the library. */
  dropHint: { trackId: string | 'new'; start: number; duration: number; valid: boolean } | null;
  /** Rubber-band selection rectangle in content coordinates. */
  marquee: { x1: number; y1: number; x2: number; y2: number } | null;
}

export const useTimelineView = create<TimelineView>(() => ({
  scrollLeft: 0,
  viewportWidth: 1000,
  snapGuide: null,
  dropHint: null,
  marquee: null,
}));

let scroller: HTMLDivElement | null = null;

export function registerScroller(element: HTMLDivElement | null): void {
  scroller = element;
}

export function getScroller(): HTMLDivElement | null {
  return scroller;
}

/** Timeline time under a viewport x coordinate. */
export function timeAtClientX(clientX: number, zoom: number): number {
  if (!scroller) return 0;
  const rect = scroller.getBoundingClientRect();
  return Math.max(0, (clientX - rect.left + scroller.scrollLeft - HEADER_WIDTH) / zoom);
}

/** Keeps a time visible, scrolling by a page when it leaves the viewport. */
export function revealTime(time: number, zoom: number): void {
  if (!scroller) return;
  const x = time * zoom;
  const visibleStart = scroller.scrollLeft;
  const visibleEnd = scroller.scrollLeft + scroller.clientWidth - HEADER_WIDTH;
  if (x < visibleStart || x > visibleEnd - 20) {
    scroller.scrollLeft = Math.max(0, x - 40);
  }
}
