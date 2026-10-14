import { evaluateClipState, type ClipFrameState } from '../animation/presets.js';
import type { AssetInfo, AssetLookup } from '../api.js';
import type {
  ImageClip,
  ProjectDoc,
  ShapeClip,
  TextClip,
  VideoClip,
  VisualClip,
} from '../model/schema.js';
import { getTrackItemAt, sourceTimeAt, type TransitionWindow } from '../timeline/queries.js';
import { colorAlpha, toCssColor } from '../util/color.js';
import { clamp, degToRad } from '../util/math.js';
import { buildCssFilter } from './filters.js';
import { roundRectPath } from './paths.js';
import { drawTextBlock, layoutText } from './text.js';
import { compositeTransition } from './transitions.js';
import type { CanvasLike, Ctx2D, RenderHost } from './types.js';

export interface RenderScene {
  doc: ProjectDoc;
  assets: AssetLookup;
}

export interface RenderFrameOptions {
  /** Output size in pixels; the project is scaled to fit exactly. */
  width: number;
  height: number;
  /** Leave the canvas transparent instead of filling the project background color. */
  transparent?: boolean;
  /** Clip ids to leave out (e.g. while editing text in place). */
  hiddenClipIds?: ReadonlySet<string>;
}

interface DrawEnv {
  scene: RenderScene;
  host: RenderHost;
  frame: { width: number; height: number };
  /** Output pixels per project pixel. */
  scaleX: number;
  scaleY: number;
}

interface LayerSet {
  width: number;
  height: number;
  a: CanvasLike;
  b: CanvasLike;
  mix: CanvasLike;
}

const layerCache = new WeakMap<RenderHost, LayerSet>();

function getLayers(host: RenderHost, width: number, height: number): LayerSet {
  const cached = layerCache.get(host);
  if (cached && cached.width === width && cached.height === height) return cached;
  const set: LayerSet = {
    width,
    height,
    a: host.createCanvas(width, height),
    b: host.createCanvas(width, height),
    mix: host.createCanvas(width, height),
  };
  layerCache.set(host, set);
  return set;
}

/** Size of a media clip at scale 1: the (cropped) source fitted inside the frame. */
export function getMediaBaseSize(
  clip: VideoClip | ImageClip,
  asset: AssetInfo | undefined,
  frame: { width: number; height: number },
): { width: number; height: number } {
  const sourceW = asset && asset.width > 0 ? asset.width : frame.width;
  const sourceH = asset && asset.height > 0 ? asset.height : frame.height;
  const cw = sourceW * Math.max(0.01, 1 - clip.crop.left - clip.crop.right);
  const ch = sourceH * Math.max(0.01, 1 - clip.crop.top - clip.crop.bottom);
  const fit = Math.min(frame.width / cw, frame.height / ch);
  return { width: cw * fit, height: ch * fit };
}

/**
 * Untransformed size of a visual clip in project pixels. Text needs a context for measuring;
 * without one a rough estimate is returned.
 */
export function getClipBaseSize(
  clip: VisualClip,
  scene: RenderScene,
  measureCtx?: Ctx2D,
): { width: number; height: number } {
  const frame = scene.doc.settings;
  switch (clip.type) {
    case 'video':
    case 'image':
      return getMediaBaseSize(clip, scene.assets(clip.assetId), frame);
    case 'shape':
      return { width: clip.width, height: clip.height };
    case 'text': {
      if (measureCtx) {
        measureCtx.save();
        const layout = layoutText(measureCtx, clip.text, clip.style);
        measureCtx.restore();
        return { width: Math.max(layout.boxWidth, 1), height: Math.max(layout.boxHeight, 1) };
      }
      const lines = clip.text.split('\n');
      const longest = Math.max(1, ...lines.map((l) => l.length));
      return {
        width: longest * clip.style.fontSize * 0.55,
        height: lines.length * clip.style.fontSize * clip.style.lineHeight,
      };
    }
  }
}

export interface ClipBox {
  /** Center in project pixels from the top-left corner of the frame. */
  cx: number;
  cy: number;
  /** Scaled size in project pixels (before rotation). */
  width: number;
  height: number;
  /** Degrees, clockwise. */
  rotation: number;
  state: ClipFrameState;
}

/** On-screen box of a clip at a timeline time (used for selection handles and hit testing). */
export function getClipBox(
  clip: VisualClip,
  scene: RenderScene,
  time: number,
  measureCtx?: Ctx2D,
): ClipBox {
  const frame = scene.doc.settings;
  const state = evaluateClipState(clip, time - clip.start, frame);
  const base = getClipBaseSize(clip, scene, measureCtx);
  return {
    cx: frame.width / 2 + state.x,
    cy: frame.height / 2 + state.y,
    width: base.width * state.scale,
    height: base.height * state.scale,
    rotation: state.rotation,
    state,
  };
}

/** Whether a project-space point lies inside a (rotated) clip box. */
export function pointInClipBox(box: ClipBox, x: number, y: number): boolean {
  const angle = -degToRad(box.rotation);
  const dx = x - box.cx;
  const dy = y - box.cy;
  const lx = dx * Math.cos(angle) - dy * Math.sin(angle);
  const ly = dx * Math.sin(angle) + dy * Math.cos(angle);
  return Math.abs(lx) <= Math.abs(box.width) / 2 && Math.abs(ly) <= Math.abs(box.height) / 2;
}

/** Source media time shown by a video clip at a timeline time, clamped to the media. */
export function getVideoSourceTime(
  clip: VideoClip,
  time: number,
  asset: AssetInfo | undefined,
): number {
  const raw = sourceTimeAt(clip, time);
  const max =
    asset && asset.duration > 0 ? Math.max(0, asset.duration - 0.001) : Number.POSITIVE_INFINITY;
  return clamp(raw, 0, max);
}

function compositeOp(clip: VisualClip): string {
  return clip.blendMode === 'normal' ? 'source-over' : clip.blendMode;
}

function drawMedia(
  ctx: Ctx2D,
  clip: VideoClip | ImageClip,
  time: number,
  env: DrawEnv,
  state: ClipFrameState,
): void {
  const asset = env.scene.assets(clip.assetId);
  const sourceTime = clip.type === 'video' ? getVideoSourceTime(clip, time, asset) : 0;
  const frame = env.host.getFrame(clip.id, clip.assetId, sourceTime);
  const base = getMediaBaseSize(clip, asset, env.frame);
  applyWipe(ctx, state, base.width, base.height);
  if (frame && frame.width > 0 && frame.height > 0) {
    const sx = frame.width * clip.crop.left;
    const sy = frame.height * clip.crop.top;
    const sw = frame.width * (1 - clip.crop.left - clip.crop.right);
    const sh = frame.height * (1 - clip.crop.top - clip.crop.bottom);
    ctx.drawImage(
      frame.image,
      sx,
      sy,
      sw,
      sh,
      -base.width / 2,
      -base.height / 2,
      base.width,
      base.height,
    );
  }
  if (clip.filters.vignette > 0) {
    ctx.filter = 'none';
    const r = Math.hypot(base.width, base.height) / 2;
    const gradient = ctx.createRadialGradient(0, 0, r * 0.35, 0, 0, r);
    gradient.addColorStop(0, 'rgba(0,0,0,0)');
    gradient.addColorStop(1, `rgba(0,0,0,${clip.filters.vignette})`);
    ctx.fillStyle = gradient;
    ctx.fillRect(-base.width / 2, -base.height / 2, base.width, base.height);
  }
}

function applyWipe(ctx: Ctx2D, state: ClipFrameState, width: number, height: number): void {
  if (state.wipeFrom <= 0 && state.wipeTo >= 1) return;
  const from = -width / 2 + width * state.wipeFrom;
  const visible = Math.max(0, width * (state.wipeTo - state.wipeFrom));
  ctx.beginPath();
  // Generous vertical extent so strokes and shadows are not cut by the wipe.
  ctx.rect(from, -height * 2, visible, height * 4);
  ctx.clip();
}

function drawText(ctx: Ctx2D, clip: TextClip, env: DrawEnv, state: ClipFrameState): void {
  const layout = layoutText(ctx, clip.text, clip.style);
  applyWipe(ctx, state, layout.boxWidth, layout.boxHeight);
  drawTextBlock(ctx, layout, clip.style, {
    reveal: state.textReveal,
    shadowScale: ((env.scaleX + env.scaleY) / 2) * state.scale,
  });
}

function drawShape(ctx: Ctx2D, clip: ShapeClip, state: ClipFrameState): void {
  const { width: w, height: h } = clip;
  applyWipe(ctx, state, w, h);
  ctx.beginPath();
  if (clip.shape === 'ellipse') ctx.ellipse(0, 0, w / 2, h / 2, 0, 0, Math.PI * 2);
  else roundRectPath(ctx, -w / 2, -h / 2, w, h, clip.cornerRadius);
  if (colorAlpha(clip.fill) > 0) {
    ctx.fillStyle = toCssColor(clip.fill);
    ctx.fill();
  }
  if (clip.strokeWidth > 0 && colorAlpha(clip.strokeColor) > 0) {
    ctx.lineWidth = clip.strokeWidth;
    ctx.lineJoin = 'round';
    ctx.strokeStyle = toCssColor(clip.strokeColor);
    ctx.stroke();
  }
}

/**
 * Draws one clip in project space. `ctx` must already be scaled from project to output pixels.
 * `time` is the timeline time (may lie slightly outside the clip during transitions).
 */
function drawClip(
  ctx: Ctx2D,
  clip: VisualClip,
  time: number,
  env: DrawEnv,
  useBlendMode: boolean,
): void {
  const state = evaluateClipState(clip, time - clip.start, env.frame);
  if (state.opacity <= 0.001 || state.scale <= 0.0001) return;
  ctx.save();
  ctx.globalAlpha = ctx.globalAlpha * state.opacity;
  if (useBlendMode) ctx.globalCompositeOperation = compositeOp(clip);
  const filter = buildCssFilter(clip.filters, state.blur, (env.scaleX + env.scaleY) / 2);
  if (filter) ctx.filter = filter;
  ctx.translate(env.frame.width / 2 + state.x, env.frame.height / 2 + state.y);
  if (state.rotation !== 0) ctx.rotate(degToRad(state.rotation));
  const flipH = clip.transform.flipH ? -1 : 1;
  const flipV = clip.transform.flipV ? -1 : 1;
  ctx.scale(state.scale * flipH, state.scale * flipV);
  switch (clip.type) {
    case 'video':
    case 'image':
      drawMedia(ctx, clip, time, env, state);
      break;
    case 'text':
      drawText(ctx, clip, env, state);
      break;
    case 'shape':
      drawShape(ctx, clip, state);
      break;
  }
  ctx.restore();
}

function drawTransition(
  ctx: Ctx2D,
  window: TransitionWindow,
  progress: number,
  time: number,
  env: DrawEnv,
  outW: number,
  outH: number,
): void {
  const layers = getLayers(env.host, outW, outH);
  for (const [layer, clip] of [
    [layers.a, window.outgoing],
    [layers.b, window.incoming],
  ] as const) {
    const lctx = layer.getContext('2d') as Ctx2D;
    lctx.save();
    lctx.setTransform(1, 0, 0, 1, 0, 0);
    lctx.globalAlpha = 1;
    lctx.globalCompositeOperation = 'source-over';
    lctx.clearRect(0, 0, outW, outH);
    lctx.imageSmoothingEnabled = true;
    lctx.imageSmoothingQuality = 'medium';
    lctx.setTransform(env.scaleX, 0, 0, env.scaleY, 0, 0);
    drawClip(lctx, clip, time, env, false);
    lctx.restore();
  }
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  compositeTransition(
    ctx,
    window.transition.type,
    progress,
    layers.a,
    layers.b,
    layers.mix,
    outW,
    outH,
  );
  ctx.restore();
}

/**
 * Renders the composition at `time` into `ctx`, which should be backed by a canvas of
 * `options.width × options.height` pixels. This is the single rendering path used by both the
 * editor preview and exported videos.
 */
export function renderFrame(
  ctx: Ctx2D,
  scene: RenderScene,
  time: number,
  host: RenderHost,
  options: RenderFrameOptions,
): void {
  const { doc } = scene;
  const frame = { width: doc.settings.width, height: doc.settings.height };
  const env: DrawEnv = {
    scene,
    host,
    frame,
    scaleX: options.width / frame.width,
    scaleY: options.height / frame.height,
  };

  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = 'source-over';
  ctx.filter = 'none';
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'medium';
  if (options.transparent) {
    ctx.clearRect(0, 0, options.width, options.height);
  } else {
    ctx.fillStyle = toCssColor(doc.settings.backgroundColor);
    ctx.fillRect(0, 0, options.width, options.height);
  }
  ctx.setTransform(env.scaleX, 0, 0, env.scaleY, 0, 0);

  // Draw bottom-most tracks first so tracks higher in the list end up on top.
  for (let i = doc.tracks.length - 1; i >= 0; i--) {
    const track = doc.tracks[i]!;
    if (track.kind !== 'video' || track.hidden) continue;
    const item = getTrackItemAt(track, time);
    if (!item) continue;
    if (item.kind === 'clip') {
      if (options.hiddenClipIds?.has(item.clip.id)) continue;
      drawClip(ctx, item.clip, time, env, true);
    } else {
      drawTransition(ctx, item.window, item.progress, time, env, options.width, options.height);
    }
  }
  ctx.restore();
}

/** Clips whose media must be available to render `time` (for prefetching and decoding). */
export function getClipsNeededAt(doc: ProjectDoc, time: number): Array<VideoClip | ImageClip> {
  const result: Array<VideoClip | ImageClip> = [];
  for (const track of doc.tracks) {
    if (track.kind !== 'video' || track.hidden) continue;
    const item = getTrackItemAt(track, time);
    if (!item) continue;
    const clips = item.kind === 'clip' ? [item.clip] : [item.window.outgoing, item.window.incoming];
    for (const clip of clips) if (clip.type === 'video' || clip.type === 'image') result.push(clip);
  }
  return result;
}
