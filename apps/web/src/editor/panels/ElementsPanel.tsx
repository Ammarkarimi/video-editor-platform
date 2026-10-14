import { SHAPE_PRESETS, toCssColor } from '@vep/core';
import { addShapeClip } from '../actions';
import { useEditor } from '../store/editorStore';
import { DRAG_MIME, setDragPayload } from '../timeline/constants';
import { PanelHeader } from './LeftPanel';

export function ElementsPanel() {
  const settings = useEditor((s) => s.doc.settings);
  return (
    <div>
      <PanelHeader title="Elements" />
      <div className="space-y-2 p-3">
        <p className="text-xs text-muted">
          Shapes and color layers. Click to add at the playhead or drag onto a track.
        </p>
        <div className="grid grid-cols-2 gap-2">
          {SHAPE_PRESETS.map((preset) => {
            const shape = preset.build(settings);
            const w = shape.width ?? settings.width / 2;
            const h = shape.height ?? settings.height / 2;
            const scale = Math.min(110 / settings.width, 62 / settings.height);
            return (
              <button
                key={preset.id}
                type="button"
                draggable
                onDragStart={(event) => {
                  event.dataTransfer.setData(
                    DRAG_MIME,
                    JSON.stringify({ kind: 'shape', presetId: preset.id }),
                  );
                  event.dataTransfer.effectAllowed = 'copy';
                  setDragPayload({ kind: 'shape', presetId: preset.id });
                }}
                onDragEnd={() => setDragPayload(null)}
                onClick={() => addShapeClip(preset)}
                className="group flex flex-col overflow-hidden rounded-lg border border-line bg-panel-2 hover:border-accent"
              >
                <div className="checker relative flex aspect-video items-center justify-center">
                  <div
                    style={{
                      width: w * scale,
                      height: h * scale,
                      background: toCssColor(shape.fill ?? '#6366f1'),
                      borderRadius:
                        shape.shape === 'ellipse' ? '50%' : (shape.cornerRadius ?? 0) * scale,
                      border: shape.strokeWidth
                        ? `${Math.max(1, shape.strokeWidth * scale)}px solid ${toCssColor(shape.strokeColor ?? '#fff')}`
                        : undefined,
                      transform: `translateY(${(shape.transform?.y ?? 0) * scale}px)`,
                    }}
                  />
                </div>
                <span className="px-2 py-1.5 text-left text-[11px] text-muted group-hover:text-fg">
                  {preset.label}
                </span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
