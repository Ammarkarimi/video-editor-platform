import {
  ANIMATABLE_PROP_LIST,
  EASINGS,
  findFontFamily,
  FONT_CATALOG,
  type Easing,
  type ShapeClip,
  type TextClip,
  type TextStyle,
  type VisualClip,
} from '@vep/core';
import clsx from 'clsx';
import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  CaseUpper,
  ChevronDown,
  Italic,
  Trash2,
} from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { IconButton } from '../../ui/Button';
import {
  ColorField,
  Field,
  NumberField,
  Section,
  Segmented,
  Select,
  Toggle,
} from '../../ui/fields';
import { fontLoader } from '../engine/fonts';
import { editor, useEditor } from '../store/editorStore';
import { updateClip } from './shared';

const WEIGHT_NAMES: Record<number, string> = {
  100: 'Thin',
  200: 'Extra light',
  300: 'Light',
  400: 'Regular',
  500: 'Medium',
  600: 'Semibold',
  700: 'Bold',
  800: 'Extra bold',
  900: 'Black',
};

function setStyle<K extends keyof TextStyle>(
  clipId: string,
  key: K,
  value: TextStyle[K],
  merge = true,
): void {
  updateClip(
    clipId,
    (c) => {
      if (c.type === 'text') c.style[key] = value;
    },
    merge ? `style-${key}` : undefined,
  );
}

function FontPicker({ value, onChange }: { value: string; onChange: (family: string) => void }) {
  const [open, setOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const [rect, setRect] = useState<DOMRect | null>(null);

  useEffect(() => {
    fontLoader.ensureFamily(value);
  }, [value]);

  useEffect(() => {
    if (!open) return;
    fontLoader.ensureAll();
    const close = (event: PointerEvent) => {
      if (!(event.target as HTMLElement).closest('[data-font-picker]')) setOpen(false);
    };
    window.addEventListener('pointerdown', close, true);
    return () => window.removeEventListener('pointerdown', close, true);
  }, [open]);

  const categories = [...new Set(FONT_CATALOG.map((f) => f.category))];
  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        data-font-picker
        onClick={() => {
          setRect(buttonRef.current?.getBoundingClientRect() ?? null);
          setOpen((o) => !o);
        }}
        className="flex h-8 w-full items-center justify-between rounded-md border border-line bg-panel-2 px-2 text-left text-[14px] hover:border-line-2"
        style={{ fontFamily: `"${value}", sans-serif` }}
      >
        <span className="truncate">{value}</span>
        <ChevronDown size={14} className="shrink-0 text-dim" />
      </button>
      {open &&
        rect &&
        createPortal(
          <div
            data-font-picker
            className="fixed z-[60] max-h-[360px] w-[260px] animate-pop-in overflow-y-auto rounded-lg border border-line bg-panel-2 p-1 shadow-xl shadow-black/50"
            style={{
              top: Math.min(rect.bottom + 4, window.innerHeight - 370),
              left: rect.right - 260,
            }}
          >
            {categories.map((category) => (
              <div key={category}>
                <p className="px-2 pt-2 pb-1 text-[10px] font-semibold tracking-wider text-dim uppercase">
                  {category}
                </p>
                {FONT_CATALOG.filter((f) => f.category === category).map((family) => (
                  <button
                    key={family.family}
                    type="button"
                    onClick={() => {
                      onChange(family.family);
                      setOpen(false);
                    }}
                    className={clsx(
                      'block w-full truncate rounded-md px-2 py-1.5 text-left text-[16px] hover:bg-panel-3',
                      family.family === value && 'bg-accent-soft text-accent-hover',
                    )}
                    style={{ fontFamily: `"${family.family}", sans-serif` }}
                  >
                    {family.family}
                  </button>
                ))}
              </div>
            ))}
          </div>,
          document.body,
        )}
    </>
  );
}

export function TextSection({ clip }: { clip: TextClip }) {
  const style = clip.style;
  const frameWidth = useEditor((s) => s.doc.settings.width);
  const family = findFontFamily(style.fontFamily);
  const faces = family?.faces ?? [];
  const weights = [
    ...new Set(
      faces.filter((f) => f.style === (style.italic ? 'italic' : 'normal')).map((f) => f.weight),
    ),
  ];
  const allWeights = weights.length > 0 ? weights : [...new Set(faces.map((f) => f.weight))];
  const hasItalic = faces.some((f) => f.style === 'italic');

  return (
    <>
      <Section title="Text">
        <textarea
          value={clip.text}
          rows={3}
          aria-label="Text content"
          className="w-full resize-y rounded-md border border-line bg-panel-2 px-2.5 py-2 text-[13px] text-fg outline-none focus:border-accent"
          onChange={(event) =>
            updateClip(
              clip.id,
              (c) => {
                if (c.type !== 'text') return;
                c.text = event.target.value;
                c.name = event.target.value.split('\n')[0]!.slice(0, 60) || 'Text';
              },
              'text',
            )
          }
          onKeyDown={(event) => event.stopPropagation()}
        />
        <FontPicker
          value={style.fontFamily}
          onChange={(fam) => {
            const info = findFontFamily(fam);
            updateClip(clip.id, (c) => {
              if (c.type !== 'text') return;
              c.style.fontFamily = fam;
              const available = info?.faces.map((f) => f.weight) ?? [400];
              if (!available.includes(c.style.fontWeight)) {
                c.style.fontWeight = available.reduce(
                  (best, w) =>
                    Math.abs(w - c.style.fontWeight) < Math.abs(best - c.style.fontWeight)
                      ? w
                      : best,
                  available[0]!,
                );
              }
              if (c.style.italic && !info?.faces.some((f) => f.style === 'italic'))
                c.style.italic = false;
            });
          }}
        />
        <div className="flex items-center gap-1.5">
          <Select
            className="flex-1"
            value={String(style.fontWeight)}
            onChange={(event) => setStyle(clip.id, 'fontWeight', Number(event.target.value), false)}
            aria-label="Font weight"
          >
            {allWeights.map((w) => (
              <option key={w} value={w}>
                {WEIGHT_NAMES[w] ?? w}
              </option>
            ))}
          </Select>
          <NumberField
            className="w-20"
            value={style.fontSize}
            min={4}
            max={2000}
            step={1}
            suffix="px"
            label="↕"
            onChange={(v) => setStyle(clip.id, 'fontSize', v)}
          />
          <IconButton
            label="Italic"
            active={style.italic}
            disabled={!hasItalic}
            onClick={() => setStyle(clip.id, 'italic', !style.italic, false)}
          >
            <Italic size={14} />
          </IconButton>
          <IconButton
            label="Uppercase"
            active={style.uppercase}
            onClick={() => setStyle(clip.id, 'uppercase', !style.uppercase, false)}
          >
            <CaseUpper size={15} />
          </IconButton>
        </div>
        <Field label="Color">
          <ColorField value={style.color} onChange={(v) => setStyle(clip.id, 'color', v)} alpha />
        </Field>
        <Field label="Align">
          <Segmented
            value={style.align}
            onChange={(v) => setStyle(clip.id, 'align', v, false)}
            options={[
              { value: 'left', label: <AlignLeft size={14} />, title: 'Align left' },
              { value: 'center', label: <AlignCenter size={14} />, title: 'Center' },
              { value: 'right', label: <AlignRight size={14} />, title: 'Align right' },
            ]}
          />
        </Field>
        <div className="grid grid-cols-2 gap-2">
          <NumberField
            label="Line"
            value={style.lineHeight}
            min={0.5}
            max={4}
            step={0.05}
            precision={2}
            suffix="×"
            onChange={(v) => setStyle(clip.id, 'lineHeight', v)}
          />
          <NumberField
            label="Spacing"
            value={style.letterSpacing}
            min={-50}
            max={200}
            step={0.5}
            precision={1}
            suffix="px"
            onChange={(v) => setStyle(clip.id, 'letterSpacing', v)}
          />
        </div>
        <Field label="Wrap">
          <div className="flex items-center gap-2">
            <Toggle
              checked={style.maxWidth > 0}
              label="Wrap text"
              onChange={(on) =>
                setStyle(clip.id, 'maxWidth', on ? Math.round(frameWidth * 0.8) : 0, false)
              }
            />
            {style.maxWidth > 0 && (
              <NumberField
                className="flex-1"
                value={style.maxWidth}
                min={20}
                max={20000}
                step={10}
                suffix="px"
                label="W"
                onChange={(v) => setStyle(clip.id, 'maxWidth', v)}
              />
            )}
          </div>
        </Field>
      </Section>

      <Section title="Outline & shadow" defaultOpen={style.strokeWidth > 0 || style.shadowBlur > 0}>
        <Field label="Outline">
          <div className="flex items-center gap-2">
            <ColorField
              value={style.strokeColor}
              onChange={(v) => setStyle(clip.id, 'strokeColor', v)}
            />
            <NumberField
              className="w-16"
              value={style.strokeWidth}
              min={0}
              max={100}
              step={0.5}
              precision={1}
              onChange={(v) => setStyle(clip.id, 'strokeWidth', v)}
            />
          </div>
        </Field>
        <Field label="Shadow">
          <ColorField
            value={style.shadowColor}
            onChange={(v) => setStyle(clip.id, 'shadowColor', v)}
            alpha
          />
        </Field>
        <div className="grid grid-cols-3 gap-1.5">
          <NumberField
            label="Blur"
            value={style.shadowBlur}
            min={0}
            max={200}
            step={1}
            onChange={(v) => setStyle(clip.id, 'shadowBlur', v)}
          />
          <NumberField
            label="X"
            value={style.shadowOffsetX}
            min={-500}
            max={500}
            step={1}
            onChange={(v) => setStyle(clip.id, 'shadowOffsetX', v)}
          />
          <NumberField
            label="Y"
            value={style.shadowOffsetY}
            min={-500}
            max={500}
            step={1}
            onChange={(v) => setStyle(clip.id, 'shadowOffsetY', v)}
          />
        </div>
      </Section>

      <Section
        title="Background box"
        defaultOpen={style.backgroundColor.length === 9 && !style.backgroundColor.endsWith('00')}
      >
        <Field label="Color">
          <ColorField
            value={style.backgroundColor}
            onChange={(v) => setStyle(clip.id, 'backgroundColor', v)}
            alpha
          />
        </Field>
        <div className="grid grid-cols-2 gap-2">
          <NumberField
            label="Padding"
            value={style.backgroundPadding}
            min={0}
            max={500}
            step={1}
            onChange={(v) => setStyle(clip.id, 'backgroundPadding', v)}
          />
          <NumberField
            label="Radius"
            value={style.backgroundRadius}
            min={0}
            max={500}
            step={1}
            onChange={(v) => setStyle(clip.id, 'backgroundRadius', v)}
          />
        </div>
      </Section>
    </>
  );
}

export function ShapeSection({ clip }: { clip: ShapeClip }) {
  const set = <K extends keyof ShapeClip>(key: K, value: ShapeClip[K], merge = true) =>
    updateClip(
      clip.id,
      (c) => {
        if (c.type === 'shape') (c as ShapeClip)[key] = value;
      },
      merge ? `shape-${String(key)}` : undefined,
    );
  return (
    <Section title="Shape">
      <Field label="Type">
        <Segmented
          value={clip.shape}
          onChange={(v) => set('shape', v, false)}
          options={[
            { value: 'rectangle', label: 'Rectangle' },
            { value: 'ellipse', label: 'Ellipse' },
          ]}
        />
      </Field>
      <Field label="Fill">
        <ColorField value={clip.fill} onChange={(v) => set('fill', v)} alpha />
      </Field>
      <div className="grid grid-cols-2 gap-2">
        <NumberField
          label="W"
          value={clip.width}
          min={1}
          max={20000}
          step={1}
          suffix="px"
          onChange={(v) => set('width', v)}
        />
        <NumberField
          label="H"
          value={clip.height}
          min={1}
          max={20000}
          step={1}
          suffix="px"
          onChange={(v) => set('height', v)}
        />
      </div>
      {clip.shape === 'rectangle' && (
        <Field label="Corners">
          <NumberField
            value={clip.cornerRadius}
            min={0}
            max={10000}
            step={1}
            suffix="px"
            label="↔"
            onChange={(v) => set('cornerRadius', v)}
          />
        </Field>
      )}
      <Field label="Outline">
        <div className="flex items-center gap-2">
          <ColorField value={clip.strokeColor} onChange={(v) => set('strokeColor', v)} />
          <NumberField
            className="w-16"
            value={clip.strokeWidth}
            min={0}
            max={500}
            step={1}
            onChange={(v) => set('strokeWidth', v)}
          />
        </div>
      </Field>
    </Section>
  );
}

const PROP_LABELS = { x: 'X', y: 'Y', scale: 'Scale', rotation: 'Rotation', opacity: 'Opacity' };

export function KeyframesSection({ clip }: { clip: VisualClip }) {
  const rows = ANIMATABLE_PROP_LIST.flatMap((prop) =>
    (clip.keyframes[prop] ?? []).map((k, index) => ({ prop, index, k })),
  );
  if (rows.length === 0) return null;
  const format = (prop: string, value: number) =>
    prop === 'scale' || prop === 'opacity'
      ? `${Math.round(value * 100)}%`
      : prop === 'rotation'
        ? `${value.toFixed(1)}°`
        : `${Math.round(value)}`;
  return (
    <Section title={`Keyframes (${rows.length})`} defaultOpen={false}>
      <div className="space-y-1">
        {rows.map(({ prop, index, k }) => (
          <div key={`${prop}-${index}`} className="flex items-center gap-1.5 text-xs">
            <button
              type="button"
              className="w-14 text-left text-muted tabular-nums hover:text-fg"
              title="Go to keyframe"
              onClick={() => editor.seek(clip.start + k.time)}
            >
              {k.time.toFixed(2)}s
            </button>
            <span className="w-14 truncate text-fg">{PROP_LABELS[prop]}</span>
            <span className="w-12 truncate text-muted tabular-nums">{format(prop, k.value)}</span>
            <Select
              className="flex-1"
              value={k.easing}
              aria-label="Easing"
              onChange={(event) =>
                updateClip(clip.id, (c) => {
                  if (c.type === 'audio') return;
                  const list = c.keyframes[prop];
                  if (list?.[index]) list[index]!.easing = event.target.value as Easing;
                })
              }
            >
              {EASINGS.map((e) => (
                <option key={e} value={e}>
                  {e === 'easeInOut'
                    ? 'Ease in-out'
                    : e === 'easeIn'
                      ? 'Ease in'
                      : e === 'easeOut'
                        ? 'Ease out'
                        : e === 'hold'
                          ? 'Hold'
                          : 'Linear'}
                </option>
              ))}
            </Select>
            <IconButton
              size="xs"
              label="Delete keyframe"
              onClick={() =>
                updateClip(clip.id, (c) => {
                  if (c.type === 'audio') return;
                  const list = c.keyframes[prop];
                  if (!list) return;
                  list.splice(index, 1);
                  if (list.length === 0) {
                    c.transform[prop] = k.value;
                    delete c.keyframes[prop];
                  }
                })
              }
            >
              <Trash2 size={12} />
            </IconButton>
          </div>
        ))}
      </div>
    </Section>
  );
}
