import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const FIXTURES = path.join(path.dirname(fileURLToPath(import.meta.url)), '.fixtures');

/** Generates small media files used by the tests (requires FFmpeg on PATH). */
export default function globalSetup(): void {
  mkdirSync(FIXTURES, { recursive: true });
  const make = (name: string, args: string[]) => {
    const file = path.join(FIXTURES, name);
    if (!existsSync(file)) execFileSync('ffmpeg', ['-v', 'error', '-y', ...args, file]);
  };
  make('bars.mp4', [
    '-f',
    'lavfi',
    '-i',
    'testsrc2=size=640x360:rate=30:duration=4',
    '-f',
    'lavfi',
    '-i',
    'sine=frequency=330:duration=4',
    '-c:v',
    'libx264',
    '-pix_fmt',
    'yuv420p',
    '-c:a',
    'aac',
    '-shortest',
  ]);
  make('red.png', ['-f', 'lavfi', '-i', 'color=c=red:s=320x180', '-frames:v', '1']);
}
