import type { ExportFormat, ExportQuality } from '@vep/core';

/** Video segment container per export format (segments are concatenated without re-encoding). */
export function segmentExtension(format: ExportFormat): string {
  return format === 'webm' ? 'webm' : 'ts';
}

/** Converts raw RGBA frames into tagged BT.709 4:2:0 video, matching what browsers expect. */
const COLOR_ARGS = [
  '-vf',
  'scale=out_color_matrix=bt709:out_range=tv,format=yuv420p',
  '-colorspace',
  'bt709',
  '-color_primaries',
  'bt709',
  '-color_trc',
  'bt709',
  '-color_range',
  'tv',
];

/** Encoder arguments for a video-only segment. */
export function videoEncoderArgs(
  format: ExportFormat,
  quality: ExportQuality,
  fps: number,
): string[] {
  const gop = String(Math.max(1, Math.round(fps * 2)));
  switch (format) {
    case 'mp4': {
      const preset = { low: 'veryfast', medium: 'fast', high: 'medium' }[quality];
      const crf = { low: '28', medium: '23', high: '18' }[quality];
      return [
        ...COLOR_ARGS,
        '-c:v',
        'libx264',
        '-preset',
        preset,
        '-crf',
        crf,
        '-profile:v',
        'high',
        '-g',
        gop,
        '-f',
        'mpegts',
      ];
    }
    case 'webm': {
      const crf = { low: '40', medium: '33', high: '28' }[quality];
      const cpuUsed = { low: '6', medium: '5', high: '4' }[quality];
      return [
        ...COLOR_ARGS,
        '-c:v',
        'libvpx-vp9',
        '-b:v',
        '0',
        '-crf',
        crf,
        '-deadline',
        'good',
        '-cpu-used',
        cpuUsed,
        '-row-mt',
        '1',
        '-g',
        gop,
        '-f',
        'webm',
      ];
    }
    case 'gif':
      // A near-lossless intermediate; the palette is computed over the whole animation later.
      return [
        ...COLOR_ARGS,
        '-c:v',
        'libx264',
        '-preset',
        'veryfast',
        '-crf',
        '10',
        '-g',
        gop,
        '-f',
        'mpegts',
      ];
    case 'mp3':
    case 'wav':
      throw new Error(`${format} has no video stream`);
  }
}

export function audioEncoderArgs(format: ExportFormat, quality: ExportQuality): string[] {
  switch (format) {
    case 'mp4':
      return ['-c:a', 'aac', '-b:a', { low: '128k', medium: '192k', high: '256k' }[quality]];
    case 'webm':
      return ['-c:a', 'libopus', '-b:a', { low: '96k', medium: '128k', high: '160k' }[quality]];
    case 'mp3':
      return ['-c:a', 'libmp3lame', '-b:a', { low: '128k', medium: '192k', high: '320k' }[quality]];
    case 'wav':
      return ['-c:a', 'pcm_s16le'];
    case 'gif':
      return [];
  }
}
