import { createCanvas } from '@napi-rs/canvas';
import {
  getClipsNeededAt,
  getVideoSourceTime,
  type AssetInfo,
  type CanvasLike,
  type FrameImage,
  type ImageClip,
  type ProjectDoc,
  type RenderHost,
  type VideoClip,
} from '@vep/core';
import { decodeImage, decodeSize, decodeVideoFrame, VideoClipDecoder } from './frames.js';

/** Asset information plus the path of the original media file. */
export interface RenderAsset extends AssetInfo {
  file: string;
}

interface Output {
  width: number;
  height: number;
}

/**
 * Supplies decoded media frames to the shared renderer during an export. `prepare(time)` must be
 * awaited before rendering each frame; times must be visited in increasing order.
 */
export class ExportRenderHost implements RenderHost {
  private readonly decoders = new Map<string, VideoClipDecoder>();
  private readonly images = new Map<string, Promise<FrameImage>>();
  private readonly current = new Map<string, FrameImage | null>();

  constructor(
    private readonly doc: ProjectDoc,
    private readonly assets: ReadonlyMap<string, RenderAsset>,
    private readonly ffmpegPath: string,
    private readonly fps: number,
    private readonly output: Output,
  ) {}

  async prepare(time: number): Promise<void> {
    this.current.clear();
    const needed = getClipsNeededAt(this.doc, time);
    const neededIds = new Set(needed.map((c) => c.id));
    // A clip's visible range is contiguous, so once it is not needed it never will be again.
    for (const [id, decoder] of this.decoders) {
      if (!neededIds.has(id)) {
        decoder.dispose();
        this.decoders.delete(id);
      }
    }
    for (const id of this.images.keys()) if (!neededIds.has(id)) this.images.delete(id);

    await Promise.all(
      needed.map(async (clip) => {
        const asset = this.assets.get(clip.assetId);
        if (!asset || asset.width <= 0 || asset.height <= 0) return;
        if (clip.type === 'image') {
          let image = this.images.get(clip.id);
          if (!image) {
            image = decodeImage(
              this.ffmpegPath,
              asset.file,
              decodeSize(clip, asset, this.doc.settings, this.output),
            );
            this.images.set(clip.id, image);
          }
          this.current.set(clip.id, await image);
          return;
        }
        let decoder = this.decoders.get(clip.id);
        if (!decoder) {
          const size = decodeSize(clip, asset, this.doc.settings, this.output);
          decoder = new VideoClipDecoder(
            this.ffmpegPath,
            asset.file,
            clip,
            asset,
            time,
            this.fps,
            size,
          );
          this.decoders.set(clip.id, decoder);
        }
        this.current.set(clip.id, await decoder.frameAt(time));
      }),
    );
  }

  getFrame(clipId: string): FrameImage | null {
    return this.current.get(clipId) ?? null;
  }

  createCanvas(width: number, height: number): CanvasLike {
    return createCanvas(width, height) as unknown as CanvasLike;
  }

  dispose(): void {
    for (const decoder of this.decoders.values()) decoder.dispose();
    this.decoders.clear();
    this.images.clear();
  }
}

/** Host for rendering a single still frame: every needed frame is extracted up front. */
export class StillRenderHost implements RenderHost {
  private readonly frames = new Map<string, FrameImage | null>();

  constructor(
    private readonly doc: ProjectDoc,
    private readonly assets: ReadonlyMap<string, RenderAsset>,
    private readonly ffmpegPath: string,
    private readonly output: Output,
  ) {}

  async prepare(time: number): Promise<void> {
    const needed = getClipsNeededAt(this.doc, time);
    await Promise.all(
      needed.map(async (clip: VideoClip | ImageClip) => {
        const asset = this.assets.get(clip.assetId);
        if (!asset || asset.width <= 0 || asset.height <= 0) return;
        const size = decodeSize(clip, asset, this.doc.settings, this.output);
        try {
          const frame =
            clip.type === 'image'
              ? await decodeImage(this.ffmpegPath, asset.file, size)
              : await decodeVideoFrame(
                  this.ffmpegPath,
                  asset.file,
                  getVideoSourceTime(clip, time, asset),
                  size,
                );
          this.frames.set(clip.id, frame);
        } catch {
          this.frames.set(clip.id, null);
        }
      }),
    );
  }

  getFrame(clipId: string): FrameImage | null {
    return this.frames.get(clipId) ?? null;
  }

  createCanvas(width: number, height: number): CanvasLike {
    return createCanvas(width, height) as unknown as CanvasLike;
  }
}
