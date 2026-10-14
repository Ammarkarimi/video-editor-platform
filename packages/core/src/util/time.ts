/** Formats seconds as `HH:MM:SS:FF` (SMPTE-style, non-drop-frame). */
export function formatTimecode(seconds: number, fps: number): string {
  const totalFrames = Math.max(0, Math.round(seconds * fps));
  const fpsInt = Math.max(1, Math.round(fps));
  const frames = totalFrames % fpsInt;
  const totalSeconds = Math.floor(totalFrames / fpsInt);
  const s = totalSeconds % 60;
  const m = Math.floor(totalSeconds / 60) % 60;
  const h = Math.floor(totalSeconds / 3600);
  return [h, m, s, frames].map((n) => String(n).padStart(2, '0')).join(':');
}

/** Formats seconds as `M:SS` or `H:MM:SS` for human-readable durations. */
export function formatDuration(seconds: number): string {
  const total = Math.max(0, Math.round(seconds));
  const s = total % 60;
  const m = Math.floor(total / 60) % 60;
  const h = Math.floor(total / 3600);
  const ss = String(s).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
}

/** Formats seconds with a fractional part, e.g. `1:05.25`. */
export function formatPreciseTime(seconds: number): string {
  const sign = seconds < 0 ? '-' : '';
  const abs = Math.abs(seconds);
  const m = Math.floor(abs / 60);
  const s = abs - m * 60;
  return `${sign}${m}:${s.toFixed(2).padStart(5, '0')}`;
}

/** Parses `SS`, `M:SS(.ff)` or `H:MM:SS(.ff)` back into seconds. Returns null when invalid. */
export function parseTime(input: string): number | null {
  const trimmed = input.trim();
  if (!trimmed) return null;
  const parts = trimmed.split(':');
  if (parts.length > 3) return null;
  let total = 0;
  for (const part of parts) {
    if (!/^\d+(\.\d+)?$/.test(part)) return null;
    total = total * 60 + Number(part);
  }
  return Number.isFinite(total) ? total : null;
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  return `${value.toFixed(value >= 100 ? 0 : 1)} ${units[unit]}`;
}
