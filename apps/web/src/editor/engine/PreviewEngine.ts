import {
  clamp,
  clipEnd,
  fadeGainAt,
  getClipVisibleRange,
  getProjectDuration,
  renderFrame,
  sourceTimeAt,
  type AssetDTO,
  type AudioClip,
  type CanvasLike,
  type Ctx2D,
  type FrameImage,
  type RenderHost,
  type VideoClip,
} from '@vep/core';
import {
  getAssetLookup,
  registerPlayback,
  useEditor,
  type PlaybackController,
} from '../store/editorStore';
import { fontLoader } from './fonts';

/** Seconds before a clip starts at which its media element is cued. */
const PREROLL = 1.5;
/** Allowed drift between an element and the master clock during playback. */
const MAX_DRIFT = 0.25;
/** Unused media elements are released after this long. */
const IDLE_RELEASE_MS = 20_000;

interface MediaEntry {
  clipId: string;
  url: string;
  element: HTMLVideoElement | HTMLAudioElement;
  isVideo: boolean;
  gain: GainNode | null;
  lastUsed: number;
  /** Frame captured when a seek starts, shown until the new frame is decoded. */
  snapshot: HTMLCanvasElement | null;
  snapshotValid: boolean;
}

/**
 * Drives the editor preview: keeps one media element per clip in sync with a master clock and
 * draws every frame with the same renderer the export pipeline uses.
 */
export class PreviewEngine implements PlaybackController, RenderHost {
  private readonly ctx: CanvasRenderingContext2D;
  private readonly media = new Map<string, MediaEntry>();
  private readonly images = new Map<string, HTMLImageElement>();
  private audioContext: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  private raf = 0;
  private playing = false;
  private buffering = false;
  private clockStart = 0;
  private timeAtStart = 0;
  private dirty = true;
  private readonly unsubscribe: Array<() => void> = [];

  constructor(private readonly canvas: HTMLCanvasElement) {
    const ctx = canvas.getContext('2d', { alpha: false });
    if (!ctx) throw new Error('Canvas 2D is not supported');
    this.ctx = ctx;
    registerPlayback(this);
    this.unsubscribe.push(
      useEditor.subscribe((state, prev) => {
        if (
          state.doc !== prev.doc ||
          state.assets !== prev.assets ||
          state.editingTextId !== prev.editingTextId ||
          (!state.playing && state.currentTime !== prev.currentTime)
        ) {
          this.dirty = true;
        }
        if (state.masterVolume !== prev.masterVolume && this.masterGain) {
          this.masterGain.gain.value = state.masterVolume;
        }
      }),
      fontLoader.onLoad(() => {
        this.dirty = true;
      }),
    );
    this.raf = requestAnimationFrame(this.loop);
  }

  destroy(): void {
    cancelAnimationFrame(this.raf);
    registerPlayback(null);
    for (const off of this.unsubscribe) off();
    for (const entry of this.media.values()) this.disposeEntry(entry);
    this.media.clear();
    this.images.clear();
    void this.audioContext?.close();
  }

  /** Sets the canvas backing size in device pixels. */
  resize(width: number, height: number): void {
    if (this.canvas.width === width && this.canvas.height === height) return;
    this.canvas.width = Math.max(2, width);
    this.canvas.height = Math.max(2, height);
    this.dirty = true;
  }

  requestRender(): void {
    this.dirty = true;
  }

  // ---------------------------------------------------------------------------------------
  // PlaybackController

  play(): void {
    const state = useEditor.getState();
    const { start, end } = this.playbackBounds();
    if (end - start <= 0) return;
    this.ensureAudio();
    void this.audioContext?.resume();
    let time = state.currentTime;
    if (time >= end - 1e-3 || time < start - 1e-3) time = start;
    this.timeAtStart = time;
    this.clockStart = performance.now();
    this.playing = true;
    this.buffering = false;
    useEditor.setState({ playing: true, currentTime: time });
  }

  pause(): void {
    this.playing = false;
    this.buffering = false;
    for (const entry of this.media.values()) {
      if (!entry.element.paused) entry.element.pause();
      this.setGain(entry, 0);
    }
    useEditor.setState({ playing: false, buffering: false });
    this.dirty = true;
  }

  seek(time: number): void {
    this.timeAtStart = time;
    this.clockStart = performance.now();
    this.dirty = true;
  }

  // ---------------------------------------------------------------------------------------
  // RenderHost

  getFrame(clipId: string, assetId: string): FrameImage | null {
    const entry = this.media.get(clipId);
    if (entry?.isVideo) {
      const video = entry.element as HTMLVideoElement;
      if (entry.snapshotValid && entry.snapshot && (video.seeking || video.readyState < 2)) {
        return {
          image: entry.snapshot,
          width: entry.snapshot.width,
          height: entry.snapshot.height,
        };
      }
      if (video.readyState >= 2 && video.videoWidth > 0) {
        return { image: video, width: video.videoWidth, height: video.videoHeight };
      }
      return null;
    }
    const image = this.images.get(assetId);
    if (image?.complete && image.naturalWidth > 0) {
      return { image, width: image.naturalWidth, height: image.naturalHeight };
    }
    return null;
  }

  createCanvas(width: number, height: number): CanvasLike {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    return canvas as unknown as CanvasLike;
  }

  // ---------------------------------------------------------------------------------------

  private playbackBounds(): { start: number; end: number } {
    const { doc, loopPlayback } = useEditor.getState();
    const duration = getProjectDuration(doc);
    if (loopPlayback && doc.range) {
      return { start: doc.range.start, end: Math.min(doc.range.end, duration) };
    }
    return { start: 0, end: duration };
  }

  private loop = (now: number): void => {
    this.raf = requestAnimationFrame(this.loop);
    const state = useEditor.getState();
    if (!state.loaded) return;

    if (this.playing) {
      let time = this.buffering
        ? this.timeAtStart
        : this.timeAtStart + (now - this.clockStart) / 1000;
      const { start, end } = this.playbackBounds();
      if (time >= end) {
        if (state.loopPlayback) {
          time = start;
          this.timeAtStart = start;
          this.clockStart = now;
          this.syncMedia(time, false);
        } else {
          useEditor.setState({ currentTime: end });
          this.pause();
          this.renderNow(end);
          return;
        }
      }
      const ready = this.syncMedia(time, true);
      if (!ready && !this.buffering) {
        // Hold the clock until every active element can play through.
        this.buffering = true;
        this.timeAtStart = time;
        for (const entry of this.media.values()) if (!entry.element.paused) entry.element.pause();
        useEditor.setState({ buffering: true });
      } else if (ready && this.buffering) {
        this.buffering = false;
        this.timeAtStart = time;
        this.clockStart = now;
        useEditor.setState({ buffering: false });
        this.syncMedia(time, true);
      }
      if (time !== state.currentTime) useEditor.setState({ currentTime: time });
      this.renderNow(time);
      return;
    }

    if (this.dirty) {
      this.dirty = false;
      this.syncMedia(state.currentTime, false);
      this.renderNow(state.currentTime);
    }
    this.releaseIdle(now);
  };

  private renderNow(time: number): void {
    const state = useEditor.getState();
    fontLoader.ensureForDocument(state.doc);
    this.prepareImages(state.assets);
    renderFrame(
      this.ctx as unknown as Ctx2D,
      { doc: state.doc, assets: getAssetLookup(state.assets) },
      time,
      this,
      {
        width: this.canvas.width,
        height: this.canvas.height,
        hiddenClipIds: state.editingTextId ? new Set([state.editingTextId]) : undefined,
      },
    );
  }

  private prepareImages(assets: AssetDTO[]): void {
    const { doc } = useEditor.getState();
    for (const track of doc.tracks) {
      for (const clip of track.clips) {
        if (clip.type !== 'image' || this.images.has(clip.assetId)) continue;
        const asset = assets.find((a) => a.id === clip.assetId);
        const url = asset?.urls.preview;
        if (!url) continue;
        const image = new Image();
        image.decoding = 'async';
        image.onload = () => {
          this.dirty = true;
        };
        image.src = url;
        this.images.set(clip.assetId, image);
      }
    }
  }

  private ensureAudio(): void {
    if (this.audioContext) return;
    const Ctor =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return;
    this.audioContext = new Ctor();
    this.masterGain = this.audioContext.createGain();
    this.masterGain.gain.value = useEditor.getState().masterVolume;
    this.masterGain.connect(this.audioContext.destination);
  }

  private connectAudio(entry: MediaEntry): void {
    if (entry.gain || !this.audioContext || !this.masterGain) return;
    try {
      const source = this.audioContext.createMediaElementSource(entry.element);
      const gain = this.audioContext.createGain();
      gain.gain.value = 0;
      source.connect(gain).connect(this.masterGain);
      entry.gain = gain;
      entry.element.muted = false;
    } catch {
      // Media from another origin cannot be routed; fall back to the element volume.
      entry.element.muted = false;
    }
  }

  private setGain(entry: MediaEntry, value: number): void {
    if (entry.gain && this.audioContext) {
      entry.gain.gain.setTargetAtTime(value, this.audioContext.currentTime, 0.015);
    } else {
      entry.element.volume = clamp(value, 0, 1);
    }
  }

  private ensureMedia(clip: VideoClip | AudioClip, url: string): MediaEntry {
    let entry = this.media.get(clip.id);
    if (entry && entry.url !== url) {
      this.disposeEntry(entry);
      this.media.delete(clip.id);
      entry = undefined;
    }
    if (!entry) {
      const isVideo = clip.type === 'video';
      const element = document.createElement(isVideo ? 'video' : 'audio');
      element.preload = 'auto';
      element.crossOrigin = 'anonymous';
      element.muted = true;
      if (element instanceof HTMLVideoElement) element.playsInline = true;
      const created: MediaEntry = {
        clipId: clip.id,
        url,
        element,
        isVideo,
        gain: null,
        lastUsed: performance.now(),
        snapshot: null,
        snapshotValid: false,
      };
      element.addEventListener('seeking', () => this.captureSnapshot(created));
      element.addEventListener('seeked', () => {
        created.snapshotValid = false;
        this.dirty = true;
      });
      element.addEventListener('loadeddata', () => {
        this.dirty = true;
      });
      element.src = url;
      entry = created;
      this.media.set(clip.id, entry);
    }
    entry.lastUsed = performance.now();
    return entry;
  }

  private captureSnapshot(entry: MediaEntry): void {
    const video = entry.element as HTMLVideoElement;
    if (!entry.isVideo || this.playing || video.readyState < 2 || video.videoWidth === 0) return;
    const snap = entry.snapshot ?? document.createElement('canvas');
    if (snap.width !== video.videoWidth || snap.height !== video.videoHeight) {
      snap.width = video.videoWidth;
      snap.height = video.videoHeight;
    }
    try {
      snap.getContext('2d')?.drawImage(video, 0, 0);
      entry.snapshot = snap;
      entry.snapshotValid = true;
    } catch {
      entry.snapshotValid = false;
    }
  }

  private disposeEntry(entry: MediaEntry): void {
    entry.element.pause();
    entry.element.removeAttribute('src');
    entry.element.load();
    entry.gain?.disconnect();
  }

  private releaseIdle(now: number): void {
    for (const [id, entry] of this.media) {
      if (entry.element.paused && now - entry.lastUsed > IDLE_RELEASE_MS) {
        this.disposeEntry(entry);
        this.media.delete(id);
      }
    }
  }

  /**
   * Aligns every relevant media element with the timeline time. Returns false when an active
   * element is not ready to play (so playback should wait).
   */
  private syncMedia(time: number, playing: boolean): boolean {
    const state = useEditor.getState();
    const { doc } = state;
    const fps = doc.settings.fps;
    const lookup = getAssetLookup(state.assets);
    const needed = new Set<string>();
    let ready = true;

    for (const track of doc.tracks) {
      for (const clip of track.clips) {
        if (clip.type !== 'video' && clip.type !== 'audio') continue;
        const info = lookup(clip.assetId);
        const asset = state.assets.find((a) => a.id === clip.assetId);
        const url = asset?.urls.preview;
        if (!info || !url) continue;
        const isVideo = clip.type === 'video';
        const visible = isVideo && track.kind === 'video' && !track.hidden;
        const audible = !track.muted && !clip.muted && info.hasAudio && clip.volume > 0;
        if (!visible && !audible) continue;

        const range = isVideo
          ? getClipVisibleRange(track, clip)
          : { start: clip.start, end: clipEnd(clip) };
        const active = time >= range.start && time < range.end;
        const cue = playing && !active && time >= range.start - PREROLL && time < range.start;
        if (!active && !cue) continue;
        needed.add(clip.id);

        const entry = this.ensureMedia(clip, url);
        const element = entry.element;
        if (audible) {
          if (playing) this.ensureAudio();
          this.connectAudio(entry);
        } else if (!entry.gain) {
          element.muted = true;
        }

        const maxSource = Math.max(0, info.duration - 0.05);
        const raw = sourceTimeAt(clip, active ? time : range.start);
        const target = clamp(raw, 0, maxSource);
        const gain = audible && active && playing ? clip.volume * fadeGainAt(clip, time) : 0;
        this.setGain(entry, gain);

        if (!active) {
          // Cue the upcoming clip at its first frame so it starts without a stall.
          if (!element.paused) element.pause();
          if (!element.seeking && Math.abs(element.currentTime - target) > 0.1)
            element.currentTime = target;
          continue;
        }

        const frozen = raw < 0 || raw > maxSource;
        if (playing && !frozen && !this.buffering) {
          element.playbackRate = clamp(clip.speed, 0.0625, 16);
          if (!element.seeking && Math.abs(element.currentTime - target) > MAX_DRIFT)
            element.currentTime = target;
          if (element.paused) void element.play().catch(() => undefined);
          if (element.readyState < 3 || element.seeking) ready = false;
        } else {
          if (!element.paused) element.pause();
          if (!element.seeking && Math.abs(element.currentTime - target) > 0.5 / fps)
            element.currentTime = target;
          if (playing) {
            if (element.readyState < 3 || element.seeking) ready = false;
          }
        }
      }
    }

    for (const [id, entry] of this.media) {
      if (needed.has(id)) continue;
      if (!entry.element.paused) entry.element.pause();
      this.setGain(entry, 0);
    }
    return ready;
  }
}
