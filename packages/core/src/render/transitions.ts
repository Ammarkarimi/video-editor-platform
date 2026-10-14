import type { TransitionType } from '../model/schema.js';
import type { CanvasLike, Ctx2D } from './types.js';

export interface TransitionInfo {
  type: TransitionType;
  label: string;
  category: 'Dissolve' | 'Wipe' | 'Slide' | 'Shape' | 'Effect';
}

export const TRANSITION_INFO: TransitionInfo[] = [
  { type: 'fade', label: 'Cross dissolve', category: 'Dissolve' },
  { type: 'fadeblack', label: 'Dip to black', category: 'Dissolve' },
  { type: 'fadewhite', label: 'Dip to white', category: 'Dissolve' },
  { type: 'wipeleft', label: 'Wipe left', category: 'Wipe' },
  { type: 'wiperight', label: 'Wipe right', category: 'Wipe' },
  { type: 'wipeup', label: 'Wipe up', category: 'Wipe' },
  { type: 'wipedown', label: 'Wipe down', category: 'Wipe' },
  { type: 'slideleft', label: 'Push left', category: 'Slide' },
  { type: 'slideright', label: 'Push right', category: 'Slide' },
  { type: 'slideup', label: 'Push up', category: 'Slide' },
  { type: 'slidedown', label: 'Push down', category: 'Slide' },
  { type: 'circleopen', label: 'Circle open', category: 'Shape' },
  { type: 'circleclose', label: 'Circle close', category: 'Shape' },
  { type: 'radial', label: 'Clock wipe', category: 'Shape' },
  { type: 'zoomin', label: 'Zoom', category: 'Effect' },
  { type: 'blur', label: 'Blur dissolve', category: 'Effect' },
];

export function transitionLabel(type: TransitionType): string {
  return TRANSITION_INFO.find((t) => t.type === type)?.label ?? type;
}

function drawLayer(ctx: Ctx2D, layer: CanvasLike, dx = 0, dy = 0): void {
  ctx.drawImage(layer, dx, dy);
}

function clipRect(ctx: Ctx2D, x: number, y: number, w: number, h: number): void {
  ctx.beginPath();
  ctx.rect(x, y, w, h);
  ctx.clip();
}

function drawScaled(
  ctx: Ctx2D,
  layer: CanvasLike,
  scale: number,
  width: number,
  height: number,
): void {
  const w = width * scale;
  const h = height * scale;
  ctx.drawImage(layer, (width - w) / 2, (height - h) / 2, w, h);
}

/** Overwrites `layer` pixels with `color` wherever the layer has content (keeps its alpha). */
function tintLayer(
  layer: CanvasLike,
  color: string,
  amount: number,
  width: number,
  height: number,
): void {
  if (amount <= 0) return;
  const ctx = layer.getContext('2d') as Ctx2D;
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalCompositeOperation = 'source-atop';
  ctx.globalAlpha = Math.min(1, amount);
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, width, height);
  ctx.restore();
}

/**
 * Composites two full-frame layers (outgoing `a`, incoming `b`) onto `ctx` for a transition at
 * `progress` (0 = only A, 1 = only B). All coordinates are output pixels; `ctx` must have an
 * identity transform. `mix` is a scratch layer of the same size.
 */
export function compositeTransition(
  ctx: Ctx2D,
  type: TransitionType,
  progress: number,
  a: CanvasLike,
  b: CanvasLike,
  mix: CanvasLike,
  width: number,
  height: number,
): void {
  const p = Math.min(1, Math.max(0, progress));
  const mixCtx = mix.getContext('2d') as Ctx2D;
  const crossfade = (drawA: () => void, drawB: () => void) => {
    // mix = A·(1-p) + B·p with additive compositing: a true per-pixel dissolve that never dips
    // through the background, even for semi-transparent clips.
    mixCtx.save();
    mixCtx.setTransform(1, 0, 0, 1, 0, 0);
    mixCtx.clearRect(0, 0, width, height);
    mixCtx.globalAlpha = 1 - p;
    drawA();
    mixCtx.globalCompositeOperation = 'lighter';
    mixCtx.globalAlpha = p;
    drawB();
    mixCtx.restore();
    drawLayer(ctx, mix);
  };

  ctx.save();
  switch (type) {
    case 'fade':
      crossfade(
        () => drawLayer(mixCtx, a),
        () => drawLayer(mixCtx, b),
      );
      break;
    case 'fadeblack':
    case 'fadewhite': {
      const color = type === 'fadeblack' ? '#000000' : '#ffffff';
      if (p < 0.5) {
        tintLayer(a, color, p * 2, width, height);
        drawLayer(ctx, a);
      } else {
        tintLayer(b, color, (1 - p) * 2, width, height);
        drawLayer(ctx, b);
      }
      break;
    }
    case 'wipeleft': {
      const edge = width * (1 - p);
      ctx.save();
      clipRect(ctx, 0, 0, edge, height);
      drawLayer(ctx, a);
      ctx.restore();
      clipRect(ctx, edge, 0, width - edge, height);
      drawLayer(ctx, b);
      break;
    }
    case 'wiperight': {
      const edge = width * p;
      ctx.save();
      clipRect(ctx, edge, 0, width - edge, height);
      drawLayer(ctx, a);
      ctx.restore();
      clipRect(ctx, 0, 0, edge, height);
      drawLayer(ctx, b);
      break;
    }
    case 'wipeup': {
      const edge = height * (1 - p);
      ctx.save();
      clipRect(ctx, 0, 0, width, edge);
      drawLayer(ctx, a);
      ctx.restore();
      clipRect(ctx, 0, edge, width, height - edge);
      drawLayer(ctx, b);
      break;
    }
    case 'wipedown': {
      const edge = height * p;
      ctx.save();
      clipRect(ctx, 0, edge, width, height - edge);
      drawLayer(ctx, a);
      ctx.restore();
      clipRect(ctx, 0, 0, width, edge);
      drawLayer(ctx, b);
      break;
    }
    case 'slideleft':
      drawLayer(ctx, a, -width * p, 0);
      drawLayer(ctx, b, width * (1 - p), 0);
      break;
    case 'slideright':
      drawLayer(ctx, a, width * p, 0);
      drawLayer(ctx, b, -width * (1 - p), 0);
      break;
    case 'slideup':
      drawLayer(ctx, a, 0, -height * p);
      drawLayer(ctx, b, 0, height * (1 - p));
      break;
    case 'slidedown':
      drawLayer(ctx, a, 0, height * p);
      drawLayer(ctx, b, 0, -height * (1 - p));
      break;
    case 'circleopen':
    case 'circleclose': {
      const maxRadius = Math.hypot(width, height) / 2;
      const opening = type === 'circleopen';
      const r = maxRadius * (opening ? p : 1 - p);
      const inner = opening ? b : a;
      const outer = opening ? a : b;
      ctx.save();
      ctx.beginPath();
      ctx.rect(0, 0, width, height);
      ctx.moveTo(width / 2 + r, height / 2);
      ctx.arc(width / 2, height / 2, r, 0, Math.PI * 2);
      ctx.clip('evenodd');
      drawLayer(ctx, outer);
      ctx.restore();
      if (r > 0) {
        ctx.beginPath();
        ctx.arc(width / 2, height / 2, r, 0, Math.PI * 2);
        ctx.clip();
        drawLayer(ctx, inner);
      }
      break;
    }
    case 'radial': {
      const radius = Math.hypot(width, height);
      const start = -Math.PI / 2;
      const sweep = Math.PI * 2 * p;
      const cx = width / 2;
      const cy = height / 2;
      if (p < 1) {
        ctx.save();
        ctx.beginPath();
        ctx.moveTo(cx, cy);
        ctx.arc(cx, cy, radius, start + sweep, start + Math.PI * 2);
        ctx.closePath();
        ctx.clip();
        drawLayer(ctx, a);
        ctx.restore();
      }
      if (p > 0) {
        ctx.beginPath();
        ctx.moveTo(cx, cy);
        ctx.arc(cx, cy, radius, start, start + sweep);
        ctx.closePath();
        ctx.clip();
        drawLayer(ctx, b);
      }
      break;
    }
    case 'zoomin':
      crossfade(
        () => drawScaled(mixCtx, a, 1 + 0.5 * p, width, height),
        () => drawScaled(mixCtx, b, 0.8 + 0.2 * p, width, height),
      );
      break;
    case 'blur': {
      const amount = Math.sin(Math.PI * p) * Math.max(width, height) * 0.015;
      const filter = amount > 0.05 ? `blur(${amount.toFixed(2)}px)` : 'none';
      crossfade(
        () => {
          mixCtx.filter = filter;
          drawLayer(mixCtx, a);
        },
        () => {
          mixCtx.filter = filter;
          drawLayer(mixCtx, b);
          mixCtx.filter = 'none';
        },
      );
      break;
    }
  }
  ctx.restore();
}
