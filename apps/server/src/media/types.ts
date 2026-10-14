import path from 'node:path';
import type { AssetKind } from '@vep/core';

const VIDEO_EXTENSIONS = [
  'mp4',
  'm4v',
  'mov',
  'webm',
  'mkv',
  'avi',
  'mpg',
  'mpeg',
  'ogv',
  '3gp',
  'flv',
  'wmv',
  'ts',
  'mts',
  'm2ts',
];
const AUDIO_EXTENSIONS = [
  'mp3',
  'wav',
  'm4a',
  'aac',
  'ogg',
  'oga',
  'opus',
  'flac',
  'aif',
  'aiff',
  'wma',
  'weba',
];
const IMAGE_EXTENSIONS = ['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp', 'tif', 'tiff', 'avif'];

const MIME_BY_EXTENSION: Record<string, string> = {
  mp4: 'video/mp4',
  m4v: 'video/mp4',
  mov: 'video/quicktime',
  webm: 'video/webm',
  mkv: 'video/x-matroska',
  avi: 'video/x-msvideo',
  mpg: 'video/mpeg',
  mpeg: 'video/mpeg',
  ogv: 'video/ogg',
  '3gp': 'video/3gpp',
  flv: 'video/x-flv',
  wmv: 'video/x-ms-wmv',
  ts: 'video/mp2t',
  mts: 'video/mp2t',
  m2ts: 'video/mp2t',
  mp3: 'audio/mpeg',
  wav: 'audio/wav',
  m4a: 'audio/mp4',
  aac: 'audio/aac',
  ogg: 'audio/ogg',
  oga: 'audio/ogg',
  opus: 'audio/ogg',
  flac: 'audio/flac',
  aif: 'audio/aiff',
  aiff: 'audio/aiff',
  wma: 'audio/x-ms-wma',
  weba: 'audio/webm',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  gif: 'image/gif',
  bmp: 'image/bmp',
  tif: 'image/tiff',
  tiff: 'image/tiff',
  avif: 'image/avif',
};

export const ACCEPTED_EXTENSIONS = [...VIDEO_EXTENSIONS, ...AUDIO_EXTENSIONS, ...IMAGE_EXTENSIONS];

export function extensionOf(fileName: string): string {
  return path.extname(fileName).slice(1).toLowerCase();
}

export function guessKind(extension: string): AssetKind | null {
  if (VIDEO_EXTENSIONS.includes(extension)) return 'video';
  if (AUDIO_EXTENSIONS.includes(extension)) return 'audio';
  if (IMAGE_EXTENSIONS.includes(extension)) return 'image';
  return null;
}

export function mimeTypeFor(extension: string): string {
  return MIME_BY_EXTENSION[extension] ?? 'application/octet-stream';
}

/** Strips path components and control characters from a user-supplied file name. */
export function sanitizeDisplayName(name: string): string {
  const base = path.basename(name.replace(/\\/g, '/'));
  // eslint-disable-next-line no-control-regex
  const cleaned = base.replace(/[\u0000-\u001f\u007f]/g, '').trim();
  return (cleaned || 'Untitled').slice(0, 200);
}
