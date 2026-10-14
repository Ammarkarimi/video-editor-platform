import { DEFAULT_FONT_FAMILY } from '../fonts.js';
import { createId } from '../util/ids.js';
import {
  SCHEMA_VERSION,
  type AudioClip,
  type Crop,
  type Filters,
  type ImageClip,
  type Marker,
  type ProjectDoc,
  type ProjectSettings,
  type ShapeClip,
  type TextClip,
  type TextStyle,
  type Track,
  type TrackKind,
  type Transform,
  type VideoClip,
} from './schema.js';

export const DEFAULT_IMAGE_DURATION = 5;
export const DEFAULT_TEXT_DURATION = 5;
export const DEFAULT_TRANSITION_DURATION = 1;

export interface AspectPreset {
  id: string;
  label: string;
  description: string;
  width: number;
  height: number;
}

export const ASPECT_PRESETS: AspectPreset[] = [
  {
    id: '16:9',
    label: 'Landscape 16:9',
    description: 'YouTube, desktop',
    width: 1920,
    height: 1080,
  },
  {
    id: '9:16',
    label: 'Vertical 9:16',
    description: 'Reels, TikTok, Shorts',
    width: 1080,
    height: 1920,
  },
  {
    id: '1:1',
    label: 'Square 1:1',
    description: 'Instagram, social feeds',
    width: 1080,
    height: 1080,
  },
  {
    id: '4:5',
    label: 'Portrait 4:5',
    description: 'Instagram portrait',
    width: 1080,
    height: 1350,
  },
  {
    id: '4:3',
    label: 'Classic 4:3',
    description: 'Presentations, retro',
    width: 1440,
    height: 1080,
  },
  { id: '21:9', label: 'Cinematic 21:9', description: 'Ultra-wide', width: 2560, height: 1080 },
];

export const FPS_PRESETS = [24, 25, 30, 50, 60] as const;

export function defaultSettings(partial: Partial<ProjectSettings> = {}): ProjectSettings {
  return {
    width: 1920,
    height: 1080,
    fps: 30,
    backgroundColor: '#000000',
    ...partial,
  };
}

export function createTrack(kind: TrackKind, name: string): Track {
  return {
    id: createId('trk'),
    kind,
    name,
    muted: false,
    hidden: false,
    locked: false,
    clips: [],
  };
}

export function createProjectDoc(settings: Partial<ProjectSettings> = {}): ProjectDoc {
  return {
    schemaVersion: SCHEMA_VERSION,
    settings: defaultSettings(settings),
    tracks: [createTrack('video', 'Video 1'), createTrack('audio', 'Audio 1')],
    markers: [],
    range: null,
  };
}

export function defaultTransform(): Transform {
  return { x: 0, y: 0, scale: 1, rotation: 0, opacity: 1, flipH: false, flipV: false };
}

export function defaultFilters(): Filters {
  return {
    brightness: 1,
    contrast: 1,
    saturation: 1,
    hue: 0,
    blur: 0,
    grayscale: 0,
    sepia: 0,
    invert: 0,
    vignette: 0,
  };
}

export function defaultCrop(): Crop {
  return { top: 0, right: 0, bottom: 0, left: 0 };
}

function visualDefaults() {
  return {
    transform: defaultTransform(),
    keyframes: {},
    filters: defaultFilters(),
    blendMode: 'normal' as const,
    animationIn: null,
    animationOut: null,
    loop: null,
    transitionIn: null,
  };
}

export interface MediaInfo {
  assetId: string;
  name: string;
  duration: number;
}

export function createVideoClip(media: MediaInfo, start: number): VideoClip {
  return {
    type: 'video',
    id: createId('clp'),
    name: media.name,
    start,
    duration: Math.max(0.04, media.duration),
    assetId: media.assetId,
    trimStart: 0,
    speed: 1,
    volume: 1,
    muted: false,
    fadeIn: 0,
    fadeOut: 0,
    crop: defaultCrop(),
    ...visualDefaults(),
  };
}

export function createAudioClip(media: MediaInfo, start: number): AudioClip {
  return {
    type: 'audio',
    id: createId('clp'),
    name: media.name,
    start,
    duration: Math.max(0.04, media.duration),
    assetId: media.assetId,
    trimStart: 0,
    speed: 1,
    volume: 1,
    muted: false,
    fadeIn: 0,
    fadeOut: 0,
  };
}

export function createImageClip(
  media: Omit<MediaInfo, 'duration'>,
  start: number,
  duration = DEFAULT_IMAGE_DURATION,
): ImageClip {
  return {
    type: 'image',
    id: createId('clp'),
    name: media.name,
    start,
    duration,
    assetId: media.assetId,
    crop: defaultCrop(),
    ...visualDefaults(),
  };
}

export function defaultTextStyle(partial: Partial<TextStyle> = {}): TextStyle {
  return {
    fontFamily: DEFAULT_FONT_FAMILY,
    fontSize: 96,
    fontWeight: 700,
    italic: false,
    uppercase: false,
    color: '#ffffff',
    align: 'center',
    lineHeight: 1.2,
    letterSpacing: 0,
    strokeColor: '#000000',
    strokeWidth: 0,
    shadowColor: '#00000080',
    shadowBlur: 0,
    shadowOffsetX: 0,
    shadowOffsetY: 0,
    backgroundColor: '#00000000',
    backgroundPadding: 24,
    backgroundRadius: 12,
    maxWidth: 0,
    ...partial,
  };
}

export interface TextPreset {
  id: string;
  label: string;
  text: string;
  style: Partial<TextStyle>;
  /** Position as a fraction of the frame size, relative to the center (-0.5..0.5). */
  position?: { x: number; y: number };
  animationIn?: TextClip['animationIn'];
  animationOut?: TextClip['animationOut'];
}

export const TEXT_PRESETS: TextPreset[] = [
  {
    id: 'title',
    label: 'Title',
    text: 'Your Title',
    style: { fontSize: 140, fontWeight: 900, shadowBlur: 24, shadowOffsetY: 6 },
    animationIn: { type: 'zoomOut', duration: 0.6 },
    animationOut: { type: 'fade', duration: 0.4 },
  },
  {
    id: 'subtitle',
    label: 'Subtitle',
    text: 'A short subtitle',
    style: { fontSize: 64, fontWeight: 400, shadowBlur: 12, shadowOffsetY: 3 },
    position: { x: 0, y: 0.12 },
    animationIn: { type: 'rise', duration: 0.5 },
    animationOut: { type: 'fade', duration: 0.4 },
  },
  {
    id: 'lower-third',
    label: 'Lower third',
    text: 'Jane Doe\nProduct Designer',
    style: {
      fontSize: 52,
      fontWeight: 700,
      align: 'left',
      backgroundColor: '#111827e6',
      backgroundPadding: 28,
      backgroundRadius: 8,
      lineHeight: 1.35,
    },
    position: { x: -0.28, y: 0.32 },
    animationIn: { type: 'slideRight', duration: 0.5 },
    animationOut: { type: 'slideLeft', duration: 0.4 },
  },
  {
    id: 'caption',
    label: 'Caption',
    text: 'Captions make videos accessible',
    style: {
      fontSize: 54,
      fontWeight: 700,
      backgroundColor: '#000000b3',
      backgroundPadding: 18,
      backgroundRadius: 10,
      maxWidth: 1400,
    },
    position: { x: 0, y: 0.38 },
  },
  {
    id: 'outline',
    label: 'Outline',
    text: 'BOLD STATEMENT',
    style: {
      fontFamily: 'Anton',
      fontWeight: 400,
      fontSize: 150,
      color: '#facc15',
      strokeColor: '#000000',
      strokeWidth: 8,
      letterSpacing: 4,
    },
    animationIn: { type: 'pop', duration: 0.5 },
  },
  {
    id: 'neon',
    label: 'Neon glow',
    text: 'Neon Nights',
    style: {
      fontFamily: 'Pacifico',
      fontWeight: 400,
      fontSize: 130,
      color: '#f0abfc',
      shadowColor: '#d946efff',
      shadowBlur: 40,
    },
    animationIn: { type: 'blur', duration: 0.8 },
  },
  {
    id: 'quote',
    label: 'Quote',
    text: '“Simplicity is the ultimate\nsophistication.”',
    style: {
      fontFamily: 'Playfair Display',
      fontWeight: 400,
      italic: true,
      fontSize: 80,
      lineHeight: 1.3,
    },
    animationIn: { type: 'fade', duration: 0.8 },
    animationOut: { type: 'fade', duration: 0.8 },
  },
  {
    id: 'typewriter',
    label: 'Typewriter',
    text: 'Once upon a time...',
    style: { fontFamily: 'Roboto Mono', fontWeight: 400, fontSize: 72 },
    animationIn: { type: 'typewriter', duration: 1.5 },
  },
];

export function createTextClip(
  start: number,
  options: {
    text?: string;
    style?: Partial<TextStyle>;
    preset?: TextPreset;
    frame?: { width: number; height: number };
    duration?: number;
  } = {},
): TextClip {
  const preset = options.preset;
  const frame = options.frame ?? { width: 1920, height: 1080 };
  // Presets are designed for 1080p; scale font sizes to the project's short side.
  const sizeFactor = Math.min(frame.width, frame.height) / 1080;
  const presetStyle = preset ? scaleTextStyle(preset.style, sizeFactor) : {};
  const text = options.text ?? preset?.text ?? 'Text';
  return {
    type: 'text',
    id: createId('clp'),
    name: text.split('\n')[0]!.slice(0, 60) || 'Text',
    start,
    duration: options.duration ?? DEFAULT_TEXT_DURATION,
    text,
    style: defaultTextStyle({
      fontSize: Math.round(96 * sizeFactor),
      ...presetStyle,
      ...options.style,
    }),
    ...visualDefaults(),
    transform: {
      ...defaultTransform(),
      x: Math.round((preset?.position?.x ?? 0) * frame.width),
      y: Math.round((preset?.position?.y ?? 0) * frame.height),
    },
    animationIn: preset?.animationIn ?? null,
    animationOut: preset?.animationOut ?? null,
  };
}

function scaleTextStyle(style: Partial<TextStyle>, factor: number): Partial<TextStyle> {
  if (factor === 1) return style;
  const scaled: Partial<TextStyle> = { ...style };
  const keys = [
    'fontSize',
    'strokeWidth',
    'shadowBlur',
    'shadowOffsetX',
    'shadowOffsetY',
    'backgroundPadding',
    'backgroundRadius',
    'maxWidth',
    'letterSpacing',
  ] as const;
  for (const key of keys) {
    const v = style[key];
    if (typeof v === 'number') scaled[key] = Math.round(v * factor * 100) / 100;
  }
  return scaled;
}

export interface ShapePreset {
  id: string;
  label: string;
  build: (frame: { width: number; height: number }) => Partial<ShapeClip>;
}

export const SHAPE_PRESETS: ShapePreset[] = [
  {
    id: 'background',
    label: 'Solid background',
    build: (f) => ({
      shape: 'rectangle',
      width: f.width,
      height: f.height,
      fill: '#1e293b',
      name: 'Background',
    }),
  },
  {
    id: 'rectangle',
    label: 'Rectangle',
    build: (f) => ({
      shape: 'rectangle',
      width: Math.round(f.width * 0.4),
      height: Math.round(f.height * 0.3),
      fill: '#6366f1',
      cornerRadius: 24,
      name: 'Rectangle',
    }),
  },
  {
    id: 'circle',
    label: 'Circle',
    build: (f) => {
      const d = Math.round(Math.min(f.width, f.height) * 0.4);
      return { shape: 'ellipse', width: d, height: d, fill: '#f43f5e', name: 'Circle' };
    },
  },
  {
    id: 'bar',
    label: 'Banner bar',
    build: (f) => ({
      shape: 'rectangle',
      width: f.width,
      height: Math.round(f.height * 0.14),
      fill: '#0f172acc',
      name: 'Banner',
      transform: { ...defaultTransform(), y: Math.round(f.height * 0.36) },
    }),
  },
  {
    id: 'frame',
    label: 'Outline frame',
    build: (f) => ({
      shape: 'rectangle',
      width: Math.round(f.width * 0.9),
      height: Math.round(f.height * 0.86),
      fill: '#00000000',
      strokeColor: '#ffffff',
      strokeWidth: Math.max(4, Math.round(Math.min(f.width, f.height) * 0.008)),
      cornerRadius: 16,
      name: 'Frame',
    }),
  },
];

export function createShapeClip(
  start: number,
  frame: { width: number; height: number },
  overrides: Partial<ShapeClip> = {},
): ShapeClip {
  return {
    type: 'shape',
    id: createId('clp'),
    name: 'Shape',
    start,
    duration: DEFAULT_IMAGE_DURATION,
    shape: 'rectangle',
    width: Math.round(frame.width / 2),
    height: Math.round(frame.height / 2),
    fill: '#6366f1',
    cornerRadius: 0,
    strokeColor: '#ffffff',
    strokeWidth: 0,
    ...visualDefaults(),
    ...overrides,
  };
}

export const MARKER_COLORS = ['#f59e0b', '#ef4444', '#22c55e', '#3b82f6', '#a855f7', '#ec4899'];

export function createMarker(time: number, label = '', color = MARKER_COLORS[0]!): Marker {
  return { id: createId('mrk'), time, label, color };
}
