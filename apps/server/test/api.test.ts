import { writeFileSync } from 'node:fs';
import path from 'node:path';
import {
  createVideoClip,
  type AssetDTO,
  type ProjectDTO,
  type ProjectSummaryDTO,
  type WaveformData,
} from '@vep/core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  createProject,
  createTestServer,
  multipart,
  testMedia,
  uploadReady,
  type TestServer,
} from './helpers.js';

let server: TestServer;

beforeAll(async () => {
  server = await createTestServer();
});

afterAll(async () => {
  await server.close();
});

describe('system', () => {
  it('reports health, info and fonts', async () => {
    expect((await server.app.inject('/api/health')).json()).toEqual({ ok: true });
    const info = (await server.app.inject('/api/info')).json();
    expect(info.ffmpeg).toBeTruthy();
    const fonts = (await server.app.inject('/api/fonts')).json();
    expect(fonts.families.length).toBeGreaterThan(10);
    const font = await server.app.inject('/fonts/Inter-400.ttf');
    expect(font.statusCode).toBe(200);
    expect(font.rawPayload.length).toBeGreaterThan(10_000);
    expect((await server.app.inject('/fonts/..%2Fsecret.ttf')).statusCode).toBe(404);
  });

  it('returns JSON 404s for unknown API routes', async () => {
    const res = await server.app.inject('/api/nope');
    expect(res.statusCode).toBe(404);
    expect(res.json().error).toBe('not_found');
  });
});

describe('projects', () => {
  it('creates, lists, renames and deletes projects', async () => {
    const project = await createProject(server, { name: 'Holiday' });
    expect(project.document.settings).toMatchObject({ width: 640, height: 360, fps: 25 });
    const list = (await server.app.inject('/api/projects')).json() as ProjectSummaryDTO[];
    expect(list.some((p) => p.id === project.id)).toBe(true);

    const renamed = await server.app.inject({
      method: 'PATCH',
      url: `/api/projects/${project.id}`,
      payload: { name: 'Summer holiday' },
    });
    expect(renamed.json().name).toBe('Summer holiday');

    expect(
      (await server.app.inject({ method: 'DELETE', url: `/api/projects/${project.id}` }))
        .statusCode,
    ).toBe(204);
    expect((await server.app.inject(`/api/projects/${project.id}`)).statusCode).toBe(404);
  });

  it('validates input', async () => {
    const res = await server.app.inject({
      method: 'POST',
      url: '/api/projects',
      payload: { name: '' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().details.length).toBeGreaterThan(0);
    expect((await server.app.inject('/api/projects/..%2F..%2Fetc')).statusCode).toBe(404);
  });

  it('saves documents with optimistic concurrency', async () => {
    const project = await createProject(server);
    const doc = project.document;
    doc.markers.push({ id: 'mrk_a', time: 1, label: 'Intro', color: '#ff0000' });
    const ok = await server.app.inject({
      method: 'PUT',
      url: `/api/projects/${project.id}/document`,
      payload: { document: doc, baseVersion: project.version },
    });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().version).toBe(project.version + 1);

    const stale = await server.app.inject({
      method: 'PUT',
      url: `/api/projects/${project.id}/document`,
      payload: { document: doc, baseVersion: project.version },
    });
    expect(stale.statusCode).toBe(409);

    const invalid = await server.app.inject({
      method: 'PUT',
      url: `/api/projects/${project.id}/document`,
      payload: { document: { ...doc, settings: { ...doc.settings, fps: 0 } }, baseVersion: null },
    });
    expect(invalid.statusCode).toBe(400);

    const reloaded = (await server.app.inject(`/api/projects/${project.id}`)).json() as ProjectDTO;
    expect(reloaded.document.markers).toHaveLength(1);
  });
});

describe('assets', () => {
  let project: ProjectDTO;
  let video: AssetDTO;

  beforeAll(async () => {
    project = await createProject(server);
    video = await uploadReady(server, project.id, testMedia().video);
  });

  it('probes uploaded video', () => {
    expect(video.status).toBe('ready');
    expect(video.kind).toBe('video');
    expect(video.metadata).toMatchObject({
      width: 320,
      height: 240,
      hasAudio: true,
      hasVideo: true,
    });
    expect(video.metadata!.duration).toBeCloseTo(3, 0);
    expect(video.urls.preview).toBeTruthy();
    expect(video.hasProxy).toBe(false); // H.264/AAC MP4 plays natively
  });

  it('generates thumbnail, filmstrip and waveform', async () => {
    const thumb = await server.app.inject(video.urls.thumbnail!);
    expect(thumb.statusCode).toBe(200);
    expect(thumb.headers['content-type']).toContain('image/jpeg');
    expect(video.filmstrip).toMatchObject({ frameHeight: 90, frames: 3 });
    expect((await server.app.inject(video.urls.filmstrip!)).statusCode).toBe(200);
    const waveform = (await server.app.inject(video.urls.waveform!)).json() as WaveformData;
    expect(waveform.rate).toBeCloseTo(100);
    expect(waveform.peaks.length).toBeGreaterThan(250);
    // FFmpeg's sine source has an amplitude of 1/8 (≈32/255).
    expect(Math.max(...waveform.peaks)).toBeGreaterThan(25);
  });

  it('serves media with range requests', async () => {
    const res = await server.app.inject({
      method: 'GET',
      url: video.urls.preview!,
      headers: { range: 'bytes=0-99' },
    });
    expect(res.statusCode).toBe(206);
    expect(res.rawPayload.length).toBe(100);
  });

  it('classifies images and audio', async () => {
    const image = await uploadReady(server, project.id, testMedia().image);
    expect(image).toMatchObject({ kind: 'image', status: 'ready' });
    expect(image.metadata).toMatchObject({ width: 200, height: 100, duration: 0, hasAudio: false });
    const audio = await uploadReady(server, project.id, testMedia().audio);
    expect(audio).toMatchObject({ kind: 'audio', status: 'ready', hasWaveform: true });
    expect(audio.urls.thumbnail).toBeNull();
  });

  it('creates a proxy for media browsers cannot play', async () => {
    const file = path.join(server.dir, 'clip.mkv');
    const { execFileSync } = await import('node:child_process');
    execFileSync('ffmpeg', [
      '-v',
      'error',
      '-y',
      '-f',
      'lavfi',
      '-i',
      'testsrc=size=160x120:rate=25:duration=1',
      '-c:v',
      'mpeg4',
      file,
    ]);
    const asset = await uploadReady(server, project.id, file);
    expect(asset.hasProxy).toBe(true);
    const preview = await server.app.inject(asset.urls.preview!);
    expect(preview.headers['content-type']).toContain('video/mp4');
  });

  it('rejects unsupported and corrupt files', async () => {
    const txt = path.join(server.dir, 'notes.txt');
    writeFileSync(txt, 'hello');
    const res = await server.app.inject({
      method: 'POST',
      url: `/api/projects/${project.id}/assets`,
      ...multipart(txt),
    });
    expect(res.statusCode).toBe(415);

    const fake = path.join(server.dir, 'fake.mp4');
    writeFileSync(fake, 'definitely not a video');
    const asset = await uploadReady(server, project.id, fake);
    expect(asset.status).toBe('error');
    expect(asset.error).toBeTruthy();
  });

  it('protects media used in the timeline from deletion', async () => {
    const doc = project.document;
    doc.tracks[0]!.clips.push(createVideoClip({ assetId: video.id, name: 'v', duration: 3 }, 0));
    const saved = await server.app.inject({
      method: 'PUT',
      url: `/api/projects/${project.id}/document`,
      payload: { document: doc, baseVersion: null },
    });
    expect(saved.statusCode).toBe(200);
    const blocked = await server.app.inject({ method: 'DELETE', url: `/api/assets/${video.id}` });
    expect(blocked.statusCode).toBe(409);
    const forced = await server.app.inject({
      method: 'DELETE',
      url: `/api/assets/${video.id}?force=1`,
    });
    expect(forced.statusCode).toBe(204);
  });

  it('duplicates a project together with its media', async () => {
    const source = await createProject(server);
    const asset = await uploadReady(server, source.id, testMedia().image);
    const doc = source.document;
    doc.tracks[0]!.clips.push({
      ...createVideoClip({ assetId: asset.id, name: 'img', duration: 2 }, 0),
      type: 'video',
    });
    await server.app.inject({
      method: 'PUT',
      url: `/api/projects/${source.id}/document`,
      payload: { document: doc, baseVersion: null },
    });
    const res = await server.app.inject({
      method: 'POST',
      url: `/api/projects/${source.id}/duplicate`,
    });
    expect(res.statusCode).toBe(201);
    const copy = res.json() as ProjectDTO;
    const copyAssets = (
      await server.app.inject(`/api/projects/${copy.id}/assets`)
    ).json() as AssetDTO[];
    expect(copyAssets).toHaveLength(1);
    expect(copyAssets[0]!.id).not.toBe(asset.id);
    const clip = copy.document.tracks[0]!.clips[0] as { assetId: string };
    expect(clip.assetId).toBe(copyAssets[0]!.id);
  });
});
