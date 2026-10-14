/**
 * Minimal structural view of a 2D canvas context.
 *
 * The browser's `CanvasRenderingContext2D` and `@napi-rs/canvas`'s Skia context both satisfy this
 * at runtime, which is what lets the exact same drawing code run in the editor preview and in the
 * export workers. Callers cast their native context with `as unknown as Ctx2D`.
 */
export interface TextMetricsLike {
  width: number;
  fontBoundingBoxAscent?: number;
  fontBoundingBoxDescent?: number;
  actualBoundingBoxAscent?: number;
  actualBoundingBoxDescent?: number;
}

export interface GradientLike {
  addColorStop(offset: number, color: string): void;
}

export type FillRule = 'nonzero' | 'evenodd';

export interface Ctx2D {
  globalAlpha: number;
  globalCompositeOperation: string;
  filter: string;
  fillStyle: unknown;
  strokeStyle: unknown;
  lineWidth: number;
  lineJoin: string;
  lineCap: string;
  font: string;
  textAlign: string;
  textBaseline: string;
  letterSpacing?: string;
  shadowColor: string;
  shadowBlur: number;
  shadowOffsetX: number;
  shadowOffsetY: number;
  imageSmoothingEnabled: boolean;
  imageSmoothingQuality?: string;

  save(): void;
  restore(): void;
  setTransform(a: number, b: number, c: number, d: number, e: number, f: number): void;
  translate(x: number, y: number): void;
  rotate(angle: number): void;
  scale(x: number, y: number): void;

  clearRect(x: number, y: number, w: number, h: number): void;
  fillRect(x: number, y: number, w: number, h: number): void;

  beginPath(): void;
  closePath(): void;
  moveTo(x: number, y: number): void;
  lineTo(x: number, y: number): void;
  rect(x: number, y: number, w: number, h: number): void;
  arc(x: number, y: number, r: number, start: number, end: number, ccw?: boolean): void;
  arcTo(x1: number, y1: number, x2: number, y2: number, r: number): void;
  ellipse(
    x: number,
    y: number,
    rx: number,
    ry: number,
    rotation: number,
    start: number,
    end: number,
    ccw?: boolean,
  ): void;
  fill(fillRule?: FillRule): void;
  stroke(): void;
  clip(fillRule?: FillRule): void;

  fillText(text: string, x: number, y: number): void;
  strokeText(text: string, x: number, y: number): void;
  measureText(text: string): TextMetricsLike;

  drawImage(image: unknown, dx: number, dy: number): void;
  drawImage(image: unknown, dx: number, dy: number, dw: number, dh: number): void;
  drawImage(
    image: unknown,
    sx: number,
    sy: number,
    sw: number,
    sh: number,
    dx: number,
    dy: number,
    dw: number,
    dh: number,
  ): void;

  createRadialGradient(
    x0: number,
    y0: number,
    r0: number,
    x1: number,
    y1: number,
    r1: number,
  ): GradientLike;
}

export interface CanvasLike {
  width: number;
  height: number;
  getContext(type: '2d'): unknown;
}

/** A decoded image or video frame ready to be drawn. */
export interface FrameImage {
  /** Anything the host's `drawImage` accepts (HTMLVideoElement, ImageBitmap, Skia canvas...). */
  image: unknown;
  /** Pixel size of `image`. */
  width: number;
  height: number;
}

/** Environment-specific services the renderer needs. */
export interface RenderHost {
  /**
   * Returns the frame of a video/image clip at `sourceTime` seconds into its media, or null when
   * it is not available (yet). Images ignore `sourceTime`.
   */
  getFrame(clipId: string, assetId: string, sourceTime: number): FrameImage | null;
  /** Creates an offscreen canvas used to composite transitions. */
  createCanvas(width: number, height: number): CanvasLike;
}
