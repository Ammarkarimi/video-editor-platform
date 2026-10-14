import { stat, writeFile } from 'node:fs/promises';
import { createCanvas } from '@napi-rs/canvas';
import {
  createAudioClip,
  createId,
  createImageClip,
  createMarker,
  createProjectDoc,
  createShapeClip,
  createTextClip,
  createVideoClip,
  insertClip,
  setTransition,
  TEXT_PRESETS,
  type ProjectDoc,
} from '@vep/core';
import type { AppContext } from './context.js';
import type { ProjectRecord } from './db/repositories.js';
import { runProcess } from './ffmpeg/run.js';

const W = 1280;
const H = 720;
const FPS = 30;
const CLIP = 6;

interface DemoMedia {
  name: string;
  extension: string;
  kind: 'video' | 'audio' | 'image';
  mimeType: string;
  create: (file: string) => Promise<void>;
}

/** A gentle four-chord pad (C – Am – F – G), generated so the demo needs no licensed music. */
function musicExpression(): string {
  const chord = (a: number, b: number, c: number, d: number) =>
    `if(eq(mod(floor(t/3),4),0),${a},if(eq(mod(floor(t/3),4),1),${b},if(eq(mod(floor(t/3),4),2),${c},${d})))`;
  const f1 = chord(261.63, 220.0, 174.61, 196.0);
  const f2 = chord(329.63, 261.63, 220.0, 246.94);
  const f3 = chord(392.0, 329.63, 261.63, 293.66);
  const env = '(1-exp(-6*mod(t,3)))*exp(-0.25*mod(t,3))';
  return `0.09*${env}*(sin(2*PI*${f1}*t)+sin(2*PI*${f2}*t)+0.8*sin(2*PI*${f3}*t)+0.6*sin(PI*${f1}*t))`;
}

function demoMedia(ffmpeg: string): DemoMedia[] {
  const run = (args: string[]) =>
    runProcess(ffmpeg, ['-v', 'error', '-y', ...args]).then(() => undefined);
  const video = (source: string) => (file: string) =>
    run([
      '-f',
      'lavfi',
      '-i',
      source,
      '-t',
      String(CLIP),
      '-c:v',
      'libx264',
      '-preset',
      'veryfast',
      '-crf',
      '22',
      '-pix_fmt',
      'yuv420p',
      '-g',
      '30',
      '-movflags',
      '+faststart',
      file,
    ]);
  return [
    {
      name: 'Gradient flow.mp4',
      extension: 'mp4',
      kind: 'video',
      mimeType: 'video/mp4',
      create: video(
        `gradients=s=${W}x${H}:c0=0x7c3aed:c1=0xdb2777:c2=0x0ea5e9:c3=0x10b981:n=4:speed=0.012:rate=${FPS}`,
      ),
    },
    {
      name: 'Fractal zoom.mp4',
      extension: 'mp4',
      kind: 'video',
      mimeType: 'video/mp4',
      create: video(
        `mandelbrot=s=${W}x${H}:rate=${FPS}:start_scale=2.5:end_scale=0.05:end_pts=${CLIP * FPS}`,
      ),
    },
    {
      name: 'Game of life.mp4',
      extension: 'mp4',
      kind: 'video',
      mimeType: 'video/mp4',
      create: video(
        `life=s=320x180:mold=10:r=${FPS}:ratio=0.12:death_color=#4c1d95:life_color=#22d3ee,scale=${W}:${H}:flags=neighbor`,
      ),
    },
    {
      name: 'Ambient pad.m4a',
      extension: 'm4a',
      kind: 'audio',
      mimeType: 'audio/mp4',
      create: (file) =>
        run([
          '-f',
          'lavfi',
          '-i',
          `aevalsrc=exprs='${musicExpression()}':s=48000:d=${CLIP * 3}`,
          '-af',
          'aecho=0.8:0.7:120:0.25,pan=stereo|c0=c0|c1=c0',
          '-c:a',
          'aac',
          '-b:a',
          '160k',
          file,
        ]),
    },
    {
      name: 'Badge.png',
      extension: 'png',
      kind: 'image',
      mimeType: 'image/png',
      create: async (file) => {
        const size = 512;
        const canvas = createCanvas(size, size);
        const ctx = canvas.getContext('2d');
        const gradient = ctx.createLinearGradient(0, 0, size, size);
        gradient.addColorStop(0, '#8b5cf6');
        gradient.addColorStop(1, '#ec4899');
        ctx.fillStyle = gradient;
        ctx.beginPath();
        ctx.roundRect(16, 16, size - 32, size - 32, 96);
        ctx.fill();
        ctx.fillStyle = '#ffffff';
        ctx.beginPath();
        ctx.moveTo(196, 150);
        ctx.lineTo(196, 362);
        ctx.lineTo(372, 256);
        ctx.closePath();
        ctx.fill();
        await writeFile(file, await canvas.encode('png'));
      },
    },
  ];
}

/** Builds a sample project showcasing tracks, text styles, transitions, keyframes and audio. */
export async function createDemoProject(ctx: AppContext): Promise<ProjectRecord> {
  const projectId = createId('prj');
  const doc: ProjectDoc = createProjectDoc({
    width: W,
    height: H,
    fps: FPS,
    backgroundColor: '#0b0d12',
  });
  const project = ctx.projects.create(projectId, 'Demo project', doc);

  const assetIds: string[] = [];
  for (const media of demoMedia(ctx.config.ffmpegPath)) {
    const id = createId('ast');
    const fileName = `original.${media.extension}`;
    await ctx.storage.ensureAssetDir(id);
    const target = ctx.storage.assetPath(id, fileName);
    await media.create(target);
    const { size } = await stat(target);
    ctx.assets.create({
      id,
      projectId,
      name: media.name,
      kind: media.kind,
      mimeType: media.mimeType,
      size,
      fileName,
    });
    ctx.media.enqueue(id);
    assetIds.push(id);
  }
  await ctx.media.onIdle();

  const [gradientId, fractalId, lifeId, musicId, badgeId] = assetIds as [
    string,
    string,
    string,
    string,
    string,
  ];
  const main = doc.tracks[0]!;
  const intro = createVideoClip({ assetId: gradientId, name: 'Gradient flow', duration: CLIP }, 0);
  intro.loop = { type: 'kenBurnsIn', intensity: 1 };
  const fractal = createVideoClip(
    { assetId: fractalId, name: 'Fractal zoom', duration: CLIP },
    CLIP,
  );
  const life = createVideoClip({ assetId: lifeId, name: 'Game of life', duration: CLIP }, CLIP * 2);
  life.filters.saturation = 1.3;
  life.filters.vignette = 0.45;
  main.clips.push(intro, fractal, life);
  setTransition(doc, fractal.id, { type: 'circleopen', duration: 1 });
  setTransition(doc, life.id, { type: 'fade', duration: 1 });

  const preset = (id: string) => TEXT_PRESETS.find((p) => p.id === id);
  const frame = { width: W, height: H };
  const title = createTextClip(0.4, {
    preset: preset('title'),
    text: 'Welcome to Cutroom',
    frame,
    duration: 4.8,
  });
  const subtitle = createTextClip(1, {
    preset: preset('subtitle'),
    text: 'Edit video right in your browser',
    frame,
    duration: 4.2,
  });
  const lower = createTextClip(CLIP + 0.6, {
    preset: preset('lower-third'),
    text: 'Multi-track timeline\nTransitions · Keyframes · Text',
    frame,
    duration: 4.6,
  });
  const caption = createTextClip(CLIP * 2 + 0.6, {
    preset: preset('caption'),
    text: 'Export to MP4, WebM, GIF or audio',
    frame,
    duration: 4.8,
  });
  for (const clip of [title, subtitle, lower, caption]) insertClip(doc, clip);

  // A badge that travels across the frame with keyframes.
  const badge = createImageClip({ assetId: badgeId, name: 'Badge' }, 0.8, 4.4);
  badge.transform = { ...badge.transform, scale: 0.16, x: -520, y: -250 };
  badge.keyframes.rotation = [
    { time: 0, value: -20, easing: 'easeInOut' },
    { time: 4.4, value: 20, easing: 'easeInOut' },
  ];
  badge.animationIn = { type: 'pop', duration: 0.5 };
  insertClip(doc, badge);

  const bar = createShapeClip(CLIP * 2 + 0.4, frame, {
    shape: 'rectangle',
    width: W,
    height: 8,
    fill: '#8b5cf6',
    duration: 5.2,
    name: 'Accent bar',
  });
  bar.transform.y = H / 2 - 4;
  bar.animationIn = { type: 'wipe', duration: 1 };
  insertClip(doc, bar);

  const music = createAudioClip({ assetId: musicId, name: 'Ambient pad', duration: CLIP * 3 }, 0);
  music.fadeIn = 1;
  music.fadeOut = 2;
  music.volume = 0.8;
  insertClip(doc, music, { trackId: doc.tracks.find((t) => t.kind === 'audio')!.id });

  doc.markers.push(
    createMarker(0, 'Intro'),
    createMarker(CLIP, 'Fractal', '#3b82f6'),
    createMarker(CLIP * 2, 'Life', '#22c55e'),
  );

  return ctx.projects.saveDocument(projectId, doc, project.version)!;
}
