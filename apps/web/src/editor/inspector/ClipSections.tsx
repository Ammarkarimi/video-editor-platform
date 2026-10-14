import {
  ANIMATION_INFO,
  applyFilterPreset,
  BLEND_MODES,
  canHaveTransition,
  clipEnd,
  FILTER_PRESETS,
  filtersAreDefault,
  findClip,
  LOOP_INFO,
  roundToFrame,
  setClipSpeed,
  TRANSITION_INFO,
  trimClip,
  validateMoves,
  type AnimationType,
  type AssetDTO,
  type AudibleClip,
  type Clip,
  type Filters,
  type LoopType,
  type ProjectDoc,
  type Track,
  type TransitionType,
  type VisualClip,
} from '@vep/core';
import clsx from 'clsx';
import { RotateCcw, Unlink } from 'lucide-react';
import { Button, IconButton } from '../../ui/Button';
import { Field, NumberField, Section, Select, SliderField, Toggle } from '../../ui/fields';
import { toast } from '../../ui/toast';
import { applyTransition, detachAudioFromClip } from '../actions';
import { editor, getAssetLookup, useEditor } from '../store/editorStore';
import { updateClip } from './shared';

export function TimingSection({ clip }: { clip: Clip }) {
  const fps = useEditor((s) => s.doc.settings.fps);
  const setStart = (value: number) => {
    const start = roundToFrame(Math.max(0, value), fps);
    const state = useEditor.getState();
    const loc = findClip(state.doc, clip.id);
    if (!loc) return;
    const move = [{ clipId: clip.id, start, trackId: loc.track.id }];
    if (!validateMoves(state.doc, move)) {
      toast.info('That position overlaps another clip on this track.');
      return;
    }
    editor.update((draft) => {
      const l = findClip(draft as ProjectDoc, clip.id);
      if (l) {
        l.clip.start = start;
        l.track.clips.sort((a, b) => a.start - b.start);
      }
    });
  };
  const setDuration = (value: number) => {
    editor.update((draft) => {
      trimClip(
        draft as ProjectDoc,
        clip.id,
        'end',
        clip.start + Math.max(1 / fps, value),
        getAssetLookup(),
      );
    });
  };

  return (
    <Section title="Timing">
      <Field label="Start">
        <NumberField
          value={clip.start}
          onChange={setStart}
          min={0}
          step={1 / fps}
          precision={2}
          suffix="s"
          label="↔"
        />
      </Field>
      <Field label="Duration">
        <NumberField
          value={clip.duration}
          onChange={setDuration}
          min={1 / fps}
          step={1 / fps}
          precision={2}
          suffix="s"
          label="↔"
        />
      </Field>
      <Field label="End">
        <span className="text-xs text-muted tabular-nums">{clipEnd(clip).toFixed(2)} s</span>
      </Field>
      {(clip.type === 'video' || clip.type === 'audio') && (
        <Field label="Source in" hint="Where this clip starts in the source media">
          <span className="text-xs text-muted tabular-nums">{clip.trimStart.toFixed(2)} s</span>
        </Field>
      )}
    </Section>
  );
}

const SPEEDS = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 2, 4];

export function AudioSection({ clip, asset }: { clip: AudibleClip; asset: AssetDTO | undefined }) {
  const hasAudio = asset?.metadata?.hasAudio ?? false;
  return (
    <Section title={clip.type === 'video' ? 'Speed & audio' : 'Audio'}>
      <Field label="Speed">
        <div className="flex items-center gap-1">
          <Select
            className="flex-1"
            value={SPEEDS.includes(clip.speed) ? String(clip.speed) : 'custom'}
            onChange={(event) => {
              if (event.target.value === 'custom') return;
              const speed = Number(event.target.value);
              editor.update((draft) => {
                setClipSpeed(draft as ProjectDoc, clip.id, speed, getAssetLookup());
              });
            }}
          >
            {SPEEDS.map((s) => (
              <option key={s} value={s}>
                {s}×
              </option>
            ))}
            {!SPEEDS.includes(clip.speed) && <option value="custom">{clip.speed}×</option>}
          </Select>
          <NumberField
            className="w-20"
            value={clip.speed}
            min={0.1}
            max={16}
            step={0.05}
            precision={2}
            suffix="×"
            onChange={(speed) =>
              editor.update((draft) => {
                setClipSpeed(draft as ProjectDoc, clip.id, speed, getAssetLookup());
              })
            }
          />
        </div>
      </Field>
      {hasAudio ? (
        <>
          <Field label="Volume">
            <SliderField
              value={clip.volume}
              min={0}
              max={2}
              step={0.01}
              displayScale={100}
              suffix="%"
              onChange={(v) =>
                updateClip(
                  clip.id,
                  (c) => c.type !== 'image' && 'volume' in c && (c.volume = v),
                  'volume',
                )
              }
            />
          </Field>
          <Field label="Mute">
            <Toggle
              checked={clip.muted}
              label="Mute clip"
              onChange={(muted) => updateClip(clip.id, (c) => 'muted' in c && (c.muted = muted))}
            />
          </Field>
          <Field label="Fade in">
            <NumberField
              value={clip.fadeIn}
              min={0}
              max={clip.duration / 2}
              step={0.1}
              precision={2}
              suffix="s"
              label="↔"
              onChange={(v) =>
                updateClip(clip.id, (c) => 'fadeIn' in c && (c.fadeIn = v), 'fade-in')
              }
            />
          </Field>
          <Field label="Fade out">
            <NumberField
              value={clip.fadeOut}
              min={0}
              max={clip.duration / 2}
              step={0.1}
              precision={2}
              suffix="s"
              label="↔"
              onChange={(v) =>
                updateClip(clip.id, (c) => 'fadeOut' in c && (c.fadeOut = v), 'fade-out')
              }
            />
          </Field>
          {clip.type === 'video' && !clip.muted && (
            <Button
              size="sm"
              className="w-full"
              icon={<Unlink size={13} />}
              onClick={() => detachAudioFromClip(clip.id)}
            >
              Detach audio to its own track
            </Button>
          )}
        </>
      ) : (
        <p className="text-xs text-dim">This media has no audio.</p>
      )}
    </Section>
  );
}

const FILTER_SLIDERS: Array<{
  key: keyof Filters;
  label: string;
  min: number;
  max: number;
  step: number;
  scale: number;
  suffix: string;
}> = [
  { key: 'brightness', label: 'Brightness', min: 0, max: 2, step: 0.01, scale: 100, suffix: '%' },
  { key: 'contrast', label: 'Contrast', min: 0, max: 2, step: 0.01, scale: 100, suffix: '%' },
  { key: 'saturation', label: 'Saturation', min: 0, max: 3, step: 0.01, scale: 100, suffix: '%' },
  { key: 'hue', label: 'Hue', min: -180, max: 180, step: 1, scale: 1, suffix: '°' },
  { key: 'blur', label: 'Blur', min: 0, max: 40, step: 0.5, scale: 1, suffix: 'px' },
  { key: 'grayscale', label: 'Grayscale', min: 0, max: 1, step: 0.01, scale: 100, suffix: '%' },
  { key: 'sepia', label: 'Sepia', min: 0, max: 1, step: 0.01, scale: 100, suffix: '%' },
  { key: 'invert', label: 'Invert', min: 0, max: 1, step: 0.01, scale: 100, suffix: '%' },
  { key: 'vignette', label: 'Vignette', min: 0, max: 1, step: 0.01, scale: 100, suffix: '%' },
];

function cssPreviewFilter(filters: Partial<Filters>): string {
  const f = {
    brightness: 1,
    contrast: 1,
    saturation: 1,
    hue: 0,
    blur: 0,
    grayscale: 0,
    sepia: 0,
    invert: 0,
    ...filters,
  };
  return `brightness(${f.brightness}) contrast(${f.contrast}) saturate(${f.saturation}) hue-rotate(${f.hue}deg) grayscale(${f.grayscale}) sepia(${f.sepia}) invert(${f.invert}) blur(${Math.min(2, f.blur / 4)}px)`;
}

export function FiltersSection({ clip, asset }: { clip: VisualClip; asset: AssetDTO | undefined }) {
  const supportsMediaFilters = clip.type === 'video' || clip.type === 'image';
  const thumb = asset?.urls.thumbnail;
  return (
    <Section
      title="Filters"
      defaultOpen={supportsMediaFilters}
      actions={
        !filtersAreDefault(clip.filters) && (
          <IconButton
            size="xs"
            label="Reset filters"
            onClick={() =>
              updateClip(
                clip.id,
                (c) => c.type !== 'audio' && (c.filters = applyFilterPreset(FILTER_PRESETS[0]!)),
              )
            }
          >
            <RotateCcw size={12} />
          </IconButton>
        )
      }
    >
      {supportsMediaFilters && (
        <div className="grid grid-cols-4 gap-1.5">
          {FILTER_PRESETS.map((preset) => (
            <button
              key={preset.id}
              type="button"
              title={preset.label}
              onClick={() =>
                updateClip(
                  clip.id,
                  (c) => c.type !== 'audio' && (c.filters = applyFilterPreset(preset)),
                )
              }
              className="group flex flex-col items-center gap-1"
            >
              <div className="relative aspect-square w-full overflow-hidden rounded-md border border-line group-hover:border-accent">
                {thumb ? (
                  <img
                    src={thumb}
                    alt=""
                    className="h-full w-full object-cover"
                    style={{ filter: cssPreviewFilter(preset.filters) }}
                  />
                ) : (
                  <div
                    className="h-full w-full bg-gradient-to-br from-orange-400 via-pink-500 to-indigo-500"
                    style={{ filter: cssPreviewFilter(preset.filters) }}
                  />
                )}
                {(preset.filters.vignette ?? 0) > 0 && (
                  <div className="absolute inset-0 bg-[radial-gradient(circle,transparent_40%,#000c_100%)]" />
                )}
              </div>
              <span className="w-full truncate text-center text-[9.5px] text-muted group-hover:text-fg">
                {preset.label}
              </span>
            </button>
          ))}
        </div>
      )}
      {FILTER_SLIDERS.filter((s) => supportsMediaFilters || s.key !== 'vignette').map((s) => (
        <Field key={s.key} label={s.label}>
          <SliderField
            value={clip.filters[s.key]}
            min={s.min}
            max={s.max}
            step={s.step}
            displayScale={s.scale}
            suffix={s.suffix}
            onChange={(v) =>
              updateClip(
                clip.id,
                (c) => c.type !== 'audio' && (c.filters[s.key] = v),
                `filter-${s.key}`,
              )
            }
          />
        </Field>
      ))}
      <Field label="Blend">
        <Select
          value={clip.blendMode}
          onChange={(event) =>
            updateClip(
              clip.id,
              (c) =>
                c.type !== 'audio' && (c.blendMode = event.target.value as VisualClip['blendMode']),
            )
          }
        >
          {BLEND_MODES.map((mode) => (
            <option key={mode} value={mode}>
              {mode === 'normal'
                ? 'Normal'
                : mode.replace(/-/g, ' ').replace(/^\w/, (c) => c.toUpperCase())}
            </option>
          ))}
        </Select>
      </Field>
    </Section>
  );
}

export function AnimationSection({ clip }: { clip: VisualClip }) {
  const options = ANIMATION_INFO.filter((a) => !a.textOnly || clip.type === 'text');
  const animationField = (which: 'animationIn' | 'animationOut', label: string) => {
    const current = clip[which];
    return (
      <Field label={label}>
        <div className="flex items-center gap-1">
          <Select
            className="flex-1"
            value={current?.type ?? ''}
            onChange={(event) => {
              const type = event.target.value as AnimationType | '';
              updateClip(clip.id, (c) => {
                if (c.type === 'audio') return;
                c[which] = type
                  ? { type, duration: Math.min(current?.duration ?? 0.6, c.duration) }
                  : null;
              });
            }}
            aria-label={label}
          >
            <option value="">None</option>
            {options.map((a) => (
              <option key={a.type} value={a.type}>
                {a.label}
              </option>
            ))}
          </Select>
          {current && (
            <NumberField
              className="w-[72px]"
              value={current.duration}
              min={0.05}
              max={Math.min(30, clip.duration)}
              step={0.05}
              precision={2}
              suffix="s"
              onChange={(duration) =>
                updateClip(
                  clip.id,
                  (c) => c.type !== 'audio' && c[which] && (c[which]!.duration = duration),
                  `${which}-dur`,
                )
              }
            />
          )}
        </div>
      </Field>
    );
  };
  return (
    <Section title="Animation">
      {animationField('animationIn', 'In')}
      {animationField('animationOut', 'Out')}
      <Field label="Motion">
        <div className="flex items-center gap-1">
          <Select
            className="flex-1"
            value={clip.loop?.type ?? ''}
            onChange={(event) => {
              const type = event.target.value as LoopType | '';
              updateClip(clip.id, (c) => {
                if (c.type === 'audio') return;
                c.loop = type ? { type, intensity: c.loop?.intensity ?? 1 } : null;
              });
            }}
            aria-label="Motion"
          >
            <option value="">None</option>
            {LOOP_INFO.map((l) => (
              <option key={l.type} value={l.type}>
                {l.label}
              </option>
            ))}
          </Select>
          {clip.loop && (
            <NumberField
              className="w-[72px]"
              value={clip.loop.intensity}
              min={0}
              max={2}
              step={0.05}
              displayScale={100}
              suffix="%"
              title="Intensity"
              onChange={(intensity) =>
                updateClip(
                  clip.id,
                  (c) => c.type !== 'audio' && c.loop && (c.loop.intensity = intensity),
                  'loop-intensity',
                )
              }
            />
          )}
        </div>
      </Field>
    </Section>
  );
}

export function TransitionField({ clip, track }: { clip: VisualClip; track: Track }) {
  if (!canHaveTransition(track, clip)) return null;
  const transition = clip.transitionIn;
  return (
    <Section title="Transition in">
      <Field label="Type">
        <Select
          value={transition?.type ?? ''}
          onChange={(event) => {
            const type = event.target.value as TransitionType | '';
            if (!type) {
              updateClip(clip.id, (c) => c.type !== 'audio' && (c.transitionIn = null));
              return;
            }
            applyTransition(clip.id, type, transition?.duration ?? 1);
            editor.select([clip.id]);
          }}
        >
          <option value="">None (cut)</option>
          {TRANSITION_INFO.map((t) => (
            <option key={t.type} value={t.type}>
              {t.label}
            </option>
          ))}
        </Select>
      </Field>
      {transition && (
        <Field label="Duration">
          <NumberField
            value={transition.duration}
            min={0.1}
            max={10}
            step={0.05}
            precision={2}
            suffix="s"
            label="↔"
            onChange={(duration) => applyTransition(clip.id, transition.type, duration)}
          />
        </Field>
      )}
    </Section>
  );
}

export function ClipHeader({ clip, track }: { clip: Clip; track: Track }) {
  const typeLabel = {
    video: 'Video',
    audio: 'Audio',
    image: 'Image',
    text: 'Text',
    shape: 'Shape',
  }[clip.type];
  return (
    <div className="border-b border-line px-3 py-3">
      <div className="mb-2 flex items-center gap-2">
        <span
          className={clsx(
            'rounded px-1.5 py-0.5 text-[10px] font-semibold tracking-wide text-white uppercase',
            {
              video: 'bg-clip-video',
              audio: 'bg-clip-audio',
              image: 'bg-clip-image',
              text: 'bg-clip-text',
              shape: 'bg-clip-shape',
            }[clip.type],
          )}
        >
          {typeLabel}
        </span>
        <span className="truncate text-[11px] text-dim">on {track.name}</span>
        {track.locked && <span className="text-[11px] text-amber-400">· locked</span>}
      </div>
      <input
        className="h-8 w-full rounded-md border border-transparent bg-transparent px-1.5 text-[14px] font-semibold text-fg outline-none hover:border-line focus:border-accent focus:bg-panel-2"
        value={clip.name}
        maxLength={200}
        aria-label="Clip name"
        onChange={(event) => updateClip(clip.id, (c) => (c.name = event.target.value), 'name')}
        onKeyDown={(event) => {
          event.stopPropagation();
          if (event.key === 'Enter') (event.target as HTMLInputElement).blur();
        }}
      />
    </div>
  );
}
