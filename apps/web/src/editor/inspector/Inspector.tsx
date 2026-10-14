import {
  ASPECT_PRESETS,
  findClip,
  formatDuration,
  FPS_PRESETS,
  getAllClips,
  getProjectDuration,
  isVisualClip,
  TRANSITION_INFO,
  transitionLabel,
  type ProjectDoc,
  type TransitionType,
} from '@vep/core';
import { CopyPlus, Trash2 } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { api } from '../../api/client';
import { Button } from '../../ui/Button';
import { ColorField, Field, NumberField, Section, Select, TextInput } from '../../ui/fields';
import { Kbd } from '../../ui/misc';
import { errorMessage, toast } from '../../ui/toast';
import { applyTransition, deleteSelection, duplicateSelection } from '../actions';
import { editor, useEditor } from '../store/editorStore';
import {
  AnimationSection,
  AudioSection,
  ClipHeader,
  FiltersSection,
  TimingSection,
  TransitionField,
} from './ClipSections';
import { KeyframesSection, ShapeSection, TextSection } from './TextShapeSections';
import { CropSection, TransformSection } from './TransformSection';

export function Inspector() {
  const selection = useEditor((s) => s.selection);
  const selectedTransition = useEditor((s) => s.selectedTransition);
  let content;
  if (selectedTransition) content = <TransitionInspector clipId={selectedTransition} />;
  else if (selection.length === 1)
    content = <ClipInspector key={selection[0]} clipId={selection[0]!} />;
  else if (selection.length > 1) content = <MultiInspector count={selection.length} />;
  else content = <ProjectInspector />;
  return (
    <aside
      className="w-[300px] shrink-0 overflow-y-auto border-l border-line bg-panel"
      data-testid="inspector"
    >
      {content}
    </aside>
  );
}

function ClipInspector({ clipId }: { clipId: string }) {
  const doc = useEditor((s) => s.doc);
  const assets = useEditor((s) => s.assets);
  const loc = useMemo(() => findClip(doc, clipId), [doc, clipId]);
  if (!loc) return null;
  const { clip, track } = loc;
  const asset = 'assetId' in clip ? assets.find((a) => a.id === clip.assetId) : undefined;
  return (
    <div className={track.locked ? 'pointer-events-none opacity-60' : undefined}>
      <ClipHeader clip={clip} track={track} />
      {clip.type === 'text' && <TextSection clip={clip} />}
      {clip.type === 'shape' && <ShapeSection clip={clip} />}
      {isVisualClip(clip) && <TransformSection clip={clip} />}
      {(clip.type === 'video' || clip.type === 'audio') && (
        <AudioSection clip={clip} asset={asset} />
      )}
      {isVisualClip(clip) && <AnimationSection clip={clip} />}
      {isVisualClip(clip) && <TransitionField clip={clip} track={track} />}
      {isVisualClip(clip) && <FiltersSection clip={clip} asset={asset} />}
      {(clip.type === 'video' || clip.type === 'image') && <CropSection clip={clip} />}
      {isVisualClip(clip) && <KeyframesSection clip={clip} />}
      <TimingSection clip={clip} />
    </div>
  );
}

function MultiInspector({ count }: { count: number }) {
  return (
    <div className="p-4">
      <h2 className="text-[14px] font-semibold">{count} clips selected</h2>
      <p className="mt-1 text-xs text-muted">
        Drag any of them on the timeline to move them together.
      </p>
      <div className="mt-4 flex gap-2">
        <Button size="sm" icon={<CopyPlus size={13} />} onClick={duplicateSelection}>
          Duplicate
        </Button>
        <Button
          size="sm"
          variant="danger"
          icon={<Trash2 size={13} />}
          onClick={() => deleteSelection()}
        >
          Delete
        </Button>
      </div>
    </div>
  );
}

function TransitionInspector({ clipId }: { clipId: string }) {
  const doc = useEditor((s) => s.doc);
  const loc = useMemo(() => findClip(doc, clipId), [doc, clipId]);
  if (!loc || !isVisualClip(loc.clip) || !loc.clip.transitionIn) return null;
  const transition = loc.clip.transitionIn;
  const prev = loc.track.clips.find((c) => Math.abs(c.start + c.duration - loc.clip.start) < 1e-3);
  return (
    <div>
      <div className="border-b border-line px-3 py-3">
        <span className="rounded bg-accent px-1.5 py-0.5 text-[10px] font-semibold tracking-wide text-white uppercase">
          Transition
        </span>
        <h2 className="mt-2 text-[14px] font-semibold">{transitionLabel(transition.type)}</h2>
        <p className="mt-0.5 truncate text-xs text-muted">
          {prev?.name ?? 'Previous clip'} → {loc.clip.name}
        </p>
      </div>
      <Section title="Settings">
        <Field label="Type">
          <Select
            value={transition.type}
            onChange={(event) =>
              applyTransition(clipId, event.target.value as TransitionType, transition.duration)
            }
          >
            {TRANSITION_INFO.map((t) => (
              <option key={t.type} value={t.type}>
                {t.label}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Duration">
          <NumberField
            value={transition.duration}
            min={0.1}
            max={10}
            step={0.05}
            precision={2}
            suffix="s"
            label="↔"
            onChange={(duration) => applyTransition(clipId, transition.type, duration)}
          />
        </Field>
        <p className="text-[11px] leading-relaxed text-dim">
          The transition is centered on the cut. It uses extra frames from the source media when
          available and holds the edge frame otherwise.
        </p>
        <Button
          size="sm"
          variant="danger"
          className="w-full"
          icon={<Trash2 size={13} />}
          onClick={() => deleteSelection()}
        >
          Remove transition
        </Button>
      </Section>
    </div>
  );
}

function ProjectInspector() {
  const doc = useEditor((s) => s.doc);
  const projectId = useEditor((s) => s.projectId);
  const projectName = useEditor((s) => s.projectName);
  const assetCount = useEditor((s) => s.assets.length);
  const [name, setName] = useState(projectName);
  useEffect(() => setName(projectName), [projectName]);
  const { width, height, fps, backgroundColor } = doc.settings;
  const preset = ASPECT_PRESETS.find((p) => Math.abs(p.width / p.height - width / height) < 0.01);
  const clips = getAllClips(doc).length;

  const setSettings = (patch: Partial<ProjectDoc['settings']>) =>
    editor.update((draft) => {
      Object.assign(draft.settings, patch);
    });

  const rename = async () => {
    const trimmed = name.trim();
    if (!trimmed || trimmed === projectName) {
      setName(projectName);
      return;
    }
    try {
      await api.renameProject(projectId, trimmed);
      useEditor.setState({ projectName: trimmed });
    } catch (err) {
      toast.error(errorMessage(err));
      setName(projectName);
    }
  };

  return (
    <div>
      <div className="border-b border-line px-3 py-3">
        <span className="text-[10px] font-semibold tracking-wider text-dim uppercase">Project</span>
        <TextInput
          className="mt-1.5 text-[14px] font-semibold"
          value={name}
          maxLength={120}
          aria-label="Project name"
          onChange={(event) => setName(event.target.value)}
          onBlur={() => void rename()}
          onKeyDown={(event) => {
            if (event.key === 'Enter') (event.target as HTMLInputElement).blur();
          }}
        />
      </div>
      <Section title="Canvas">
        <Field label="Format">
          <Select
            value={preset?.id ?? 'custom'}
            onChange={(event) => {
              const next = ASPECT_PRESETS.find((p) => p.id === event.target.value);
              if (!next) return;
              // Keep the current resolution class (e.g. 720p) while changing the shape.
              const short = Math.min(width, height);
              const aspect = next.width / next.height;
              const even = (v: number) => Math.max(2, Math.round(v / 2) * 2);
              setSettings(
                aspect >= 1
                  ? { width: even(short * aspect), height: even(short) }
                  : { width: even(short), height: even(short / aspect) },
              );
            }}
          >
            {ASPECT_PRESETS.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
            {!preset && <option value="custom">Custom</option>}
          </Select>
        </Field>
        <Field label="Size">
          <div className="flex items-center gap-1.5">
            <NumberField
              value={width}
              min={16}
              max={7680}
              step={2}
              onChange={(v) => setSettings({ width: Math.round(v / 2) * 2 })}
              label="W"
            />
            <NumberField
              value={height}
              min={16}
              max={7680}
              step={2}
              onChange={(v) => setSettings({ height: Math.round(v / 2) * 2 })}
              label="H"
            />
          </div>
        </Field>
        <Field label="Frame rate">
          <Select
            value={String(fps)}
            onChange={(event) => setSettings({ fps: Number(event.target.value) })}
          >
            {[...new Set([...FPS_PRESETS, fps])]
              .sort((a, b) => a - b)
              .map((f) => (
                <option key={f} value={f}>
                  {f} fps
                </option>
              ))}
          </Select>
        </Field>
        <Field label="Background">
          <ColorField
            value={backgroundColor}
            onChange={(v) => setSettings({ backgroundColor: v })}
          />
        </Field>
      </Section>
      <Section title="Overview">
        <Field label="Duration">
          <span className="text-xs tabular-nums">{formatDuration(getProjectDuration(doc))}</span>
        </Field>
        <Field label="Content">
          <span className="text-xs text-muted">
            {clips} clips · {doc.tracks.length} tracks · {assetCount} media
          </span>
        </Field>
      </Section>
      <Section title="Tips">
        <ul className="space-y-2 text-xs text-muted">
          <li>
            Select a clip to edit it here. <Kbd>S</Kbd> splits at the playhead.
          </li>
          <li>
            Drag on the preview to move, use the corner handles to scale and the top knob to rotate.
          </li>
          <li>Click the ◇ next to a property to animate it with keyframes.</li>
          <li>
            Press <Kbd>?</Kbd> to see all keyboard shortcuts.
          </li>
        </ul>
      </Section>
    </div>
  );
}
