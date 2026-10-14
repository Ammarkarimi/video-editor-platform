import { getProjectDuration } from '@vep/core';
import {
  Bookmark,
  CopyPlus,
  Magnet,
  Maximize2,
  Redo2,
  Scissors,
  Trash2,
  Undo2,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import { IconButton } from '../../ui/Button';
import { Slider } from '../../ui/fields';
import {
  addMarkerAtPlayhead,
  deleteSelection,
  duplicateSelection,
  splitAtPlayhead,
} from '../actions';
import { editor, MAX_ZOOM, MIN_ZOOM, useEditor } from '../store/editorStore';
import { HEADER_WIDTH } from './constants';
import { getScroller } from './viewStore';

// The zoom slider works on a log scale so both ends are usable.
const toSlider = (zoom: number) => Math.log(zoom / MIN_ZOOM) / Math.log(MAX_ZOOM / MIN_ZOOM);
const fromSlider = (value: number) => MIN_ZOOM * (MAX_ZOOM / MIN_ZOOM) ** value;

export function TimelineToolbar() {
  const zoom = useEditor((s) => s.zoom);
  const snapping = useEditor((s) => s.snapping);
  const canUndo = useEditor((s) => s.past.length > 0);
  const canRedo = useEditor((s) => s.future.length > 0);
  const hasSelection = useEditor((s) => s.selection.length > 0 || s.selectedTransition !== null);
  const selectionCount = useEditor((s) => s.selection.length);

  const fit = () => {
    const scroller = getScroller();
    const duration = getProjectDuration(useEditor.getState().doc);
    if (!scroller || duration <= 0) return;
    editor.setZoom((scroller.clientWidth - HEADER_WIDTH - 40) / duration);
    scroller.scrollLeft = 0;
  };

  return (
    <div className="flex h-10 shrink-0 items-center gap-1 border-b border-line px-2">
      <IconButton label="Undo (Ctrl+Z)" disabled={!canUndo} onClick={() => editor.undo()}>
        <Undo2 size={15} />
      </IconButton>
      <IconButton label="Redo (Ctrl+Shift+Z)" disabled={!canRedo} onClick={() => editor.redo()}>
        <Redo2 size={15} />
      </IconButton>
      <div className="mx-1 h-5 w-px bg-line" />
      <IconButton
        label="Split at playhead (S)"
        onClick={splitAtPlayhead}
        data-testid="split-button"
      >
        <Scissors size={15} />
      </IconButton>
      <IconButton
        label="Duplicate (Ctrl+D)"
        disabled={selectionCount === 0}
        onClick={duplicateSelection}
      >
        <CopyPlus size={15} />
      </IconButton>
      <IconButton label="Delete (Del)" disabled={!hasSelection} onClick={() => deleteSelection()}>
        <Trash2 size={15} />
      </IconButton>
      <div className="mx-1 h-5 w-px bg-line" />
      <IconButton
        label={snapping ? 'Snapping on (N)' : 'Snapping off (N)'}
        active={snapping}
        onClick={() => useEditor.setState({ snapping: !snapping })}
      >
        <Magnet size={15} />
      </IconButton>
      <IconButton label="Add marker (M)" onClick={addMarkerAtPlayhead}>
        <Bookmark size={15} />
      </IconButton>
      {selectionCount > 1 && (
        <span className="ml-2 text-xs text-muted">{selectionCount} clips selected</span>
      )}
      <div className="flex-1" />
      <IconButton label="Zoom out (−)" onClick={() => editor.setZoom(zoom / 1.25)}>
        <ZoomOut size={15} />
      </IconButton>
      <Slider
        className="w-28"
        min={0}
        max={1}
        step={0.001}
        value={toSlider(zoom)}
        aria-label="Timeline zoom"
        onChange={(v) => editor.setZoom(fromSlider(v))}
      />
      <IconButton label="Zoom in (+)" onClick={() => editor.setZoom(zoom * 1.25)}>
        <ZoomIn size={15} />
      </IconButton>
      <IconButton label="Zoom to fit" onClick={fit}>
        <Maximize2 size={14} />
      </IconButton>
    </div>
  );
}
