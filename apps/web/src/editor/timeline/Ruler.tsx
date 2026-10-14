import type { Marker } from '@vep/core';
import { Trash2, Pencil } from 'lucide-react';
import { memo } from 'react';
import { useContextMenu } from '../../ui/Menu';
import { editor, useEditor } from '../store/editorStore';
import { RULER_HEIGHT } from './constants';
import { startMarkerDrag, startRangeDrag, startScrub } from './interactions';

const STEPS: Array<[number, number]> = [
  [0.1, 5],
  [0.25, 5],
  [0.5, 5],
  [1, 5],
  [2, 4],
  [5, 5],
  [10, 5],
  [15, 3],
  [30, 6],
  [60, 6],
  [120, 4],
  [300, 5],
  [600, 6],
  [1800, 6],
  [3600, 6],
];

function pickStep(zoom: number): [number, number] {
  return STEPS.find(([step]) => step * zoom >= 90) ?? STEPS[STEPS.length - 1]!;
}

function label(seconds: number, step: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds - m * 60;
  if (step < 1) return `${m}:${s.toFixed(1).padStart(4, '0')}`;
  const h = Math.floor(m / 60);
  const ss = String(Math.round(s)).padStart(2, '0');
  return h > 0 ? `${h}:${String(m % 60).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
}

export const Ruler = memo(function Ruler({
  zoom,
  width,
  viewLeft,
  viewRight,
}: {
  zoom: number;
  width: number;
  viewLeft: number;
  viewRight: number;
}) {
  const markers = useEditor((s) => s.doc.markers);
  const range = useEditor((s) => s.doc.range);
  const menu = useContextMenu();
  const [step, divisions] = pickStep(zoom);
  const minor = step / divisions;
  const first = Math.max(0, Math.floor(viewLeft / zoom / step) * step);
  const last = viewRight / zoom;

  const ticks: Array<{ t: number; major: boolean }> = [];
  for (let t = first; t <= last; t += minor) {
    const rounded = Math.round(t * 1000) / 1000;
    ticks.push({ t: rounded, major: Math.abs(rounded / step - Math.round(rounded / step)) < 1e-6 });
  }

  const renameMarker = (marker: Marker) => {
    const next = window.prompt('Marker label', marker.label);
    if (next === null) return;
    editor.update((draft) => {
      const m = draft.markers.find((x) => x.id === marker.id);
      if (m) m.label = next.slice(0, 200);
    });
  };

  return (
    <div
      className="relative cursor-pointer border-b border-line bg-panel select-none"
      style={{ width, height: RULER_HEIGHT }}
      onPointerDown={(event) => {
        if (event.button === 0) startScrub(event);
      }}
      data-testid="timeline-ruler"
    >
      {range && (
        <div
          className="absolute top-0 bottom-0 bg-accent/15"
          style={{ left: range.start * zoom, width: (range.end - range.start) * zoom }}
        >
          <div className="absolute inset-x-0 top-0 h-1 bg-accent/70" />
          {(['start', 'end'] as const).map((edge) => (
            <div
              key={edge}
              title={edge === 'start' ? 'In point' : 'Out point'}
              className="absolute top-0 bottom-0 w-1.5 cursor-ew-resize bg-accent"
              style={edge === 'start' ? { left: -1 } : { right: -1 }}
              onPointerDown={(event) => {
                event.stopPropagation();
                startRangeDrag(event, edge);
              }}
            />
          ))}
        </div>
      )}
      {ticks.map(({ t, major }) => (
        <div key={t} className="absolute bottom-0" style={{ left: t * zoom }}>
          <div className={major ? 'h-2.5 w-px bg-dim' : 'h-1.5 w-px bg-line-2'} />
          {major && (
            <span className="absolute bottom-3 left-1 text-[10px] whitespace-nowrap text-muted tabular-nums">
              {label(t, step)}
            </span>
          )}
        </div>
      ))}
      {markers.map((marker) => (
        <div
          key={marker.id}
          className="absolute top-0 z-[2] flex -translate-x-1/2 cursor-grab flex-col items-center"
          style={{ left: marker.time * zoom }}
          title={marker.label || 'Marker'}
          onPointerDown={(event) => {
            event.stopPropagation();
            if (event.button === 0) startMarkerDrag(event, marker.id);
          }}
          onDoubleClick={() => renameMarker(marker)}
          onContextMenu={(event) =>
            menu.open(event, [
              { label: 'Rename', icon: <Pencil size={14} />, onSelect: () => renameMarker(marker) },
              {
                label: 'Delete marker',
                icon: <Trash2 size={14} />,
                danger: true,
                onSelect: () =>
                  editor.update((draft) => {
                    draft.markers = draft.markers.filter((m) => m.id !== marker.id);
                  }),
              },
            ])
          }
        >
          <div
            className="h-3 w-3 rotate-45 rounded-[2px] border border-black/30"
            style={{ background: marker.color }}
          />
          {marker.label && zoom > 20 && (
            <span className="mt-0.5 max-w-24 truncate rounded bg-black/60 px-1 text-[9px] text-fg">
              {marker.label}
            </span>
          )}
        </div>
      ))}
      <PlayheadHead zoom={zoom} />
      {menu.menu}
    </div>
  );
});

function PlayheadHead({ zoom }: { zoom: number }) {
  const time = useEditor((s) => s.currentTime);
  return (
    <div
      className="pointer-events-none absolute top-0 z-[3] -translate-x-1/2"
      style={{ left: time * zoom }}
    >
      <svg width="13" height="16" viewBox="0 0 13 16" aria-hidden="true">
        <path d="M0 0h13v10l-6.5 6L0 10z" fill="#f43f5e" />
      </svg>
    </div>
  );
}

/** Vertical playhead line through all tracks. */
export function PlayheadLine({ zoom, offset }: { zoom: number; offset: number }) {
  const time = useEditor((s) => s.currentTime);
  return (
    <div
      className="pointer-events-none absolute top-0 bottom-0 z-[15] w-px bg-rose-500"
      style={{ left: offset + time * zoom }}
      data-testid="playhead"
    />
  );
}
