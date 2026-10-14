import { getMediaBaseSize, type AnimatableProp, type ProjectDoc, type VisualClip } from '@vep/core';
import { FlipHorizontal2, FlipVertical2, RotateCcw } from 'lucide-react';
import { Button, IconButton } from '../../ui/Button';
import { Field, NumberField, Section } from '../../ui/fields';
import { editor, getAssetLookup, setAnimatedProp, useEditor } from '../store/editorStore';
import { KeyframeButton, KeyframeNav, updateClip, useAnimatedValue } from './shared';

interface PropSpec {
  prop: AnimatableProp;
  label: string;
  step: number;
  min?: number;
  max?: number;
  displayScale?: number;
  precision?: number;
  suffix?: string;
}

const PROPS: PropSpec[] = [
  { prop: 'x', label: 'X', step: 1, suffix: 'px' },
  { prop: 'y', label: 'Y', step: 1, suffix: 'px' },
  { prop: 'scale', label: 'Scale', step: 0.01, min: 0, max: 50, displayScale: 100, suffix: '%' },
  {
    prop: 'rotation',
    label: 'Rotation',
    step: 1,
    min: -3600,
    max: 3600,
    precision: 1,
    suffix: '°',
  },
  { prop: 'opacity', label: 'Opacity', step: 0.01, min: 0, max: 1, displayScale: 100, suffix: '%' },
];

function PropRow({ clip, spec }: { clip: VisualClip; spec: PropSpec }) {
  const value = useAnimatedValue(clip, spec.prop);
  return (
    <Field label={spec.label}>
      <div className="flex items-center gap-1">
        <NumberField
          className="flex-1"
          value={value}
          onChange={(v) => {
            const time = useEditor.getState().currentTime;
            editor.update((draft) => setAnimatedProp(draft, clip.id, spec.prop, v, time), {
              history: `${clip.id}:${spec.prop}`,
            });
          }}
          step={spec.step}
          min={spec.min}
          max={spec.max}
          displayScale={spec.displayScale}
          precision={spec.precision ?? 0}
          suffix={spec.suffix}
          label="↔"
          testId={`prop-${spec.prop}`}
        />
        <KeyframeButton clip={clip} prop={spec.prop} />
      </div>
    </Field>
  );
}

export function TransformSection({ clip }: { clip: VisualClip }) {
  const doc = useEditor((s) => s.doc);
  const assets = useEditor((s) => s.assets);
  const isMedia = clip.type === 'video' || clip.type === 'image';

  const fill = () => {
    if (!isMedia) return;
    const asset = getAssetLookup(assets)(clip.assetId);
    const base = getMediaBaseSize(clip, asset, doc.settings);
    const cover = Math.max(doc.settings.width / base.width, doc.settings.height / base.height);
    updateClip(clip.id, (c) => {
      if (c.type === 'audio') return;
      delete c.keyframes.scale;
      delete c.keyframes.x;
      delete c.keyframes.y;
      c.transform.scale = Number(cover.toFixed(4));
      c.transform.x = 0;
      c.transform.y = 0;
    });
  };

  const reset = () =>
    updateClip(clip.id, (c) => {
      if (c.type === 'audio') return;
      c.keyframes = {};
      c.transform = { x: 0, y: 0, scale: 1, rotation: 0, opacity: 1, flipH: false, flipV: false };
    });

  return (
    <Section title="Transform" actions={<KeyframeNav clip={clip} />}>
      {PROPS.map((spec) => (
        <PropRow key={spec.prop} clip={clip} spec={spec} />
      ))}
      <Field label="Flip">
        <div className="flex items-center gap-1">
          <IconButton
            label="Flip horizontally"
            active={clip.transform.flipH}
            onClick={() =>
              updateClip(
                clip.id,
                (c) => c.type !== 'audio' && (c.transform.flipH = !c.transform.flipH),
              )
            }
          >
            <FlipHorizontal2 size={14} />
          </IconButton>
          <IconButton
            label="Flip vertically"
            active={clip.transform.flipV}
            onClick={() =>
              updateClip(
                clip.id,
                (c) => c.type !== 'audio' && (c.transform.flipV = !c.transform.flipV),
              )
            }
          >
            <FlipVertical2 size={14} />
          </IconButton>
          <div className="flex-1" />
          {isMedia && (
            <>
              <Button size="sm" variant="ghost" onClick={reset} title="Fit inside the frame">
                Fit
              </Button>
              <Button size="sm" variant="ghost" onClick={fill} title="Fill the frame (crops edges)">
                Fill
              </Button>
            </>
          )}
          <IconButton label="Reset transform" onClick={reset}>
            <RotateCcw size={13} />
          </IconButton>
        </div>
      </Field>
    </Section>
  );
}

export function CropSection({
  clip,
}: {
  clip: VisualClip & { crop: { top: number; right: number; bottom: number; left: number } };
}) {
  const sides = ['top', 'right', 'bottom', 'left'] as const;
  return (
    <Section title="Crop" defaultOpen={false}>
      <div className="grid grid-cols-2 gap-2">
        {sides.map((side) => (
          <NumberField
            key={side}
            label={side[0]!.toUpperCase()}
            value={clip.crop[side]}
            min={0}
            max={0.9}
            step={0.005}
            displayScale={100}
            precision={1}
            suffix="%"
            onChange={(v) =>
              updateClip(
                clip.id,
                (c) => {
                  if (c.type !== 'video' && c.type !== 'image') return;
                  const opposite =
                    side === 'top'
                      ? 'bottom'
                      : side === 'bottom'
                        ? 'top'
                        : side === 'left'
                          ? 'right'
                          : 'left';
                  c.crop[side] = Math.min(v, 0.95 - c.crop[opposite]);
                },
                `crop-${side}`,
              )
            }
          />
        ))}
      </div>
    </Section>
  );
}

export type { ProjectDoc };
