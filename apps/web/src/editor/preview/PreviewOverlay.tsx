import {
  clamp,
  evaluateProp,
  findClip,
  getClipBox,
  isVisualClip,
  layoutText,
  pointInClipBox,
  type ClipBox,
  type Ctx2D,
  type ProjectDoc,
  type TextClip,
  type VisualClip,
} from '@vep/core';
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
} from 'react';
import {
  editor,
  getAssetLookup,
  setAnimatedProp,
  useEditor,
  visualClipsAt,
} from '../store/editorStore';

const SNAP_PX = 6;

type DragState =
  | {
      kind: 'move';
      clipId: string;
      startX: number;
      startY: number;
      baseX: number;
      baseY: number;
      box: ClipBox;
      moved: boolean;
    }
  | { kind: 'scale'; clipId: string; cx: number; cy: number; startDist: number; baseScale: number }
  | {
      kind: 'rotate';
      clipId: string;
      cx: number;
      cy: number;
      startAngle: number;
      baseRotation: number;
    };

let measureCtx: Ctx2D | null = null;

/** A detached 2D context for text measurement (fonts are shared with the document). */
export function getMeasureCtx(): Ctx2D {
  if (!measureCtx)
    measureCtx = document.createElement('canvas').getContext('2d') as unknown as Ctx2D;
  return measureCtx;
}

function baseValues(clip: VisualClip, time: number) {
  const local = clamp(time - clip.start, 0, clip.duration);
  return {
    x: evaluateProp(clip.transform, clip.keyframes, 'x', local),
    y: evaluateProp(clip.transform, clip.keyframes, 'y', local),
    scale: evaluateProp(clip.transform, clip.keyframes, 'scale', local),
    rotation: evaluateProp(clip.transform, clip.keyframes, 'rotation', local),
  };
}

function isLocked(doc: ProjectDoc, clipId: string): boolean {
  return findClip(doc, clipId)?.track.locked ?? true;
}

export function PreviewOverlay({
  stageRef,
  stageWidth,
  stageHeight,
}: {
  stageRef: RefObject<HTMLDivElement | null>;
  stageWidth: number;
  stageHeight: number;
}) {
  const doc = useEditor((s) => s.doc);
  const assets = useEditor((s) => s.assets);
  const time = useEditor((s) => s.currentTime);
  const selection = useEditor((s) => s.selection);
  const playing = useEditor((s) => s.playing);
  const editingTextId = useEditor((s) => s.editingTextId);
  const [guides, setGuides] = useState({ x: false, y: false });
  const drag = useRef<DragState | null>(null);
  const frame = doc.settings;
  const scale = stageWidth > 0 ? stageWidth / frame.width : 1;
  const scene = useMemo(() => ({ doc, assets: getAssetLookup(assets) }), [doc, assets]);

  const selectedClip = useMemo(() => {
    if (selection.length !== 1) return null;
    const loc = findClip(doc, selection[0]!);
    if (!loc || !isVisualClip(loc.clip) || loc.track.hidden) return null;
    if (time < loc.clip.start || time >= loc.clip.start + loc.clip.duration) return null;
    return loc.clip;
  }, [doc, selection, time]);

  const box = selectedClip ? getClipBox(selectedClip, scene, time, getMeasureCtx()) : null;

  const toProject = (event: { clientX: number; clientY: number }) => {
    const rect = stageRef.current!.getBoundingClientRect();
    return { x: (event.clientX - rect.left) / scale, y: (event.clientY - rect.top) / scale };
  };

  const hitTest = (x: number, y: number): VisualClip | null => {
    for (const clip of visualClipsAt(doc, time)) {
      if (pointInClipBox(getClipBox(clip, scene, time, getMeasureCtx()), x, y)) return clip;
    }
    return null;
  };

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 || editingTextId) return;
    const p = toProject(event);
    const hit = hitTest(p.x, p.y);
    if (!hit) {
      editor.clearSelection();
      return;
    }
    if (event.shiftKey) {
      editor.select([hit.id], 'toggle');
      return;
    }
    if (!selection.includes(hit.id) || selection.length > 1) editor.select([hit.id]);
    if (isLocked(doc, hit.id)) return;
    if (playing) editor.pause();
    const base = baseValues(hit, time);
    drag.current = {
      kind: 'move',
      clipId: hit.id,
      startX: p.x,
      startY: p.y,
      baseX: base.x,
      baseY: base.y,
      box: getClipBox(hit, scene, time, getMeasureCtx()),
      moved: false,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
    editor.beginTransaction();
  };

  const startHandleDrag = (event: ReactPointerEvent<HTMLElement>, kind: 'scale' | 'rotate') => {
    if (!selectedClip || !box || event.button !== 0) return;
    event.stopPropagation();
    if (isLocked(doc, selectedClip.id)) return;
    const p = toProject(event);
    const base = baseValues(selectedClip, time);
    if (kind === 'scale') {
      drag.current = {
        kind,
        clipId: selectedClip.id,
        cx: box.cx,
        cy: box.cy,
        startDist: Math.max(1, Math.hypot(p.x - box.cx, p.y - box.cy)),
        baseScale: base.scale,
      };
    } else {
      drag.current = {
        kind,
        clipId: selectedClip.id,
        cx: box.cx,
        cy: box.cy,
        startAngle: Math.atan2(p.y - box.cy, p.x - box.cx),
        baseRotation: base.rotation,
      };
    }
    stageRef.current
      ?.querySelector<HTMLElement>('[data-overlay]')
      ?.setPointerCapture(event.pointerId);
    editor.beginTransaction();
  };

  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d) return;
    const p = toProject(event);
    const t = useEditor.getState().currentTime;
    if (d.kind === 'move') {
      let x = d.baseX + (p.x - d.startX);
      let y = d.baseY + (p.y - d.startY);
      if (!d.moved && Math.hypot(p.x - d.startX, p.y - d.startY) * scale < 2) return;
      d.moved = true;
      const threshold = SNAP_PX / scale;
      const halfW = Math.abs(d.box.width) / 2;
      const halfH = Math.abs(d.box.height) / 2;
      // Offset between the clip's base position and its drawn position (animations).
      const offX = d.box.cx - frame.width / 2 - d.baseX;
      const offY = d.box.cy - frame.height / 2 - d.baseY;
      let snapX = false;
      let snapY = false;
      if (!event.altKey) {
        const cx = x + offX;
        const cy = y + offY;
        const xTargets = [0, -frame.width / 2 + halfW, frame.width / 2 - halfW];
        const yTargets = [0, -frame.height / 2 + halfH, frame.height / 2 - halfH];
        for (const target of xTargets) {
          if (Math.abs(cx - target) < threshold) {
            x = target - offX;
            snapX = target === 0;
            break;
          }
        }
        for (const target of yTargets) {
          if (Math.abs(cy - target) < threshold) {
            y = target - offY;
            snapY = target === 0;
            break;
          }
        }
      }
      setGuides({ x: snapX, y: snapY });
      editor.updateFromBase((draft) => {
        setAnimatedProp(draft, d.clipId, 'x', Math.round(x), t);
        setAnimatedProp(draft, d.clipId, 'y', Math.round(y), t);
      });
    } else if (d.kind === 'scale') {
      let s = (d.baseScale * Math.hypot(p.x - d.cx, p.y - d.cy)) / d.startDist;
      if (Math.abs(s - 1) < 0.03 && !event.altKey) s = 1;
      s = clamp(Number(s.toFixed(3)), 0.01, 50);
      editor.updateFromBase((draft) => setAnimatedProp(draft, d.clipId, 'scale', s, t));
    } else {
      const angle = Math.atan2(p.y - d.cy, p.x - d.cx);
      let r = d.baseRotation + ((angle - d.startAngle) * 180) / Math.PI;
      if (event.shiftKey) r = Math.round(r / 15) * 15;
      else {
        const nearest = Math.round(r / 90) * 90;
        if (Math.abs(r - nearest) < 2) r = nearest;
      }
      editor.updateFromBase((draft) =>
        setAnimatedProp(draft, d.clipId, 'rotation', Number(r.toFixed(1)), t),
      );
    }
  };

  const endDrag = () => {
    if (!drag.current) return;
    drag.current = null;
    setGuides({ x: false, y: false });
    editor.commitTransaction();
  };

  const onDoubleClick = (event: ReactMouseEvent<HTMLDivElement>) => {
    const p = toProject(event);
    const hit = hitTest(p.x, p.y);
    if (hit?.type === 'text' && !isLocked(doc, hit.id)) {
      editor.select([hit.id]);
      editor.pause();
      useEditor.setState({ editingTextId: hit.id });
    }
  };

  useEffect(() => {
    if (!editingTextId) return;
    const loc = findClip(doc, editingTextId);
    if (!loc || time < loc.clip.start || time >= loc.clip.start + loc.clip.duration) {
      useEditor.setState({ editingTextId: null });
    }
  }, [doc, editingTextId, time]);

  const editingClip =
    editingTextId && selectedClip?.id === editingTextId && selectedClip.type === 'text'
      ? selectedClip
      : null;

  return (
    <div
      data-overlay
      className="absolute inset-0 touch-none overflow-hidden"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      onDoubleClick={onDoubleClick}
      style={{ width: stageWidth, height: stageHeight }}
    >
      {guides.x && (
        <div className="pointer-events-none absolute top-0 bottom-0 left-1/2 w-px bg-pink-500" />
      )}
      {guides.y && (
        <div className="pointer-events-none absolute top-1/2 right-0 left-0 h-px bg-pink-500" />
      )}
      {box && !editingClip && (
        <div
          className="pointer-events-none absolute"
          style={{
            left: box.cx * scale,
            top: box.cy * scale,
            width: Math.abs(box.width) * scale,
            height: Math.abs(box.height) * scale,
            transform: `translate(-50%, -50%) rotate(${box.rotation}deg)`,
          }}
          data-testid="transform-box"
        >
          <div className="absolute inset-0 outline outline-1 outline-accent" />
          {!isLocked(doc, selectedClip!.id) && (
            <>
              {(['nw', 'ne', 'sw', 'se'] as const).map((corner) => (
                <span
                  key={corner}
                  className="pointer-events-auto absolute h-2.5 w-2.5 rounded-[2px] border border-accent bg-white"
                  style={{
                    left: corner.includes('w') ? -5 : undefined,
                    right: corner.includes('e') ? -5 : undefined,
                    top: corner.includes('n') ? -5 : undefined,
                    bottom: corner.includes('s') ? -5 : undefined,
                    cursor: corner === 'nw' || corner === 'se' ? 'nwse-resize' : 'nesw-resize',
                  }}
                  onPointerDown={(event) => startHandleDrag(event, 'scale')}
                />
              ))}
              <span className="absolute -top-6 left-1/2 h-5 w-px -translate-x-1/2 bg-accent" />
              <span
                className="pointer-events-auto absolute -top-8 left-1/2 h-3 w-3 -translate-x-1/2 cursor-grab rounded-full border border-accent bg-white"
                title="Rotate (Shift snaps to 15°)"
                onPointerDown={(event) => startHandleDrag(event, 'rotate')}
              />
            </>
          )}
        </div>
      )}
      {editingClip && box && <InlineTextEditor clip={editingClip} box={box} scale={scale} />}
    </div>
  );
}

function InlineTextEditor({ clip, box, scale }: { clip: TextClip; box: ClipBox; scale: number }) {
  const [value, setValue] = useState(clip.text);
  const ref = useRef<HTMLTextAreaElement>(null);
  const done = useRef(false);
  const style = clip.style;
  const effective = scale * box.state.scale;
  const layout = layoutText(getMeasureCtx(), value || ' ', style);

  useEffect(() => {
    ref.current?.focus();
    ref.current?.select();
  }, []);

  const finish = (commit: boolean) => {
    if (done.current) return;
    done.current = true;
    if (commit && value !== clip.text) {
      editor.update((draft) => {
        const loc = findClip(draft as ProjectDoc, clip.id);
        if (loc?.clip.type === 'text') {
          loc.clip.text = value;
          loc.clip.name = value.split('\n')[0]!.slice(0, 60) || 'Text';
        }
      });
    }
    useEditor.setState({ editingTextId: null });
  };

  return (
    <textarea
      ref={ref}
      value={value}
      spellCheck={false}
      aria-label="Edit text"
      onChange={(event) => setValue(event.target.value)}
      onBlur={() => finish(true)}
      onPointerDown={(event) => event.stopPropagation()}
      onKeyDown={(event) => {
        event.stopPropagation();
        if (event.key === 'Escape') finish(false);
        if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) finish(true);
      }}
      className="absolute resize-none overflow-hidden border-none bg-transparent p-0 outline outline-1 outline-dashed outline-accent"
      style={{
        left: box.cx * scale,
        top: box.cy * scale,
        width: (layout.textWidth + style.fontSize) * effective,
        height: layout.textHeight * effective + 4,
        transform: `translate(-50%, -50%) rotate(${box.rotation}deg)`,
        fontFamily: `"${style.fontFamily}", sans-serif`,
        fontWeight: style.fontWeight,
        fontStyle: style.italic ? 'italic' : 'normal',
        fontSize: style.fontSize * effective,
        lineHeight: style.lineHeight,
        letterSpacing: style.letterSpacing * effective,
        textTransform: style.uppercase ? 'uppercase' : 'none',
        textAlign: style.align,
        color: style.color.slice(0, 7),
        caretColor: '#fff',
        whiteSpace: 'pre',
      }}
    />
  );
}
