import {
  canHaveTransition,
  findClip,
  isVisualClip,
  TRANSITION_INFO,
  type TransitionType,
} from '@vep/core';
import clsx from 'clsx';
import { toast } from '../../ui/toast';
import { applyTransition } from '../actions';
import { useEditor } from '../store/editorStore';
import { DRAG_MIME, setDragPayload } from '../timeline/constants';
import { PanelHeader } from './LeftPanel';

/** CSS keyframe animation class names (defined in transitions.css) per transition type. */
const PREVIEW_CLASS: Record<TransitionType, string> = {
  fade: 'tp-fade',
  fadeblack: 'tp-dip',
  fadewhite: 'tp-dip-white',
  wipeleft: 'tp-wipe-left',
  wiperight: 'tp-wipe-right',
  wipeup: 'tp-wipe-up',
  wipedown: 'tp-wipe-down',
  slideleft: 'tp-slide-left',
  slideright: 'tp-slide-right',
  slideup: 'tp-slide-up',
  slidedown: 'tp-slide-down',
  circleopen: 'tp-circle-open',
  circleclose: 'tp-circle-close',
  radial: 'tp-fade',
  zoomin: 'tp-zoom',
  blur: 'tp-blur',
};

export function TransitionsPanel() {
  const selectedClipId = useEditor((s) =>
    s.selection.length === 1 ? s.selection[0]! : s.selectedTransition,
  );

  const apply = (type: TransitionType) => {
    const state = useEditor.getState();
    const loc = selectedClipId ? findClip(state.doc, selectedClipId) : null;
    if (!loc || !isVisualClip(loc.clip) || !canHaveTransition(loc.track, loc.clip)) {
      toast.info(
        'Select a clip that starts right where another clip ends, or drag the transition onto a cut.',
      );
      return;
    }
    applyTransition(loc.clip.id, type);
  };

  const categories = [...new Set(TRANSITION_INFO.map((t) => t.category))];
  return (
    <div>
      <PanelHeader title="Transitions" />
      <div className="space-y-4 p-3">
        <p className="text-xs leading-relaxed text-muted">
          Drag a transition onto the cut between two clips, or select the second clip and click a
          transition.
        </p>
        {categories.map((category) => (
          <div key={category}>
            <p className="mb-2 text-[11px] font-semibold tracking-wide text-dim uppercase">
              {category}
            </p>
            <div className="grid grid-cols-3 gap-2">
              {TRANSITION_INFO.filter((t) => t.category === category).map((t) => (
                <button
                  key={t.type}
                  type="button"
                  draggable
                  onDragStart={(event) => {
                    event.dataTransfer.setData(
                      DRAG_MIME,
                      JSON.stringify({ kind: 'transition', type: t.type }),
                    );
                    event.dataTransfer.effectAllowed = 'copy';
                    setDragPayload({ kind: 'transition', type: t.type });
                  }}
                  onDragEnd={() => setDragPayload(null)}
                  onClick={() => apply(t.type)}
                  className="group flex flex-col items-center gap-1.5 rounded-lg p-1 text-center hover:bg-panel-3"
                  title={t.label}
                >
                  <div className="relative aspect-video w-full overflow-hidden rounded-md border border-line">
                    <div className="tp-a absolute inset-0" />
                    <div className={clsx('tp-b absolute inset-0', PREVIEW_CLASS[t.type])} />
                  </div>
                  <span className="text-[10.5px] leading-tight text-muted group-hover:text-fg">
                    {t.label}
                  </span>
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
