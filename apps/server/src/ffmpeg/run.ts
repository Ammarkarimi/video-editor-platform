import { spawn, type ChildProcess } from 'node:child_process';

export class FfmpegError extends Error {
  readonly stderr: string;
  readonly exitCode: number | null;

  constructor(message: string, stderr: string, exitCode: number | null) {
    super(message);
    this.name = 'FfmpegError';
    this.stderr = stderr;
    this.exitCode = exitCode;
  }
}

export class AbortError extends Error {
  constructor() {
    super('Operation cancelled');
    this.name = 'AbortError';
  }
}

export interface RunOptions {
  signal?: AbortSignal;
  /** Receives the output position in seconds (requires `-progress pipe:1` in the arguments). */
  onProgress?: (seconds: number) => void;
  /** Collect stdout into a Buffer (otherwise it is parsed for progress or discarded). */
  captureStdout?: boolean;
}

const STDERR_TAIL = 8000;

/** Keeps the last few KB of a stream, which is where FFmpeg puts the actual error. */
export function collectTail(child: ChildProcess, limit = STDERR_TAIL): () => string {
  let tail = '';
  child.stderr?.setEncoding('utf8');
  child.stderr?.on('data', (chunk: string) => {
    tail = (tail + chunk).slice(-limit);
  });
  return () => tail;
}

export function summarizeFfmpegError(stderr: string): string {
  const lines = stderr
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('frame=') && !l.startsWith('size='));
  return lines.slice(-3).join(' | ') || 'FFmpeg failed';
}

/** Runs a binary (ffmpeg/ffprobe) to completion. Resolves with captured stdout. */
export function runProcess(
  binary: string,
  args: string[],
  options: RunOptions = {},
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    if (options.signal?.aborted) {
      reject(new AbortError());
      return;
    }
    const child = spawn(binary, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    const stderrTail = collectTail(child);
    const chunks: Buffer[] = [];
    let progressBuffer = '';

    child.stdout?.on('data', (chunk: Buffer) => {
      if (options.captureStdout) {
        chunks.push(chunk);
        return;
      }
      if (!options.onProgress) return;
      progressBuffer += chunk.toString('utf8');
      let newline: number;
      while ((newline = progressBuffer.indexOf('\n')) >= 0) {
        const line = progressBuffer.slice(0, newline).trim();
        progressBuffer = progressBuffer.slice(newline + 1);
        const match = /^out_time_us=(\d+)/.exec(line);
        if (match) options.onProgress(Number(match[1]) / 1_000_000);
      }
    });

    const onAbort = () => child.kill('SIGKILL');
    options.signal?.addEventListener('abort', onAbort, { once: true });

    child.on('error', (err) => {
      options.signal?.removeEventListener('abort', onAbort);
      reject(err);
    });
    child.on('close', (code) => {
      options.signal?.removeEventListener('abort', onAbort);
      if (options.signal?.aborted) {
        reject(new AbortError());
        return;
      }
      if (code === 0) {
        resolve(Buffer.concat(chunks));
        return;
      }
      const stderr = stderrTail();
      reject(new FfmpegError(summarizeFfmpegError(stderr), stderr, code));
    });
  });
}

export async function detectFfmpegVersion(ffmpegPath: string): Promise<string | null> {
  try {
    const out = await runProcess(ffmpegPath, ['-hide_banner', '-version'], { captureStdout: true });
    const match = /ffmpeg version (\S+)/.exec(out.toString('utf8'));
    return match?.[1] ?? 'unknown';
  } catch {
    return null;
  }
}
