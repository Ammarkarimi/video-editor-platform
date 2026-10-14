import {
  clamp,
  clipEnd,
  createAssetLookup,
  findClip,
  getProjectDuration,
  isVisualClip,
  roundToFrame,
  toAssetInfo,
  type AnimatableProp,
  type AssetDTO,
  type AssetLookup,
  type Clip,
  type ProjectDoc,
  type ProjectDTO,
  type RenderJobDTO,
  type VisualClip,
} from '@vep/core';
import { produce, type Draft } from 'immer';
import { create } from 'zustand';

export type SaveState = 'saved' | 'dirty' | 'saving' | 'error' | 'conflict';
export type LeftTab = 'media' | 'text' | 'transitions' | 'elements';

export interface Upload {
  id: string;
  name: string;
  progress: number;
  error: string | null;
  abort: () => void;
}

export interface ClipboardItem {
  clip: Clip;
  trackId: string;
  offset: number;
}

export interface EditorState {
  loaded: boolean;
  projectId: string;
  projectName: string;
  doc: ProjectDoc;
  /** Server version the local document is based on. */
  version: number;
  saveState: SaveState;
  saveError: string | null;

  past: ProjectDoc[];
  future: ProjectDoc[];
  /** Document snapshot at the start of an in-progress drag (see beginTransaction). */
  txBase: ProjectDoc | null;
  historyKey: string | null;
  historyTime: number;

  assets: AssetDTO[];
  uploads: Upload[];
  renders: RenderJobDTO[];

  selection: string[];
  /** Incoming clip of the selected transition, if a transition is selected. */
  selectedTransition: string | null;
  editingTextId: string | null;

  currentTime: number;
  playing: boolean;
  buffering: boolean;
  loopPlayback: boolean;
  masterVolume: number;

  /** Timeline zoom in pixels per second. */
  zoom: number;
  snapping: boolean;
  leftTab: LeftTab;
  exportOpen: boolean;
  shortcutsOpen: boolean;
  clipboard: ClipboardItem[];
}

const EMPTY_DOC: ProjectDoc = {
  schemaVersion: 1,
  settings: { width: 1920, height: 1080, fps: 30, backgroundColor: '#000000' },
  tracks: [],
  markers: [],
  range: null,
};

const HISTORY_LIMIT = 200;
const HISTORY_MERGE_MS = 1200;

const initialState = (): EditorState => ({
  loaded: false,
  projectId: '',
  projectName: '',
  doc: EMPTY_DOC,
  version: 0,
  saveState: 'saved',
  saveError: null,
  past: [],
  future: [],
  txBase: null,
  historyKey: null,
  historyTime: 0,
  assets: [],
  uploads: [],
  renders: [],
  selection: [],
  selectedTransition: null,
  editingTextId: null,
  currentTime: 0,
  playing: false,
  buffering: false,
  loopPlayback: false,
  masterVolume: 1,
  zoom: 80,
  snapping: true,
  leftTab: 'media',
  exportOpen: false,
  shortcutsOpen: false,
  clipboard: [],
});

export const useEditor = create<EditorState>(() => initialState());

const set = (patch: Partial<EditorState>) => useEditor.setState(patch);
const get = () => useEditor.getState();

// ---------------------------------------------------------------------------------------------
// Playback engine bridge: the preview engine registers itself so store actions can drive it.

export interface PlaybackController {
  play(): void;
  pause(): void;
  seek(time: number): void;
}

let playback: PlaybackController | null = null;
let onUpdateError: ((error: unknown) => void) | null = null;

/** Lets the UI report edits that threw (kept out of the store to avoid a UI dependency). */
export function setUpdateErrorHandler(handler: ((error: unknown) => void) | null): void {
  onUpdateError = handler;
}

export function registerPlayback(controller: PlaybackController | null): void {
  playback = controller;
}

// ---------------------------------------------------------------------------------------------
// Derived data

let lookupSource: AssetDTO[] | null = null;
let lookupCache: AssetLookup = () => undefined;

/** Asset lookup for core functions, memoized on the assets array identity. */
export function getAssetLookup(assets: AssetDTO[] = get().assets): AssetLookup {
  if (assets !== lookupSource) {
    lookupSource = assets;
    lookupCache = createAssetLookup(assets.filter((a) => a.metadata).map(toAssetInfo));
  }
  return lookupCache;
}

export function useAssetLookup(): AssetLookup {
  return getAssetLookup(useEditor((s) => s.assets));
}

export function getAsset(id: string): AssetDTO | undefined {
  return get().assets.find((a) => a.id === id);
}

export function selectedClip(state: EditorState = get()): Clip | null {
  if (state.selection.length !== 1) return null;
  return findClip(state.doc, state.selection[0]!)?.clip ?? null;
}

export function timelineDuration(doc: ProjectDoc = get().doc): number {
  return getProjectDuration(doc);
}

// ---------------------------------------------------------------------------------------------
// Document updates and history

export interface UpdateOptions {
  /**
   * `false` skips history; a string merges consecutive updates with the same key (slider drags)
   * into a single undo step.
   */
  history?: false | string;
}

function pruneSelection(doc: ProjectDoc, selection: string[]): string[] {
  return selection.filter((id) => findClip(doc, id));
}

export const editor = {
  reset(): void {
    playback?.pause();
    useEditor.setState(initialState(), true);
  },

  load(project: ProjectDTO, assets: AssetDTO[], renders: RenderJobDTO[]): void {
    useEditor.setState(
      {
        ...initialState(),
        loaded: true,
        projectId: project.id,
        projectName: project.name,
        doc: project.document,
        version: project.version,
        assets,
        renders,
        zoom: defaultZoom(getProjectDuration(project.document)),
      },
      true,
    );
  },

  /** Applies an Immer recipe to the document. */
  update(recipe: (doc: Draft<ProjectDoc>) => void, options: UpdateOptions = {}): void {
    const state = get();
    let next: ProjectDoc;
    try {
      next = produce(state.doc, recipe);
    } catch (err) {
      // A failed edit leaves the document untouched; tell the user instead of failing silently.
      console.error(err);
      onUpdateError?.(err);
      return;
    }
    if (next === state.doc) return;
    if (state.txBase) {
      set({ doc: next });
      return;
    }
    if (options.history === false) {
      set({ doc: next, saveState: 'dirty' });
      return;
    }
    const now = Date.now();
    const merge =
      typeof options.history === 'string' &&
      options.history === state.historyKey &&
      now - state.historyTime < HISTORY_MERGE_MS;
    set({
      doc: next,
      past: merge ? state.past : [...state.past, state.doc].slice(-HISTORY_LIMIT),
      future: [],
      historyKey: typeof options.history === 'string' ? options.history : null,
      historyTime: now,
      saveState: 'dirty',
      selection: pruneSelection(next, state.selection),
    });
  },

  /** Starts a gesture (drag/trim): intermediate states are not recorded in history. */
  beginTransaction(): void {
    const state = get();
    if (!state.txBase) set({ txBase: state.doc });
  },

  /** Replaces the document with `recipe` applied to the transaction's starting snapshot. */
  updateFromBase(recipe: (doc: Draft<ProjectDoc>) => void): void {
    const base = get().txBase;
    if (!base) return;
    set({ doc: produce(base, recipe) });
  },

  commitTransaction(): void {
    const state = get();
    const base = state.txBase;
    if (!base) return;
    if (state.doc === base) {
      set({ txBase: null });
      return;
    }
    set({
      txBase: null,
      past: [...state.past, base].slice(-HISTORY_LIMIT),
      future: [],
      historyKey: null,
      saveState: 'dirty',
      selection: pruneSelection(state.doc, state.selection),
    });
  },

  cancelTransaction(): void {
    const base = get().txBase;
    if (base) set({ doc: base, txBase: null });
  },

  undo(): void {
    const state = get();
    if (state.txBase || state.past.length === 0) return;
    const previous = state.past[state.past.length - 1]!;
    set({
      doc: previous,
      past: state.past.slice(0, -1),
      future: [state.doc, ...state.future],
      historyKey: null,
      saveState: 'dirty',
      selection: pruneSelection(previous, state.selection),
    });
  },

  redo(): void {
    const state = get();
    if (state.txBase || state.future.length === 0) return;
    const next = state.future[0]!;
    set({
      doc: next,
      past: [...state.past, state.doc],
      future: state.future.slice(1),
      historyKey: null,
      saveState: 'dirty',
      selection: pruneSelection(next, state.selection),
    });
  },

  // -------------------------------------------------------------------------------------------
  // Selection

  select(ids: string[], mode: 'replace' | 'toggle' | 'add' = 'replace'): void {
    const current = get().selection;
    let selection: string[];
    if (mode === 'replace') selection = ids;
    else if (mode === 'add') selection = [...new Set([...current, ...ids])];
    else {
      const set = new Set(current);
      for (const id of ids) {
        if (set.has(id)) set.delete(id);
        else set.add(id);
      }
      selection = [...set];
    }
    useEditor.setState({ selection, selectedTransition: null });
  },

  selectTransition(clipId: string | null): void {
    set({ selectedTransition: clipId, selection: clipId ? [] : get().selection });
  },

  clearSelection(): void {
    set({ selection: [], selectedTransition: null });
  },

  // -------------------------------------------------------------------------------------------
  // Playback

  seek(time: number): void {
    const { doc } = get();
    const max = Math.max(getProjectDuration(doc), 0);
    const t = roundToFrame(clamp(time, 0, max), doc.settings.fps);
    set({ currentTime: t });
    playback?.seek(t);
  },

  play(): void {
    playback?.play();
  },

  pause(): void {
    playback?.pause();
  },

  togglePlay(): void {
    if (get().playing) playback?.pause();
    else playback?.play();
  },

  stepFrames(frames: number): void {
    const { currentTime, doc } = get();
    playback?.pause();
    editor.seek(currentTime + frames / doc.settings.fps);
  },

  // -------------------------------------------------------------------------------------------
  // View

  setZoom(zoom: number): void {
    set({ zoom: clamp(zoom, MIN_ZOOM, MAX_ZOOM) });
  },
};

export const MIN_ZOOM = 2;
export const MAX_ZOOM = 600;

function defaultZoom(duration: number): number {
  if (duration <= 0) return 80;
  // Fit roughly a 900px wide timeline.
  return clamp(900 / duration, 8, 160);
}

// ---------------------------------------------------------------------------------------------
// Property editing helpers

/** Time relative to the clip start used for keyframing, clamped into the clip. */
export function clipLocalTime(clip: Clip, time: number = get().currentTime): number {
  return clamp(time - clip.start, 0, clip.duration);
}

/**
 * Sets an animatable property. When the property is keyframed, the keyframe at the playhead is
 * created or updated (like auto-keying in motion graphics tools); otherwise the static value
 * changes.
 */
export function setAnimatedProp(
  draft: Draft<ProjectDoc>,
  clipId: string,
  prop: AnimatableProp,
  value: number,
  time: number,
): void {
  const loc = findClip(draft as ProjectDoc, clipId);
  if (!loc || !isVisualClip(loc.clip)) return;
  const clip = loc.clip as Draft<VisualClip>;
  const list = clip.keyframes[prop];
  if (list && list.length > 0) {
    const local = clamp(time - clip.start, 0, clip.duration);
    const index = list.findIndex((k) => Math.abs(k.time - local) < 1e-3);
    if (index >= 0) list[index]!.value = value;
    else {
      list.push({ time: local, value, easing: 'easeInOut' });
      list.sort((a, b) => a.time - b.time);
    }
  } else {
    clip.transform[prop] = value;
  }
}

/** Visual clips visible at a time, top-most first (for hit testing on the preview). */
export function visualClipsAt(doc: ProjectDoc, time: number): VisualClip[] {
  const result: VisualClip[] = [];
  for (const track of doc.tracks) {
    if (track.kind !== 'video' || track.hidden) continue;
    for (const clip of track.clips) {
      if (isVisualClip(clip) && time >= clip.start && time < clipEnd(clip)) result.push(clip);
    }
  }
  return result;
}
