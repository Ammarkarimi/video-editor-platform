import {
  createAssetLookup,
  createImageClip,
  createProjectDoc,
  createVideoClip,
  type AssetInfo,
  type ProjectDoc,
  type VideoClip,
} from '../src/index.js';

export const VIDEO_ASSET: AssetInfo = {
  id: 'ast_video',
  kind: 'video',
  name: 'clip.mp4',
  duration: 20,
  width: 1920,
  height: 1080,
  hasAudio: true,
  hasVideo: true,
};

export const SILENT_VIDEO_ASSET: AssetInfo = {
  ...VIDEO_ASSET,
  id: 'ast_silent',
  name: 'silent.mp4',
  hasAudio: false,
};

export const IMAGE_ASSET: AssetInfo = {
  id: 'ast_image',
  kind: 'image',
  name: 'photo.png',
  duration: 0,
  width: 1000,
  height: 1000,
  hasAudio: false,
  hasVideo: true,
};

export const assets = createAssetLookup([VIDEO_ASSET, SILENT_VIDEO_ASSET, IMAGE_ASSET]);

export function videoClip(
  start: number,
  duration: number,
  overrides: Partial<VideoClip> = {},
): VideoClip {
  return {
    ...createVideoClip({ assetId: VIDEO_ASSET.id, name: 'clip', duration }, start),
    ...overrides,
  };
}

/** A project with one video track holding clips at the given [start, duration] spans. */
export function projectWithClips(spans: Array<[number, number]>): ProjectDoc {
  const doc = createProjectDoc();
  doc.tracks[0]!.clips = spans.map(([start, duration]) => videoClip(start, duration));
  return doc;
}

export function imageClip(start: number, duration: number) {
  return createImageClip({ assetId: IMAGE_ASSET.id, name: 'photo' }, start, duration);
}
