import { z } from 'zod';
import { EASINGS } from '../animation/easing.js';
import { HEX_COLOR_PATTERN } from '../util/color.js';
import { ID_PATTERN } from '../util/ids.js';

/**
 * The project document: everything needed to render a video, independent of where media lives.
 *
 * Coordinate system: positions are in project pixels relative to the frame center, so a clip with
 * `x = 0, y = 0` is centered regardless of the project resolution. Times are in seconds.
 */

export const SCHEMA_VERSION = 1;

export const IdSchema = z.string().regex(ID_PATTERN, 'Invalid id');
export const ColorSchema = z.string().regex(HEX_COLOR_PATTERN, 'Expected #RRGGBB or #RRGGBBAA');

const time = z.number().min(0).max(86_400);

export const EasingSchema = z.enum(EASINGS);

export const KeyframeSchema = z.object({
  /** Seconds relative to the clip start. */
  time,
  value: z.number(),
  /** Easing used from this keyframe to the next one. */
  easing: EasingSchema,
});
export type Keyframe = z.infer<typeof KeyframeSchema>;

export const ANIMATABLE_PROPS = ['x', 'y', 'scale', 'rotation', 'opacity'] as const;
export type AnimatableProp = (typeof ANIMATABLE_PROPS)[number];

const keyframeList = z.array(KeyframeSchema).max(500).optional();
export const KeyframesSchema = z.object({
  x: keyframeList,
  y: keyframeList,
  scale: keyframeList,
  rotation: keyframeList,
  opacity: keyframeList,
});
export type Keyframes = z.infer<typeof KeyframesSchema>;

export const TransformSchema = z.object({
  x: z.number().min(-100_000).max(100_000),
  y: z.number().min(-100_000).max(100_000),
  /** Multiplier of the clip's base size (media is fitted inside the frame at scale 1). */
  scale: z.number().min(0).max(50),
  /** Degrees, clockwise. */
  rotation: z.number().min(-36_000).max(36_000),
  opacity: z.number().min(0).max(1),
  flipH: z.boolean(),
  flipV: z.boolean(),
});
export type Transform = z.infer<typeof TransformSchema>;

/** Fractions of the source cropped away on each side. */
export const CropSchema = z
  .object({
    top: z.number().min(0).max(0.95),
    right: z.number().min(0).max(0.95),
    bottom: z.number().min(0).max(0.95),
    left: z.number().min(0).max(0.95),
  })
  .refine(
    (c) => c.left + c.right < 0.98 && c.top + c.bottom < 0.98,
    'Crop removes the whole image',
  );
export type Crop = z.infer<typeof CropSchema>;

export const FiltersSchema = z.object({
  /** 1 = unchanged. */
  brightness: z.number().min(0).max(3),
  contrast: z.number().min(0).max(3),
  saturation: z.number().min(0).max(3),
  /** Degrees of hue rotation. */
  hue: z.number().min(-180).max(180),
  /** Blur radius in project pixels. */
  blur: z.number().min(0).max(100),
  grayscale: z.number().min(0).max(1),
  sepia: z.number().min(0).max(1),
  invert: z.number().min(0).max(1),
  vignette: z.number().min(0).max(1),
});
export type Filters = z.infer<typeof FiltersSchema>;

export const BLEND_MODES = [
  'normal',
  'multiply',
  'screen',
  'overlay',
  'darken',
  'lighten',
  'color-dodge',
  'color-burn',
  'hard-light',
  'soft-light',
  'difference',
  'exclusion',
  'hue',
  'saturation',
  'color',
  'luminosity',
] as const;
export const BlendModeSchema = z.enum(BLEND_MODES);
export type BlendMode = z.infer<typeof BlendModeSchema>;

export const ANIMATION_TYPES = [
  'fade',
  'slideLeft',
  'slideRight',
  'slideUp',
  'slideDown',
  'rise',
  'zoomIn',
  'zoomOut',
  'pop',
  'spin',
  'blur',
  'wipe',
  'typewriter',
] as const;
export const AnimationTypeSchema = z.enum(ANIMATION_TYPES);
export type AnimationType = z.infer<typeof AnimationTypeSchema>;

export const AnimationSchema = z.object({
  type: AnimationTypeSchema,
  duration: z.number().min(0.05).max(30),
});
export type Animation = z.infer<typeof AnimationSchema>;

export const LOOP_TYPES = [
  'kenBurnsIn',
  'kenBurnsOut',
  'pulse',
  'float',
  'shake',
  'rotate',
] as const;
export const LoopTypeSchema = z.enum(LOOP_TYPES);
export type LoopType = z.infer<typeof LoopTypeSchema>;

export const LoopAnimationSchema = z.object({
  type: LoopTypeSchema,
  /** 0..2, where 1 is the default strength. */
  intensity: z.number().min(0).max(2),
});
export type LoopAnimation = z.infer<typeof LoopAnimationSchema>;

export const TRANSITION_TYPES = [
  'fade',
  'fadeblack',
  'fadewhite',
  'wipeleft',
  'wiperight',
  'wipeup',
  'wipedown',
  'slideleft',
  'slideright',
  'slideup',
  'slidedown',
  'circleopen',
  'circleclose',
  'zoomin',
  'radial',
  'blur',
] as const;
export const TransitionTypeSchema = z.enum(TRANSITION_TYPES);
export type TransitionType = z.infer<typeof TransitionTypeSchema>;

/**
 * A transition attached to a clip blends it with the clip that ends exactly where it starts on the
 * same track. The transition is centered on the cut: the outgoing clip is extended by half the
 * duration and the incoming clip starts half the duration early (using source handles when the
 * media has them, or holding the edge frame otherwise). The timeline length does not change.
 */
export const TransitionSchema = z.object({
  type: TransitionTypeSchema,
  duration: z.number().min(0.05).max(10),
});
export type Transition = z.infer<typeof TransitionSchema>;

export const TextStyleSchema = z.object({
  fontFamily: z.string().min(1).max(100),
  /** Project pixels. */
  fontSize: z.number().min(1).max(2000),
  fontWeight: z.number().int().min(100).max(900),
  italic: z.boolean(),
  uppercase: z.boolean(),
  color: ColorSchema,
  align: z.enum(['left', 'center', 'right']),
  /** Multiplier of the font size. */
  lineHeight: z.number().min(0.5).max(4),
  /** Extra spacing between characters in project pixels. */
  letterSpacing: z.number().min(-50).max(200),
  strokeColor: ColorSchema,
  strokeWidth: z.number().min(0).max(100),
  shadowColor: ColorSchema,
  shadowBlur: z.number().min(0).max(200),
  shadowOffsetX: z.number().min(-500).max(500),
  shadowOffsetY: z.number().min(-500).max(500),
  /** A fully transparent color disables the background box. */
  backgroundColor: ColorSchema,
  backgroundPadding: z.number().min(0).max(500),
  backgroundRadius: z.number().min(0).max(500),
  /** Wrap width in project pixels; 0 disables wrapping (lines break only at newlines). */
  maxWidth: z.number().min(0).max(20_000),
});
export type TextStyle = z.infer<typeof TextStyleSchema>;

const clipBase = {
  id: IdSchema,
  name: z.string().max(200),
  /** Timeline position in seconds. */
  start: time,
  /** Timeline duration in seconds. */
  duration: z.number().min(0.001).max(86_400),
};

const visualProps = {
  transform: TransformSchema,
  keyframes: KeyframesSchema,
  filters: FiltersSchema,
  blendMode: BlendModeSchema,
  animationIn: AnimationSchema.nullable(),
  animationOut: AnimationSchema.nullable(),
  loop: LoopAnimationSchema.nullable(),
  transitionIn: TransitionSchema.nullable(),
};

const audioProps = {
  /** Linear gain; 1 = unchanged, 2 = +6 dB. */
  volume: z.number().min(0).max(4),
  muted: z.boolean(),
  /** Audio fade lengths in seconds. */
  fadeIn: z.number().min(0).max(60),
  fadeOut: z.number().min(0).max(60),
};

const mediaProps = {
  assetId: IdSchema,
  /** Offset into the source media (seconds) where this clip begins. */
  trimStart: time,
  /** Playback rate; the clip consumes `duration * speed` seconds of source media. */
  speed: z.number().min(0.1).max(16),
};

export const VideoClipSchema = z.object({
  type: z.literal('video'),
  ...clipBase,
  ...mediaProps,
  ...audioProps,
  ...visualProps,
  crop: CropSchema,
});
export type VideoClip = z.infer<typeof VideoClipSchema>;

export const AudioClipSchema = z.object({
  type: z.literal('audio'),
  ...clipBase,
  ...mediaProps,
  ...audioProps,
});
export type AudioClip = z.infer<typeof AudioClipSchema>;

export const ImageClipSchema = z.object({
  type: z.literal('image'),
  ...clipBase,
  assetId: IdSchema,
  ...visualProps,
  crop: CropSchema,
});
export type ImageClip = z.infer<typeof ImageClipSchema>;

export const TextClipSchema = z.object({
  type: z.literal('text'),
  ...clipBase,
  text: z.string().max(5000),
  style: TextStyleSchema,
  ...visualProps,
});
export type TextClip = z.infer<typeof TextClipSchema>;

export const SHAPE_KINDS = ['rectangle', 'ellipse'] as const;
export const ShapeClipSchema = z.object({
  type: z.literal('shape'),
  ...clipBase,
  shape: z.enum(SHAPE_KINDS),
  /** Project pixels at scale 1. */
  width: z.number().min(1).max(20_000),
  height: z.number().min(1).max(20_000),
  fill: ColorSchema,
  cornerRadius: z.number().min(0).max(10_000),
  strokeColor: ColorSchema,
  strokeWidth: z.number().min(0).max(500),
  ...visualProps,
});
export type ShapeClip = z.infer<typeof ShapeClipSchema>;

export const ClipSchema = z.discriminatedUnion('type', [
  VideoClipSchema,
  AudioClipSchema,
  ImageClipSchema,
  TextClipSchema,
  ShapeClipSchema,
]);
export type Clip = z.infer<typeof ClipSchema>;
export type ClipType = Clip['type'];
export type VisualClip = VideoClip | ImageClip | TextClip | ShapeClip;
export type MediaClip = VideoClip | AudioClip | ImageClip;
export type TimedMediaClip = VideoClip | AudioClip;
export type AudibleClip = VideoClip | AudioClip;

export const TrackKindSchema = z.enum(['video', 'audio']);
export type TrackKind = z.infer<typeof TrackKindSchema>;

export const TrackSchema = z.object({
  id: IdSchema,
  kind: TrackKindSchema,
  name: z.string().max(100),
  muted: z.boolean(),
  hidden: z.boolean(),
  locked: z.boolean(),
  clips: z.array(ClipSchema).max(2000),
});
export type Track = z.infer<typeof TrackSchema>;

export const MarkerSchema = z.object({
  id: IdSchema,
  time,
  label: z.string().max(200),
  color: ColorSchema,
});
export type Marker = z.infer<typeof MarkerSchema>;

export const ProjectSettingsSchema = z.object({
  width: z.number().int().min(16).max(7680),
  height: z.number().int().min(16).max(7680),
  fps: z.number().min(1).max(120),
  backgroundColor: ColorSchema,
});
export type ProjectSettings = z.infer<typeof ProjectSettingsSchema>;

export const TimeRangeSchema = z
  .object({ start: time, end: time })
  .refine((r) => r.end > r.start, 'Range end must be after its start');
export type TimeRange = z.infer<typeof TimeRangeSchema>;

export const ProjectDocSchema = z.object({
  schemaVersion: z.literal(SCHEMA_VERSION),
  settings: ProjectSettingsSchema,
  /** Index 0 is the top-most track; visual tracks higher in the list draw on top. */
  tracks: z.array(TrackSchema).max(100),
  markers: z.array(MarkerSchema).max(1000),
  /** Optional in/out range used for playback looping and range exports. */
  range: TimeRangeSchema.nullable(),
});
export type ProjectDoc = z.infer<typeof ProjectDocSchema>;
