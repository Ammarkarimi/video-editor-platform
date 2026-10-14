import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import {
  createAudioClip,
  createImageClip,
  createTextClip,
  createVideoClip,
  insertClip,
  setTransition,
  type ExportSettings,
  type ProjectDoc,
  type RenderJobDTO,
} from '@vep/core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { atempoChain, buildAudioMixArgs } from '../src/render/audio.js';
import {
  createProject,
  createTestServer,
  probe,
  testMedia,
  uploadReady,
  type TestServer,
} from './helpers.js';

let server: TestServer;
let projectId: string;

beforeAll(async () => {
  server = await createTestServer({ renderWorkers: 2 });
  const project = await createProject(server, { width: 640, height: 360, fps: 25 });
  projectId = project.id;
  const media = testMedia();
  const video = await uploadReady(server, projectId, media.video);
  const image = await uploadReady(server, projectId, media.image);
  const audio = await uploadReady(server, projectId, media.audio);

  const doc: ProjectDoc = project.document;
  const videoTrack = doc.tracks[0]!;
  const v = createVideoClip({ assetId: video.id, name: 'video', duration: 2 }, 0);
  v.trimStart = 0.5;
  const img = createImageClip({ assetId: image.id, name: 'image' }, 2, 6);
  videoTrack.clips.push(v, img);
  expect(setTransition(doc, img.id, { type: 'fade', duration: 0.5 })).toBe(true);
  insertClip(doc, createTextClip(0.5, { text: 'Hello export', frame: doc.settings, duration: 3 }));
  const a = createAudioClip({ assetId: audio.id, name: 'tone', duration: 2 }, 1);
  a.fadeIn = 0.5;
  insertClip(doc, a, { trackId: doc.tracks.find((t) => t.kind === 'audio')!.id });

  const res = await server.app.inject({
    method: 'PUT',
    url: `/api/projects/${projectId}/document`,
    payload: { document: doc, baseVersion: null },
  });
  expect(res.statusCode).toBe(200);
});

afterAll(async () => {
  await server.close();
});

async function exportProject(settings: Partial<ExportSettings>): Promise<RenderJobDTO> {
  const res = await server.app.inject({
    method: 'POST',
    url: `/api/projects/${projectId}/renders`,
    payload: {
      settings: {
        format: 'mp4',
        resolution: 240,
        fps: 25,
        quality: 'low',
        range: null,
        ...settings,
      },
    },
  });
  expect(res.statusCode).toBe(202);
  const job = res.json() as RenderJobDTO;
  await server.ctx.rendering.onIdle();
  return (await server.app.inject(`/api/renders/${job.id}`)).json() as RenderJobDTO;
}

function outputFile(job: RenderJobDTO): string {
  return server.ctx.rendering.outputPath(server.ctx.renders.get(job.id)!);
}

/** Average RGB of a small patch of the frame at `time`. */
function samplePixel(file: string, time: number, x: number, y: number): number[] {
  const raw = execFileSync('ffmpeg', [
    '-v',
    'error',
    '-ss',
    String(time),
    '-i',
    file,
    '-frames:v',
    '1',
    '-vf',
    `crop=4:4:${x}:${y},scale=1:1:flags=area,format=rgb24`,
    '-f',
    'rawvideo',
    'pipe:1',
  ]);
  return [...raw.subarray(0, 3)];
}

describe('exports', () => {
  it('renders an MP4 across parallel workers with exact frame count and audio', async () => {
    const job = await exportProject({ format: 'mp4' });
    expect(job.status, job.error ?? '').toBe('completed');
    expect(job.progress).toBe(1);
    expect(job.downloadUrl).toBeTruthy();
    const info = probe(outputFile(job));
    const videoStream = info.streams.find((s) => s.codec_type === 'video')!;
    const audioStream = info.streams.find((s) => s.codec_type === 'audio')!;
    expect(videoStream).toMatchObject({ codec_name: 'h264', width: 426, height: 240 });
    expect(Number(videoStream.nb_read_frames)).toBe(200);
    expect(audioStream.codec_name).toBe('aac');
    expect(Number(info.format.duration)).toBeCloseTo(8, 1);

    // The image clip (solid #3366ff) fills the center from t=2.25s onwards.
    const [r, g, b] = samplePixel(outputFile(job), 5, 211, 118);
    expect(b).toBeGreaterThan(200);
    expect(r).toBeLessThan(90);
    expect(g).toBeGreaterThan(70);
    expect(g).toBeLessThan(140);

    const download = await server.app.inject(job.downloadUrl!);
    expect(download.statusCode).toBe(200);
    expect(download.headers['content-disposition']).toContain('attachment');
  });

  it('exports a sub-range as an animated GIF', async () => {
    const job = await exportProject({ format: 'gif', range: { start: 1, end: 2 }, fps: 10 });
    expect(job.status, job.error ?? '').toBe('completed');
    const info = probe(outputFile(job));
    expect(info.streams[0]).toMatchObject({ codec_name: 'gif' });
    expect(Number(info.streams[0]!.nb_read_frames)).toBe(10);
  });

  it('exports audio only as MP3 and WAV', async () => {
    const mp3 = await exportProject({ format: 'mp3' });
    expect(mp3.status, mp3.error ?? '').toBe('completed');
    expect(probe(outputFile(mp3)).streams[0]!.codec_name).toBe('mp3');
    const wav = await exportProject({ format: 'wav' });
    expect(wav.status, wav.error ?? '').toBe('completed');
    const info = probe(outputFile(wav));
    expect(info.streams[0]!.codec_name).toBe('pcm_s16le');
    expect(Number(info.format.duration)).toBeCloseTo(8, 1);
  });

  it('exports WebM with VP9 and Opus', async () => {
    const job = await exportProject({ format: 'webm', range: { start: 0, end: 1 } });
    expect(job.status, job.error ?? '').toBe('completed');
    const codecs = probe(outputFile(job))
      .streams.map((s) => s.codec_name)
      .sort();
    expect(codecs).toEqual(['opus', 'vp9']);
  });

  it('cancels a running export', async () => {
    const res = await server.app.inject({
      method: 'POST',
      url: `/api/projects/${projectId}/renders`,
      payload: {
        settings: { format: 'mp4', resolution: 360, fps: 25, quality: 'high', range: null },
      },
    });
    const job = res.json() as RenderJobDTO;
    await new Promise((r) => setTimeout(r, 300));
    const cancelled = await server.app.inject({
      method: 'POST',
      url: `/api/renders/${job.id}/cancel`,
    });
    expect(cancelled.statusCode).toBe(200);
    await server.ctx.rendering.onIdle();
    const final = (await server.app.inject(`/api/renders/${job.id}`)).json() as RenderJobDTO;
    expect(final.status).toBe('cancelled');
    expect(final.downloadUrl).toBeNull();
  });

  it('refuses to export an empty timeline', async () => {
    const empty = await createProject(server);
    const res = await server.app.inject({
      method: 'POST',
      url: `/api/projects/${empty.id}/renders`,
      payload: {
        settings: { format: 'mp4', resolution: 240, fps: 25, quality: 'low', range: null },
      },
    });
    expect(res.statusCode).toBe(422);
  });

  it('renders still frames and project thumbnails', async () => {
    const still = await server.app.inject({
      method: 'POST',
      url: `/api/projects/${projectId}/still`,
      payload: { time: 5, resolution: 180, format: 'png' },
    });
    expect(still.statusCode).toBe(200);
    expect(still.headers['content-type']).toBe('image/png');
    const file = path.join(server.dir, 'still.png');
    writeFileSync(file, still.rawPayload);
    const info = probe(file);
    expect(info.streams[0]).toMatchObject({ width: 320, height: 180 });

    const thumb = await server.app.inject(`/api/projects/${projectId}/thumbnail`);
    expect(thumb.statusCode).toBe(200);
    expect(thumb.headers['content-type']).toContain('image/jpeg');
  });
});

describe('audio mix graph', () => {
  it('chains atempo for extreme speeds', () => {
    expect(atempoChain(1)).toEqual([]);
    expect(atempoChain(4)).toEqual(['atempo=2', 'atempo=2']);
    expect(atempoChain(0.25)).toEqual(['atempo=0.5', 'atempo=0.5']);
  });

  it('positions segments relative to the export range', () => {
    const args = buildAudioMixArgs(
      [
        {
          file: 'a.wav',
          segment: {
            clipId: 'c',
            assetId: 'a',
            start: 2,
            end: 6,
            sourceStart: 1,
            speed: 1,
            volume: 0.5,
            fadeIn: 1,
            fadeOut: 0,
          },
        },
      ],
      3,
      10,
      'out.wav',
    );
    // Visible part starts 1s into the clip: source offset 2s, placed at t=0 of the export.
    expect(args).toContain('-ss');
    expect(args[args.indexOf('-ss') + 1]).toBe('2');
    const graph = args[args.indexOf('-filter_complex') + 1]!;
    expect(graph).toContain('adelay=0:all=1');
    expect(graph).toContain('(t+1)/1');
    expect(graph).toContain('apad=whole_dur=7');
  });

  it('produces silence when nothing is audible', () => {
    const args = buildAudioMixArgs([], 0, 5, 'out.wav');
    expect(args.join(' ')).toContain('anullsrc');
  });
});
