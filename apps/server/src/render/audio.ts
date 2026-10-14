import type { AudioSegment } from '@vep/core';

export const AUDIO_SAMPLE_RATE = 48_000;

function num(value: number): string {
  return Number(value.toFixed(6)).toString();
}

/** `atempo` only accepts factors in [0.5, 2] on older FFmpeg builds, so chain it. */
export function atempoChain(speed: number): string[] {
  const filters: string[] = [];
  let remaining = speed;
  while (remaining > 2) {
    filters.push('atempo=2');
    remaining /= 2;
  }
  while (remaining < 0.5) {
    filters.push('atempo=0.5');
    remaining /= 0.5;
  }
  if (Math.abs(remaining - 1) > 1e-6) filters.push(`atempo=${num(remaining)}`);
  return filters;
}

export interface AudioMixInput {
  segment: AudioSegment;
  file: string;
}

/**
 * Builds FFmpeg arguments that mix every audible clip within `[start, end)` into a stereo WAV of
 * exactly `end - start` seconds. Fades are evaluated with the same linear curve the browser
 * preview uses (`fadeGainAt`).
 */
export function buildAudioMixArgs(
  inputs: AudioMixInput[],
  start: number,
  end: number,
  output: string,
): string[] {
  const duration = end - start;
  const args: string[] = ['-v', 'error', '-y', '-nostats', '-progress', 'pipe:1'];
  const chains: string[] = [];
  const labels: string[] = [];

  for (const { segment, file } of inputs) {
    const visStart = Math.max(segment.start, start);
    const visEnd = Math.min(segment.end, end);
    if (visEnd - visStart < 0.001) continue;
    const sourceOffset = segment.sourceStart + (visStart - segment.start) * segment.speed;
    const sourceDuration = (visEnd - visStart) * segment.speed;
    const index = labels.length;
    args.push('-ss', num(sourceOffset), '-t', num(sourceDuration + 0.05), '-i', file);

    const clipDuration = segment.end - segment.start;
    const localOffset = visStart - segment.start;
    // Gain as a function of the stream time `t` (seconds since visStart, after tempo change).
    const terms = [num(segment.volume)];
    if (segment.fadeIn > 0)
      terms.push(`min(1,max(0,(t+${num(localOffset)})/${num(segment.fadeIn)}))`);
    if (segment.fadeOut > 0) {
      terms.push(
        `min(1,max(0,(${num(clipDuration)}-(t+${num(localOffset)}))/${num(segment.fadeOut)}))`,
      );
    }
    const filters = [
      `aresample=${AUDIO_SAMPLE_RATE}`,
      'aformat=sample_fmts=fltp:channel_layouts=stereo',
      ...atempoChain(segment.speed),
      `atrim=0:${num(visEnd - visStart)}`,
      'asetpts=PTS-STARTPTS',
      terms.length > 1 ? `volume='${terms.join('*')}':eval=frame` : `volume=${terms[0]}`,
      `adelay=${Math.round((visStart - start) * 1000)}:all=1`,
    ];
    chains.push(`[${index}:a]${filters.join(',')}[a${index}]`);
    labels.push(`[a${index}]`);
  }

  if (labels.length === 0) {
    args.push(
      '-f',
      'lavfi',
      '-t',
      num(duration),
      '-i',
      `anullsrc=r=${AUDIO_SAMPLE_RATE}:cl=stereo`,
    );
    args.push('-c:a', 'pcm_s16le', output);
    return args;
  }

  const mixed =
    labels.length === 1
      ? `${labels[0]}anull[mixed]`
      : `${labels.join('')}amix=inputs=${labels.length}:normalize=0:dropout_transition=0[mixed]`;
  chains.push(mixed);
  chains.push(
    `[mixed]apad=whole_dur=${num(duration)},atrim=0:${num(duration)},aformat=sample_fmts=s16:channel_layouts=stereo[out]`,
  );
  args.push(
    '-filter_complex',
    chains.join(';'),
    '-map',
    '[out]',
    '-ar',
    String(AUDIO_SAMPLE_RATE),
    '-c:a',
    'pcm_s16le',
    output,
  );
  return args;
}
