import type { AssetDTO, AudioClip, ImageClip, VideoClip } from '@vep/core';
import { useEffect, useRef } from 'react';
import { useSprite, useWaveform } from './mediaCache';

/** Pixel window of a clip (relative to its left edge) that needs to be drawn. */
export interface ClipWindow {
  from: number;
  to: number;
}

function setupCanvas(
  canvas: HTMLCanvasElement,
  width: number,
  height: number,
): CanvasRenderingContext2D | null {
  const dpr = window.devicePixelRatio || 1;
  canvas.width = Math.max(1, Math.round(width * dpr));
  canvas.height = Math.max(1, Math.round(height * dpr));
  canvas.style.width = `${width}px`;
  canvas.style.height = `${height}px`;
  const ctx = canvas.getContext('2d');
  ctx?.setTransform(dpr, 0, 0, dpr, 0, 0);
  return ctx;
}

export function FilmstripCanvas({
  clip,
  asset,
  zoom,
  height,
  window,
}: {
  clip: VideoClip;
  asset: AssetDTO;
  zoom: number;
  height: number;
  window: ClipWindow;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  const sprite = useSprite(asset.urls.filmstrip);
  const info = asset.filmstrip;

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas || !sprite || !info) return;
    const width = window.to - window.from;
    const ctx = setupCanvas(canvas, width, height);
    if (!ctx) return;
    ctx.clearRect(0, 0, width, height);
    const tileW = Math.max(8, (height * info.frameWidth) / info.frameHeight);
    const first = Math.floor(window.from / tileW);
    const last = Math.ceil(window.to / tileW);
    for (let k = first; k < last; k++) {
      const centerLocal = (k * tileW + tileW / 2) / zoom;
      const sourceTime = clip.trimStart + centerLocal * clip.speed;
      const index = Math.min(info.frames - 1, Math.max(0, Math.round(sourceTime / info.interval)));
      const sx = (index % info.columns) * info.frameWidth;
      const sy = Math.floor(index / info.columns) * info.frameHeight;
      ctx.drawImage(
        sprite,
        sx,
        sy,
        info.frameWidth,
        info.frameHeight,
        k * tileW - window.from,
        0,
        tileW,
        height,
      );
    }
  }, [sprite, info, clip.trimStart, clip.speed, zoom, height, window.from, window.to]);

  return (
    <canvas
      ref={ref}
      className="pointer-events-none absolute top-0 opacity-90"
      style={{ left: window.from }}
    />
  );
}

export function ImageStrip({
  asset,
  height,
  width,
}: {
  asset: AssetDTO;
  height: number;
  width: number;
}) {
  if (!asset.urls.thumbnail) return null;
  return (
    <div
      className="pointer-events-none absolute top-0 left-0 opacity-90"
      style={{
        width,
        height,
        backgroundImage: `url(${asset.urls.thumbnail})`,
        backgroundSize: `auto ${height}px`,
        backgroundRepeat: 'repeat-x',
      }}
    />
  );
}

export function WaveformCanvas({
  clip,
  asset,
  zoom,
  height,
  top,
  window,
  color = 'rgba(255,255,255,0.75)',
}: {
  clip: VideoClip | AudioClip | ImageClip;
  asset: AssetDTO;
  zoom: number;
  height: number;
  top: number;
  window: ClipWindow;
  color?: string;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  const data = useWaveform(asset.hasWaveform ? asset.urls.waveform : null);
  const timed = clip.type === 'image' ? null : clip;

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas || !data || !timed) return;
    const width = window.to - window.from;
    const ctx = setupCanvas(canvas, width, height);
    if (!ctx) return;
    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = color;
    const gain = Math.min(1.6, Math.max(0.15, timed.volume));
    const mid = height / 2;
    for (let x = 0; x < width; x++) {
      const t0 = (window.from + x) / zoom;
      const s0 = (timed.trimStart + t0 * timed.speed) * data.rate;
      const s1 = (timed.trimStart + (t0 + 1 / zoom) * timed.speed) * data.rate;
      let peak = 0;
      for (let i = Math.floor(s0); i <= Math.min(data.peaks.length - 1, Math.ceil(s1)); i++) {
        if (i >= 0) peak = Math.max(peak, data.peaks[i]!);
      }
      const amplitude = Math.min(1, Math.sqrt(peak / 255) * gain);
      const h = Math.max(0.5, amplitude * (height - 2));
      ctx.fillRect(x, mid - h / 2, 1, h);
    }
  }, [data, timed, zoom, height, window.from, window.to, color]);

  if (!timed) return null;
  return (
    <canvas ref={ref} className="pointer-events-none absolute" style={{ left: window.from, top }} />
  );
}
