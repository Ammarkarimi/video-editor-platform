import { createCanvas, GlobalFonts, type Canvas } from '@napi-rs/canvas';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  createProjectDoc,
  createShapeClip,
  createTextClip,
  FONT_CATALOG,
  getClipBox,
  insertClip,
  pointInClipBox,
  renderFrame,
  setTransition,
  type Ctx2D,
  type ProjectDoc,
  type RenderHost,
  type TransitionType,
} from '../src/index.js';
import { assets, imageClip } from './helpers.js';

const W = 192;
const H = 108;

const fontsDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../assets/fonts',
);

beforeAll(() => {
  for (const family of FONT_CATALOG) {
    for (const face of family.faces)
      GlobalFonts.registerFromPath(path.join(fontsDir, face.file), family.family);
  }
});

function solid(color: string, w = 100, h = 100): Canvas {
  const c = createCanvas(w, h);
  const ctx = c.getContext('2d');
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, w, h);
  return c;
}

const host: RenderHost = {
  getFrame: (_clipId, assetId) =>
    assetId === 'ast_image' ? { image: solid('#0000ff'), width: 100, height: 100 } : null,
  createCanvas: (w, h) => createCanvas(w, h),
};

function render(doc: ProjectDoc, time: number): (x: number, y: number) => [number, number, number] {
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext('2d') as unknown as Ctx2D;
  renderFrame(ctx, { doc, assets }, time, host, { width: W, height: H });
  const data = canvas.getContext('2d').getImageData(0, 0, W, H).data;
  return (x, y) => {
    const i = (y * W + x) * 4;
    return [data[i]!, data[i + 1]!, data[i + 2]!];
  };
}

function fullFrame(doc: ProjectDoc, color: string, start: number, duration: number) {
  const clip = createShapeClip(start, doc.settings, {
    width: doc.settings.width,
    height: doc.settings.height,
    fill: color,
    duration,
  });
  return clip;
}

describe('renderFrame', () => {
  it('fills the background color', () => {
    const doc = createProjectDoc({ backgroundColor: '#336699' });
    expect(render(doc, 0)(10, 10)).toEqual([0x33, 0x66, 0x99]);
  });

  it('fits images inside the frame', () => {
    const doc = createProjectDoc();
    doc.tracks[0]!.clips.push(imageClip(0, 5));
    const px = render(doc, 1);
    expect(px(96, 54)).toEqual([0, 0, 255]); // centered square
    expect(px(5, 54)).toEqual([0, 0, 0]); // pillarbox
  });

  it('draws higher tracks on top and respects hidden tracks', () => {
    const doc = createProjectDoc();
    doc.tracks[0]!.clips.push(fullFrame(doc, '#ff0000', 0, 5));
    insertClip(doc, fullFrame(doc, '#00ff00', 0, 5)); // new track above
    expect(render(doc, 1)(50, 50)).toEqual([0, 255, 0]);
    doc.tracks[0]!.hidden = true;
    expect(render(doc, 1)(50, 50)).toEqual([255, 0, 0]);
  });

  it('applies opacity, filters and blend modes', () => {
    const doc = createProjectDoc();
    const red = fullFrame(doc, '#ff0000', 0, 5);
    red.transform.opacity = 0.5;
    doc.tracks[0]!.clips.push(red);
    const [r] = render(doc, 1)(50, 50);
    expect(r).toBeGreaterThan(120);
    expect(r).toBeLessThan(135);

    red.transform.opacity = 1;
    red.filters.grayscale = 1;
    const [gr, gg, gb] = render(doc, 1)(50, 50);
    expect(gr).toBe(gg);
    expect(gg).toBe(gb);

    red.filters.grayscale = 0;
    const white = fullFrame(doc, '#ffffff', 0, 5);
    white.blendMode = 'multiply';
    insertClip(doc, white);
    expect(render(doc, 1)(50, 50)).toEqual([255, 0, 0]);
  });

  it('skips clips outside their time range', () => {
    const doc = createProjectDoc();
    doc.tracks[0]!.clips.push(fullFrame(doc, '#ff0000', 2, 1));
    expect(render(doc, 1)(50, 50)).toEqual([0, 0, 0]);
    expect(render(doc, 2.5)(50, 50)).toEqual([255, 0, 0]);
    expect(render(doc, 3)(50, 50)).toEqual([0, 0, 0]);
  });

  describe('transitions', () => {
    function transitionDoc(type: TransitionType) {
      const doc = createProjectDoc();
      const a = fullFrame(doc, '#ff0000', 0, 4);
      const b = fullFrame(doc, '#0000ff', 4, 4);
      doc.tracks[0]!.clips.push(a, b);
      expect(setTransition(doc, b.id, { type, duration: 2 })).toBe(true);
      return doc;
    }

    it('cross-dissolves without dipping', () => {
      const doc = transitionDoc('fade');
      const [r, g, b] = render(doc, 4)(96, 54);
      expect(r).toBeGreaterThan(120);
      expect(b).toBeGreaterThan(120);
      expect(r + b).toBeGreaterThan(250);
      expect(g).toBe(0);
      expect(render(doc, 2.9)(96, 54)).toEqual([255, 0, 0]);
      expect(render(doc, 5.1)(96, 54)).toEqual([0, 0, 255]);
    });

    it('wipes from the right edge', () => {
      const px = render(transitionDoc('wipeleft'), 4);
      expect(px(10, 54)).toEqual([255, 0, 0]);
      expect(px(180, 54)).toEqual([0, 0, 255]);
    });

    it('dips to black halfway', () => {
      const [r, g, b] = render(transitionDoc('fadeblack'), 4)(96, 54);
      expect(r + g + b).toBeLessThan(10);
    });

    it('opens a circle from the center', () => {
      const px = render(transitionDoc('circleopen'), 3.6);
      expect(px(96, 54)).toEqual([0, 0, 255]);
      expect(px(2, 2)).toEqual([255, 0, 0]);
    });

    it('pushes clips sideways', () => {
      const px = render(transitionDoc('slideleft'), 4);
      expect(px(10, 54)).toEqual([255, 0, 0]);
      expect(px(180, 54)).toEqual([0, 0, 255]);
    });

    it('renders every transition type without throwing', () => {
      for (const type of [
        'fadewhite',
        'wiperight',
        'wipeup',
        'wipedown',
        'slideright',
        'slideup',
        'slidedown',
        'circleclose',
        'zoomin',
        'radial',
        'blur',
      ] as const) {
        expect(() => render(transitionDoc(type), 4)).not.toThrow();
      }
    });
  });

  it('renders text with bundled fonts and reports its box', () => {
    const doc = createProjectDoc();
    const text = createTextClip(0, { text: 'HELLO', style: { fontSize: 400, color: '#ffffff' } });
    doc.tracks[0]!.clips.push(text);
    const px = render(doc, 1);
    let lit = 0;
    for (let x = 0; x < W; x++) for (let y = 0; y < H; y++) if (px(x, y)[0]! > 200) lit++;
    expect(lit).toBeGreaterThan(200);

    const measure = createCanvas(10, 10).getContext('2d') as unknown as Ctx2D;
    const box = getClipBox(text, { doc, assets }, 1, measure);
    expect(box.width).toBeGreaterThan(900);
    expect(box.height).toBeGreaterThan(400);
    expect(pointInClipBox(box, 960, 540)).toBe(true);
    expect(pointInClipBox(box, 10, 10)).toBe(false);
  });

  it('reveals text progressively with the typewriter animation', () => {
    const doc = createProjectDoc();
    const text = createTextClip(0, { text: 'TYPEWRITER', style: { fontSize: 200 } });
    text.animationIn = { type: 'typewriter', duration: 2 };
    doc.tracks[0]!.clips.push(text);
    const litPixels = (time: number) => {
      const px = render(doc, time);
      let lit = 0;
      for (let x = 0; x < W; x++) for (let y = 0; y < H; y++) if (px(x, y)[0]! > 200) lit++;
      return lit;
    };
    expect(litPixels(0)).toBe(0);
    const half = litPixels(1);
    const full = litPixels(3);
    expect(half).toBeGreaterThan(0);
    expect(full).toBeGreaterThan(half);
  });
});
